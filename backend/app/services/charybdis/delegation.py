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
    EVENT_TASK,
    PROPOSAL_ACCEPTED,
    PROPOSAL_OPEN,
    TASK_KIND_ASSIGNED,
    TASK_KIND_HELP,
    TASK_KIND_MESSAGE,
    TASK_KIND_REPORT,
    TASK_OPEN,
    TASK_PENDING,
    TASK_RUNNING,
    AgentInstance,
    AgentProposal,
    AgentTask,
)
from . import events
from .definitions import LEADER_ROLE, definitions

#: A report handed to the leader is cut here. The full text stays on the
#: analyst's task, where `read_task` reaches it.
REPORT_EXCERPT_CHARS = 4000


def new_agent(db: Session, case_id: str, role_id: str, launched_by: str,
              name: str | None = None, model: str | None = None) -> AgentInstance:
    role = definitions().role(role_id)
    same = db.query(AgentInstance).filter(AgentInstance.case_id == case_id,
                                          AgentInstance.role == role.id).count()
    agent = AgentInstance(
        case_id=case_id, role=role.id,
        name=(name or "").strip() or (role.name if not same else f"{role.name} {same + 1}"),
        provider="ollama", model=(model or "").strip() or settings.charybdis_default_model,
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
