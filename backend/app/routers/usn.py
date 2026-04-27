"""
USN Journal analysis via MFTECmd $J CSV import + DuckDB query engine.

Workflow:
  1. User runs: MFTECmd.exe -f '$Extend\$J' --csv C:\output
  2. User uploads the resulting CSV here
  3. Background task imports the CSV into a per-file DuckDB database
  4. Explorer queries run against DuckDB — fast even on millions of USN records

MFTECmd $J CSV columns (typical):
  Offset, UpdateSequenceNumber, FileReferenceNumber, ParentFileReferenceNumber,
  UpdateTimestamp, Reason, SourceInfo, FileAttributes, FileName, Extension,
  IsDirectory  [, FullPath when parsed with $MFT]
"""
from __future__ import annotations

import csv as _csv
import hashlib
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
from ..models.usn import UsnFile
from ..models.user import User
from ..schemas.usn import UsnFileOut, UsnEntryOut, UsnEntriesPage, UsnSummary
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/usn", tags=["usn"])

USN_DIR = settings.evidence_store_path.parent / "usn"

# ── Column names used in query SELECT list ────────────────────────────────────

# NOTE: we alias the journal offset as "entry_offset" (not "offset") because
# OFFSET is an SQL reserved word in DuckDB — using it unquoted in SELECT lists
# causes a Binder Error on some DuckDB versions.
_ENTRY_COLS = """
    entry_offset, usn_seq, filename, extension, is_directory,
    update_timestamp, reason, full_path, file_ref, parent_ref
"""


# ── Dynamic CSV → DuckDB import ───────────────────────────────────────────────

def _sniff_columns(csv_path: str) -> dict[str, str]:
    """
    Read the CSV header row and return {lowercase_name: original_name}.

    Opens with utf-8-sig so a UTF-8 BOM (added by Windows tools like MFTECmd)
    is silently stripped.  Falls back to latin-1 if the file is not valid UTF-8.
    """
    for enc in ("utf-8-sig", "latin-1"):
        try:
            with open(csv_path, newline="", encoding=enc) as f:
                headers = next(_csv.reader(f), [])
            return {h.lower().strip(): h.strip() for h in headers if h.strip()}
        except Exception:
            continue
    return {}


