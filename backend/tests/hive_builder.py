"""
Building a minimal, valid registry hive in memory.

The Registry Explorer rests entirely on reading a real hive, and asserting on a
mocked parser would test the mock. There is no small hive to check into the
repository - a real one is megabytes and carries somebody's machine in it - so
the tests build the smallest hive that is genuinely well-formed and read it
with the same code the product uses.

The format, only as far as this needs it:

* A 4096-byte base block, holding a checksum over its first 508 bytes.
* One 4096-byte hbin, holding cells laid out back to back.
* A cell is a signed 32-bit length followed by its record. Negative means
  allocated, which is the only kind written here.
* Keys are `nk` records, their children listed by an `li` index, and their
  values by a list of offsets to `vk` records.

Offsets are relative to the start of the hbin area, which is where the reader
seeks from.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

from dissect.regf.c_regf import c_regf

BASE_BLOCK_SIZE = 4096
HBIN_SIZE       = 4096
CHECKSUM_AT     = 508

KEY_COMP_NAME  = c_regf.KEY.COMP_NAME
KEY_HIVE_ENTRY = c_regf.KEY.HIVE_ENTRY

REG_SZ       = 1
REG_BINARY   = 3
REG_DWORD    = 4
REG_MULTI_SZ = 7


@dataclass
class Key:
    """One key to write. Values are `(type, raw bytes)` pairs by name."""
    name:     str
    values:   dict[str, tuple[int, bytes]] = field(default_factory=dict)
    subkeys:  list[Key] = field(default_factory=list)
    #: FILETIME. A fixed default keeps a hive's bytes reproducible between runs.
    timestamp: int = 133_000_000_000_000_000


#: The hbin's own header, which sits at the start of the area cell offsets are
#: measured from. Cells begin after it, so the heap reserves it up front rather
#: than every offset having to remember to add it.
HBIN_HEADER_SIZE = 32


class _Heap:
    """Cells, laid out back to back, addressed by hbin-relative offset."""

    def __init__(self) -> None:
        self.blob = bytearray(HBIN_HEADER_SIZE)

    def add(self, record: bytes) -> int:
        # Cells are padded to a multiple of 8 and their length is stored
        # negative to mean allocated.
        size = len(record) + 4
        padded = (size + 7) & ~7
        offset = len(self.blob)
        self.blob += struct.pack("<i", -padded)
        self.blob += record
        self.blob += b"\x00" * (padded - size)
        return offset


def _nk(key: Key, parent: int, subkey_count: int, subkey_list: int,
        value_count: int, value_list: int, is_root: bool) -> bytes:
    name = key.name.encode("latin-1")
    flags = KEY_COMP_NAME | (KEY_HIVE_ENTRY if is_root else 0)
    node = c_regf.CM_KEY_NODE(
        Signature=b"nk",
        Flags=flags,
        LastWriteTime=key.timestamp,
        Spare=0,
        Parent=parent,
        SubKeyCounts=[subkey_count, 0],
        SubKeyLists=[subkey_list, 0xFFFFFFFF],
        ValueList=c_regf.CHILD_LIST(Count=value_count, List=value_list),
        Security=0xFFFFFFFF,
        Class=0xFFFFFFFF,
        MaxNameLen=0, MaxClassLen=0, MaxValueNameLen=0, MaxValueDataLen=0,
        WorkVar=0,
        NameLength=len(name),
        ClassLength=0,
    )
    return node.dumps() + name


def _vk(name: str, value_type: int, data: bytes, data_offset: int) -> bytes:
    raw_name = name.encode("latin-1")
    value = c_regf.CM_KEY_VALUE(
        Signature=b"vk",
        NameLength=len(raw_name),
        DataLength=len(data),
        Data=data_offset,
        Type=value_type,
        Flags=c_regf.VALUE.COMP_NAME,   # the name is Latin-1, not UTF-16
        Spare=0,
    )
    return value.dumps() + raw_name


def _write_key(heap: _Heap, key: Key, parent: int, is_root: bool = False) -> int:
    """
    Write one key and everything under it, returning its cell offset.

    Children first: a key names its subkey list and its value list by offset,
    so they have to exist before it does. The parent offset is the exception -
    it is known before the child is written, which is why it is a parameter.
    """
    # Values, then the list of offsets pointing at them.
    value_offsets = []
    for name, (value_type, data) in key.values.items():
        data_offset = heap.add(data)
        value_offsets.append(heap.add(_vk(name, value_type, data, data_offset)))
    value_list = heap.add(struct.pack(f"<{len(value_offsets)}I", *value_offsets)) \
        if value_offsets else 0xFFFFFFFF

    # A key's own offset is not known until it is written, and its children
    # need it. Reserve the space, write the children pointing at it, then fill
    # it in - the one back-reference the format requires.
    placeholder = _nk(key, parent, 0, 0xFFFFFFFF, len(value_offsets), value_list, is_root)
    self_offset = heap.add(placeholder)

    subkey_offsets = [_write_key(heap, child, self_offset) for child in key.subkeys]
    subkey_list = 0xFFFFFFFF
    if subkey_offsets:
        index = c_regf.CM_KEY_INDEX(
            Signature=b"li", Count=len(subkey_offsets), List=subkey_offsets)
        subkey_list = heap.add(index.dumps())

    final = _nk(key, parent, len(subkey_offsets), subkey_list,
                len(value_offsets), value_list, is_root)
    heap.blob[self_offset + 4:self_offset + 4 + len(final)] = final
    return self_offset


def build(root: Key, *, filename: str = "\\SYSTEM", dirty: bool = False) -> bytes:
    """
    A complete hive holding `root` and everything under it.

    `dirty=True` corrupts the checksum, which is how a hive collected while
    Windows was mid-write presents itself. The reader must report that rather
    than repair it.
    """
    heap = _Heap()
    root_offset = _write_key(heap, root, 0, is_root=True)

    # Packed by hand: the hbin signature is declared as a `ULONG` rather than
    # `CHAR[2]` the way every other signature in this format is, so passing the
    # four bytes it spells is a type error rather than a value.
    heap.blob[:HBIN_HEADER_SIZE] = struct.pack("<4sIIQQI", b"hbin", 0, HBIN_SIZE, 0, 0, 0)
    body = bytes(heap.blob)
    body += b"\x00" * (HBIN_SIZE - len(body))

    header = bytearray(BASE_BLOCK_SIZE)
    struct.pack_into("<I", header, 0,  0x66676572)     # "regf"
    struct.pack_into("<I", header, 4,  1)              # Sequence1
    struct.pack_into("<I", header, 8,  1)              # Sequence2
    struct.pack_into("<Q", header, 12, 133_000_000_000_000_000)
    struct.pack_into("<I", header, 20, 1)              # Major
    struct.pack_into("<I", header, 24, 5)              # Minor
    struct.pack_into("<I", header, 28, 0)              # Type
    struct.pack_into("<I", header, 32, 1)              # Format
    struct.pack_into("<I", header, 36, root_offset)    # RootCell
    struct.pack_into("<I", header, 40, HBIN_SIZE)      # Length
    struct.pack_into("<I", header, 44, 1)              # Cluster
    name = filename.encode("utf-16-le")[:64]
    header[48:48 + len(name)] = name

    checksum = 0
    for (word,) in struct.iter_unpack("<I", bytes(header[:CHECKSUM_AT])):
        checksum ^= word
    if checksum == 0:
        checksum = 1
    elif checksum == 0xFFFFFFFF:
        checksum = 0xFFFFFFFE
    if dirty:
        checksum ^= 0xDEADBEEF
    struct.pack_into("<I", header, CHECKSUM_AT, checksum)

    return bytes(header) + body


def sample() -> bytes:
    """A hive shaped like the ones these tests keep needing."""
    return build(Key(
        name="ROOT",
        subkeys=[
            Key(
                name="Microsoft",
                subkeys=[Key(
                    name="Windows",
                    values={
                        "ProductName": (REG_SZ, "Windows 11 Pro\x00".encode("utf-16-le")),
                        "BuildNumber": (REG_DWORD, struct.pack("<I", 22631)),
                        "Blob":        (REG_BINARY, bytes(range(16))),
                    },
                )],
            ),
            Key(name="Empty"),
        ],
        values={"Root Value": (REG_SZ, "at the top\x00".encode("utf-16-le"))},
    ))
