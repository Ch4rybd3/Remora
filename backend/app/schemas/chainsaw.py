from __future__ import annotations
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ChainsawScanOut(BaseModel):
    id:          str
    file_id:     str
    case_id:     str
    status:      str
    alert_count: Optional[int]
    error_msg:   Optional[str]
    scanned_at:  Optional[datetime]
    created_at:  datetime
    model_config = {"from_attributes": True}


class ChainsawAlertOut(BaseModel):
    id:           str
    scan_id:      str
    file_id:      str
    case_id:      str
    rule_name:    str
    level:        Optional[str]
    sigma_status: Optional[str]
    group_name:   Optional[str]
    tags:         Optional[str]
    authors:      Optional[str]
    timestamp:    Optional[datetime]
    event_id:     Optional[int]
    channel:      Optional[str]
    computer:     Optional[str]
    provider:     Optional[str]
    event_data:   Optional[dict]
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
