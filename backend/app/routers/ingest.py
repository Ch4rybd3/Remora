"""
Ingestion router — /api/v1/cases/{case_id}/ingest

Two things live here:

- **The upload courier.** The Collection tab's drop area. It writes bytes into
  the case drop folder and returns; it does not parse, hash, or decide where
  anything belongs. Removing it would change nothing about how a file is
  processed - only who is able to put one there. See `docs/INGESTION.md`
  section 2.
- **The ingest queue.** What the pipeline has seen for this case, in what
  state, and the two actions the recoverable states call for: force a type on
  something unidentified, and retry something that failed.
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.ingest import (
    ALL_STATES,
    ORIGIN_UPLOAD,
    RECOVERABLE_STATES,
    STATE_DISCOVERED,
    IngestedFile,
)
from ..services import dropzone as dz
from ..services.ingest import case_summary, force_kind, route_for
from ..services.ingest.dropfolder import UploadTooLarge, stage_upload
from ..services.ingest.routing import KNOWN_KINDS

router = APIRouter(tags=["ingest"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _dto(row: IngestedFile, case_id: str) -> dict:
    route = route_for(row.detected_kind or "unknown")
    return {
        "id":               row.id,
        "original_name":    row.original_name,
        "size_bytes":       row.size_bytes,
        "origin":           row.origin,
        "origin_detail":    row.origin_detail,
        "sha256":           row.sha256,
        "magic_type":       row.magic_type,
        "detected_kind":    row.detected_kind,
        "detection_source": row.detection_source,
        "source_timezone":  row.source_timezone,
        "state":            row.state,
        "error":            row.error,
        "routed_to":        row.routed_to,
        "parent_id":        row.parent_id,
        "collection_id":    row.collection_id,
        "recoverable":      row.state in RECOVERABLE_STATES,
        "destination_pages": [p.replace("{case_id}", case_id) for p in route.pages],
        "created_at":       row.created_at.isoformat() if row.created_at else None,
    }


# ─── The upload courier ───────────────────────────────────────────────────────

@router.post("/cases/{case_id}/ingest/uploads", status_code=202)
async def upload_into_drop_folder(
    case_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Put files into the case drop folder. Nothing else.

    Returns `202`: the bytes have been accepted, and the pipeline will pick
    them up exactly as it picks up anything copied in over SSH. There is no
    result to report synchronously because no decision has been taken yet -
    that is the entire point of the two doors converging before anything is
    inspected.

    Uploads land in `.incoming/` and are moved into place only once the body
    has been fully read, so a stalled request can never be mistaken for a
    finished file by the watcher.
    """
    if not files:
        raise HTTPException(400, "No files provided")

    case = _get_case(case_id, db)
    max_bytes = settings.max_upload_size_mb * 1024 * 1024

    accepted: list[str] = []
    for upload in files:
        name = (upload.filename or "").strip()
        if not name:
            raise HTTPException(400, "A file was uploaded without a name")
        try:
            landed = await stage_upload(case, name, upload, max_bytes)
        except UploadTooLarge:
            raise HTTPException(
                413,
                f"'{name}' exceeds the {settings.max_upload_size_mb} MB upload ceiling. "
                "Copy it into the case drop folder directly instead - see the "
                "Collection tab for the path.",
            ) from None
        accepted.append(landed.name)

    # No extension check, deliberately. The pipeline identifies by content, and
    # refusing a name here would mean guessing from the very thing that has
    # been shown to be unreliable. Anything unrecognised becomes a listed
    # `unidentified` row an analyst can act on.
    background_tasks.add_task(_scan_case, case_id)

    return {
        "accepted": accepted,
        "detail": "Files placed in the case drop folder. Ingestion runs in the background.",
    }


def _scan_case(case_id: str) -> None:
    """
    Nudge the watcher rather than ingesting here.

    Uploading and ingesting stay separate: this task simply asks for a sweep,
    which then treats the file identically to one that arrived by scp. If the
    sweep is not due yet the poller will find it anyway - nothing depends on
    this call succeeding.

    With `DROPZONE_AUTO_INGEST=false` the sweep is a no-op and the file waits
    for an explicit scan. That is the setting doing what it says: an operator
    who turned automatic ingestion off did so to decide when parsing runs, and
    an upload arriving through the browser is not a reason to overrule them.
    The file is in the folder and listed either way.
    """
    from .dropzone import poll_once

    try:
        poll_once()
    except Exception as e:
        print(f"[ingest] post-upload scan failed for case {case_id}: {e}", flush=True)


