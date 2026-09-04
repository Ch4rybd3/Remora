import io
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.incident_log import IncidentLogEntry
from ..models.timeline import TimelineEvent
from ..models.user import User
from ..schemas.incident_log import (
    IncidentLogEntryCreate,
    IncidentLogEntryRead,
    IncidentLogEntryUpdate,
)
from ..services.audit_service import audit_log

router = APIRouter(prefix="/cases/{case_id}/incident-log", tags=["incident-log"])

CATEGORY_LABELS = {
    "remediation": "Remediation",
    "handover": "Handover / Passation",
    "communication": "Client Communication",
    "investigation": "Investigation",
    "other": "Other",
}


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _get_entry(case_id: str, entry_id: str, db: Session) -> IncidentLogEntry:
    entry = db.query(IncidentLogEntry).filter(
        IncidentLogEntry.id == entry_id, IncidentLogEntry.case_id == case_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Incident log entry not found")
    return entry


@router.get("/", response_model=list[IncidentLogEntryRead])
def list_entries(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return (db.query(IncidentLogEntry)
            .filter(IncidentLogEntry.case_id == case_id)
            .order_by(IncidentLogEntry.event_ts)
            .all())


@router.post("/", response_model=IncidentLogEntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(
    case_id: str,
    payload: IncidentLogEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dual-write: creates a TimelineEvent (source='incident_log') AND the
    incident log entry, linked together, so the action shows up both in the
    consolidated case timeline and in the client-shareable incident log."""
    case = _get_case(case_id, db)
    data = payload.model_dump()

    timeline_event = TimelineEvent(
        case_id=case_id,
        event_ts=data["event_ts"],
        title=data["title"],
        description=data["description"],
        actor=data["actor"] or (current_user.username or ""),
        source="incident_log",
        tags=data["category"],
        origin="incident_log",
    )
    db.add(timeline_event)
    db.flush()

    entry = IncidentLogEntry(case_id=case_id, timeline_event_id=timeline_event.id, **data)
    db.add(entry)
    db.flush()

    audit_log(db, user=current_user, action="incident_log.create",
              resource_type="incident_log_entry", resource_id=entry.id,
              resource_name=entry.title, case_id=case_id, case_title=case.title)
    db.commit()
    db.refresh(entry)
    return entry


@router.patch("/{entry_id}", response_model=IncidentLogEntryRead)
def update_entry(
    case_id: str,
    entry_id: str,
    payload: IncidentLogEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = _get_entry(case_id, entry_id, db)
    case = _get_case(case_id, db)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(entry, key, value)

    # Keep the linked timeline event in sync
    if entry.timeline_event_id:
        tl = db.query(TimelineEvent).filter(TimelineEvent.id == entry.timeline_event_id).first()
        if tl:
            if "event_ts" in updates:
                tl.event_ts = entry.event_ts
            if "title" in updates:
                tl.title = entry.title
            if "description" in updates:
                tl.description = entry.description
            if "actor" in updates:
                tl.actor = entry.actor
            if "category" in updates:
                tl.tags = entry.category

    audit_log(db, user=current_user, action="incident_log.update",
              resource_type="incident_log_entry", resource_id=entry_id,
              resource_name=entry.title, case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    case_id: str,
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = _get_entry(case_id, entry_id, db)
    case = _get_case(case_id, db)

    if entry.timeline_event_id:
        tl = db.query(TimelineEvent).filter(TimelineEvent.id == entry.timeline_event_id).first()
        if tl:
            db.delete(tl)

    audit_log(db, user=current_user, action="incident_log.delete",
              resource_type="incident_log_entry", resource_id=entry_id,
              resource_name=entry.title, case_id=case_id, case_title=case.title)
    db.delete(entry)
    db.commit()


@router.get("/export")
def export_markdown(
    case_id: str,
    db: Session = Depends(get_db),
):
    case = _get_case(case_id, db)
    entries = (db.query(IncidentLogEntry)
               .filter(IncidentLogEntry.case_id == case_id)
               .order_by(IncidentLogEntry.event_ts)
               .all())

    lines = [f"# Incident Log — {case.title}", ""]
    lines.append(f"_Generated {datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')}_")
    lines.append("")

    if not entries:
        lines.append("_No incident log entries recorded yet._")
    else:
        current_day = None
        for e in entries:
            day = e.event_ts.strftime("%Y-%m-%d")
            if day != current_day:
                current_day = day
                lines.append(f"## {day}")
                lines.append("")
            label = CATEGORY_LABELS.get(e.category, e.category or "Other")
            time_str = e.event_ts.strftime("%H:%M UTC")
            header = f"- **{time_str}** — `{label}` — **{e.title}**"
            if e.actor:
                header += f" _(by {e.actor})_"
            lines.append(header)
            if e.description:
                for para in e.description.splitlines():
                    lines.append(f"  {para}")
            lines.append("")

    content = "\n".join(lines)
    safe_title = re.sub(r"[^\w\-]", "_", case.title or "case")
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_incident_log.md"'},
    )
