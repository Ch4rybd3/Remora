"""
Event log registry — /api/v1/evtx

What this is **not**, any more: a second reader. The module used to parse every
EVTX a second time with the `evtx` Python package, store the records in
`evtx_events`, and offer its own browser over them - while EvtxECmd had already
parsed the same file into the Artifact Explorer during ingestion. Two parses of
one file, two tables that could disagree, and two interfaces for reading the
same records.

What is left is the registry: which event logs a case holds, where their bytes
are, and the chain-of-custody promotion. That is what Chainsaw scans - a Sigma
run reads the EVTX itself, not a database of it - and what the process tree
needs to exist before its own source, the Explorer's tables, is built.

Reading an event is the Artifact Explorer's job now. Detections are Chainsaw's.
Lineage is the process tree's, asked from a row.

Auth is handled at the router-include level in main.py (**_auth).
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.evidence import AcquisitionMethod, Evidence, EvidenceType
from ..models.evtx import EvtxFile
from ..models.user import User
from ..schemas.evtx import (
    EvtxFileOut,
)
from ..services.audit_service import audit_log

router = APIRouter(prefix="/evtx", tags=["evtx"])

# ── Storage ───────────────────────────────────────────────────────────────────

EVTX_DIR = settings.evidence_store_path.parent / "evtx"

LEVEL_MAP: dict[int, str] = {
    0: "Information",
    1: "Critical",
    2: "Error",
    3: "Warning",
    4: "Information",
    5: "Verbose",
}

# ── DB helpers ────────────────────────────────────────────────────────────────

def _case_dir(case_id: str) -> Path:
    d = EVTX_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> EvtxFile:
    f = db.query(EvtxFile).filter(
        EvtxFile.id == file_id, EvtxFile.case_id == case_id
    ).first()
    if not f:
        raise HTTPException(404, "EVTX file not found")
    return f


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=EvtxFileOut)
async def upload_evtx(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session   = Depends(get_db),
    current_user:     User      = Depends(get_current_user),
):
    case = _get_case_or_404(case_id, db)

    if not file.filename or not file.filename.lower().endswith(".evtx"):
        raise HTTPException(400, "Only .evtx files are accepted")

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = f"{file_id}_{Path(file.filename).name}"
    dest_path = dest_dir / safe_name

    contents = await file.read()
    dest_path.write_bytes(contents)

    db_file = EvtxFile(
        id        = file_id,
        case_id   = case_id,
        filename  = file.filename,
        file_path = str(dest_path),
        # Ready the moment the bytes are on disk. There is no parse to wait
        # for any more, and Chainsaw reads the EVTX itself - `pending` here
        # would refuse every scan forever.
        status    = "ready",
    )
    db.add(db_file)
    audit_log(db, user=current_user, action="evtx.upload",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=file.filename, case_id=case_id,
              case_title=getattr(case, "title", None),
              details={"filename": file.filename, "size": len(contents)})
    db.commit()
    db.refresh(db_file)

    return db_file


@router.get("/{case_id}/files", response_model=list[EvtxFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(EvtxFile)
        .filter(EvtxFile.case_id == case_id)
        .order_by(EvtxFile.uploaded_at.desc())
        .all()
    )


@router.delete("/{case_id}/files/{file_id}", status_code=204)
def delete_file(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    audit_log(db, user=current_user, action="evtx.delete",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    try:
        Path(f.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(f)
    db.commit()


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=EvtxFileOut)
def add_to_evidence(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)

    if f.added_to_evidence:
        raise HTTPException(400, "Already added to evidence")

    file_path = Path(f.file_path)
    try:
        size = file_path.stat().st_size
    except Exception:
        size = 0

    # Compute integrity hashes
    md5_hash = sha256_hash = ""
    try:
        md5    = hashlib.md5()
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk)
                sha256.update(chunk)
        md5_hash    = md5.hexdigest()
        sha256_hash = sha256.hexdigest()
    except Exception:
        pass

    now = datetime.now(UTC)
    chain_entry = (
        f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
        f"via EVTX import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
    )

    ev = Evidence(
        case_id            = case_id,
        name               = f.filename,
        description        = f"Windows Event Log — {f.event_count or '?'} events",
        file_path          = f.file_path,
        original_filename  = f.filename,
        file_size          = size,
        mime_type          = "application/octet-stream",
        md5_hash           = md5_hash,
        sha256_hash        = sha256_hash,
        evidence_type      = EvidenceType.log,
        acquisition_method = AcquisitionMethod.logical_copy,
        collected_by       = current_user.username,
        collected_at       = now,
        chain_of_custody   = chain_entry,
    )
    db.add(ev)

    f.added_to_evidence = True
    audit_log(db, user=current_user, action="evtx.add_evidence",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f


# ── Public helper for collection import ──────────────────────────────────────

def register_evtx_file(
    source_path:       Path,
    case_id:           str,
    original_filename: str,
    db:                Session,
) -> EvtxFile:
    """
    Register an existing .evtx file - from a collection import, typically.

    Records it and copies it into the case's own directory. No parsing: the
    Explorer's table is built for the whole collection at once by the batch
    stage, and a second parse here is what this module stopped doing.
    """
    import shutil as _shutil

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = f"{file_id}_{Path(original_filename).name}"
    dest_path = dest_dir / safe_name

    _shutil.copy2(str(source_path), str(dest_path))

    db_file = EvtxFile(
        id        = file_id,
        case_id   = case_id,
        filename  = original_filename,
        file_path = str(dest_path),
        status    = "ready",
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    print(f"[evtx] registered {original_filename} → {file_id}", flush=True)
    return db_file
