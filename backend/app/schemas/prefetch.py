from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PrefetchFileOut(BaseModel):
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


class PrefetchEntryOut(BaseModel):
    """One row from a PECmd prefetch CSV — one entry per executable."""
    row_num:         int
    source_filename: Optional[str]
    executable_name: Optional[str]
    hash:            Optional[str]
    size:            Optional[int]
    version:         Optional[str]
    run_count:       Optional[int]
    last_run:        Optional[datetime]
    prev_run_0:      Optional[datetime]
    prev_run_1:      Optional[datetime]
    prev_run_2:      Optional[datetime]
    prev_run_3:      Optional[datetime]
    prev_run_4:      Optional[datetime]
    prev_run_5:      Optional[datetime]
    prev_run_6:      Optional[datetime]
    volume0_name:    Optional[str]
    volume0_serial:  Optional[str]
    volume1_name:    Optional[str]
    directories:     Optional[str]
    files_loaded:    Optional[str]


class PrefetchEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[PrefetchEntryOut]


class PrefetchSummary(BaseModel):
    total_entries:   int
    total_runs:      int
    oldest_last_run: Optional[datetime]
    newest_last_run: Optional[datetime]
    top_executables: list[dict]   # [{executable_name, run_count, last_run}]
    versions:        list[dict]   # [{version, count}]
