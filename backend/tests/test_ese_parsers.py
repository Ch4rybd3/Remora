"""
ESE databases: SRUM, the web cache, and the rest of the format.

One dependency covers four artifact classes. What is tested here is **not**
`dissect.esedb`'s parsing - that is the library's job and mocking it would test
the mock. It is the layer above: which tables become which files, what happens
when one of them will not read, and the two decisions that turn a table of
integers into something an analyst can use.

Both of those decisions came out of running this against a real 39 MB
`SRUDB.dat` and two `WebCacheV01.dat` files, and both were wrong first time.
"""
from __future__ import annotations

import csv
from datetime import UTC, datetime

import pytest

from app.services.ingest.python_parsers import ese
from app.services.ingest.routing import route_for

# ─── Stand-ins ────────────────────────────────────────────────────────────────
# Shaped like `dissect.esedb`, and deliberately able to fail the way the real
# one does: a container table that raises partway through iteration.

class FakeRecord:
    def __init__(self, values: dict, raises: set[str] | None = None):
        self._values = values
        self._raises = raises or set()

    def get(self, column: str):
        if column in self._raises:
            raise TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'")
        return self._values.get(column)


class FakeTable:
    def __init__(self, name: str, columns: list[str], rows: list[dict],
                 fail_after: int | None = None):
        self.name = name
        self.column_names = columns
        self._rows = rows
        self._fail_after = fail_after

    def records(self):
        for i, values in enumerate(self._rows):
            if self._fail_after is not None and i >= self._fail_after:
                raise TypeError("unsupported operand type(s) for +: 'NoneType' and 'int'")
            yield FakeRecord(values)


class FakeDB:
    def __init__(self, tables: list[FakeTable]):
        self._tables = tables

    def tables(self):
        return self._tables

    def table(self, name: str):
        for t in self._tables:
            if t.name == name:
                return t
        raise KeyError(name)


def rows_of(path):
    return list(csv.DictReader(path.open(encoding="utf-8")))


# ─── The generic reader ───────────────────────────────────────────────────────

def test_every_table_becomes_its_own_file(tmp_path, monkeypatch):
    db = FakeDB([
        FakeTable("Accounts", ["Name", "Rid"], [{"Name": "svc", "Rid": 1001}]),
        FakeTable("Groups", ["Name"], [{"Name": "Admins"}]),
    ])
    monkeypatch.setattr(ese, "EseDB", lambda fh: db)
    source = tmp_path / "NTDS.dit"
    source.write_bytes(b"\x00" * 16)

    written = ese.dump_tables([source], tmp_path / "out", base=tmp_path)

    assert {p.name for p in written} == {"ese_Accounts.csv", "ese_Groups.csv"}
    assert rows_of(written[0])[0]["Name"] == "svc"


def test_engine_bookkeeping_tables_are_left_out(tmp_path, monkeypatch):
    """
    `MSysObjects` is in every ESE file and describes the file, not the machine.
    Emitting it would put a table about page layout beside a table about who
    logged in.
    """
    db = FakeDB([
        FakeTable("MSysObjects", ["ObjidTable"], [{"ObjidTable": 1}]),
        FakeTable("Real", ["A"], [{"A": "x"}]),
    ])
    monkeypatch.setattr(ese, "EseDB", lambda fh: db)
    source = tmp_path / "Windows.edb"
    source.write_bytes(b"\x00" * 16)

    written = ese.dump_tables([source], tmp_path / "out", base=tmp_path)
    assert [p.name for p in written] == ["ese_Real.csv"]


def test_a_table_that_stops_early_keeps_what_it_read(tmp_path, monkeypatch):
    """
    The failure that cost fifty-one containers.

    Catching per file meant one unreadable table threw away every other table
    in the database. Whatever was read before the failure is written, and the
    failure is named in the output.
    """
    db = FakeDB([
        FakeTable("Broken", ["A"], [{"A": "1"}, {"A": "2"}, {"A": "3"}], fail_after=2),
        FakeTable("Fine", ["A"], [{"A": "ok"}]),
    ])
    monkeypatch.setattr(ese, "EseDB", lambda fh: db)
    source = tmp_path / "thing.edb"
    source.write_bytes(b"\x00" * 16)

    written = ese.dump_tables([source], tmp_path / "out", base=tmp_path)
    names = {p.name for p in written}

    assert "ese_Fine.csv" in names, "one bad table must not cost the good ones"
    assert len(rows_of(tmp_path / "out" / "ese_Broken.csv")) == 2
    assert "ese_errors.csv" in names
    assert "Broken" in (tmp_path / "out" / "ese_errors.csv").read_text()


def test_a_database_that_will_not_open_is_named_not_silent(tmp_path, monkeypatch):
    def explode(fh):
        raise ValueError("not an ESE database")
    monkeypatch.setattr(ese, "EseDB", explode)
    source = tmp_path / "broken.edb"
    source.write_bytes(b"\x00" * 16)

    written = ese.dump_tables([source], tmp_path / "out", base=tmp_path)
    assert [p.name for p in written] == ["ese_errors.csv"]


