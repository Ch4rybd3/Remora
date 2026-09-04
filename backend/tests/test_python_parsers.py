"""
The parsers written here, for what the Eric Zimmerman tools cannot do on Linux.

Prefetch is the case that mattered: PECmd needs a Windows decompression API,
and prefetch is the largest artifact class in a triage - 439 files out of 2058
in an ordinary KAPE collection. A pipeline that recognises them and parses
nothing is not a uniform pipeline.
"""
from __future__ import annotations

import csv
import sqlite3
import struct
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.services.ingest import batch, python_parsers
from app.services.ingest.python_parsers import browsers, prefetch


def _scca(version: int = 31, executable: str = "CMD.EXE", run_count: int = 3,
          last_run: datetime | None = None) -> bytes:
    """A minimal but structurally valid prefetch record."""
    data = bytearray(1024)
    struct.pack_into("<I", data, 0, version)
    data[4:8] = b"SCCA"
    struct.pack_into("<I", data, 0x0C, len(data))
    name = executable.encode("utf-16-le")[:56]
    data[0x10:0x10 + len(name)] = name
    struct.pack_into("<I", data, 0x4C, 0x0BD30981)

    filenames = "\\VOLUME{01}\\WINDOWS\\SYSTEM32\\NTDLL.DLL\x00".encode("utf-16-le")
    struct.pack_into("<II", data, 0x64, 0x200, len(filenames))
    data[0x200:0x200 + len(filenames)] = filenames

    struct.pack_into("<III", data, 0x6C, 0x300, 1, 96)

    moment = last_run or datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    ticks = int((moment - datetime(1601, 1, 1, tzinfo=UTC)) / timedelta(microseconds=1)) * 10
    struct.pack_into("<Q", data, 0x80, ticks)
    struct.pack_into("<I", data, 0xD0, run_count)
    return bytes(data)


# ─── Prefetch ─────────────────────────────────────────────────────────────────

def test_an_uncompressed_record_is_read(tmp_path: Path):
    path = tmp_path / "CMD.EXE-0BD30981.pf"
    path.write_bytes(_scca())

    result = prefetch.parse(path)
    assert result.executable == "CMD.EXE"
    assert result.run_count == 3
    assert result.path_hash == "0BD30981"
    assert result.version_name == "Windows 11"
    assert result.run_times[0].year == 2026


def test_windows_7_puts_the_run_count_somewhere_else(tmp_path: Path):
    """
    Version 23 carries one run time and the count at 0x98; everything later
    carries eight and puts it at 0xD0. Reading a Windows 7 record with the
    modern offsets returns a plausible-looking number from the wrong field.
    """
    data = bytearray(_scca(version=23))
    struct.pack_into("<I", data, 0xD0, 999)      # where a modern reader looks
    struct.pack_into("<I", data, 0x98, 7)        # where version 23 keeps it
    path = tmp_path / "OLD.EXE-11111111.pf"
    path.write_bytes(bytes(data))

    assert prefetch.parse(path).run_count == 7


def test_an_unsupported_version_is_refused(tmp_path: Path):
    data = bytearray(_scca())
    struct.pack_into("<I", data, 0, 99)
    path = tmp_path / "future.pf"
    path.write_bytes(bytes(data))

    with pytest.raises(prefetch.PrefetchError, match="version"):
        prefetch.parse(path)


def test_something_that_is_not_prefetch_is_refused(tmp_path: Path):
    path = tmp_path / "notreally.pf"
    path.write_bytes(b"\x00" * 512)
    with pytest.raises(prefetch.PrefetchError, match="SCCA"):
        prefetch.parse(path)


def test_an_empty_run_time_slot_is_not_a_date(tmp_path: Path):
    """
    Unused slots are zero, and a Windows FILETIME of zero is the year 1601.
    Emitting it would put a fiction at the start of every timeline.
    """
    path = tmp_path / "ONCE.EXE-22222222.pf"
    path.write_bytes(_scca())
    assert len(prefetch.parse(path).run_times) == 1


