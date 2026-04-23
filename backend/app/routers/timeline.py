from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.case import Case
from ..models.timeline import TimelineEvent
from ..schemas.timeline import TimelineEventCreate, TimelineEventRead, TimelineEventUpdate

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
def create_event(case_id: str, payload: TimelineEventCreate, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    event = TimelineEvent(case_id=case_id, **payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=TimelineEventRead)
def update_event(case_id: str, event_id: str, payload: TimelineEventUpdate,
                 db: Session = Depends(get_db)):
    event = db.query(TimelineEvent).filter(
        TimelineEvent.id == event_id, TimelineEvent.case_id == case_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(case_id: str, event_id: str, db: Session = Depends(get_db)):
    event = db.query(TimelineEvent).filter(
        TimelineEvent.id == event_id, TimelineEvent.case_id == case_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
