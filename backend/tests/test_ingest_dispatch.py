"""
Parsing dispatch.

Routing decides where a file belongs; dispatch decides what happens to it.
Until this stage existed the pipeline produced a correct answer that led
nowhere - it knew a file was an EVTX bound for the Logs module and had no way
to send it there.

The handlers wrap parsers that already run in production, so these tests are
about **which** parser is chosen and on what evidence, not about parsing.
"""
from __future__ import annotations

import pytest

from app.models.ingest import (
    STATE_FAILED,
    STATE_INDEXED,
    STATE_PARSED,
    STATE_UNSUPPORTED,
)
from app.services.ingest import dispatch as dispatch_mod
from app.services.ingest import service as ingest_service

EVTX = b"ElfFile\x00" + b"\x00" * 128
HIVE = b"regf" + b"\x00" * 128


class _FakeArtifact:
    def __init__(self, artifact_id="art-1", row_count=42):
        self.id = artifact_id
        self.row_count = row_count


@pytest.fixture()
def handlers(monkeypatch):
    """Record which parser was chosen, without running any of them."""
    calls: list[tuple[str, str]] = []

    def explorer(db, case_id, path, filename):
        calls.append(("explorer", filename))
        return dispatch_mod.ParseResult(STATE_INDEXED, artifact_id="art-1", row_count=42)

    def logs(db, case_id, path, filename):
        calls.append(("logs", filename))
        return dispatch_mod.ParseResult(STATE_PARSED)

    def mail(db, case_id, path, filename):
        calls.append(("mail", filename))
        return dispatch_mod.ParseResult(STATE_INDEXED, row_count=1)

    def pcap(db, case_id, path, filename):
        calls.append(("pcap", filename))
        return dispatch_mod.ParseResult(STATE_INDEXED, artifact_id="art-2", row_count=7)

    monkeypatch.setattr(dispatch_mod, "_HANDLERS", {
        "csv": explorer, "json": explorer, "jsonl": explorer,
        "text": explorer, "log": explorer, "xml": explorer,
        "evtx": logs, "eml": mail, "pcap": pcap, "pcapng": pcap,
    })
    return calls


@pytest.fixture()
def case_id_for(db_session):
    import uuid

    from app.models.case import Case

    def _make() -> str:
        new_id = str(uuid.uuid4())
        db_session.add(Case(id=new_id, title="Dispatch test"))
        db_session.commit()
        return new_id
    return _make


# ─── Choosing the parser ──────────────────────────────────────────────────────

def test_a_csv_goes_to_the_explorer(db_session, handlers, tmp_path):
    path = tmp_path / "Amcache.csv"
    path.write_text("a,b,c\n1,2,3\n4,5,6\n")

    result = dispatch_mod.parse(db_session, case_id="c1", path=path, filename="Amcache.csv")
    assert handlers == [("explorer", "Amcache.csv")]
    assert result.state == STATE_INDEXED
    assert result.row_count == 42


def test_an_evtx_renamed_txt_still_goes_to_the_logs_module(db_session, handlers, tmp_path):
    """
    The upgrade the legacy import gets by calling this.

    It dispatched on the filename extension, so a `.txt` that was really an
    EVTX was registered in the Explorer as a one-column table of binary
    garbage. Identification reads the bytes.
    """
    path = tmp_path / "notes.txt"
    path.write_bytes(EVTX)

    dispatch_mod.parse(db_session, case_id="c1", path=path, filename="notes.txt")
    assert handlers == [("logs", "notes.txt")]


def test_an_explicit_kind_is_trusted_over_the_bytes(db_session, handlers, tmp_path):
    """
    A kind that has been forced by an analyst is not second-guessed here.

    Re-identifying would quietly undo the correction the Collection tab exists
    to let them make.
    """
    path = tmp_path / "mystery"
    path.write_bytes(EVTX)

    dispatch_mod.parse(db_session, case_id="c1", path=path, filename="mystery", kind="csv")
    assert handlers == [("explorer", "mystery")]


def test_a_capture_is_dissected_then_registered(db_session, handlers, tmp_path):
    path = tmp_path / "capture.pcap"
    path.write_bytes(b"\xd4\xc3\xb2\xa1" + b"\x00" * 64)

    result = dispatch_mod.parse(db_session, case_id="c1", path=path, filename="capture.pcap")
    assert handlers == [("pcap", "capture.pcap")]
    assert result.artifact_id == "art-2"


