from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, computed_field


class RegistryFileOut(BaseModel):
    id:            str
    case_id:       str
    filename:      str
    hive_type:     str
    status:        str
    entry_count:   Optional[int]
    error_msg:     Optional[str]
    uploaded_at:   datetime
    parsed_at:     Optional[datetime]
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: Optional[int]
    columns_json:           Optional[str] = None

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def columns(self) -> list[str]:
        if self.columns_json:
            try:
                return json.loads(self.columns_json)
            except Exception:
                return []
        return []


class RegistryEntryOut(BaseModel):
    """One row from a RECmd / Registry Explorer CSV.

    Normalized fields are the minimal set used for filtering / sorting.
    All original CSV columns are returned verbatim in ``raw_data``.
    """
    row_num:    int
    timestamp:  Optional[datetime]
    hive_path:  Optional[str]
    hive_type:  Optional[str]    # per-row type (from HiveType column in batch exports)
    key_path:   Optional[str]
    value_name: Optional[str]
    value_type: Optional[str]    # REG_SZ | REG_DWORD | REG_BINARY | …
    value_data: Optional[str]
    deleted:    Optional[str]    # "True" / "False" / None
    raw_data:   dict[str, str]   # {original_column_name: value}


class RegistryEntriesPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[RegistryEntryOut]


class RegistrySummary(BaseModel):
    total_entries:    int
    hive_type:        str            # file-level hive type
    oldest_timestamp: Optional[datetime]
    newest_timestamp: Optional[datetime]
    top_hive_types:   list[dict]     # [{hive_type, count}]   — for BATCH files
    top_value_types:  list[dict]     # [{value_type, count}]
    top_categories:   list[dict]     # [{category, count}]    — if Category column present
