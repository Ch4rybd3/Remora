"""
How work moves between agents.

Hub and spoke through the Incident Leader (`docs/CHARYBDIS.md` section 5.5):
the leader proposes tasks, the analyst approves them, an agent of the right
role picks them up, and what it reports lands back on the leader's desk. An
analyst who needs help asks the leader, never another analyst directly, so
two agents cannot hand work back and forth without anyone seeing it.

Nothing here talks to a model or to the event loop. Callers enqueue the task
ids this module returns.
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...config import settings
from ...models.agent import (
    EVENT_FINDING,
    EVENT_PROPOSAL,
    EVENT_TASK,
    FINDING_IN_REVIEW,
    FINDING_PROPOSED,
    PROPOSAL_ACCEPTED,
    PROPOSAL_OPEN,
    TASK_KIND_ASSIGNED,
    TASK_KIND_HELP,
    TASK_KIND_MESSAGE,
    TASK_KIND_REPORT,
    TASK_KIND_REVIEW,
    TASK_OPEN,
    TASK_PENDING,
    TASK_RUNNING,
    AgentFinding,
    AgentInstance,
    AgentProposal,
    AgentTask,
)
from . import events
from .definitions import LEADER_ROLE, REVIEWER_ROLE, definitions

#: A report handed to the leader is cut here. The full text stays on the
#: analyst's task, where `read_task` reaches it.
REPORT_EXCERPT_CHARS = 4000


def role_model(db: Session, role_id: str) -> tuple[str, str]:
    """
    The provider and model a role is staffed with: the administrator's setting
    for the role if its provider is still enabled, else the local default.
    """
    from ...models.agent import PROVIDER_OLLAMA, AgentProvider, AgentRoleModel

    chosen = db.get(AgentRoleModel, role_id)
    if chosen is not None:
        if chosen.provider == PROVIDER_OLLAMA:
            return chosen.provider, chosen.model
        provider = db.query(AgentProvider).filter(AgentProvider.name == chosen.provider,
                                                  AgentProvider.enabled.is_(True)).first()
        if provider is not None:
            return chosen.provider, chosen.model or provider.default_model
    return PROVIDER_OLLAMA, settings.charybdis_default_model


def new_agent(db: Session, case_id: str, role_id: str, launched_by: str,
              name: str | None = None, model: str | None = None,
              provider: str | None = None) -> AgentInstance:
    role = definitions().role(role_id)
    same = db.query(AgentInstance).filter(AgentInstance.case_id == case_id,
                                          AgentInstance.role == role.id).count()
    default_provider, default_model = role_model(db, role.id)
    chosen_provider = (provider or "").strip() or default_provider
    agent = AgentInstance(
        case_id=case_id, role=role.id,
        name=(name or "").strip() or (role.name if not same else f"{role.name} {same + 1}"),
        provider=chosen_provider,
        model=(model or "").strip() or (default_model if chosen_provider == default_provider
                                        else _provider_default_model(db, chosen_provider)),
        launched_by=launched_by,
    )
    db.add(agent)
    db.flush()
    return agent


def leader_of(db: Session, case_id: str) -> AgentInstance | None:
    return (db.query(AgentInstance)
            .filter(AgentInstance.case_id == case_id, AgentInstance.role == LEADER_ROLE)
            .order_by(AgentInstance.created_at).first())


def agent_for_role(db: Session, case_id: str, role_id: str, launched_by: str) -> AgentInstance:
    """The least busy agent of a role on the case, staffing one if there is none."""
    candidates = (db.query(AgentInstance)
                  .filter(AgentInstance.case_id == case_id, AgentInstance.role == role_id)
                  .order_by(AgentInstance.created_at).all())
    if not candidates:
        return new_agent(db, case_id, role_id, launched_by)

    def load(agent: AgentInstance) -> int:
        return (db.query(AgentTask)
                .filter(AgentTask.agent_id == agent.id, AgentTask.status.in_(TASK_OPEN))
                .count())
    return min(candidates, key=load)


def create_task(
    db: Session, *, agent: AgentInstance, objective: str, kind: str, requested_by_id: str,
    parent_task_id: str | None = None, depends_on: list[str] | None = None,
) -> AgentTask:
    """Write a task and its trace event, and commit. The caller enqueues it."""
    role = definitions().role(agent.role)
    process = definitions().process_for(role, assigned=kind != TASK_KIND_MESSAGE)
    task = AgentTask(
        case_id=agent.case_id, agent_id=agent.id, objective=objective.strip(), kind=kind,
        requested_by_id=requested_by_id,
        max_steps=min(role.max_steps, settings.charybdis_max_steps),
        process_id=process.id, current_step=process.steps[0].id,
        parent_task_id=parent_task_id, depends_on=json.dumps(depends_on or []),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    if kind == TASK_KIND_MESSAGE:
        # The analyst's message is the trace entry for it; a second line
        # saying "a task was created" would only repeat it.
        return task
    events.record(db, case_id=task.case_id, agent_id=agent.id, task_id=task.id, kind=EVENT_TASK,
                  payload={"action": "created", "task_kind": kind, "objective": task.objective,
                           "process": process.id, "agent": agent.name,
                           "parent_task_id": parent_task_id,
                           "depends_on": depends_on or []},
                  actor=agent.name)
    return task


def dependencies_met(db: Session, task: AgentTask) -> bool:
    """
    Whether everything this task waits for is finished.

    A dependency is a task id or a task proposal id. An open proposal blocks;
    a rejected one is dropped - the analyst decided that work will not happen,
    and waiting for it would block forever. A task that failed or was cancelled
    also releases its dependents: they run and can say what is missing.
    """
    for ref in json.loads(task.depends_on or "[]"):
        dependency = db.get(AgentTask, ref)
        if dependency is None:
            proposal = db.get(AgentProposal, ref)
            if proposal is None:
                continue
            if proposal.state == PROPOSAL_OPEN:
                return False
            if proposal.state != PROPOSAL_ACCEPTED or not proposal.result_id:
                continue
            dependency = db.get(AgentTask, proposal.result_id)
            if dependency is None:
                continue
        if dependency.status in TASK_OPEN:
            return False
    return True


def agent_is_busy(db: Session, task: AgentTask) -> bool:
    """Another task of the same agent is already running. One at a time per agent."""
    return db.query(AgentTask).filter(
        AgentTask.agent_id == task.agent_id, AgentTask.id != task.id,
        AgentTask.status == TASK_RUNNING).first() is not None


def waiting_tasks(db: Session, case_id: str) -> list[str]:
    """Pending tasks of a case, oldest first. Enqueued again whenever something finishes."""
    return [task_id for (task_id,) in
            db.query(AgentTask.id)
            .filter(AgentTask.case_id == case_id, AgentTask.status == TASK_PENDING)
            .order_by(AgentTask.created_at)]


def report_to_leader(db: Session, task: AgentTask) -> AgentTask | None:
    """Put an assigned task's report on the leader's desk. None if there is no leader."""
    if task.kind != TASK_KIND_ASSIGNED:
        return None
    leader = leader_of(db, task.case_id)
    agent = db.get(AgentInstance, task.agent_id)
    if leader is None or agent is None or leader.id == agent.id:
        return None
    report = (task.report or task.error or "No report.")[:REPORT_EXCERPT_CHARS]
    objective = (f"Report from {agent.name} ({agent.role}) on task {task.id} - "
                 f"status {task.status}.\nObjective was: {task.objective}\n\nReport:\n{report}")
    return create_task(db, agent=leader, objective=objective, kind=TASK_KIND_REPORT,
                       requested_by_id=task.requested_by_id, parent_task_id=task.id)


def ask_leader_for_help(db: Session, task: AgentTask, need: str) -> AgentTask | None:
    leader = leader_of(db, task.case_id)
    agent = db.get(AgentInstance, task.agent_id)
    if leader is None or agent is None or leader.id == agent.id:
        return None
    objective = (f"Request for help from {agent.name} ({agent.role}), working on task "
                 f"{task.id}: {task.objective}\n\nWhat they need:\n{need}")
    return create_task(db, agent=leader, objective=objective, kind=TASK_KIND_HELP,
                       requested_by_id=task.requested_by_id, parent_task_id=task.id)


def request_review(db: Session, finding: AgentFinding) -> AgentTask | None:
    """
    Hand a new finding to the case's reviewer. None if the case has none, in
    which case the finding goes straight to the analyst.

    Never staffed on demand: a second opinion the analyst did not ask for
    would cost a model run per finding on hardware that has one GPU.
    """
    reviewer = (db.query(AgentInstance)
                .filter(AgentInstance.case_id == finding.case_id,
                        AgentInstance.role == REVIEWER_ROLE,
                        AgentInstance.id != finding.agent_id)
                .order_by(AgentInstance.created_at).first())
    author_task = db.get(AgentTask, finding.task_id) if finding.task_id else None
    if reviewer is None or author_task is None:
        return None
    objective = (f"Review finding F{finding.ref} ({finding.id}): {finding.title}\n\n"
                 f"Claim:\n{finding.statement}")
    task = create_task(db, agent=reviewer, objective=objective, kind=TASK_KIND_REVIEW,
                       requested_by_id=author_task.requested_by_id, parent_task_id=author_task.id)
    finding.state = FINDING_IN_REVIEW
    finding.review_task_id = task.id
    db.commit()
    return task


def close_review(db: Session, task: AgentTask) -> None:
    """
    A review task that ended without a verdict still hands the finding on.
    A finding stuck in review would never reach the analyst.
    """
    if task.kind != TASK_KIND_REVIEW:
        return
    stuck = (db.query(AgentFinding)
             .filter(AgentFinding.review_task_id == task.id,
                     AgentFinding.state == FINDING_IN_REVIEW).all())
    for finding in stuck:
        finding.state = FINDING_PROPOSED
        finding.review_comment = f"The reviewer ended without a verdict ({task.status})."
    db.commit()
    for finding in stuck:
        events.record(db, case_id=finding.case_id, agent_id=finding.agent_id, task_id=task.id,
                      kind=EVENT_FINDING,
                      payload={"action": "review_missing", "finding_id": finding.id,
                               "summary": f"F{finding.ref} {finding.title}"})


def task_from_proposal(db: Session, proposal: AgentProposal, objective: str, role: str,
                       depends_on: list[str], requested_by_id: str,
                       launched_by: str) -> AgentTask:
    """The task an accepted task proposal becomes, on the least busy agent of its role."""
    target = agent_for_role(db, proposal.case_id, role, launched_by)
    return create_task(db, agent=target, objective=objective, kind=TASK_KIND_ASSIGNED,
                       requested_by_id=requested_by_id, parent_task_id=proposal.task_id,
                       depends_on=depends_on)


#: Tasks one leader run may start on its own. More wait for the analyst: a
#: leader reviewing reports can otherwise chain follow-ups without end.
MAX_AUTO_STARTS_PER_RUN = 3


def _has_material(db: Session, case_id: str, role: str) -> bool:
    """Whether the case holds anything the role can read."""
    from ...models.agent import FINDING_VALIDATED, AgentFinding
    from ...models.timeline import TimelineEvent
    from .triggers import collect

    evidence = collect(db, case_id)
    readers = {e.reader for e in evidence}
    kinds = {e.kind for e in evidence}
    if role == "analyst-timeline":
        return "table" in kinds or db.query(TimelineEvent).filter(
            TimelineEvent.case_id == case_id).first() is not None
    if role == "analyst-windows":
        return "table" in kinds
    if role == "reporter":
        return db.query(AgentFinding).filter(AgentFinding.case_id == case_id,
                                             AgentFinding.state == FINDING_VALIDATED).first() is not None
    if role == "scribe":
        return True
    return role in readers


def auto_start_refusal(db: Session, proposal: AgentProposal) -> str | None:
    """Why a proposed task should wait for the analyst despite auto-start. None: start it."""
    data = json.loads(proposal.payload or "{}")
    role = str(data.get("role", ""))
    if not _has_material(db, proposal.case_id, role):
        return f"the case holds nothing {role} can read yet"
    started = (db.query(AgentProposal)
               .filter(AgentProposal.case_id == proposal.case_id,
                       AgentProposal.task_id == proposal.task_id,
                       AgentProposal.decided_by.like("%(auto-start)")).count())
    if started >= MAX_AUTO_STARTS_PER_RUN:
        return f"this run already started {started} tasks on its own"
    return None


def auto_start(db: Session, proposal: AgentProposal) -> tuple[AgentTask | None, str | None]:
    """
    Start a task the leader proposed, without waiting, when the analyst turned
    auto-start on for this case's leader. Returns the task, or why it waits:
    no reason when auto-start is off, one when a guard held it back.

    Only tasks: they read the case and propose, nothing they do reaches the
    case without a decision. The proposal is recorded as accepted by the
    leader on the analyst's standing instruction, and audited under the
    analyst who staffed it.
    """
    from datetime import UTC, datetime

    from ...models.user import User
    from ..audit_service import audit_log

    leader = db.get(AgentInstance, proposal.agent_id)
    if leader is None or leader.role != LEADER_ROLE or not leader.auto_start:
        return None, None
    user = db.query(User).filter(User.username == leader.launched_by).first()
    if user is None or not user.is_active:
        return None, "the account that staffed the leader is no longer active"
    refusal = auto_start_refusal(db, proposal)
    if refusal:
        return None, refusal
    data = json.loads(proposal.payload or "{}")
    task = task_from_proposal(db, proposal, str(data.get("objective", "")), str(data.get("role", "")),
                              [str(d) for d in data.get("depends_on") or []], str(user.id),
                              str(leader.launched_by))
    proposal.state = PROPOSAL_ACCEPTED
    proposal.decided_by = f"{leader.name} (auto-start)"
    proposal.decided_at = datetime.now(UTC).replace(tzinfo=None)
    proposal.result_id = task.id
    audit_log(db, user=user, action="agent.proposal_auto_start", resource_type="agent_proposal",
              resource_id=proposal.id, resource_name=f"{data.get('role')}: {str(data.get('objective', ''))[:120]}",
              case_id=proposal.case_id, details={"task_id": task.id, "role": data.get("role")})
    db.commit()
    events.record(db, case_id=proposal.case_id, agent_id=proposal.agent_id, task_id=proposal.task_id,
                  kind=EVENT_PROPOSAL,
                  payload={"action": "accepted", "proposal_id": proposal.id, "proposal_kind": "task",
                           "summary": f"{data.get('role')}: {str(data.get('objective', ''))[:120]}",
                           "comment": "Started without approval: auto-start is on for this case.",
                           "result_id": task.id},
                  actor=leader.name)
    return task, None


def _provider_default_model(db: Session, name: str) -> str:
    from ...models.agent import AgentProvider

    row = db.query(AgentProvider).filter(AgentProvider.name == name).first()
    return (row.default_model if row and row.default_model else settings.charybdis_default_model)
