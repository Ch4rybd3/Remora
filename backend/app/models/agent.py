"""
Charybdis — agents working a case alongside the analyst.

Three tables, all prefixed `agent_` so the module can be dropped by one
downgrade (`docs/CHARYBDIS.md` section 1):

* `agent_instances` — an agent staffed on a case: its role, its model, its state.
* `agent_tasks`     — one unit of work given to an agent. In S30 every analyst
  message is a task; S31 adds tasks the Incident Leader creates.
* `agent_events`    — the trace. Append-only, ordered per case by `seq`, and
  chained by hash so a rewritten or deleted row is detectable
  (`services/charybdis/events.py`).

Written with `Mapped` annotations for the same reason as `models/ingest.py`:
the mypy ratchet forbids adding modules to the exemption list.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text
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

EVENT_KINDS = frozenset({
    EVENT_USER_MESSAGE, EVENT_AGENT_MESSAGE, EVENT_THOUGHT, EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT, EVENT_STATUS, EVENT_ERROR, EVENT_STEP, EVENT_TASK, EVENT_PROPOSAL,
})

#: Why a task exists. `message` is the analyst talking to an agent; `assigned`
#: is work the analyst approved from a leader's proposal; `report` and `help`
#: are what lands on the leader's desk when an analyst finishes or asks.
TASK_KIND_MESSAGE  = "message"
TASK_KIND_ASSIGNED = "assigned"
TASK_KIND_REPORT   = "report"
TASK_KIND_HELP     = "help"

PROPOSAL_IOC      = "ioc"
PROPOSAL_TIMELINE = "timeline_event"
PROPOSAL_TASK     = "task"
PROPOSAL_KINDS    = frozenset({PROPOSAL_IOC, PROPOSAL_TIMELINE, PROPOSAL_TASK})

PROPOSAL_OPEN     = "proposed"
PROPOSAL_ACCEPTED = "accepted"
PROPOSAL_REJECTED = "rejected"


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