def _build_create_sql(csv_path: str, col_map: dict[str, str]) -> str:
    """
    Build a DuckDB CREATE TABLE statement that maps whatever column names
    the CSV actually contains to our canonical schema.

    Accepts common MFTECmd $J variants (with/without BOM, KAPE naming, etc.).
    Any column not found in the CSV becomes NULL so the import never hard-fails.
    """
    def ref(*candidates: str) -> str:
        """Return a quoted column reference for the first match, else NULL."""
        for c in candidates:
            if c.lower() in col_map:
                return f'"{col_map[c.lower()]}"'
        return "NULL"

    return f"""
CREATE TABLE entries AS
SELECT
    TRY_CAST({ref('offset')}                                                    AS BIGINT)    AS entry_offset,
    TRY_CAST({ref('updatesequencenumber', 'usn', 'sequencenumber')}             AS BIGINT)    AS usn_seq,
    TRIM(COALESCE({ref('filename', 'name')}, ''))                                             AS filename,
    LOWER(COALESCE({ref('extension', 'ext')}, ''))                                            AS extension,
    (COALESCE({ref('isdirectory', 'is_directory')}, 'false') ILIKE 'true')                    AS is_directory,
    TRY_CAST({ref('updatetimestamp', 'timestamp', 'datetime')}                  AS TIMESTAMP) AS update_timestamp,
    TRIM(COALESCE({ref('reason')}, ''))                                                       AS reason,
    NULLIF(TRIM(COALESCE({ref('fullpath', 'full_path', 'path')}, '')), '')                    AS full_path,
    COALESCE({ref('filereferencenumber', 'fileref', 'file_ref')}, NULL)                       AS file_ref,
    COALESCE({ref('parentfilereferencenumber', 'parentref', 'parent_ref')}, NULL)             AS parent_ref,
FROM read_csv(
    {csv_path!r},
    header        = true,
    all_varchar   = true,
    ignore_errors = true
)
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> UsnFile:
    f = db.query(UsnFile).filter(UsnFile.id == file_id, UsnFile.case_id == case_id).first()
    if not f:
        raise HTTPException(404, "USN file not found")
    return f


def _case_dir(case_id: str) -> Path:
    d = USN_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_duckdb(f: UsnFile) -> str:
    if not f.duckdb_path or not Path(f.duckdb_path).exists():
        raise HTTPException(409, "USN data not available — re-upload the MFTECmd CSV")
    return f.duckdb_path


def _row_to_entry(r) -> UsnEntryOut:
    return UsnEntryOut(
        entry_offset     = r[0],
        usn              = r[1],
        filename         = r[2] or None,
        extension        = r[3] or None,
        is_directory     = bool(r[4]),
        update_timestamp = r[5],
        reason           = r[6] or None,
        full_path        = r[7],
        file_ref         = r[8],
        parent_ref       = r[9],
    )


# ── Background CSV import ─────────────────────────────────────────────────────

def _import_csv_background(file_id: str, csv_path: str, duckdb_path: str) -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        f = db.query(UsnFile).filter(UsnFile.id == file_id).first()
        if not f:
            return
        f.status         = "parsing"
        f.parse_progress = 0
        db.commit()

        parse_start = datetime.now(timezone.utc)

        col_map    = _sniff_columns(csv_path)
        create_sql = _build_create_sql(csv_path, col_map)

        conn = duckdb.connect(database=duckdb_path, read_only=False)
        try:
            conn.execute(create_sql)

            db.execute(text("UPDATE usn_files SET parse_progress = 70 WHERE id = :id"),
                       {"id": file_id})
            db.commit()

            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        finally:
            conn.close()

        duration = int((datetime.now(timezone.utc) - parse_start).total_seconds())

        f = db.query(UsnFile).filter(UsnFile.id == file_id).first()
        f.status                 = "ready"
        f.entry_count            = total
        f.parsed_at              = datetime.now(timezone.utc)
        f.parse_progress         = 100
        f.parse_duration_seconds = duration
        db.commit()

    except Exception as exc:
        db.rollback()
        try:
            Path(duckdb_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            f = db.query(UsnFile).filter(UsnFile.id == file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=UsnFileOut)
async def upload_usn_csv(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a MFTECmd $J CSV and queue it for DuckDB import."""
    _get_case_or_404(case_id, db)

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = (file.filename or "usn.csv").replace("/", "_").replace("\\", "_")
    csv_dest  = dest_dir / f"{file_id}_{safe_name}"
    ddb_dest  = dest_dir / f"{file_id}.duckdb"

    with open(csv_dest, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)

    f = UsnFile(
        id=file_id, case_id=case_id,
        filename=file.filename or "usn.csv",
        file_path=str(csv_dest),
        duckdb_path=str(ddb_dest),
        status="pending",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(f)
    audit_log(db, user=current_user, action="usn.upload",
              resource_type="usn_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(_get_case_or_404(case_id, db), "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(_import_csv_background, file_id, str(csv_dest), str(ddb_dest))
    return f


@router.get("/{case_id}/files", response_model=list[UsnFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(UsnFile)
        .filter(UsnFile.case_id == case_id)
        .order_by(UsnFile.uploaded_at.desc())
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
    for path_attr in ("file_path", "duckdb_path"):
        try:
            p = getattr(f, path_attr)
            if p:
                Path(p).unlink(missing_ok=True)
                Path(p + ".wal").unlink(missing_ok=True)
        except Exception:
            pass
    audit_log(db, user=current_user, action="usn.delete",
              resource_type="usn_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=UsnSummary)
def get_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        stats = conn.execute("""
            SELECT COUNT(*), MIN(update_timestamp), MAX(update_timestamp)
            FROM entries
        """).fetchone()

        reasons = conn.execute("""
            SELECT reason, COUNT(*) AS cnt
            FROM   entries
            WHERE  reason IS NOT NULL AND reason != ''
            GROUP  BY reason
            ORDER  BY cnt DESC
            LIMIT  30
        """).fetchall()

        exts = conn.execute("""
            SELECT extension, COUNT(*) AS cnt
            FROM   entries
            WHERE  extension IS NOT NULL AND extension != '' AND NOT is_directory
            GROUP  BY extension
            ORDER  BY cnt DESC
            LIMIT  20
        """).fetchall()
    finally:
        conn.close()

    total = f.entry_count if f.entry_count is not None else (stats[0] or 0)

    return UsnSummary(
        total_entries     = total,
        oldest_timestamp  = stats[1],
        newest_timestamp  = stats[2],
        top_reasons       = [{"reason": r[0], "count": r[1]} for r in reasons],
        top_extensions    = [{"ext": r[0], "count": r[1]} for r in exts],
    )


@router.get("/{case_id}/files/{file_id}/entries", response_model=UsnEntriesPage)
def list_entries(
    case_id:   str,
    file_id:   str,
    page:      int           = Query(1,   ge=1),
    page_size: int           = Query(200, ge=1, le=1000),
    search:    str           = Query(""),
    reason:    str           = Query(""),
    extension: str           = Query(""),
    time_from: Optional[str] = Query(None),
    time_to:   Optional[str] = Query(None),
    sort_dir:  str           = Query("asc"),
    db:        Session       = Depends(get_db),
):
    """Paginated + filtered USN Journal entries from DuckDB."""
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    search_term = search.strip()
    reason_filter = reason.strip()
    ext_filter    = extension.strip().lower().lstrip(".")
    sd = "DESC" if sort_dir == "desc" else "ASC"

    dt_from = dt_to = None
    if time_from:
        try: dt_from = datetime.fromisoformat(time_from)
        except ValueError: pass
    if time_to:
        try: dt_to = datetime.fromisoformat(time_to)
        except ValueError: pass

    conditions: list[str] = ["update_timestamp IS NOT NULL"]
    params:     list      = []

    if search_term:
        conditions.append("(filename ILIKE ? OR full_path ILIKE ?)")
        params += [f"%{search_term}%", f"%{search_term}%"]

    if reason_filter:
        conditions.append("reason ILIKE ?")
        params.append(f"%{reason_filter}%")

    if ext_filter:
        conditions.append("extension = ?")
        params.append(ext_filter)

    if dt_from:
        conditions.append("update_timestamp >= ?")
        params.append(dt_from)
    if dt_to:
        conditions.append("update_timestamp <= ?")
        params.append(dt_to)

    where = "WHERE " + " AND ".join(conditions)
    order = f"ORDER BY update_timestamp {sd}, entry_offset {sd}"

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        has_filters = bool(search_term or reason_filter or ext_filter or dt_from or dt_to)
        if not has_filters and f.entry_count is not None:
            total = f.entry_count
        else:
            total = conn.execute(f"SELECT COUNT(*) FROM entries {where}", params).fetchone()[0]

        pages = max(1, math.ceil(total / page_size))

        rows = conn.execute(
            f"SELECT {_ENTRY_COLS} FROM entries {where} {order} LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
    finally:
        conn.close()

    return UsnEntriesPage(
        total=total, page=page, page_size=page_size, pages=pages,
        items=[_row_to_entry(r) for r in rows],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=UsnFileOut)
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
    db.commit()
    db.refresh(f)

    background_tasks.add_task(_import_csv_background, file_id, f.file_path, ddb_dest)
    return f


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=UsnFileOut)
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
    size      = 0
    try: size = file_path.stat().st_size
    except Exception: pass

    md5_hash = sha256_hash = ""
    try:
        md5 = hashlib.md5(); sha256 = hashlib.sha256()
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk); sha256.update(chunk)
        md5_hash    = md5.hexdigest()
        sha256_hash = sha256.hexdigest()
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    ev  = Evidence(
        case_id=case_id, name=f.filename,
        description=f"NTFS USN Journal (MFTECmd CSV) — {f.entry_count or '?'} records",
        file_path=f.file_path, original_filename=f.filename,
        file_size=size, mime_type="text/csv",
        md5_hash=md5_hash, sha256_hash=sha256_hash,
        evidence_type=EvidenceType.artifact,
        acquisition_method=AcquisitionMethod.logical_copy,
        collected_by=current_user.username,
        collected_at=now,
        chain_of_custody=(
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
            f"via USN Journal CSV import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
        ),
    )
    db.add(ev)
    f.added_to_evidence = True
    audit_log(db, user=current_user, action="usn.add_evidence",
              resource_type="usn_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f
