from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel


class AttackGraphRead(BaseModel):
    case_id:    str
    nodes:      list[dict[str, Any]]
    edges:      list[dict[str, Any]]
    updated_at: datetime

    model_config = {"from_attributes": True}


class AttackGraphSave(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
