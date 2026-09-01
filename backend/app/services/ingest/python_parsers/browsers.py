"""
Browser artifacts, normalised across browsers.

Every browser stores its history in SQLite, and every one uses a different
schema, a different epoch and a different word for the same thing. An analyst
should not have to know which - so this produces one table per *question*
(what was visited, what was downloaded, what cookies existed, which accounts
were saved), with a `Browser` column rather than one file per product.

That normalisation is the whole value. Otherwise this would be four SQL queries
an analyst could run themselves.

**Passwords are never extracted.** The `logins` table holds encrypted blobs and
decrypting them requires the user's DPAPI key; doing it would be a decision
about the investigation, not a parsing step. The metadata around a saved
credential - which site, which username, when it was last used - is what
answers questions, and that is what is read.

**The database is copied before it is opened.** A live SQLite file has a
write-ahead log holding the most recent transactions, and reading without it
silently misses the last browsing session - which is usually the interesting
one. Opening the original read-write to replay that log would modify evidence,
so the copy is made first and the log is replayed against the copy.
"""
from __future__ import annotations

import csv
import shutil
import sqlite3
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

#: Files SQLite keeps beside a database. The write-ahead log is the one that
#: matters: without it the most recent session is missing.
SIDECARS = ("-wal", "-shm", "-journal")


class BrowserError(Exception):
    """This database could not be read. One file, not the batch."""


# ─── Epochs ───────────────────────────────────────────────────────────────────

def _chromium_time(value: int | None) -> str:
    """Microseconds since 1601-01-01. Zero means never."""
    if not value:
        return ""
    try:
        return (datetime(1601, 1, 1, tzinfo=UTC) + timedelta(microseconds=value)).isoformat()
    except (OverflowError, ValueError):
        return ""


