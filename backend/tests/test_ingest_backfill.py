"""
Backfilling provenance for pre-pipeline imports.

The failure this guards against: an installation upgrades, the Collection tab
shows an empty ingest queue for a case full of artifacts, and "what has been
ingested here?" is answerable only for files added after the upgrade.
"""
from __future__ import annotations

import uuid

import pytest

from app.config import settings
from app.models.case import Case
from app.models.ez_artifacts import ImportedCollection, ImportedFile
from app.models.ingest import IngestedFile
from app.services.ingest import backfill

EVTX = b"ElfFile\x00" + b"\x00" * 128


@pytest.fixture()
def legacy_case(db_session):
    """A case holding one collection with two files, as the old importer left it."""
    case = Case(id=str(uuid.uuid4()), title="Legacy import")
    collection = ImportedCollection(
        id=str(uuid.uuid4()), case_id=case.id, filename="triage.zip", total_files=2)
    db_session.add_all([case, collection])
    db_session.commit()

    extracted = (settings.case_data_path / "cases" / case.id / "collections"
                 / collection.id / "extracted")
    extracted.mkdir(parents=True, exist_ok=True)
    (extracted / "Security.evtx").write_bytes(EVTX)

    db_session.add_all([
        # On disk, and reported as imported.
        ImportedFile(id=str(uuid.uuid4()), collection_id=collection.id, case_id=case.id,
                     filename="Security.evtx", file_size=len(EVTX),
                     status="imported", category="evtx_ez",
                     category_label="Event Logs (EvtxECmd)",
                     csv_artifact_id="csv-artifact-1"),
        # Expired: the row survives, the bytes do not.
        ImportedFile(id=str(uuid.uuid4()), collection_id=collection.id, case_id=case.id,
                     filename="Amcache.csv", file_size=4096,
                     status="imported", category="amcache_files",
                     category_label="Amcache"),
    ])
    db_session.commit()
    return case, collection


def test_legacy_imports_get_provenance(db_session, legacy_case):
    case, _ = legacy_case
    assert backfill.backfill_case(db_session, case.id) == 2

    rows = db_session.query(IngestedFile).filter(IngestedFile.case_id == case.id).all()
    assert {r.original_name for r in rows} == {"Security.evtx", "Amcache.csv"}


def test_the_door_is_recorded_as_unknown_not_guessed(db_session, legacy_case):
    """
    Which of the fourteen endpoints a file came through was never recorded.

    Claiming `upload` would be fabricating provenance in a tool whose output is
    meant to survive scrutiny, so `legacy` is a value rather than a guess.
    """
    case, _ = legacy_case
    backfill.backfill_case(db_session, case.id)

    rows = db_session.query(IngestedFile).filter(IngestedFile.case_id == case.id).all()
    assert {r.origin for r in rows} == {"legacy"}


def test_a_file_still_on_disk_is_identified_from_its_bytes(db_session, legacy_case):
    """
    The recorded category came from the old filename matching, which is exactly
    the answer this pipeline exists to stop trusting. Where the bytes survive,
    they win.
    """
    case, _ = legacy_case
    backfill.backfill_case(db_session, case.id)

    row = (db_session.query(IngestedFile)
           .filter(IngestedFile.case_id == case.id,
                   IngestedFile.original_name == "Security.evtx").one())
    assert row.detected_kind == "evtx"
    assert row.detection_source == "magic"
    assert row.sha256 and len(row.sha256) == 64
    assert row.state == "indexed"
    assert row.parsed_artifact_id == "csv-artifact-1"


def test_an_expired_file_still_gets_a_row(db_session, legacy_case):
    """
    Collections expire after 90 days. That the file was ingested is itself a
    fact about the investigation, and losing it because the artifact was
    cleaned up would defeat the point of the table.
    """
    case, _ = legacy_case
    backfill.backfill_case(db_session, case.id)

    row = (db_session.query(IngestedFile)
           .filter(IngestedFile.case_id == case.id,
                   IngestedFile.original_name == "Amcache.csv").one())
    assert row.sha256 is None
    assert row.detected_kind == "amcache_files"     # the weaker recorded answer
    assert row.detection_source == "extension"      # labelled as such
    assert "no longer on disk" in (row.error or "")


def test_running_twice_writes_nothing_the_second_time(db_session, legacy_case):
    """
    Idempotent by construction, because it runs on every startup and may be
    interrupted at any point.
    """
    case, _ = legacy_case
    assert backfill.backfill_case(db_session, case.id) == 2
    assert backfill.backfill_case(db_session, case.id) == 0

    rows = db_session.query(IngestedFile).filter(IngestedFile.case_id == case.id).all()
    assert len(rows) == 2


def test_a_file_ingested_by_the_new_pipeline_is_not_duplicated(db_session, legacy_case, tmp_path):
    """A file the pipeline already recorded must not gain a second, legacy row."""
    from app.services.ingest import service

    case, collection = legacy_case
    path = tmp_path / "Security.evtx"
    path.write_bytes(EVTX)
    service.record(db_session, case_id=case.id, path=path, collection_id=collection.id)

    backfill.backfill_case(db_session, case.id)

    named = (db_session.query(IngestedFile)
             .filter(IngestedFile.case_id == case.id,
                     IngestedFile.original_name == "Security.evtx").all())
    assert len(named) == 1
    assert named[0].origin == "dropzone"


def test_backfilling_every_case_survives_a_broken_one(db_session, legacy_case):
    case, _ = legacy_case
    written = backfill.backfill_all(db_session)
    assert written >= 2
