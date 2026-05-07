from __future__ import annotations

from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.case import Case
from ..models.report_version import ReportVersion
from ..models.user import User
from ..services.report_service import ReportService
from ..services.template_service import TemplateService
from ..core.deps import get_current_user

router = APIRouter(prefix="/cases/{case_id}/report", tags=["report"])

MAX_VERSIONS = 5


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReportVersionMeta(BaseModel):
    id:         int
    version:    int
    line_count: int
    created_by: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportVersionFull(ReportVersionMeta):
    content: str


class SaveReportPayload(BaseModel):
    content: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/generate", response_class=PlainTextResponse)
def generate_report(
    case_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Generate the analyst-facing analysis skeleton only (Technical Analysis,
    Remediations, Recommendations).  Annexe data (IOC table, MITRE matrix,
    timeline …) are rendered by the Report Template via {{ }} tags.
    """
    case = _get_case_or_404(case_id, db)
    template = None
    if case.template_id:
        template = TemplateService().get_template(case.template_id)
    return ReportService().generate_analysis(case, template)


@router.get("/versions", response_model=list[ReportVersionMeta])
def list_versions(case_id: str, db: Session = Depends(get_db)):
    """Return the (up to 5) most recent report versions, newest first."""
    _get_case_or_404(case_id, db)
    return (
        db.query(ReportVersion)
        .filter(ReportVersion.case_id == case_id)
        .order_by(ReportVersion.version.desc())
        .limit(MAX_VERSIONS)
        .all()
    )


@router.get("/versions/{version_id}", response_model=ReportVersionFull)
def get_version(case_id: str, version_id: int, db: Session = Depends(get_db)):
    """Return a specific version including its full content (for restore)."""
    _get_case_or_404(case_id, db)
    v = db.query(ReportVersion).filter(
        ReportVersion.id == version_id,
        ReportVersion.case_id == case_id,
    ).first()
    if not v:
        raise HTTPException(404, "Version not found")
    return v


@router.post("/save", response_model=ReportVersionMeta)
def save_report(
    case_id:      str,
    payload:      SaveReportPayload,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Save the report content on the case AND create a new version snapshot.
    Keeps only the last MAX_VERSIONS versions (older ones are deleted).
    """
    case = _get_case_or_404(case_id, db)

    # Persist content on the case itself
    case.report = payload.content

    # Next version number = current max + 1
    max_ver = (
        db.query(ReportVersion)
        .filter(ReportVersion.case_id == case_id)
        .order_by(ReportVersion.version.desc())
        .first()
    )
    next_version = (max_ver.version + 1) if max_ver else 1

    line_count = len(payload.content.splitlines())

    version = ReportVersion(
        case_id    = case_id,
        version    = next_version,
        content    = payload.content,
        line_count = line_count,
        created_by = current_user.username,
        created_at = datetime.now(timezone.utc),
    )
    db.add(version)
    db.flush()   # get version.id

    # Prune old versions — keep only the latest MAX_VERSIONS
    old_versions = (
        db.query(ReportVersion)
        .filter(ReportVersion.case_id == case_id)
        .order_by(ReportVersion.version.desc())
        .offset(MAX_VERSIONS)
        .all()
    )
    for old in old_versions:
        db.delete(old)

    db.commit()
    db.refresh(version)
    return version
