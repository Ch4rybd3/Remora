"""
Registry artifact analysis via RECmd / Registry Explorer CSV import + DuckDB.

Workflow
--------
1. Export registry hive(s) with RECmd (batch mode recommended) or Registry Explorer.
2. Upload the resulting CSV here.
3. Background task auto-detects hive type + imports all columns into per-file DuckDB.
4. Explorer queries run against DuckDB for fast, filtered navigation.

DuckDB schema for ``entries``
-----------------------------
Normalized columns (always present, positions 0–8):
    row_num, timestamp, hive_path, hive_type, key_path,
    value_name, value_type, value_data, deleted

Raw columns (dynamic, positions 9+):
    r0, r1, r2, … — one per original CSV column, in CSV order
``columns_json`` on the RegistryFile model stores the mapping [col_name, …].

Supported input formats
-----------------------
* RECmd batch mode  → HivePath, HiveType, Description, Category, KeyPath,
                      ValueName, ValueType, ValueData, ValueData2, ValueData3,
                      Comment, Recursive, DeletedRecord, LastWriteTimestamp
* RECmd key mode    → HivePath, HiveType, KeyPath, ValueName, ValueType,
                      ValueData, LastWriteTimestamp
* Registry Explorer → similar, column names may differ slightly
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
from ..core.deps import get_current_user
from ..database import SessionLocal, get_db
from ..models.case import Case
from ..models.evidence import AcquisitionMethod, Evidence, EvidenceType
from ..models.registry import RegistryFile
from ..models.user import User
from ..schemas.registry import (
    RegistryEntriesPage, RegistryEntryOut, RegistryFileOut, RegistrySummary,
)
from ..services.audit_service import audit_log

router = APIRouter(prefix="/registry", tags=["registry"])

REGISTRY_DIR = settings.evidence_store_path.parent / "registry"

# ── Constants ─────────────────────────────────────────────────────────────────

_BASE_COLS = 9  # row_num, timestamp, hive_path, hive_type, key_path,
                #  value_name, value_type, value_data, deleted

# ── Hive-type detection from filename ─────────────────────────────────────────

def _detect_hive_type(filename: str, col_map: dict[str, str]) -> str:
    """
    Returns a file-level hive type label.
    If the CSV has a HiveType column, it's a batch export (BATCH).
    Otherwise we guess from the filename.
    """
    # Batch RECmd output always has a HiveType column
    if "hivetype" in col_map or "hive type" in col_map:
        return "BATCH"
    fname = filename.lower()
    if "ntuser"    in fname: return "NTUSER"
    if "usrclass"  in fname: return "USRCLASS"
    if "amcache"   in fname: return "AMCACHE"
    if "shimcache" in fname or "appcompat" in fname: return "SHIMCACHE"
    if "system"    in fname: return "SYSTEM"
    if "software"  in fname: return "SOFTWARE"
    if "sam"       in fname: return "SAM"
    if "security"  in fname: return "SECURITY"
    return "GENERIC"

# ── CSV column sniffing (BOM-safe) ────────────────────────────────────────────

def _sniff_columns(csv_path: str) -> dict[str, str]:
    """Return {lowercase_stripped_header: original_header}. Strips UTF-8 BOM."""
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
                      col_names: list[str], hive_type: str) -> str:
    """Build CREATE TABLE … AS SELECT … with normalized + all raw columns."""

    def r(*candidates: str) -> str:
        for c in candidates:
            if c.lower() in col_map:
                return f'"{col_map[c.lower()]}"'
        return "NULL"

    # Normalized candidates — broad to cover RECmd batch + key mode + RegExplorer
    ts_col         = r("lastwritetimestamp", "last write timestamp", "timestamp",
                       "last modified", "lastmodified", "date", "time")
    hive_path_col  = r("hivepath", "hive path", "hive", "sourcefile", "source file")
    hive_type_col  = r("hivetype", "hive type")
    key_path_col   = r("keypath", "key path", "path", "key", "registrykey",
                       "registry key", "subkey")
    val_name_col   = r("valuename", "value name", "name", "valuenames")
    val_type_col   = r("valuetype", "value type", "type", "datatype", "data type")
    val_data_col   = r("valuedata", "value data", "data", "valuedata1")
    deleted_col    = r("deletedrecord", "deleted record", "deleted", "isdeleted",
                       "is deleted", "isrecovereddeletedrecord")

    select_parts = [
        "    ROW_NUMBER() OVER ()                                            AS row_num",
        f"    TRY_CAST({ts_col} AS TIMESTAMP)                               AS timestamp",
        f"    NULLIF(TRIM(COALESCE({hive_path_col}, '')), '')               AS hive_path",
        f"    NULLIF(TRIM(COALESCE({hive_type_col}, '{hive_type}')), '')    AS hive_type",
        f"    NULLIF(TRIM(COALESCE({key_path_col},  '')), '')               AS key_path",
        f"    NULLIF(TRIM(COALESCE({val_name_col},  '')), '')               AS value_name",
        f"    NULLIF(TRIM(COALESCE({val_type_col},  '')), '')               AS value_type",
        f"    NULLIF(TRIM(COALESCE({val_data_col},  '')), '')               AS value_data",
        f"    NULLIF(TRIM(COALESCE({deleted_col},   '')), '')               AS deleted",
    ]

    for i, col in enumerate(col_names):
        select_parts.append(
            f'    CAST(COALESCE("{col}", \'\') AS VARCHAR)                  AS r{i}'
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
    base = ("row_num, timestamp, hive_path, hive_type, key_path, "
            "value_name, value_type, value_data, deleted")
    if n_raw == 0:
        return base
    return base + ", " + ", ".join(f"r{i}" for i in range(n_raw))


def _row_to_entry(row, col_names: list[str]) -> RegistryEntryOut:
    raw_data: dict[str, str] = {}
    for i, name in enumerate(col_names):
        idx = _BASE_COLS + i
        val = row[idx] if len(row) > idx else None
        if val is not None and str(val) != "":
            raw_data[name] = str(val)

    def s(v) -> Optional[str]:
        if v is None or (isinstance(v, str) and v == ""):
            return None
        return str(v)

    return RegistryEntryOut(
        row_num    = row[0],
        timestamp  = row[1],
        hive_path  = s(row[2]),
        hive_type  = s(row[3]),
        key_path   = s(row[4]),
        value_name = s(row[5]),
        value_type = s(row[6]),
        value_data = s(row[7]),
        deleted    = s(row[8]),
        raw_data   = raw_data,
    )

# ── CRUD helpers ──────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> RegistryFile:
    f = db.query(RegistryFile).filter(
        RegistryFile.id == file_id, RegistryFile.case_id == case_id,
    ).first()
    if not f:
        raise HTTPException(404, "Registry file not found")
    return f


def _case_dir(case_id: str) -> Path:
    d = REGISTRY_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _require_duckdb(f: RegistryFile) -> str:
    if not f.duckdb_path or not Path(f.duckdb_path).exists():
        raise HTTPException(409, "Registry data not available — re-upload the CSV")
    return f.duckdb_path

# ── Background CSV import ─────────────────────────────────────────────────────

def _import_csv_background(file_id: str, csv_path: str,
                            duckdb_path: str, hive_type: str) -> None:
    db = SessionLocal()
    try:
        f = db.query(RegistryFile).filter(RegistryFile.id == file_id).first()
        if not f:
            return
        f.status         = "parsing"
        f.parse_progress = 0
        db.commit()

        parse_start = datetime.now(timezone.utc)

        col_map   = _sniff_columns(csv_path)
        col_names = list(col_map.values())
        create_sql = _build_create_sql(csv_path, col_map, col_names, hive_type)

        conn = duckdb.connect(database=duckdb_path, read_only=False)
        try:
            conn.execute(create_sql)
            db.execute(
                text("UPDATE registry_files SET parse_progress = 80 WHERE id = :id"),
                {"id": file_id},
            )
            db.commit()
            total = conn.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
        finally:
            conn.close()

        duration = int((datetime.now(timezone.utc) - parse_start).total_seconds())

        f = db.query(RegistryFile).filter(RegistryFile.id == file_id).first()
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
            f = db.query(RegistryFile).filter(RegistryFile.id == file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=RegistryFileOut)
async def upload_registry_csv(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a RECmd / Registry Explorer CSV and queue it for DuckDB import."""
    case = _get_case_or_404(case_id, db)

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = (file.filename or "registry.csv").replace("/", "_").replace("\\", "_")
    csv_dest  = dest_dir / f"{file_id}_{safe_name}"
    ddb_dest  = dest_dir / f"{file_id}.duckdb"

    with open(csv_dest, "wb") as out:
        while chunk := await file.read(1 << 20):
            out.write(chunk)

    # Sniff columns now (fast) to detect hive type before background task
    col_map   = _sniff_columns(str(csv_dest))
    hive_type = _detect_hive_type(safe_name, col_map)

    f = RegistryFile(
        id=file_id, case_id=case_id,
        filename=file.filename or "registry.csv",
        file_path=str(csv_dest),
        duckdb_path=str(ddb_dest),
        hive_type=hive_type,
        status="pending",
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(f)
    audit_log(db, user=current_user, action="registry.upload",
              resource_type="registry_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(
        _import_csv_background, file_id, str(csv_dest), str(ddb_dest), hive_type,
    )
    return f


@router.get("/{case_id}/files", response_model=list[RegistryFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(RegistryFile)
        .filter(RegistryFile.case_id == case_id)
        .order_by(RegistryFile.uploaded_at.desc())
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
    audit_log(db, user=current_user, action="registry.delete",
              resource_type="registry_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=RegistrySummary)
def get_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        stats = conn.execute("""
            SELECT COUNT(*), MIN(timestamp), MAX(timestamp) FROM entries
        """).fetchone()

        hive_types = conn.execute("""
            SELECT hive_type, COUNT(*) AS cnt
            FROM   entries
            WHERE  hive_type IS NOT NULL AND hive_type != ''
            GROUP  BY hive_type ORDER BY cnt DESC LIMIT 20
        """).fetchall()

        val_types = conn.execute("""
            SELECT value_type, COUNT(*) AS cnt
            FROM   entries
            WHERE  value_type IS NOT NULL AND value_type != ''
            GROUP  BY value_type ORDER BY cnt DESC LIMIT 15
        """).fetchall()

        # Category column only present in batch exports
        categories: list = []
        col_names = json.loads(f.columns_json or "[]")
        if any(c.lower() in ("category",) for c in col_names):
            # Find which raw column holds "Category"
            cat_idx = next(
                (i for i, c in enumerate(col_names) if c.lower() == "category"), None
            )
            if cat_idx is not None:
                categories = conn.execute(f"""
                    SELECT r{cat_idx} AS cat, COUNT(*) AS cnt
                    FROM   entries
                    WHERE  r{cat_idx} IS NOT NULL AND r{cat_idx} != ''
                    GROUP  BY cat ORDER BY cnt DESC LIMIT 20
                """).fetchall()
    finally:
        conn.close()

    total = f.entry_count if f.entry_count is not None else (stats[0] or 0)
    return RegistrySummary(
        total_entries    = total,
        hive_type        = f.hive_type,
        oldest_timestamp = stats[1],
        newest_timestamp = stats[2],
        top_hive_types   = [{"hive_type": r[0], "count": r[1]} for r in hive_types],
        top_value_types  = [{"value_type": r[0], "count": r[1]} for r in val_types],
        top_categories   = [{"category": r[0],   "count": r[1]} for r in categories],
    )


@router.get("/{case_id}/files/{file_id}/entries", response_model=RegistryEntriesPage)
def list_entries(
    case_id:    str,
    file_id:    str,
    page:       int           = Query(1,   ge=1),
    page_size:  int           = Query(200, ge=1, le=1000),
    search:     str           = Query(""),
    hive_type:  str           = Query(""),
    value_type: str           = Query(""),
    deleted:    Optional[str] = Query(None),
    time_from:  Optional[str] = Query(None),
    time_to:    Optional[str] = Query(None),
    sort_dir:   str           = Query("asc"),
    db:         Session       = Depends(get_db),
):
    """Paginated + filtered registry entries from DuckDB."""
    f        = _get_file_or_404(file_id, case_id, db)
    ddb_path = _require_duckdb(f)

    col_names: list[str] = []
    if f.columns_json:
        try:
            col_names = json.loads(f.columns_json)
        except Exception:
            pass

    n_raw       = len(col_names)
    entry_cols  = _build_entry_cols(n_raw)
    search_term = search.strip()
    ht_filt     = hive_type.strip()
    vt_filt     = value_type.strip()
    sd          = "DESC" if sort_dir == "desc" else "ASC"

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
        # Search key_path + value_name + value_data + all raw columns
        searchable = ["COALESCE(key_path, '')", "COALESCE(value_name, '')",
                      "COALESCE(value_data, '')"]
        if n_raw > 0:
            searchable += [f"COALESCE(r{i}, '')" for i in range(n_raw)]
        concat = " || ' ' || ".join(searchable)
        conditions.append(f"LOWER({concat}) LIKE LOWER(?)")
        params.append(f"%{search_term}%")

    if ht_filt:
        conditions.append("hive_type ILIKE ?")
        params.append(f"%{ht_filt}%")

    if vt_filt:
        conditions.append("value_type ILIKE ?")
        params.append(f"%{vt_filt}%")

    if deleted is not None:
        conditions.append("deleted ILIKE ?")
        params.append(f"%{deleted}%")

    if dt_from:
        conditions.append("timestamp >= ?")
        params.append(dt_from)
    if dt_to:
        conditions.append("timestamp <= ?")
        params.append(dt_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    order = f"ORDER BY timestamp {sd} NULLS LAST, row_num {sd}"

    conn = duckdb.connect(database=ddb_path, read_only=True)
    try:
        has_filters = bool(search_term or ht_filt or vt_filt or deleted or dt_from or dt_to)
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

    return RegistryEntriesPage(
        total=total, page=page, page_size=page_size, pages=pages,
        items=[_row_to_entry(r, col_names) for r in rows],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=RegistryFileOut)
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

    background_tasks.add_task(
        _import_csv_background, file_id, f.file_path, ddb_dest, f.hive_type,
    )
    db.refresh(f)
    return f


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=RegistryFileOut)
def add_evidence(
    case_id:      str,
    file_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    f    = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    if f.added_to_evidence:
        raise HTTPException(409, "Already added to evidence")

    file_path = Path(f.file_path)
    size = 0
    md5_hash = sha256_hash = ""
    try:
        size = file_path.stat().st_size
        md5 = hashlib.md5(); sha256 = hashlib.sha256()
        with file_path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk); sha256.update(chunk)
        md5_hash    = md5.hexdigest()
        sha256_hash = sha256.hexdigest()
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    ev  = Evidence(
        case_id=case_id, name=f.filename,
        description=f"Registry export ({f.hive_type}) — {f.entry_count or '?'} entries",
        file_path=f.file_path, original_filename=f.filename,
        file_size=size, mime_type="text/csv",
        md5_hash=md5_hash, sha256_hash=sha256_hash,
        evidence_type=EvidenceType.artifact,
        acquisition_method=AcquisitionMethod.logical_copy,
        collected_by=current_user.username, collected_at=now,
        chain_of_custody=(
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
            f"via Registry CSV import ({f.hive_type}) — "
            f"MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
        ),
    )
    db.add(ev)
    f.added_to_evidence = True
    audit_log(db, user=current_user, action="registry.add_evidence",
              resource_type="registry_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f
