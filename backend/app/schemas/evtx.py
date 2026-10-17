from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

# ── EvtxFile ──────────────────────────────────────────────────────────────────

class EvtxFileOut(BaseModel):
    id:                 str
    case_id:            str
    filename:           str
    status:             str          # pending | ready | error
    event_count:        int | None
    error_msg:          str | None
    uploaded_at:        datetime
    parsed_at:          datetime | None
    added_to_evidence:  bool

    model_config = {"from_attributes": True}

