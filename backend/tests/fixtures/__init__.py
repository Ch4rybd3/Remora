"""
A sample of every artifact kind, built rather than checked in.

The precedent is `hive_builder.py`: there is no small registry hive to commit -
a real one is megabytes and carries somebody's machine in it - so the tests
build the smallest genuinely well-formed one instead. The same reasoning covers
every kind here. A DFIR product's test corpus must not be somebody's evidence.

What each fixture is: the **smallest byte sequence that a real tool would
accept as that format**, and no more. These are enough to prove identification,
routing and dispatch, and deliberately not enough to prove a parser's output -
a parser needs real content, and its own tests carry it.

Two registries, and the second matters as much as the first:

* `FIXTURES` - kinds a sample can be synthesised for.
* `NO_FIXTURE` - kinds it cannot, each saying why.

`test_fixtures.py` asserts their union is exactly the catalogue. So a parser
added without a sample fails as "this kind has neither a fixture nor a stated
reason", which is the question somebody would otherwise have to remember to
ask.
"""
from __future__ import annotations

import gzip
import io
import lzma
import sqlite3
import struct
import tarfile
import zipfile
from collections.abc import Callable
from dataclasses import dataclass

# ─── Building blocks ──────────────────────────────────────────────────────────

def _pad(head: bytes, size: int = 512) -> bytes:
    """Magic followed by filler, which is all identification reads."""
    return head + b"\x00" * max(0, size - len(head))


def _utf16(text: str) -> bytes:
    return text.encode("utf-16-le")


def _pe() -> bytes:
    """
    A DOS header whose `e_lfanew` points at a real `PE\\0\\0`.

    Two bytes of `MZ` are not enough: `_valid_pe` follows the offset at 0x3C,
    precisely so a CSV whose first column is named `MZ` is not filed as an
    executable.
    """
    nt_offset = 0x80
    head = bytearray(_pad(b"MZ", 0x100))
    head[0x3C:0x40] = struct.pack("<I", nt_offset)
    head[nt_offset:nt_offset + 4] = b"PE\x00\x00"
    return bytes(head)


def _elf(e_type: int) -> bytes:
    """An ELF header with `e_type` set. 2 is ET_EXEC, 4 is ET_CORE."""
    head = bytearray(_pad(b"\x7fELF\x02\x01\x01", 0x40))
    head[0x10:0x12] = struct.pack("<H", e_type)
    return bytes(head)


def _recycle_bin_v2(path: str = "C:\\Users\\analyst\\payload.exe") -> bytes:
    """
    A `$I` record whose own fields agree.

    `_valid_recycle_bin` exists because these files carry a version number
    where other formats carry a magic, and the declared path length is the only
    thing that makes the claim trustworthy. A fixture that did not add up would
    be testing the wrong branch.
    """
    encoded    = _utf16(path) + b"\x00\x00"
    characters = len(encoded) // 2
    return (
        struct.pack("<Q", 2)                 # version
        + struct.pack("<Q", 4096)            # deleted size
        + struct.pack("<Q", 133_000_000_000_000_000)  # FILETIME
        + struct.pack("<I", characters)
        + encoded
    )


_TASK_XML = (
    '<?xml version="1.0" encoding="UTF-16"?>'
    '<Task version="1.2" '
    'xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">'
    "<Actions><Exec><Command>C:\\Windows\\System32\\cmd.exe</Command>"
    "<Arguments>/c whoami</Arguments></Exec></Actions>"
    "</Task>"
)


def _scheduled_task() -> bytes:
    """UTF-16 with a BOM, declaring the Task schema the validator looks for."""
    return b"\xff\xfe" + _utf16(_TASK_XML)


def _sqlite(table: str = "urls") -> bytes:
    """A real SQLite file, built by SQLite, so the header is never a guess."""
    buffer = io.BytesIO()
    connection = sqlite3.connect(":memory:")
    connection.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, value TEXT)")
    connection.execute(f"INSERT INTO {table} (value) VALUES ('https://example.invalid')")
    connection.commit()
    for line in connection.iterdump():
        _ = line
    # `iterdump` gives SQL, not bytes. Serialize gives the file itself.
    buffer.write(connection.serialize())
    connection.close()
    return buffer.getvalue()


def _zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("triage/hosts.csv", "Timestamp,Host\n2026-01-01T00:00:00,WKS-042\n")
    return buffer.getvalue()


def _tar() -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        payload = b"Timestamp,Host\n2026-01-01T00:00:00,WKS-042\n"
        info = tarfile.TarInfo("triage/hosts.csv")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
    return buffer.getvalue()


def _pcap() -> bytes:
    """A libpcap file header and one truncated record. No packet payload."""
    return (
        struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 1)
        + struct.pack("<IIII", 1767225600, 0, 4, 4)
        + b"\x00\x00\x00\x00"
    )


def _pcapng() -> bytes:
    """A Section Header Block, which is what a PCAPNG must open with."""
    return struct.pack("<IIIiI", 0x0A0D0D0A, 28, 0x1A2B3C4D, -1, 28)


