from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.report_version import ReportVersion
from ..models.user import User
from ..services.report_service import ReportService, sections_for
from ..services.template_service import TemplateService

router = APIRouter(prefix="/cases/{case_id}/report", tags=["report"])

MAX_VERSIONS = 5


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReportVersionMeta(BaseModel):
    id:         int
    version:    int
    line_count: int
    created_by: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReportVersionFull(ReportVersionMeta):
    content: str


class SaveReportPayload(BaseModel):
    #: {slug: markdown} - one entry per section the case template declares.
    sections_data: dict


class SectionMeta(BaseModel):
    slug:     str
    name:     str
    category: str
    required: bool


class GenerateResponse(BaseModel):
    #: The sections themselves, in template order, so the Report tab can lay
    #: out its editors without fetching the template separately.
    sections:      list[SectionMeta]
    sections_data: dict


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/generate", response_model=GenerateResponse)
def generate_report(
    case_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    The starting draft: every section the case template declares, filled with
    its own guidance.

    Generating never overwrites: the Report tab merges this into what is
    already written, so an analyst who regenerates after the template changed
    gains the new sections and keeps their text.
    """
    case = _get_case_or_404(case_id, db)
    template = None
    if case.template_id:
        template = TemplateService().get_template(case.template_id)
    result = ReportService().generate_analysis(case, template)
    return result


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
    Save the report and snapshot it.

    `case.report` is derived here rather than edited: it is every section in
    template order, which is what `{{report_content}}` injects and what a
    version stores. Deriving it on save is what keeps the combined view from
    drifting away from the sections it claims to combine.

    Keeps only the last MAX_VERSIONS versions.
    """
    case = _get_case_or_404(case_id, db)

    import json as _json

    case.report_sections_data = _json.dumps(payload.sections_data, ensure_ascii=False)

    # Template order, not dictionary order: the sections are laid out in the
    # order the case template declares them, and the combined report has to
    # read the same way the Report tab does.
    template = TemplateService().get_template(case.template_id) if case.template_id else None
    ordered  = [s.slug for s in sections_for(template)]
    extra    = [k for k in payload.sections_data if k not in ordered]

    parts = [
        str(payload.sections_data[slug]).strip()
        for slug in ordered + extra
        if str(payload.sections_data.get(slug) or "").strip()
    ]
    case.report = "\n\n---\n\n".join(parts)

    snapshot_content = case.report

    # Next version number
    max_ver = (
        db.query(ReportVersion)
        .filter(ReportVersion.case_id == case_id)
        .order_by(ReportVersion.version.desc())
        .first()
    )
    next_version = (max_ver.version + 1) if max_ver else 1

    version = ReportVersion(
        case_id    = case_id,
        version    = next_version,
        content    = snapshot_content,
        line_count = len(snapshot_content.splitlines()),
        created_by = current_user.username,
        created_at = datetime.now(UTC),
    )
    db.add(version)
    db.flush()

    # Prune old versions
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
