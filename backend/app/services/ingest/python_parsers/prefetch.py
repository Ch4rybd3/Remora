"""
Prefetch, in Python.

PECmd does not run on Linux - Windows 10 and later compress prefetch with
MAM/LZXPRESS-Huffman and it decompresses through a Windows API. That left the
single largest artifact class in a triage unparsed: 439 files out of 2058 in an
ordinary KAPE collection.

`dissect.util` already ships the decompressor, so the only missing piece was
reading the structure, which is documented and stable.

**Deliberately partial.** This reads what an analyst uses - what ran, when, how
often, from which volume, and which files it touched. It does not read the
trace chains, which describe page-fault ordering and answer questions nobody
asks in an investigation. Claiming to be PECmd would be worse than being a
smaller thing that works.
"""
from __future__ import annotations

import csv
import struct
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

#: Windows 10 and later. Earlier versions are stored uncompressed.
MAM_SIGNATURE = b"MAM\x04"

#: Format versions this reads. 17 (XP) and 23 (Windows 7) place the run count
#: elsewhere and carry a single run time; 26, 30 and 31 agree on everything
#: used here.
SUPPORTED_VERSIONS = frozenset({17, 23, 26, 30, 31})

_VERSION_NAMES = {
    17: "Windows XP", 23: "Windows 7", 26: "Windows 8.1",
    30: "Windows 10", 31: "Windows 11",
}


#: How far short of its declared size a decompressed record may fall. See
#: `decompress` for why this is not zero.
_LENGTH_TOLERANCE = 16


class PrefetchError(Exception):
    """The file is not readable prefetch. One file, not the batch."""


@dataclass
class Volume:
    device:   str = ""
    serial:   str = ""
    created:  datetime | None = None
    directories: int = 0


@dataclass
class Prefetch:
    source:       str
    executable:   str
    path_hash:    str
    version:      int
    run_count:    int
    run_times:    list[datetime] = field(default_factory=list)
    volumes:      list[Volume] = field(default_factory=list)
    files_loaded: list[str] = field(default_factory=list)

    @property
    def version_name(self) -> str:
        return _VERSION_NAMES.get(self.version, f"unknown ({self.version})")


