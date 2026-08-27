from __future__ import annotations

import json
from datetime import datetime

from pydantic import BaseModel, computed_field


class RegistryFileOut(BaseModel):
    id:            str
    case_id:       str
    filename:      str
    hive_type:     str
    status:        str
    entry_count:   int | None
    error_msg:     str | None
    uploaded_at:   datetime
    parsed_at:     datetime | None
    added_to_evidence:      bool
    parse_progress:         int
    parse_duration_seconds: int | None
    columns_json:           str | None = None

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
    timestamp:  datetime | None
    hive_path:  str | None
    hive_type:  str | None    # per-row type (from HiveType column in batch exports)
    key_path:   str | None
    value_name: str | None
    value_type: str | None    # REG_SZ | REG_DWORD | REG_BINARY | …
    value_data: str | None
    deleted:    str | None    # "True" / "False" / None
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
    oldest_timestamp: datetime | None
    newest_timestamp: datetime | None
    top_hive_types:   list[dict]     # [{hive_type, count}]   — for BATCH files
    top_value_types:  list[dict]     # [{value_type, count}]
    top_categories:   list[dict]     # [{category, count}]    — if Category column present
