from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class UsnFileOut(BaseModel):
    id:          str
    case_id:     str
    filename:    str
    status:      str
    entry_count: int | None
    error_msg:   str | None
    uploaded_at: datetime
    parsed_at:   datetime | None
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: int | None

    model_config = {"from_attributes": True}


class UsnEntryOut(BaseModel):
    """One USN Journal record (from MFTECmd $J CSV → DuckDB)."""
    entry_offset:     int | None
    usn:              int | None
    filename:         str | None
    extension:        str | None
    is_directory:     bool
    update_timestamp: datetime | None
    reason:           str | None
    full_path:        str | None
    file_ref:         str | None
    parent_ref:       str | None


class UsnEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[UsnEntryOut]


class UsnSummary(BaseModel):
    total_entries:      int
    oldest_timestamp:   datetime | None
    newest_timestamp:   datetime | None
    top_reasons:        list[dict]   # [{reason, count}]
    top_extensions:     list[dict]   # [{ext, count}]
