"""
Collection Import router — /api/v1/cases/{case_id}/collection-imports

Handles ZIP upload (KAPE triage output, EZ Tools parsed output, etc.),
file detection, background ingest, and status reporting.
"""
from __future__ import annotations

import shutil
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..core.deps import get_current_user
from ..models.ez_artifacts import ImportedCollection, ImportedFile
from ..services.ez_detection import detect, CATEGORY_GROUPS
from ..services.ez_ingest import shimcache, amcache, user_activity, srum, registry_batch

router = APIRouter()

# Storage: data/cases/<case_id>/collections/<collection_id>/
def _collection_dir(case_id: str, collection_id: str) -> Path:
    base = Path("/app/data") if Path("/app/data").exists() else Path("data")
    p = base / "cases" / case_id / "collections" / collection_id
    p.mkdir(parents=True, exist_ok=True)
    return p


# ─── Upload & detect ─────────────────────────────────────────────────────────

@router.post("/cases/{case_id}/collection-imports")
async def upload_collection(
    case_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Only ZIP files are accepted")

    collection_id = str(uuid.uuid4())
    dest_dir = _collection_dir(case_id, collection_id)
    zip_path = dest_dir / "upload.zip"

    # Save the ZIP
    content = await file.read()
    zip_path.write_bytes(content)

    # Inspect ZIP to detect files
    try:
        with zipfile.ZipFile(zip_path) as zf:
            all_entries = [e for e in zf.namelist() if not e.endswith("/")]
    except zipfile.BadZipFile:
        raise HTTPException(400, "Invalid ZIP file")

    # Create DB record
    col = ImportedCollection(
        id=collection_id,
        case_id=case_id,
        filename=file.filename,
        file_size=len(content),
        uploaded_at=datetime.utcnow(),
        status="processing",
        total_files=len(all_entries),
        processed_files=0,
    )
    db.add(col)

    # Detect each file and create ImportedFile records
    imported_files: list[ImportedFile] = []
    expires = datetime.utcnow() + timedelta(days=90)

    for entry_name in all_entries:
        result = detect(entry_name)
        f = ImportedFile(
            id=str(uuid.uuid4()),
            collection_id=collection_id,
            case_id=case_id,
            filename=entry_name,
            status="pending" if result else "unsupported",
            category=result.category if result else None,
            category_label=result.category_label if result else None,
            destination_page=result.destination_page.replace("{case_id}", case_id) if result else None,
            destination_label=result.destination_label if result else None,
            expires_at=expires,
        )
        db.add(f)
        imported_files.append(f)

    db.commit()
    db.refresh(col)

    # Extract and ingest in background
    background_tasks.add_task(
        _extract_and_ingest, zip_path, dest_dir, collection_id, case_id,
        [(f.id, f.filename, f.category) for f in imported_files if f.status == "pending"]
    )

    return {
        "id": collection_id,
        "status": "processing",
        "total_files": len(all_entries),
        "files": [_file_dto(f) for f in imported_files],
    }


# ─── Background ingest ───────────────────────────────────────────────────────

def _extract_and_ingest(
    zip_path: Path,
    dest_dir: Path,
    collection_id: str,
    case_id: str,
    pending: list[tuple[str, str, str]],   # (file_id, filename, category)
):
    db: Session = SessionLocal()
    try:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(dest_dir / "extracted")

        processed = 0
        for file_id, filename, category in pending:
            csv_path = dest_dir / "extracted" / filename
            if not csv_path.exists():
                # Some ZIPs flatten structure — search by basename
                candidates = list((dest_dir / "extracted").rglob(Path(filename).name))
                csv_path = candidates[0] if candidates else None

            f = db.get(ImportedFile, file_id)
            if not f:
                continue

            try:
                count = _ingest_file(csv_path, case_id, file_id, category, db)
                f.status = "imported"
                f.row_count = count
                f.imported_at = datetime.utcnow()
            except Exception as e:
                print(f"[collection_import] ERROR ingesting {filename}: {e}", flush=True)
                f.status = "error"
                f.error_message = str(e)[:500]

            processed += 1
            col = db.get(ImportedCollection, collection_id)
            if col:
                col.processed_files = processed
            db.commit()

        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "done"
            col.processed_files = processed
        db.commit()
        print(f"[collection_import] collection {collection_id} done — {processed} files", flush=True)

    except Exception as e:
        print(f"[collection_import] FATAL {collection_id}: {e}", flush=True)
        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "error"
            col.error_message = str(e)[:500]
        db.commit()
    finally:
        db.close()


def _ingest_file(
    csv_path: Path | None,
    case_id: str,
    file_id: str,
    category: str,
    db: Session,
) -> int:
    if csv_path is None or not csv_path.exists():
        raise FileNotFoundError(f"CSV not found for file_id={file_id}")

    # Route to the right ingest service
    if category == "shimcache":
        return shimcache.ingest(csv_path, case_id, file_id, db)

    elif category == "amcache_unassociated":
        return amcache.ingest_file_entries(csv_path, case_id, file_id, "unassociated", db)

    elif category == "amcache_associated":
        return amcache.ingest_file_entries(csv_path, case_id, file_id, "associated", db)

    elif category == "amcache_programs":
        return amcache.ingest_program_entries(csv_path, case_id, file_id, db)

    elif category in ("amcache_devices", "amcache_pnp", "amcache_drivers", "amcache_shortcuts"):
        # Store raw for now — these are less commonly queried
        return 0

    elif category == "lnk_files":
        return user_activity.ingest_lnk(csv_path, case_id, file_id, db)

    elif category == "jump_lists_auto":
        return user_activity.ingest_jumplists(csv_path, case_id, file_id, "automatic", db)

    elif category == "jump_lists_custom":
        return user_activity.ingest_jumplists(csv_path, case_id, file_id, "custom", db)

    elif category == "shellbags":
        return user_activity.ingest_shellbags(csv_path, case_id, file_id, db)

    elif category == "recycle_bin":
        return user_activity.ingest_recycle_bin(csv_path, case_id, file_id, db)

    elif category in ("windows_timeline",):
        return user_activity.ingest_windows_timeline(csv_path, case_id, file_id, db)

    elif category == "windows_timeline_pkg":
        return 0   # PackageIDs companion — informational only

    elif category in ("srum_app_usage", "srum_timeline", "srum_energy"):
        return srum.ingest_app_usage(csv_path, case_id, file_id, db)

    elif category in ("srum_network", "srum_net_conn"):
        return srum.ingest_network_usage(csv_path, case_id, file_id, db)

    elif category == "registry_batch":
        return registry_batch.ingest(csv_path, case_id, file_id, db)

    elif category == "registry_plugin":
        return 0   # individual plugin CSVs — future work

    elif category in ("mft_ez",):
        # Delegate to existing MFT ingest (to be adapted)
        return 0

    elif category in ("usn_ez",):
        return 0

    elif category == "evtx_ez":
        return 0

    return 0


# ─── Read endpoints ───────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/collection-imports")
def list_collections(
    case_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    cols = (
        db.query(ImportedCollection)
        .filter(ImportedCollection.case_id == case_id)
        .order_by(ImportedCollection.uploaded_at.desc())
        .all()
    )
    result = []
    for col in cols:
        files = db.query(ImportedFile).filter(ImportedFile.collection_id == col.id).all()
        result.append({
            **_collection_dto(col),
            "files": [_file_dto(f) for f in files],
        })
    return result


@router.get("/cases/{case_id}/collection-imports/{collection_id}")
def get_collection(
    case_id: str,
    collection_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    col = db.query(ImportedCollection).filter(
        ImportedCollection.id == collection_id,
        ImportedCollection.case_id == case_id,
    ).first()
    if not col:
        raise HTTPException(404, "Collection not found")

    files = db.query(ImportedFile).filter(ImportedFile.collection_id == collection_id).all()
    return {
        **_collection_dto(col),
        "files": [_file_dto(f) for f in files],
        "groups": _group_summary(files),
    }


@router.delete("/cases/{case_id}/collection-imports/{collection_id}")
def delete_collection(
    case_id: str,
    collection_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    col = db.query(ImportedCollection).filter(
        ImportedCollection.id == collection_id,
        ImportedCollection.case_id == case_id,
    ).first()
    if not col:
        raise HTTPException(404, "Collection not found")

    # Remove extracted files from disk
    dest_dir = _collection_dir(case_id, collection_id)
    if dest_dir.exists():
        shutil.rmtree(dest_dir, ignore_errors=True)

    db.delete(col)
    db.commit()
    return {"ok": True}


@router.patch("/cases/{case_id}/collection-imports/files/{file_id}/evidence")
def mark_evidence(
    case_id: str,
    file_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark a file as added to chain of custody — removes its expiry."""
    f = db.get(ImportedFile, file_id)
    if not f or f.case_id != case_id:
        raise HTTPException(404)

    f.added_to_evidence = body.get("added", True)
    f.evidence_id = body.get("evidence_id")
    if f.added_to_evidence:
        f.expires_at = None   # keep indefinitely
    else:
        f.expires_at = datetime.utcnow() + timedelta(days=90)

    db.commit()
    return _file_dto(f)


# ─── DTOs ─────────────────────────────────────────────────────────────────────

def _collection_dto(col: ImportedCollection) -> dict:
    return {
        "id": col.id,
        "case_id": col.case_id,
        "filename": col.filename,
        "file_size": col.file_size,
        "uploaded_at": col.uploaded_at.isoformat() if col.uploaded_at else None,
        "status": col.status,
        "total_files": col.total_files,
        "processed_files": col.processed_files,
        "error_message": col.error_message,
    }


def _file_dto(f: ImportedFile) -> dict:
    return {
        "id": f.id,
        "filename": f.filename,
        "file_size": f.file_size,
        "category": f.category,
        "category_label": f.category_label,
        "destination_page": f.destination_page,
        "destination_label": f.destination_label,
        "status": f.status,
        "row_count": f.row_count,
        "error_message": f.error_message,
        "imported_at": f.imported_at.isoformat() if f.imported_at else None,
        "added_to_evidence": f.added_to_evidence,
        "expires_at": f.expires_at.isoformat() if f.expires_at else None,
    }


def _group_summary(files: list[ImportedFile]) -> list[dict]:
    """Group imported files by destination category for the UI summary."""
    groups: dict[str, dict] = {}
    for f in files:
        key = f.destination_label or "Unknown"
        if key not in groups:
            groups[key] = {
                "label": key,
                "destination_page": f.destination_page,
                "files": [],
                "imported": 0,
                "error": 0,
                "unsupported": 0,
                "total_rows": 0,
            }
        groups[key]["files"].append(f.filename)
        if f.status == "imported":
            groups[key]["imported"] += 1
            groups[key]["total_rows"] += (f.row_count or 0)
        elif f.status == "error":
            groups[key]["error"] += 1
        elif f.status == "unsupported":
            groups[key]["unsupported"] += 1

    return sorted(groups.values(), key=lambda g: g["label"])
