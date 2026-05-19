"""
Prefetch analysis via PECmd CSV import + DuckDB query engine.

Workflow:
  1. Run PECmd.exe against a Prefetch directory or individual .pf files:
       PECmd.exe -d "C:\\Windows\\Prefetch" --csv "C:\\output" --csvf prefetch.csv
  2. Upload the resulting CSV here
  3. Background task imports the CSV into a per-file DuckDB database
  4. All explorer queries run against DuckDB — fast even on thousands of entries

DuckDB schema (entries table):
  row_num, source_filename, executable_name, hash, size, version,
  run_count, last_run,
  prev_run_0 … prev_run_6,
  volume0_name, volume0_serial, volume1_name,
  directories, files_loaded
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
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.case import Case
from ..models.evidence import Evidence, EvidenceType, AcquisitionMethod
from ..models.prefetch import PrefetchFile
from ..models.user import User
from ..schemas.prefetch import PrefetchFileOut, PrefetchEntryOut, PrefetchEntriesPage, PrefetchSummary
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/prefetch", tags=["prefetch"])

PREFETCH_DIR = settings.evidence_store_path.parent / "prefetch"

# ── Column sniffing ───────────────────────────────────────────────────────────

def _sniff_columns(csv_path: str) -> dict[str, str]:
    """Return {lowercase_header: original_header}. Handles UTF-8 BOM."""
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            with open(csv_path, newline="", encoding=enc) as f:
                headers = next(_csv.reader(f), [])
            return {h.lower().strip(): h.strip() for h in headers if h.strip()}
        except Exception:
            continue
    return {}


def _col(col_map: dict[str, str], *candidates: str) -> str:
    """Return quoted column reference or NULL if not found."""
    for c in candidates:
        if c.lower() in col_map:
            return f'"{col_map[c.lower()]}"'
    return "NULL"


def _build_create_sql(csv_path: str, col_map: dict[str, str]) -> str:
    """Build CREATE TABLE … AS SELECT … for PECmd prefetch CSV."""
    c = lambda *args: _col(col_map, *args)  # noqa: E731

    return f"""
CREATE TABLE entries AS
SELECT
    ROW_NUMBER() OVER ()                                          AS row_num,
    {c('sourcefilename', 'source filename', 'source_filename')}   AS source_filename,
    {c('executablename', 'executable name', 'executable_name')}   AS executable_name,
    {c('hash')}                                                   AS hash,
    TRY_CAST({c('size')} AS BIGINT)                               AS size,
    {c('version')}                                                AS version,
    TRY_CAST({c('runcount', 'run count', 'run_count')} AS INTEGER) AS run_count,
    TRY_CAST({c('lastrun', 'last run', 'last_run')} AS TIMESTAMP)  AS last_run,
    TRY_CAST({c('previousrun0', 'previous run0', 'previousrun 0')} AS TIMESTAMP) AS prev_run_0,
    TRY_CAST({c('previousrun1', 'previous run1', 'previousrun 1')} AS TIMESTAMP) AS prev_run_1,
    TRY_CAST({c('previousrun2', 'previous run2', 'previousrun 2')} AS TIMESTAMP) AS prev_run_2,
    TRY_CAST({c('previousrun3', 'previous run3', 'previousrun 3')} AS TIMESTAMP) AS prev_run_3,
    TRY_CAST({c('previousrun4', 'previous run4', 'previousrun 4')} AS TIMESTAMP) AS prev_run_4,
    TRY_CAST({c('previousrun5', 'previous run5', 'previousrun 5')} AS TIMESTAMP) AS prev_run_5,
    TRY_CAST({c('previousrun6', 'previous run6', 'previousrun 6')} AS TIMESTAMP) AS prev_run_6,
    {c('volume0name', 'volume 0 name', 'volume0 name')}           AS volume0_name,
    {c('volume0serial', 'volume 0 serial', 'volume0 serial')}     AS volume0_serial,
    {c('volume1name', 'volume 1 name', 'volume1 name')}           AS volume1_name,
    {c('directories')}                                            AS directories,
    {c('filesloaded', 'files loaded', 'files_loaded')}            AS files_loaded
