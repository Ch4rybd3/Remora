"""
The RDP bitmap cache: what an operator actually saw.

`mstsc` caches the screen in 64x64 tiles so it does not resend unchanged parts
of the display, and it keeps that cache on disk. Every tile is a fragment of a
remote session as it was rendered - a window title, a file name, a dialog, a
line of a document. It is the only artifact in an ordinary triage that
reconstructs what was *on the screen* rather than what was executed.

In the reference collection it is also 627 MB of the 743 MB nothing could read
(`docs/COVERAGE.md`), in six files under
`AppData\\Local\\Microsoft\\Terminal Server Client\\Cache`.

**The format, established from the files rather than assumed.** Modern `mstsc`
writes an `RDP8bmp\\x00` container: a 12-byte file header, then tiles laid end
to end, each one a 12-byte header (two key words, width, height) followed by
raw 32-bit pixels. Reading the reference cache that way consumes the file
exactly and yields 6,418 tiles of 64x64, 64x32, 48x64 and 48x32 - so the
dimensions are read per tile rather than assumed, which they would have been on
a first look at the data.

Two checks confirmed the layout before any of this was written:

* Neighbouring pixels within a tile differ by 5.8 on average where a shuffle of
  the same pixels differs by 23.8. Pictures correlate spatially; noise does
  not.
* The fourth byte of every pixel is `0xFF` in every tile sampled, which is what
  makes it padding rather than alpha - the pixels are BGRX.

**Output is contact sheets, not thirty-eight thousand files.** A tile on its
own says almost nothing; a grid of them in cache order is what an analyst
reads. Each sheet is accompanied by a row per tile in the index table, so a
tile can be counted, searched and located on its sheet.
"""
from __future__ import annotations

import csv
import logging
import struct
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("remora.python_parsers.rdp_cache")

#: Identifies the container written by every current version of `mstsc`.
MAGIC = b"RDP8bmp\x00"

#: Magic plus a version word.
FILE_HEADER_SIZE = 12

#: Two key words, then width and height as 16-bit values.
TILE_HEADER = "<IIHH"
TILE_HEADER_SIZE = struct.calcsize(TILE_HEADER)

#: Four bytes per pixel: blue, green, red, and a padding byte that is always
#: 0xFF. Not alpha - nothing in the cache is translucent.
BYTES_PER_PIXEL = 4

#: A tile is a screen fragment. Anything outside this is a misread header, and
#: refusing it is what stops one bad offset turning into a 4 GB allocation.
MAX_TILE_EDGE = 256

#: Tiles per contact sheet, as a grid. 32 x 32 of 64-pixel tiles is a 2048px
#: image: large enough to scan, small enough for a browser to hold several.
SHEET_COLUMNS = 32
SHEET_ROWS = 32
TILE_SLOT = 64

#: A ceiling on the work one collection can ask for. Six 100 MB caches is 38,000
#: tiles and about forty sheets; a hundred would be a different question.
MAX_TILES_PER_COLLECTION = 200_000


@dataclass(frozen=True)
class Tile:
    """One cached screen fragment."""
    index:  int
    offset: int
    width:  int
    height: int
    key:    str
    #: True when every pixel is the same colour. Kept, because a blank tile is
    #: still a tile the cache held, but flagged: an analyst scanning for
    #: content wants to filter them out.
    blank:  bool


def read_tiles(raw: bytes) -> list[Tile]:
    """
    Every tile in a cache file, in the order the cache holds them.

    Stops at the first header that does not make sense rather than trying to
    resynchronise. The cache is a ring buffer and its tail is usually a partial
    tile; reading past that would be inventing pixels.
    """
    if not raw.startswith(MAGIC):
        raise ValueError("Not an RDP8 bitmap cache")

    tiles: list[Tile] = []
    offset = FILE_HEADER_SIZE
    while offset + TILE_HEADER_SIZE <= len(raw):
        key1, key2, width, height = struct.unpack_from(TILE_HEADER, raw, offset)
        if not (0 < width <= MAX_TILE_EDGE and 0 < height <= MAX_TILE_EDGE):
            break
        data_at = offset + TILE_HEADER_SIZE
        size = width * height * BYTES_PER_PIXEL
        if data_at + size > len(raw):
            break
        tiles.append(Tile(
            index=len(tiles), offset=data_at, width=width, height=height,
            key=f"{key1:08x}{key2:08x}",
            blank=_is_uniform(raw, data_at, size),
        ))
        offset = data_at + size
    return tiles


