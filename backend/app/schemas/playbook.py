from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Any
import json


class PlaybookCreate(BaseModel):
    name: str
    description: str = ""
    nodes: list[Any] = []
    edges: list[Any] = []
    layout_dir: str = "DOWN"


class PlaybookUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    nodes: list[Any] | None = None
    edges: list[Any] | None = None
    layout_dir: str | None = None


class PlaybookRead(BaseModel):
    id: str
    name: str
    description: str
    nodes: list[Any]
    edges: list[Any]
    layout_dir: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("nodes", "edges", mode="before")
    @classmethod
    def parse_json(cls, v: Any) -> list:
        if isinstance(v, str):
            return json.loads(v)
        return v or []


class StepStateUpdate(BaseModel):
    done: bool
    comment: str = ""
    notes: str = ""     # markdown notes liées à cette étape


class CasePlaybookCreate(BaseModel):
    playbook_id: str


class CasePlaybookRead(BaseModel):
    id: str
    case_id: str
    playbook_id: str
    playbook: PlaybookRead
    step_states: dict[str, Any]
    added_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("step_states", mode="before")
    @classmethod
    def parse_json(cls, v: Any) -> dict:
        if isinstance(v, str):
            return json.loads(v)
        return v or {}
