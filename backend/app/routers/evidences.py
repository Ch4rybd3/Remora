import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models.case import Case
from ..models.evidence import Evidence, EvidenceType, AcquisitionMethod
from ..models.user import User
from ..schemas.evidence import EvidenceRead, EvidenceUpdate
from ..services.audit_service import audit_log
from ..core.deps import get_current_user
from ..config import settings

router = APIRouter(prefix="/cases/{case_id}/evidences", tags=["evidences"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _compute_hashes(file_path: Path) -> tuple[str, str]:
    md5 = hashlib.md5()
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


@router.get("/", response_model=List[EvidenceRead])
def list_evidences(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(Evidence).filter(Evidence.case_id == case_id).all()


@router.post("/", response_model=EvidenceRead, status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    case_id: str,
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    evidence_type: str = Form("other"),
    source_location: str = Form(""),
    acquisition_method: str = Form("manual"),
    collected_by: str = Form(""),
    collected_at: Optional[str] = Form(None),
    tags: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)

    case_dir = settings.evidence_store_path / case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    evidence_id = __import__("uuid").uuid4().hex
    dest = case_dir / f"{evidence_id}_{file.filename}"

    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    md5, sha256 = _compute_hashes(dest)
    file_size = dest.stat().st_size
    rel_path = str(dest.relative_to(settings.evidence_store_path))

    parsed_collected_at = None
    if collected_at:
        try:
            parsed_collected_at = datetime.fromisoformat(collected_at)
        except ValueError:
            pass

    # Build initial chain-of-custody entry
    now = datetime.now(timezone.utc)
    effective_collected_by = collected_by or current_user.username
    method_label = AcquisitionMethod(acquisition_method).value.replace("_", " ")
    initial_coc = (
        f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] "
        f"Collected by {effective_collected_by} via {method_label} — "
        f"MD5: {md5} | SHA256: {sha256}"
    )

    evidence = Evidence(
        case_id=case_id,
        name=name,
        description=description,
        evidence_type=EvidenceType(evidence_type),
        source_location=source_location,
        acquisition_method=AcquisitionMethod(acquisition_method),
        file_path=rel_path,
        original_filename=file.filename or "",
        file_size=file_size,
        mime_type=file.content_type or "",
        md5_hash=md5,
        sha256_hash=sha256,
        collected_by=effective_collected_by,
        collected_at=parsed_collected_at,
        tags=tags,
        chain_of_custody=initial_coc,
    )
    db.add(evidence)
    db.flush()
    audit_log(db, user=current_user, action="evidence.upload",
              resource_type="evidence", resource_id=evidence.id,
              resource_name=name, case_id=case_id, case_title=case.title,
              details={"filename": file.filename, "size": file_size})
    db.commit()
    db.refresh(evidence)
    return evidence


@router.get("/{evidence_id}/download")
def download_evidence(case_id: str, evidence_id: str, db: Session = Depends(get_db)):
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id, Evidence.case_id == case_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    if not evidence.file_path:
        raise HTTPException(status_code=404, detail="No file attached to this evidence")
    file_path = settings.evidence_store_path / evidence.file_path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path=file_path, filename=evidence.original_filename or evidence.name,
                        media_type=evidence.mime_type or "application/octet-stream")


_FIELD_LABELS: dict[str, str] = {
    "name":               "Name",
    "description":        "Description",
    "evidence_type":      "Type",
    "source_location":    "Source Location",
    "acquisition_method": "Acquisition Method",
    "collected_at":       "Collected At",
    "collected_by":       "Collected By",
    "tags":               "Tags",
}

_TYPE_LABELS: dict[str, str] = {
    "malware":          "Malware Sample",
    "artifact":         "System Artifact",
    "log":              "Log File",
    "memory_dump":      "Memory Dump",
    "disk_image":       "Disk Image",
    "network_capture":  "Network Capture",
    "document":         "Document",
    "report":           "Report",
    "other":            "Other",
}

_METHOD_LABELS: dict[str, str] = {
    "manual":            "Manual Collection",
    "forensic_copy":     "Forensic Copy",
    "live_acquisition":  "Live Acquisition",
    "logical_copy":      "Logical Copy",
    "remote_collection": "Remote Collection",
    "other":             "Other",
}


def _fmt_field(key: str, value) -> str:
    """Return a human-readable representation of a field value."""
    if value is None:
        return "—"
    raw = value.value if hasattr(value, "value") else str(value)
    if key == "evidence_type":
        return _TYPE_LABELS.get(raw, raw)
    if key == "acquisition_method":
        return _METHOD_LABELS.get(raw, raw)
    if key == "collected_at" and hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d %H:%M")
    if key == "description" and len(raw) > 60:
        return raw[:57] + "…"
    return raw or "—"


@router.patch("/{evidence_id}", response_model=EvidenceRead)
def update_evidence(
    case_id: str,
    evidence_id: str,
    payload: EvidenceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id, Evidence.case_id == case_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    case = _get_case(case_id, db)

    note = payload.note.strip()
    if not note:
        raise HTTPException(status_code=422, detail="A change note is required.")

    # Diff: compare old vs new values, only log fields that actually changed
    updates = payload.model_dump(exclude_unset=True, exclude={"note"})
    diffs: list[str] = []
    for key, new_value in updates.items():
        old_value = getattr(evidence, key, None)
        old_str = _fmt_field(key, old_value)
        new_str = _fmt_field(key, new_value)
        if old_str != new_str:
            label = _FIELD_LABELS.get(key, key)
            diffs.append(f"{label}: {old_str} → {new_str}")
        setattr(evidence, key, new_value)

    # Append custody history entry
    now = datetime.now(timezone.utc)
    fields_str = f" [{', '.join(diffs)}]" if diffs else ""
    coc_entry = (
        f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] "
        f"Modified by {current_user.username}{fields_str} — Comment: {note}"
    )
    evidence.chain_of_custody = (
        (evidence.chain_of_custody + "\n" if evidence.chain_of_custody else "") + coc_entry
    )

    audit_log(db, user=current_user, action="evidence.update",
              resource_type="evidence", resource_id=evidence_id,
              resource_name=evidence.name, case_id=case_id, case_title=case.title,
              details={"changes": diffs, "note": note})
    db.commit()
    db.refresh(evidence)
    return evidence


@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence(
    case_id: str,
    evidence_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id, Evidence.case_id == case_id).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")
    case = _get_case(case_id, db)
    audit_log(db, user=current_user, action="evidence.delete",
              resource_type="evidence", resource_id=evidence_id,
              resource_name=evidence.name, case_id=case_id, case_title=case.title)
    if evidence.file_path:
        file_path = settings.evidence_store_path / evidence.file_path
        if file_path.exists():
            file_path.unlink()
    db.delete(evidence)
    db.commit()
