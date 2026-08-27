from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

# ── MemoryDump ─────────────────────────────────────────────────────────────────

class MemoryDumpOut(BaseModel):
    id:           str
    case_id:      str
    filename:     str
    os_type:      str                  # "windows" | "linux"
    file_size:    int | None
    status:       str                  # uploaded | analyzing | done | error
    error_msg:    str | None
    uploaded_at:  datetime

    model_config = {"from_attributes": True}


# ── MemoryPluginResult ─────────────────────────────────────────────────────────

class MemoryPluginResultOut(BaseModel):
    id:           int
    dump_id:      str
    plugin_name:  str
    plugin_args:  dict[str, Any] | None
    status:       str                  # pending | running | done | error
    output:       str | None
    error:        str | None
    started_at:   datetime | None
    completed_at: datetime | None
    is_custom:    bool

    model_config = {"from_attributes": True}


# ── Run custom plugin payload ──────────────────────────────────────────────────

class RunPluginPayload(BaseModel):
    plugin_name: str                   # e.g. "windows.pslist"
    plugin_args: dict[str, Any] | None = None   # {pid: 1234, ...}
