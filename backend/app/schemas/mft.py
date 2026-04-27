from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class MftFileOut(BaseModel):
    id:          str
    case_id:     str
    filename:    str
    status:      str
    entry_count: Optional[int]
    error_msg:   Optional[str]
    uploaded_at: datetime
    parsed_at:   Optional[datetime]
    added_to_evidence:     bool
    parse_progress:        int
    parse_duration_seconds: Optional[int]

    model_config = {"from_attributes": True}


class MftEntryOut(BaseModel):
    """One MFT record as returned by the API (sourced from DuckDB / MFTECmd CSV)."""
    entry_number:        int
    parent_entry_number: Optional[int]
    parent_path:         Optional[str]
    filename:            Optional[str]
    extension:           Optional[str]
    file_size:           Optional[int]

    is_in_use:   bool
    is_deleted:  bool
    is_directory: bool

    si_created:     Optional[datetime]
    si_modified:    Optional[datetime]
    si_accessed:    Optional[datetime]
    si_mft_changed: Optional[datetime]

    fn_created:     Optional[datetime]
    fn_modified:    Optional[datetime]
    fn_accessed:    Optional[datetime]
    fn_mft_changed: Optional[datetime]

    has_ts_anomaly: bool   # SI timestamps < FN timestamps (possible timestomping)


class EntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[MftEntryOut]


class MftSummary(BaseModel):
    total_entries:      int
    deleted_count:      int
    directory_count:    int
    file_count:         int
    oldest_si_modified: Optional[datetime]
    newest_si_modified: Optional[datetime]
    top_extensions:     list[dict]   # [{ext, count}]
