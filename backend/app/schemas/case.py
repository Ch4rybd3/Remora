from datetime import datetime

from pydantic import BaseModel

from ..models.case import CaseSeverity, CaseStatus, CaseType


class CaseBase(BaseModel):
    title: str
    description: str = ""
    status: CaseStatus = CaseStatus.open
    severity: CaseSeverity = CaseSeverity.medium
    tags: str = ""
    template_id: str | None = None
    assigned_to: str = ""
    tlp: str = "TLP:AMBER"
    case_type: CaseType = CaseType.ir
    client_name: str = ""
    client_id: str | None = None
    executive_summary: str = ""
    quick_notes: str = ""
    report: str = ""
    report_analysis: str = ""
    report_remediation: str = ""
    report_conclusion: str = ""
    report_sections_data: str = "{}"


class CaseCreate(CaseBase):
    pass


class CaseUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: CaseStatus | None = None
    severity: CaseSeverity | None = None
    tags: str | None = None
    assigned_to: str | None = None
    tlp: str | None = None
    case_type: CaseType | None = None
    client_name: str | None = None
    client_id: str | None = None
    executive_summary: str | None = None
    quick_notes: str | None = None
    report: str | None = None
    report_analysis: str | None = None
    report_remediation: str | None = None
    report_conclusion: str | None = None
    report_sections_data: str | None = None


class CaseRead(CaseBase):
    id: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None = None

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
    client_id: str | None = None
    created_at: datetime
    updated_at: datetime
    ioc_count: int = 0
    asset_count: int = 0
    evidence_count: int = 0
    timeline_count: int = 0

    model_config = {"from_attributes": True}
