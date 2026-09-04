"""
The ingestion API.

Covers the courier's contract - accept and return, decide nothing - and the two
recovery actions the Collection tab offers on the states that need them.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest

from app.services import dropzone as dz

EVTX = b"ElfFile\x00" + b"\x00" * 128
HIVE = b"regf" + b"\x00" * 128


@pytest.fixture()
def api_case(auth_client) -> str:
    response = auth_client.post("/api/v1/cases", json={"title": "Ingest API test"})
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


def _upload(auth_client, case_id: str, name: str, data: bytes):
    return auth_client.post(
        f"/api/v1/cases/{case_id}/ingest/uploads",
        files={"files": (name, io.BytesIO(data), "application/octet-stream")},
    )


# ─── The courier ──────────────────────────────────────────────────────────────

def test_an_upload_is_accepted_not_processed(auth_client, api_case):
    """
    202, not 200.

    Nothing has been decided when the response is written - that is what makes
    this a courier. A synchronous result would mean parsing on the request
    path, which is the thing being removed.
    """
    response = _upload(auth_client, api_case, "Security.evtx", EVTX)
    assert response.status_code == 202, response.text
    assert response.json()["accepted"] == ["Security.evtx"]


def test_the_uploaded_file_is_in_the_case_drop_folder(auth_client, api_case, db_session):
    from app.models.case import Case

    _upload(auth_client, api_case, "Application.evtx", EVTX)
    case = db_session.query(Case).filter(Case.id == api_case).one()
    assert (dz.case_dropzone_dir(case) / "Application.evtx").read_bytes() == EVTX


def test_an_unrecognised_extension_is_still_accepted(auth_client, api_case):
    """
    No extension check, deliberately.

    Refusing on a name would mean guessing from exactly the signal the pipeline
    exists to stop trusting. Anything unrecognised becomes a listed
    `unidentified` row instead.
    """
    assert _upload(auth_client, api_case, "acquisition.weird", b"\xff\xfe\x99" * 40).status_code == 202


def test_an_upload_with_no_files_is_rejected(auth_client, api_case):
    response = auth_client.post(f"/api/v1/cases/{api_case}/ingest/uploads")
    assert response.status_code == 422   # FastAPI rejects the missing field


def test_uploading_to_a_missing_case_is_404(auth_client):
    assert _upload(auth_client, "no-such-case", "a.evtx", EVTX).status_code == 404


def test_upload_requires_authentication(client, api_case):
    assert _upload(client, api_case, "a.evtx", EVTX).status_code in (401, 403)


# ─── The queue ────────────────────────────────────────────────────────────────

def test_the_queue_starts_empty_and_reports_a_summary(auth_client, api_case):
    body = auth_client.get(f"/api/v1/cases/{api_case}/ingest").json()
    assert body["files"] == []
    assert body["summary"] == {}


def test_an_unknown_state_filter_is_rejected(auth_client, api_case):
    response = auth_client.get(f"/api/v1/cases/{api_case}/ingest", params={"state": "invented"})
    assert response.status_code == 400


def test_the_forceable_kinds_come_from_the_routing_table(auth_client):
    """
    The override is a choice from what the router knows, not free text - a
    forced kind nothing handles would be a dead end with no error.
    """
    kinds = auth_client.get("/api/v1/ingest/kinds").json()["kinds"]
    by_name = {k["kind"]: k for k in kinds}

    assert by_name["evtx"]["destination"] == "logs"
    assert by_name["evtx"]["available"] is True
    # A hive has a destination now - the Registry Explorer - so it is no longer
    # the example of something recognised and unusable.
    assert by_name["registry_hive"]["available"] is True
    # Recognised, and nothing reads it yet.
    assert by_name["ntfs_logfile"]["available"] is False


def test_the_drop_path_is_reported_for_manual_copies(auth_client, api_case):
    body = auth_client.get(f"/api/v1/cases/{api_case}/ingest/drop-path").json()
    assert body["folder_name"].endswith(api_case.replace("-", "")[:8])


# ─── Recovery ─────────────────────────────────────────────────────────────────

def _record(db_session, case_id: str, tmp_path, name: str, data: bytes):
    from app.services.ingest import service

    path = tmp_path / name
    path.write_bytes(data)
    return service.record(db_session, case_id=case_id, path=path)


def test_forcing_a_kind_reroutes_and_is_reported(auth_client, db_session, api_case, tmp_path):
    row = _record(db_session, api_case, tmp_path, "mystery", b"\xff\xfe" + b"\x99" * 64)
    assert row.state == "unidentified"

    response = auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/{row.id}/force-kind", json={"kind": "pcap"})
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["detected_kind"] == "pcap"
    assert body["detection_source"] == "forced"
    assert body["state"] == "routed"


def test_forcing_a_kind_nothing_handles_is_rejected(auth_client, db_session, api_case, tmp_path):
    row = _record(db_session, api_case, tmp_path, "mystery2", b"\xff\xfe" + b"\x98" * 64)
    response = auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/{row.id}/force-kind", json={"kind": "not-a-kind"})
    assert response.status_code == 400


def test_a_file_from_another_case_is_not_reachable(auth_client, db_session, api_case, tmp_path):
    """The case id in the path is a filter, not decoration."""
    other = auth_client.post("/api/v1/cases", json={"title": "Other"}).json()["id"]
    row = _record(db_session, api_case, tmp_path, "mystery3", b"\xff\xfe" + b"\x97" * 64)

    response = auth_client.post(
        f"/api/v1/cases/{other}/ingest/{row.id}/force-kind", json={"kind": "pcap"})
    assert response.status_code == 404


def test_an_indexed_file_cannot_be_retried(auth_client, db_session, api_case, tmp_path):
    """
    Replaying a file that already reached the Explorer would duplicate every
    row in it - worse than the problem retry solves.
    """
    row = _record(db_session, api_case, tmp_path, "Security.evtx", EVTX)
    row.state = "indexed"
    db_session.commit()

    response = auth_client.post(f"/api/v1/cases/{api_case}/ingest/{row.id}/retry")
    assert response.status_code == 409


def test_a_failed_file_can_be_retried(auth_client, db_session, api_case, tmp_path):
    row = _record(db_session, api_case, tmp_path, "broken.evtx", EVTX)
    row.state = "failed"
    row.error = "parser timed out"
    db_session.commit()

    body = auth_client.post(f"/api/v1/cases/{api_case}/ingest/{row.id}/retry").json()
    assert body["state"] == "discovered"
    assert body["error"] is None


# ─── Both doors, end to end ───────────────────────────────────────────────────

def test_a_dropped_file_produces_provenance(auth_client, db_session, api_case):
    """
    The drop folder door, all the way through.

    A file copied into the case folder and scanned must leave an
    `ingested_files` row - otherwise "what has been ingested into this case?"
    is still unanswerable, which is the whole reason the table exists.
    """
    from app.models.case import Case
    from app.models.ingest import IngestedFile

    case = db_session.query(Case).filter(Case.id == api_case).one()
    (dz.case_dropzone_dir(case) / "Dropped.evtx").write_bytes(EVTX)

    response = auth_client.post(
        f"/api/v1/cases/{api_case}/dropzone/scan", params={"include_unstable": True})
    assert response.status_code == 200, response.text

    rows = db_session.query(IngestedFile).filter(IngestedFile.case_id == api_case).all()
    dropped = [r for r in rows if r.original_name == "Dropped.evtx"]
    assert len(dropped) == 1

    row = dropped[0]
    assert row.origin == "dropzone"
    assert row.detected_kind == "evtx"
    assert row.detection_source == "magic"
    assert row.sha256
    # Recorded where the original was archived, so a retry can find it again.
    assert row.stored_path and ".processed" in row.stored_path


def test_both_doors_agree_on_the_same_artifact(auth_client, db_session, api_case):
    """
    The contract from `docs/INGESTION.md` section 2, end to end.

    An artifact uploaded from the Collection tab and the same artifact copied
    into the folder by hand must differ in `origin` and in nothing that governs
    how they are handled.
    """
    from app.models.case import Case
    from app.models.ingest import IngestedFile

    case = db_session.query(Case).filter(Case.id == api_case).one()

    # Door B, then door A - two distinct files so neither is a duplicate.
    _upload(auth_client, api_case, "ByUpload.evtx", EVTX + b"\x01")
    (dz.case_dropzone_dir(case) / "ByHand.evtx").write_bytes(EVTX + b"\x02")
    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})

    rows = {
        r.original_name: r
        for r in db_session.query(IngestedFile).filter(IngestedFile.case_id == api_case).all()
    }
    uploaded, by_hand = rows.get("ByUpload.evtx"), rows.get("ByHand.evtx")
    assert uploaded and by_hand

    def routing_facts(row):
        return (row.detected_kind, row.detection_source, row.routed_to, row.state)

    assert routing_facts(uploaded) == routing_facts(by_hand)


def test_the_queue_reports_what_was_ingested(auth_client, db_session, api_case):
    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == api_case).one()
    (dz.case_dropzone_dir(case) / "Listed.evtx").write_bytes(EVTX + b"\x03")
    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})

    body = auth_client.get(f"/api/v1/cases/{api_case}/ingest").json()
    names = {f["original_name"] for f in body["files"]}
    assert "Listed.evtx" in names
    assert body["summary"]


# ─── The drop folder accepts what it can identify ─────────────────────────────

def test_a_memory_image_dropped_in_is_no_longer_ignored(auth_client, db_session, api_case):
    """
    The gate used to be an extension whitelist, so a memory image, a disk image
    or a PE copied into the case folder was silently ignored - the drop folder
    claimed to be the single entry point while refusing half the artifact types
    on the strength of a filename.
    """
    from app.models.case import Case
    from app.models.ingest import IngestedFile

    case = db_session.query(Case).filter(Case.id == api_case).one()
    (dz.case_dropzone_dir(case) / "memdump.raw").write_bytes(b"\x11\x22" * 512)
    (dz.case_dropzone_dir(case) / "crash.bin").write_bytes(b"PAGEDU64" + b"\x00" * 256)

    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})

    names = {
        r.original_name: r
        for r in db_session.query(IngestedFile).filter(IngestedFile.case_id == api_case).all()
    }
    assert "crash.bin" in names
    assert names["crash.bin"].detected_kind == "memory_dump_windows"


def test_an_unparseable_artifact_is_not_copied_into_the_collection(
    auth_client, db_session, api_case
):
    """
    Copying a 64 GB acquisition into the collection directory would double it
    on disk for nothing: no parser reads it from there, and disk images are
    read in place by design.
    """
    from app.config import settings
    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == api_case).one()
    (dz.case_dropzone_dir(case) / "acquisition.E01").write_bytes(
        b"EVF\x09\x0d\x0a\xff\x00" + b"\x00" * 256)

    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})

    collections = settings.case_data_path / "cases" / api_case / "collections"
    copies = list(collections.rglob("acquisition.E01")) if collections.exists() else []
    assert copies == []


def test_it_is_still_moved_out_of_the_watched_folder(auth_client, db_session, api_case):
    """
    Otherwise every poll rediscovers it, and the queue fills with duplicates of
    a file nobody asked to import twice.
    """
    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == api_case).one()
    folder = dz.case_dropzone_dir(case)
    (folder / "image.vhdx").write_bytes(b"vhdxfile" + b"\x00" * 256)

    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})

    assert not (folder / "image.vhdx").exists()
    assert (folder / ".processed" / "image.vhdx").exists()


# ─── Choosing an OS for a raw memory image ────────────────────────────────────

def _record_raw_dump(db_session, case_id, tmp_path, name="memdump.raw"):
    from app.services.ingest import service

    path = tmp_path / name
    path.write_bytes(b"\x11\x22\x33\x44" * 256)
    row = service.record(db_session, case_id=case_id, path=path)
    row.stored_path = str(path)
    db_session.commit()
    return row


def test_a_raw_dump_waits_instead_of_being_refused(db_session, api_case, tmp_path):
    """
    It is hashed, listed and preservable while it waits. Refusing it outright
    would mean the analyst has to remember they have it.
    """
    row = _record_raw_dump(db_session, api_case, tmp_path)
    assert row.detected_kind == "memory_dump"
    assert row.sha256


def test_setting_the_os_registers_the_dump(auth_client, db_session, api_case, tmp_path,
                                           monkeypatch):
    seen: dict = {}

    def fake_register(source_path, case_id, filename, os_type, db):
        seen.update(filename=filename, os_type=os_type)
        return None

    monkeypatch.setattr("app.routers.memory.register_memory_dump", fake_register)

    row = _record_raw_dump(db_session, api_case, tmp_path, "acquisition.raw")
    response = auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/{row.id}/memory-os", json={"os_type": "linux"})

    assert response.status_code == 200, response.text
    assert seen == {"filename": "acquisition.raw", "os_type": "linux"}
    assert response.json()["state"] == "parsed"
    assert response.json()["detection_source"] == "forced"


def test_an_invalid_os_is_rejected(auth_client, db_session, api_case, tmp_path):
    row = _record_raw_dump(db_session, api_case, tmp_path, "bad-os.raw")
    response = auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/{row.id}/memory-os", json={"os_type": "solaris"})
    assert response.status_code == 400


def test_a_self_describing_dump_is_not_asked_for_an_os(auth_client, db_session,
                                                       api_case, tmp_path):
    """
    A Windows crash dump already says which OS it is. Offering to set one would
    invite an analyst to contradict the file.
    """
    from app.services.ingest import service

    path = tmp_path / "crash.bin"
    path.write_bytes(b"PAGEDU64" + b"\x00" * 256)
    row = service.record(db_session, case_id=api_case, path=path)
    row.stored_path = str(path)
    db_session.commit()

    response = auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/{row.id}/memory-os", json={"os_type": "linux"})
    assert response.status_code == 409


def test_the_drop_folder_is_a_readable_location_for_disk_images():
    """
    An acquisition dropped into a case folder is already hashed and listed.
    Telling the analyst to move it elsewhere to actually open it would make the
    single entry point a lie, and copying it is out of the question at
    acquisition sizes.
    """
    from app.config import settings
    from app.services.diskimage import allowed_roots

    roots = {str(r) for r in allowed_roots()}
    assert str(Path(settings.dropzone_path).resolve()) in roots
