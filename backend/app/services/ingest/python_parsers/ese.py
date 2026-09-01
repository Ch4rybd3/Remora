"""
ESE databases: SRUM, the IE/Edge web cache, and anything else in the format.

One dependency, four artifact classes. `dissect.esedb` reads the Extensible
Storage Engine format that Windows uses for SRUM (`SRUDB.dat`), the legacy
browser cache (`WebCacheV01.dat`), the search index (`Windows.edb`) and Active
Directory (`NTDS.dit`). SrumECmd, the Eric Zimmerman tool for the first of
those, is one of the two that refuse to run outside Windows.

Three readers, because the three shapes want different tables:

* **SRUM** — one table per provider. The providers hold genuinely different
  columns (bytes on a wire, energy drawn from a battery), and merging them
  would make one wide table that is mostly empty. `network_data` is the one an
  analyst reaches for first: bytes sent and received, per application, per
  user, per hour.
* **WebCache** — one table, because every `Container_N` shares a schema. The
  container's *name* is what distinguishes History from Content from Cookies,
  so it becomes a column rather than a filename.
* **Anything else** — every table dumped as it stands. Not a good answer, but a
  true one, and it means a future ESE artifact is readable on the day it turns
  up rather than on the day someone writes a reader for it.

**Bounded on purpose.** These parsers run in-process rather than in the
sandbox, and an ESE database can be tens of gigabytes. Row and table caps below
are what stop a hostile or merely enormous file from taking the worker with it.
"""
from __future__ import annotations

import csv
import logging
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from dissect.esedb import EseDB
from dissect.esedb.tools.sru import NAME_TO_GUID_MAP, SKIP_TABLES, SRU

logger = logging.getLogger("remora.python_parsers.ese")

#: Engine bookkeeping. Present in every ESE file and about the file, not about
#: the machine it came from.
_INTERNAL_TABLES = frozenset({
    "MSysObjects", "MSysObjectsShadow", "MSysObjids", "MSysLocales",
    "MSysUnicodeFixupVer2",
})

#: Per table, for the generic reader. A search index holds tens of millions of
#: rows and nobody reads them in a CSV; the cap is a refusal to pretend
#: otherwise, and the row count is reported so the truncation is visible.
MAX_ROWS_PER_TABLE = 500_000

#: Values longer than this are cut. Response headers and cache blobs run to
#: kilobytes of binary per row.
MAX_CELL_CHARS = 2_000

#: Columns dropped from the web cache: raw binary that renders as an escaped
#: byte string and pushes the columns an analyst wants off the screen.
_WEBCACHE_NOISE = frozenset({
    "RequestHeaders", "ResponseHeaders", "ExtraData", "SecureDirectory",
})

#: FILETIME, as the web cache stores its timestamps. 1601-01-01 in 100ns ticks.
_FILETIME_EPOCH = datetime(1601, 1, 1, tzinfo=UTC)
_WEBCACHE_TIMES = frozenset({
    "SyncTime", "CreationTime", "ExpiryTime", "ModifiedTime", "AccessedTime",
    "PostCheckTime", "LastScavengeTime", "LastAccessTime",
})

_GUID_NAMES = {guid: name for name, guid in NAME_TO_GUID_MAP.items()}


def _relative(path: Path, base: Path | None) -> str:
    if base is None:
        return path.name
    try:
        return str(path.relative_to(base))
    except ValueError:
        return path.name


def _cell(value: Any) -> str:
    """One value as text, bounded."""
    if value is None:
        return ""
    if isinstance(value, bytes):
        text = value.hex(" ")
    elif isinstance(value, datetime):
        return value.isoformat()
    else:
        text = str(value)
    return text[:MAX_CELL_CHARS]


def _filetime(value: Any) -> str:
    """
    A FILETIME as an ISO timestamp, or the raw value when it is not one.

    Out-of-range values are left alone rather than clamped: a timestamp that
    does not convert is a fact about the artifact, and silently turning it into
    a plausible date would be inventing evidence.
    """
    if not isinstance(value, int) or value <= 0:
        return _cell(value)
    try:
        return (_FILETIME_EPOCH + timedelta(microseconds=value / 10)).isoformat()
    except (OverflowError, OSError, ValueError):
        return str(value)


def _value(record: Any, column: str) -> Any:
    """
    One column out of a record, tolerating a column that will not decode.

    Read column by column rather than through `Record.as_dict()`. That helper
    walks the record's fixed-column range, and on 16 of the 52 cache containers
    in the reference database the range's upper bound is absent - it raises
    before returning a single value, taking the whole container with it.
    Asking for the columns actually wanted never touches that path, and turned
    185 recovered cache entries into 378.
    """
    try:
        return record.get(column)
    except Exception:
        return None


