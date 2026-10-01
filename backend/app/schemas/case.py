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
    #: Every section concatenated, derived on save. Never sent by a client.
    report: str = ""
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
    report_sections_data: str | None = None


class BulkCaseUpdate(BaseModel):
    """
    One change applied to several cases.

    Only the fields an analyst would reasonably set on a batch: a sweep of
    triage at the end of a week closes thirty cases, reassigns a handful and
    tags a campaign. Everything else about a case is written one case at a time,
    where the context for it is.

    Deliberately not here: delete. A bulk delete is one mis-click away from
    removing an investigation, and there is no undo for it.
    """
    case_ids:    list[str]
    status:      CaseStatus | None = None
    severity:    CaseSeverity | None = None
    assigned_to: str | None = None
    #: Tags are added and removed, never replaced. A batch that overwrote the
    #: tag list would silently discard whatever each case carried of its own.
    add_tags:    list[str] = []
    remove_tags: list[str] = []


class BulkCaseResult(BaseModel):
    """What the batch actually did, per case."""
    #: Cases changed. A case the update would leave identical is still here -
    #: the analyst asked for a state, and it holds.
    updated:   list[str]
    #: Asked for but not found, or belonging to a client this account cannot
    #: see. Reported rather than silently dropped.
    skipped:   list[str]
    #: Which fields the batch set, for the message the interface shows.
    fields:    list[str]


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
