"""
Charybdis — agents working a case alongside the analyst.

Every table is prefixed `agent_` so the module can be dropped by its
downgrades alone (`docs/CHARYBDIS.md` section 1):

* `agent_instances` — an agent staffed on a case: its role, its model, its state.
* `agent_tasks`     — one unit of work given to an agent. In S30 every analyst
  message is a task; S31 adds tasks the Incident Leader creates.
* `agent_events`    — the trace. Append-only, ordered per case by `seq`, and
  chained by hash so a rewritten or deleted row is detectable
  (`services/charybdis/events.py`).
* `agent_proposals`    — what an agent wants written into the case (S31).
* `agent_observations` — one artifact row an agent relied on, re-read from the
  store when recorded, so a citation never points at a row that is not there.
* `agent_findings`     — a conclusion resting on observations, checked by a
  reviewer agent and validated or rejected by the analyst (S32).
* `agent_evidence_notices` — which pieces of evidence (tables, emails, memory
  dumps, binaries) the Incident Leader was told about, so each triggers it
  once (S34; replaces S33's `agent_ingest_notices`).

Written with `Mapped` annotations for the same reason as `models/ingest.py`:
the mypy ratchet forbids adding modules to the exemption list.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


# ─── Vocabulary ───────────────────────────────────────────────────────────────

AGENT_IDLE     = "idle"
AGENT_THINKING = "thinking"
AGENT_TOOL     = "tool"       # running a tool
AGENT_WAITING  = "waiting"    # waiting on the analyst
AGENT_BLOCKED  = "blocked"    # budget exhausted or provider unreachable
AGENT_ERROR    = "error"

AGENT_STATES = frozenset({
    AGENT_IDLE, AGENT_THINKING, AGENT_TOOL, AGENT_WAITING, AGENT_BLOCKED, AGENT_ERROR,
})

TASK_PENDING   = "pending"
TASK_RUNNING   = "running"
TASK_DONE      = "done"
TASK_FAILED    = "failed"
TASK_CANCELLED = "cancelled"

TASK_STATES = frozenset({TASK_PENDING, TASK_RUNNING, TASK_DONE, TASK_FAILED, TASK_CANCELLED})
TASK_OPEN   = frozenset({TASK_PENDING, TASK_RUNNING})

EVENT_USER_MESSAGE  = "message.user"
EVENT_AGENT_MESSAGE = "message.agent"
EVENT_THOUGHT       = "thought"
EVENT_TOOL_CALL     = "tool.call"
EVENT_TOOL_RESULT   = "tool.result"
EVENT_STATUS        = "status"
EVENT_ERROR         = "error"
EVENT_STEP          = "step"          # a process step entered or completed
EVENT_TASK          = "task"          # a task created, assigned, reported
EVENT_PROPOSAL      = "proposal"      # a proposal made or decided
EVENT_FINDING       = "finding"       # a finding proposed, reviewed or decided

EVENT_KINDS = frozenset({
    EVENT_USER_MESSAGE, EVENT_AGENT_MESSAGE, EVENT_THOUGHT, EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT, EVENT_STATUS, EVENT_ERROR, EVENT_STEP, EVENT_TASK, EVENT_PROPOSAL,
    EVENT_FINDING,
})

#: Why a task exists. `message` is the analyst talking to an agent; `assigned`
#: is work the analyst approved from a leader's proposal; `report` and `help`
#: are what lands on the leader's desk when an analyst finishes or asks;
#: `review` is a reviewer checking one finding; `trigger` tells the leader
#: that new evidence reached the case.
TASK_KIND_MESSAGE  = "message"
TASK_KIND_ASSIGNED = "assigned"
TASK_KIND_REPORT   = "report"
TASK_KIND_HELP     = "help"
TASK_KIND_REVIEW   = "review"
TASK_KIND_TRIGGER  = "trigger"

PROPOSAL_IOC               = "ioc"
PROPOSAL_TIMELINE          = "timeline_event"
PROPOSAL_TASK              = "task"
PROPOSAL_TTP               = "ttp"
PROPOSAL_REPORT_SECTION    = "report_section"
PROPOSAL_EXECUTIVE_SUMMARY = "executive_summary"
PROPOSAL_INCIDENT_LOG      = "incident_log"
PROPOSAL_KINDS = frozenset({
    PROPOSAL_IOC, PROPOSAL_TIMELINE, PROPOSAL_TASK, PROPOSAL_TTP,
    PROPOSAL_REPORT_SECTION, PROPOSAL_EXECUTIVE_SUMMARY, PROPOSAL_INCIDENT_LOG,
})

PROPOSAL_OPEN     = "proposed"
PROPOSAL_ACCEPTED = "accepted"
PROPOSAL_REJECTED = "rejected"

#: A finding goes to the reviewer first when the case has one, then to the
#: analyst, who alone validates it. Only validated findings reach the report.
FINDING_IN_REVIEW = "in_review"
FINDING_PROPOSED  = "proposed"
FINDING_VALIDATED = "validated"
FINDING_REJECTED  = "rejected"
FINDING_OPEN      = frozenset({FINDING_IN_REVIEW, FINDING_PROPOSED})

VERDICT_SUPPORTED   = "supported"
VERDICT_UNSUPPORTED = "unsupported"

#: Where an observation's row comes from. `artifact` is an Explorer table and
#: opens there; the others are module pages whose content is not a table.
SOURCE_ARTIFACT = "artifact"
SOURCE_MEMORY   = "memory"
SOURCE_EMAIL    = "email"
SOURCE_BINARY   = "binary"
SOURCE_KINDS    = frozenset({SOURCE_ARTIFACT, SOURCE_MEMORY, SOURCE_EMAIL, SOURCE_BINARY})


class AgentInstance(Base):
    """An agent staffed on one case."""

    __tablename__ = "agent_instances"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)

    #: Role id from `templates/agents/roles/`. S30 ships one, `assistant`.
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model:    Mapped[str] = mapped_column(String(128), nullable=False)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default=AGENT_IDLE)

    #: Who staffed it. Agents act on behalf of a person, never on their own
    #: authority (`docs/CHARYBDIS.md` section 3).
    launched_by: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    #: Incident Leader only: the tasks it proposes start without waiting for
    #: the analyst. Off by default, set per case by the analyst. Findings,
    #: indicators and every other proposal still wait for a decision.
    auto_start: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class AgentTask(Base):
    """One unit of work given to an agent."""

    __tablename__ = "agent_tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False, index=True)

    objective: Mapped[str] = mapped_column(Text, nullable=False)
    status:    Mapped[str] = mapped_column(String(16), nullable=False, default=TASK_PENDING)

    #: The user the agent acts for. Their permissions and client scope are
    #: re-read on every run, so revoking an account stops its agents too.
    requested_by_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    max_steps:  Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    steps_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_in:  Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: What the task's model calls cost, in US dollars, at the provider's
    #: prices when each call was made. Zero for a local model.
    cost_usd:   Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=TASK_KIND_MESSAGE)
    #: Process followed (`templates/agents/processes/`) and where it is in it.
    process_id:   Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_step: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: The task this one was spawned from: a leader review points at the
    #: analyst task it reviews, a delegated task at the leader task that
    #: proposed it.
    parent_task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_tasks_parent_task_id"), nullable=True)
    #: JSON list of task ids that must be done before this one starts.
    depends_on: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    #: What the agent handed back when the task ended.
    report: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at:  Mapped[datetime]        = mapped_column(default=_now)
    started_at:  Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_agent_tasks_case_status", "case_id", "status"),
    )


class AgentEvent(Base):
    """
    One line of the trace. Never updated, never deleted except with its case.

    `seq` orders events within a case and is what a client resumes from after
    a reconnect. `hash` covers this row's content and the previous row's hash,
    so the chain breaks at the first row anyone edits.
    """

    __tablename__ = "agent_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=True, index=True)
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="CASCADE"), nullable=True, index=True)

    seq:     Mapped[int] = mapped_column(Integer, nullable=False)
    kind:    Mapped[str] = mapped_column(String(32), nullable=False)
    #: JSON object. Its shape depends on `kind`; see `services/charybdis/events.py`.
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    actor:   Mapped[str] = mapped_column(String(255), nullable=False, default="")

    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    hash:      Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(default=_now)

    __table_args__ = (
        Index("ix_agent_events_case_seq", "case_id", "seq", unique=True),
    )


class AgentProposal(Base):
    """
    Something an agent wants written into the case, waiting on the analyst.

    Agents never write Remora objects (`docs/CHARYBDIS.md` principle P1).
    Accepting a proposal calls the same handler the interface calls, so the
    object it creates is indistinguishable from a hand-made one and is audited
    as the analyst's action. `result_id` points at what was created.
    """

    __tablename__ = "agent_proposals"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_proposals_task_id"), nullable=True)

    kind:      Mapped[str] = mapped_column(String(32), nullable=False)
    #: JSON object shaped like the create request of the target kind.
    payload:   Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: JSON list of citations: artifact, row, values the agent relied on.
    evidence:  Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    state:            Mapped[str]             = mapped_column(String(16), nullable=False, default=PROPOSAL_OPEN)
    decided_by:       Mapped[str | None]      = mapped_column(String(255), nullable=True)
    decided_at:       Mapped[datetime | None] = mapped_column(nullable=True)
    decision_comment: Mapped[str | None]      = mapped_column(Text, nullable=True)
    result_id:        Mapped[str | None]      = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=_now)

    __table_args__ = (
        Index("ix_agent_proposals_case_state", "case_id", "state"),
    )


class AgentObservation(Base):
    """
    One artifact row an agent relied on, as it was when the agent read it.

    `locator` is the RQL that selects exactly this row; `row` is the row
    itself. The locator is what opens the row in the Explorer; the copy is
    what the citation still says if the table is later removed.
    """

    __tablename__ = "agent_observations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_observations_task_id"), nullable=True)

    #: What `artifact_id` names: an Explorer table, or a memory dump, an
    #: email or a binary, whose pages are not tables.
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False, default=SOURCE_ARTIFACT)
    #: Not a foreign key: deleting a table from the Explorer must not take the
    #: citations that relied on it along with it.
    artifact_id:    Mapped[str]        = mapped_column(String, nullable=False)
    artifact_name:  Mapped[str]        = mapped_column(String(255), nullable=False, default="")
    artifact_label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locator: Mapped[str] = mapped_column(Text, nullable=False)
    #: JSON object, column to value.
    row:     Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    note:    Mapped[str] = mapped_column(Text, nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(default=_now)


class AgentFinding(Base):
    """
    A conclusion an agent drew, resting on observations.

    `ref` numbers findings within a case (F1, F2...) so that report text can
    cite them in a form a small model writes reliably.
    """

    __tablename__ = "agent_findings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_instances.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_findings_task_id"), nullable=True)
    ref: Mapped[int] = mapped_column(Integer, nullable=False)

    title:      Mapped[str] = mapped_column(String(255), nullable=False)
    statement:  Mapped[str] = mapped_column(Text, nullable=False)
    severity:   Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    #: JSON lists: ATT&CK technique ids, and the observations it rests on.
    attack_ids:      Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    observation_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    state: Mapped[str] = mapped_column(String(16), nullable=False, default=FINDING_PROPOSED)

    review_task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_findings_review_task_id"), nullable=True)
    review_verdict: Mapped[str | None] = mapped_column(String(16), nullable=True)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Other explanations of the same evidence the reviewer weighed.
    review_alternatives: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)

    decided_by:       Mapped[str | None]      = mapped_column(String(255), nullable=True)
    decided_at:       Mapped[datetime | None] = mapped_column(nullable=True)
    decision_comment: Mapped[str | None]      = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=_now)

    __table_args__ = (
        Index("ix_agent_findings_case_state", "case_id", "state"),
        Index("ix_agent_findings_case_ref", "case_id", "ref", unique=True),
    )


#: Kinds of evidence the leader is told about: what agents can actually read.
EVIDENCE_TABLE  = "table"
EVIDENCE_EMAIL  = "email"
EVIDENCE_MEMORY = "memory"
EVIDENCE_BINARY = "binary"


class AgentEvidenceNotice(Base):
    """
    A piece of evidence the Incident Leader was told about, and the task that
    told it. One row per piece: announced once, whatever happens to the task.
    """

    __tablename__ = "agent_evidence_notices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    #: table, email, memory or binary; `source_id` is that row's id.
    source_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id:   Mapped[str] = mapped_column(String, nullable=False)
    task_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_tasks.id", ondelete="SET NULL",
                           name="fk_agent_evidence_notices_task_id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)

    __table_args__ = (
        UniqueConstraint("source_kind", "source_id", name="uq_agent_evidence_notices_source"),
    )


#: The provider that is always there and needs no configuration.
PROVIDER_OLLAMA = "ollama"

#: Wire protocols a configured provider can speak.
PROVIDER_KIND_OPENAI    = "openai"      # OpenAI and OpenAI-compatible (vLLM, LM Studio, Mistral...)
PROVIDER_KIND_ANTHROPIC = "anthropic"
PROVIDER_KINDS = frozenset({PROVIDER_KIND_OPENAI, PROVIDER_KIND_ANTHROPIC})


class AgentProvider(Base):
    """
    A model provider an administrator configured, beside the built-in Ollama.

    `locality` is declared, not guessed: an OpenAI-compatible server on the
    analyst's own machine is local, the same protocol at a vendor is cloud,
    and the TLP policy is decided on it alone. The API key is encrypted at
    rest with a per-row salt, like MFA secrets, and never returned.
    """

    __tablename__ = "agent_providers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    #: What agents and settings refer to it by: a slug, e.g. "anthropic".
    name:     Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    kind:     Mapped[str] = mapped_column(String(16), nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    locality: Mapped[str] = mapped_column(String(8), nullable=False, default="cloud")
    api_key_enc:  Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_salt: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Last characters of the key, shown so an administrator can tell keys apart.
    api_key_hint: Mapped[str | None] = mapped_column(String(8), nullable=True)
    default_model: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    #: US dollars per million tokens, for the cost shown per agent and case.
    input_price:  Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    output_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    updated_by: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class AgentRoleModel(Base):
    """The provider and model an agent of a role gets when it is staffed."""

    __tablename__ = "agent_role_models"

    role:     Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model:    Mapped[str] = mapped_column(String(128), nullable=False)
    updated_by: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)
