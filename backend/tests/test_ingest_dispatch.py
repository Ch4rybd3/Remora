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

    def explorer(ctx):
        calls.append(("explorer", ctx.filename))
        return dispatch_mod.ParseResult(STATE_INDEXED, artifact_id="art-1", row_count=42)

    def logs(ctx):
        calls.append(("logs", ctx.filename))
        return dispatch_mod.ParseResult(STATE_PARSED)

    def mail(ctx):
        calls.append(("mail", ctx.filename))
        return dispatch_mod.ParseResult(STATE_INDEXED, row_count=1)

    def pcap(ctx):
        calls.append(("pcap", ctx.filename))
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

def test_a_kind_with_no_handler_says_what_is_missing(db_session, handlers, tmp_path):
    """
    A registry hive is recognised and deliberately not parsed: which keys
    matter is an analyst's decision, not a default. The row says so, rather
    than showing a failure indistinguishable from a corrupt file.
    """
    path = tmp_path / "SYSTEM"
    path.write_bytes(HIVE)

    result = dispatch_mod.parse(db_session, case_id="c1", path=path, filename="SYSTEM")
    assert result.state == STATE_UNSUPPORTED
    assert "which keys matter" in (result.error or "")
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
    def boom(ctx):
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
    def boom(ctx):
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

    assert dispatch_mod.handled_kinds() <= KNOWN_KINDS


def test_kinds_the_routers_still_own_are_absent():
    """
    Memory dumps, binaries and disk images are deliberately not handled here.
    Their routers still do that work, and wiring them in without moving it
    would parse every one of them twice.
    """
    for kind in ("memory_dump", "pe", "elf", "ewf", "vmdk", "disk_raw"):
        assert not dispatch_mod.has_handler(kind), kind


# ─── Kinds that need a person ─────────────────────────────────────────────────

def test_a_crash_dump_says_which_os_so_it_can_be_parsed(db_session, monkeypatch, tmp_path):
    """
    A Windows crash dump and a LiME image are self-describing; a raw dump is
    not. Splitting them by signature is what lets two of the three be handled
    without asking the analyst anything.
    """
    seen: list[str] = []

    def memory(ctx):
        seen.append(ctx.filename)
        return dispatch_mod.ParseResult(STATE_PARSED)

    monkeypatch.setattr(dispatch_mod, "_HANDLERS", {
        "memory_dump_windows": memory, "memory_dump_linux": memory,
    })

    win = tmp_path / "crash.bin"
    win.write_bytes(b"PAGEDU64" + b"\x00" * 128)
    assert dispatch_mod.parse(db_session, case_id="c1", path=win,
                              filename="crash.bin").state == STATE_PARSED

    lime = tmp_path / "capture.bin"
    lime.write_bytes(b"EMiL" + b"\x00" * 128)
    assert dispatch_mod.parse(db_session, case_id="c1", path=lime,
                              filename="capture.bin").state == STATE_PARSED

    assert seen == ["crash.bin", "capture.bin"]


def test_a_raw_dump_says_what_to_do_instead_of_no_parser(db_session, tmp_path):
    """
    Guessing the OS would queue the wrong Volatility plugins and produce
    confident wrong output. Saying so on the row beats a generic refusal.
    """
    path = tmp_path / "memdump.raw"
    path.write_bytes(b"\x00\x11\x22\x33" * 64)

    result = dispatch_mod.parse(db_session, case_id="c1", path=path,
                                filename="memdump.raw")
    assert result.state == STATE_UNSUPPORTED
    assert "which OS" in (result.error or "")
    assert "Memory page" in (result.error or "")


def test_a_binary_explains_the_password_it_cannot_be_given(db_session, tmp_path):
    head = bytearray(b"\x00" * 512)
    head[0:2]       = b"MZ"
    head[0x3C:0x40] = (0x80).to_bytes(4, "little")
    head[0x80:0x84] = b"PE\x00\x00"
    path = tmp_path / "dropper.exe"
    path.write_bytes(bytes(head))

    result = dispatch_mod.parse(db_session, case_id="c1", path=path,
                                filename="dropper.exe")
    assert result.state == STATE_UNSUPPORTED
    assert "password" in (result.error or "")


def test_a_disk_image_explains_that_it_is_read_in_place(db_session, tmp_path):
    path = tmp_path / "acquisition.E01"
    path.write_bytes(b"EVF\x09\x0d\x0a\xff\x00" + b"\x00" * 128)

    result = dispatch_mod.parse(db_session, case_id="c1", path=path,
                                filename="acquisition.E01")
    assert result.state == STATE_UNSUPPORTED
    assert "read in place" in (result.error or "")