def test_the_output_is_two_tables(tmp_path: Path):
    """
    A summary, and one row per loaded file. Split because "what else loaded
    this DLL" is a filter, not a text search through a joined cell.
    """
    path = tmp_path / "CMD.EXE-0BD30981.pf"
    path.write_bytes(_scca())

    written = prefetch.write_csv([prefetch.parse(path)], {}, tmp_path / "out")
    names = {p.name for p in written}
    assert names == {"prefetch.csv", "prefetch_files_loaded.csv"}

    loaded = list(csv.DictReader((tmp_path / "out" / "prefetch_files_loaded.csv").open()))
    assert any("NTDLL.DLL" in row["LoadedFile"] for row in loaded)


def test_a_file_that_failed_still_gets_a_row(tmp_path: Path):
    """
    An artifact that vanishes between the folder and the table is worse than
    one that says it could not be read.
    """
    written = prefetch.write_csv([], {"BROKEN.pf": "PrefetchError: truncated"},
                                 tmp_path / "out")
    rows = list(csv.DictReader(written[0].open()))
    assert rows[0]["SourceFilename"] == "BROKEN.pf"
    assert "truncated" in rows[0]["ParseError"]


# ─── Browsers ─────────────────────────────────────────────────────────────────

def _chromium_history(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
                           visit_count INTEGER, typed_count INTEGER);
        CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER,
                             visit_time INTEGER, transition INTEGER);
        CREATE TABLE downloads (id INTEGER PRIMARY KEY, tab_url TEXT,
                                target_path TEXT, start_time INTEGER,
                                end_time INTEGER, received_bytes INTEGER,
                                total_bytes INTEGER, state INTEGER,
                                danger_type INTEGER);
    """)
    connection.execute("INSERT INTO urls VALUES (1,'http://evil.test/a','Evil',4,1)")
    # 2026-08-25, in Chromium's microseconds-since-1601.
    ticks = int((datetime(2026, 8, 25, tzinfo=UTC)
                 - datetime(1601, 1, 1, tzinfo=UTC)).total_seconds() * 1_000_000)
    connection.execute("INSERT INTO visits VALUES (1,1,?,805306368)", (ticks,))
    connection.execute(
        "INSERT INTO downloads VALUES (1,'http://evil.test/x.exe','C:\\\\x.exe',?,?,10,10,1,0)",
        (ticks, ticks))
    connection.commit()
    connection.close()


def _firefox_places(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT,
                                 visit_count INTEGER, typed INTEGER);
        CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER,
                                        visit_date INTEGER, visit_type INTEGER);
    """)
    connection.execute("INSERT INTO moz_places VALUES (1,'http://other.test/','Other',2,0)")
    unix = int(datetime(2026, 8, 26, tzinfo=UTC).timestamp() * 1_000_000)
    connection.execute("INSERT INTO moz_historyvisits VALUES (1,1,?,1)", (unix,))
    connection.commit()
    connection.close()


def test_two_browsers_land_in_one_table(tmp_path: Path):
    """
    The whole value of this parser. An analyst asking "was this URL visited"
    should not have to ask it once per product - so the browser is a column,
    not a filename.
    """
    chrome = tmp_path / "Default" / "History"
    chrome.parent.mkdir()
    _chromium_history(chrome)
    firefox = tmp_path / "xyz.default-release" / "places.sqlite"
    firefox.parent.mkdir()
    _firefox_places(firefox)

    written = browsers.parse_all([chrome, firefox], tmp_path / "out", tmp_path / "s")
    history = next(p for p in written if p.name == "browser_history.csv")
    rows = list(csv.DictReader(history.open()))

    assert {row["Browser"] for row in rows} == {"Chromium", "Firefox"}
    assert {row["URL"] for row in rows} == {"http://evil.test/a", "http://other.test/"}


def test_the_two_epochs_are_read_correctly(tmp_path: Path):
    """
    Chromium counts microseconds from 1601 and Firefox from 1970. Reading one
    with the other's epoch puts a 2026 visit in 1601 or 2432 - plausible enough
    to go unnoticed in a table and useless in a timeline.
    """
    chrome = tmp_path / "Default" / "History"
    chrome.parent.mkdir()
    _chromium_history(chrome)
    firefox = tmp_path / "p.default" / "places.sqlite"
    firefox.parent.mkdir()
    _firefox_places(firefox)

    written = browsers.parse_all([chrome, firefox], tmp_path / "out", tmp_path / "s")
    rows = list(csv.DictReader(
        next(p for p in written if p.name == "browser_history.csv").open()))
    for row in rows:
        assert row["VisitTime"].startswith("2026-08-2"), row


