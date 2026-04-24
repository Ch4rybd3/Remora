from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.case import Case
from ..models.timeline import TimelineEvent
from ..models.user import User
from ..schemas.timeline import TimelineEventCreate, TimelineEventRead, TimelineEventUpdate
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/cases/{case_id}/timeline", tags=["timeline"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/", response_model=List[TimelineEventRead])
def list_events(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return (db.query(TimelineEvent)
            .filter(TimelineEvent.case_id == case_id)
            .order_by(TimelineEvent.event_ts)
            .all())


@router.post("/", response_model=TimelineEventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    case_id: str,
    payload: TimelineEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    event = TimelineEvent(case_id=case_id, **payload.model_dump())
    db.add(event)
    db.flush()
    audit_log(db, user=current_user, action="timeline.create",
              resource_type="timeline_event", resource_id=event.id,
              resource_name=getattr(event, "title", None) or getattr(event, "description", None),
              case_id=case_id, case_title=case.title)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=TimelineEventRead)
def update_event(
    case_id: str,
    event_id: str,
    payload: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(TimelineEvent).filter(
        TimelineEvent.id == event_id, TimelineEvent.case_id == case_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    case = _get_case(case_id, db)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(event, key, value)
    audit_log(db, user=current_user, action="timeline.update",
              resource_type="timeline_event", resource_id=event_id,
              resource_name=getattr(event, "title", None) or getattr(event, "description", None),
              case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    case_id: str,
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(TimelineEvent).filter(
        TimelineEvent.id == event_id, TimelineEvent.case_id == case_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    case = _get_case(case_id, db)
    audit_log(db, user=current_user, action="timeline.delete",
              resource_type="timeline_event", resource_id=event_id,
              resource_name=getattr(event, "title", None) or getattr(event, "description", None),
              case_id=case_id, case_title=case.title)
    db.delete(event)
    db.commit()
