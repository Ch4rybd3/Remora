"""
Ingestion triggers: new evidence reaches the Incident Leader without anyone
asking (`docs/CHARYBDIS_FEATURES.md`, C11).

The supervisor polls rather than the ingestion pipeline calling in: files
reach a final state from the drop folder, collection imports, uploads and
retries, and a poll catches all of them without the pipeline knowing the
module exists. `agent_ingest_notices` remembers what was announced.

Only a case with an Incident Leader is watched - staffing the team is the
analyst's decision to have agents on the case - and only files that arrived
after the leader did: staffing a team on a finished collection does not
start with a list of three hundred files.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ...models.agent import (
    TASK_KIND_TRIGGER,
    TASK_PENDING,
    AgentIngestNotice,
    AgentInstance,
    AgentTask,
)
from ...models.ingest import STATE_BROWSABLE, STATE_INDEXED, STATE_PARSED, IngestedFile
from ...models.user import User
from .definitions import LEADER_ROLE
from .delegation import create_task

#: States after which a file is worth a look: queryable, browsable on its
#: page, or handed to its module (a memory dump while Volatility runs).
ANNOUNCED_STATES = (STATE_INDEXED, STATE_BROWSABLE, STATE_PARSED)

#: Files listed in one announcement. The rest wait for the next poll.
MAX_FILES_PER_NOTICE = 40

HEADER = ("New evidence reached the case. Decide which of it needs an analyst, and propose "
          "the tasks; do not propose work on files that duplicate what is already planned.\n\n"
          "New files:\n")


def _line(f: IngestedFile) -> str:
    return f"- {f.original_name} ({f.detected_kind or 'unknown kind'}, {f.state})"


def announce(db: Session) -> list[str]:
    """Tell each leader about its case's new files. Returns the tasks to enqueue."""
    leaders: dict[str, AgentInstance] = {}
    for agent in (db.query(AgentInstance).filter(AgentInstance.role == LEADER_ROLE)
                  .order_by(AgentInstance.created_at)):
        leaders.setdefault(agent.case_id, agent)

    woken: list[str] = []
    for case_id, leader in leaders.items():
        announced = db.query(AgentIngestNotice.ingested_file_id).filter(
            AgentIngestNotice.case_id == case_id)
        files = (db.query(IngestedFile)
                 .filter(IngestedFile.case_id == case_id,
                         IngestedFile.state.in_(ANNOUNCED_STATES),
                         IngestedFile.created_at >= leader.created_at,
                         IngestedFile.id.not_in(announced))
                 .order_by(IngestedFile.created_at).limit(MAX_FILES_PER_NOTICE).all())
        if not files:
            continue
        user = db.query(User).filter(User.username == leader.launched_by).first()
        if user is None or not user.is_active:
            continue

        lines = "\n".join(_line(f) for f in files)
        # One announcement waiting at a time: later files join it rather than
        # queueing a second run of the leader for the same news.
        waiting = (db.query(AgentTask)
                   .filter(AgentTask.agent_id == leader.id, AgentTask.kind == TASK_KIND_TRIGGER,
                           AgentTask.status == TASK_PENDING).first())
        if waiting is not None:
            waiting.objective = f"{waiting.objective}\n{lines}"
            task = waiting
        else:
            task = create_task(db, agent=leader, objective=HEADER + lines, kind=TASK_KIND_TRIGGER,
                               requested_by_id=str(user.id))
        db.add_all([AgentIngestNotice(case_id=case_id, ingested_file_id=f.id, task_id=task.id)
                    for f in files])
        db.commit()
        woken.append(task.id)
    return woken
