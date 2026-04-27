from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UsnFileOut(BaseModel):
    id:          str
    case_id:     str
    filename:    str
    status:      str
    entry_count: Optional[int]
    error_msg:   Optional[str]
    uploaded_at: datetime
    parsed_at:   Optional[datetime]
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: Optional[int]

    model_config = {"from_attributes": True}


class UsnEntryOut(BaseModel):
    """One USN Journal record (from MFTECmd $J CSV → DuckDB)."""
    entry_offset:     Optional[int]
    usn:              Optional[int]
    filename:         Optional[str]
    extension:        Optional[str]
    is_directory:     bool
    update_timestamp: Optional[datetime]
    reason:           Optional[str]
    full_path:        Optional[str]
    file_ref:         Optional[str]
    parent_ref:       Optional[str]


class UsnEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[UsnEntryOut]


class UsnSummary(BaseModel):
    total_entries:      int
    oldest_timestamp:   Optional[datetime]
    newest_timestamp:   Optional[datetime]
    top_reasons:        list[dict]   # [{reason, count}]
    top_extensions:     list[dict]   # [{ext, count}]
