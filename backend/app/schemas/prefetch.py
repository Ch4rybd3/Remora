from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class PrefetchFileOut(BaseModel):
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


class PrefetchEntryOut(BaseModel):
    """One row from a PECmd prefetch CSV — one entry per executable."""
    row_num:         int
    source_filename: str | None
    executable_name: str | None
    hash:            str | None
    size:            int | None
    version:         str | None
    run_count:       int | None
    last_run:        datetime | None
    prev_run_0:      datetime | None
    prev_run_1:      datetime | None
    prev_run_2:      datetime | None
    prev_run_3:      datetime | None
    prev_run_4:      datetime | None
    prev_run_5:      datetime | None
    prev_run_6:      datetime | None
    volume0_name:    str | None
    volume0_serial:  str | None
    volume1_name:    str | None
    directories:     str | None
    files_loaded:    str | None


class PrefetchEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[PrefetchEntryOut]


class PrefetchSummary(BaseModel):
    total_entries:   int
    total_runs:      int
    oldest_last_run: datetime | None
    newest_last_run: datetime | None
    top_executables: list[dict]   # [{executable_name, run_count, last_run}]
    versions:        list[dict]   # [{version, count}]