def test_mail_is_recognised_without_an_extension(db_session, handlers, tmp_path):
    path = tmp_path / "message"
    path.write_bytes(b"Received: from mx.example.com\r\nFrom: a@b.c\r\n\r\nbody\r\n")

    dispatch_mod.parse(db_session, case_id="c1", path=path, filename="message")
    assert handlers == [("mail", "message")]


# ─── Nothing is lost ──────────────────────────────────────────────────────────

def test_a_kind_with_no_handler_is_unsupported_not_an_error(db_session, handlers, tmp_path):
    """
    Registry hives are recognised; RECmd lands in S16. `unsupported` says so
    honestly - the file is stored and listed, it is simply not queryable yet.
    """
    path = tmp_path / "SYSTEM"
    path.write_bytes(HIVE)

    result = dispatch_mod.parse(db_session, case_id="c1", path=path, filename="SYSTEM")
    assert result.state == STATE_UNSUPPORTED
    assert "has not shipped" in (result.error or "")
    assert handlers == []


def test_a_missing_file_fails_with_a_reason(db_session, handlers, tmp_path):
    result = dispatch_mod.parse(db_session, case_id="c1",
                                path=tmp_path / "gone.csv", filename="gone.csv")
    assert result.state == STATE_FAILED
    assert "not found" in (result.error or "").lower()


def test_a_parser_crash_becomes_a_state_not_an_exception(db_session, monkeypatch, tmp_path):
    """
    A parser crash is a fact about one file, never a reason to lose it or to
    stop the batch it arrived in.
    """
    def boom(db, case_id, path, filename):
        raise RuntimeError("tshark segfaulted")

    monkeypatch.setattr(dispatch_mod, "_HANDLERS", {"csv": boom})
    path = tmp_path / "broken.csv"
    path.write_text("a,b\n1,2\n3,4\n")

    result = dispatch_mod.parse(db_session, case_id="c1", path=path, filename="broken.csv")
    assert result.state == STATE_FAILED
    assert "tshark segfaulted" in (result.error or "")


# ─── Advancing an ingested_files row ──────────────────────────────────────────

def test_dispatch_records_the_outcome_on_the_row(db_session, handlers, case_id_for, tmp_path):
    case_id = case_id_for()
    path = tmp_path / "table.csv"
    path.write_text("a,b\n1,2\n3,4\n")

    row = ingest_service.record(db_session, case_id=case_id, path=path)
    row.stored_path = str(path)
    db_session.commit()

    result = dispatch_mod.dispatch_file(db_session, row)
    assert result.state == STATE_INDEXED
    assert row.state == STATE_INDEXED
    assert row.parsed_artifact_id == "art-1"
    assert row.error is None


def test_a_failed_row_keeps_its_reason_so_retry_is_worth_offering(
    db_session, monkeypatch, case_id_for, tmp_path
):
    def boom(db, case_id, path, filename):
        raise RuntimeError("out of memory")

    monkeypatch.setattr(dispatch_mod, "_HANDLERS", {"csv": boom})
    case_id = case_id_for()
    path = tmp_path / "big.csv"
    path.write_text("a,b\n1,2\n3,4\n")

    row = ingest_service.record(db_session, case_id=case_id, path=path)
    row.stored_path = str(path)
    db_session.commit()

    dispatch_mod.dispatch_file(db_session, row)
    assert row.state == STATE_FAILED
    assert "out of memory" in (row.error or "")


def test_a_relative_stored_path_resolves_against_its_root(
    db_session, handlers, case_id_for, tmp_path
):
    """Paths are recorded relative to a root, never absolute - see the model."""
    case_id = case_id_for()
    path = tmp_path / "relative.csv"
    path.write_text("a,b\n1,2\n3,4\n")

    row = ingest_service.record(db_session, case_id=case_id, path=path)
    row.stored_path = "relative.csv"
    db_session.commit()

    result = dispatch_mod.dispatch_file(db_session, row, base_path=tmp_path)
    assert result.state == STATE_INDEXED


# ─── The table itself ─────────────────────────────────────────────────────────

def test_every_handled_kind_has_a_route():
    """
    A handler for a kind the router does not know would parse a file into a
    destination nothing can name.
    """
    from app.services.ingest.routing import KNOWN_KINDS

    assert dispatch_mod.HANDLED_KINDS <= KNOWN_KINDS


def test_kinds_the_routers_still_own_are_absent():
    """
    Memory dumps, binaries and disk images are deliberately not handled here.
    Their routers still do that work, and wiring them in without moving it
    would parse every one of them twice.
    """
    for kind in ("memory_dump", "pe", "elf", "ewf", "vmdk", "disk_raw"):
        assert not dispatch_mod.has_handler(kind), kind
