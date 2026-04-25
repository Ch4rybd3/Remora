from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


# ── EvtxFile ──────────────────────────────────────────────────────────────────

class EvtxFileOut(BaseModel):
    id:                 str
    case_id:            str
    filename:           str
    status:             str          # pending | parsing | ready | error
    event_count:        Optional[int]
    error_msg:          Optional[str]
    uploaded_at:        datetime
    parsed_at:          Optional[datetime]
    added_to_evidence:  bool

    model_config = {"from_attributes": True}


# ── EvtxEvent ─────────────────────────────────────────────────────────────────

class EvtxEventOut(BaseModel):
    id:              int
    file_id:         str
    record_id:       Optional[int]
    time_created:    Optional[datetime]
    event_id:        Optional[int]
    level:           Optional[int]
    level_name:      Optional[str]
    channel:         Optional[str]
    provider:        Optional[str]
    computer:        Optional[str]
    user_id:         Optional[str]
    event_data:      Optional[dict[str, Any]]

    model_config = {"from_attributes": True}


# ── Paginated response ────────────────────────────────────────────────────────

class EventsPage(BaseModel):
    total:      int
    page:       int
    page_size:  int
    pages:      int
    items:      list[EvtxEventOut]


# ── Channel stats ─────────────────────────────────────────────────────────────

class ChannelStat(BaseModel):
    channel:     str
    event_count: int


class FileSummary(BaseModel):
    channels:    list[ChannelStat]
    levels:      dict[str, int]   # level_name → count
    event_ids:   list[int]        # top-20 most frequent event IDs


# ── Pinned-event selection ────────────────────────────────────────────────────

class EvtxSelectionOut(BaseModel):
    """Analyst's saved event selection for the Filesystem & Logs page."""
    events:   list[dict[str, Any]]   # full pinned event objects (EvtxEvent + _filename)
    sent_ids: list[int]              # IDs already pushed to the case timeline


class EvtxSelectionSave(BaseModel):
    events:   list[dict[str, Any]]
    sent_ids: list[int]
