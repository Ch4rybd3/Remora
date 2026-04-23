from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.ioc import IOCType, IOCConfidence


class IOCBase(BaseModel):
    type: IOCType
    value: str
    description: str = ""
    tags: str = ""
    confidence: IOCConfidence = IOCConfidence.medium
    tlp: str = "TLP:AMBER"
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None


class IOCCreate(IOCBase):
    pass


class IOCUpdate(BaseModel):
    type: Optional[IOCType] = None
    value: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None
    confidence: Optional[IOCConfidence] = None
    tlp: Optional[str] = None
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None


class IOCRead(IOCBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
