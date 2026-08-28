"""
Chain of custody.

The claim under test: promoting an artifact **preserves it**. An evidence
record that merely points at a file inside a collection that expires is worse
than no record, because it reads as preserved when it is not.
"""
from __future__ import annotations

import io

import pytest

from app.config import settings
from app.models.evidence import Evidence
from app.models.ingest import IngestedFile
from app.services import dropzone as dz
from app.services.ingest import service as ingest_service

EVTX = b"ElfFile\x00" + b"\x00" * 128
PE   = bytes(bytearray(b"MZ" + b"\x00" * 0x3A + (0x80).to_bytes(4, "little")
                       + b"\x00" * 0x3C + b"PE\x00\x00" + b"\x00" * 128))


@pytest.fixture()
def api_case(auth_client) -> str:
    return auth_client.post("/api/v1/cases", json={"title": "Custody test"}).json()["id"]


@pytest.fixture()
def ingested(db_session, api_case, tmp_path):
    """A file the pipeline has recorded, sitting where its stored_path says."""
    def _make(name: str, data: bytes) -> IngestedFile:
        path = tmp_path / name
        path.write_bytes(data)
        row = ingest_service.record(db_session, case_id=api_case, path=path)
        row.stored_path = str(path)          # absolute, as an older row would be
        db_session.commit()
        return row
    return _make


def _promote(auth_client, case_id, row_id, **extra):
    return auth_client.post(f"/api/v1/cases/{case_id}/custody",
                            json={"kind": "ingested_file", "source_id": row_id, **extra})


# ─── Preservation ─────────────────────────────────────────────────────────────

def test_promotion_copies_the_bytes(auth_client, api_case, ingested):
    """
    The point of the whole feature.

    Without a copy, the evidence record points into a collection that expires
    after 90 days, and the chain of custody documents something that is gone.
    """
    row = ingested("Security.evtx", EVTX)
    response = _promote(auth_client, api_case, row.id)
    assert response.status_code == 201, response.text

    body = response.json()
    stored = settings.evidence_store_path / api_case
    copies = [p for p in stored.iterdir() if body["id"] in p.name]
    assert len(copies) == 1
    assert copies[0].read_bytes() == EVTX


def test_the_source_is_linked_so_it_is_not_offered_twice(
    auth_client, db_session, api_case, ingested
):
    row = ingested("Linked.evtx", EVTX)
    evidence_id = _promote(auth_client, api_case, row.id).json()["id"]

    listed = auth_client.get(f"/api/v1/cases/{api_case}/ingest").json()["files"]
    entry = next(f for f in listed if f["id"] == row.id)
    assert entry["preserved"] is True
    assert entry["evidence_id"] == evidence_id


def test_the_hashes_recorded_are_of_the_artifact(auth_client, api_case, ingested):
    import hashlib

    row = ingested("Hashed.evtx", EVTX)
    body = _promote(auth_client, api_case, row.id).json()
    assert body["sha256_hash"] == hashlib.sha256(EVTX).hexdigest()
    assert body["md5_hash"] == hashlib.md5(EVTX).hexdigest()


def test_the_chain_of_custody_opens_with_the_preservation(auth_client, api_case, ingested):
    row = ingested("Chain.evtx", EVTX)
    coc = _promote(auth_client, api_case, row.id).json()["chain_of_custody"]
    assert "Preserved in the chain of custody" in coc
    assert "SHA256:" in coc


def test_the_evidence_type_comes_from_the_detected_kind(auth_client, api_case, ingested):
    """Identification already worked out what this is; do not ask again."""
    assert _promote(auth_client, api_case, ingested("a.evtx", EVTX).id).json()[
        "evidence_type"] == "log"


def test_a_file_with_no_copy_on_disk_cannot_be_promoted(
    auth_client, db_session, api_case, ingested
):
    """
    Honest refusal rather than an empty evidence record.

    The ingestion record stays - that the file was seen is still a fact - but
    there is nothing left to preserve.
    """
    row = ingested("Gone.evtx", EVTX)
    row.stored_path = "/nowhere/Gone.evtx"
    db_session.commit()

    response = _promote(auth_client, api_case, row.id)
    assert response.status_code == 409
    assert "no longer on disk" in response.json()["detail"]


# ─── IOC containment ──────────────────────────────────────────────────────────

