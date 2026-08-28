"""
What is this file, really?

Identification reads bytes, not names. A `.txt` that is actually an EVTX is
routed as an EVTX; an EVTX with no extension at all is still an EVTX. That is
the whole point — the current `ez_detection.detect()` matches on filename and
therefore gets both cases wrong.

Why a hand-written signature table rather than libmagic: libmagic answers
`application/octet-stream` for most of what a DFIR pipeline actually receives —
EVTX, registry hives, `$MFT`, prefetch, LNK, SRUDB — so it would tell us
nothing for the files that matter while adding a system package to the image.
The signatures below are drawn from the on-disk formats themselves.

Precedence, strongest first (`docs/INGESTION.md` section 5):

    forced (an analyst said so)
      > magic (a byte signature matched)
        > content (text-shape heuristics: JSON / CSV / log)
          > extension (nothing matched; the name is all we have)

A folder hint (`evtx/`, `registry/`) only breaks ties between candidates of
equal strength. It never overrides a signature.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ...models.ingest import (
    DETECTED_BY_CONTENT,
    DETECTED_BY_EXTENSION,
    DETECTED_BY_HINT,
    DETECTED_BY_MAGIC,
)

#: Bytes read from the head of the file. Large enough for the TAR signature at
#: offset 257 and for a text sample worth judging, small enough to be free.
HEADER_BYTES = 4096


@dataclass(frozen=True)
class Identification:
    kind:   str          # internal routing key, e.g. "evtx"
    label:  str          # human-readable, shown in the Collection tab
    source: str          # magic | content | extension | folder_hint | forced

    @property
    def is_certain(self) -> bool:
        """True when bytes decided it, rather than a name we chose to trust."""
        return self.source == DETECTED_BY_MAGIC


# ─── Signature table ──────────────────────────────────────────────────────────
# (offset, magic bytes, kind, label). Checked in order: put the specific before
# the general, because the first match wins and several formats share a prefix
# (an EWF segment and a plain `EVF` string, MZ and every PE variant).

_SIGNATURES: list[tuple[int, bytes, str, str]] = [
    # ── Windows event logs ───────────────────────────────────────────────────
    (0, b"ElfFile\x00",             "evtx",           "Windows Event Log (EVTX)"),
    (0, b"LfLe",                    "evt",            "Windows Event Log, legacy (EVT)"),

    # ── Registry ─────────────────────────────────────────────────────────────
    (0, b"regf",                    "registry_hive",  "Registry hive"),
    (0, b"HvLE",                    "registry_log",   "Registry transaction log"),

    # ── NTFS metadata ────────────────────────────────────────────────────────
    # An `$MFT` extracted by KAPE keeps its FILE record signature. BAAD marks a
    # record the volume itself flagged as corrupt — still an MFT, still worth
    # parsing, so it is not an error here.
    (0, b"FILE0",                   "mft",            "NTFS Master File Table ($MFT)"),
    (0, b"FILE*",                   "mft",            "NTFS Master File Table ($MFT, pre-Vista)"),
    (0, b"BAAD",                    "mft",            "NTFS Master File Table ($MFT, damaged records)"),

    # ── Execution artifacts ──────────────────────────────────────────────────
    # Prefetch carries SCCA at offset 4 up to Windows 7. From Windows 8 the file
    # is MAM-compressed and the signature moves to offset 0, which is why both
    # forms are listed rather than one loose match.
    (4, b"SCCA",                    "prefetch",       "Prefetch"),
    (0, b"MAM\x04",                 "prefetch",       "Prefetch (compressed)"),
    (0, b"\x4c\x00\x00\x00\x01\x14\x02\x00", "lnk",   "Shortcut (LNK)"),

    # ── Databases behind several artifacts ───────────────────────────────────
    # SQLite and ESE are containers, not artifacts: ActivitiesCache.db and
    # SRUDB.dat are told apart by name below, in `_refine_container`.
    (0, b"SQLite format 3\x00",     "sqlite",         "SQLite database"),
    (4, b"\xef\xcd\xab\x89",        "ese",            "ESE database (EDB)"),
    # Compound File Binary: `.msg` mail and automatic jump lists share it.
    (0, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "olecf", "OLE compound file"),
    (0, b"!BDN",                    "pst",            "Outlook store (PST/OST)"),

    # ── Captures ─────────────────────────────────────────────────────────────
    (0, b"\xd4\xc3\xb2\xa1",        "pcap",           "Packet capture (PCAP)"),
    (0, b"\xa1\xb2\xc3\xd4",        "pcap",           "Packet capture (PCAP)"),
    (0, b"\x4d\x3c\xb2\xa1",        "pcap",           "Packet capture (PCAP, nanosecond)"),
    (0, b"\xa1\xb2\x3c\x4d",        "pcap",           "Packet capture (PCAP, nanosecond)"),
    (0, b"\x0a\x0d\x0d\x0a",        "pcapng",         "Packet capture (PCAPNG)"),

    # ── Disk images ──────────────────────────────────────────────────────────
    (0, b"EVF2\x0d\x0a\x81\x00",    "ewf",            "EnCase image (Ex01)"),
    (0, b"EVF\x09\x0d\x0a\xff\x00", "ewf",            "EnCase image (E01)"),
    (0, b"LVF\x09\x0d\x0a\xff\x00", "ewf",            "Logical evidence file (L01)"),
    (0, b"KDMV",                    "vmdk",           "VMware disk (VMDK)"),
    (0, b"# Disk DescriptorFile",   "vmdk",           "VMware disk descriptor"),
    (0, b"vhdxfile",                "vhdx",           "Hyper-V disk (VHDX)"),
    (0, b"conectix",                "vhd",            "Virtual hard disk (VHD)"),
    (0, b"QFI\xfb",                 "qcow",           "QEMU disk (QCOW2)"),
    (0, b"ADSEGMENTEDFILE\x00",     "ad1",            "AccessData logical image (AD1)"),

    # ── Memory ───────────────────────────────────────────────────────────────
    (0, b"PAGEDU64",                "memory_dump_windows", "Windows crash dump (64-bit)"),
    (0, b"PAGEDUMP",                "memory_dump_windows", "Windows crash dump (32-bit)"),
    (0, b"EMiL",                    "memory_dump_linux",   "LiME memory image"),
    # hiberfil.sys. `wake` marks a file already resumed from - still readable,
    # and still the only copy of that machine's memory at suspend time.
    (0, b"hibr",                    "hiberfil",       "Windows hibernation file"),
    (0, b"HIBR",                    "hiberfil",       "Windows hibernation file"),
    (0, b"wake",                    "hiberfil",       "Windows hibernation file (resumed)"),
    (0, b"WAKE",                    "hiberfil",       "Windows hibernation file (resumed)"),
    # VMware suspend state. The guest OS is not recorded in the header, so this
    # is a raw dump as far as choosing Volatility plugins goes.
    (0, b"\xd2\xbe\xd2\xbe",        "memory_dump",    "VMware suspend state (VMSS/VMSN)"),
    (0, b"\xd3\xbe\xd3\xbe",        "memory_dump",    "VMware suspend state (VMSS/VMSN)"),

    # ── Executables ──────────────────────────────────────────────────────────
    # Checked before the executable entry: `_refine_signature` sends a core
    # dump to memory instead, and both share this signature.
    (0, b"\x7fELF",                 "elf",            "ELF executable"),
    (0, b"\xca\xfe\xba\xbe",        "macho",          "Mach-O universal binary"),
    (0, b"\xcf\xfa\xed\xfe",        "macho",          "Mach-O executable (64-bit)"),
    (0, b"\xce\xfa\xed\xfe",        "macho",          "Mach-O executable (32-bit)"),
    (0, b"MZ",                      "pe",             "Windows executable (PE)"),

    # ── Containers ───────────────────────────────────────────────────────────
    (0, b"7z\xbc\xaf\x27\x1c",      "archive_7z",     "7-Zip archive"),
    (0, b"Rar!\x1a\x07",            "archive_rar",    "RAR archive"),
    (0, b"\xfd7zXZ\x00",            "archive_xz",     "XZ archive"),
    (0, b"\x1f\x8b",                "archive_gzip",   "GZIP archive"),
    (0, b"BZh",                     "archive_bzip2",  "BZIP2 archive"),
    (0, b"PK\x03\x04",              "archive_zip",    "ZIP archive"),
    (0, b"PK\x05\x06",              "archive_zip",    "ZIP archive (empty)"),
    (257, b"ustar",                 "archive_tar",    "TAR archive"),

    # ── Documents that turn up in triage output ──────────────────────────────
    (0, b"%PDF-",                   "pdf",            "PDF document"),
]


def _elf_is_core(head: bytes) -> bool:
    """
    Distinguish a Linux memory core dump from an ELF executable.

    Both open with `\x7fELF`, so without this a memory image captured as a core
    dump is filed as a binary and sent to Binary Analysis - which encrypts it
    under a password and asks nobody about Volatility.

    `e_type` sits at offset 0x10 as a little-endian half-word. 4 is `ET_CORE`.
    """
    if len(head) < 0x12:
        return False
    return int.from_bytes(head[0x10:0x12], "little") == 4


def _valid_pe(head: bytes) -> bool:
    """
    Confirm an `MZ` head really is a PE.

    The DOS signature is two bytes, which a CSV whose first column is named
    `MZ` would satisfy. A real PE stores the offset of its NT header at 0x3C
    and puts `PE\0\0` there, so that is what gets checked.
    """
    if len(head) < 0x40:
        return False
    offset = int.from_bytes(head[0x3C:0x40], "little")
    return head[offset:offset + 4] == b"PE\x00\x00"


#: Signatures that identify a *family*, where a header field says which member.
#: Returns the replacement (kind, label), or None to keep the table's answer.
_REFINERS: dict[str, Callable[[bytes], tuple[str, str] | None]] = {
    "elf": lambda head: (
        ("memory_dump_linux", "Linux memory core dump") if _elf_is_core(head) else None
    ),
}


#: Extra confirmation for signatures short enough to collide with real data.
#: A failed validator does not stop identification - the scan simply continues
#: to the next signature, so the file still gets its best available answer.
_VALIDATORS: dict[str, Callable[[bytes], bool]] = {
    "pe": _valid_pe,
}


# Names that resolve a container signature to the artifact inside it. Matched
# case-insensitively against the filename; a substring, since KAPE prefixes
# collected files with the machine name and a timestamp.
_CONTAINER_REFINEMENTS: dict[str, list[tuple[str, str, str]]] = {
    "sqlite": [
        ("activitiescache.db", "windows_timeline", "Windows Timeline (ActivitiesCache.db)"),
        ("history",            "browser_history",  "Browser history"),
        ("places.sqlite",      "browser_history",  "Firefox history (places.sqlite)"),
        ("cookies",            "browser_cookies",  "Browser cookies"),
        ("webcachev01",        "browser_cache",    "Internet Explorer / Edge cache"),
    ],
    "ese": [
        ("srudb.dat",          "srum",             "System Resource Usage Monitor (SRUDB.dat)"),
        ("windows.edb",        "search_index",     "Windows Search index"),
        ("webcachev01.dat",    "browser_cache",    "Internet Explorer / Edge cache"),
        ("ntds.dit",           "ntds",             "Active Directory database (NTDS.dit)"),
    ],
    "olecf": [
        (".msg",                            "msg",              "Outlook message (MSG)"),
        ("automaticdestinations-ms",        "jumplist_auto",    "Jump list, automatic"),
        ("customdestinations-ms",           "jumplist_custom",  "Jump list, custom"),
    ],
}

# Extensions used only when no signature matched. These are guesses, and the
# `extension` detection source records them as such.
_EXTENSIONS: dict[str, tuple[str, str]] = {
    ".csv":     ("csv",             "CSV table"),
    ".tsv":     ("csv",             "TSV table"),
    ".json":    ("json",            "JSON document"),
    ".jsonl":   ("jsonl",           "JSON Lines"),
    ".ndjson":  ("jsonl",           "JSON Lines"),
    ".xml":     ("xml",             "XML document"),
    ".log":     ("log",             "Log file"),
    ".txt":     ("text",            "Text file"),
    ".eml":     ("eml",             "Email message (EML)"),
    ".mbox":    ("mbox",            "Mailbox (mbox)"),
    ".pcap":    ("pcap",            "Packet capture (PCAP)"),
    ".pcapng":  ("pcapng",          "Packet capture (PCAPNG)"),
    ".cap":     ("pcap",            "Packet capture (PCAP)"),
    ".dmp":     ("memory_dump",     "Memory dump"),
    ".mem":     ("memory_dump",     "Memory image"),
    ".raw":     ("memory_dump",     "Raw image"),
    ".vmem":    ("memory_dump",     "VMware memory image"),
    ".lime":    ("memory_dump_linux", "LiME memory image"),
    ".vmss":    ("memory_dump",     "VMware suspend state"),
    ".vmsn":    ("memory_dump",     "VMware snapshot state"),
    ".core":    ("memory_dump_linux", "Linux memory core dump"),
    ".lmem":    ("memory_dump",     "Memory image"),
    ".crash":   ("memory_dump",     "Memory image"),
    ".dd":      ("disk_raw",        "Raw disk image"),
    ".img":     ("disk_raw",        "Raw disk image"),
    ".001":     ("disk_raw",        "Raw disk image (split)"),
    ".bin":     ("binary_blob",     "Binary file"),
    ".db":      ("sqlite",          "Database"),
    ".dat":     ("binary_blob",     "Binary file"),
    ".evtx":    ("evtx",            "Windows Event Log (EVTX)"),
    ".lnk":     ("lnk",             "Shortcut (LNK)"),
    ".pf":      ("prefetch",        "Prefetch"),
    ".hve":     ("registry_hive",   "Registry hive"),
    ".zip":     ("archive_zip",     "ZIP archive"),
    ".7z":      ("archive_7z",      "7-Zip archive"),
    ".rar":     ("archive_rar",     "RAR archive"),
    ".tar":     ("archive_tar",     "TAR archive"),
    ".gz":      ("archive_gzip",    "GZIP archive"),
    ".e01":     ("ewf",             "EnCase image (E01)"),
    ".ex01":    ("ewf",             "EnCase image (Ex01)"),
    ".vmdk":    ("vmdk",            "VMware disk (VMDK)"),
    ".vhd":     ("vhd",             "Virtual hard disk (VHD)"),
    ".vhdx":    ("vhdx",            "Hyper-V disk (VHDX)"),
    ".qcow2":   ("qcow",            "QEMU disk (QCOW2)"),
}

# Extension-less names that are artifacts in their own right. NTFS metadata
# files arrive exactly like this, and `$MFT` has no suffix to key on.
_EXACT_NAMES: dict[str, tuple[str, str]] = {
    "$mft":       ("mft",            "NTFS Master File Table ($MFT)"),
    "$mftmirr":   ("mft",            "NTFS MFT mirror ($MFTMirr)"),
    "$j":         ("usnjrnl",        "NTFS USN Journal ($J)"),
    "$usnjrnl":   ("usnjrnl",        "NTFS USN Journal ($UsnJrnl)"),
    "$logfile":   ("ntfs_logfile",   "NTFS transaction log ($LogFile)"),
    "$secure":    ("ntfs_secure",    "NTFS security descriptors ($Secure)"),
    "sam":        ("registry_hive",  "Registry hive (SAM)"),
    "system":     ("registry_hive",  "Registry hive (SYSTEM)"),
    "software":   ("registry_hive",  "Registry hive (SOFTWARE)"),
    "security":   ("registry_hive",  "Registry hive (SECURITY)"),
    "ntuser.dat": ("registry_hive",  "Registry hive (NTUSER.DAT)"),
    "usrclass.dat": ("registry_hive", "Registry hive (UsrClass.dat)"),
    "amcache.hve": ("registry_hive", "Registry hive (Amcache)"),
    "pagefile.sys": ("pagefile",     "Windows page file"),
    "hiberfil.sys": ("hiberfil",     "Windows hibernation file"),
}

# Sub-folder names accepted as hints. They break ties; they never override a
# signature (`docs/INGESTION.md` section 6).
_FOLDER_HINTS: dict[str, tuple[str, str]] = {
    "evtx":     ("evtx",          "Windows Event Log (EVTX)"),
    "registry": ("registry_hive", "Registry hive"),
    "memory":   ("memory_dump",   "Memory image"),
    "pcap":     ("pcap",          "Packet capture"),
    "disk":     ("disk_raw",      "Disk image"),
    "mail":     ("eml",           "Email message"),
}

_UNKNOWN = Identification("unknown", "Unidentified", DETECTED_BY_EXTENSION)


# ─── Text shape ───────────────────────────────────────────────────────────────

def _looks_textual(head: bytes) -> bool:
    """
    True when the head decodes as UTF-8 and holds no control bytes.

    A NUL byte is the reliable discriminator: no text format Remora ingests
    contains one, and every binary format examined here does within 4 KB. NUL
    is checked before decoding because UTF-16 text is full of them and must
    read as binary, not as a text file we would then split on the wrong bytes.
    """
    if not head or b"\x00" in head:
        return False
    try:
        text = head.decode("utf-8")
    except UnicodeDecodeError:
        return False
    control = sum(1 for c in text if ord(c) < 32 and c not in "\t\r\n")
    return control == 0


def _identify_text(head: bytes, name: str) -> Identification | None:
    """
    Tell apart the three text shapes the Explorer treats differently.

    Only called once the head is known to be textual. Returning None means
    "text, but no more specific than that" and lets the extension decide.
    """
    try:
        text = head.decode("utf-8")
    except UnicodeDecodeError:
        return None

    stripped = text.lstrip()
    if not stripped:
        return None

    # JSON before anything else: a JSON document starting with `[` would look
    # like a header row to the CSV test below.
    if stripped[0] in "{[":
        first_line = stripped.split("\n", 1)[0].rstrip()
        # A `{...}` per line is JSON Lines, which streams; a single object or
        # array is a document, which does not. Different readers.
        if stripped[0] == "{" and first_line.endswith("}") and "\n{" in stripped:
            return Identification("jsonl", "JSON Lines", DETECTED_BY_CONTENT)
        return Identification("json", "JSON document", DETECTED_BY_CONTENT)

    # Mail headers. `Received:` is the strongest signal because it is inserted
    # by relays and cannot be the first line of a CSV in practice.
    lowered = stripped[:512].lower()
    if lowered.startswith(("received:", "return-path:", "from ", "message-id:", "delivered-to:")):
        return Identification("eml", "Email message (EML)", DETECTED_BY_CONTENT)

    # CSV: a delimiter that appears the same number of times on the first two
    # complete lines. One line proves nothing — a log line has commas too.
    lines = [ln for ln in text.splitlines() if ln.strip()][:3]
    if len(lines) >= 2:
        for delim, label in ((",", "CSV table"), ("\t", "TSV table"), (";", "CSV table")):
            counts = [ln.count(delim) for ln in lines[:2]]
            if counts[0] >= 1 and counts[0] == counts[1]:
                return Identification("csv", label, DETECTED_BY_CONTENT)

    if name.lower().endswith((".log", ".txt")):
        return None  # let the extension label it
    return Identification("text", "Text file", DETECTED_BY_CONTENT)


# ─── Entry point ──────────────────────────────────────────────────────────────

def _refine_container(kind: str, name: str) -> tuple[str, str] | None:
    """Resolve a container signature to the artifact stored inside it."""
    lowered = name.lower()
    for needle, refined_kind, label in _CONTAINER_REFINEMENTS.get(kind, []):
        if needle in lowered:
            return refined_kind, label
    return None


def identify_bytes(head: bytes, name: str, folder_hint: str | None = None) -> Identification:
    """
    Identify from an already-read header. Split out from `identify()` so the
    signature table is testable without touching a filesystem.
    """
    for offset, magic, kind, label in _SIGNATURES:
        if head[offset:offset + len(magic)] == magic:
            validator = _VALIDATORS.get(kind)
            if validator and not validator(head):
                continue
            refiner = _REFINERS.get(kind)
            if refiner:
                replacement = refiner(head)
                if replacement:
                    return Identification(replacement[0], replacement[1], DETECTED_BY_MAGIC)
            refined = _refine_container(kind, name)
            if refined:
                return Identification(refined[0], refined[1], DETECTED_BY_MAGIC)
            return Identification(kind, label, DETECTED_BY_MAGIC)

    lowered = Path(name).name.lower()
    if lowered in _EXACT_NAMES:
        kind, label = _EXACT_NAMES[lowered]
        return Identification(kind, label, DETECTED_BY_EXTENSION)

    if _looks_textual(head):
        found = _identify_text(head, name)
        if found:
            return found

    suffix = Path(name).suffix.lower()
    if suffix in _EXTENSIONS:
        kind, label = _EXTENSIONS[suffix]
        return Identification(kind, label, DETECTED_BY_EXTENSION)

    if folder_hint and folder_hint.lower() in _FOLDER_HINTS:
        kind, label = _FOLDER_HINTS[folder_hint.lower()]
        return Identification(kind, label, DETECTED_BY_HINT)

    return _UNKNOWN


def identify(path: Path, name: str | None = None,
             folder_hint: str | None = None) -> Identification:
    """
    Identify the file at `path`.

    `name` overrides the on-disk filename, which matters for an upload staged
    under a UUID in `.incoming/` and for an archive member whose original path
    is the only thing that can disambiguate a container format.

    An unreadable file is `unknown` rather than an exception: the pipeline
    records the state and moves on, and no state discards the file.
    """
    display = name or path.name
    try:
        with open(path, "rb") as fh:
            head = fh.read(HEADER_BYTES)
    except OSError:
        return _UNKNOWN
    if not head:
        return Identification("empty", "Empty file", DETECTED_BY_CONTENT)
    return identify_bytes(head, display, folder_hint)
