"""
CSV Artifact Explorer — generic CSV viewer for EZ Tools / KAPE output.

Performance: DuckDB reads CSV files directly via its optimised columnar scanner.
Filters, sorts and pagination are pushed down to SQL — no full in-memory load.
Benchmarks on a 500 k-row CSV: ~300 ms with filters vs ~8 s for the Python fallback.
"""
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.csv_artifact import CsvArtifactFile
from ..models.user import User

# Aliased: `Query` at module scope is FastAPI's, used in every endpoint
# signature below.
from ..services.store import Query as StoreQuery
from ..services.store import drop_cache, get_store

router = APIRouter(tags=["csv-artifacts"])


# ── Storage ───────────────────────────────────────────────────────────────────

def _artifacts_dir(case_id: str) -> Path:
    p = settings.evidence_store_path.parent / "csv_artifacts" / case_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def _get_case_or_404(case_id: str, db: Session) -> Case:
    c = db.query(Case).filter(Case.id == case_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    return c


def _get_artifact_or_404(artifact_id: str, case_id: str, db: Session) -> CsvArtifactFile:
    a = db.query(CsvArtifactFile).filter(
        CsvArtifactFile.id == artifact_id,
        CsvArtifactFile.case_id == case_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="CSV artifact not found")
    return a


# ── Date-column auto-detection ────────────────────────────────────────────────

_DATE_HINTS = [
    "datetime", "timestamp",
    "timecreated", "lastmodified", "lastwritten", "lastaccesstime",
    "sourcecreated", "targetcreated", "sourcemtime",
    "datetimeutc", "filesystemlastmodified", "filesystemlastaccessed",
    "filesystemcreated", "accessdate", "modifieddate", "createddate",
    "deletedon", "lastinteracted", "firstinteracted",
    "modified", "accessed", "created",
    "ts", "date", "time",
]


def _detect_date_column(columns: list[str]) -> str | None:
    for col in columns:
        clean = col.lower().replace(" ", "").replace("_", "").replace("-", "").replace("/", "")
        for hint in _DATE_HINTS:
            if clean == hint or clean.startswith(hint):
                return col
    return None


# ── Multi-format converter ────────────────────────────────────────────────────

def _convert_to_flat_csv(raw: bytes, filename: str) -> bytes:
    """
    Convert .txt/.log (line-per-row) or .json (array-of-objects / JSONL) to CSV.
    Returns UTF-8 encoded CSV bytes.
    """
    import csv as _csv
    import io
    import json as _json

    ext = Path(filename).suffix.lower()

    if ext in ('.txt', '.log'):
        text  = raw.decode('utf-8', errors='replace')
        lines = [ln for ln in text.splitlines() if ln.strip()]
        buf   = io.StringIO()
        w     = _csv.writer(buf)
        w.writerow(['line_number', 'line'])
        for i, ln in enumerate(lines, 1):
            w.writerow([str(i), ln])
        return buf.getvalue().encode('utf-8')

    if ext == '.json':
        text = raw.decode('utf-8', errors='replace')
        try:
            data = _json.loads(text)
        except _json.JSONDecodeError:
            # Try JSONL (newline-delimited JSON)
            data = []
            for ln in text.splitlines():
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    data.append(_json.loads(ln))
                except Exception:
                    data.append({'raw': ln})

        if isinstance(data, list) and data:
            if isinstance(data[0], dict):
                all_keys: list[str] = list(dict.fromkeys(k for obj in data if isinstance(obj, dict) for k in obj))
                buf = io.StringIO()
                w2  = _csv.DictWriter(buf, fieldnames=all_keys, extrasaction='ignore')
                w2.writeheader()
                for obj in data:
                    if isinstance(obj, dict):
                        w2.writerow({k: str(obj.get(k, '')) for k in all_keys})
                    else:
                        w2.writerow(dict.fromkeys(all_keys, ''))
                return buf.getvalue().encode('utf-8')
            else:
                buf = io.StringIO()
                w3  = _csv.writer(buf)
                w3.writerow(['value'])
                for item in data:
                    w3.writerow([str(item)])
                return buf.getvalue().encode('utf-8')

        elif isinstance(data, dict):
            buf = io.StringIO()
            w4  = _csv.writer(buf)
            w4.writerow(['key', 'value'])
            for k, v in data.items():
                w4.writerow([str(k), str(v)])
            return buf.getvalue().encode('utf-8')

        return b'value\n'

    return raw


# ── Artifact queries ─────────────────────────────────────────────────────────
# Every question about an artifact's contents goes through `ArtifactStore`.
# This file used to hold four DuckDB functions, each opening its own connection
# and re-parsing the whole CSV to answer one page of one query. See
# `services/store/` for what replaced them and why.


@router.get("/cases/{case_id}/artifacts")
def list_artifacts(case_id: str, db: Session = Depends(get_db)) -> list[dict]:
    _get_case_or_404(case_id, db)
    rows = (
        db.query(CsvArtifactFile)
        .filter(CsvArtifactFile.case_id == case_id)
        .order_by(CsvArtifactFile.uploaded_at.desc())
        .all()
    )
    return [_artifact_dto(r) for r in rows]


def _artifact_dto(r: CsvArtifactFile) -> dict:
    return {
        "id":               r.id,
        "original_name":    r.original_name,
        "columns":          json.loads(r.columns),
        "row_count":        r.row_count,
        "date_column":      r.date_column,
        "ez_label":         r.ez_label,
        "ez_category":      r.ez_category,
        "source_timezone":  r.source_timezone,
        "uploaded_at":      r.uploaded_at.isoformat(),
        "evidence_id":      r.evidence_id,
    }


# NOTE: static path segment "search" takes priority over /{artifact_id} in FastAPI.
@router.get("/cases/{case_id}/artifacts/search")
def omni_search(
    case_id: str,
    q:       str  = Query(..., min_length=2),
    limit:   int  = Query(15, ge=1, le=100),
    regex:   bool = Query(False, description="Use regex matching instead of ILIKE"),
    db:      Session = Depends(get_db),
) -> dict:
    """Full-text search across ALL CSV artifacts in a case (omnisearch via DuckDB)."""
    _get_case_or_404(case_id, db)
    artifacts = (
        db.query(CsvArtifactFile)
        .filter(CsvArtifactFile.case_id == case_id)
        .all()
    )
    results   = []
    total_hits = 0

    for a in artifacts:
        cols = json.loads(a.columns)
        hit_count, hits = get_store().find(
            a.file_path, cols, q, limit=limit, regex=regex)
        if hit_count > 0:
            total_hits += hit_count
            results.append({
                "id":            a.id,
                "original_name": a.original_name,
                "ez_label":      a.ez_label,
                "ez_category":   a.ez_category,
                "columns":       cols,
                "date_column":   a.date_column,
                "hit_count":     hit_count,
                "rows":          hits,
            })

    return {"query": q, "total_hits": total_hits, "files": results}


@router.post("/cases/{case_id}/artifacts/upload", status_code=status.HTTP_201_CREATED)
async def upload_artifact(
    case_id:      str,
    file:         UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
) -> dict:
    _get_case_or_404(case_id, db)

    artifact_id = str(uuid.uuid4())
    dest_dir    = _artifacts_dir(case_id)
    safe_name   = Path(file.filename or "upload.csv").name
    ext         = Path(safe_name).suffix.lower()

    SUPPORTED = {'.csv', '.json', '.txt', '.log'}
    if ext not in SUPPORTED:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Accepted formats: {', '.join(sorted(SUPPORTED))}",
        )

    raw = await file.read()

    # Non-CSV files are normalized to CSV so DuckDB can read them uniformly
    if ext != '.csv':
        raw       = _convert_to_flat_csv(raw, safe_name)
        safe_name = Path(safe_name).stem + '.csv'

    file_path = str(dest_dir / f"{artifact_id}_{safe_name}")
    with open(file_path, "wb") as fh:
        fh.write(raw)

    schema = get_store().schema(file_path)
    cols, row_count = schema.columns, schema.row_count
    date_col        = _detect_date_column(cols)

    ez_label    = None
    ez_category = None
    try:
        from ..services.ez_detection import detect
        result = detect(safe_name)
        if result:
            ez_label    = result.category_label
            ez_category = result.category
    except Exception:
        pass

    rec = CsvArtifactFile(
        id=artifact_id,
        case_id=case_id,
        original_name=safe_name,
        file_path=file_path,
        columns=json.dumps(cols),
        row_count=row_count,
        date_column=date_col,
        ez_label=ez_label,
        ez_category=ez_category,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    return _artifact_dto(rec)


@router.get("/cases/{case_id}/artifacts/{artifact_id}/rows")
def get_rows(
    case_id:     str,
    artifact_id: str,
    page:        int           = Query(1, ge=1),
    page_size:   int           = Query(100, ge=1, le=5000),
    sort_col:    str | None = Query(None),
    sort_dir:    str           = Query("asc"),
    q:           str | None = Query(None),
    col_filters: str | None = Query(None),
    rql:         str | None = Query(None, description="RQL query string"),
    db:          Session       = Depends(get_db),
) -> dict:
    from ..services.rql_parser import RQLSyntaxError

    a    = _get_artifact_or_404(artifact_id, case_id, db)
    cols = json.loads(a.columns)

    parsed_cf = None
    if col_filters:
        try:
            parsed_cf = json.loads(col_filters)
        except Exception:
            pass

    try:
        result = get_store().search(
            a.file_path, cols,
            StoreQuery(text=q, column_filters=parsed_cf, rql=rql),
            sort_col=sort_col or a.date_column, sort_dir=sort_dir,
            page=page, page_size=page_size,
        )
        total, pages, rows = result.total, result.pages, result.rows
    except RQLSyntaxError as exc:
        raise HTTPException(status_code=422, detail={"rql_error": str(exc)})

    return {
        "total":     total,
        "pages":     pages,
        "page":      page,
        "page_size": page_size,
        "columns":   cols,
        "items":     rows,
    }


@router.get("/cases/{case_id}/artifacts/{artifact_id}/groups")
def get_groups(
    case_id:     str,
    artifact_id: str,
    group_by:    str           = Query(..., description="Comma-separated column names"),
    q:           str | None = Query(None),
    col_filters: str | None = Query(None),
    rql:         str | None = Query(None, description="RQL query string"),
    db:          Session       = Depends(get_db),
) -> dict:
    """
    Return GROUP BY aggregation via DuckDB — no row limit.
    group_by: comma-separated list of column names to group by (in order).
    """
    from ..services.rql_parser import RQLSyntaxError

    a    = _get_artifact_or_404(artifact_id, case_id, db)
    cols = json.loads(a.columns)

    group_cols = [c.strip() for c in group_by.split(",") if c.strip()]

    parsed_cf = None
    if col_filters:
        try:
            parsed_cf = json.loads(col_filters)
        except Exception:
            pass

    try:
        groups = [
            {"values": g.values, "count": g.count}
            for g in get_store().aggregate(
                a.file_path, cols, StoreQuery(text=q, column_filters=parsed_cf, rql=rql),
                group_cols)
        ]
    except RQLSyntaxError as exc:
        raise HTTPException(status_code=422, detail={"rql_error": str(exc)})

    print(f"[groups] {artifact_id} group_by={group_cols} → {len(groups)} groups", flush=True)
    return {
        "groups":       groups,
        "total_groups": len(groups),
        "group_by":     group_cols,
    }


@router.post("/cases/{case_id}/artifacts/{artifact_id}/add-evidence", status_code=status.HTTP_201_CREATED)
def add_evidence_for_artifact(
    case_id:      str,
    artifact_id:  str,
    body:         dict | None = None,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
) -> dict:
    """
    Preserve this artifact as evidence. Idempotent.

    Delegates to `services/custody.py` rather than building the record here.
    This endpoint used to create an Evidence row without copying the file, so
    the "preserved" artifact lived on inside a collection that expires after 90
    days - the record outlived the thing it documented. Promotion now copies
    the bytes into the evidence store, identically to every other page, which
    is the entire reason the service exists.

    Body is optional: `{"as_ioc": true}` wraps the copy in a
    password-protected archive.
    """
    from ..models.evidence import Evidence
    from ..services.custody import PromotionError, promote

    a = _get_artifact_or_404(artifact_id, case_id, db)

    if a.evidence_id:
        ev = db.query(Evidence).filter(Evidence.id == a.evidence_id).first()
        if ev:
            return _evidence_dto(ev)

    case = db.query(Case).filter(Case.id == case_id).first()
    try:
        ev = promote(
            db,
            case_id=case_id,
            case_title=str(case.title) if case else "",
            kind="artifact",
            source_id=artifact_id,
            username=str(current_user.username),
            as_ioc=bool((body or {}).get("as_ioc")),
        )
    except PromotionError as e:
        raise HTTPException(status_code=409, detail=str(e)) from None

    return _evidence_dto(ev)


@router.post("/cases/{case_id}/artifacts/{artifact_id}/coc-note", status_code=status.HTTP_204_NO_CONTENT)
def append_coc_note(
    case_id:      str,
    artifact_id:  str,
    body:         dict,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Append a Chain of Custody note to the evidence linked to this artifact."""
    from ..models.evidence import Evidence

    a = _get_artifact_or_404(artifact_id, case_id, db)
    if not a.evidence_id:
        raise HTTPException(status_code=404, detail="No evidence item linked to this artifact")

    ev = db.query(Evidence).filter(Evidence.id == a.evidence_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Evidence item not found")

    note    = str(body.get("note", "")).strip()
    now_str = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    entry   = f"[{now_str}] {current_user.username}: {note}\n"

    ev.chain_of_custody = (ev.chain_of_custody or "") + entry
    db.commit()


def _evidence_dto(ev) -> dict:
    return {
        "id":               ev.id,
        "name":             ev.name,
        "evidence_type":    ev.evidence_type,
        "sha256_hash":      ev.sha256_hash,
        "collected_by":     ev.collected_by,
        "collected_at":     ev.collected_at.isoformat() if ev.collected_at else None,
    }


@router.patch("/cases/{case_id}/artifacts/{artifact_id}")
def patch_artifact(
    case_id:      str,
    artifact_id:  str,
    body:         dict,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
) -> dict:
    """Update mutable fields on a CsvArtifactFile (currently: source_timezone)."""
    a = _get_artifact_or_404(artifact_id, case_id, db)
    if "source_timezone" in body:
        a.source_timezone = body["source_timezone"] or None
    db.commit()
    db.refresh(a)
    return _artifact_dto(a)


@router.delete("/cases/{case_id}/artifacts/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_artifact(
    case_id:      str,
    artifact_id:  str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    a = _get_artifact_or_404(artifact_id, case_id, db)
    # Drop the Parquet conversion too. It is derived data, but leaving it would
    # accumulate silently and, worse, could be served to a later artifact that
    # happened to be written to the same path.
    drop_cache(Path(str(a.file_path)))
    try:
        os.unlink(a.file_path)
    except OSError:
        pass
    db.delete(a)
    db.commit()


@router.get("/cases/{case_id}/artifacts/{artifact_id}/raw")
def get_raw(
    case_id:     str,
    artifact_id: str,
    db:          Session = Depends(get_db),
):
    """Return the raw file content for non-CSV artifacts (TXT, LOG, JSON).
    Returns { content: str, encoding: 'text' | 'json' }.
    """
    a = _get_artifact_or_404(artifact_id, case_id, db)
    try:
        raw = Path(a.file_path).read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail=f"File not found on disk: {exc}")

    text = raw.decode('utf-8', errors='replace')
    ext  = Path(a.original_name).suffix.lower()
    enc  = 'json' if ext == '.json' else 'text'
    return {"content": text, "encoding": enc}


# ── Public helper used by collection_import ───────────────────────────────────

def register_csv_artifact(
    file_path: Path,
    case_id:   str,
    db:        Session,
) -> CsvArtifactFile | None:
    """
    Register an existing CSV file (e.g. from a collection import) in the
    Artifact Explorer without copying it.  Idempotent — skips if already registered.
    """
    path_str = str(file_path)

    existing = db.query(CsvArtifactFile).filter(
        CsvArtifactFile.file_path == path_str
    ).first()
    if existing:
        return existing

    schema = get_store().schema(path_str)
    cols, row_count = schema.columns, schema.row_count
    date_col        = _detect_date_column(cols)

    ez_label    = None
    ez_category = None
    try:
        from ..services.ez_detection import detect
        result = detect(file_path.name)
        if result:
            ez_label    = result.category_label
            ez_category = result.category
    except Exception:
        pass

    rec = CsvArtifactFile(
        case_id=case_id,
        original_name=file_path.name,
        file_path=path_str,
        columns=json.dumps(cols),
        row_count=row_count,
        date_column=date_col,
        ez_label=ez_label,
        ez_category=ez_category,
    )
    db.add(rec)
    # Caller commits
    return rec