def _safe_name(name: str) -> str:
    """A table name that can be a filename."""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name).strip("_")[:80] or "table"


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


# ─── SRUM ─────────────────────────────────────────────────────────────────────

def parse_srum(paths: list[Path], out_dir: Path, base: Path | None = None) -> list[Path]:
    """
    One table per SRUM provider, across every `SRUDB.dat` in the collection.

    The identifier resolution is the whole value. Raw, the tables hold integers
    where the application and the user should be; `SruDbIdMapTable` turns those
    into an executable path and a SID, which is what makes a row like
    "discord.exe sent 88 MB for S-1-5-21-… at 19:22" possible at all.
    """
    by_provider: dict[str, tuple[list[str], list[list[str]]]] = {}
    errors: dict[str, str] = {}

    for path in paths:
        source = _relative(path, base)
        try:
            fh = path.open("rb")
        except OSError as e:
            errors[source] = f"{type(e).__name__}: {e}"
            continue
        with fh:
            try:
                sru = SRU(fh)
            except Exception as e:
                errors[source] = f"{type(e).__name__}: {e}"
                logger.warning("could not open SRUM %s: %s", path.name, e)
                continue

            for table in sru.esedb.tables():
                if table.name in SKIP_TABLES or table.name in _INTERNAL_TABLES:
                    continue
                provider = _GUID_NAMES.get(table.name, _safe_name(table.name))
                columns = ["SourceFile", "Provider", *table.column_names]
                rows = by_provider.setdefault(provider, (columns, []))[1]
                # Per table, not per file. A single unreadable provider must
                # not cost the other nine - which is exactly what happened to
                # the web cache below, where one bad container table threw away
                # all fifty-two.
                try:
                    for entry in sru.get_table_entries(table=table):
                        if len(rows) >= MAX_ROWS_PER_TABLE:
                            break
                        rows.append([source, provider,
                                     *[_srum_cell(sru, entry, c)
                                       for c in table.column_names]])
                except Exception as e:
                    errors[f"{source} :: {provider}"] = f"{type(e).__name__}: {e}"
                    logger.warning("SRUM %s provider %s stopped early: %s",
                                   path.name, provider, e)

    written = []
    for provider, (columns, rows) in sorted(by_provider.items()):
        target = _write(out_dir, f"srum_{provider}.csv", columns, rows)
        if target:
            written.append(target)
    written += _write_errors(out_dir, "srum_errors.csv", errors)
    return written


def _srum_cell(sru: SRU, entry: Any, column: str) -> str:
    """
    One SRUM value, keeping an identifier that will not resolve.

    `AppId` and `UserId` are indexes into `SruDbIdMapTable`, and not every one
    of them is in it - about 4% of `network_data` rows in the reference
    database point at an entry with an empty blob, `1` being the common one.
    The helper returns None for those, and writing an empty cell would lose the
    fact that the row *has* an application id, just not a resolvable one. The
    raw number correlates across rows; a blank does not.
    """
    try:
        value = entry[column]
    except Exception:
        value = None
    if value is None and column in ("AppId", "UserId"):
        raw = entry.record.get(column)
        return _cell(raw)
    return _cell(value)


# ─── Web cache ────────────────────────────────────────────────────────────────