_EML = (
    "From: attacker@example.invalid\r\n"
    "To: analyst@example.invalid\r\n"
    "Subject: Invoice 4471\r\n"
    "Date: Thu, 01 Jan 2026 00:00:00 +0000\r\n"
    "Message-ID: <fixture@example.invalid>\r\n"
    "Content-Type: text/plain; charset=utf-8\r\n"
    "\r\n"
    "Please review the attached invoice.\r\n"
)


def _registry_hive() -> bytes:
    """Delegates to the builder the Registry Explorer tests already use."""
    from tests.hive_builder import sample

    return sample()


# ─── The registry ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Fixture:
    kind:     str
    #: The name it must be written under. Several kinds are recognised by name
    #: alone, and for the rest the extension still has to not contradict.
    filename: str
    build:    Callable[[], bytes]
    #: The name is load-bearing. Two reasons reach this: there is no signature
    #: at all (a CSV), or the signature identifies only the *container* and the
    #: name says which artifact is inside it (an OLECF is a .msg or a jump list;
    #: a SQLite is browser history or the Windows Timeline). Either way the file
    #: cannot be identified once staged under a UUID.
    needs_name: bool = False

    def bytes(self) -> bytes:
        return self.build()


def _f(kind: str, filename: str, build: Callable[[], bytes],
       needs_name: bool = False) -> Fixture:
    return Fixture(kind=kind, filename=filename, build=build, needs_name=needs_name)