def _is_uniform(raw: bytes, offset: int, size: int) -> bool:
    """Whether every pixel in the tile is the same colour."""
    first = raw[offset:offset + BYTES_PER_PIXEL]
    return raw[offset:offset + size] == first * (size // BYTES_PER_PIXEL)


COLUMNS = [
    "SourceFile", "TileIndex", "Sheet", "SheetRow", "SheetColumn",
    "Width", "Height", "Blank", "CacheKey", "FileOffset",
]

ERROR_COLUMNS = ["SourceFile", "Error"]


def parse_all(paths: list[Path], out_dir: Path,
              base: Path | None = None) -> list[Path]:
    """
    Decode every cache in the collection into contact sheets and an index.

    The index is what reaches the Artifact Explorer. The sheets sit beside it,
    named in the index, and are shown by the RDP Cache page.
    """
    from PIL import Image

    out_dir.mkdir(parents=True, exist_ok=True)
    rows: list[list[str]] = []
    errors: dict[str, str] = {}
    written: list[Path] = []
    total = 0

    for path in sorted(paths):
        source = _relative(path, base)
        try:
            raw = path.read_bytes()
            tiles = read_tiles(raw)
        except Exception as e:
            errors[source] = f"{type(e).__name__}: {e}"
            logger.warning("could not read RDP cache %s: %s", path.name, e)
            continue

        stem = _safe_stem(source)
        per_sheet = SHEET_COLUMNS * SHEET_ROWS

        for start in range(0, len(tiles), per_sheet):
            if total >= MAX_TILES_PER_COLLECTION:
                errors[source] = (
                    f"Stopped after {MAX_TILES_PER_COLLECTION} tiles across the "
                    f"collection; this cache is not fully rendered.")
                break

            batch = tiles[start:start + per_sheet]
            sheet_number = start // per_sheet
            sheet_name = f"{stem}_sheet{sheet_number:03d}.png"

            try:
                _render_sheet(Image, raw, batch, out_dir / sheet_name)
            except Exception as e:
                errors[f"{source} :: {sheet_name}"] = f"{type(e).__name__}: {e}"
                logger.warning("could not render %s: %s", sheet_name, e)
                continue

            written.append(out_dir / sheet_name)
            for position, tile in enumerate(batch):
                rows.append([
                    source, str(tile.index), sheet_name,
                    str(position // SHEET_COLUMNS), str(position % SHEET_COLUMNS),
                    str(tile.width), str(tile.height),
                    "true" if tile.blank else "false",
                    tile.key, str(tile.offset),
                ])
            total += len(batch)

    index = _write(out_dir, "rdp_bitmap_cache.csv", COLUMNS, rows)
    if index:
        # First in the list, so the caller registering "the artifact" registers
        # the table rather than a picture.
        written.insert(0, index)
    error_file = _write(out_dir, "rdp_bitmap_cache_errors.csv", ERROR_COLUMNS,
                        [[k, v] for k, v in sorted(errors.items())])
    if error_file:
        written.append(error_file)
    return written


def _render_sheet(Image, raw: bytes, tiles: list[Tile], target: Path) -> None:
    """One grid of tiles, in cache order, left to right and top to bottom."""
    sheet = Image.new("RGB", (SHEET_COLUMNS * TILE_SLOT, SHEET_ROWS * TILE_SLOT),
                      (17, 17, 17))
    for position, tile in enumerate(tiles):
        pixels = raw[tile.offset:tile.offset + tile.width * tile.height * BYTES_PER_PIXEL]
        # `raw` gives BGRX in memory order; `BGRX` tells Pillow to read it that
        # way rather than assuming RGBA and swapping red with blue. That
        # swap is not subtle once seen - a Windows title bar comes out orange -
        # but it is invisible in a test that only counts pixels.
        image = Image.frombytes("RGB", (tile.width, tile.height), pixels, "raw", "BGRX")
        sheet.paste(image, ((position % SHEET_COLUMNS) * TILE_SLOT,
                            (position // SHEET_COLUMNS) * TILE_SLOT))
    sheet.save(target, format="PNG", optimize=True)


def _relative(path: Path, base: Path | None) -> str:
    if base is None:
        return path.name
    try:
        return str(path.relative_to(base))
    except ValueError:
        return path.name


def _safe_stem(source: str) -> str:
    """
    A filename built from the artifact's whole relative path.

    Not just its name: a triage holds `Cache0000.bin` once per user profile and
    once more under `Windows.old`, and sheets named after the file alone would
    overwrite each other.
    """
    import re

    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", source).strip("_")
    return cleaned[-90:] or "cache"


def _write(out_dir: Path, filename: str, columns: list[str],
           rows: list[list[str]]) -> Path | None:
    if not rows:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / filename
    with target.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(columns)
        writer.writerows(rows)
    return target
