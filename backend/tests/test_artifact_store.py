"""
The artifact store.

Two claims are under test. The first is that Parquet materialisation is
**invisible**: the same query returns the same rows whether it reads the
conversion or scans the CSV. A cache that changes an answer is not a cache, it
is a bug that only shows up on the second click.

The second is that the interface is the boundary the roadmap says it is - the
router asks four questions and nothing else, so an Elasticsearch backend later
is a module, not a rewrite.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from app.services.store import Query, get_store
from app.services.store import duckdb_store as store_mod

CSV = (
    "Timestamp,Process Name,PID,CommandLine\n"
    "2026-01-01T10:00:00,powershell.exe,1042,powershell -enc SQBFAFgA\n"
    "2026-01-01T10:00:05,cmd.exe,2001,cmd /c whoami\n"
    "2026-01-01T10:01:00,powershell.exe,3011,powershell -File update.ps1\n"
    "2026-01-01T10:02:00,explorer.exe,900,explorer.exe\n"
)
COLUMNS = ["Timestamp", "Process_Name", "PID", "CommandLine"]


@pytest.fixture()
def artifact(tmp_path: Path) -> str:
    path = tmp_path / "processes.csv"
    path.write_text(CSV)
    return str(path)


@pytest.fixture()
def no_parquet(monkeypatch):
    """Force the CSV path, to compare it against the materialised one."""
    monkeypatch.setattr(settings, "artifact_store_parquet", False)


# ─── Schema ───────────────────────────────────────────────────────────────────

def test_column_names_are_normalised_for_rql(artifact):
    """
    `Process Name` cannot be written in an RQL expression; `Process_Name` can.
    Normalising at conversion time means the stored artifact already carries the
    name the analyst will type.
    """
    schema = get_store().schema(artifact)
    assert schema.columns == COLUMNS
    assert schema.row_count == 4


def test_an_unreadable_source_is_an_empty_schema_not_a_crash(tmp_path):
    assert get_store().schema(str(tmp_path / "missing.csv")).row_count == 0


# ─── Materialisation is invisible ─────────────────────────────────────────────

def _all_rows(source: str) -> list[dict]:
    return get_store().search(source, COLUMNS, Query(), page_size=100).rows


def test_parquet_and_csv_return_identical_rows(artifact, monkeypatch):
    monkeypatch.setattr(settings, "artifact_store_parquet", False)
    from_csv = _all_rows(artifact)

    monkeypatch.setattr(settings, "artifact_store_parquet", True)
    from_parquet = _all_rows(artifact)

    assert from_csv == from_parquet


def test_the_first_query_writes_the_conversion(artifact):
    cached = store_mod._parquet_path(Path(artifact))
    cached.unlink(missing_ok=True)

    get_store().schema(artifact)
    assert cached.exists()


def test_a_changed_source_invalidates_the_conversion(artifact, tmp_path):
    """
    Staleness is the failure that would be silent: the analyst re-imports a
    corrected file and keeps being shown the old one.
    """
    import os
    import time

    get_store().schema(artifact)
    cached = store_mod._parquet_path(Path(artifact))
    assert cached.exists()

    time.sleep(0.01)
    Path(artifact).write_text(CSV + "2026-01-01T10:03:00,rundll32.exe,4100,rundll32 evil.dll\n")
    os.utime(artifact, None)

    assert get_store().schema(artifact).row_count == 5


def test_a_half_written_conversion_is_never_used(artifact, monkeypatch):
    """
    A crash mid-conversion must not leave a file that looks like a valid cache.
    The conversion is written under a .partial name and renamed in.
    """
    cached = store_mod._parquet_path(Path(artifact))
    cached.unlink(missing_ok=True)
    partial = cached.with_suffix(".parquet.partial")

    real_duckdb = store_mod.duckdb

    class _Conn:
        """A connection that writes a partial file, then fails on the COPY."""

        def __init__(self):
            self._inner = real_duckdb.connect()

        def execute(self, sql, params=None):
            if "COPY" in str(sql):
                partial.write_bytes(b"PAR1-half-written")
                raise RuntimeError("disk full")
            return self._inner.execute(sql, params) if params is not None \
                else self._inner.execute(sql)

        def close(self):
            self._inner.close()

    # Patched on our module's global, not on the duckdb package: mutating the
    # shared module would break every other connection for the rest of the run.
    monkeypatch.setattr(store_mod, "duckdb", type("_Fake", (), {
        "connect": staticmethod(lambda *a, **k: _Conn()),
    }))

    assert store_mod.materialise(Path(artifact)) is None
    assert not cached.exists()
    assert not partial.exists()


def test_a_failed_conversion_still_answers_the_query(artifact, monkeypatch):
    """A cache that cannot be built is a performance problem, never a correctness one."""
    monkeypatch.setattr(store_mod, "materialise", lambda source: None)
    assert get_store().schema(artifact).row_count == 4


def test_dropping_the_cache_removes_the_conversion(artifact):
    get_store().schema(artifact)
    cached = store_mod._parquet_path(Path(artifact))
    assert cached.exists()

    store_mod.drop_cache(Path(artifact))
    assert not cached.exists()


def test_the_cache_filename_does_not_leak_the_source_path(artifact):
    """
    Source paths contain case ids and original filenames. A cache directory
    should not become a second, unmanaged record of who was investigated.
    """
    cached = store_mod._parquet_path(Path(artifact))
    assert "processes" not in cached.name
    assert cached.name.endswith(".parquet")


# ─── Search ───────────────────────────────────────────────────────────────────

def test_free_text_matches_across_every_column(artifact):
    page = get_store().search(artifact, COLUMNS, Query(text="whoami"))
    assert page.total == 1
    assert page.rows[0]["Process_Name"] == "cmd.exe"


def test_a_column_filter_narrows_to_that_column(artifact):
    page = get_store().search(artifact, COLUMNS, Query(column_filters={"Process_Name": "powershell"}))
    assert page.total == 2


def test_filters_and_rql_narrow_together(artifact):
    """
    The three inputs are ANDed. This is what the Explorer warns about: an OR
    inside the RQL can be narrowed by a column filter left set.
    """
    page = get_store().search(
        artifact, COLUMNS,
        Query(column_filters={"Process_Name": "powershell"},
              rql='CommandLine contains "-enc"'),
    )
    assert page.total == 1
    assert page.rows[0]["PID"] == "1042"


def test_paging_reports_the_total_behind_the_page(artifact):
    page = get_store().search(artifact, COLUMNS, Query(), page=1, page_size=2)
    assert page.total == 4
    assert page.pages == 2
    assert len(page.rows) == 2


def test_sorting_is_ignored_for_a_column_that_does_not_exist(artifact):
    """A stale sort column from a previous artifact must not fail the request."""
    page = get_store().search(artifact, COLUMNS, Query(), sort_col="NoSuchColumn")
    assert page.total == 4


def test_sort_direction_is_honoured(artifact):
    rows = get_store().search(artifact, COLUMNS, Query(), sort_col="PID", sort_dir="desc").rows
    assert rows[0]["PID"] == "900"     # string sort, as the column is cast to VARCHAR


def test_an_invalid_rql_expression_raises_for_the_router_to_report(artifact):
    from app.services.rql_parser import RQLSyntaxError

    with pytest.raises(RQLSyntaxError):
        get_store().search(artifact, COLUMNS, Query(rql="EventID ==== "))


# ─── Aggregate ────────────────────────────────────────────────────────────────

def test_aggregation_counts_each_distinct_value(artifact):
    groups = get_store().aggregate(artifact, COLUMNS, Query(), ["Process_Name"])
    counts = {g.values["Process_Name"]: g.count for g in groups}
    assert counts == {"cmd.exe": 1, "explorer.exe": 1, "powershell.exe": 2}


def test_aggregation_respects_the_filter(artifact):
    groups = get_store().aggregate(
        artifact, COLUMNS, Query(text="powershell"), ["Process_Name"])
    assert {g.values["Process_Name"] for g in groups} == {"powershell.exe"}


def test_grouping_by_an_unknown_column_returns_nothing(artifact):
    assert get_store().aggregate(artifact, COLUMNS, Query(), ["NoSuchColumn"]) == []


# ─── Find ─────────────────────────────────────────────────────────────────────

def test_find_reports_the_full_hit_count_not_the_page(artifact):
    """
    The cross-artifact search ranks files by how many hits they have. Capping
    the count at the rows returned would rank a file with 10,000 hits alongside
    one with 50.
    """
    count, rows = get_store().find(artifact, COLUMNS, "powershell", limit=1)
    assert count == 2
    assert len(rows) == 1


def test_find_supports_a_regex(artifact):
    count, _ = get_store().find(artifact, COLUMNS, r"^\d{4}$", limit=10, regex=True)
    assert count >= 1


def test_find_with_no_columns_returns_nothing(artifact):
    assert get_store().find(artifact, [], "anything") == (0, [])


# ─── Source timezone ──────────────────────────────────────────────────────────
# The setting existed, was stored, was shown as a badge, and was applied by
# nothing. A collection from a machine in Paris and one from New York answered
# the same range filter differently and neither said so.

TZ_CSV = (
    "Timestamp,Process,Note\n"
    "2026-01-01T10:00:00,cmd.exe,winter\n"      # CET, UTC+1
    "2026-07-01T10:00:00,powershell.exe,summer\n"  # CEST, UTC+2
    "not a timestamp,explorer.exe,free text\n"
)
TZ_COLUMNS = ["Timestamp", "Process", "Note"]


@pytest.fixture()
def paris(tmp_path: Path) -> str:
    path = tmp_path / "paris.csv"
    path.write_text(TZ_CSV)
    return str(path)


def _timestamps(source) -> list[str]:
    return [
        row["Timestamp"]
        for row in get_store().search(source, TZ_COLUMNS, Query(), page_size=10).rows
    ]


def test_an_artifact_with_no_declared_zone_is_read_as_written():
    """The default has to stay exactly what it was: no conversion at all."""
    from app.services.store import Source

    assert Source(ref="x").needs_normalising is False
    assert Source(ref="x", date_column="Timestamp").needs_normalising is False
    assert Source(ref="x", date_column="Timestamp", timezone="UTC").needs_normalising is False
    assert Source(ref="x", date_column="Timestamp", timezone="Europe/Paris").needs_normalising


def test_a_declared_zone_converts_the_date_column_to_utc(paris):
    from app.services.store import Source

    source = Source(ref=paris, date_column="Timestamp", timezone="Europe/Paris")

    assert _timestamps(source)[0] == "2026-01-01 09:00:00"


def test_the_conversion_follows_daylight_saving(paris):
    """
    A fixed offset would be wrong for half the year, and a collection spanning
    the change would be wrong on one side of it. Paris is UTC+1 in January and
    UTC+2 in July.
    """
    from app.services.store import Source

    winter, summer, _ = _timestamps(
        Source(ref=paris, date_column="Timestamp", timezone="Europe/Paris"))

    assert winter == "2026-01-01 09:00:00"
    assert summer == "2026-07-01 08:00:00"


def test_a_value_that_is_not_a_timestamp_survives_untouched(paris):
    """
    A column that is only sometimes a date must not lose the rows that are not.
    Dropping them would silently shrink an artifact.
    """
    from app.services.store import Source

    assert _timestamps(
        Source(ref=paris, date_column="Timestamp", timezone="Europe/Paris"))[2] == "not a timestamp"


def test_only_the_date_column_is_converted(paris):
    """A timestamp inside a free-text field is not ours to reinterpret."""
    from app.services.store import Source

    rows = get_store().search(
        Source(ref=paris, date_column="Timestamp", timezone="Europe/Paris"),
        TZ_COLUMNS, Query(), page_size=10).rows

    assert [r["Note"] for r in rows] == ["winter", "summer", "free text"]
    assert [r["Process"] for r in rows] == ["cmd.exe", "powershell.exe", "explorer.exe"]


def test_a_date_column_the_file_does_not_have_is_not_an_error(paris):
    """
    A stored record can name a column a re-imported file no longer carries.
    Normalising nothing is right; refusing the query would hide the artifact.
    """
    from app.services.store import Source

    source = Source(ref=paris, date_column="Gone", timezone="Europe/Paris")

    assert _timestamps(source) == ["2026-01-01T10:00:00", "2026-07-01T10:00:00",
                                   "not a timestamp"]


def test_an_unknown_zone_is_refused_rather_than_ignored(paris):
    """
    A view definition cannot carry a prepared parameter, so the zone reaches
    SQL inlined. It is validated against the system tz database first - which
    is both the correct check and the narrow one.
    """
    from app.services.store import Source

    with pytest.raises(ValueError, match="not a known time zone"):
        _timestamps(Source(ref=paris, date_column="Timestamp",
                           timezone="Nowhere/Fictional"))


def test_the_conversion_applies_to_search_and_grouping_too(paris):
    """
    One artifact must not answer two different questions about the same
    timestamp depending on which endpoint asked.
    """
    from app.services.store import Source

    source = Source(ref=paris, date_column="Timestamp", timezone="Europe/Paris")

    count, rows = get_store().find(source, TZ_COLUMNS, "09:00:00")
    assert count == 1 and rows[0]["Process"] == "cmd.exe"

    groups = get_store().aggregate(source, TZ_COLUMNS, Query(), ["Timestamp"])
    assert "2026-01-01 09:00:00" in {g.values["Timestamp"] for g in groups}


def test_changing_the_declared_zone_needs_no_re_import(paris):
    """
    The conversion is applied on the way out, so a zone corrected after the
    fact takes effect on the next query - no re-import, and no cache to
    invalidate. That is the whole reason it is not done at conversion time.
    """
    from app.services.store import Source

    get_store().schema(paris)   # force the Parquet conversion to exist

    as_paris = _timestamps(Source(ref=paris, date_column="Timestamp",
                                  timezone="Europe/Paris"))
    as_tokyo = _timestamps(Source(ref=paris, date_column="Timestamp",
                                  timezone="Asia/Tokyo"))

    assert as_paris[0] == "2026-01-01 09:00:00"
    assert as_tokyo[0] == "2026-01-01 01:00:00"


def test_a_bare_path_still_works_everywhere(paris):
    """
    The interface takes a path or a Source. Every existing caller passes a
    path, and none of them may change behaviour.
    """
    assert _timestamps(paris) == ["2026-01-01T10:00:00", "2026-07-01T10:00:00",
                                  "not a timestamp"]
    assert get_store().schema(paris).columns == TZ_COLUMNS