FROM read_csv(
    {csv_path!r},
    header        = true,
    all_varchar   = true,
    ignore_errors = true
)
"""


# ── Column list for SELECT queries ────────────────────────────────────────────

_ENTRY_COLS = """
    row_num, source_filename, executable_name, hash, size, version,
    run_count, last_run,
    prev_run_0, prev_run_1, prev_run_2, prev_run_3,
    prev_run_4, prev_run_5, prev_run_6,
    volume0_name, volume0_serial, volume1_name,
    directories, files_loaded
"""


def _row_to_entry(r) -> PrefetchEntryOut:
    return PrefetchEntryOut(
        row_num=r[0],
        source_filename=r[1],
        executable_name=r[2],
        hash=r[3],
        size=r[4],
        version=r[5],
        run_count=r[6],
        last_run=r[7],
        prev_run_0=r[8],
        prev_run_1=r[9],
        prev_run_2=r[10],
        prev_run_3=r[11],
        prev_run_4=r[12],
        prev_run_5=r[13],
        prev_run_6=r[14],
        volume0_name=r[15],
        volume0_serial=r[16],
        volume1_name=r[17],
        directories=r[18],
        files_loaded=r[19],
    )


# ── CRUD helpers ──────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> PrefetchFile:
    f = db.query(PrefetchFile).filter(
        PrefetchFile.id == file_id, PrefetchFile.case_id == case_id
    ).first()
    if not f:
        raise HTTPException(404, "Prefetch file not found")
    return f


def _case_dir(case_id: str) -> Path:
    d = PREFETCH_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_duckdb(f: PrefetchFile) -> str:
    if not f.duckdb_path or not Path(f.duckdb_path).exists():
        raise HTTPException(409, "Prefetch data not available — re-upload the PECmd CSV")
    return f.duckdb_path


# ── Background CSV import ─────────────────────────────────────────────────────

def _import_csv_background(file_id: str, csv_path: str, duckdb_path: str) -> None:
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        f = db.query(PrefetchFile).filter(PrefetchFile.id == file_id).first()
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
            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        finally:
            conn.close()

        f = db.query(PrefetchFile).filter(PrefetchFile.id == file_id).first()
        f.status                 = "ready"
        f.entry_count            = total
        f.parsed_at              = datetime.now(timezone.utc)
        f.parse_progress         = 100
        f.parse_duration_seconds = int((datetime.now(timezone.utc) - parse_start).total_seconds())
        db.commit()

    except Exception as exc:
        db.rollback()
        try:
            Path(duckdb_path).unlink(missing_ok=True)
        except Exception:
            pass
        try:
            f = db.query(PrefetchFile).filter(PrefetchFile.id == file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=PrefetchFileOut)
async def upload_prefetch_csv(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a PECmd prefetch CSV and queue it for DuckDB import."""
    _get_case_or_404(case_id, db)

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = (file.filename or "prefetch.csv").replace("/", "_").replace("\\", "_")
    csv_dest  = dest_dir / f"{file_id}_{safe_name}"
    ddb_dest  = dest_dir / f"{file_id}.duckdb"

    with open(csv_dest, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)

    f = PrefetchFile(
        id=file_id, case_id=case_id,
        filename=file.filename or "prefetch.csv",
        file_path=str(csv_dest),
        duckdb_path=str(ddb_dest),
        status="pending",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(f)
    case = _get_case_or_404(case_id, db)
    audit_log(db, user=current_user, action="prefetch.upload",
              resource_type="prefetch_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(_import_csv_background, file_id, str(csv_dest), str(ddb_dest))
    return f


@router.get("/{case_id}/files", response_model=list[PrefetchFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(PrefetchFile)
        .filter(PrefetchFile.case_id == case_id)
        .order_by(PrefetchFile.uploaded_at.desc())
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
    audit_log(db, user=current_user, action="prefetch.delete",
              resource_type="prefetch_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=PrefetchSummary)
def get_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        stats = conn.execute("""
            SELECT
                COUNT(*)                        AS total,
                SUM(COALESCE(run_count, 0))     AS total_runs,
                MIN(last_run)                   AS oldest,
                MAX(last_run)                   AS newest
            FROM entries
        """).fetchone()

        top_exes = conn.execute("""
            SELECT executable_name, run_count, last_run
            FROM   entries
            WHERE  executable_name IS NOT NULL
            ORDER  BY run_count DESC NULLS LAST, last_run DESC NULLS LAST
            LIMIT  20
        """).fetchall()

        versions = conn.execute("""
            SELECT version, COUNT(*) AS cnt
            FROM   entries
            WHERE  version IS NOT NULL AND version != ''
            GROUP  BY version
            ORDER  BY cnt DESC
        """).fetchall()
    finally:
        conn.close()

    total = f.entry_count if f.entry_count is not None else (stats[0] or 0)

    return PrefetchSummary(
        total_entries   = total,
        total_runs      = int(stats[1] or 0),
        oldest_last_run = stats[2],
        newest_last_run = stats[3],
        top_executables = [
            {"executable_name": r[0], "run_count": r[1], "last_run": r[2]}
            for r in top_exes
        ],
        versions = [{"version": r[0], "count": r[1]} for r in versions],
    )


@router.get("/{case_id}/files/{file_id}/entries", response_model=PrefetchEntriesPage)
def list_entries(
    case_id:   str,
    file_id:   str,
    page:      int           = Query(1,   ge=1),
    page_size: int           = Query(200, ge=1, le=1000),
    search:    str           = Query(""),
    version:   str           = Query(""),
    time_from: Optional[str] = Query(None),
    time_to:   Optional[str] = Query(None),
    sort_by:   str           = Query("last_run"),
    sort_dir:  str           = Query("desc"),
    db:        Session       = Depends(get_db),
):
    """Paginated + filtered prefetch entries from DuckDB."""
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    _SAFE_SORT = {"last_run", "run_count", "executable_name"}
    sc = sort_by  if sort_by  in _SAFE_SORT else "last_run"
    sd = "DESC"   if sort_dir == "desc"     else "ASC"

    search_term = search.strip()
    ver_filter  = version.strip()

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
        conditions.append(
            "(executable_name ILIKE ? OR source_filename ILIKE ? OR files_loaded ILIKE ?)"
        )
        params += [f"%{search_term}%", f"%{search_term}%", f"%{search_term}%"]

    if ver_filter:
        conditions.append("version ILIKE ?")
        params.append(f"%{ver_filter}%")

    if dt_from:
        conditions.append("last_run >= ?")
        params.append(dt_from)
    if dt_to:
        conditions.append("last_run <= ?")
        params.append(dt_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order = f"ORDER BY {sc} {sd} NULLS LAST, row_num ASC"

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        has_filters = bool(search_term or ver_filter or dt_from or dt_to)
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

    return PrefetchEntriesPage(
        total=total, page=page, page_size=page_size, pages=pages,
        items=[_row_to_entry(r) for r in rows],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=PrefetchFileOut)
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


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=PrefetchFileOut)
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
        description=f"Windows Prefetch (PECmd CSV) — {f.entry_count or '?'} entries",
        file_path=f.file_path, original_filename=f.filename,
        file_size=size, mime_type="text/csv",
        md5_hash=md5_hash, sha256_hash=sha256_hash,
        evidence_type=EvidenceType.artifact,
        acquisition_method=AcquisitionMethod.logical_copy,
        collected_by=current_user.username, collected_at=now,
        chain_of_custody=(
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
            f"via PECmd prefetch CSV import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
        ),
    )
    db.add(ev)
    f.added_to_evidence = True
    audit_log(db, user=current_user, action="prefetch.add_evidence",
              resource_type="prefetch_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f
