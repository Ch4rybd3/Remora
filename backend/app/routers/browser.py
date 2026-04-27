"""
Browser artifact analysis via WebX CSV import + DuckDB query engine.

Workflow:
  1. Run WebX (forensic-webhistory) against a browser profile
  2. Upload the resulting CSV here (History, Downloads, Extensions, Cookies, …)
  3. Background task auto-detects artifact type + imports into per-file DuckDB
  4. Explorer queries run against DuckDB for fast, filtered timeline navigation

DuckDB schema for ``entries``:
  Normalized columns (always present, positions 0-7):
    row_num, artifact_type, event_timestamp, url, title, browser, profile, username
  Raw columns (dynamic, positions 8+):
    r0, r1, r2, … — one per original CSV column, in CSV order
  ``columns_json`` on the BrowserFile model stores the mapping [col_name, …]
  so r{i} corresponds to columns_json[i].
"""
from __future__ import annotations

import csv as _csv
import hashlib
import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import duckdb
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.case import Case
from ..models.evidence import Evidence, EvidenceType, AcquisitionMethod
from ..models.browser import BrowserFile
from ..models.user import User
from ..schemas.browser import BrowserFileOut, BrowserEntryOut, BrowserEntriesPage, BrowserSummary
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/browser", tags=["browser"])

BROWSER_DIR = settings.evidence_store_path.parent / "browser"

# ── Constants ─────────────────────────────────────────────────────────────────

_BASE_COLS = 8    # row_num, artifact_type, event_timestamp, url, title, browser, profile, username

# ── Artifact-type detection ───────────────────────────────────────────────────

def _detect_artifact_type(filename: str) -> str:
    fname = filename.lower()
    if "download"   in fname: return "downloads"
    if "extension"  in fname or "addon"  in fname or "plugin" in fname: return "extensions"
    if "cookie"     in fname: return "cookies"
    if "autofill"   in fname or "formdata" in fname: return "autofill"
    if "keyword"    in fname or "search"  in fname: return "searches"
    if "bookmark"   in fname or "favourite" in fname or "favorite" in fname: return "bookmarks"
    if "cache"      in fname: return "cache"
    if "history"    in fname or "visit"   in fname: return "history"
    return "generic"

# ── CSV column sniffing (BOM-safe) ────────────────────────────────────────────

def _sniff_columns(csv_path: str) -> dict[str, str]:
    """Return {lowercase_header: original_header}. Strips UTF-8 BOM transparently."""
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(csv_path, newline="", encoding=enc) as f:
                headers = next(_csv.reader(f), [])
            return {h.lower().strip(): h.strip() for h in headers if h.strip()}
        except Exception:
            continue
    return {}

# ── Dynamic DuckDB CREATE TABLE ───────────────────────────────────────────────

def _build_create_sql(csv_path: str, col_map: dict[str, str],
                      col_names: list[str], artifact_type: str) -> str:
    """Build a CREATE TABLE … AS SELECT … covering normalized + all raw columns.

    Normalized columns (8):
        row_num, artifact_type, event_timestamp, url, title, browser, profile, username

    Raw columns (one per CSV column, as r0, r1, …):
        Cast to VARCHAR so DuckDB always returns strings — avoids type-mismatch crashes.
    """
    def r(*candidates: str) -> str:
        """Quoted reference to the first matching candidate, else NULL."""
        for c in candidates:
            if c.lower() in col_map:
                return f'"{col_map[c.lower()]}"'
        return "NULL"

    # Normalized fields — candidates are deliberately broad to cover WebX variants:
    #   "Web Browser", "User Profile", "Install Time", etc.
    ts_col      = r('visittime', 'starttime', 'install time', 'install_time',
                    'datecreated', 'created', 'openedtime', 'timestamp', 'date',
                    'expires', 'last visit time', 'lastvisit', 'date accessed',
                    'last accessed', 'endtime', 'date added')
    url_col     = r('url', 'fileurl', 'downloadurl', 'homepage', 'homepageurl', 'update url')
    title_col   = r('title', 'name', 'keyword', 'value', 'extension name')
    browser_col = r('browser', 'web browser', 'web_browser', 'browsername', 'browser name',
                    'webbrowser')
    profile_col = r('profile', 'user profile', 'user_profile', 'browserprofile',
                    'browser profile', 'userprofile')
    user_col    = r('user', 'username', 'user name')

    select_parts = [
        "    ROW_NUMBER() OVER ()                                              AS row_num",
        f"    '{artifact_type}'                                                AS artifact_type",
        f"    TRY_CAST({ts_col} AS TIMESTAMP)                                  AS event_timestamp",
        f"    NULLIF(TRIM(COALESCE({url_col},     '')), '')                    AS url",
        f"    NULLIF(TRIM(COALESCE({title_col},   '')), '')                    AS title",
        f"    NULLIF(TRIM(COALESCE({browser_col}, '')), '')                    AS browser",
        f"    NULLIF(TRIM(COALESCE({profile_col}, '')), '')                    AS profile",
        f"    NULLIF(TRIM(COALESCE({user_col},    '')), '')                    AS username",
    ]

    # Raw columns — every original CSV column stored verbatim
    for i, col in enumerate(col_names):
        select_parts.append(
            f'    CAST(COALESCE("{col}", \'\') AS VARCHAR)                     AS r{i}'
        )

    select_sql = ",\n".join(select_parts)

    return f"""
CREATE TABLE entries AS
SELECT
{select_sql}
FROM read_csv(
    {csv_path!r},
    header        = true,
    all_varchar   = true,
    ignore_errors = true
)
"""

