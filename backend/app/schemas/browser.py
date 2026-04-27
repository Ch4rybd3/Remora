from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, computed_field


class BrowserFileOut(BaseModel):
    id:            str
    case_id:       str
    filename:      str
    artifact_type: str
    status:        str
    entry_count:   Optional[int]
    error_msg:     Optional[str]
    uploaded_at:   datetime
    parsed_at:     Optional[datetime]
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: Optional[int]
    columns_json:           Optional[str] = None   # raw JSON – parsed below

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def columns(self) -> list[str]:
        """Original CSV column names, decoded from columns_json."""
        if self.columns_json:
            try:
                return json.loads(self.columns_json)
            except Exception:
                return []
        return []


class BrowserEntryOut(BaseModel):
    """One row from a WebX browser-artifact CSV (via DuckDB).

    Normalized fields are the minimal set used for filtering / sorting.
    All original CSV columns are returned verbatim in ``raw_data``.
    """
    row_num:        int
    artifact_type:  str
    event_timestamp: Optional[datetime]
    url:            Optional[str]
    title:          Optional[str]
    browser:        Optional[str]
    profile:        Optional[str]
    username:       Optional[str]
    raw_data:       dict[str, str]   # {original_column_name: value}


class BrowserEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[BrowserEntryOut]


class BrowserSummary(BaseModel):
    total_entries:    int
    artifact_type:    str
    oldest_timestamp: Optional[datetime]
    newest_timestamp: Optional[datetime]
    top_browsers:     list[dict]   # [{browser, count}]
    top_domains:      list[dict]   # [{domain, count}]