def test_an_ioc_is_stored_inside_a_password_protected_archive(
    auth_client, api_case, ingested
):
    row = ingested("dropper.exe", PE)
    body = _promote(auth_client, api_case, row.id, as_ioc=True).json()

    assert body["contained"] is True
    assert body["archive_password"] == settings.ioc_archive_password

    stored = settings.evidence_store_path / api_case
    archive = next(p for p in stored.iterdir() if body["id"] in p.name)
    assert archive.name.endswith(".ioc.zip")
    # The raw sample must not also be sitting there unprotected.
    assert not any(p.name.endswith("dropper.exe") for p in stored.iterdir())


def test_the_archive_opens_with_the_password_and_holds_the_original(
    auth_client, api_case, ingested
):
    import pyzipper

    row = ingested("sample.exe", PE)
    body = _promote(auth_client, api_case, row.id, as_ioc=True).json()
    archive = next(p for p in (settings.evidence_store_path / api_case).iterdir()
                   if body["id"] in p.name)

    with pyzipper.AESZipFile(archive) as zf:
        zf.setpassword(settings.ioc_archive_password.encode())
        assert zf.read("sample.exe") == PE


def test_the_archive_refuses_a_wrong_password(auth_client, api_case, ingested):
    """
    Containment, not confidentiality - but it must at least be real encryption.

    Legacy ZipCrypto is broken badly enough that some tools ignore it, which
    would defeat even the accident prevention this is for.
    """
    import pyzipper

    row = ingested("locked.exe", PE)
    body = _promote(auth_client, api_case, row.id, as_ioc=True).json()
    archive = next(p for p in (settings.evidence_store_path / api_case).iterdir()
                   if body["id"] in p.name)

    with pyzipper.AESZipFile(archive) as zf:
        zf.setpassword(b"wrong")
        with pytest.raises(RuntimeError):
            zf.read("locked.exe")


def test_the_hash_recorded_for_an_ioc_is_the_sample_not_the_archive(
    auth_client, api_case, ingested
):
    """
    A chain of custody naming our own container instead of the artifact would
    be worthless the moment anyone corroborated it against another tool.
    """
    import hashlib

    row = ingested("hashed.exe", PE)
    body = _promote(auth_client, api_case, row.id, as_ioc=True).json()
    assert body["sha256_hash"] == hashlib.sha256(PE).hexdigest()
    assert "Contained" in body["chain_of_custody"]


# ─── Withdrawal ───────────────────────────────────────────────────────────────

def test_withdrawing_requires_a_reason(auth_client, api_case, ingested):
    row = ingested("Withdraw.evtx", EVTX)
    evidence_id = _promote(auth_client, api_case, row.id).json()["id"]

    response = auth_client.request(
        "DELETE", f"/api/v1/cases/{api_case}/custody/{evidence_id}", json={"reason": "  "})
    assert response.status_code == 400


def test_withdrawing_deletes_the_copy_and_unlinks_the_source(
    auth_client, db_session, api_case, ingested
):
    """
    Deleting the bytes is deliberate: leaving them after the record says they
    were withdrawn would make the store disagree with the chain of custody, and
    the chain is the part that has to be trustworthy.
    """
    row = ingested("Removed.evtx", EVTX)
    evidence_id = _promote(auth_client, api_case, row.id).json()["id"]
    stored = settings.evidence_store_path / api_case
    copy = next(p for p in stored.iterdir() if evidence_id in p.name)

    response = auth_client.request(
        "DELETE", f"/api/v1/cases/{api_case}/custody/{evidence_id}",
        json={"reason": "Added by mistake, wrong case"})
    assert response.status_code == 204

    assert not copy.exists()
    db_session.expire_all()
    assert db_session.query(Evidence).filter(Evidence.id == evidence_id).first() is None
    assert db_session.query(IngestedFile).filter(IngestedFile.id == row.id).one().evidence_id is None


def test_a_withdrawal_is_audited_before_the_row_goes(auth_client, api_case, ingested):
    """
    The audit entry is the only thing that survives, so it has to name what was
    removed and why.
    """
    row = ingested("Audited.evtx", EVTX)
    evidence_id = _promote(auth_client, api_case, row.id).json()["id"]
    auth_client.request("DELETE", f"/api/v1/cases/{api_case}/custody/{evidence_id}",
                        json={"reason": "Duplicate of another item"})

    entries = auth_client.get("/api/v1/audit", params={"limit": 50}).json()
    rows = entries["items"] if isinstance(entries, dict) else entries
    withdrawals = [e for e in rows if e.get("action") == "custody.withdraw"]
    assert withdrawals
    assert "Duplicate of another item" in str(withdrawals[0].get("details"))


