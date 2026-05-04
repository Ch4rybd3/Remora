import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone

from ..database import get_db
from ..models.case import Case, CaseStatus
from ..models.user import User
from ..schemas.case import CaseCreate, CaseRead, CaseUpdate, CaseSummary
from ..services.template_service import TemplateService
from ..services.audit_service import audit_log
from ..core.deps import get_current_user
from ..config import settings

NOTE_IMAGES_DIR = settings.evidence_store_path.parent / "note_images"

router = APIRouter(prefix="/cases", tags=["cases"])


@router.get("/", response_model=List[CaseSummary])
def list_cases(db: Session = Depends(get_db)):
    cases = db.query(Case).order_by(Case.updated_at.desc()).all()
    result = []
    for case in cases:
        result.append(CaseSummary(
            id=case.id,
            title=case.title,
            status=case.status,
            severity=case.severity,
            tags=case.tags,
            assigned_to=case.assigned_to,
            tlp=case.tlp,
            created_at=case.created_at,
            updated_at=case.updated_at,
            ioc_count=len(case.iocs),
            asset_count=len(case.assets),
            evidence_count=len(case.evidences),
            timeline_count=len(case.timeline),
        ))
    return result


@router.post("/", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump()
    template_ttps: list[dict] = []

    if data.get("template_id"):
        tpl = TemplateService().get_template(data["template_id"])
        if tpl:
            if not data.get("executive_summary") and tpl.get("executive_summary_template"):
                data["executive_summary"] = tpl["executive_summary_template"]
            # Collect TTP definitions from the template (if any)
            template_ttps = tpl.get("ttp_definitions", [])

    case = Case(**data)
    db.add(case)
    db.flush()   # populate case.id before auditing

    # Seed TTPs from template
    if template_ttps:
        from ..models.mitre import CaseTTP
        for ttp_def in template_ttps:
            tid = ttp_def.get("technique_id", "").strip()
            if not tid:
                continue
            ttp = CaseTTP(
                id             = str(uuid.uuid4()),
                case_id        = case.id,
                technique_id   = tid,
                technique_name = ttp_def.get("technique_name"),
                tactic         = ttp_def.get("tactic", ""),
                tactic_name    = ttp_def.get("tactic_name"),
            )
            db.add(ttp)

    audit_log(db, user=current_user, action="case.create",
              resource_type="case", resource_id=case.id,
              resource_name=case.title, case_id=case.id, case_title=case.title)
    db.commit()
    db.refresh(case)
    return case


@router.get("/{case_id}", response_model=CaseRead)
def get_case(case_id: str, db: Session = Depends(get_db)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.patch("/{case_id}", response_model=CaseRead)
def update_case(
    case_id: str,
    payload: CaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(case, key, value)
    if "status" in updates and updates["status"] == CaseStatus.closed:
        case.closed_at = datetime.now(timezone.utc)
    case.updated_at = datetime.now(timezone.utc)
    audit_log(db, user=current_user, action="case.update",
              resource_type="case", resource_id=case_id,
              resource_name=case.title, case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    audit_log(db, user=current_user, action="case.delete",
              resource_type="case", resource_id=case_id,
              resource_name=case.title, case_id=case_id, case_title=case.title)
    db.delete(case)
    db.commit()


# ── Note images ───────────────────────────────────────────────────────────────

@router.post("/{case_id}/notes/images")
async def upload_note_image(case_id: str, file: UploadFile = File(...)):
    dest_dir = NOTE_IMAGES_DIR / case_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "image.png").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = dest_dir / filename
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    # Servi via StaticFiles monté sur /note-images (sans auth)
    return {"url": f"/note-images/{case_id}/{filename}"}