def test_a_row_cap_stops_a_search_index_from_becoming_a_gigabyte(tmp_path, monkeypatch):
    monkeypatch.setattr(ese, "MAX_ROWS_PER_TABLE", 5)
    db = FakeDB([FakeTable("Big", ["A"], [{"A": str(i)} for i in range(50)])])
    monkeypatch.setattr(ese, "EseDB", lambda fh: db)
    source = tmp_path / "Windows.edb"
    source.write_bytes(b"\x00" * 16)

    ese.dump_tables([source], tmp_path / "out", base=tmp_path)
    assert len(rows_of(tmp_path / "out" / "ese_Big.csv")) == 5


def test_a_huge_cell_is_cut_rather_than_written_whole(tmp_path, monkeypatch):
    db = FakeDB([FakeTable("T", ["Blob"], [{"Blob": "x" * 50_000}])])
    monkeypatch.setattr(ese, "EseDB", lambda fh: db)
    source = tmp_path / "t.edb"
    source.write_bytes(b"\x00" * 16)

    ese.dump_tables([source], tmp_path / "out", base=tmp_path)
    cell = rows_of(tmp_path / "out" / "ese_T.csv")[0]["Blob"]
    assert len(cell) == ese.MAX_CELL_CHARS


# ─── The web cache ────────────────────────────────────────────────────────────

def _webcache_db(fail_after: int | None = None) -> FakeDB:
    return FakeDB([
        FakeTable("Containers",
                  ["ContainerId", "Name", "Directory"],
                  [{"ContainerId": 1, "Name": "History", "Directory": "C:\\H"},
                   {"ContainerId": 2, "Name": "Cookies", "Directory": "C:\\C"}]),
        FakeTable("Container_1", ["EntryId", "Url", "AccessedTime", "ResponseHeaders"],
                  [{"EntryId": 1, "Url": "http://evil.test/",
                    "AccessedTime": 133_000_000_000_000_000,
                    "ResponseHeaders": b"\x00\x01"}]),
        FakeTable("Container_2", ["EntryId", "Url", "AccessedTime", "ResponseHeaders"],
                  [{"EntryId": 2, "Url": "http://other.test/", "AccessedTime": 0,
                    "ResponseHeaders": b""}],
                  fail_after=fail_after),
    ])


def test_the_container_name_becomes_a_column(tmp_path, monkeypatch):
    """
    `Container_1` and `Container_843` share a schema and differ only in what
    they hold. Which number History landed on varies by machine, so filtering
    to history has to be a filter on a value, not on a filename.
    """
    monkeypatch.setattr(ese, "EseDB", lambda fh: _webcache_db())
    source = tmp_path / "WebCacheV01.dat"
    source.write_bytes(b"\x00" * 16)

    ese.parse_webcache([source], tmp_path / "out", base=tmp_path)
    rows = rows_of(tmp_path / "out" / "webcache_entries.csv")

    assert {r["Container"] for r in rows} == {"History", "Cookies"}
    assert rows[0]["ContainerDirectory"] == "C:\\H"


def test_one_unreadable_container_does_not_cost_the_others(tmp_path, monkeypatch):
    """
    Measured: 16 of 52 containers in a real database raise inside the library.
    Catching per file recovered 185 entries; catching per container, 378.
    """
    monkeypatch.setattr(ese, "EseDB", lambda fh: _webcache_db(fail_after=0))
    source = tmp_path / "WebCacheV01.dat"
    source.write_bytes(b"\x00" * 16)

    ese.parse_webcache([source], tmp_path / "out", base=tmp_path)
    rows = rows_of(tmp_path / "out" / "webcache_entries.csv")

    assert [r["Container"] for r in rows] == ["History"]
    assert "Container_2" in (tmp_path / "out" / "webcache_errors.csv").read_text()


def test_cache_timestamps_are_readable_dates(tmp_path, monkeypatch):
    monkeypatch.setattr(ese, "EseDB", lambda fh: _webcache_db())
    source = tmp_path / "WebCacheV01.dat"
    source.write_bytes(b"\x00" * 16)

    ese.parse_webcache([source], tmp_path / "out", base=tmp_path)
    rows = rows_of(tmp_path / "out" / "webcache_entries.csv")

    assert rows[0]["AccessedTime"].startswith("2022-")


def test_binary_noise_columns_are_left_out(tmp_path, monkeypatch):
    """
    Response headers render as an escaped byte string and push the URL off the
    screen. The columns an analyst reads have to fit.
    """
    monkeypatch.setattr(ese, "EseDB", lambda fh: _webcache_db())
    source = tmp_path / "WebCacheV01.dat"
    source.write_bytes(b"\x00" * 16)

    ese.parse_webcache([source], tmp_path / "out", base=tmp_path)
    rows = rows_of(tmp_path / "out" / "webcache_entries.csv")

    assert "ResponseHeaders" not in rows[0]
    assert "Url" in rows[0]


