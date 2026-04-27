"""
MFT analysis via MFTECmd CSV import + DuckDB query engine.

Workflow:
  1. User runs MFTECmd.exe on the raw $MFT binary (takes ~30s, produces a CSV)
  2. User uploads the CSV here
  3. Background task imports the CSV into a per-file DuckDB database
  4. All explorer queries run against DuckDB — sub-second even on 1.4M rows

Column mapping from MFTECmd CSV → DuckDB table:
  EntryNumber / ParentEntryNumber / ParentPath / FileName / Extension / FileSize
  InUse / IsDirectory / SI<FN (timestomping flag)
  Created0x10 … LastAccess0x10  (SI timestamps)
  Created0x30 … LastAccess0x30  (FN timestamps)
"""
from __future__ import annotations

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
from ..models.mft import MftFile
from ..models.user import User
from ..schemas.mft import MftFileOut, MftEntryOut, EntriesPage, MftSummary
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/mft", tags=["mft"])

MFT_DIR = settings.evidence_store_path.parent / "mft"

# ── Valid timestamp column names (whitelist — interpolated into SQL) ───────────

_SAFE_COLS = {
    "si_created", "si_modified", "si_accessed", "si_mft_changed",
    "fn_created", "fn_modified", "fn_accessed", "fn_mft_changed",
}

# ── DuckDB CREATE TABLE from MFTECmd CSV ──────────────────────────────────────

_CREATE_ENTRIES_SQL = """
CREATE TABLE entries AS
SELECT
    TRY_CAST("EntryNumber"       AS INTEGER)   AS entry_number,
    TRY_CAST("ParentEntryNumber" AS INTEGER)   AS parent_entry_number,
    "ParentPath"                               AS parent_path,
    "FileName"                                 AS filename,
    LOWER(COALESCE("Extension", ''))           AS extension,
    TRY_CAST("FileSize" AS BIGINT)             AS file_size,
    ("InUse"      ILIKE 'true')                AS is_in_use,
    NOT ("InUse"  ILIKE 'true')                AS is_deleted,
    ("IsDirectory" ILIKE 'true')               AS is_directory,
    TRY_CAST("Created0x10"          AS TIMESTAMP) AS si_created,
    TRY_CAST("LastModified0x10"     AS TIMESTAMP) AS si_modified,
    TRY_CAST("LastRecordChange0x10" AS TIMESTAMP) AS si_mft_changed,
    TRY_CAST("LastAccess0x10"       AS TIMESTAMP) AS si_accessed,
    TRY_CAST("Created0x30"          AS TIMESTAMP) AS fn_created,
    TRY_CAST("LastModified0x30"     AS TIMESTAMP) AS fn_modified,
    TRY_CAST("LastRecordChange0x30" AS TIMESTAMP) AS fn_mft_changed,
    TRY_CAST("LastAccess0x30"       AS TIMESTAMP) AS fn_accessed,
    ("SI<FN" ILIKE 'true')                     AS has_ts_anomaly,
FROM read_csv(
    {csv_path!r},
    header      = true,
    all_varchar = true,
    ignore_errors = true
)
"""

