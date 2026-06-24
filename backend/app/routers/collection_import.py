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
    _FLAT_EXTS = {".csv", ".json", ".txt", ".log", ".evtx"}
    for f in files:
        ext = Path(f.filename).suffix.lower()
        if ext not in (".zip", *_FLAT_EXTS):
            raise HTTPException(400, f"Type non supporté '{f.filename}'. Acceptés: .zip, .csv, .json, .txt, .log, .evtx")

    # Mixed uploads not allowed — either one ZIP or flat files
    exts = {Path(f.filename).suffix.lower() for f in files}
    if ".zip" in exts and exts - {".zip"}:
        raise HTTPException(400, "Impossible de mélanger ZIP et autres fichiers dans le même upload")
    if ".zip" in exts and len(files) > 1:
        raise HTTPException(400, "Un seul fichier ZIP par upload")

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

    # ── Case B: one or more flat files (.csv / .json / .txt / .log / .evtx) ───
    else:
        zip_path_for_bg = None
        seen_names: dict[str, int] = {}   # deduplicate basenames if needed

        for upload in files:
            content = await upload.read()
            total_size += len(content)

            rel_path = upload.filename   # may be a relative path from webkitRelativePath
            basename = Path(rel_path).name
            file_ext = Path(basename).suffix.lower()

            # Deduplicate identical basenames
            if basename in seen_names:
                seen_names[basename] += 1
                stem, suffix = (basename.rsplit(".", 1) if "." in basename else (basename, ""))
                safe_name = f"{stem}_{seen_names[basename]}.{suffix}" if suffix else f"{stem}_{seen_names[basename]}"
            else:
                seen_names[basename] = 0
                safe_name = basename

            # Save flat in extracted/
            dest_file = extracted_dir / safe_name
            dest_file.write_bytes(content)

            # Detect using the relative path (detect() uses basename internally)
            result = detect(rel_path)
            print(f"[collection_import] detected {rel_path} ({file_ext}) → {result.category if result else 'auto-route'}", flush=True)

            # EVTX files route to the EVTX module; all others to Artifact Explorer
            if file_ext == ".evtx":
                dest_label = "EVTX Module"
                dest_page  = f"/cases/{case_id}/evtx"
            else:
                dest_label = result.destination_label if result else "Artifact Explorer"
                dest_page  = result.destination_page.replace("{case_id}", case_id) if result else None

            imported_files.append(ImportedFile(
                id=str(uuid.uuid4()),
                collection_id=collection_id,
                case_id=case_id,
                filename=safe_name,
                file_size=len(content),
                status="pending",
                category=result.category if result else ("evtx" if file_ext == ".evtx" else None),
                category_label=result.category_label if result else ("EVTX" if file_ext == ".evtx" else None),
                destination_page=dest_page,
                destination_label=dest_label,
                expires_at=expires,
            ))

        col_filename = (
            files[0].filename if len(files) == 1
            else f"{len(files)} fichiers"
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
    from .evtx import register_evtx_file

    processed = 0
    for file_id, filename, category in pending:
        # Try exact path first, then basename search (handles ZIP subdirs and flat files)
        file_path = extracted_dir / filename
        if not file_path.exists():
            candidates = list(extracted_dir.rglob(Path(filename).name))
            file_path = candidates[0] if candidates else None

        ext = Path(filename).suffix.lower()
        print(f"[collection_import] registering {filename} ({ext}) → category={category} path={file_path}", flush=True)

        f = db.get(ImportedFile, file_id)
        if not f:
            continue

        try:
            if file_path is None or not file_path.exists():
                raise FileNotFoundError(f"File not found: {filename}")

            if ext == ".evtx":
                # Route to EVTX module — parse runs asynchronously in daemon thread
                evtx_rec = register_evtx_file(file_path, case_id, filename, db)
                f.status    = "imported"
                f.row_count = 0        # events counted after async parse
                f.imported_at = datetime.utcnow()
            else:
                # All other supported types (.csv, .json, .txt, .log) go to Artifact Explorer
                artifact = register_csv_artifact(file_path, case_id, db)
                f.status    = "imported"
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
