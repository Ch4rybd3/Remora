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

from typing import List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..core.deps import get_current_user
from ..models.ez_artifacts import ImportedCollection, ImportedFile
from ..services.ez_detection import detect

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
    files: List[UploadFile] = File(...),
    session_id: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Accepts:
      - A single ZIP file (KAPE / EZ Tools archive) — entries extracted automatically.
      - One or more CSV files — saved directly, no extraction needed.
    All uploads grouped into one ImportedCollection record.
    """
    if not files:
        raise HTTPException(400, "No files provided")

    # Validate extensions
    for f in files:
        ext = Path(f.filename).suffix.lower()
        if ext not in (".zip", ".csv"):
            raise HTTPException(400, f"Unsupported file type '{f.filename}' — only .zip and .csv are accepted")

    # Mixed uploads not allowed — either one ZIP or N CSVs
    exts = {Path(f.filename).suffix.lower() for f in files}
    if ".zip" in exts and ".csv" in exts:
        raise HTTPException(400, "Cannot mix ZIP and CSV files in the same upload")
    if ".zip" in exts and len(files) > 1:
        raise HTTPException(400, "Only one ZIP file per upload")

    collection_id = str(uuid.uuid4())
    dest_dir = _collection_dir(case_id, collection_id)
    extracted_dir = dest_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    expires = datetime.utcnow() + timedelta(days=90)
    imported_files: list[ImportedFile] = []
    total_size = 0

    # ── Case A: single ZIP ────────────────────────────────────────────────────
    if ".zip" in exts:
        upload = files[0]
        content = await upload.read()
        total_size = len(content)
        zip_path = dest_dir / "upload.zip"
        zip_path.write_bytes(content)

        try:
            with zipfile.ZipFile(zip_path) as zf:
                all_entries = [e for e in zf.namelist() if not e.endswith("/")]
        except zipfile.BadZipFile:
            raise HTTPException(400, "Invalid ZIP file")

        col_filename = upload.filename
        for entry_name in all_entries:
            result  = detect(entry_name)
            is_csv  = entry_name.lower().endswith(".csv")
            # Unknown CSVs are still valid artifacts — import them as-is.
            # Non-CSV files with no recognised category are left as unsupported.
            imported_files.append(ImportedFile(
                id=str(uuid.uuid4()),
                collection_id=collection_id,
                case_id=case_id,
                filename=entry_name,
                status="pending" if (result or is_csv) else "unsupported",
                category=result.category if result else None,
                category_label=result.category_label if result else None,
                destination_page=result.destination_page.replace("{case_id}", case_id) if result else None,
                destination_label=result.destination_label if result else None,
                expires_at=expires,
            ))

        ingest_mode = "zip"
        zip_path_for_bg = zip_path

    # ── Case B: one or more CSV files ─────────────────────────────────────────
    else:
        zip_path_for_bg = None
        seen_names: dict[str, int] = {}   # deduplicate basenames if needed

        for upload in files:
            content = await upload.read()
            total_size += len(content)

            # The filename sent from the frontend may be a relative path
            # (webkitRelativePath) like "KAPE/ProgramExecution/file.csv".
            # We detect using the full relative path (basename extraction in
            # detect()) but store the file using only the basename to avoid
            # path-traversal issues.
            rel_path = upload.filename   # e.g. "KAPE/ProgramExecution/file.csv"
            basename = Path(rel_path).name

            # Deduplicate identical basenames (rare but possible across folders)
            if basename in seen_names:
                seen_names[basename] += 1
                stem, suffix = basename.rsplit(".", 1) if "." in basename else (basename, "")
                safe_name = f"{stem}_{seen_names[basename]}.{suffix}" if suffix else f"{stem}_{seen_names[basename]}"
            else:
                seen_names[basename] = 0
                safe_name = basename

            # Save flat in extracted/
            csv_dest = extracted_dir / safe_name
            csv_dest.write_bytes(content)

            # Detect using the relative path (detect() takes the basename internally)
            result = detect(rel_path)
            print(f"[collection_import] detected {rel_path} → {result.category if result else 'unsupported'}", flush=True)

            # All CSVs are valid artifacts — unknown ones get category=None
            # and are registered in Artifact Explorer with an "Unknown" label.
            imported_files.append(ImportedFile(
                id=str(uuid.uuid4()),
                collection_id=collection_id,
                case_id=case_id,
                filename=safe_name,
                file_size=len(content),
                status="pending",       # always attempt ingest for CSV files
                category=result.category if result else None,
                category_label=result.category_label if result else None,
                destination_page=result.destination_page.replace("{case_id}", case_id) if result else None,
                destination_label=result.destination_label if result else None,
                expires_at=expires,
            ))

        col_filename = (
            files[0].filename if len(files) == 1
            else f"{len(files)} CSV files"
        )
        ingest_mode = "csv"

    # ── Persist ───────────────────────────────────────────────────────────────
    col = ImportedCollection(
        id=collection_id,
        case_id=case_id,
        session_id=session_id,
        filename=col_filename,
        file_size=total_size,
        uploaded_at=datetime.utcnow(),
        status="processing",
        total_files=len(imported_files),
        processed_files=0,
    )
    db.add(col)
    for f in imported_files:
        db.add(f)
    db.commit()

    # ── Background ingest ─────────────────────────────────────────────────────
    pending = [(f.id, f.filename, f.category) for f in imported_files if f.status == "pending"]

    if ingest_mode == "zip":
        background_tasks.add_task(
            _extract_and_ingest, zip_path_for_bg, dest_dir, collection_id, case_id, pending
        )
    else:
        # CSV files already in extracted/ — call ingest directly (no ZIP extraction)
        background_tasks.add_task(
            _ingest_pending, extracted_dir, collection_id, case_id, pending
        )

    return {
        "id": collection_id,
        "status": "processing",
        "total_files": len(imported_files),
        "files": [_file_dto(f) for f in imported_files],
    }


# ─── Background ingest ───────────────────────────────────────────────────────

def _run_pending(
    extracted_dir: Path,
    collection_id: str,
    case_id: str,
    pending: list[tuple[str, str, str]],
    db: Session,
) -> int:
    """
    Shared ingest loop — resolves each CSV from extracted_dir and ingests it.
    Returns the number of files processed.
    """
    from .csv_artifacts import register_csv_artifact

    processed = 0
    for file_id, filename, category in pending:
        # Try exact path first, then basename search (handles ZIP subdirs and flat CSVs)
        csv_path = extracted_dir / filename
        if not csv_path.exists():
            candidates = list(extracted_dir.rglob(Path(filename).name))
            csv_path = candidates[0] if candidates else None

        print(f"[collection_import] registering {filename} → category={category} path={csv_path}", flush=True)

        f = db.get(ImportedFile, file_id)
        if not f:
            continue

        try:
            if csv_path is None or not csv_path.exists():
                raise FileNotFoundError(f"CSV not found: {filename}")

            artifact = register_csv_artifact(csv_path, case_id, db)
            f.status = "imported"
            f.row_count = artifact.row_count if artifact else 0
            f.imported_at = datetime.utcnow()
        except Exception as e:
            print(f"[collection_import] ERROR registering {filename}: {e}", flush=True)
            f.status = "error"
            f.error_message = str(e)[:500]

        processed += 1
        col = db.get(ImportedCollection, collection_id)
        if col:
            col.processed_files = processed
        db.commit()

    return processed


def _extract_and_ingest(
    zip_path: Path,
    dest_dir: Path,
    collection_id: str,
    case_id: str,
    pending: list[tuple[str, str, str]],
):
    """Background task for ZIP uploads — extracts first, then ingests."""
    db: Session = SessionLocal()
    try:
        extracted_dir = dest_dir / "extracted"
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extracted_dir)

        processed = _run_pending(extracted_dir, collection_id, case_id, pending, db)

        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "done"
            col.processed_files = processed
        db.commit()
        print(f"[collection_import] ZIP collection {collection_id} done — {processed} files", flush=True)

    except Exception as e:
        print(f"[collection_import] FATAL {collection_id}: {e}", flush=True)
        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "error"
            col.error_message = str(e)[:500]
        db.commit()
    finally:
        db.close()


def _ingest_pending(
    extracted_dir: Path,
    collection_id: str,
    case_id: str,
    pending: list[tuple[str, str, str]],
):
    """Background task for direct CSV uploads — files already in extracted_dir."""
    db: Session = SessionLocal()
    try:
        processed = _run_pending(extracted_dir, collection_id, case_id, pending, db)

        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "done"
            col.processed_files = processed
        db.commit()
        print(f"[collection_import] CSV collection {collection_id} done — {processed} files", flush=True)

    except Exception as e:
        print(f"[collection_import] FATAL {collection_id}: {e}", flush=True)
        col = db.get(ImportedCollection, collection_id)
        if col:
            col.status = "error"
            col.error_message = str(e)[:500]
        db.commit()
    finally:
        db.close()


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
            "groups": _group_summary(files),   # ← needed for category cards in UI
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
        "session_id": col.session_id,
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
