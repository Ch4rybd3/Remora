"""
The RDP bitmap cache, and any SQLite database.

Together these are 657 MB of the 743 MB a real triage left unread. They have
nothing in common as formats and everything in common as a problem: both are
artifacts nobody had written a reader for, and both are read here without
guessing at what the bytes mean.

The cache format was established from the files rather than assumed - see the
module docstring - and the checks that established it are repeated here as
tests, because a bitmap decoder that is subtly wrong produces pictures that
look like pictures.
"""
from __future__ import annotations

import csv
import sqlite3
import struct

import pytest

from app.services.ingest.identify import identify
from app.services.ingest.python_parsers import rdp_cache, sqlite_tables
from app.services.ingest.routing import route_for

# ─── Building a cache ─────────────────────────────────────────────────────────

def tile(width: int = 64, height: int = 64, colour: tuple[int, int, int] = (10, 20, 30),
         key: tuple[int, int] = (1, 2)) -> bytes:
    """One tile: header, then BGRX pixels."""
    blue, green, red = colour
    pixel = bytes([blue, green, red, 0xFF])
    return struct.pack("<IIHH", key[0], key[1], width, height) + pixel * (width * height)


def cache(*tiles: bytes) -> bytes:
    return rdp_cache.MAGIC + b"\x06\x00\x00\x00" + b"".join(tiles)


def rows_of(path):
    return list(csv.DictReader(path.open(encoding="utf-8")))


# ─── Reading the container ────────────────────────────────────────────────────

def test_a_cache_is_recognised_by_its_container_not_its_name(tmp_path):
    """
    The file is called `Cache0000.bin`, which says nothing. Six of them in the
    reference triage, under two different user profiles.
    """
    path = tmp_path / "Cache0000.bin"
    path.write_bytes(cache(tile()))

    assert identify(path).kind == "rdp_bitmap_cache"


def test_tiles_are_read_with_the_dimensions_each_one_declares(tmp_path):
    """
    Not all of them are 64x64. The reference cache holds 64x32, 48x64 and
    48x32 tiles as well, and assuming a fixed size - which a first look at the
    data invites - would desynchronise the whole file after the first one.
    """
    raw = cache(tile(64, 64), tile(64, 32), tile(48, 64), tile(48, 32))
    tiles = rdp_cache.read_tiles(raw)

    assert [(t.width, t.height) for t in tiles] == [(64, 64), (64, 32), (48, 64), (48, 32)]


def test_a_partial_tail_stops_the_read_rather_than_being_invented(tmp_path):
    """
    The cache is a ring buffer and its tail is usually half a tile. Reading
    past it would be inventing pixels.
    """
    raw = cache(tile()) + struct.pack("<IIHH", 9, 9, 64, 64) + b"\x00" * 100
    tiles = rdp_cache.read_tiles(raw)

    assert len(tiles) == 1


def test_an_absurd_header_stops_the_read(tmp_path):
    """
    A misread offset yields a width of 45,517 and a height of 65,469 - measured,
    from testing a wrong hypothesis against the real file. Refusing it is what
    stops one bad offset becoming a multi-gigabyte allocation.
    """
    raw = cache(tile()) + struct.pack("<IIHH", 0, 0, 45517, 65469) + b"\x00" * 64
    assert len(rdp_cache.read_tiles(raw)) == 1


def test_a_file_that_is_not_a_cache_is_refused():
    with pytest.raises(ValueError, match="Not an RDP8"):
        rdp_cache.read_tiles(b"NOTACACHE" + b"\x00" * 64)


def test_a_uniform_tile_is_flagged_rather_than_dropped(tmp_path):
    """
    139 of the 38,724 tiles in the reference triage are a single colour. They
    are still tiles the cache held, so they are kept - and flagged, because an
    analyst scanning for content wants them out of the way.
    """
    raw = cache(tile(colour=(255, 255, 255)))
    assert rdp_cache.read_tiles(raw)[0].blank is True


# ─── Rendering ────────────────────────────────────────────────────────────────

