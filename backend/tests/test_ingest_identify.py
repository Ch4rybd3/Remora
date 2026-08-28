"""
Identification tests.

The point of the whole pipeline is that a file is what its bytes say it is, so
these tests are written around that claim: every artifact is checked with a
deliberately wrong name, and text formats are checked with no name at all.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.models.ingest import (
    DETECTED_BY_CONTENT,
    DETECTED_BY_EXTENSION,
    DETECTED_BY_HINT,
    DETECTED_BY_MAGIC,
)
from app.services.ingest.identify import identify, identify_bytes


def _pad(head: bytes, size: int = 512) -> bytes:
    """Pad a signature out to a realistic header length."""
    return head + b"\x00" * max(0, size - len(head))


# ─── Signatures beat names ────────────────────────────────────────────────────

@pytest.mark.parametrize("head,expected", [
    (b"ElfFile\x00" + b"\x00" * 32,                  "evtx"),
    (b"regf" + b"\x00" * 32,                         "registry_hive"),
    (b"FILE0" + b"\x00" * 32,                        "mft"),
    (b"FILE*" + b"\x00" * 32,                        "mft"),
    (b"\x11\x00\x00\x00SCCA" + b"\x00" * 32,         "prefetch"),
    (b"MAM\x04" + b"\x00" * 32,                      "prefetch"),
    (b"\x4c\x00\x00\x00\x01\x14\x02\x00" + b"\x00" * 16, "lnk"),
    (b"SQLite format 3\x00" + b"\x00" * 32,          "sqlite"),
    (b"\x00\x00\x00\x00\xef\xcd\xab\x89" + b"\x00" * 16, "ese"),
    (b"\xd4\xc3\xb2\xa1" + b"\x00" * 32,             "pcap"),
    (b"\x0a\x0d\x0d\x0a" + b"\x00" * 32,             "pcapng"),
    (b"EVF\x09\x0d\x0a\xff\x00" + b"\x00" * 16,      "ewf"),
    (b"vhdxfile" + b"\x00" * 32,                     "vhdx"),
    (b"QFI\xfb" + b"\x00" * 32,                      "qcow"),
    (b"PAGEDU64" + b"\x00" * 32,                     "memory_dump_windows"),
    (b"\x7fELF" + b"\x00" * 32,                      "elf"),
    (b"7z\xbc\xaf\x27\x1c" + b"\x00" * 32,           "archive_7z"),
    (b"PK\x03\x04" + b"\x00" * 32,                   "archive_zip"),
    (b"%PDF-1.7" + b"\x00" * 32,                     "pdf"),
])
def test_signature_wins_over_a_wrong_extension(head: bytes, expected: str):
    """
    An artifact renamed `.txt` is still that artifact.

    This is the whole reason the pipeline exists: the previous detection matched
    on filename and got every one of these wrong.
    """
    found = identify_bytes(head, "innocent.txt")
    assert found.kind == expected
    assert found.source == DETECTED_BY_MAGIC
    assert found.is_certain


def test_tar_signature_sits_at_offset_257():
    head = b"somefile.txt" + b"\x00" * 245 + b"ustar\x0000" + b"\x00" * 128
    assert identify_bytes(head, "x.bin").kind == "archive_tar"


# ─── Containers refined by name ───────────────────────────────────────────────

@pytest.mark.parametrize("head,name,expected", [
    (b"SQLite format 3\x00" + b"\x00" * 32, "ActivitiesCache.db", "windows_timeline"),
    (b"SQLite format 3\x00" + b"\x00" * 32, "unknown.db",         "sqlite"),
    (b"\x00\x00\x00\x00\xef\xcd\xab\x89" + b"\x00" * 16, "SRUDB.dat", "srum"),
    (b"\x00\x00\x00\x00\xef\xcd\xab\x89" + b"\x00" * 16, "ntds.dit",  "ntds"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 16, "invoice.msg", "msg"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 16,
     "5f7b5f1e01b83767.automaticDestinations-ms", "jumplist_auto"),
])
def test_container_signatures_are_refined_by_name(head: bytes, name: str, expected: str):
    """
    SQLite, ESE and OLE compound files are containers, not artifacts.

    Their signature says which container; only the name says which artifact.
    A KAPE collection prefixes the machine name onto the file, so matching is
    a substring rather than an equality.
    """
    found = identify_bytes(head, name)
    assert found.kind == expected
    assert found.source == DETECTED_BY_MAGIC


def test_kape_prefixed_name_still_resolves():
    head = b"\x00\x00\x00\x00\xef\xcd\xab\x89" + b"\x00" * 16
    assert identify_bytes(head, "WKSTN01_20260828_SRUDB.dat").kind == "srum"


# ─── The PE validator ─────────────────────────────────────────────────────────

def test_a_real_pe_is_identified():
    head = bytearray(b"\x00" * 512)
    head[0:2]       = b"MZ"
    head[0x3C:0x40] = (0x80).to_bytes(4, "little")
    head[0x80:0x84] = b"PE\x00\x00"
    assert identify_bytes(bytes(head), "sample.exe").kind == "pe"


def test_a_csv_whose_first_column_is_mz_is_not_a_pe():
    """
    `MZ` is two bytes, which real data satisfies by accident.

    Without the NT-header check this row would be filed as an executable and
    sent to Binary Analysis instead of the Explorer.
    """
    found = identify_bytes(b"MZ,Timestamp,User\n1,2026-01-01,alice\n", "table.csv")
    assert found.kind == "csv"


# ─── Text shapes ──────────────────────────────────────────────────────────────

def test_csv_needs_two_consistent_lines():
    found = identify_bytes(b"a,b,c\n1,2,3\n4,5,6\n", "nameless")
    assert found.kind == "csv"
    assert found.source == DETECTED_BY_CONTENT


def test_one_line_with_commas_is_not_a_csv():
    """A single line proves nothing - a log line contains commas too."""
    found = identify_bytes(b"2026-01-01 12:00:00 ERROR failed to open, retrying\n", "app")
    assert found.kind != "csv"


def test_json_document_and_json_lines_are_told_apart():
    assert identify_bytes(b'{"a": 1, "b": [2, 3]}', "x").kind == "json"
    assert identify_bytes(b'{"a":1}\n{"a":2}\n{"a":3}\n', "x").kind == "jsonl"
    assert identify_bytes(b'[{"a": 1}, {"a": 2}]', "x").kind == "json"


def test_a_json_array_is_not_read_as_a_csv_header():
    found = identify_bytes(b'[\n  {"user": "alice", "id": 1},\n  {"user": "bob", "id": 2}\n]', "x")
    assert found.kind == "json"


def test_mail_headers_are_recognised_without_an_extension():
    raw = (b"Received: from mx.example.com\r\n"
           b"From: attacker@example.com\r\n"
           b"Subject: invoice\r\n\r\nbody\r\n")
    assert identify_bytes(raw, "message").kind == "eml"


def test_utf16_text_reads_as_binary_not_text():
    """
    A NUL byte disqualifies text before any decode is attempted.

    UTF-16 is full of them, and treating it as UTF-8 text would split it on the
    wrong bytes and produce a table of garbage.
    """
    raw = "col_a,col_b\n1,2\n".encode("utf-16-le")
    assert identify_bytes(raw, "export.bin").kind != "csv"


# ─── Names, hints and the fallback ────────────────────────────────────────────

@pytest.mark.parametrize("name,expected", [
    ("$MFT",        "mft"),
    ("$J",          "usnjrnl"),
    ("NTUSER.DAT",  "registry_hive"),
    ("SYSTEM",      "registry_hive"),
    ("UsrClass.dat", "registry_hive"),
    ("pagefile.sys", "pagefile"),
])
def test_extensionless_forensic_names_are_recognised(name: str, expected: str):
    """
    NTFS metadata and registry hives arrive with no usable suffix.

    A `$MFT` that has been carved may not carry its FILE record at offset 0, so
    the name is the only handle left - recorded as an `extension` guess, which
    is what lets an analyst override it.
    """
    found = identify_bytes(b"\xab\xcd" + b"\x00" * 64, name)
    assert found.kind == expected
    assert found.source == DETECTED_BY_EXTENSION


def test_a_folder_hint_only_applies_when_nothing_else_did():
    unreadable = b"\xff\xfe\xab\xcd" + b"\x11" * 64
    assert identify_bytes(unreadable, "blob", folder_hint="evtx").kind == "evtx"
    assert identify_bytes(unreadable, "blob", folder_hint="evtx").source == DETECTED_BY_HINT


def test_a_folder_hint_never_overrides_a_signature():
    """
    Dropping a PCAP into `evtx/` is a mistake, and the bytes outrank it.

    An analyst under time pressure drops into the wrong sub-folder; the hint is
    documented as a tie-breaker precisely so that costs nothing.
    """
    found = identify_bytes(_pad(b"\xd4\xc3\xb2\xa1"), "capture", folder_hint="evtx")
    assert found.kind == "pcap"
    assert found.source == DETECTED_BY_MAGIC


def test_nothing_matched_is_unknown_not_an_exception():
    found = identify_bytes(b"\xff\xfe\xab\xcd" + b"\x99" * 64, "mystery")
    assert found.kind == "unknown"
    assert not found.is_certain


# ─── Filesystem behaviour ─────────────────────────────────────────────────────

def test_identify_reads_from_disk(tmp_path: Path):
    p = tmp_path / "Security.evtx"
    p.write_bytes(b"ElfFile\x00" + b"\x00" * 128)
    assert identify(p).kind == "evtx"


def test_an_empty_file_is_a_state_not_a_crash(tmp_path: Path):
    p = tmp_path / "empty.csv"
    p.write_bytes(b"")
    found = identify(p)
    assert found.kind == "empty"


def test_an_unreadable_file_is_unknown_not_a_crash(tmp_path: Path):
    assert identify(tmp_path / "does-not-exist.evtx").kind == "unknown"


def test_the_staged_upload_name_can_be_overridden(tmp_path: Path):
    """
    An upload is staged under a UUID in `.incoming/`, so the on-disk name is
    meaningless. Identification has to be told the name the analyst chose, or
    every container format would fail to resolve.
    """
    p = tmp_path / "8f14e45f-ea8f-4b1a-9f2c-000000000000"
    p.write_bytes(b"\x00\x00\x00\x00\xef\xcd\xab\x89" + b"\x00" * 64)
    assert identify(p).kind == "ese"
    assert identify(p, name="SRUDB.dat").kind == "srum"


# ─── Memory formats ───────────────────────────────────────────────────────────

def test_an_elf_core_dump_is_memory_not_a_binary():
    """
    Both open with `\\x7fELF`.

    Without the `e_type` check a Linux memory image captured as a core dump is
    filed as a binary and sent to Binary Analysis, which encrypts it under a
    password and asks nobody about Volatility.
    """
    head = bytearray(b"\x00" * 128)
    head[0:4]       = b"\x7fELF"
    head[0x10:0x12] = (4).to_bytes(2, "little")     # ET_CORE
    assert identify_bytes(bytes(head), "core.1234").kind == "memory_dump_linux"


def test_an_elf_executable_is_still_a_binary():
    head = bytearray(b"\x00" * 128)
    head[0:4]       = b"\x7fELF"
    head[0x10:0x12] = (2).to_bytes(2, "little")     # ET_EXEC
    assert identify_bytes(bytes(head), "sample").kind == "elf"


@pytest.mark.parametrize("head,expected", [
    (b"PAGEDU64" + b"\x00" * 64,        "memory_dump_windows"),
    (b"PAGEDUMP" + b"\x00" * 64,        "memory_dump_windows"),
    (b"EMiL"     + b"\x00" * 64,        "memory_dump_linux"),
    (b"hibr"     + b"\x00" * 64,        "hiberfil"),
    (b"WAKE"     + b"\x00" * 64,        "hiberfil"),
    (b"\xd2\xbe\xd2\xbe" + b"\x00" * 64, "memory_dump"),
])
def test_memory_formats_are_recognised(head: bytes, expected: str):
    assert identify_bytes(head, "acquisition.bin").kind == expected


def test_a_raw_dump_has_no_signature_and_falls_back_to_its_name():
    """
    Raw and dd-style images carry nothing at all. The name is the only handle,
    and the resulting kind is the one that has to ask the analyst for an OS.
    """
    found = identify_bytes(b"\x00\x11\x22\x33" * 64, "memdump.raw")
    assert found.kind in {"memory_dump", "disk_raw"}
    assert found.source == DETECTED_BY_EXTENSION
