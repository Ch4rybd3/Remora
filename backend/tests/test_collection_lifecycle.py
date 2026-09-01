"""
What a collection produces, and what happens when it is deleted.

Two claims, and they are the same claim from two ends.

**A parsed artifact outlives its parse.** The Artifact Explorer reads a CSV in
place - it never copies it - so where a parser writes decides whether the table
still has rows tomorrow. Writing to a temporary directory produced tables that
listed a row count, taken before the directory was removed, and opened empty.

**A deleted collection takes what it produced with it.** Deletion used to
remove a directory and some ingest rows, leaving every record the ingest had
created in another module behind, still listed, pointing at bytes that were
gone. Except what has been preserved in the chain of custody, which is the one
thing that must survive.
"""
from __future__ import annotations

import json

import pytest

from app.models.collection_output import OUTPUT_CSV_ARTIFACT, CollectionOutput
from app.models.csv_artifact import CsvArtifactFile
from app.models.ez_artifacts import ImportedCollection, ImportedFile
from app.models.ingest import STATE_INDEXED
from app.services import collections as collections_service
from app.services.ingest import batch, ez_parsers
from app.services.ingest import dispatch as dispatch_mod

HIVE = b"regf" + b"\x00" * 128
TABLE = "Path,LastModified\nC:\\Windows\\notepad.exe,2026-01-01 10:00:00\n"


@pytest.fixture()
def api_case(auth_client) -> str:
    return auth_client.post("/api/v1/cases", json={"title": "Lifecycle"}).json()["id"]


@pytest.fixture()
def parsing_writes_a_table(monkeypatch):
    """
    Stand in for an Eric Zimmerman tool, writing where it is told to.

    The real tools are .NET binaries provisioned into the image; what is under
    test is not their output but **where it goes**, so the fake writes one CSV
    into the output directory it is given and nothing else.
    """
    def fake_run(kind, source, workdir, out_dir=None):
        target = out_dir if out_dir is not None else (workdir / "out")
        target.mkdir(parents=True, exist_ok=True)
        csv_path = target / f"{source.stem}_Output.csv"
        csv_path.write_text(TABLE)
        return ez_parsers.ParseOutcome(True, csv_files=[csv_path], tool="FakeECmd")

    monkeypatch.setattr(ez_parsers, "run", fake_run)


# ─── A parsed table has to outlive the parse ──────────────────────────────────

def test_a_parsed_table_still_has_its_rows_after_the_parse(
    db_session, api_case, tmp_path, parsing_writes_a_table
):
    """
    The regression. A table that reports 1,006 rows and opens empty.

    The count was read from the CSV while it existed and the CSV was deleted
    with the scratch directory three lines later, so the number in the list was
    true at the moment it was taken and false by the time anyone clicked it.
    """
    artifact = tmp_path / "SYSTEM"
    artifact.write_bytes(HIVE)
    out_dir = tmp_path / "collection" / "_parsed"

    result = dispatch_mod.parse(db_session, case_id=api_case, path=artifact,
                                filename="SYSTEM", out_dir=out_dir)
    assert result.state == STATE_INDEXED

    row = db_session.get(CsvArtifactFile, result.artifact_id)
    assert row is not None
    assert row.row_count == 1

    from pathlib import Path
    assert Path(str(row.file_path)).exists(), (
        "the parser output was registered and then deleted with its directory")

    # And the rows are actually readable, not merely present on disk.
    from app.services.store import Query, get_store
    page = get_store().search(str(row.file_path), json.loads(row.columns), Query())
    assert page.total == 1
    assert len(page.rows) == 1


def test_two_artifacts_of_the_same_name_do_not_overwrite_each_other(
    db_session, api_case, tmp_path, parsing_writes_a_table
):
    """
    A KAPE triage collects `NTUSER.DAT` once per user profile.

    Output directories named only after the file would have the second parse
    overwrite the first, leaving one Explorer record describing another hive's
    rows - a wrong answer that looks exactly like a right one.
    """
    out_dir = tmp_path / "_parsed"
    ids = []
    for profile in ("alice", "bob"):
        artifact = tmp_path / profile / "NTUSER.DAT"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(HIVE)
        result = dispatch_mod.parse(db_session, case_id=api_case, path=artifact,
                                    filename="NTUSER.DAT", out_dir=out_dir)
        assert result.state == STATE_INDEXED
        ids.append(result.artifact_id)

    assert ids[0] != ids[1], "the second parse was registered as the first"
    paths = {str(db_session.get(CsvArtifactFile, i).file_path) for i in ids}
    assert len(paths) == 2, "both parses wrote to the same file"
    for path in paths:
        from pathlib import Path as P
        assert P(path).exists()