def test_the_pixels_come_out_in_the_right_order(tmp_path):
    """
    The one that cannot be caught by counting.

    The bytes are blue, green, red, padding. Read as RGBA instead, every
    picture still renders - a Windows title bar simply comes out orange, and no
    test that counts pixels notices. This asserts a known red tile is red.
    """
    from PIL import Image

    red_in_bgr = (0, 0, 255)          # blue=0, green=0, red=255
    source = tmp_path / "Cache0000.bin"
    source.write_bytes(cache(tile(colour=red_in_bgr)))

    rdp_cache.parse_all([source], tmp_path / "out", base=tmp_path)
    sheet = next((tmp_path / "out").glob("*.png"))

    assert Image.open(sheet).convert("RGB").getpixel((0, 0)) == (255, 0, 0)


def test_the_alpha_byte_is_padding_not_transparency(tmp_path):
    """
    Every tile sampled from the reference cache has 0xFF in the fourth byte.
    Treating it as alpha would make the sheets composite against their
    background instead of showing the tile.
    """
    from PIL import Image

    source = tmp_path / "Cache0000.bin"
    source.write_bytes(cache(tile(colour=(200, 100, 50))))

    rdp_cache.parse_all([source], tmp_path / "out", base=tmp_path)
    sheet = Image.open(next((tmp_path / "out").glob("*.png")))

    assert sheet.mode == "RGB"
    assert sheet.getpixel((0, 0)) == (50, 100, 200)


def test_tiles_are_laid_out_in_cache_order(tmp_path):
    """
    Cache order is roughly chronological - a tile is rewritten when its screen
    region changes - and it is the only ordering the artifact carries. Sorting
    would throw it away.
    """
    source = tmp_path / "Cache0000.bin"
    source.write_bytes(cache(tile(colour=(0, 0, 255)), tile(colour=(255, 0, 0))))

    rdp_cache.parse_all([source], tmp_path / "out", base=tmp_path)
    index = rows_of(tmp_path / "out" / "rdp_bitmap_cache.csv")

    assert [r["TileIndex"] for r in index] == ["0", "1"]
    assert [(r["SheetRow"], r["SheetColumn"]) for r in index] == [("0", "0"), ("0", "1")]


def test_two_caches_of_the_same_name_do_not_overwrite_each_other(tmp_path):
    """
    A triage holds `Cache0000.bin` once per user profile and once more under
    `Windows.old`. Sheets named after the file alone would collide.
    """
    for profile in ("fsali", "other"):
        path = tmp_path / "C" / "Users" / profile / "Cache0000.bin"
        path.parent.mkdir(parents=True)
        path.write_bytes(cache(tile()))

    written = rdp_cache.parse_all(sorted(tmp_path.rglob("Cache0000.bin")),
                                  tmp_path / "out", base=tmp_path)
    sheets = [p.name for p in written if p.suffix == ".png"]

    assert len(sheets) == 2
    assert len(set(sheets)) == 2


def test_the_index_names_the_sheet_each_tile_is_on(tmp_path):
    """The index is what makes a row locatable in a picture."""
    source = tmp_path / "Cache0000.bin"
    source.write_bytes(cache(tile()))

    rdp_cache.parse_all([source], tmp_path / "out", base=tmp_path)
    row = rows_of(tmp_path / "out" / "rdp_bitmap_cache.csv")[0]

    assert (tmp_path / "out" / row["Sheet"]).exists()
    assert row["CacheKey"] == "0000000100000002"


def test_a_cache_that_will_not_read_is_named_in_the_output(tmp_path):
    good = tmp_path / "Cache0000.bin"
    good.write_bytes(cache(tile()))
    bad = tmp_path / "Cache0001.bin"
    bad.write_bytes(b"garbage" * 32)

    written = rdp_cache.parse_all([good, bad], tmp_path / "out", base=tmp_path)
    names = {p.name for p in written}

    assert "rdp_bitmap_cache.csv" in names
    assert "rdp_bitmap_cache_errors.csv" in names
    assert "Cache0001.bin" in (tmp_path / "out" / "rdp_bitmap_cache_errors.csv").read_text()


def test_the_cache_reaches_both_a_table_and_its_own_page():
    route = route_for("rdp_bitmap_cache")
    assert route.parser == "rdp_cache"
    assert "/artifacts/rdp-cache" in route.pages
    assert "/artifacts/explorer" in route.pages


# ─── SQLite ───────────────────────────────────────────────────────────────────

