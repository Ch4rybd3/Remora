"""
DuckDB implementation of `ArtifactStore`, with a Parquet cache.

The problem it solves: every query used to run
`CREATE TEMP TABLE _src AS SELECT * FROM read_csv_auto(...)`. That re-reads and
re-parses the **entire** CSV on every page turn, every sort, every filter
keystroke - so a 200 MB artifact paid full parse cost to return 100 rows, and
the cost did not fall as the analyst narrowed the query.

So the first query materialises the file as Parquet once, and every query after
it reads that. Parquet is columnar and typed: a filter on one column touches one
column, and nothing is re-parsed. The conversion runs through the same
`read_csv_auto` call the queries used to, so DuckDB infers exactly the same
types and no comparison changes meaning - which is the only reason this is safe
to do underneath a running product.

The cache is derived data. Deleting it costs one re-conversion and nothing else,
which is why it lives outside the evidence and collection directories: nothing
in it is evidence.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import duckdb

from ...config import settings
from .base import Group, Page, Query, Schema, SourceMissing


#: Cache directory for materialised artifacts. Derived data only.
def _cache_dir() -> Path:
    path = settings.case_data_path / "parquet-cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def normalize_column(name: str) -> str:
    """
    Whitespace to underscores, so a column name is a usable RQL identifier.

    `Process Name` cannot be written in an RQL expression; `Process_Name` can.
    Applied at conversion time so the stored artifact already carries the name
    the analyst will type.
    """
    return re.sub(r"\s+", "_", name)


# ─── Materialisation ──────────────────────────────────────────────────────────

def _parquet_path(source: Path) -> Path:
    """
    A cache filename derived from the absolute source path.

    Hashed rather than mirrored: source paths contain case ids and original
    filenames, and a cache directory should not be a second, unmanaged copy of
    who was investigated for what.
    """
    digest = hashlib.sha256(str(source.resolve()).encode()).hexdigest()[:32]
    return _cache_dir() / f"{digest}.parquet"


def _is_fresh(cached: Path, source: Path) -> bool:
    """Stale if the source changed after the cache was written."""
    try:
        return cached.exists() and cached.stat().st_mtime >= source.stat().st_mtime
    except OSError:
        return False


def materialise(source: Path) -> Path | None:
    """
    Convert the source to Parquet, or return the existing conversion.

    Returns None when conversion is not possible or not wanted, and the caller
    falls back to reading the CSV directly. A cache that cannot be built is a
    performance problem, never a correctness one.
    """
    if not settings.artifact_store_parquet:
        return None
    if source.suffix.lower() == ".parquet":
        return source

    cached = _parquet_path(source)
    if _is_fresh(cached, source):
        return cached

    # Write to a temporary name and rename in: a half-written Parquet left by a
    # crash would otherwise be picked up as a valid cache on the next query.
    staging = cached.with_suffix(".parquet.partial")
    conn = duckdb.connect()
    try:
        conn.execute(
            "CREATE TEMP TABLE _src AS "
            "SELECT * FROM read_csv_auto(?, ignore_errors=true)",
            [str(source)],
        )
        for raw in [row[0] for row in conn.execute("DESCRIBE _src").fetchall()]:
            norm = normalize_column(raw)
            if norm != raw:
                conn.execute(f'ALTER TABLE _src RENAME COLUMN "{raw}" TO "{norm}"')
        conn.execute("COPY _src TO ? (FORMAT PARQUET, COMPRESSION ZSTD)", [str(staging)])
        staging.replace(cached)
        return cached
    except Exception as e:
        staging.unlink(missing_ok=True)
        print(f"[store] could not materialise {source.name}, reading it directly: {e}",
              flush=True)
        return None
    finally:
        conn.close()


def drop_cache(source: Path) -> bool:
    """Forget one artifact's conversion. Called when the artifact is deleted."""
    cached = _parquet_path(source)
    try:
        cached.unlink(missing_ok=True)
        return True
    except OSError:
        return False


# ─── Query plumbing ───────────────────────────────────────────────────────────

def _sql_literal(path: Path) -> str:
    """Quote a path for inlining, doubling any single quote it contains."""
    return "'" + str(path).replace("'", "''") + "'"


def _open(source: str) -> tuple[duckdb.DuckDBPyConnection, bool]:
    """
    A connection with `_src` bound to the artifact.

    Returns the connection and whether the fast path was used, which the tests
    assert on - a silent fallback to CSV scanning would otherwise look like a
    working cache.
    """
    path = Path(source)
    if not path.exists():
        # Checked before the cache is consulted. A Parquet conversion outlives
        # the CSV it was made from, so without this a deleted artifact would
        # answer queries from a stale cache and look healthy.
        raise SourceMissing(str(path))

    conn = duckdb.connect()
    cached = materialise(path)

    if cached is not None:
        # A view definition cannot carry a prepared parameter - DuckDB refuses
        # to prepare the statement at all - so the path is inlined. It is a
        # cache filename we generated ourselves (a hex digest under our own
        # directory), never analyst input, and `_sql_literal` escapes it
        # regardless rather than relying on that.
        conn.execute(
            f"CREATE TEMP VIEW _src AS SELECT * FROM read_parquet({_sql_literal(cached)})")
        return conn, True

    conn.execute(
        "CREATE TEMP TABLE _src AS SELECT * FROM read_csv_auto(?, ignore_errors=true)",
        [str(path)],
    )
    for raw in [row[0] for row in conn.execute("DESCRIBE _src").fetchall()]:
        norm = normalize_column(raw)
        if norm != raw:
            conn.execute(f'ALTER TABLE _src RENAME COLUMN "{raw}" TO "{norm}"')
    return conn, False


