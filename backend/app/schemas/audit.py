from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id:            int
    timestamp:     datetime
    username:      Optional[str]
    user_role:     Optional[str]
    action:        str
    resource_type: Optional[str]
    resource_id:   Optional[str]
    resource_name: Optional[str]
    case_id:       Optional[str]
    case_title:    Optional[str]
    details:       Optional[dict[str, Any]]
    ip_address:    Optional[str]

    model_config = {"from_attributes": True}


class AuditPage(BaseModel):
    total:     int
    page:      int
    page_size: int
    pages:     int
    items:     list[AuditLogOut]
