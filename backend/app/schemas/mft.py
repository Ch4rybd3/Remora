from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class MftFileOut(BaseModel):
    id:          str
    case_id:     str
    filename:    str
    status:      str
    entry_count: int | None
    error_msg:   str | None
    uploaded_at: datetime
    parsed_at:   datetime | None
    added_to_evidence:     bool
    parse_progress:        int
    parse_duration_seconds: int | None

    model_config = {"from_attributes": True}


class MftEntryOut(BaseModel):
    """One MFT record as returned by the API (sourced from DuckDB / MFTECmd CSV)."""
    entry_number:        int
    parent_entry_number: int | None
    parent_path:         str | None
    filename:            str | None
    extension:           str | None
    file_size:           int | None

    is_in_use:   bool
    is_deleted:  bool
    is_directory: bool

    si_created:     datetime | None
    si_modified:    datetime | None
    si_accessed:    datetime | None
    si_mft_changed: datetime | None

    fn_created:     datetime | None
    fn_modified:    datetime | None
    fn_accessed:    datetime | None
    fn_mft_changed: datetime | None

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
    oldest_si_modified: datetime | None
    newest_si_modified: datetime | None
    top_extensions:     list[dict]   # [{ext, count}]
