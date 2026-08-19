from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class TimelineEventBase(BaseModel):
    event_ts: datetime
    title: str
    description: str = ""
    actor: str = ""
    source: str = ""
    tags: str = ""
    origin: str = "manual"
    # Full source record as a JSON string; rendered under a chevron in the UI
    raw_payload: Optional[str] = None
    raw_source: str = ""


class TimelineEventCreate(TimelineEventBase):
    pass


class TimelineEventUpdate(BaseModel):
    event_ts: Optional[datetime] = None
    title: Optional[str] = None
    description: Optional[str] = None
    actor: Optional[str] = None
    source: Optional[str] = None
    tags: Optional[str] = None
    origin: Optional[str] = None
    raw_payload: Optional[str] = None
    raw_source: Optional[str] = None


class TimelineEventRead(TimelineEventBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
