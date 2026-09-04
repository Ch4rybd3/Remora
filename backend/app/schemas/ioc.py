from datetime import datetime

from pydantic import BaseModel

from ..models.ioc import IOCConfidence, IOCType


class IOCBase(BaseModel):
    type: IOCType
    value: str
    description: str = ""
    tags: str = ""
    confidence: IOCConfidence = IOCConfidence.medium
    tlp: str = "TLP:AMBER"
    first_seen: datetime | None = None
    last_seen: datetime | None = None


class IOCCreate(IOCBase):
    pass


class IOCUpdate(BaseModel):
    type: IOCType | None = None
    value: str | None = None
    description: str | None = None
    tags: str | None = None
    confidence: IOCConfidence | None = None
    tlp: str | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None


class IOCRead(IOCBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