def make_db(path, tables: dict[str, list[tuple]]) -> None:
    connection = sqlite3.connect(path)
    for name, rows in tables.items():
        connection.execute(f"CREATE TABLE {name} (a TEXT, b INTEGER)")
        connection.executemany(f"INSERT INTO {name} VALUES (?, ?)", rows)
    connection.commit()
    connection.close()


def test_every_table_becomes_a_file_named_for_both(tmp_path):
    """
    Per database *and* per table. Two applications both having a `settings`
    table is the normal case, and their columns have nothing to do with each
    other.
    """
    source = tmp_path / "app.sqlite"
    make_db(source, {"messages": [("hi", 1)], "settings": [("theme", 2)]})

    written = sqlite_tables.parse_all([source], tmp_path / "out",
                                      tmp_path / "scratch", base=tmp_path)
    names = {p.name for p in written}

    assert any("messages" in n for n in names)
    assert any("settings" in n for n in names)
    assert all(n.startswith("sqlite_") for n in names)


def test_the_database_is_copied_before_it_is_opened(tmp_path):
    """
    SQLite replays its write-ahead log on open, and that is a write. On
    evidence it is a modification; on a read-only mount it is an error.
    """
    source = tmp_path / "app.sqlite"
    make_db(source, {"t": [("x", 1)]})
    before = source.read_bytes()

    sqlite_tables.parse_all([source], tmp_path / "out", tmp_path / "scratch",
                            base=tmp_path)

    assert source.read_bytes() == before
    assert (tmp_path / "scratch").exists()


def test_sqlite_internal_tables_are_left_out(tmp_path):
    source = tmp_path / "app.sqlite"
    make_db(source, {"real": [("x", 1)]})
    connection = sqlite3.connect(source)
    connection.execute("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT)")
    connection.commit()
    connection.close()

    written = sqlite_tables.parse_all([source], tmp_path / "out",
                                      tmp_path / "scratch", base=tmp_path)
    assert not any("sqlite_sequence" in p.name for p in written)


def test_a_row_cap_applies(tmp_path, monkeypatch):
    monkeypatch.setattr(sqlite_tables, "MAX_ROWS_PER_TABLE", 3)
    source = tmp_path / "big.sqlite"
    make_db(source, {"t": [(str(i), i) for i in range(50)]})

    written = sqlite_tables.parse_all([source], tmp_path / "out",
                                      tmp_path / "scratch", base=tmp_path)
    assert len(rows_of(written[0])) == 3


def test_a_blob_column_is_hex_not_a_mangled_string(tmp_path):
    """A blob decoded as text is a value that reads as data and is not."""
    source = tmp_path / "app.sqlite"
    connection = sqlite3.connect(source)
    connection.execute("CREATE TABLE t (blob BLOB)")
    connection.execute("INSERT INTO t VALUES (?)", (b"\x00\x01\xff",))
    connection.commit()
    connection.close()

    written = sqlite_tables.parse_all([source], tmp_path / "out",
                                      tmp_path / "scratch", base=tmp_path)
    assert rows_of(written[0])[0]["blob"] == "00 01 ff"


def test_a_file_that_is_not_a_database_is_named_not_silent(tmp_path):
    source = tmp_path / "broken.sqlite"
    source.write_bytes(b"SQLite format 3\x00" + b"\xff" * 200)

    written = sqlite_tables.parse_all([source], tmp_path / "out",
                                      tmp_path / "scratch", base=tmp_path)
    assert [p.name for p in written] == ["sqlite_errors.csv"]


def test_a_database_with_a_dedicated_reader_never_reaches_the_generic_one(tmp_path):
    """
    Identification refines a SQLite container by name before routing it, so
    browser history keeps the parser that understands what its columns mean.
    """
    for name, expected in [("places.sqlite", "browser_history"),
                           ("History", "browser_history"),
                           ("Cookies", "browser_cookies"),
                           ("ActivitiesCache.db", "windows_timeline")]:
        path = tmp_path / name
        make_db(path, {"t": [("x", 1)]})
        assert identify(path).kind == expected, name

    plain = tmp_path / "permissions.sqlite"
    make_db(plain, {"t": [("x", 1)]})
    assert identify(plain).kind == "sqlite"


def test_a_plain_database_now_reaches_the_explorer():
    route = route_for("sqlite")
    assert route.parser == "sqlite_tables"
    assert route.to_explorer
