import hashlib
import shutil
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

    from datetime import datetime as _dt
    parsed_collected_at = None
    if collected_at:
        try:
            parsed_collected_at = _dt.fromisoformat(collected_at)
        except ValueError:
            pass

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
        collected_by=collected_by,
        collected_at=parsed_collected_at,
        tags=tags,
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
    file_path = settings.evidence_store_path / evidence.file_path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(path=file_path, filename=evidence.original_filename,
                        media_type=evidence.mime_type or "application/octet-stream")


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
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(evidence, key, value)
    audit_log(db, user=current_user, action="evidence.update",
              resource_type="evidence", resource_id=evidence_id,
              resource_name=evidence.name, case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
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
