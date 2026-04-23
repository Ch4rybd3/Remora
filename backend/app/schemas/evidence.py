from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class EvidenceBase(BaseModel):
    name: str
    description: str = ""
    collected_at: Optional[datetime] = None
    collected_by: str = ""
    chain_of_custody: str = ""
    tags: str = ""


class EvidenceCreate(EvidenceBase):
    pass


class EvidenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    collected_at: Optional[datetime] = None
    collected_by: Optional[str] = None
    chain_of_custody: Optional[str] = None
    tags: Optional[str] = None


class EvidenceRead(EvidenceBase):
    id: str
    case_id: str
    original_filename: str
    file_size: int
    mime_type: str
    md5_hash: str
    sha256_hash: str
    created_at: datetime

    model_config = {"from_attributes": True}
