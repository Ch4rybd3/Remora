from __future__ import annotations

import json
from datetime import datetime

from pydantic import BaseModel, computed_field


class BrowserFileOut(BaseModel):
    id:            str
    case_id:       str
    filename:      str
    artifact_type: str
    status:        str
    entry_count:   int | None
    error_msg:     str | None
    uploaded_at:   datetime
    parsed_at:     datetime | None
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: int | None
    columns_json:           str | None = None   # raw JSON – parsed below

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
    event_timestamp: datetime | None
    url:            str | None
    title:          str | None
    browser:        str | None
    profile:        str | None
    username:       str | None
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
    oldest_timestamp: datetime | None
    newest_timestamp: datetime | None
    top_browsers:     list[dict]   # [{browser, count}]
    top_domains:      list[dict]   # [{domain, count}]