def test_the_profile_is_reported(tmp_path: Path):
    """A machine with three profiles produces three histories, not one."""
    chrome = tmp_path / "Profile 2" / "History"
    chrome.parent.mkdir()
    _chromium_history(chrome)

    written = browsers.parse_all([chrome], tmp_path / "out", tmp_path / "s")
    rows = list(csv.DictReader(
        next(p for p in written if p.name == "browser_history.csv").open()))
    assert rows[0]["Profile"] == "Profile 2"


def test_downloads_are_their_own_table(tmp_path: Path):
    chrome = tmp_path / "Default" / "History"
    chrome.parent.mkdir()
    _chromium_history(chrome)

    written = browsers.parse_all([chrome], tmp_path / "out", tmp_path / "s")
    assert any(p.name == "browser_downloads.csv" for p in written)


def test_no_password_column_exists_anywhere():
    """
    Saved credentials are encrypted blobs, and decrypting them is a decision
    about the investigation rather than a parsing step. The metadata answers
    the questions; the secret is not read.
    """
    assert "Password" not in browsers.LOGIN_COLUMNS
    assert "password_value" not in browsers.CHROMIUM_LOGINS.sql


def test_the_original_database_is_never_opened(tmp_path: Path):
    """
    SQLite replays the write-ahead log on open, which writes. Doing that to
    evidence would modify it; skipping the log would silently lose the most
    recent session. So the database is copied first.
    """
    chrome = tmp_path / "Default" / "History"
    chrome.parent.mkdir()
    _chromium_history(chrome)
    before = chrome.stat().st_mtime_ns

    browsers.parse_all([chrome], tmp_path / "out", tmp_path / "s")
    assert chrome.stat().st_mtime_ns == before


def test_a_schema_that_moved_on_loses_one_table_not_the_file(tmp_path: Path):
    chrome = tmp_path / "Default" / "History"
    chrome.parent.mkdir()
    connection = sqlite3.connect(chrome)
    connection.execute("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT)")
    connection.commit()
    connection.close()

    # No `visits` table: history is skipped rather than raising.
    assert browsers.parse_all([chrome], tmp_path / "out", tmp_path / "s") == []


# ─── The batch stage ──────────────────────────────────────────────────────────

def test_prefetch_is_grouped_rather_than_parsed_one_by_one(tmp_path: Path):
    """
    Four hundred prefetch files are one table, not four hundred. Parsed
    individually they are technically complete and completely unusable.
    """
    for index in range(5):
        (tmp_path / f"APP{index}.EXE-0BD3098{index}.pf").write_bytes(
            _scca(executable=f"APP{index}.EXE"))

    grouped = batch.group_by_kind(tmp_path)
    assert len(grouped["prefetch"]) == 5

    written = python_parsers.parser_for("prefetch").run(
        grouped["prefetch"], tmp_path / "out", tmp_path / "s")
    summary = next(p for p in written if p.name == "prefetch.csv")
    assert len(list(csv.DictReader(summary.open()))) == 5


def test_every_batch_kind_has_a_route():
    """
    The same drift check the Eric Zimmerman table gets. A kind with a parser
    and no route would be parsed into a destination nothing can name.
    """
    from app.services.ingest.routing import KNOWN_KINDS

    assert python_parsers.HANDLED_KINDS <= KNOWN_KINDS


def test_the_batch_stage_ignores_processed_folders(tmp_path: Path):
    """
    `.processed/` holds originals already ingested. Parsing them again would
    duplicate every row in the collection.
    """
    (tmp_path / ".processed").mkdir()
    (tmp_path / ".processed" / "OLD.EXE-33333333.pf").write_bytes(_scca())
    (tmp_path / "NEW.EXE-44444444.pf").write_bytes(_scca())

    assert len(batch.group_by_kind(tmp_path)["prefetch"]) == 1