def build_where(columns: list[str], query: Query) -> tuple[str, list]:
    """
    Compile a `Query` into a WHERE clause.

    The three inputs are ANDed. That is what the Explorer warns about when
    column filters are active alongside an RQL expression: an OR inside the RQL
    can be narrowed by a filter the analyst forgot was set.
    """
    from ..rql_parser import RQLSyntaxError, parse_rql

    parts: list[str] = []
    params: list = []

    if query.text:
        parts.append("(" + " OR ".join(
            f'CAST("{c}" AS VARCHAR) ILIKE ?' for c in columns) + ")")
        params.extend([f"%{query.text}%"] * len(columns))

    for col, value in (query.column_filters or {}).items():
        if col in columns and value:
            parts.append(f'CAST("{col}" AS VARCHAR) ILIKE ?')
            params.append(f"%{value}%")

    if query.rql:
        try:
            rql_sql, rql_params = parse_rql(query.rql, columns)
            if rql_sql:
                parts.append(f"({rql_sql})")
                params.extend(rql_params)
        except RQLSyntaxError:
            raise
        except Exception as exc:
            raise RQLSyntaxError(f"RQL error: {exc}") from exc

    return ("WHERE " + " AND ".join(parts) if parts else "", params)


def _count(conn: duckdb.DuckDBPyConnection, sql: str, params: list) -> int:
    """
    Run a COUNT and return it.

    `fetchone()` is typed as returning None, and while an aggregate always
    produces a row, an empty result here should read as zero rather than crash
    the request - the analyst asked how many rows match, and "none" is an answer.
    """
    row = conn.execute(sql, params).fetchone()
    return int(row[0]) if row else 0


# ─── The store ────────────────────────────────────────────────────────────────

class DuckDBArtifactStore:
    """Reads artifacts in place, through a Parquet conversion when it can."""

    def schema(self, source: str) -> Schema:
        try:
            conn, _ = _open(source)
        except Exception:
            # Including SourceMissing. Registration asks for a schema before
            # anything is displayed, and "no columns" is the right answer there.
            return Schema([], 0)
        try:
            columns = [row[0] for row in conn.execute("DESCRIBE _src").fetchall()]
            return Schema(columns, _count(conn, "SELECT COUNT(*) FROM _src", []))
        except Exception:
            return Schema([], 0)
        finally:
            conn.close()

    def search(
        self, source: str, columns: list[str], query: Query, *,
        sort_col: str | None = None, sort_dir: str = "asc",
        page: int = 1, page_size: int = 100,
    ) -> Page:
        conn, _ = _open(source)
        try:
            where, params = build_where(columns, query)

            order = ""
            if sort_col and sort_col in columns:
                direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
                order = f'ORDER BY CAST("{sort_col}" AS VARCHAR) {direction}'

            total = _count(conn, f"SELECT COUNT(*) FROM _src {where}", params)
            pages = max(1, (total + page_size - 1) // page_size)

            selected = ", ".join(f'CAST("{c}" AS VARCHAR) AS "{c}"' for c in columns)
            raw = conn.execute(
                f"SELECT {selected} FROM _src {where} {order} "
                f"LIMIT {page_size} OFFSET {(page - 1) * page_size}",
                params,
            ).fetchall()

            return Page(total, pages,
                        [dict(zip(columns, row, strict=True)) for row in raw])
        finally:
            conn.close()

    def aggregate(
        self, source: str, columns: list[str], query: Query, group_by: list[str],
    ) -> list[Group]:
        valid = [c for c in group_by if c in set(columns)]
        if not valid:
            return []

        conn, _ = _open(source)
        try:
            where, params = build_where(columns, query)
            selected = ", ".join(f'CAST("{c}" AS VARCHAR) AS "{c}"' for c in valid)
            grouped = ", ".join(f'CAST("{c}" AS VARCHAR)' for c in valid)

            raw = conn.execute(
                f"SELECT {selected}, COUNT(*) AS _count FROM _src {where} "
                f"GROUP BY {grouped} ORDER BY {grouped} ASC",
                params,
            ).fetchall()

            return [
                Group(dict(zip(valid, row[: len(valid)], strict=True)), int(row[len(valid)]))
                for row in raw
            ]
        finally:
            conn.close()

    def find(
        self, source: str, columns: list[str], text: str, *,
        limit: int = 50, regex: bool = False,
    ) -> tuple[int, list[dict]]:
        if not columns:
            return 0, []

        conn, _ = _open(source)
        try:
            if regex:
                condition = " OR ".join(
                    f'regexp_matches(CAST("{c}" AS VARCHAR), ?)' for c in columns)
                params = [text] * len(columns)
            else:
                condition = " OR ".join(
                    f'CAST("{c}" AS VARCHAR) ILIKE ?' for c in columns)
                params = [f"%{text}%"] * len(columns)

            # Counted separately from the rows returned: the cross-artifact
            # search ranks by how many hits a file has, and capping that at the
            # page size would rank a file with 10,000 hits alongside one with 50.
            count = _count(conn, f"SELECT COUNT(*) FROM _src WHERE {condition}", params)
            if not count:
                return 0, []

            selected = ", ".join(f'CAST("{c}" AS VARCHAR) AS "{c}"' for c in columns)
            raw = conn.execute(
                f"SELECT {selected} FROM _src WHERE {condition} LIMIT {limit}", params
            ).fetchall()
            return count, [dict(zip(columns, row, strict=True)) for row in raw]
        finally:
            conn.close()
