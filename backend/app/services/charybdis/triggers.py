"""
Evidence triggers: new evidence reaches the Incident Leader without anyone
asking (`docs/CHARYBDIS_FEATURES.md`, C11).

What is watched is what agents can read - Explorer tables, analysed emails,
memory dumps, analysed binaries - not the ingestion log. Evidence reaches
those tables from the drop folder, collection imports and each page's own
upload button; only the first goes through `ingested_files`, which is why
S33, watching that log, missed a CSV uploaded straight into the Explorer.

The supervisor polls rather than every upload path calling in, so no upload
code needs to know the module exists. `agent_evidence_notices` remembers what
was announced. Only a case with an Incident Leader is watched - staffing the
team is the analyst's decision to have agents on the case - and only evidence
that arrived after the leader did.

The announcement carries the case's own context - type, description, tags -
because that is what decides what a file means: an `.eml` in a phishing case
is the starting point, in a ransomware case it may be noise.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from ...models.agent import (
    EVIDENCE_BINARY,
    EVIDENCE_CLOSURE,
    EVIDENCE_EMAIL,
    EVIDENCE_MEMORY,
    EVIDENCE_TABLE,
    TASK_KIND_LESSONS,
    TASK_KIND_TRIGGER,
    TASK_PENDING,
    AgentEvidenceNotice,
    AgentInstance,
    AgentTask,
)
from ...models.binary import BinaryFile
from ...models.case import Case
from ...models.csv_artifact import CsvArtifactFile
from ...models.email_file import EmailFile
from ...models.memory import MemoryDump
from ...models.user import User
from .definitions import LEADER_ROLE
from .delegation import create_task

#: Pieces of evidence listed in one announcement. The rest wait for the next poll.
MAX_PER_NOTICE = 40

#: Description cut handed to the leader with every announcement.
MAX_DESCRIPTION_CHARS = 1200

INSTRUCTIONS = (
    "New evidence reached the case. Read the case context below: it says what kind of "
    "incident this is and what matters. For each item, decide what it means for this "
    "investigation and which analyst should examine it, then propose the tasks with "
    "propose_task - one per item or group of related items, naming the item, what to look "
    "for given this case, and why. The suggested reader is a default from the file type; "
    "the case decides (an email in a phishing case goes to analyst-email first). Give work "
    "only to a role whose material is in the case: a network analyst needs a capture or a "
    "network log, a binary analyst an analysed binary - an attachment listed in an email is "
    "not one until it is uploaded. If an item does not serve the investigation, say so and "
    "why instead of proposing work."
)


@dataclass(frozen=True)
class Evidence:
    kind:     str
    id:       str
    name:     str
    detail:   str
    reader:   str
    received: datetime | None

    def line(self) -> str:
        return (f"- [{self.kind}] {self.name} - {self.detail} "
                f"(suggested reader: {self.reader})")


#: Columns that mark a packet list or a network log rather than a host artifact.
_NETWORK_COLUMNS = {"ip.src", "ip.dst", "frame.number", "src_ip", "dst_ip", "sourceip",
                    "destinationip", "dns.qry.name", "query"}


def _table_reader(table: CsvArtifactFile) -> str:
    name = str(table.original_name or "").lower()
    columns = {c.lower() for c in json.loads(str(table.columns or "[]"))}
    if name.endswith((".pcap", ".pcapng", ".pcap.csv")) or len(columns & _NETWORK_COLUMNS) >= 2:
        return "analyst-network"
    return "analyst-windows"


def _when(value: object) -> datetime | None:
    return value if isinstance(value, datetime) else None


def collect(db: Session, case_id: str, since: datetime | None = None) -> list[Evidence]:
    """Everything an agent can read in the case, oldest first; only what arrived after `since`."""
    tables = db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == case_id)
    emails = db.query(EmailFile).filter(EmailFile.case_id == case_id)
    dumps = db.query(MemoryDump).filter(MemoryDump.case_id == case_id)
    binaries = db.query(BinaryFile).filter(BinaryFile.case_id == case_id)
    if since is not None:
        tables = tables.filter(CsvArtifactFile.uploaded_at >= since)
        emails = emails.filter(EmailFile.uploaded_at >= since)
        dumps = dumps.filter(MemoryDump.uploaded_at >= since)
        binaries = binaries.filter(BinaryFile.uploaded_at >= since)

    found: list[Evidence] = []
    for t in tables:
        label = f"{t.ez_label}, " if t.ez_label else ""
        found.append(Evidence(EVIDENCE_TABLE, str(t.id), str(t.original_name),
                              f"Explorer table, {label}{t.row_count or 0} rows",
                              _table_reader(t), _when(t.uploaded_at)))
    for e in emails:
        subject = json.loads(str(e.analysis or "{}")).get("subject") or "no subject"
        found.append(Evidence(EVIDENCE_EMAIL, str(e.id), str(e.filename),
                              f"email, subject '{str(subject)[:120]}', {e.warning_count or 0} warning(s)",
                              "analyst-email", _when(e.uploaded_at)))
    for m in dumps:
        found.append(Evidence(EVIDENCE_MEMORY, str(m.id), str(m.filename),
                              f"{m.os_type} memory dump, analysis {m.status}",
                              "analyst-memory", _when(m.uploaded_at)))
    for b in binaries:
        found.append(Evidence(EVIDENCE_BINARY, str(b.id), str(b.filename),
                              f"{b.binary_type or 'unknown'} binary, analysis {b.status}",
                              "analyst-binary", _when(b.uploaded_at)))
    return sorted(found, key=lambda e: e.received or datetime.min)


def _evidence(db: Session, case_id: str, since: datetime) -> list[Evidence]:
    found = collect(db, case_id, since)
    announced = {(kind, source) for kind, source in
                 db.query(AgentEvidenceNotice.source_kind, AgentEvidenceNotice.source_id)
                 .filter(AgentEvidenceNotice.case_id == case_id)}
    fresh = [e for e in found if (e.kind, e.id) not in announced]
    return sorted(fresh, key=lambda e: e.received or since)[:MAX_PER_NOTICE]


LESSONS = (
    "The case was closed. Draft its lessons learned for the analyst: what worked, what was "
    "missing (data not collected, tools, access, time), what should happen earlier next time, "
    "and any detection that would have caught it sooner. Read the timeline, the findings, the "
    "incident log and the task reports first, and search_lessons for earlier cases so you do "
    "not repeat a lesson already recorded. Propose each lesson with propose_lesson: one idea "
    "each, concrete enough to act on. Then summarise them in a few lines."
)


def _closure(db: Session, case: Case, leader: AgentInstance, user: User) -> str | None:
    """Once per case, when it is closed: the leader drafts its lessons learned."""
    if getattr(case.status, "value", case.status) != "closed":
        return None
    if db.query(AgentEvidenceNotice).filter(AgentEvidenceNotice.source_kind == EVIDENCE_CLOSURE,
                                            AgentEvidenceNotice.source_id == case.id).first():
        return None
    task = create_task(db, agent=leader, objective=f"{LESSONS}\n\n{case_context(case)}",
                       kind=TASK_KIND_LESSONS, requested_by_id=str(user.id))
    db.add(AgentEvidenceNotice(case_id=case.id, source_kind=EVIDENCE_CLOSURE, source_id=case.id,
                               task_id=task.id))
    db.commit()
    return task.id


def case_context(case: Case) -> str:
    """What the case says about itself, as the leader reads it with new evidence."""
    description = str(case.description or "").strip() or "(no description)"
    if len(description) > MAX_DESCRIPTION_CHARS:
        description = description[:MAX_DESCRIPTION_CHARS] + "…"
    return (f"Case: {case.title}\n"
            f"Type: {getattr(case.case_type, 'value', case.case_type) or 'unset'}; "
            f"severity: {getattr(case.severity, 'value', case.severity) or 'unset'}; "
            f"TLP: {case.tlp or 'unlabelled'}; tags: {case.tags or 'none'}\n"
            f"Description: {description}")


def announce(db: Session) -> list[str]:
    """Tell each leader about its case's new evidence. Returns the tasks to enqueue."""
    leaders: dict[str, AgentInstance] = {}
    for agent in (db.query(AgentInstance).filter(AgentInstance.role == LEADER_ROLE)
                  .order_by(AgentInstance.created_at)):
        leaders.setdefault(agent.case_id, agent)

    woken: list[str] = []
    for case_id, leader in leaders.items():
        case = db.get(Case, case_id)
        if case is None:
            continue
        user = db.query(User).filter(User.username == leader.launched_by).first()
        if user is None or not user.is_active:
            continue
        lessons = _closure(db, case, leader, user)
        if lessons:
            woken.append(lessons)
        items = _evidence(db, case_id, leader.created_at)
        if not items:
            continue

        lines = "\n".join(item.line() for item in items)
        # One announcement waiting at a time: later evidence joins it rather
        # than queueing a second run of the leader for the same news.
        waiting = (db.query(AgentTask)
                   .filter(AgentTask.agent_id == leader.id, AgentTask.kind == TASK_KIND_TRIGGER,
                           AgentTask.status == TASK_PENDING).first())
        if waiting is not None:
            waiting.objective = f"{waiting.objective}\n{lines}"
            task = waiting
        else:
            objective = f"{INSTRUCTIONS}\n\n{case_context(case)}\n\nNew evidence:\n{lines}"
            task = create_task(db, agent=leader, objective=objective, kind=TASK_KIND_TRIGGER,
                               requested_by_id=str(user.id))
        db.add_all([AgentEvidenceNotice(case_id=case_id, source_kind=item.kind,
                                        source_id=item.id, task_id=task.id) for item in items])
        db.commit()
        woken.append(task.id)
    return woken