# ─── The ingest queue ─────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/ingest")
def list_ingested(
    case_id: str,
    state: str | None = Query(None, description="Filter to one pipeline state"),
    limit: int = Query(500, le=2000),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Everything the pipeline has seen for this case, newest first."""
    _get_case(case_id, db)

    if state and state not in ALL_STATES:
        raise HTTPException(400, f"Unknown state '{state}'")

    query = db.query(IngestedFile).filter(IngestedFile.case_id == case_id)
    if state:
        query = query.filter(IngestedFile.state == state)

    rows = query.order_by(IngestedFile.created_at.desc()).limit(limit).all()
    return {
        "files":   [_dto(r, case_id) for r in rows],
        "summary": case_summary(db, case_id),
    }


@router.get("/cases/{case_id}/ingest/summary")
def ingest_summary(
    case_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Counts per state - what the Collection tab header shows."""
    _get_case(case_id, db)
    return {"summary": case_summary(db, case_id), "states": sorted(ALL_STATES)}


@router.get("/ingest/kinds")
def list_kinds(current_user=Depends(get_current_user)):
    """
    Types an analyst may force, with where each would be sent.

    Offered so the override is a choice from what the router actually knows,
    rather than a free-text field that can name a kind nothing handles.
    """
    kinds = []
    for kind in sorted(KNOWN_KINDS):
        route = route_for(kind)
        kinds.append({
            "kind":        kind,
            "destination": route.primary,
            "parser":      route.parser,
            "available":   not route.pending,
        })
    return {"kinds": kinds}


@router.post("/cases/{case_id}/ingest/{file_id}/force-kind")
def force_file_kind(
    case_id: str,
    file_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Override the detected type.

    The recovery path for `unidentified`: the analyst knows the file is a
    registry hive even though it carries no signature. `forced` outranks every
    other detection source and is never recomputed, so a later re-scan will not
    quietly undo the correction.
    """
    kind = (body or {}).get("kind")
    if not kind:
        raise HTTPException(400, "kind is required")
    if kind not in KNOWN_KINDS:
        raise HTTPException(400, f"Unknown kind '{kind}'")

    row = (
        db.query(IngestedFile)
        .filter(IngestedFile.id == file_id, IngestedFile.case_id == case_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Ingested file not found")

    force_kind(db, row, kind)
    return _dto(row, case_id)


@router.post("/cases/{case_id}/ingest/{file_id}/retry")
def retry_file(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Send a failed file back to the start of the pipeline.

    Only `failed` and `unidentified` may be retried. Replaying a file that
    already reached the Explorer would produce a second copy of every row in
    it, which is worse than the problem retry solves.
    """
    row = (
        db.query(IngestedFile)
        .filter(IngestedFile.id == file_id, IngestedFile.case_id == case_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Ingested file not found")
    if row.state not in RECOVERABLE_STATES:
        raise HTTPException(
            409,
            f"A file in state '{row.state}' cannot be retried. Only "
            f"{', '.join(sorted(RECOVERABLE_STATES))} can.",
        )

    row.state = STATE_DISCOVERED
    row.error = None
    db.commit()
    return _dto(row, case_id)


# ─── Where to put files by hand ───────────────────────────────────────────────

@router.get("/cases/{case_id}/ingest/drop-path")
def drop_path(
    case_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    The case folder path, for the analyst copying files in directly.

    The container-side path is meaningless to someone sitting at their own
    machine, so the host path is returned alongside it when configured - it is
    what makes a copy-pasteable scp command possible.
    """
    case = _get_case(case_id, db)
    folder = dz.case_dropzone_dir(case)
    return {
        "container_path": str(folder),
        "folder_name":    folder.name,
        "origin_upload":  ORIGIN_UPLOAD,
    }
