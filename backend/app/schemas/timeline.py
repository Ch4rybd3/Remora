from datetime import datetime

from pydantic import BaseModel


class TimelineEventBase(BaseModel):
    event_ts: datetime
    title: str
    description: str = ""
    actor: str = ""
    source: str = ""
    tags: str = ""
    origin: str = "manual"
    # Full source record as a JSON string; rendered under a chevron in the UI
    raw_payload: str | None = None
    raw_source: str = ""


class TimelineEventCreate(TimelineEventBase):
    pass


class TimelineEventUpdate(BaseModel):
    event_ts: datetime | None = None
    title: str | None = None
    description: str | None = None
    actor: str | None = None
    source: str | None = None
    tags: str | None = None
    origin: str | None = None
    raw_payload: str | None = None
    raw_source: str | None = None


class TimelineEventRead(TimelineEventBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
