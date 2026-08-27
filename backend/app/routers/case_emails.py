import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.email_file import EmailFile
from ..models.user import User
from .email_analysis import parse_email_bytes

router = APIRouter(tags=["case-emails"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/cases/{case_id}/emails")
def list_case_emails(case_id: str, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    _get_case(case_id, db)
    rows = (
        db.query(EmailFile)
        .filter(EmailFile.case_id == case_id)
        .order_by(EmailFile.uploaded_at.desc())
        .all()
    )
    result = []
    for e in rows:
        a = json.loads(e.analysis)
        result.append({
            "id":            e.id,
            "filename":      e.filename,
            "subject":       a.get("subject", ""),
            "from_addr":     a.get("from_addr", ""),
            "warning_count": e.warning_count,
            "uploaded_at":   e.uploaded_at.isoformat(),
        })
    return result


@router.post("/cases/{case_id}/emails/upload", status_code=status.HTTP_201_CREATED)
async def upload_case_email(
    case_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _get_case(case_id, db)
    raw = await file.read()
    result = parse_email_bytes(raw)
    result_dict = result.model_dump()

    ef = EmailFile(
        case_id=case_id,
        filename=file.filename or "email.eml",
        analysis=json.dumps(result_dict),
        warning_count=len(result_dict.get("warnings", [])),
    )
    db.add(ef)
    db.commit()
    db.refresh(ef)

    return {
        "id":            ef.id,
        "filename":      ef.filename,
        "subject":       result_dict.get("subject", ""),
        "from_addr":     result_dict.get("from_addr", ""),
        "warning_count": ef.warning_count,
        "uploaded_at":   ef.uploaded_at.isoformat(),
        "analysis":      result_dict,
    }


@router.get("/cases/{case_id}/emails/{email_id}")
def get_case_email(
    case_id: str, email_id: str, db: Session = Depends(get_db)
) -> dict[str, Any]:
    ef = db.query(EmailFile).filter(
        EmailFile.id == email_id, EmailFile.case_id == case_id
    ).first()
    if not ef:
        raise HTTPException(status_code=404, detail="Email not found")
    return {
        "id":          ef.id,
        "filename":    ef.filename,
        "uploaded_at": ef.uploaded_at.isoformat(),
        "analysis":    json.loads(ef.analysis),
    }


@router.delete("/cases/{case_id}/emails/{email_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case_email(
    case_id: str,
    email_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ef = db.query(EmailFile).filter(
        EmailFile.id == email_id, EmailFile.case_id == case_id
    ).first()
    if not ef:
        raise HTTPException(status_code=404, detail="Email not found")
    db.delete(ef)
    db.commit()


# ── Public helper used by collection_import ───────────────────────────────────

def register_email_file(
    file_path: Path,
    case_id:   str,
    filename:  str,
    db:        Session,
) -> EmailFile:
    """Register an EML file from a collection import into Email Analysis."""
    raw = Path(str(file_path)).read_bytes()
    result = parse_email_bytes(raw)
    result_dict = result.model_dump()
    ef = EmailFile(
        case_id=case_id,
        filename=filename,
        analysis=json.dumps(result_dict),
        warning_count=len(result_dict.get("warnings", [])),
    )
    db.add(ef)
    return ef
