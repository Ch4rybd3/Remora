from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id:            int
    timestamp:     datetime
    username:      str | None
    user_role:     str | None
    action:        str
    resource_type: str | None
    resource_id:   str | None
    resource_name: str | None
    case_id:       str | None
    case_title:    str | None
    details:       dict[str, Any] | None
    ip_address:    str | None

    model_config = {"from_attributes": True}


class AuditPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[AuditLogOut]
