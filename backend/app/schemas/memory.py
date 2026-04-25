from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


# ── MemoryDump ─────────────────────────────────────────────────────────────────

class MemoryDumpOut(BaseModel):
    id:           str
    case_id:      str
    filename:     str
    os_type:      str                  # "windows" | "linux"
    file_size:    Optional[int]
    status:       str                  # uploaded | analyzing | done | error
    error_msg:    Optional[str]
    uploaded_at:  datetime

    model_config = {"from_attributes": True}


# ── MemoryPluginResult ─────────────────────────────────────────────────────────

class MemoryPluginResultOut(BaseModel):
    id:           int
    dump_id:      str
    plugin_name:  str
    plugin_args:  Optional[dict[str, Any]]
    status:       str                  # pending | running | done | error
    output:       Optional[str]
    error:        Optional[str]
    started_at:   Optional[datetime]
    completed_at: Optional[datetime]
    is_custom:    bool

    model_config = {"from_attributes": True}


# ── Run custom plugin payload ──────────────────────────────────────────────────

class RunPluginPayload(BaseModel):
    plugin_name: str                   # e.g. "windows.pslist"
    plugin_args: Optional[dict[str, Any]] = None   # {pid: 1234, ...}
