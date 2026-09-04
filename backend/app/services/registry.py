"""
Reading a Windows registry hive.

A hive is not one artifact. It is a filesystem of its own holding thousands of
unrelated facts, and which of them matter is an analyst's decision rather than
a default - which is why Remora refused to parse `SOFTWARE`, `SECURITY` and
`SAM` at all. Shipping a list of "interesting keys" would have quietly defined
what "the registry" means for every investigation run on this tool.

Browsing is the answer that does not make that choice. The analyst navigates
the hive the way Registry Explorer does, and Remora supplies the navigation
rather than the conclusions.

**Read-only, and never in place on evidence beyond opening it.** The file is
opened `rb` and nothing writes. That matters more here than elsewhere: a hive
copied out of a live system is often *dirty* - Windows was mid-transaction when
it was collected - and the recovery a live system would perform on mount is
exactly the kind of modification an evidence copy must not undergo.

What this does **not** do, said plainly because Registry Explorer does both:

* **No transaction log replay.** A dirty hive is reported as dirty and read as
  it stands, so the newest writes may be missing. Replaying `.LOG1`/`.LOG2`
  would mean modifying the artifact.
* **No deleted key recovery.** Unallocated cells are not carved.

Both are honest gaps, surfaced on the hive rather than hidden.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from dissect.regf import RegistryHive
from dissect.regf.regf import KeyNode, KeyValue

logger = logging.getLogger("remora.registry")


class RegistryError(Exception):
    """The hive could not be read, with a reason meant for the analyst."""


# ─── Value types ──────────────────────────────────────────────────────────────
# The wire format stores a number. Analysts read `REG_SZ`, and a report that
# says `1` where it should say `REG_SZ` is a report nobody can check.

VALUE_TYPES: dict[int, str] = {
    0:  "REG_NONE",
    1:  "REG_SZ",
    2:  "REG_EXPAND_SZ",
    3:  "REG_BINARY",
    4:  "REG_DWORD",
    5:  "REG_DWORD_BIG_ENDIAN",
    6:  "REG_LINK",
    7:  "REG_MULTI_SZ",
    8:  "REG_RESOURCE_LIST",
    9:  "REG_FULL_RESOURCE_DESCRIPTOR",
    10: "REG_RESOURCE_REQUIREMENTS_LIST",
    11: "REG_QWORD",
}

#: Beyond this a value is truncated in the listing. The full bytes are still
#: reachable one request further in - the cap is so that opening a key holding a
#: 2 MB binary blob does not send 2 MB to draw one table row.
PREVIEW_BYTES = 512

#: Hard cap on what the detail view will return, in bytes. A registry value can
#: legitimately hold megabytes; the browser does not need all of it to let an
#: analyst see what it is.
MAX_VALUE_BYTES = 1024 * 1024


# ─── Shapes ───────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class HiveInfo:
    """What the header says about the hive, before reading a single key."""
    #: The path Windows knew the hive by, from its header. Says which hive this
    #: is when the filename does not - KAPE prefixes a machine name, and a hive
    #: extracted from an image may be called anything at all.
    internal_name: str
    version:       int
    #: The header checksum failed: the hive was collected mid-write. Reported
    #: rather than repaired - repairing means writing to evidence.
    dirty:         bool
    #: Sequence numbers disagree, so a transaction was in flight.
    in_transaction: bool
    root_name:     str
    subkey_count:  int
    value_count:   int


@dataclass(frozen=True)
class KeyEntry:
    """One key in a listing. Counts are included so the tree can draw itself."""
    name:          str
    path:          str
    subkey_count:  int
    value_count:   int
    last_written:  datetime | None


@dataclass(frozen=True)
class ValueEntry:
    name:      str
    type:      str
    size:      int
    #: Rendered for display. Strings as themselves, numbers as numbers, binary
    #: as hex - and truncated at `PREVIEW_BYTES`.
    preview:   str
    truncated: bool


@dataclass(frozen=True)
class SearchHit:
    key_path:   str
    #: None when the key name itself matched rather than a value.
    value_name: str | None
    #: Which part matched: `key`, `value_name` or `value_data`. Shown because a
    #: hit on a key name and a hit inside a blob mean very different things.
    matched:    str
    preview:    str


@dataclass
class SearchResult:
    hits:      list[SearchHit] = field(default_factory=list)
    #: True when the walk stopped on its budget rather than finishing. The
    #: alternative is a request that never returns on a 200 MB SOFTWARE hive,
    #: and a search that silently stopped early is worse than one that says so.
    exhausted: bool = False
    scanned:   int = 0


# ─── Opening ──────────────────────────────────────────────────────────────────

def _open(path: Path) -> RegistryHive:
    if not path.exists():
        raise RegistryError(
            "The hive file is no longer on disk. It was most likely removed "
            "with the collection it came from.")
    try:
        return RegistryHive(path.open("rb"))
    except Exception as e:
        raise RegistryError(f"This file could not be read as a registry hive: {e}") from e


#: Offsets in the hive base block, from the format itself rather than from any
#: library's reading of it. Signature, then the two sequence numbers, then the
#: checksum over everything before it.
_HEADER_SIZE   = 512
_CHECKSUM_AT   = 508
_SEQUENCE1_AT  = 4
_SEQUENCE2_AT  = 8


def _read_header(path: Path) -> tuple[bool, bool]:
    """
    (dirty, in_transaction), computed from the base block directly.

    Not taken from `RegistryHive.dirty`. That attribute is assigned
    `computed_crc == stored_crc` - which is the condition for the hive being
    **valid** - and then reported as dirty. Depending on it would mean shipping
    a warning that is exactly backwards, and a hive wrongly called clean is one
    whose missing writes nobody goes looking for.

    The checksum is the XOR of the first 508 bytes taken as little-endian
    32-bit words. Windows stores 0 as 1 and 0xFFFFFFFF as 0xFFFFFFFE, so those
    two values are compared with that substitution applied.
    """
    import struct

    with path.open("rb") as fh:
        head = fh.read(_HEADER_SIZE)
    if len(head) < _HEADER_SIZE:
        return True, False

    computed = 0
    for (word,) in struct.iter_unpack("<I", head[:_CHECKSUM_AT]):
        computed ^= word
    if computed == 0:
        computed = 1
    elif computed == 0xFFFFFFFF:
        computed = 0xFFFFFFFE

    stored, = struct.unpack_from("<I", head, _CHECKSUM_AT)
    sequence1, = struct.unpack_from("<I", head, _SEQUENCE1_AT)
    sequence2, = struct.unpack_from("<I", head, _SEQUENCE2_AT)

    return computed != stored, sequence1 != sequence2


def info(path: Path) -> HiveInfo:
    hive = _open(path)
    root = hive.root()
    dirty, in_transaction = _read_header(path)
    return HiveInfo(
        internal_name=str(hive.filename or ""),
        version=int(hive.version),
        dirty=dirty,
        in_transaction=in_transaction,
        root_name=str(root.name),
        subkey_count=_count(root.subkeys),
        value_count=_count(root.values),
    )


def _count(producer: Any) -> int:
    try:
        return sum(1 for _ in producer())
    except Exception:
        return 0


# ─── Navigation ───────────────────────────────────────────────────────────────

def _resolve(hive: RegistryHive, key_path: str) -> KeyNode:
    """
    Walk to a key from the hive root, one component at a time.

    Resolved by asking the hive for each subkey rather than by joining strings,
    so a path is only ever as deep as the keys that actually exist. There is no
    filesystem here to traverse out of - `..` is a legal key name in the
    registry and means nothing special.
    """
    node = hive.root()
    for part in [p for p in key_path.replace("/", "\\").split("\\") if p]:
        try:
            node = node.subkey(part)
        except Exception as e:
            raise RegistryError(f"No such key: {key_path}") from e
    return node


def list_keys(path: Path, key_path: str = "") -> list[KeyEntry]:
    """The direct children of one key. One level, because the tree is lazy."""
    node = _resolve(_open(path), key_path)
    entries: list[KeyEntry] = []
    for child in node.subkeys():
        try:
            entries.append(KeyEntry(
                name=str(child.name),
                path=str(child.path),
                subkey_count=_count(child.subkeys),
                value_count=_count(child.values),
                last_written=_timestamp(child),
            ))
        except Exception as e:
            # One unreadable key does not cost the analyst the rest of the
            # level. A hive out of a compromised machine is not guaranteed
            # well-formed, and half a tree beats an error page.
            logger.warning("skipping unreadable subkey under %r: %s", key_path, e)
    entries.sort(key=lambda e: e.name.lower())
    return entries


def _timestamp(node: KeyNode) -> datetime | None:
    try:
        return node.timestamp
    except Exception:
        return None


def list_values(path: Path, key_path: str = "") -> list[ValueEntry]:
    node = _resolve(_open(path), key_path)
    entries: list[ValueEntry] = []
    for value in node.values():
        try:
            entries.append(_value_entry(value))
        except Exception as e:
            logger.warning("skipping unreadable value under %r: %s", key_path, e)
    return entries


def _value_entry(value: KeyValue) -> ValueEntry:
    type_name = VALUE_TYPES.get(int(value.type), f"UNKNOWN({int(value.type)})")
    size = int(value.size)
    preview, truncated = render(value, limit=PREVIEW_BYTES)
    return ValueEntry(name=str(value.name), type=type_name, size=size,
                      preview=preview, truncated=truncated)


def render(value: KeyValue, limit: int = PREVIEW_BYTES) -> tuple[str, bool]:
    """
    One registry value as text, and whether it was cut short.

    Binary is rendered as hex rather than decoded. A `REG_BINARY` that happens
    to hold readable ASCII is still binary, and showing it as a string invents
    a type the registry did not record.
    """
    try:
        parsed = value.value
    except Exception:
        try:
            raw = value.data[:limit]
        except Exception:
            return "", False
        return raw.hex(" "), int(value.size) > limit

    if isinstance(parsed, bytes):
        return parsed[:limit].hex(" "), len(parsed) > limit
    if isinstance(parsed, list):
        text = "\n".join(str(item) for item in parsed)
        return text[:limit], len(text) > limit
    text = str(parsed)
    return text[:limit], len(text) > limit


def value_detail(path: Path, key_path: str, value_name: str) -> dict:
    """
    One value in full: its text form and its bytes, for the detail pane.

    Both, because they answer different questions. The text is what the value
    means; the hex is what is actually stored, which is the one an analyst
    quotes when the two disagree.
    """
    node = _resolve(_open(path), key_path)
    for value in node.values():
        if str(value.name) != value_name:
            continue
        text, truncated = render(value, limit=MAX_VALUE_BYTES)
        try:
            raw = bytes(value.data)[:MAX_VALUE_BYTES]
        except Exception:
            raw = b""
        return {
            "name":      str(value.name),
            "type":      VALUE_TYPES.get(int(value.type), f"UNKNOWN({int(value.type)})"),
            "size":      int(value.size),
            "text":      text,
            "hex":       raw.hex(" "),
            "truncated": truncated or int(value.size) > MAX_VALUE_BYTES,
        }
    raise RegistryError(f"No such value: {value_name}")


# ─── Search ───────────────────────────────────────────────────────────────────

#: How many keys a search will visit before giving up. A `SOFTWARE` hive holds
#: hundreds of thousands, and a request that walks all of them holds a worker
#: for minutes. The analyst is told the walk was cut short rather than being
#: given a short answer that looks complete.
SEARCH_BUDGET = 200_000


def search(path: Path, query: str, *, limit: int = 200,
           in_values: bool = True, in_data: bool = True) -> SearchResult:
    """
    Find `query` in key names, value names and value data.

    Depth-first from the root, case-insensitive, bounded twice: by the number
    of hits wanted and by the number of keys visited.
    """
    needle = query.lower()
    if not needle:
        return SearchResult()

    hive = _open(path)
    result = SearchResult()
    stack: list[KeyNode] = [hive.root()]

    while stack:
        if len(result.hits) >= limit:
            result.exhausted = True
            break
        if result.scanned >= SEARCH_BUDGET:
            result.exhausted = True
            break

        node = stack.pop()
        result.scanned += 1

        try:
            key_path = str(node.path)
        except Exception:
            continue

        if needle in str(node.name).lower():
            result.hits.append(SearchHit(key_path, None, "key", key_path))

        if in_values:
            try:
                values = list(node.values())
            except Exception:
                values = []
            for value in values:
                if len(result.hits) >= limit:
                    break
                try:
                    name = str(value.name)
                except Exception:
                    continue
                if needle in name.lower():
                    text, _ = render(value)
                    result.hits.append(
                        SearchHit(key_path, name, "value_name", text))
                    continue
                if in_data:
                    text, _ = render(value)
                    if needle in text.lower():
                        result.hits.append(
                            SearchHit(key_path, name, "value_data", text))

        try:
            stack.extend(node.subkeys())
        except Exception:
            # An unreadable branch stops there and the walk continues, rather
            # than the whole search failing on one damaged cell.
            logger.debug("unreadable branch at %r", key_path)

    return result
