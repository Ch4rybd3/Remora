import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator


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


class StepAssignee(BaseModel):
    """Who owns a playbook step.

    `kind="user"` points at a Remora account (`user_id` set); `kind="external"`
    is free text for a service desk, a client contact or a third party who has
    no account here.
    """
    kind: str                    # "user" | "external"
    user_id: str | None = None
    label: str                   # displayed name
    color: str = ""              # hex, resolved client-side, stored for exports

    @field_validator("kind")
    @classmethod
    def check_kind(cls, v: str) -> str:
        if v not in ("user", "external"):
            raise ValueError("kind must be 'user' or 'external'")
        return v


class StepAssigneeUpdate(BaseModel):
    # null clears the assignment
    assignee: StepAssignee | None = None


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