# ── Query helpers ─────────────────────────────────────────────────────────────

def _build_entry_cols(n_raw: int) -> str:
    """SELECT column list matching _row_to_entry positional mapping."""
    base = "row_num, artifact_type, event_timestamp, url, title, browser, profile, username"
    if n_raw == 0:
        return base
    raw = ", ".join(f"r{i}" for i in range(n_raw))
    return f"{base}, {raw}"


def _row_to_entry(r, col_names: list[str]) -> BrowserEntryOut:
    raw_data: dict[str, str] = {}
    for i, name in enumerate(col_names):
        idx = _BASE_COLS + i
        val = r[idx] if len(r) > idx else None
        if val is not None and str(val) != "":
            raw_data[name] = str(val)

    def s(v) -> Optional[str]:
        if v is None or (isinstance(v, str) and v == ""):
            return None
        return str(v)

    return BrowserEntryOut(
        row_num         = r[0],
        artifact_type   = r[1] or "generic",
        event_timestamp = r[2],
        url             = s(r[3]),
        title           = s(r[4]),
        browser         = s(r[5]),
        profile         = s(r[6]),
        username        = s(r[7]),
        raw_data        = raw_data,
    )

# ── CRUD helpers ──────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> BrowserFile:
    f = db.query(BrowserFile).filter(
        BrowserFile.id == file_id, BrowserFile.case_id == case_id
    ).first()
    if not f:
        raise HTTPException(404, "Browser file not found")
    return f


def _case_dir(case_id: str) -> Path:
    d = BROWSER_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_duckdb(f: BrowserFile) -> str:
    if not f.duckdb_path or not Path(f.duckdb_path).exists():
        raise HTTPException(409, "Browser data not available — re-upload the WebX CSV")
    return f.duckdb_path

# ── Background CSV import ─────────────────────────────────────────────────────

