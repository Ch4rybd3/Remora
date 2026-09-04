from datetime import datetime

from pydantic import BaseModel

from ..models.evidence import AcquisitionMethod, EvidenceType


class EvidenceBase(BaseModel):
    name: str
    description: str = ""
    evidence_type: EvidenceType = EvidenceType.other
    source_location: str = ""
    acquisition_method: AcquisitionMethod = AcquisitionMethod.manual
    collected_at: datetime | None = None
    collected_by: str = ""
    chain_of_custody: str = ""
    tags: str = ""


class EvidenceCreate(EvidenceBase):
    pass


class EvidenceUpdate(BaseModel):
    # Mandatory — documents why the record changed (appended to chain_of_custody)
    note: str
    # Editable metadata
    name: str | None = None
    description: str | None = None
    evidence_type: EvidenceType | None = None
    source_location: str | None = None
    acquisition_method: AcquisitionMethod | None = None
    collected_at: datetime | None = None
    collected_by: str | None = None
    tags: str | None = None
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