# ─── Listing and shape ────────────────────────────────────────────────────────

def test_the_case_custody_list_reports_a_summary(auth_client, api_case, ingested):
    _promote(auth_client, api_case, ingested("one.evtx", EVTX).id)
    _promote(auth_client, api_case, ingested("two.exe", PE).id, as_ioc=True)

    body = auth_client.get(f"/api/v1/cases/{api_case}/custody").json()
    assert body["summary"]["preserved"] == 2
    assert body["summary"]["contained"] == 1


def test_an_unregistered_source_kind_is_rejected(auth_client, api_case):
    response = auth_client.post(f"/api/v1/cases/{api_case}/custody",
                                json={"kind": "invented", "source_id": "x"})
    assert response.status_code == 400


def test_the_registered_source_kinds_are_discoverable(auth_client):
    """
    A page checks it is registered before offering the button, rather than
    finding out on the analyst's first click.
    """
    kinds = auth_client.get("/api/v1/custody/source-kinds").json()["kinds"]
    assert "ingested_file" in kinds
    assert "artifact" in kinds


def test_promotion_requires_authentication(client, api_case):
    response = client.post(f"/api/v1/cases/{api_case}/custody",
                           json={"kind": "ingested_file", "source_id": "x"})
    assert response.status_code in (401, 403)


def test_an_upload_promoted_from_the_collection_tab_behaves_the_same(
    auth_client, db_session, api_case
):
    """
    The two doors again: a file that arrived by upload promotes exactly like
    one that arrived by scp.
    """
    from app.models.case import Case

    auth_client.post(
        f"/api/v1/cases/{api_case}/ingest/uploads",
        files={"files": ("Uploaded.evtx", io.BytesIO(EVTX), "application/octet-stream")})
    case = db_session.query(Case).filter(Case.id == api_case).one()
    assert (dz.case_dropzone_dir(case) / "Uploaded.evtx").exists()

    auth_client.post(f"/api/v1/cases/{api_case}/dropzone/scan",
                     params={"include_unstable": True})
    row = (db_session.query(IngestedFile)
           .filter(IngestedFile.case_id == api_case,
                   IngestedFile.original_name == "Uploaded.evtx").one())

    body = _promote(auth_client, api_case, row.id).json()
    assert body["evidence_type"] == "log"
    assert body["original_filename"] == "Uploaded.evtx"


# ─── Retention ────────────────────────────────────────────────────────────────

def test_preserving_suspends_the_ninety_day_expiry(auth_client, db_session, api_case, ingested):
    """
    The user-facing promise: a preserved artifact is not cleaned up at 90 days.

    `ImportedFile.expires_at` is what the Collection tab counts down. Leaving it
    ticking on something the chain of custody says is kept would have two parts
    of the same screen disagreeing about whether evidence still exists.
    """
    import uuid as _uuid
    from datetime import datetime, timedelta

    from app.models.ez_artifacts import ImportedCollection, ImportedFile

    collection = ImportedCollection(id=str(_uuid.uuid4()), case_id=api_case, filename="c.zip")
    db_session.add(collection)
    db_session.commit()

    legacy = ImportedFile(
        id=str(_uuid.uuid4()), collection_id=collection.id, case_id=api_case,
        filename="Kept.evtx", status="imported",
        expires_at=datetime.utcnow() + timedelta(days=90))
    db_session.add(legacy)
    db_session.commit()

    row = ingested("Kept.evtx", EVTX)
    evidence_id = _promote(auth_client, api_case, row.id).json()["id"]

    db_session.expire_all()
    refreshed = db_session.query(ImportedFile).filter(ImportedFile.id == legacy.id).one()
    assert refreshed.expires_at is None
    assert refreshed.added_to_evidence is True

    auth_client.request("DELETE", f"/api/v1/cases/{api_case}/custody/{evidence_id}",
                        json={"reason": "no longer relevant"})

    db_session.expire_all()
    restored = db_session.query(ImportedFile).filter(ImportedFile.id == legacy.id).one()
    assert restored.expires_at is not None
    assert restored.added_to_evidence is False
