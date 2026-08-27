from datetime import datetime

from pydantic import BaseModel


class IncidentLogEntryBase(BaseModel):
    event_ts: datetime
    category: str = "remediation"
    title: str
    description: str = ""
    actor: str = ""


class IncidentLogEntryCreate(IncidentLogEntryBase):
    pass


class IncidentLogEntryUpdate(BaseModel):
    event_ts: datetime | None = None
    category: str | None = None
    title: str | None = None
    description: str | None = None
    actor: str | None = None


class IncidentLogEntryRead(IncidentLogEntryBase):
    id: str
    case_id: str
    timeline_event_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
