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
from ..services.report_service import ReportService
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
    content:              str = ""       # legacy combined field (kept for backward compat)
    analysis:             str | None = None
    remediation:          str | None = None
    conclusion:           str | None = None
    sections_data:        dict | None = None   # {slug: markdown_text} for dynamic sections


class GenerateResponse(BaseModel):
    analysis:      str
    remediation:   str
    conclusion:    str
    sections_data: dict = {}   # {slug: markdown_text} when template has dynamic sections


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
    Generate the analyst-facing sections from the case template's report_sections.
    Returns { analysis, remediation, conclusion, sections_data }.
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
    Save the 3 report sections on the case AND create a new version snapshot.
    Also keeps case.report in sync (combined) for backward compat with {{report_content}}.
    Keeps only the last MAX_VERSIONS versions.
    """
    case = _get_case_or_404(case_id, db)

    import json as _json

    # Persist individual sections
    if payload.analysis    is not None: case.report_analysis    = payload.analysis
    if payload.remediation is not None: case.report_remediation = payload.remediation
    if payload.conclusion  is not None: case.report_conclusion  = payload.conclusion

    # Persist dynamic per-section data
    if payload.sections_data is not None:
        case.report_sections_data = _json.dumps(payload.sections_data, ensure_ascii=False)

    # Keep combined `report` in sync for {{report_content}} backward compat
    parts = []
    # Include dynamic sections if present
    try:
        sd = _json.loads(case.report_sections_data or '{}')
    except Exception:
        sd = {}
    if sd:
        for v in sd.values():
            if v and str(v).strip():
                parts.append(str(v).strip())
    else:
        for field in (case.report_analysis, case.report_remediation, case.report_conclusion):
            if field and field.strip():
                parts.append(field.strip())
    case.report = "\n\n---\n\n".join(parts) if parts else (payload.content or "")

    # Snapshot content = combined markdown
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
