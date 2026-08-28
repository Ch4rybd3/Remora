"""
The ingestion API.

Covers the courier's contract - accept and return, decide nothing - and the two
recovery actions the Collection tab offers on the states that need them.
"""
from __future__ import annotations

import io

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
    # Recognised but its parser lands in S16.
    assert by_name["registry_hive"]["available"] is False


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
