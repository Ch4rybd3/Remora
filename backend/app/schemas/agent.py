from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def _utc_iso(value: datetime) -> str:
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


#: Stored naive and in UTC (CONVENTIONS.md section 6). Serialised with its `Z`,
#: so a browser cannot read it as local time.
UTCDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


class AgentCreate(BaseModel):
    name:  str | None = Field(None, max_length=128)
    role:  str = Field("assistant", max_length=64)
    model: str | None = Field(None, max_length=128)


class AgentUpdate(BaseModel):
    name:  str | None = Field(None, min_length=1, max_length=128)
    model: str | None = Field(None, min_length=1, max_length=128)


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:          str
    case_id:     str
    role:        str
    name:        str
    provider:    str
    model:       str
    status:      str
    launched_by: str
    created_at:  UTCDateTime
    updated_at:  UTCDateTime


class AgentMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=8000)


class AgentTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:          str
    agent_id:    str
    objective:   str
    status:      str
    max_steps:   int
    steps_used:  int
    tokens_in:   int
    tokens_out:  int
    error:       str | None
    created_at:  UTCDateTime
    started_at:  UTCDateTime | None
    finished_at: UTCDateTime | None


class AgentEventRead(BaseModel):
    id:         str
    case_id:    str
    agent_id:   str | None
    task_id:    str | None
    seq:        int
    kind:       str
    payload:    dict[str, Any]
    actor:      str
    hash:       str
    created_at: str


class ChainVerification(BaseModel):
    ok:            bool
    events:        int
    broken_at_seq: int | None


class RoleRead(BaseModel):
    id:          str
    name:        str
    description: str


class ToolRead(BaseModel):
    name:        str
    description: str


class ModelRead(BaseModel):
    name:       str
    size_bytes: int


class LLMHealth(BaseModel):
    provider:      str
    reachable:     bool
    detail:        str
    default_model: str
    models:        list[ModelRead]