FIXTURES: dict[str, Fixture] = {f.kind: f for f in (
    # ── Already tabular ──────────────────────────────────────────────────────
    _f("csv",   "processes.csv",
       lambda: b"Timestamp,Process,PID\n2026-01-01T10:00:00,cmd.exe,1042\n", needs_name=True),
    _f("json",  "meta.json",  lambda: b'{"host": "WKS-042"}', needs_name=True),
    # Two objects, not one: JSON Lines is told from a JSON document by a `{`
    # starting a second line, which is the difference between a stream and a
    # document and therefore between two readers.
    _f("jsonl", "events.jsonl",
       lambda: b'{"ts": "2026-01-01T10:00:00", "id": 4624}\n'
               b'{"ts": "2026-01-01T10:00:05", "id": 4688}\n', needs_name=True),
    _f("text",  "notes.txt",  lambda: b"Collected 2026-01-01 by the responder.\n", needs_name=True),
    _f("log",   "agent.log",  lambda: b"2026-01-01 10:00:00 INFO started\n", needs_name=True),
    _f("xml",   "report.xml", lambda: b"<?xml version='1.0'?><report/>", needs_name=True),

    # ── Windows event logs ───────────────────────────────────────────────────
    _f("evtx", "Security.evtx", lambda: _pad(b"ElfFile\x00", 4096)),
    _f("evt",  "AppEvent.evt",  lambda: _pad(b"LfLe")),

    # ── Registry ─────────────────────────────────────────────────────────────
    _f("registry_hive", "SYSTEM",     _registry_hive),
    _f("registry_log",  "SYSTEM.LOG1", lambda: _pad(b"HvLE")),

    # ── NTFS metadata ────────────────────────────────────────────────────────
    _f("mft",          "$MFT",     lambda: _pad(b"FILE0", 1024)),
    _f("usnjrnl",      "$J",       lambda: _pad(b"", 1024), needs_name=True),
    _f("ntfs_logfile", "$LogFile", lambda: _pad(b"", 1024), needs_name=True),
    _f("ntfs_secure",  "$Secure",  lambda: _pad(b"", 1024), needs_name=True),

    # ── Execution ────────────────────────────────────────────────────────────
    _f("prefetch",        "CMD.EXE-1234ABCD.pf", lambda: _pad(b"\x11\x00\x00\x00SCCA")),
    _f("lnk",             "payload.lnk",
       lambda: _pad(b"\x4c\x00\x00\x00\x01\x14\x02\x00")),
    _f("recycle_bin",     "$IZJNHSA.exe",        _recycle_bin_v2),
    _f("scheduled_task",  "UpdateTask",          _scheduled_task),
    _f("rdp_bitmap_cache", "Cache0000.bin",      lambda: _pad(b"RDP8bmp\x00")),

    # ── Containers behind several artifacts ──────────────────────────────────
    _f("sqlite",          "app.db",              _sqlite),
    _f("ese",             "generic.edb",         lambda: _pad(b"\x00\x00\x00\x00\xef\xcd\xab\x89")),
    _f("olecf",           "container.bin",
       lambda: _pad(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")),
    # The five below share a container signature with something else, so the
    # name is what says which artifact it is. `_CONTAINER_REFINEMENTS` is the
    # table that does it.
    _f("msg",             "invoice.msg",
       lambda: _pad(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), needs_name=True),
    _f("jumplist_auto",   "5f7b5f1e01b83767.automaticDestinations-ms",
       lambda: _pad(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), needs_name=True),
    _f("browser_history", "History",  lambda: _sqlite("urls"),     needs_name=True),
    _f("browser_cookies", "Cookies",  lambda: _sqlite("cookies"),  needs_name=True),
    _f("windows_timeline", "ActivitiesCache.db",
       lambda: _sqlite("Activity"), needs_name=True),
    _f("pst",             "archive.pst",         lambda: _pad(b"!BDN")),

    # ── Captures ─────────────────────────────────────────────────────────────
    _f("pcap",   "capture.pcap",   _pcap),
    _f("pcapng", "capture.pcapng", _pcapng),

    # ── Disk images ──────────────────────────────────────────────────────────
    _f("ewf",  "acquisition.E01", lambda: _pad(b"EVF\x09\x0d\x0a\xff\x00")),
    _f("vmdk", "disk.vmdk",       lambda: _pad(b"KDMV")),
    _f("vhdx", "disk.vhdx",       lambda: _pad(b"vhdxfile")),
    _f("vhd",  "disk.vhd",        lambda: _pad(b"conectix")),
    _f("qcow", "disk.qcow2",      lambda: _pad(b"QFI\xfb")),
    _f("ad1",  "logical.ad1",     lambda: _pad(b"ADSEGMENTEDFILE\x00")),

    # ── Memory ───────────────────────────────────────────────────────────────
    _f("memory_dump_windows", "MEMORY.DMP", lambda: _pad(b"PAGEDU64")),
    _f("memory_dump_linux",   "mem.lime",   lambda: _pad(b"EMiL")),
    _f("memory_dump",         "vm.vmss",    lambda: _pad(b"\xd2\xbe\xd2\xbe")),
    _f("hiberfil",            "hiberfil.sys", lambda: _pad(b"HIBR")),

    # ── Mail ─────────────────────────────────────────────────────────────────
    _f("eml",  "phish.eml",  lambda: _EML.encode(), needs_name=True),
    _f("mbox", "inbox.mbox", lambda: b"From fixture@example.invalid Thu Jan  1 00:00:00 2026\n"
                                     + _EML.encode(), needs_name=True),

    # ── Executables ──────────────────────────────────────────────────────────
    _f("pe",    "payload.exe",   _pe),
    _f("elf",   "implant",       lambda: _elf(2)),
    _f("macho", "implant.macho", lambda: _pad(b"\xcf\xfa\xed\xfe")),

    # ── Archives ─────────────────────────────────────────────────────────────
    _f("archive_zip",   "triage.zip",     _zip),
    _f("archive_tar",   "triage.tar",     _tar),
    _f("archive_gzip",  "triage.gz",      lambda: gzip.compress(b"Timestamp,Host\n")),
    _f("archive_xz",    "triage.xz",      lambda: lzma.compress(b"Timestamp,Host\n")),
    _f("archive_7z",    "triage.7z",      lambda: _pad(b"7z\xbc\xaf\x27\x1c")),
    _f("archive_rar",   "triage.rar",     lambda: _pad(b"Rar!\x1a\x07")),
    _f("archive_bzip2", "triage.bz2",     lambda: _pad(b"BZh9")),

    # ── Held ─────────────────────────────────────────────────────────────────
    _f("pdf",     "invoice.pdf",  lambda: b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n"),
    # Zero bytes. Only `identify()` produces this - `identify_bytes` never sees
    # an empty head - so the test has to go through a real file.
    _f("empty",   "empty.dat",    lambda: b"", needs_name=True),
    # An extension nothing maps: `.bin` would be `binary_blob`, which is a
    # different answer and has its own row.
    _f("unknown", "mystery.zzz",  lambda: bytes(range(256)) * 2, needs_name=True),
    # Bytes that look like nothing, under an extension that maps to exactly
    # that. The pair with `unknown` above is the point: the same content is
    # `binary_blob` or `unknown` depending only on the name.
    _f("binary_blob", "payload.bin", lambda: bytes(range(256)) * 2, needs_name=True),
)}


#: Kinds with no fixture, and why. Read by `test_fixtures.py` alongside
#: `FIXTURES`: together they must account for every kind in the catalogue.
NO_FIXTURE: dict[str, str] = {
    "disk_raw": (
        "A raw image has no header - it is identified by a partition table or a "
        "filesystem superblock at an offset, so the smallest honest sample is a "
        "formatted volume rather than a magic number. The disk image tests build "
        "one where they need it."
    ),
    "srum": (
        "SRUDB.dat is an ESE database and ESE has no writer outside Windows. The "
        "`ese` fixture covers the container; the SRUM tables themselves need a "
        "real database, which the parser's own tests supply."
    ),
    "search_index": "Same as srum: an ESE database with no cross-platform writer.",
    "ntds": "Same as srum: an ESE database with no cross-platform writer.",
    "browser_cache": (
        "WebCacheV01.dat is ESE, not SQLite - which is the whole reason it has "
        "its own parser - so it inherits the ESE limitation above."
    ),
    "jumplist_custom": (
        "A customDestinations-ms is a run of embedded shell links terminated by a "
        "sentinel, and identification probes for the first link between two "
        "offsets that vary by Windows version. A synthesised one would pin the "
        "probe to whichever offset this file happened to choose."
    ),
    "pagefile": (
        "pagefile.sys is recognised by name and is otherwise unstructured bytes. "
        "A fixture would assert that a named file keeps its name."
    ),
}
