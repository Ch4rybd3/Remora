"""
Drop folder router — /api/v1/dropzone and /api/v1/cases/{case_id}/dropzone

Exposes what is currently sitting in the watched folder, lets the analyst
trigger a scan manually, and assigns orphan files from `_inbox/` to a case.
Actual ingestion is delegated to the Collection Import pipeline.
"""
from __future__ import annotations

import shutil
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import SessionLocal, get_db
from ..models.case import Case
from ..services import dropzone as dz

router = APIRouter(tags=["dropzone"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _file_dto(f: dz.DroppedFile, now: float) -> dict:
    return {
        "name":      f.name,
        "size":      f.size,
        "detected":  f.detected,
        "supported": f.supported,
        "stable":    dz.is_stable(f, now),
        "mtime":     f.mtime,
    }


# ─── Status ───────────────────────────────────────────────────────────────────

@router.get("/dropzone/status")
def dropzone_status(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """Global view: root path, settings, and what is waiting in the inbox."""
    now = time.time()
    inbox = dz.list_dropped(dz.inbox_dir())
    return {
        "root":             str(dz.dropzone_root()),
        "inbox_dir":        str(dz.inbox_dir()),
        "auto_ingest":      settings.dropzone_auto_ingest,
        "poll_seconds":     settings.dropzone_poll_seconds,
        "stable_seconds":   settings.dropzone_stable_seconds,
        "supported_exts":   sorted(dz.SUPPORTED_EXTS),
        "inbox":            [_file_dto(f, now) for f in inbox],
    }


@router.get("/cases/{case_id}/dropzone")
def case_dropzone(case_id: str, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """What is currently waiting in this case's drop folder."""
    case = _get_case(case_id, db)
    folder = dz.case_dropzone_dir(case)
    now = time.time()
    pending = dz.list_dropped(folder)
    processed_dir = folder / dz.PROCESSED_DIRNAME
    processed_count = (
        len([p for p in processed_dir.iterdir() if p.is_file()])
        if processed_dir.exists() else 0
    )
    return {
        "path":            str(folder),
        "folder_name":     folder.name,
        "auto_ingest":     settings.dropzone_auto_ingest,
        "stable_seconds":  settings.dropzone_stable_seconds,
        "pending":         [_file_dto(f, now) for f in pending],
        "processed_count": processed_count,
    }


# ─── Manual scan ──────────────────────────────────────────────────────────────

@router.post("/cases/{case_id}/dropzone/scan")
def scan_case_dropzone(
    case_id: str,
    background_tasks: BackgroundTasks,
    include_unstable: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Ingest everything currently waiting in this case's folder.

    `include_unstable=true` bypasses the quiescence delay — useful when the
    analyst knows the copy is finished and does not want to wait.
    """
    case = _get_case(case_id, db)
    folder = dz.case_dropzone_dir(case)
    now = time.time()

    candidates = [
        f for f in dz.list_dropped(folder)
        if f.supported and (include_unstable or dz.is_stable(f, now))
    ]
    skipped = [
        f.name for f in dz.list_dropped(folder)
        if not f.supported or not (include_unstable or dz.is_stable(f, now))
    ]

    if not candidates:
        return {"ingested": 0, "skipped": skipped, "collection_id": None}

    collection_id, rows = dz.ingest_files(case, [f.path for f in candidates], db)
    _schedule_ingest(background_tasks, case.id, collection_id, rows)

    return {"ingested": len(rows), "skipped": skipped, "collection_id": collection_id}


def _schedule_ingest(background_tasks: BackgroundTasks, case_id: str, collection_id: str, rows: list) -> None:
    """Hand the freshly registered files to the Collection Import background task."""
    from .collection_import import _collection_dir, _ingest_pending

    if not rows:
        return
    extracted_dir = _collection_dir(case_id, collection_id) / "extracted"
    pending = [(r.id, r.filename, r.category) for r in rows]
    background_tasks.add_task(_ingest_pending, extracted_dir, collection_id, case_id, pending)


# ─── Inbox ────────────────────────────────────────────────────────────────────

@router.post("/dropzone/inbox/assign")
def assign_inbox_files(
    body: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Move orphan files from `_inbox/` into a case folder and ingest them.

    Body: {"case_id": "...", "files": ["name.csv", ...]}  — empty `files`
    assigns everything currently in the inbox.
    """
    case_id = body.get("case_id")
    if not case_id:
        raise HTTPException(400, "case_id is required")
    case = _get_case(case_id, db)

    names = body.get("files") or []
    inbox = dz.inbox_dir()
    available = {f.name: f for f in dz.list_dropped(inbox) if f.supported}
    chosen = [available[n] for n in names if n in available] if names else list(available.values())

    if not chosen:
        raise HTTPException(400, "No usable file selected in the inbox")

    # Move into the case folder first, so ingest_files archives them to the
    # case's .processed/ like any other drop.
    case_dir = dz.case_dropzone_dir(case)
    moved: list[Path] = []
    for f in chosen:
        target = case_dir / f.name
        if target.exists():
            target = case_dir / f"{f.path.stem}_{int(time.time())}{f.path.suffix}"
        shutil.move(str(f.path), str(target))
        moved.append(target)

    collection_id, rows = dz.ingest_files(case, moved, db, source_label="inbox")
    _schedule_ingest(background_tasks, case.id, collection_id, rows)

    return {"ingested": len(rows), "collection_id": collection_id}


@router.delete("/dropzone/inbox/{filename}")
def delete_inbox_file(filename: str, current_user=Depends(get_current_user)):
    """Discard an orphan file without ingesting it."""
    target = (dz.inbox_dir() / filename).resolve()
    # Reject traversal: the resolved path must stay inside the inbox
    if not str(target).startswith(str(dz.inbox_dir().resolve())) or not target.is_file():
        raise HTTPException(404, "File not found")
    target.unlink()
    return {"ok": True}


# ─── Background poller ────────────────────────────────────────────────────────

def poll_once() -> int:
    """
    One sweep over every case folder, ingesting whatever has gone quiet.

    Runs in its own session — called from the startup polling thread, outside
    any request context.
    """
    if not settings.dropzone_auto_ingest:
        return 0

    from .collection_import import _collection_dir, _run_pending

    db: Session = SessionLocal()
    total = 0
    try:
        root = dz.dropzone_root()
        now = time.time()

        for folder in sorted(p for p in root.iterdir() if p.is_dir()):
            if folder.name == dz.INBOX_DIRNAME:
                continue
            case = dz.resolve_case_for_folder(folder.name, db)
            if not case:
                continue

            ready = [f for f in dz.list_dropped(folder) if f.supported and dz.is_stable(f, now)]
            if not ready:
                continue

            collection_id, rows = dz.ingest_files(case, [f.path for f in ready], db)
            if not rows:
                continue

            # Ingest inline — this thread is already off the request path
            extracted_dir = _collection_dir(case.id, collection_id) / "extracted"
            pending = [(r.id, r.filename, r.category) for r in rows]
            processed = _run_pending(extracted_dir, collection_id, case.id, pending, db)

            from ..models.ez_artifacts import ImportedCollection
            col = db.get(ImportedCollection, collection_id)
            if col:
                col.status = "done"
                col.processed_files = processed
            db.commit()
            total += processed
            print(f"[dropzone] auto-ingested {processed} file(s) for case {case.id}", flush=True)

    except Exception as e:
        print(f"[dropzone] poll error: {e}", flush=True)
    finally:
        db.close()

    return total


def ensure_all_case_folders() -> int:
    """Create a drop folder for every existing case (backfill at startup)."""
    db: Session = SessionLocal()
    created = 0
    try:
        dz.inbox_dir()
        for case in db.query(Case).all():
            existed = dz.case_dropzone_dir(case, create=False).exists()
            # Always run with create=True: besides creating missing folders it
            # re-applies the shared permissions on ones made earlier.
            dz.case_dropzone_dir(case, create=True)
            if not existed:
                created += 1
    except Exception as e:
        print(f"[dropzone] backfill error: {e}", flush=True)
    finally:
        db.close()
    if created:
        print(f"[dropzone] created {created} case folder(s)", flush=True)
    return created


def start_poller() -> None:
    """Start the drop folder watcher in a daemon thread."""
    ensure_all_case_folders()

    if not settings.dropzone_auto_ingest:
        print("[dropzone] auto-ingest disabled — manual scan only", flush=True)
        return

    import threading

    def _loop() -> None:
        # Let the app finish booting before the first sweep
        time.sleep(10)
        while True:
            poll_once()
            time.sleep(max(5, settings.dropzone_poll_seconds))

    threading.Thread(target=_loop, name="dropzone-poller", daemon=True).start()
    print(
        f"[dropzone] watching {dz.dropzone_root()} every "
        f"{settings.dropzone_poll_seconds}s (stable after {settings.dropzone_stable_seconds}s)",
        flush=True,
    )
