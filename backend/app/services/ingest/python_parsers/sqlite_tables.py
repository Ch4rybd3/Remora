"""
Any SQLite database, as tables.

The seventeen files this covers in the reference triage are not the point.
Firefox's `permissions.sqlite`, Edge's `Web Data`, a `Collections` database -
none of them is worth a parser of its own. The point is the shape of the
problem: **applications keep their evidence in SQLite**, and there are more
applications than there will ever be parsers. Teams, Slack, Signal, Discord,
QuickAccess, every Electron app that has ever shipped - each one is a database
nobody has written a reader for, and each one is readable the moment this
exists.

Databases with a dedicated reader never arrive here. Identification refines a
SQLite container by name first (`services/ingest/identify.py`), so browser
history, cookies and the Windows Timeline keep the parsers that understand
what their columns mean. What reaches this is everything else.

**Copied before opening.** SQLite replays its write-ahead log on open, and that
is a write. Opening an evidence file directly would modify it - the same care
the browser parser takes, for the same reason.
"""
from __future__ import annotations

import csv
import logging
import re
import shutil
import sqlite3
from pathlib import Path

logger = logging.getLogger("remora.python_parsers.sqlite")

#: Per table. An application database can hold millions of rows and a CSV is
#: not where anyone reads those; the cap is a refusal to pretend otherwise.
MAX_ROWS_PER_TABLE = 500_000

#: Long enough for a serialised blob to be recognisable, short enough that one
#: cell cannot dominate the file.
MAX_CELL_CHARS = 2_000

#: SQLite's own bookkeeping. About the file, not about the machine.
_INTERNAL_PREFIX = "sqlite_"

#: Sidecars that belong to the database rather than standing on their own. They
#: are copied with it so the log is replayed against the copy.
_SIDECARS = ("-wal", "-shm", "-journal")

ERROR_COLUMNS = ["SourceFile", "Error"]


def _relative(path: Path, base: Path | None) -> str:
    if base is None:
        return path.name
    try:
        return str(path.relative_to(base))
    except ValueError:
        return path.name


def _safe(name: str, limit: int = 60) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_")
    return cleaned[-limit:] or "x"


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        text = value.hex(" ")
    else:
        text = str(value)
    return text[:MAX_CELL_CHARS]


def _copy_for_reading(source: Path, scratch: Path) -> Path:
    """
    The database and its sidecars, somewhere writing is harmless.

    Opening a database with a write-ahead log beside it makes SQLite replay
    that log into the main file. On an evidence copy that is a modification;
    on a read-only mount it is an error. Copying first is what makes the read
    both safe and possible.
    """
    scratch.mkdir(parents=True, exist_ok=True)
    target = scratch / source.name
    shutil.copy2(source, target)
    for suffix in _SIDECARS:
        sidecar = source.with_name(source.name + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, target.with_name(target.name + suffix))
    return target


def _table_names(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows if not r[0].startswith(_INTERNAL_PREFIX)]


def parse_all(paths: list[Path], out_dir: Path, scratch: Path,
              base: Path | None = None) -> list[Path]:
    """One CSV per table per database, named for both."""
    written: list[Path] = []
    errors: dict[str, str] = {}

    for path in sorted(paths):
        source = _relative(path, base)
        try:
            copy = _copy_for_reading(path, scratch / _safe(source, 90))
        except OSError as e:
            errors[source] = f"{type(e).__name__}: {e}"
            continue

        try:
            connection = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
        except Exception as e:
            errors[source] = f"{type(e).__name__}: {e}"
            logger.warning("could not open %s: %s", path.name, e)
            continue

        try:
            tables = _table_names(connection)
        except Exception as e:
            errors[source] = f"{type(e).__name__}: {e}"
            connection.close()
            continue

        stem = _safe(source, 70)
        for table in tables:
            # Per table. A database with one corrupt page still yields every
            # other table in it, which is the difference between a partial
            # answer and none.
            try:
                written.extend(_dump(connection, table, source, stem, out_dir))
            except Exception as e:
                errors[f"{source} :: {table}"] = f"{type(e).__name__}: {e}"
                logger.warning("%s table %s failed: %s", path.name, table, e)

        connection.close()

    error_file = _write(out_dir, "sqlite_errors.csv", ERROR_COLUMNS,
                        [[k, v] for k, v in sorted(errors.items())])
    if error_file:
        written.append(error_file)
    return written


def _dump(connection: sqlite3.Connection, table: str, source: str,
          stem: str, out_dir: Path) -> list[Path]:
    cursor = connection.execute(f'SELECT * FROM "{table}" LIMIT {MAX_ROWS_PER_TABLE}')
    columns = [d[0] for d in cursor.description or []]
    if not columns:
        return []

    rows = [[source, *[_cell(v) for v in row]] for row in cursor.fetchall()]
    target = _write(out_dir, f"sqlite_{stem}__{_safe(table, 40)}.csv",
                    ["SourceFile", *columns], rows)
    return [target] if target else []


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
