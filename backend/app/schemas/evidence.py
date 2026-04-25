from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.evidence import EvidenceType, AcquisitionMethod


class EvidenceBase(BaseModel):
    name: str
    description: str = ""
    evidence_type: EvidenceType = EvidenceType.other
    source_location: str = ""
    acquisition_method: AcquisitionMethod = AcquisitionMethod.manual
    collected_at: Optional[datetime] = None
    collected_by: str = ""
    chain_of_custody: str = ""
    tags: str = ""


class EvidenceCreate(EvidenceBase):
    pass


class EvidenceUpdate(BaseModel):
    # Mandatory — documents why the record changed (appended to chain_of_custody)
    note: str
    # Editable metadata
    name: Optional[str] = None
    description: Optional[str] = None
    evidence_type: Optional[EvidenceType] = None
    source_location: Optional[str] = None
    acquisition_method: Optional[AcquisitionMethod] = None
    collected_at: Optional[datetime] = None
    collected_by: Optional[str] = None
    tags: Optional[str] = None
    # chain_of_custody is append-only and managed server-side


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
