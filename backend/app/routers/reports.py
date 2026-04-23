from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.case import Case
from ..services.report_service import ReportService
from ..services.template_service import TemplateService

router = APIRouter(prefix="/cases/{case_id}/report", tags=["report"])


@router.get("/generate", response_class=PlainTextResponse)
def generate_report(case_id: str, db: Session = Depends(get_db)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    template = None
    if case.template_id:
        template = TemplateService().get_template(case.template_id)
    md = ReportService().generate(case, template)
    return md