def _import_csv_background(file_id: str, csv_path: str, duckdb_path: str,
                            artifact_type: str) -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        f = db.query(BrowserFile).filter(BrowserFile.id == file_id).first()
        if not f:
            return
        f.status         = "parsing"
        f.parse_progress = 0
        db.commit()

        parse_start = datetime.now(timezone.utc)

        col_map   = _sniff_columns(csv_path)
        col_names = list(col_map.values())   # original column names in CSV order
        create_sql = _build_create_sql(csv_path, col_map, col_names, artifact_type)

        conn = duckdb.connect(database=duckdb_path, read_only=False)
        try:
            conn.execute(create_sql)
            db.execute(
                text("UPDATE browser_files SET parse_progress = 80 WHERE id = :id"),
                {"id": file_id},
            )
            db.commit()
            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        finally:
            conn.close()

        duration = int((datetime.now(timezone.utc) - parse_start).total_seconds())

        f = db.query(BrowserFile).filter(BrowserFile.id == file_id).first()
        f.status                 = "ready"
        f.entry_count            = total
        f.parsed_at              = datetime.now(timezone.utc)
        f.parse_progress         = 100
        f.parse_duration_seconds = duration
        f.columns_json           = json.dumps(col_names, ensure_ascii=False)
        db.commit()

    except Exception as exc:
        db.rollback()
        try:
            Path(duckdb_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            f = db.query(BrowserFile).filter(BrowserFile.id == file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=BrowserFileOut)
async def upload_browser_csv(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a WebX browser-artifact CSV and queue it for DuckDB import."""
    _get_case_or_404(case_id, db)

    dest_dir      = _case_dir(case_id)
    file_id       = str(uuid.uuid4())
    safe_name     = (file.filename or "browser.csv").replace("/", "_").replace("\\", "_")
    artifact_type = _detect_artifact_type(safe_name)
    csv_dest      = dest_dir / f"{file_id}_{safe_name}"
    ddb_dest      = dest_dir / f"{file_id}.duckdb"

    with open(csv_dest, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)

    f = BrowserFile(
        id=file_id, case_id=case_id,
        filename=file.filename or "browser.csv",
        file_path=str(csv_dest),
        duckdb_path=str(ddb_dest),
        artifact_type=artifact_type,
        status="pending",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(f)
    case = _get_case_or_404(case_id, db)
    audit_log(db, user=current_user, action="browser.upload",
              resource_type="browser_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(
        _import_csv_background, file_id, str(csv_dest), str(ddb_dest), artifact_type
    )
    return f


@router.get("/{case_id}/files", response_model=list[BrowserFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(BrowserFile)
        .filter(BrowserFile.case_id == case_id)
        .order_by(BrowserFile.uploaded_at.desc())
        .all()
    )


@router.delete("/{case_id}/files/{file_id}", status_code=204)
def delete_file(
    case_id:      str,
    file_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    f    = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    for attr in ("file_path", "duckdb_path"):
        try:
            p = getattr(f, attr)
            if p:
                Path(p).unlink(missing_ok=True)
                Path(p + ".wal").unlink(missing_ok=True)
        except Exception:
            pass
    audit_log(db, user=current_user, action="browser.delete",
              resource_type="browser_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=BrowserSummary)
def get_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        stats = conn.execute("""
            SELECT COUNT(*), MIN(event_timestamp), MAX(event_timestamp)
            FROM entries
        """).fetchone()

        browsers = conn.execute("""
            SELECT browser, COUNT(*) AS cnt
            FROM   entries
            WHERE  browser IS NOT NULL AND browser != ''
            GROUP  BY browser
            ORDER  BY cnt DESC
            LIMIT  10
        """).fetchall()

        domains = conn.execute("""
            SELECT
                regexp_extract(url, 'https?://([^/?#:]+)', 1) AS domain,
                COUNT(*) AS cnt
            FROM   entries
            WHERE  url IS NOT NULL AND url != ''
            GROUP  BY domain
            HAVING domain != ''
            ORDER  BY cnt DESC
            LIMIT  20
        """).fetchall()
    finally:
        conn.close()

    total = f.entry_count if f.entry_count is not None else (stats[0] or 0)

    return BrowserSummary(
        total_entries    = total,
        artifact_type    = f.artifact_type,
        oldest_timestamp = stats[1],
        newest_timestamp = stats[2],
        top_browsers     = [{"browser": r[0], "count": r[1]} for r in browsers],
        top_domains      = [{"domain":  r[0], "count": r[1]} for r in domains],
    )


@router.get("/{case_id}/files/{file_id}/entries", response_model=BrowserEntriesPage)
def list_entries(
    case_id:       str,
    file_id:       str,
    page:          int           = Query(1,   ge=1),
    page_size:     int           = Query(200, ge=1, le=1000),
    search:        str           = Query(""),
    browser:       str           = Query(""),
    artifact_type: str           = Query(""),
    time_from:     Optional[str] = Query(None),
    time_to:       Optional[str] = Query(None),
    sort_dir:      str           = Query("asc"),
    db:            Session       = Depends(get_db),
):
    """Paginated + filtered browser artifact entries from DuckDB."""
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    col_names: list[str] = []
    if f.columns_json:
        try:
            col_names = json.loads(f.columns_json)
        except Exception:
            pass

    n_raw        = len(col_names)
    entry_cols   = _build_entry_cols(n_raw)
    search_term  = search.strip()
    browser_filt = browser.strip()
    type_filt    = artifact_type.strip()
    sd           = "DESC" if sort_dir == "desc" else "ASC"

    dt_from = dt_to = None
    if time_from:
        try: dt_from = datetime.fromisoformat(time_from)
        except ValueError: pass
    if time_to:
        try: dt_to = datetime.fromisoformat(time_to)
        except ValueError: pass

    conditions: list[str] = []
    params:     list      = []

    if search_term:
        if n_raw > 0:
            # Search url + title + all raw columns
            raw_concat = " || ' ' || ".join(f"COALESCE(r{i}, '')" for i in range(n_raw))
            conditions.append(
                f"(url ILIKE ? OR title ILIKE ? OR LOWER({raw_concat}) LIKE LOWER(?))"
            )
            params += [f"%{search_term}%", f"%{search_term}%", f"%{search_term}%"]
        else:
            conditions.append("(url ILIKE ? OR title ILIKE ?)")
            params += [f"%{search_term}%", f"%{search_term}%"]

    if browser_filt:
        conditions.append("browser ILIKE ?")
        params.append(f"%{browser_filt}%")

    if type_filt:
        conditions.append("artifact_type = ?")
        params.append(type_filt)

    if dt_from:
        conditions.append("event_timestamp >= ?")
        params.append(dt_from)
    if dt_to:
        conditions.append("event_timestamp <= ?")
        params.append(dt_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order = f"ORDER BY event_timestamp {sd} NULLS LAST, row_num {sd}"

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        has_filters = bool(search_term or browser_filt or type_filt or dt_from or dt_to)
        if not has_filters and f.entry_count is not None:
            total = f.entry_count
        else:
            total = conn.execute(f"SELECT COUNT(*) FROM entries {where}", params).fetchone()[0]

        pages = max(1, math.ceil(total / page_size))

        rows = conn.execute(
            f"SELECT {entry_cols} FROM entries {where} {order} LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
    finally:
        conn.close()

    return BrowserEntriesPage(
        total=total, page=page, page_size=page_size, pages=pages,
        items=[_row_to_entry(r, col_names) for r in rows],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=BrowserFileOut)
def reparse_file(
    case_id:          str,
    file_id:          str,
    background_tasks: BackgroundTasks,
    db:               Session = Depends(get_db),
    current_user:     User    = Depends(get_current_user),
):
    f = _get_file_or_404(file_id, case_id, db)
    if not f.file_path or not Path(f.file_path).exists():
        raise HTTPException(400, "Original CSV no longer available — please re-upload")
    try:
        if f.duckdb_path:
            Path(f.duckdb_path).unlink(missing_ok=True)
            Path(f.duckdb_path + ".wal").unlink(missing_ok=True)
    except Exception:
        pass

    ddb_dest = str(Path(f.file_path).parent / f"{file_id}.duckdb")
    f.duckdb_path            = ddb_dest
    f.status                 = "pending"
    f.entry_count            = None
    f.parsed_at              = None
    f.error_msg              = None
    f.parse_progress         = 0
    f.parse_duration_seconds = None
    f.columns_json           = None
    db.commit()
    db.refresh(f)

    background_tasks.add_task(
        _import_csv_background, file_id, f.file_path, ddb_dest, f.artifact_type
    )
    return f


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=BrowserFileOut)
def add_to_evidence(
    case_id:      str,
    file_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    f    = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    if f.added_to_evidence:
        raise HTTPException(400, "Already added to evidence")

    file_path = Path(f.file_path)
    size = 0
    try: size = file_path.stat().st_size
    except Exception: pass

    md5_hash = sha256_hash = ""
    try:
        md5 = hashlib.md5(); sha256 = hashlib.sha256()
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk); sha256.update(chunk)
        md5_hash = md5.hexdigest(); sha256_hash = sha256.hexdigest()
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    ev  = Evidence(
        case_id=case_id, name=f.filename,
        description=f"Browser artifact — {f.artifact_type} ({f.entry_count or '?'} records)",
        file_path=f.file_path, original_filename=f.filename,
        file_size=size, mime_type="text/csv",
        md5_hash=md5_hash, sha256_hash=sha256_hash,
        evidence_type=EvidenceType.artifact,
        acquisition_method=AcquisitionMethod.logical_copy,
        collected_by=current_user.username, collected_at=now,
        chain_of_custody=(
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
            f"via WebX browser CSV import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
        ),
    )
    db.add(ev)
    f.added_to_evidence = True
    audit_log(db, user=current_user, action="browser.add_evidence",
              resource_type="browser_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f
