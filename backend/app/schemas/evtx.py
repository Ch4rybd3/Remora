from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

# ── EvtxFile ──────────────────────────────────────────────────────────────────

class EvtxFileOut(BaseModel):
    id:                 str
    case_id:            str
    filename:           str
    status:             str          # pending | parsing | ready | error
    event_count:        int | None
    error_msg:          str | None
    uploaded_at:        datetime
    parsed_at:          datetime | None
    added_to_evidence:  bool

    model_config = {"from_attributes": True}


# ── EvtxEvent ─────────────────────────────────────────────────────────────────

class EvtxEventOut(BaseModel):
    id:              int
    file_id:         str
    record_id:       int | None
    time_created:    datetime | None
    event_id:        int | None
    level:           int | None
    level_name:      str | None
    channel:         str | None
    provider:        str | None
    computer:        str | None
    user_id:         str | None
    event_data:      dict[str, Any] | None

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