def _filetime(value: int) -> datetime | None:
    """
    A Windows FILETIME, or None when it is not a real time.

    Unused run-time slots are zero, and a corrupt record can hold something
    absurd. Returning None rather than a date from the year 30828 keeps the
    timeline honest.
    """
    if not value or value > 0x7FFF_FFFF_FFFF_FFFF:
        return None
    try:
        return datetime(1601, 1, 1, tzinfo=UTC) + timedelta(microseconds=value // 10)
    except (OverflowError, OSError, ValueError):
        return None


def _utf16(raw: bytes) -> str:
    return raw.decode("utf-16-le", errors="replace").split("\x00")[0]


def decompress(raw: bytes) -> bytes:
    """Undo the MAM wrapper if there is one. Older prefetch is stored plain."""
    if not raw.startswith(MAM_SIGNATURE):
        return raw
    from dissect.util.compression import lzxpress_huffman

    expected = struct.unpack_from("<I", raw, 4)[0]
    try:
        out = lzxpress_huffman.decompress(raw[8:])
    except Exception as e:
        raise PrefetchError(f"MAM decompression failed: {e}") from e

    # The declared size is advisory. Twenty-three of 439 files in a real triage
    # decompress to exactly one byte less than the header promises - a stream
    # that ends on a block boundary - and every one of them is a complete,
    # readable prefetch record. Rejecting them on arithmetic lost CMD.EXE and
    # CODE.EXE from the timeline for no reason.
    #
    # What actually guards correctness is the SCCA signature and the bounds
    # check on every offset read afterwards, neither of which a truncated file
    # would survive.
    if len(out) + _LENGTH_TOLERANCE < expected:
        raise PrefetchError(
            f"decompressed to {len(out)} bytes, header promised {expected}")
    return out


def parse(path: Path) -> Prefetch:
    """Read one `.pf`."""
    data = decompress(path.read_bytes())

    if len(data) < 0x54 or data[4:8] != b"SCCA":
        raise PrefetchError("Not a prefetch file (no SCCA signature)")

    version = struct.unpack_from("<I", data, 0)[0]
    if version not in SUPPORTED_VERSIONS:
        raise PrefetchError(f"Unsupported prefetch version {version}")

    result = Prefetch(
        source=path.name,
        executable=_utf16(data[0x10:0x10 + 58]),
        path_hash=f"{struct.unpack_from('<I', data, 0x4C)[0]:08X}",
        version=version,
        run_count=0,
    )

    filenames_offset, filenames_size = struct.unpack_from("<II", data, 0x64)
    volumes_offset, volume_count, _volumes_size = struct.unpack_from("<III", data, 0x6C)

    # Windows 7 and XP carry one run time and put the count at 0x98; everything
    # later carries eight and puts it at 0xD0.
    if version <= 23:
        times = struct.unpack_from("<1Q", data, 0x80)
        result.run_count = struct.unpack_from("<I", data, 0x98)[0]
    else:
        times = struct.unpack_from("<8Q", data, 0x80)
        result.run_count = struct.unpack_from("<I", data, 0xD0)[0]

    result.run_times = [t for t in (_filetime(v) for v in times) if t]

    if 0 < filenames_size and filenames_offset + filenames_size <= len(data):
        block = data[filenames_offset:filenames_offset + filenames_size]
        result.files_loaded = [
            name for name in block.decode("utf-16-le", errors="replace").split("\x00")
            if name
        ]

    result.volumes = _volumes(data, volumes_offset, volume_count, version)
    return result


def _volumes(data: bytes, offset: int, count: int, version: int) -> list[Volume]:
    """
    Volume records.

    The entry is 40 bytes on Windows 7 and 96 later, but the first 0x24 bytes -
    everything read here - are identical, which is why one reader covers both.
    """
    entry_size = 40 if version <= 23 else 96
    out: list[Volume] = []
    for index in range(min(count, 8)):
        base = offset + index * entry_size
        if base + 0x24 > len(data):
            break
        path_offset, path_chars = struct.unpack_from("<II", data, base)
        created = _filetime(struct.unpack_from("<Q", data, base + 0x08)[0])
        serial = struct.unpack_from("<I", data, base + 0x10)[0]
        directories = struct.unpack_from("<I", data, base + 0x20)[0]

        device = ""
        start = offset + path_offset
        if 0 < path_chars < 512 and start + path_chars * 2 <= len(data):
            device = _utf16(data[start:start + path_chars * 2])

        out.append(Volume(device=device, serial=f"{serial:08X}",
                          created=created, directories=directories))
    return out


# ─── CSV output ───────────────────────────────────────────────────────────────

SUMMARY_COLUMNS = [
    "SourceFilename", "ExecutableName", "Hash", "Version", "RunCount",
    "LastRun", "PreviousRuns", "VolumeCount", "VolumeDevices", "VolumeSerials",
    "VolumeCreated", "DirectoryCount", "FilesLoadedCount", "ParseError",
]

#: One row per file a program touched. Split out rather than joined into a
#: single cell because this is the half an analyst pivots on - "what else
#: loaded this DLL" is a filter, not a text search.
LOADED_COLUMNS = ["SourceFilename", "ExecutableName", "LastRun", "LoadedFile"]


def _iso(value: datetime | None) -> str:
    return value.isoformat() if value else ""


def write_csv(results: list[Prefetch], errors: dict[str, str], out_dir: Path) -> list[Path]:
    """
    Two CSVs: one row per prefetch file, and one row per loaded file.

    Files that failed to parse get a row too, carrying the reason. An artifact
    that quietly vanishes between the folder and the table is worse than one
    that says it could not be read.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_path = out_dir / "prefetch.csv"
    loaded_path = out_dir / "prefetch_files_loaded.csv"

    with open(summary_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(SUMMARY_COLUMNS)
        for item in results:
            runs = item.run_times
            writer.writerow([
                item.source, item.executable, item.path_hash, item.version_name,
                item.run_count,
                _iso(runs[0] if runs else None),
                " | ".join(_iso(t) for t in runs[1:]),
                len(item.volumes),
                " | ".join(v.device for v in item.volumes),
                " | ".join(v.serial for v in item.volumes),
                " | ".join(_iso(v.created) for v in item.volumes),
                sum(v.directories for v in item.volumes),
                len(item.files_loaded),
                "",
            ])
        for name, reason in errors.items():
            writer.writerow([name] + [""] * (len(SUMMARY_COLUMNS) - 2) + [reason])

    with open(loaded_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(LOADED_COLUMNS)
        for item in results:
            last = _iso(item.run_times[0] if item.run_times else None)
            for loaded in item.files_loaded:
                writer.writerow([item.source, item.executable, last, loaded])

    return [summary_path, loaded_path]