def _firefox_time(value: int | None) -> str:
    """Microseconds since the Unix epoch."""
    if not value:
        return ""
    try:
        return datetime.fromtimestamp(value / 1_000_000, tz=UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return ""


def _unix_seconds(value: int | None) -> str:
    if not value:
        return ""
    try:
        return datetime.fromtimestamp(value, tz=UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return ""


# ─── What each browser calls things ───────────────────────────────────────────

@dataclass(frozen=True)
class Query:
    """One question, asked of one schema."""
    #: Tables that must exist for this query to apply. Schemas change between
    #: browser versions, and a query against a missing table is a crash rather
    #: than an empty result.
    requires: tuple[str, ...]
    sql:      str
    #: Maps a row to the shared column order of its output.
    row:      Callable[[sqlite3.Row], list]


CHROMIUM_HISTORY = Query(
    requires=("urls", "visits"),
    sql="""
        SELECT u.url, u.title, u.visit_count, u.typed_count,
               v.visit_time, v.transition
          FROM visits v JOIN urls u ON u.id = v.url
      ORDER BY v.visit_time DESC
    """,
    row=lambda r: [r["url"], r["title"] or "", _chromium_time(r["visit_time"]),
                   r["visit_count"], r["typed_count"],
                   # The low byte is the core transition; the rest are qualifier
                   # flags an analyst rarely wants and can always recover.
                   (r["transition"] or 0) & 0xFF],
)

FIREFOX_HISTORY = Query(
    requires=("moz_places", "moz_historyvisits"),
    sql="""
        SELECT p.url, p.title, p.visit_count, p.typed, v.visit_date, v.visit_type
          FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
      ORDER BY v.visit_date DESC
    """,
    row=lambda r: [r["url"], r["title"] or "", _firefox_time(r["visit_date"]),
                   r["visit_count"] or 0, r["typed"] or 0, r["visit_type"] or 0],
)

CHROMIUM_DOWNLOADS = Query(
    requires=("downloads",),
    sql="""
        SELECT tab_url, target_path, start_time, end_time,
               received_bytes, total_bytes, state, danger_type
          FROM downloads ORDER BY start_time DESC
    """,
    row=lambda r: [r["tab_url"] or "", r["target_path"] or "",
                   _chromium_time(r["start_time"]), _chromium_time(r["end_time"]),
                   r["received_bytes"] or 0, r["total_bytes"] or 0,
                   r["state"], r["danger_type"]],
)

CHROMIUM_COOKIES = Query(
    requires=("cookies",),
    sql="""
        SELECT host_key, name, path, creation_utc, expires_utc,
               last_access_utc, is_secure, is_httponly
          FROM cookies ORDER BY last_access_utc DESC
    """,
    row=lambda r: [r["host_key"], r["name"], r["path"],
                   _chromium_time(r["creation_utc"]),
                   _chromium_time(r["expires_utc"]),
                   _chromium_time(r["last_access_utc"]),
                   bool(r["is_secure"]), bool(r["is_httponly"])],
)

CHROMIUM_LOGINS = Query(
    requires=("logins",),
    # No password_value. It is an encrypted blob, and decrypting it is a
    # decision about the investigation rather than a parsing step.
    sql="""
        SELECT origin_url, username_value, date_created, date_last_used, times_used
          FROM logins ORDER BY date_last_used DESC
    """,
    row=lambda r: [r["origin_url"] or "", r["username_value"] or "",
                   _chromium_time(r["date_created"]),
                   _chromium_time(r["date_last_used"]), r["times_used"] or 0],
)


@dataclass(frozen=True)
class Profile:
    """One browser database, recognised by its filename and its tables."""
    browser:  str
    filename: str
    history:  Query | None = None
    downloads: Query | None = None
    cookies:  Query | None = None
    logins:   Query | None = None


#: Chromium covers Chrome, Edge, Brave, Opera and Vivaldi - they share the
#: schema, so one entry is not a simplification.
PROFILES: tuple[Profile, ...] = (
    Profile("Chromium", "history", history=CHROMIUM_HISTORY, downloads=CHROMIUM_DOWNLOADS),
    Profile("Chromium", "cookies", cookies=CHROMIUM_COOKIES),
    Profile("Chromium", "login data", logins=CHROMIUM_LOGINS),
    Profile("Firefox",  "places.sqlite", history=FIREFOX_HISTORY),
)


def profile_for(path: Path) -> Profile | None:
    name = path.name.lower()
    for profile in PROFILES:
        if name == profile.filename:
            return profile
    return None


def is_browser_database(path: Path) -> bool:
    return profile_for(path) is not None


# ─── Reading ──────────────────────────────────────────────────────────────────

def profile_name(path: Path) -> str:
    """
    The browser profile a database belongs to, from its location.

    `.../User Data/Default/History` is the default Chromium profile;
    `.../Profiles/xyz.default-release/places.sqlite` is a Firefox one. Reported
    because a machine with three profiles produces three histories and they are
    not interchangeable.
    """
    parent = path.parent.name
    if parent.lower() in ("network", "default"):
        # Chromium moved Cookies into a `Network` subdirectory.
        parent = path.parent.parent.name if parent.lower() == "network" else parent
    return parent or "unknown"


def _open_copy(path: Path, scratch: Path) -> sqlite3.Connection:
    """
    Copy the database and its sidecars, then open the copy.

    The write-ahead log holds the most recent transactions, and it is replayed
    on open - which writes. Doing that to the original would modify evidence,
    and skipping it would silently drop the last browsing session.
    """
    scratch.mkdir(parents=True, exist_ok=True)
    local = scratch / path.name
    shutil.copy2(path, local)
    for suffix in SIDECARS:
        sidecar = path.with_name(path.name + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, scratch / sidecar.name)

    try:
        connection = sqlite3.connect(str(local))
        connection.row_factory = sqlite3.Row
        return connection
    except sqlite3.Error as e:
        raise BrowserError(f"Could not open the database: {e}") from e


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0] for row in
        connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


def _run(connection: sqlite3.Connection, query: Query | None) -> Iterator[list]:
    if query is None:
        return
    if not set(query.requires) <= _tables(connection):
        return
    try:
        for row in connection.execute(query.sql):
            yield query.row(row)
    except sqlite3.Error:
        # A schema that moved on. Better to lose one table than the file.
        return


# ─── CSV output ───────────────────────────────────────────────────────────────

HISTORY_COLUMNS   = ["Browser", "Profile", "Source", "URL", "Title", "VisitTime",
                     "VisitCount", "TypedCount", "TransitionType"]
DOWNLOAD_COLUMNS  = ["Browser", "Profile", "Source", "URL", "TargetPath",
                     "StartTime", "EndTime", "ReceivedBytes", "TotalBytes",
                     "State", "DangerType"]
COOKIE_COLUMNS    = ["Browser", "Profile", "Source", "Host", "Name", "Path",
                     "Created", "Expires", "LastAccess", "Secure", "HttpOnly"]
LOGIN_COLUMNS     = ["Browser", "Profile", "Source", "URL", "Username",
                     "Created", "LastUsed", "TimesUsed"]


def parse_all(databases: list[Path], out_dir: Path, scratch: Path) -> list[Path]:
    """
    Read every browser database given, into one CSV per question.

    One table per question rather than one per product: an analyst asking "was
    this URL visited" should not have to ask it four times.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list[list]] = {"history": [], "downloads": [],
                                      "cookies": [], "logins": []}

    for index, path in enumerate(databases):
        profile = profile_for(path)
        if profile is None:
            continue
        try:
            connection = _open_copy(path, scratch / f"db{index}")
        except (BrowserError, OSError):
            continue

        prefix = [profile.browser, profile_name(path), str(path)]
        try:
            for bucket, query in (("history", profile.history),
                                  ("downloads", profile.downloads),
                                  ("cookies", profile.cookies),
                                  ("logins", profile.logins)):
                for row in _run(connection, query):
                    buckets[bucket].append(prefix + row)
        finally:
            connection.close()

    written: list[Path] = []
    for bucket, columns in (("history", HISTORY_COLUMNS),
                            ("downloads", DOWNLOAD_COLUMNS),
                            ("cookies", COOKIE_COLUMNS),
                            ("logins", LOGIN_COLUMNS)):
        rows = buckets[bucket]
        if not rows:
            continue
        target = out_dir / f"browser_{bucket}.csv"
        with open(target, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(columns)
            writer.writerows(rows)
        written.append(target)
    return written