def test_parser_output_defaults_beside_the_artifact_never_to_a_temporary(
    db_session, api_case, tmp_path, parsing_writes_a_table
):
    """A caller that says nothing still gets a durable directory."""
    artifact = tmp_path / "SYSTEM"
    artifact.write_bytes(HIVE)

    result = dispatch_mod.parse(db_session, case_id=api_case, path=artifact,
                                filename="SYSTEM")
    row = db_session.get(CsvArtifactFile, result.artifact_id)
    assert dispatch_mod.PARSED_DIRNAME in str(row.file_path)
    assert str(tmp_path) in str(row.file_path)


# ─── One parser, one table ────────────────────────────────────────────────────

def test_the_directory_reading_tools_are_batched_not_run_per_file():
    """
    A triage holds hundreds of event logs and shortcuts. Parsed one at a time
    each produced its own table, all named `..._Output.csv` - the data was
    there and the shape was unusable.
    """
    assert "evtx" in ez_parsers.BATCH_KINDS
    assert "lnk" in ez_parsers.BATCH_KINDS
    assert ez_parsers.BATCH_KINDS["evtx"].dir_args is not None

    kinds = {kind for job in batch.jobs() for kind in job.kinds}
    assert {"evtx", "lnk", "jumplist_auto", "jumplist_custom"} <= kinds


def test_one_tool_is_one_job_even_when_it_reads_two_kinds():
    """
    JLECmd reads automatic and custom jump lists. Two jobs would run it twice,
    over half the files each, into the same output directory - the second run
    overwriting the first.
    """
    jlecmd = [job for job in batch.jobs()
              if {"jumplist_auto", "jumplist_custom"} & job.kinds]
    assert len(jlecmd) == 1
    assert {"jumplist_auto", "jumplist_custom"} <= jlecmd[0].kinds


def test_an_event_log_still_reaches_the_logs_module_per_file():
    """
    Batching the Explorer table must not cost the EVTX its other home. Sigma
    detections run against the file in the Logs module, one file at a time.
    """
    assert dispatch_mod._HANDLERS["evtx"] is dispatch_mod._to_logs


def test_the_batch_stage_ignores_its_own_output():
    """
    Output lands under `_parsed`, inside the tree the batch stage walks. Without
    the skip it would identify its own CSVs as artifacts and parse them again.
    """
    assert batch.PARSED_DIRNAME in batch._SKIP_DIRECTORIES


# ─── Deleting a collection ────────────────────────────────────────────────────

@pytest.fixture()
def collection_with_a_table(db_session, api_case, monkeypatch, tmp_path):
    """A collection that produced one table, both on disk and recorded."""
    def _make(preserved: bool = False):
        monkeypatch.setattr(collections_service.settings, "case_data_path", tmp_path)

        col = ImportedCollection(case_id=api_case, filename="triage.zip",
                                 status="done", total_files=1)
        db_session.add(col)
        db_session.flush()

        source = ImportedFile(collection_id=col.id, case_id=api_case,
                              filename="SYSTEM", status="imported",
                              added_to_evidence=preserved)
        db_session.add(source)
        db_session.flush()

        directory = collections_service.collection_dir(api_case, str(col.id)) / "extracted"
        directory.mkdir(parents=True, exist_ok=True)
        csv_path = directory / "_parsed" / "table.csv"
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        csv_path.write_text(TABLE)

        artifact = CsvArtifactFile(case_id=api_case, original_name="table.csv",
                                   file_path=str(csv_path), columns='["Path"]',
                                   row_count=1)
        db_session.add(artifact)
        db_session.flush()

        db_session.add(CollectionOutput(
            case_id=api_case, collection_id=col.id, kind=OUTPUT_CSV_ARTIFACT,
            record_id=str(artifact.id), file_path=str(csv_path),
            source_file_id=str(source.id)))
        db_session.commit()
        return col, artifact, csv_path
    return _make


def test_deleting_a_collection_removes_the_tables_it_produced(
    db_session, collection_with_a_table
):
    """
    The failure this replaces was silent. The directory went, the ingest rows
    went, and the Explorer kept listing a table whose file no longer existed.
    """
    col, artifact, csv_path = collection_with_a_table()
    artifact_id = str(artifact.id)

    removed = collections_service.delete(db_session, col)

    assert removed.tables == 1
    assert db_session.get(CsvArtifactFile, artifact_id) is None
    assert not csv_path.exists()


