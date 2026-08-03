from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class IncidentLogEntryBase(BaseModel):
    event_ts: datetime
    category: str = "remediation"
    title: str
    description: str = ""
    actor: str = ""


class IncidentLogEntryCreate(IncidentLogEntryBase):
    pass


class IncidentLogEntryUpdate(BaseModel):
    event_ts: Optional[datetime] = None
    category: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    actor: Optional[str] = None


class IncidentLogEntryRead(IncidentLogEntryBase):
    id: str
    case_id: str
    timeline_event_id: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