def test_the_container_index_is_written_too(tmp_path, monkeypatch):
    monkeypatch.setattr(ese, "EseDB", lambda fh: _webcache_db())
    source = tmp_path / "WebCacheV01.dat"
    source.write_bytes(b"\x00" * 16)

    written = ese.parse_webcache([source], tmp_path / "out", base=tmp_path)
    assert "webcache_containers.csv" in {p.name for p in written}


# ─── SRUM ─────────────────────────────────────────────────────────────────────

class FakeEntry:
    def __init__(self, resolved: dict, raw: dict):
        self._resolved = resolved
        self.record = FakeRecord(raw)

    def __getitem__(self, column):
        return self._resolved.get(column)


def test_an_identifier_that_will_not_resolve_keeps_its_number():
    """
    About 4% of `network_data` rows point at an id map entry with an empty
    blob. The helper returns None for those, and an empty cell would lose the
    fact that the row *has* an application id - the raw number correlates
    across rows, a blank does not.
    """
    entry = FakeEntry(resolved={"AppId": None, "BytesSent": 12},
                      raw={"AppId": 1, "BytesSent": 12})

    assert ese._srum_cell(None, entry, "AppId") == "1"
    assert ese._srum_cell(None, entry, "BytesSent") == "12"


def test_a_resolved_identifier_is_used_when_there_is_one():
    entry = FakeEntry(resolved={"AppId": "\\device\\harddiskvolume3\\discord.exe"},
                      raw={"AppId": 4242})

    assert ese._srum_cell(None, entry, "AppId").endswith("discord.exe")


def test_each_provider_gets_its_own_table(tmp_path, monkeypatch):
    """
    The providers hold genuinely different columns - bytes on a wire, energy
    drawn from a battery. One wide table would be mostly empty.
    """
    network = FakeTable("{973F5D5C-1D90-4944-BE8E-24B94231A174}",
                        ["TimeStamp", "AppId", "BytesSent"], [])
    energy  = FakeTable("{FEE4E14F-02A9-4550-B5CE-5FA2DA202E37}",
                        ["TimeStamp", "AppId", "ChargeLevel"], [])

    class FakeSRU:
        def __init__(self, fh):
            self.esedb = FakeDB([network, energy])

        def get_table_entries(self, table):
            values = {c: f"v-{c}" for c in table.column_names}
            yield FakeEntry(resolved=values, raw=values)

    monkeypatch.setattr(ese, "SRU", FakeSRU)
    source = tmp_path / "SRUDB.dat"
    source.write_bytes(b"\x00" * 16)

    written = ese.parse_srum([source], tmp_path / "out", base=tmp_path)
    names = {p.name for p in written}

    assert names == {"srum_network_data.csv", "srum_energy_usage.csv"}
    assert "Provider" in rows_of(tmp_path / "out" / "srum_network_data.csv")[0]


def test_a_provider_that_stops_early_does_not_cost_the_others(tmp_path, monkeypatch):
    good = FakeTable("{973F5D5C-1D90-4944-BE8E-24B94231A174}", ["AppId"], [])
    bad  = FakeTable("{D10CA2FE-6FCF-4F6D-848E-B2E99266FA89}", ["AppId"], [])

    class FakeSRU:
        def __init__(self, fh):
            self.esedb = FakeDB([bad, good])

        def get_table_entries(self, table):
            if table is bad:
                raise TypeError("boom")
            yield FakeEntry(resolved={"AppId": "x"}, raw={"AppId": 1})

    monkeypatch.setattr(ese, "SRU", FakeSRU)
    source = tmp_path / "SRUDB.dat"
    source.write_bytes(b"\x00" * 16)

    written = ese.parse_srum([source], tmp_path / "out", base=tmp_path)
    names = {p.name for p in written}

    assert "srum_network_data.csv" in names
    assert "srum_errors.csv" in names


# ─── Timestamps and routing ───────────────────────────────────────────────────

@pytest.mark.parametrize("value", [0, -1, None, "not a number"])
def test_a_value_that_is_not_a_filetime_is_left_alone(value):
    """
    Turning an unconvertible value into a plausible date would be inventing
    evidence. A timestamp that does not convert is itself a fact.
    """
    assert not str(ese._filetime(value)).startswith("1601-")


def test_a_real_filetime_converts():
    assert ese._filetime(133_000_000_000_000_000).startswith("2022-")


def test_a_datetime_survives_as_an_iso_string():
    assert ese._cell(datetime(2026, 1, 2, 3, 4, tzinfo=UTC)) == "2026-01-02T03:04:00+00:00"


def test_the_whole_ese_family_now_reaches_a_parser():
    for kind, parser in [("srum", "srum"), ("browser_cache", "webcache"),
                         ("ese", "ese_tables"), ("ntds", "ese_tables"),
                         ("search_index", "ese_tables")]:
        route = route_for(kind)
        assert route.parser == parser, kind
        assert route.to_explorer, kind
        assert not route.pending, kind