def test_a_preserved_artifact_survives_the_collection(
    db_session, api_case, collection_with_a_table
):
    """
    Preserving an artifact is what exempts it from the collection's fate.
    Deleting the collection is how an analyst narrows a case down to what
    matters, so the artifacts they chose to keep have to still be queryable
    afterwards - which means the file moves, not just the row.
    """
    col, artifact, csv_path = collection_with_a_table(preserved=True)
    artifact_id = str(artifact.id)

    removed = collections_service.delete(db_session, col)

    assert removed.preserved == 1
    assert removed.tables == 0

    kept = db_session.get(CsvArtifactFile, artifact_id)
    assert kept is not None, "a preserved artifact must outlive its collection"

    from pathlib import Path
    moved = Path(str(kept.file_path))
    assert moved.exists(), "the row survived and its bytes did not"
    assert not csv_path.exists(), "the working copy was left inside the deleted collection"
    assert "preserved" in str(moved)


def test_deletion_finds_records_from_before_the_output_table_existed(
    db_session, api_case, monkeypatch, tmp_path
):
    """
    Collections already in the database produced records nothing wrote down.
    Inferring them from the file's location is what stops this change from
    shipping a fix that only works for imports made after it.
    """
    monkeypatch.setattr(collections_service.settings, "case_data_path", tmp_path)

    col = ImportedCollection(case_id=api_case, filename="old.zip", status="done")
    db_session.add(col)
    db_session.flush()

    directory = collections_service.collection_dir(api_case, str(col.id)) / "extracted"
    directory.mkdir(parents=True, exist_ok=True)
    csv_path = directory / "legacy.csv"
    csv_path.write_text(TABLE)

    artifact = CsvArtifactFile(case_id=api_case, original_name="legacy.csv",
                               file_path=str(csv_path), columns='["Path"]', row_count=1)
    db_session.add(artifact)
    db_session.commit()
    artifact_id = str(artifact.id)

    # Nothing in collection_outputs names it.
    assert db_session.query(CollectionOutput).filter(
        CollectionOutput.collection_id == col.id).count() == 0

    removed = collections_service.delete(db_session, col)
    assert removed.tables == 1
    assert db_session.get(CsvArtifactFile, artifact_id) is None


def test_the_plan_says_what_will_go_before_anything_does(
    db_session, collection_with_a_table
):
    """
    Deleting a collection reaches five pages away from the button. A
    confirmation that does not say what it will take is not a confirmation.
    """
    col, artifact, csv_path = collection_with_a_table()
    artifact_id = str(artifact.id)

    preview = collections_service.plan(db_session, col)

    assert preview.tables == 1
    assert preview.files == 1
    assert preview.bytes_on_disk > 0
    # Read-only: nothing moved.
    assert db_session.get(CsvArtifactFile, artifact_id) is not None
    assert csv_path.exists()


# ─── A table whose file is gone says so ───────────────────────────────────────

def test_a_table_whose_file_is_gone_says_so_rather_than_opening_empty(
    db_session, auth_client, api_case, tmp_path
):
    """
    The symptom that started this: a table listing 1,006 rows that opens with
    none. The count was taken while the file existed, so the list is not lying
    about the past - but an empty grid reads as "this artifact has no rows",
    which sends the analyst looking for the wrong problem.

    Records like this exist in databases upgraded from before the fix, so the
    Explorer has to be able to say what happened to them.
    """
    csv_path = tmp_path / "vanished.csv"
    csv_path.write_text(TABLE)

    artifact = CsvArtifactFile(case_id=api_case, original_name="vanished.csv",
                               file_path=str(csv_path), columns='["Path"]',
                               row_count=1006)
    db_session.add(artifact)
    db_session.commit()
    artifact_id = str(artifact.id)

    csv_path.unlink()

    listed = auth_client.get(f"/api/v1/cases/{api_case}/artifacts").json()
    entry = next(a for a in listed if a["id"] == artifact_id)
    assert entry["available"] is False, "the list must mark a table it cannot open"

    rows = auth_client.get(f"/api/v1/cases/{api_case}/artifacts/{artifact_id}/rows")
    assert rows.status_code == 410
    assert "no longer" in rows.json()["detail"]


def test_a_table_that_is_there_is_marked_available(db_session, auth_client,
                                                   api_case, tmp_path):
    csv_path = tmp_path / "present.csv"
    csv_path.write_text(TABLE)
    artifact = CsvArtifactFile(case_id=api_case, original_name="present.csv",
                               file_path=str(csv_path), columns='["Path"]', row_count=1)
    db_session.add(artifact)
    db_session.commit()

    listed = auth_client.get(f"/api/v1/cases/{api_case}/artifacts").json()
    entry = next(a for a in listed if a["id"] == str(artifact.id))
    assert entry["available"] is True
