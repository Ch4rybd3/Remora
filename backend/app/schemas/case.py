from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.case import CaseStatus, CaseSeverity, CaseType


class CaseBase(BaseModel):
    title: str
    description: str = ""
    status: CaseStatus = CaseStatus.open
    severity: CaseSeverity = CaseSeverity.medium
    tags: str = ""
    template_id: Optional[str] = None
    assigned_to: str = ""
    tlp: str = "TLP:AMBER"
    case_type: CaseType = CaseType.ir
    client_name: str = ""
    executive_summary: str = ""
    quick_notes: str = ""
    report: str = ""


class CaseCreate(CaseBase):
    pass


class CaseUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[CaseStatus] = None
    severity: Optional[CaseSeverity] = None
    tags: Optional[str] = None
    assigned_to: Optional[str] = None
    tlp: Optional[str] = None
    case_type: Optional[CaseType] = None
    client_name: Optional[str] = None
    executive_summary: Optional[str] = None
    quick_notes: Optional[str] = None
    report: Optional[str] = None


class CaseRead(CaseBase):
    id: str
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class CaseSummary(BaseModel):
    id: str
    title: str
    status: CaseStatus
    severity: CaseSeverity
    tags: str
    assigned_to: str
    tlp: str
    case_type: CaseType = CaseType.ir
    client_name: str = ""
    created_at: datetime
    updated_at: datetime
    ioc_count: int = 0
    asset_count: int = 0
    evidence_count: int = 0
    timeline_count: int = 0

    model_config = {"from_attributes": True}
