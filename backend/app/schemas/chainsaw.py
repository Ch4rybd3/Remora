from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ChainsawScanOut(BaseModel):
    id:          str
    file_id:     str
    case_id:     str
    status:      str
    alert_count: int | None
    error_msg:   str | None
    scanned_at:  datetime | None
    created_at:  datetime
    model_config = {"from_attributes": True}


class ChainsawAlertOut(BaseModel):
    id:           str
    scan_id:      str
    file_id:      str
    case_id:      str
    rule_name:    str
    level:        str | None
    sigma_status: str | None
    group_name:   str | None
    tags:         str | None
    authors:      str | None
    timestamp:    datetime | None
    event_id:     int | None
    channel:      str | None
    computer:     str | None
    provider:     str | None
    event_data:   dict | None
    added_to_timeline: bool
    model_config = {"from_attributes": True}


class AlertsPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[ChainsawAlertOut]


class ChainsawSelectionOut(BaseModel):
    alert_ids: list[str]
    sent_ids:  list[str]
    model_config = {"from_attributes": True}


class ChainsawSelectionSave(BaseModel):
    alert_ids: list[str]
    sent_ids:  list[str]
