from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator


def _utc_iso(value: datetime) -> str:
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


#: Stored naive and in UTC (CONVENTIONS.md section 6). Serialised with its `Z`,
#: so a browser cannot read it as local time.
UTCDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]


class AgentCreate(BaseModel):
    #: `ollama`, or the name of a configured provider. Default: the role's setting.
    provider: str | None = Field(None, min_length=1, max_length=64)
    name:  str | None = Field(None, max_length=128)
    role:  str = Field("assistant", max_length=64)
    model: str | None = Field(None, max_length=128)


class AgentUpdate(BaseModel):
    name:  str | None = Field(None, min_length=1, max_length=128)
    model: str | None = Field(None, min_length=1, max_length=128)
    #: `ollama`, or the name of a configured provider.
    provider: str | None = Field(None, min_length=1, max_length=64)
    #: Incident Leader only: start the tasks it proposes without approval.
    auto_start: bool | None = None


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
    auto_start:  bool
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
    kind:           str
    process_id:     str | None
    current_step:   str | None
    parent_task_id: str | None
    depends_on:     list[str]
    report:         str | None
    cost_usd:    float
    created_at:  UTCDateTime
    started_at:  UTCDateTime | None
    finished_at: UTCDateTime | None

    @field_validator("depends_on", mode="before")
    @classmethod
    def _decode(cls, value: Any) -> Any:
        # Stored as a JSON string on the row.
        return json.loads(value or "[]") if isinstance(value, str) else value


class AgentProposalRead(BaseModel):
    id:               str
    case_id:          str
    agent_id:         str
    task_id:          str | None
    kind:             str
    payload:          dict[str, Any]
    rationale:        str
    evidence:         list[str]
    state:            str
    decided_by:       str | None
    decided_at:       UTCDateTime | None
    decision_comment: str | None
    result_id:        str | None
    created_at:       UTCDateTime


class AgentObservationRead(BaseModel):
    id:             str
    case_id:        str
    agent_id:       str
    task_id:        str | None
    #: artifact (an Explorer table), memory, email or binary.
    source_kind:    str
    artifact_id:    str
    artifact_name:  str
    artifact_label: str | None
    locator:        str
    row:            dict[str, Any]
    note:           str
    #: False once the table the row came from is no longer in the case.
    available:      bool
    created_at:     UTCDateTime


class AgentFindingRead(BaseModel):
    id:                  str
    case_id:             str
    agent_id:            str
    task_id:             str | None
    ref:                 int
    title:               str
    statement:           str
    severity:            str
    confidence:          str
    confidence_reason:   str
    attack_ids:          list[str]
    observations:        list[AgentObservationRead]
    state:               str
    review_task_id:      str | None
    review_verdict:      str | None
    review_comment:      str | None
    review_alternatives: str | None
    reviewed_by:         str | None
    decided_by:          str | None
    decided_at:          UTCDateTime | None
    decision_comment:    str | None
    created_at:          UTCDateTime


class Attention(BaseModel):
    """What waits on the analyst in a case's Team tab."""
    proposals: int
    findings:  int
    #: Agents stopped on a budget, a refused provider or an error.
    blocked:   list[str]

    @property
    def total(self) -> int:
        return self.proposals + self.findings + len(self.blocked)


class AskAgent(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    #: What the question is about, e.g. "Explorer row of Security.csv".
    about:    str = Field("", max_length=255)
    #: The object itself, quoted to the agent as data.
    context:  dict[str, Any] = Field(default_factory=dict)


class AskAgentResult(BaseModel):
    agent_id:   str
    agent_name: str
    task_id:    str


class RqlDraftRequest(BaseModel):
    artifact_id: str
    question:    str = Field(..., min_length=3, max_length=1000)


class RqlDraftRead(BaseModel):
    rql:         str
    explanation: str


class ProviderWrite(BaseModel):
    """Create or change a model provider. `api_key` is write-only; empty keeps the current one."""
    name:          str | None = Field(None, pattern=r"^[a-z][a-z0-9-]{1,63}$")
    kind:          str | None = Field(None, description="openai or anthropic")
    base_url:      str | None = Field(None, max_length=512)
    locality:      str | None = Field(None, description="local or cloud")
    api_key:       str | None = Field(None, max_length=4096)
    default_model: str | None = Field(None, max_length=128)
    input_price:   float | None = Field(None, ge=0)
    output_price:  float | None = Field(None, ge=0)
    enabled:       bool | None = None


class ProviderRead(BaseModel):
    id:            str
    name:          str
    kind:          str
    base_url:      str
    locality:      str
    has_key:       bool
    key_hint:      str | None
    default_model: str
    input_price:   float
    output_price:  float
    enabled:       bool
    updated_by:    str
    updated_at:    UTCDateTime


class RoleModelRead(BaseModel):
    role:     str
    provider: str
    model:    str
    #: False when the default applies: no setting, or its provider is gone.
    custom:   bool


class RoleModelWrite(BaseModel):
    provider: str = Field(..., min_length=1, max_length=64)
    model:    str = Field("", max_length=128)


class AgentUsage(BaseModel):
    agent_id:   str
    name:       str
    provider:   str
    model:      str
    tokens_in:  int
    tokens_out: int
    cost_usd:   float


class CaseUsage(BaseModel):
    agents:     list[AgentUsage]
    tokens_in:  int
    tokens_out: int
    cost_usd:   float


class TaskResume(BaseModel):
    #: What the analyst wants the agent to do differently, read before the next step.
    note: str = Field("", max_length=4000)


class HypothesisLinkRead(BaseModel):
    finding_id: str
    finding_ref: int
    stance:     str
    note:       str
    set_by:     str


class HypothesisRead(BaseModel):
    id:         str
    ref:        int
    statement:  str
    state:      str
    created_by: str
    decided_by: str | None
    links:      list[HypothesisLinkRead]
    created_at: UTCDateTime


class HypothesisWrite(BaseModel):
    statement: str | None = Field(None, min_length=10, max_length=2000)
    #: open, supported, refuted or dropped.
    state:     str | None = None


class HypothesisLinkWrite(BaseModel):
    stance: str = Field(..., description="for, against or neutral")
    note:   str = Field("", max_length=1000)


class BenchRead(BaseModel):
    id:           str
    title:        str
    description:  str
    role:         str
    expectations: list[str]


class BenchRunCreate(BaseModel):
    bench_id: str
    provider: str = "ollama"
    model:    str = Field("", max_length=128)


class BenchRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:          str
    bench_id:    str
    provider:    str
    model:       str
    status:      str
    score:       int
    total:       int
    details:     list[dict[str, Any]]
    tokens_in:   int
    tokens_out:  int
    cost_usd:    float
    model_calls: int
    error:       str | None
    started_by:  str
    started_at:  UTCDateTime
    finished_at: UTCDateTime | None

    @field_validator("details", mode="before")
    @classmethod
    def _decode(cls, value: Any) -> Any:
        return json.loads(value) if isinstance(value, str) else value


class FindingDecision(BaseModel):
    comment: str | None = Field(None, max_length=2000)


class ProposalDecision(BaseModel):
    #: Fields replacing the proposal's own, when the analyst edits before accepting.
    payload: dict[str, Any] | None = None
    comment: str | None = Field(None, max_length=2000)


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
    reports_to:  str | None = None


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