# Columns returned in list_entries queries
_ENTRY_COLS = """
    entry_number, parent_entry_number, parent_path, filename, extension,
    file_size, is_in_use, is_deleted, is_directory,
    si_created, si_modified, si_mft_changed, si_accessed,
    fn_created, fn_modified, fn_mft_changed, fn_accessed,
    has_ts_anomaly
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> MftFile:
    f = db.query(MftFile).filter(MftFile.id == file_id, MftFile.case_id == case_id).first()
    if not f:
        raise HTTPException(404, "MFT file not found")
    return f


def _case_dir(case_id: str) -> Path:
    d = MFT_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_duckdb(f: MftFile) -> str:
    """Return the DuckDB path or raise 409 if not available."""
    if not f.duckdb_path or not Path(f.duckdb_path).exists():
        raise HTTPException(
            409,
            "MFT data not available — re-upload the MFTECmd CSV to rebuild"
        )
    return f.duckdb_path


def _row_to_entry(r) -> MftEntryOut:
    """Convert a DuckDB Row to MftEntryOut."""
    return MftEntryOut(
        entry_number        = r[0],
        parent_entry_number = r[1],
        parent_path         = r[2],
        filename            = r[3],
        extension           = r[4] or None,
        file_size           = r[5],
        is_in_use           = bool(r[6]),
        is_deleted          = bool(r[7]),
        is_directory        = bool(r[8]),
        si_created          = r[9],
        si_modified         = r[10],
        si_mft_changed      = r[11],
        si_accessed         = r[12],
        fn_created          = r[13],
        fn_modified         = r[14],
        fn_mft_changed      = r[15],
        fn_accessed         = r[16],
        has_ts_anomaly      = bool(r[17]),
    )


# ── Background CSV import ─────────────────────────────────────────────────────

def _import_csv_background(file_id: str, csv_path: str, duckdb_path: str) -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        f = db.query(MftFile).filter(MftFile.id == file_id).first()
        if not f:
            return
        f.status         = "parsing"
        f.parse_progress = 0
        db.commit()

        parse_start = datetime.now(timezone.utc)

        # ── Phase 1: import CSV → DuckDB (bulk, single operation) ─────────────
        conn = duckdb.connect(database=duckdb_path, read_only=False)
        try:
            sql = _CREATE_ENTRIES_SQL.format(csv_path=csv_path)
            conn.execute(sql)

            db.execute(text("UPDATE mft_files SET parse_progress = 70 WHERE id = :id"),
                       {"id": file_id})
            db.commit()

            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]

        finally:
            conn.close()

        # ── Phase 2: record results ───────────────────────────────────────────
        duration = int((datetime.now(timezone.utc) - parse_start).total_seconds())

        f = db.query(MftFile).filter(MftFile.id == file_id).first()
        f.status                 = "ready"
        f.entry_count            = total
        f.parsed_at              = datetime.now(timezone.utc)
        f.parse_progress         = 100
        f.parse_duration_seconds = duration
        db.commit()

    except Exception as exc:
        db.rollback()
        # Remove broken DuckDB file if it exists
        try:
            Path(duckdb_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            f = db.query(MftFile).filter(MftFile.id == file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=MftFileOut)
async def upload_mft_csv(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a MFTECmd CSV file and queue it for DuckDB import."""
    _get_case_or_404(case_id, db)

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = (file.filename or "mft.csv").replace("/", "_").replace("\\", "_")
    csv_dest  = dest_dir / f"{file_id}_{safe_name}"
    ddb_dest  = dest_dir / f"{file_id}.duckdb"

    with open(csv_dest, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)

    f = MftFile(
        id=file_id, case_id=case_id,
        filename=file.filename or "mft.csv",
        file_path=str(csv_dest),
        duckdb_path=str(ddb_dest),
        status="pending",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(f)
    audit_log(db, user=current_user, action="mft.upload",
              resource_type="mft_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(_get_case_or_404(case_id, db), "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(_import_csv_background, file_id, str(csv_dest), str(ddb_dest))
    return f


@router.get("/{case_id}/files", response_model=list[MftFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(MftFile)
        .filter(MftFile.case_id == case_id)
        .order_by(MftFile.uploaded_at.desc())
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
                # DuckDB also creates a .wal file
                Path(p + ".wal").unlink(missing_ok=True)
        except Exception:
            pass
    audit_log(db, user=current_user, action="mft.delete",
              resource_type="mft_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=MftSummary)
def get_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    f       = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        stats = conn.execute("""
            SELECT
                COUNT(*)                                               AS total,
                SUM(CASE WHEN is_deleted   THEN 1 ELSE 0 END)         AS deleted,
                SUM(CASE WHEN is_directory THEN 1 ELSE 0 END)         AS dirs,
                MIN(si_modified)                                       AS oldest,
                MAX(si_modified)                                       AS newest
            FROM entries
        """).fetchone()

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

    total   = f.entry_count if f.entry_count is not None else (stats[0] or 0)
    deleted = stats[1] or 0
    dirs    = stats[2] or 0

    return MftSummary(
        total_entries=total, deleted_count=deleted,
        directory_count=dirs, file_count=total - dirs,
        oldest_si_modified=stats[3], newest_si_modified=stats[4],
        top_extensions=[{"ext": r[0], "count": r[1]} for r in exts],
    )


@router.get("/{case_id}/files/{file_id}/entries", response_model=EntriesPage)
def list_entries(
    case_id:    str,
    file_id:    str,
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(200, ge=1, le=1000),
    search:     str           = Query(""),
    flags:      str           = Query(""),
    extension:  str           = Query(""),
    time_field: str           = Query("si_modified"),
    time_from:  Optional[str] = Query(None),
    time_to:    Optional[str] = Query(None),
    sort_by:    str           = Query("si_modified"),
    sort_dir:   str           = Query("asc"),
    db:         Session       = Depends(get_db),
):
    """Paginated + filtered MFT entries — served from DuckDB (columnar, fast)."""
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    search_term = search.strip()
    flag_list   = [x.strip().lower() for x in flags.split(",") if x.strip()]
    ext_filter  = extension.strip().lower().lstrip(".")

    # Whitelist column names (never interpolate raw user input into SQL)
    tc = time_field if time_field in _SAFE_COLS else "si_modified"
    sc = sort_by    if sort_by    in _SAFE_COLS else "si_modified"
    sd = "DESC" if sort_dir == "desc" else "ASC"

    # Parse datetime bounds
    dt_from = dt_to = None
    if time_from:
        try: dt_from = datetime.fromisoformat(time_from)
        except ValueError: pass
    if time_to:
        try: dt_to = datetime.fromisoformat(time_to)
        except ValueError: pass

    # ── Build WHERE ───────────────────────────────────────────────────────────
    conditions: list[str] = []
    params:     list      = []

    if search_term:
        conditions.append("(filename ILIKE ? OR parent_path ILIKE ?)")
        params += [f"%{search_term}%", f"%{search_term}%"]

    for flag in flag_list:
        if   flag == "deleted":   conditions.append("is_deleted = true")
        elif flag == "active":    conditions.append("is_deleted = false")
        elif flag == "directory": conditions.append("is_directory = true")
        elif flag == "file":      conditions.append("is_directory = false")
        elif flag == "anomaly":   conditions.append("has_ts_anomaly = true")

    if ext_filter:
        conditions.append("extension = ?")
        params.append(ext_filter)

    if dt_from:
        conditions.append(f"{tc} >= ?")
        params.append(dt_from)
    if dt_to:
        conditions.append(f"{tc} <= ?")
        params.append(dt_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order = f"ORDER BY {sc} {sd} NULLS LAST, entry_number ASC"

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        # Count — use cached value when no filters active
        has_filters = bool(conditions)
        if not has_filters and f.entry_count is not None:
            total = f.entry_count
        else:
            total = conn.execute(
                f"SELECT COUNT(*) FROM entries {where}", params
            ).fetchone()[0]

        pages = max(1, math.ceil(total / page_size))

        rows = conn.execute(
            f"SELECT {_ENTRY_COLS} FROM entries {where} {order} LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
    finally:
        conn.close()

    return EntriesPage(
        total=total, page=page, page_size=page_size, pages=pages,
        items=[_row_to_entry(r) for r in rows],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=MftFileOut)
def reparse_file(
    case_id:          str,
    file_id:          str,
    background_tasks: BackgroundTasks,
    db:               Session = Depends(get_db),
    current_user:     User    = Depends(get_current_user),
):
    """Delete the DuckDB database and re-import from the stored CSV."""
    f = _get_file_or_404(file_id, case_id, db)
    if not f.file_path or not Path(f.file_path).exists():
        raise HTTPException(400, "Original CSV no longer available — please re-upload")

    # Remove old DuckDB file
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


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=MftFileOut)
def add_to_evidence(
    case_id:      str,
    file_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Hash the CSV file and create a chain-of-custody Evidence record."""
    f    = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    if f.added_to_evidence:
        raise HTTPException(400, "Already added to evidence")

    file_path = Path(f.file_path)
    try:
        size = file_path.stat().st_size
    except Exception:
        size = 0

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
        description=f"NTFS MFT (MFTECmd CSV) — {f.entry_count or '?'} entries",
        file_path=f.file_path, original_filename=f.filename,
        file_size=size, mime_type="text/csv",
        md5_hash=md5_hash, sha256_hash=sha256_hash,
        evidence_type=EvidenceType.artifact,
        acquisition_method=AcquisitionMethod.logical_copy,
        collected_by=current_user.username,
        collected_at=now,
        chain_of_custody=(
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
            f"via MFT CSV import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
        ),
    )
    db.add(ev)
    f.added_to_evidence = True
    audit_log(db, user=current_user, action="mft.add_evidence",
              resource_type="mft_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f
