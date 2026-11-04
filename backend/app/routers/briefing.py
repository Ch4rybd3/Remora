"""
Executive briefing and report language — /api/v1/cases/{id}/briefing
(docs/CHARYBDIS_FEATURES.md, F3 and F4).

The briefing is what an executive account reads about a case: figures counted
from the case, and a short status in plain language that an analyst wrote or
accepted from the reporter agent. `briefing` is not an artifact segment, so
the executive role reaches it like the report.
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.asset import Asset
from ..models.case import Case
from ..models.ioc import IOC
from ..models.user import User
from ..schemas.agent import UTCDateTime
from ..services.audit_service import audit_log

router = APIRouter(tags=["briefing"])

#: Languages a report may be written in, by ISO 639-1 code.
REPORT_LANGUAGES: dict[str, str] = {
    "en": "English", "fr": "French", "de": "German", "es": "Spanish", "it": "Italian",
    "nl": "Dutch", "pt": "Portuguese",
}


def language_name(code: str | None) -> str:
    return REPORT_LANGUAGES.get(code or "en", "English")


class Kpi(BaseModel):
    key:   str
    label: str
    value: str


class BriefingRead(BaseModel):
    title:           str
    phase:           str
    status:          str
    severity:        str
    report_language: str
    kpis:            list[Kpi]
    #: The plain-language status. Empty until written or accepted.
    briefing:        str
    briefing_at:     UTCDateTime | None
    briefing_by:     str


class BriefingWrite(BaseModel):
    briefing: str = Field(..., max_length=6000)


class LanguageWrite(BaseModel):
    language: str


def _get_case(case_id: str, db: Session) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _kpis(db: Session, case: Case) -> list[Kpi]:
    from ..models.agent import (
        COLLECTION_REQUESTED,
        FINDING_VALIDATED,
        TASK_OPEN,
        AgentCollectionRequest,
        AgentFinding,
        AgentTask,
    )

    opened = case.created_at.replace(tzinfo=UTC) if case.created_at and case.created_at.tzinfo is None \
        else case.created_at
    days = (datetime.now(UTC) - opened).days if opened else 0
    validated = (db.query(AgentFinding)
                 .filter(AgentFinding.case_id == case.id, AgentFinding.state == FINDING_VALIDATED).all())
    critical = sum(1 for f in validated if f.severity in ("critical", "high"))
    assets = db.query(Asset).filter(Asset.case_id == case.id)
    rows = [
        ("days_open", "Days open", str(days)),
        ("findings", "Established findings", str(len(validated))),
        ("serious", "Of which high or critical", str(critical)),
        ("compromised", "Compromised assets", str(assets.filter(Asset.compromised.is_(True)).count())),
        ("assets", "Assets involved", str(assets.count())),
        ("iocs", "Indicators to block", str(db.query(IOC).filter(IOC.case_id == case.id).count())),
        ("work", "Investigation tasks in progress",
         str(db.query(AgentTask).filter(AgentTask.case_id == case.id, AgentTask.status.in_(TASK_OPEN)).count())),
        ("collection", "Evidence still awaited",
         str(db.query(AgentCollectionRequest).filter(AgentCollectionRequest.case_id == case.id,
                                                     AgentCollectionRequest.state == COLLECTION_REQUESTED).count())),
    ]
    return [Kpi(key=k, label=label, value=v) for k, label, v in rows]


def briefing_read(db: Session, case: Case) -> BriefingRead:
    from ..services.charybdis.phases import phase
    return BriefingRead(
        title=str(case.title), phase=phase(getattr(case, "phase", None)).name,
        status=str(getattr(case.status, "value", case.status)),
        severity=str(getattr(case.severity, "value", case.severity)),
        report_language=str(case.report_language or "en"), kpis=_kpis(db, case),
        briefing=str(case.briefing or ""), briefing_at=case.briefing_at,  # type: ignore[arg-type]
        briefing_by=str(case.briefing_by or ""))


@router.get("/cases/{case_id}/briefing", response_model=BriefingRead)
def get_briefing(case_id: str, db: Session = Depends(get_db)):
    """Figures and the plain-language status of a case. Readable by the executive role."""
    return briefing_read(db, _get_case(case_id, db))


@router.put("/cases/{case_id}/briefing", response_model=BriefingRead)
def update_briefing(
    case_id: str,
    payload: BriefingWrite,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    case.briefing = payload.briefing.strip()  # type: ignore[assignment]
    case.briefing_at = datetime.now(UTC).replace(tzinfo=None)  # type: ignore[assignment]
    case.briefing_by = str(current_user.username or "")  # type: ignore[assignment]
    audit_log(db, user=current_user, action="case.briefing_update", request=request,
              resource_type="case", resource_id=case_id, resource_name=str(case.title),
              case_id=case_id, case_title=str(case.title), details={"characters": len(case.briefing or "")})
    db.commit()
    return briefing_read(db, case)


@router.get("/report-languages")
def list_report_languages() -> dict[str, str]:
    return REPORT_LANGUAGES


@router.put("/cases/{case_id}/report-language", response_model=BriefingRead)
def set_report_language(
    case_id: str,
    payload: LanguageWrite,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The language agents draft the report and the briefing in. The interface stays in English."""
    if payload.language not in REPORT_LANGUAGES:
        raise HTTPException(status_code=422, detail=f"language must be one of {', '.join(REPORT_LANGUAGES)}")
    case = _get_case(case_id, db)
    previous = case.report_language
    case.report_language = payload.language  # type: ignore[assignment]
    audit_log(db, user=current_user, action="case.report_language", request=request,
              resource_type="case", resource_id=case_id, resource_name=str(case.title),
              case_id=case_id, case_title=str(case.title), details={"from": previous, "to": payload.language})
    db.commit()
    return briefing_read(db, case)