def parse_webcache(paths: list[Path], out_dir: Path,
                   base: Path | None = None) -> list[Path]:
    """
    Every cache container entry, with the container's name as a column.

    `Container_1` and `Container_843` share a schema and differ only in what
    they hold - History, Content, Cookies, DOMStore. Merging them into one
    table with the name alongside is what lets an analyst filter to history
    without knowing which numbered table it landed in on this machine.
    """
    columns: list[str] = []
    rows: list[list[str]] = []
    index_rows: list[list[str]] = []
    index_columns: list[str] = []
    errors: dict[str, str] = {}

    for path in paths:
        source = _relative(path, base)
        try:
            fh = path.open("rb")
        except OSError as e:
            errors[source] = f"{type(e).__name__}: {e}"
            continue
        with fh:
            try:
                db = EseDB(fh)
                containers = _read_containers(db)
            except Exception as e:
                errors[source] = f"{type(e).__name__}: {e}"
                logger.warning("could not open web cache %s: %s", path.name, e)
                continue

            if containers and not index_columns:
                index_columns = ["SourceFile", "ContainerId", "Name", "Directory"]
            for cid, (name, directory) in sorted(containers.items()):
                index_rows.append([source, str(cid), name, directory])

            for table in db.tables():
                if not table.name.startswith("Container_"):
                    continue
                try:
                    cid = int(table.name.rpartition("_")[2])
                except ValueError:
                    continue
                name, directory = containers.get(cid, ("", ""))
                wanted = [c for c in table.column_names if c not in _WEBCACHE_NOISE]
                if not columns:
                    columns = ["SourceFile", "Container", "ContainerDirectory", *wanted]
                # Per container. `Container_2` in the reference database raises
                # inside the library on a record whose fixed-column id is
                # missing; catching per file threw away the other fifty-one
                # containers of a machine's browsing history for it.
                try:
                    for record in table.records():
                        if len(rows) >= MAX_ROWS_PER_TABLE:
                            break
                        rows.append([
                            source, name, directory,
                            *[_filetime(_value(record, c)) if c in _WEBCACHE_TIMES
                              else _cell(_value(record, c)) for c in wanted],
                        ])
                except Exception as e:
                    errors[f"{source} :: {table.name} ({name})"] = f"{type(e).__name__}: {e}"
                    logger.warning("web cache %s container %s stopped early: %s",
                                   path.name, table.name, e)

    written = []
    target = _write(out_dir, "webcache_entries.csv", columns, rows)
    if target:
        written.append(target)
    target = _write(out_dir, "webcache_containers.csv", index_columns, index_rows)
    if target:
        written.append(target)
    written += _write_errors(out_dir, "webcache_errors.csv", errors)
    return written


def _read_containers(db: EseDB) -> dict[int, tuple[str, str]]:
    """`ContainerId` to its name and on-disk directory."""
    try:
        table = db.table("Containers")
    except Exception:
        return {}
    containers: dict[int, tuple[str, str]] = {}
    for record in table.records():
        cid = _value(record, "ContainerId")
        if cid is None:
            continue
        containers[int(cid)] = (_cell(_value(record, "Name")),
                                _cell(_value(record, "Directory")))
    return containers


# ─── Anything else in the format ──────────────────────────────────────────────

def dump_tables(paths: list[Path], out_dir: Path,
                base: Path | None = None) -> list[Path]:
    """
    Every table in an ESE database, as it stands.

    Not a good answer - the columns are whatever Microsoft called them and
    nothing is resolved or decoded. It is a true one, and it means an ESE
    artifact nobody has written a reader for is still queryable on the day it
    arrives instead of being listed as unsupported indefinitely.
    """
    written: list[Path] = []
    errors: dict[str, str] = {}

    for path in paths:
        source = _relative(path, base)
        try:
            fh = path.open("rb")
        except OSError as e:
            errors[source] = f"{type(e).__name__}: {e}"
            continue
        with fh:
            try:
                db = EseDB(fh)
                tables = db.tables()
            except Exception as e:
                errors[source] = f"{type(e).__name__}: {e}"
                logger.warning("could not open ESE database %s: %s", path.name, e)
                continue

            for table in tables:
                if table.name in _INTERNAL_TABLES:
                    continue
                columns = ["SourceFile", *table.column_names]
                rows: list[list[str]] = []
                # Per table. Whatever is left when a table stops early is still
                # written - a partial table with its failure recorded beats an
                # absent one.
                try:
                    for record in table.records():
                        if len(rows) >= MAX_ROWS_PER_TABLE:
                            logger.warning("%s table %s truncated at %d rows",
                                           path.name, table.name, MAX_ROWS_PER_TABLE)
                            break
                        rows.append([source, *[_cell(_value(record, c))
                                               for c in table.column_names]])
                except Exception as e:
                    errors[f"{source} :: {table.name}"] = f"{type(e).__name__}: {e}"
                    logger.warning("ESE %s table %s stopped early: %s",
                                   path.name, table.name, e)

                target = _write(out_dir, f"ese_{_safe_name(table.name)}.csv",
                                columns, rows)
                if target:
                    written.append(target)

    written += _write_errors(out_dir, "ese_errors.csv", errors)
    return written


def _write_errors(out_dir: Path, filename: str, errors: dict[str, str]) -> list[Path]:
    """
    What would not read, in the output rather than only in a log.

    A database that failed to open is a database nobody is looking at, and the
    ingest queue records one row for the file - not for the eleven tables
    inside it that never appeared.
    """
    if not errors:
        return []
    target = _write(out_dir, filename, ["SourceFile", "Error"],
                    [[k, v] for k, v in sorted(errors.items())])
    return [target] if target else []
