"""
What an agent can do, as typed adapters over Remora services.

An agent never gets a shell, a path or SQL. Each tool takes arguments that a
Pydantic model validates, reaches data through the same service the
interface uses, and returns a bounded JSON object. Tools read Remora data;
the only writes are proposals and tasks, which live in the module's own
tables and reach the case only when the analyst accepts them.

The registry here is the single source of the tool vocabulary: the runner
offers it to the model, the API lists it, and `docs/CHARYBDIS.md` is checked
against it (`test_charybdis_tools.py`).
"""
from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from ...core.permissions import PERM_ARTIFACTS, PERM_WRITE
from ...models.agent import (
    EVENT_PROPOSAL,
    PROPOSAL_IOC,
    PROPOSAL_OPEN,
    PROPOSAL_TASK,
    PROPOSAL_TIMELINE,
    AgentInstance,
    AgentProposal,
    AgentTask,
)
from ...models.asset import Asset
from ...models.case import Case
from ...models.chainsaw import ChainsawAlert
from ...models.client import Client
from ...models.csv_artifact import CsvArtifactFile
from ...models.incident_log import IncidentLogEntry
from ...models.ingest import IngestedFile
from ...models.ioc import IOC, IOCConfidence, IOCType
from ...models.mitre import CaseTTP
from ...models.timeline import TimelineEvent
from ..store import Query, Source, SourceMissing, get_store
from .llm import ToolSpec

#: Creating proposals and tasks for the analyst to decide on. Not a Remora
#: permission: it never writes a Remora object.
PERM_PROPOSE = "propose"

#: What an agent may ever hold, whoever launched it (`docs/CHARYBDIS.md`
#: section 3). Never more than its analyst: see `agent_grants`.
AGENT_PERMISSIONS = frozenset({PERM_ARTIFACTS, PERM_PROPOSE})
PROPOSING = frozenset({PERM_ARTIFACTS, PERM_PROPOSE})


def agent_grants(user_grants: frozenset[str]) -> frozenset[str]:
    """
    An agent's grants, from the grants of the user it acts for.

    Reading artifacts needs the user to read them. Proposing needs the user to
    be able to write, because a proposal asks them to - a read-only account
    has nothing to approve with.
    """
    granted = set()
    if PERM_ARTIFACTS in user_grants:
        granted.add(PERM_ARTIFACTS)
    if PERM_WRITE in user_grants:
        granted.add(PERM_PROPOSE)
    return frozenset(granted) & AGENT_PERMISSIONS

#: Upper bound on one tool result as handed to the model. Larger results are
#: cut row by row, and the result says so, so the model knows to narrow.
MAX_RESULT_CHARS = 12_000
#: A single cell longer than this is cut. Command lines and script blocks
#: would otherwise fill the context with one row.
MAX_CELL_CHARS = 240


class ToolError(Exception):
    """A failure the model should read and can act on: a bad id, bad RQL."""


@dataclass(frozen=True)
class ToolContext:
    db:       Session
    case:     Case
    grants:   frozenset[str]
    #: The agent and task calling. Tools that propose or delegate need them.
    agent_id: str | None = None
    task_id:  str | None = None
    actor:    str = ""


@dataclass(frozen=True)
class Tool:
    name:        str
    description: str
    params:      type[BaseModel]
    run:         Callable[[ToolContext, Any], dict[str, Any]]
    requires:    frozenset[str] = AGENT_PERMISSIONS

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, _clean_schema(self.params.model_json_schema()))


def _clean_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Drop Pydantic's `title` keys: tokens the model pays for and never uses."""
    cleaned = {k: v for k, v in schema.items() if k != "title"}
    if "properties" in cleaned:
        cleaned["properties"] = {
            name: {k: v for k, v in prop.items() if k != "title"}
            for name, prop in cleaned["properties"].items()
        }
    return cleaned


def _cell(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[:MAX_CELL_CHARS] + "…"
    return value


def fit(result: dict[str, Any], rows_key: str = "rows") -> dict[str, Any]:
    """Cut `result[rows_key]` until the JSON fits, and record that it was cut."""
    rows = result.get(rows_key)
    if not isinstance(rows, list):
        return result
    while rows and len(json.dumps(result, default=str)) > MAX_RESULT_CHARS:
        rows = rows[: max(len(rows) // 2, len(rows) - 5)] if len(rows) > 1 else []
        result = {**result, rows_key: rows, "truncated": True}
    return result


# ─── case_overview ────────────────────────────────────────────────────────────

class NoArgs(BaseModel):
    pass


def _case_overview(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    case, db = ctx.case, ctx.db
    client = db.get(Client, case.client_id) if case.client_id else None
    states = Counter(state for (state,) in
                     db.query(IngestedFile.state).filter(IngestedFile.case_id == case.id))
    kinds = Counter(kind or "unknown" for (kind,) in
                    db.query(IngestedFile.detected_kind).filter(IngestedFile.case_id == case.id))
    return {
        "title":       case.title,
        "description": _cell(case.description or ""),
        "status":      getattr(case.status, "value", case.status),
        "severity":    getattr(case.severity, "value", case.severity),
        "tlp":         case.tlp,
        "case_type":   getattr(case.case_type, "value", case.case_type),
        "client":      client.name if client else (case.client_name or ""),
        "counts": {
            "iocs":            db.query(IOC).filter(IOC.case_id == case.id).count(),
            "assets":          db.query(Asset).filter(Asset.case_id == case.id).count(),
            "timeline_events": db.query(TimelineEvent).filter(TimelineEvent.case_id == case.id).count(),
            "artifacts":       db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == case.id).count(),
        },
        "ingested_files_by_state": dict(states),
        "ingested_files_by_kind":  dict(kinds),
    }


# ─── ingest_status ────────────────────────────────────────────────────────────

class IngestStatusArgs(BaseModel):
    state: str | None = Field(None, description="Only files in this state, e.g. indexed, failed")
    kind:  str | None = Field(None, description="Only files of this detected kind, e.g. evtx")
    limit: int = Field(50, ge=1, le=200)


#: What each ingestion state means, handed to the model with the rows. Without
#: it a model reads `routed` as "done", when it means nothing queryable has
#: been produced yet.
STATE_MEANINGS = {
    "discovered":   "seen, not yet read",
    "hashed":       "hashed, type not yet determined",
    "duplicate":    "same hash already in this case; not processed again",
    "identified":   "type determined, not yet routed",
    "unidentified": "no known format; needs the analyst to force a type",
    "routed":       "sent to its page but not parsed into a queryable table (not yet, or the parse failed)",
    "parsed":       "converted to a table, not yet queryable",
    "indexed":      "queryable with list_artifacts and store_search",
    "browsable":    "available on its own page (memory, disk image), not as a table",
    "failed":       "the parser failed; see error",
    "unsupported":  "known type with no parser yet",
}


def _ingest_status(ctx: ToolContext, args: IngestStatusArgs) -> dict[str, Any]:
    query = ctx.db.query(IngestedFile).filter(IngestedFile.case_id == ctx.case.id)
    if args.state:
        query = query.filter(IngestedFile.state == args.state)
    if args.kind:
        query = query.filter(IngestedFile.detected_kind == args.kind)
    total = query.count()
    rows = [
        {
            "id":       f.id,
            "name":     f.original_name,
            "kind":     f.detected_kind,
            "state":    f.state,
            "sha256":   f.sha256,
            "size":     f.size_bytes,
            "timezone": f.source_timezone,
            "error":    _cell(f.error) if f.error else None,
        }
        for f in query.order_by(IngestedFile.created_at).limit(args.limit)
    ]
    seen = {row["state"] for row in rows}
    return fit({"total": total,
                "states": {k: v for k, v in STATE_MEANINGS.items() if k in seen},
                "rows": rows})


# ─── list_artifacts ───────────────────────────────────────────────────────────

class ListArtifactsArgs(BaseModel):
    name_contains: str | None = Field(None, description="Case-insensitive filter on file name or label")
    limit: int = Field(50, ge=1, le=200)


def _list_artifacts(ctx: ToolContext, args: ListArtifactsArgs) -> dict[str, Any]:
    query = ctx.db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == ctx.case.id)
    if args.name_contains:
        needle = f"%{args.name_contains}%"
        query = query.filter(CsvArtifactFile.original_name.ilike(needle)
                             | CsvArtifactFile.ez_label.ilike(needle))
    total = query.count()
    rows = [
        {
            "artifact_id": a.id,
            "name":        a.original_name,
            "label":       a.ez_label,
            "rows":        a.row_count,
            "date_column": a.date_column,
            "columns":     len(json.loads(str(a.columns or "[]"))),
        }
        for a in query.order_by(CsvArtifactFile.original_name).limit(args.limit)
    ]
    return fit({"total": total, "rows": rows})


# ─── store_schema / store_search ──────────────────────────────────────────────

def _artifact(ctx: ToolContext, artifact_id: str) -> CsvArtifactFile:
    artifact = (ctx.db.query(CsvArtifactFile)
                .filter(CsvArtifactFile.id == artifact_id,
                        CsvArtifactFile.case_id == ctx.case.id)
                .first())
    if artifact is None:
        raise ToolError(f"No artifact '{artifact_id}' in this case. Call list_artifacts first.")
    return artifact


def _source(a: CsvArtifactFile) -> Source:
    return Source(
        ref=str(a.file_path),
        date_column=str(a.date_column) if a.date_column else None,
        timezone=str(a.source_timezone) if a.source_timezone else None,
    )


class StoreSchemaArgs(BaseModel):
    artifact_id: str = Field(..., description="Id from list_artifacts")


def _store_schema(ctx: ToolContext, args: StoreSchemaArgs) -> dict[str, Any]:
    artifact = _artifact(ctx, args.artifact_id)
    columns = json.loads(str(artifact.columns or "[]"))
    return {
        "artifact_id": artifact.id,
        "name":        artifact.original_name,
        "label":       artifact.ez_label,
        "rows":        artifact.row_count,
        "date_column": artifact.date_column,
        "timezone":    artifact.source_timezone or "UTC",
        "columns":     columns,
    }


class StoreSearchArgs(BaseModel):
    artifact_id: str = Field(..., description="Id from list_artifacts")
    rql:  str | None = Field(None, description='RQL filter, e.g. EventId = 4624 AND LogonType = 10')
    text: str | None = Field(None, description="Free text matched across every column")
    columns: list[str] | None = Field(None, description="Columns to return; default all")
    sort_column: str | None = None
    descending: bool = False
    limit: int = Field(20, ge=1, le=50)


def _store_search(ctx: ToolContext, args: StoreSearchArgs) -> dict[str, Any]:
    from ..rql_parser import RQLSyntaxError

    artifact = _artifact(ctx, args.artifact_id)
    all_columns: list[str] = json.loads(str(artifact.columns or "[]"))
    if args.columns:
        unknown = [c for c in args.columns if c not in all_columns]
        if unknown:
            raise ToolError(f"Unknown columns {unknown}. Call store_schema for the column list.")
    if args.sort_column and args.sort_column not in all_columns:
        raise ToolError(f"Unknown sort column '{args.sort_column}'.")

    try:
        page = get_store().search(
            _source(artifact), all_columns,
            Query(text=args.text or None, rql=args.rql or None),
            sort_col=args.sort_column, sort_dir="desc" if args.descending else "asc",
            page=1, page_size=args.limit,
        )
    except RQLSyntaxError as exc:
        raise ToolError(str(exc)) from exc
    except SourceMissing as exc:
        raise ToolError("The artifact's file is no longer on disk.") from exc

    keep = args.columns or all_columns
    rows = [{c: _cell(row.get(c)) for c in keep} for row in page.rows]
    return fit({"artifact_id": artifact.id, "total": page.total, "rows": rows})


# ─── Case objects ─────────────────────────────────────────────────────────────

def _iso(value: Any) -> str | None:
    return value.isoformat() + "Z" if value is not None else None


class ListArgs(BaseModel):
    limit: int = Field(100, ge=1, le=500)


class ListIocsArgs(ListArgs):
    type: str | None = Field(None, description="Only this IOC type, e.g. ip, domain, hash_sha256")
    value_contains: str | None = None


def _list_iocs(ctx: ToolContext, args: ListIocsArgs) -> dict[str, Any]:
    query = ctx.db.query(IOC).filter(IOC.case_id == ctx.case.id)
    if args.type:
        query = query.filter(IOC.type == args.type)
    if args.value_contains:
        query = query.filter(IOC.value.ilike(f"%{args.value_contains}%"))
    rows = [{"id": i.id, "type": getattr(i.type, "value", i.type), "value": i.value,
             "confidence": getattr(i.confidence, "value", i.confidence),
             "description": _cell(i.description or ""), "tags": i.tags}
            for i in query.order_by(IOC.created_at).limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


def _list_assets(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    query = ctx.db.query(Asset).filter(Asset.case_id == ctx.case.id)
    rows = [{"id": a.id, "name": a.name, "type": getattr(a.type, "value", a.type),
             "hostname": a.hostname, "ip": a.ip_address, "os": a.os, "domain": a.domain,
             "compromised": bool(a.compromised), "description": _cell(a.description or "")}
            for a in query.order_by(Asset.created_at).limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


class ListTimelineArgs(ListArgs):
    title_contains: str | None = None


def _list_timeline(ctx: ToolContext, args: ListTimelineArgs) -> dict[str, Any]:
    query = ctx.db.query(TimelineEvent).filter(TimelineEvent.case_id == ctx.case.id)
    if args.title_contains:
        query = query.filter(TimelineEvent.title.ilike(f"%{args.title_contains}%"))
    rows = [{"id": e.id, "time": _iso(e.event_ts), "title": e.title,
             "description": _cell(e.description or ""), "source": e.source, "origin": e.origin}
            for e in query.order_by(TimelineEvent.event_ts).limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


def _list_incident_log(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    query = ctx.db.query(IncidentLogEntry).filter(IncidentLogEntry.case_id == ctx.case.id)
    rows = [{"time": _iso(e.event_ts), "category": e.category, "title": e.title,
             "description": _cell(e.description or ""), "actor": e.actor}
            for e in query.order_by(IncidentLogEntry.event_ts).limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


def _list_ttps(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    query = ctx.db.query(CaseTTP).filter(CaseTTP.case_id == ctx.case.id)
    rows = [{"technique": t.technique_id, "name": t.technique_name, "tactic": t.tactic,
             "comment": _cell(t.comment or "")}
            for t in query.limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


# ─── Windows host ─────────────────────────────────────────────────────────────

class ChainsawArgs(BaseModel):
    level: str | None = Field(None, description="critical, high, medium, low or informational")
    rule_contains: str | None = None
    computer: str | None = None
    limit: int = Field(50, ge=1, le=200)


def _chainsaw_alerts(ctx: ToolContext, args: ChainsawArgs) -> dict[str, Any]:
    query = ctx.db.query(ChainsawAlert).filter(ChainsawAlert.case_id == ctx.case.id)
    if args.level:
        query = query.filter(ChainsawAlert.level == args.level)
    if args.rule_contains:
        query = query.filter(ChainsawAlert.rule_name.ilike(f"%{args.rule_contains}%"))
    if args.computer:
        query = query.filter(ChainsawAlert.computer.ilike(f"%{args.computer}%"))
    total = query.count()
    rows = [{"id": a.id, "rule": a.rule_name, "level": a.level, "time": _iso(a.timestamp),
             "event_id": a.event_id, "channel": a.channel, "computer": a.computer,
             "data": {k: _cell(v) for k, v in (a.event_data or {}).items()}}
            for a in query.order_by(ChainsawAlert.timestamp).limit(args.limit)]
    note = None if total else ("No Chainsaw detections. Chainsaw is run on event logs from the "
                               "Detections page; it may not have been run on this case.")
    return fit({"total": total, "note": note, "rows": rows})


class ProcessTreeArgs(BaseModel):
    image_contains: str | None = Field(None, description="Executable name or path fragment, e.g. powershell")
    command_contains: str | None = None
    limit: int = Field(50, ge=1, le=200)


def _process_tree(ctx: ToolContext, args: ProcessTreeArgs) -> dict[str, Any]:
    from .. import process_tree

    tree = process_tree.build(ctx.db, str(ctx.case.id))
    nodes = tree.get("nodes") or []
    if isinstance(nodes, dict):
        nodes = list(nodes.values())
    if args.image_contains:
        needle = args.image_contains.lower()
        nodes = [n for n in nodes if needle in str(n.get("image", "")).lower()]
    if args.command_contains:
        needle = args.command_contains.lower()
        nodes = [n for n in nodes if needle in str(n.get("command_line", "")).lower()]
    keep = ("pid", "name", "image", "command_line", "user", "computer", "started",
            "parent_pid", "parent_name", "link", "sources")
    rows = [{k: _cell(n.get(k)) for k in keep} for n in nodes[: args.limit]]
    return fit({"total": len(nodes), "stats": tree.get("stats"), "rows": rows})


# ─── Proposals and delegation ─────────────────────────────────────────────────

EVIDENCE_HELP = ("Citations the proposal rests on: artifact name or id plus the identifying "
                 "values of the row, e.g. Security.evtx EventRecordId 4512, 2024-03-02 10:14:07Z")


def _require_caller(ctx: ToolContext) -> tuple[str, str]:
    if not ctx.agent_id or not ctx.task_id:
        raise ToolError("This tool can only be used by an agent working on a task.")
    return ctx.agent_id, ctx.task_id


def _propose(ctx: ToolContext, kind: str, payload: dict[str, Any], rationale: str,
             evidence: list[str], summary: str) -> dict[str, Any]:
    from . import events

    agent_id, task_id = _require_caller(ctx)
    proposal = AgentProposal(case_id=ctx.case.id, agent_id=agent_id, task_id=task_id,
                             kind=kind, payload=json.dumps(payload, default=str),
                             rationale=rationale.strip(), evidence=json.dumps(evidence))
    ctx.db.add(proposal)
    ctx.db.commit()
    events.record(ctx.db, case_id=str(ctx.case.id), agent_id=agent_id, task_id=task_id,
                  kind=EVENT_PROPOSAL,
                  payload={"action": "proposed", "proposal_id": proposal.id,
                           "proposal_kind": kind, "summary": summary},
                  actor=ctx.actor)
    return {"proposal_id": proposal.id, "state": PROPOSAL_OPEN,
            "note": "Waiting for the analyst to accept or reject it."}


def _open_proposals(ctx: ToolContext, kind: str) -> list[dict[str, Any]]:
    return [json.loads(p.payload or "{}") for p in
            ctx.db.query(AgentProposal).filter(AgentProposal.case_id == ctx.case.id,
                                               AgentProposal.kind == kind,
                                               AgentProposal.state == PROPOSAL_OPEN)]


IOC_TYPES = [t.value for t in IOCType]
IOC_CONFIDENCES = [c.value for c in IOCConfidence]


class ProposeIocArgs(BaseModel):
    type: str = Field(..., description="One of: " + ", ".join(IOC_TYPES))
    value: str = Field(..., min_length=1, max_length=2048)
    description: str = Field("", max_length=2000)
    confidence: str = Field("medium", description="low, medium or high")
    rationale: str = Field(..., min_length=1, description="Why this is an indicator of this incident")
    evidence: list[str] = Field(..., min_length=1, description=EVIDENCE_HELP)


def _propose_ioc(ctx: ToolContext, args: ProposeIocArgs) -> dict[str, Any]:
    if args.type not in IOC_TYPES:
        raise ToolError(f"Unknown IOC type '{args.type}'. Use one of: {', '.join(IOC_TYPES)}")
    if args.confidence not in IOC_CONFIDENCES:
        raise ToolError("confidence must be low, medium or high")
    value = args.value.strip()
    existing = (ctx.db.query(IOC).filter(IOC.case_id == ctx.case.id, IOC.type == args.type)
                .filter(IOC.value.ilike(value)).first())
    if existing is not None:
        raise ToolError(f"Already recorded in the case as IOC {existing.id}; do not propose it again.")
    if any(p.get("type") == args.type and str(p.get("value", "")).lower() == value.lower()
           for p in _open_proposals(ctx, PROPOSAL_IOC)):
        raise ToolError("Already proposed and waiting for the analyst.")
    payload = {"type": args.type, "value": value, "description": args.description,
               "confidence": args.confidence, "tlp": ctx.case.tlp or "TLP:AMBER"}
    return _propose(ctx, PROPOSAL_IOC, payload, args.rationale, args.evidence,
                    f"IOC {args.type} {value}")


class ProposeTimelineArgs(BaseModel):
    time: str = Field(..., description="UTC, yyyy-MM-ddTHH:mm:ssZ")
    title: str = Field(..., min_length=1, max_length=512)
    description: str = Field("", max_length=4000)
    source: str = Field("", max_length=255, description="Artifact the event comes from")
    rationale: str = Field(..., min_length=1, description="Why this event matters to the incident")
    evidence: list[str] = Field(..., min_length=1, description=EVIDENCE_HELP)


def _propose_timeline_event(ctx: ToolContext, args: ProposeTimelineArgs) -> dict[str, Any]:
    from datetime import UTC, datetime

    try:
        when = datetime.fromisoformat(args.time.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ToolError(f"Cannot read time '{args.time}'. Use yyyy-MM-ddTHH:mm:ssZ.") from exc
    when = (when.astimezone(UTC) if when.tzinfo else when).replace(tzinfo=None)
    title = args.title.strip()
    duplicate = (ctx.db.query(TimelineEvent)
                 .filter(TimelineEvent.case_id == ctx.case.id, TimelineEvent.event_ts == when,
                         TimelineEvent.title.ilike(title)).first())
    if duplicate is not None:
        raise ToolError(f"Already on the timeline as event {duplicate.id}.")
    payload = {"event_ts": when.isoformat(), "title": title,
               "description": args.description, "source": args.source}
    return _propose(ctx, PROPOSAL_TIMELINE, payload, args.rationale, args.evidence,
                    f"{when.isoformat()}Z {title}")


class ProposeTaskArgs(BaseModel):
    role: str = Field(..., description="Role that should do it, e.g. analyst-windows")
    objective: str = Field(..., min_length=10, max_length=4000,
                           description="One precise objective, naming hosts, accounts or artifacts")
    rationale: str = Field(..., min_length=1, description="Which hypothesis or question it serves")
    depends_on: list[str] = Field(default_factory=list,
                                  description="Task or task-proposal ids that must finish first")


def _propose_task(ctx: ToolContext, args: ProposeTaskArgs) -> dict[str, Any]:
    from .definitions import DEFAULT_ROLE, LEADER_ROLE, definitions

    roles = definitions().roles
    if args.role not in roles or args.role in (LEADER_ROLE, DEFAULT_ROLE):
        assignable = sorted(r for r in roles if r not in (LEADER_ROLE, DEFAULT_ROLE))
        raise ToolError(f"Cannot assign to '{args.role}'. Roles: {', '.join(assignable)}")
    for ref in args.depends_on:
        task = ctx.db.get(AgentTask, ref)
        owner: AgentTask | AgentProposal | None = task or ctx.db.get(AgentProposal, ref)
        if owner is None or owner.case_id != ctx.case.id:
            raise ToolError(f"depends_on: '{ref}' is not a task or proposal of this case.")
    payload = {"role": args.role, "objective": args.objective.strip(),
               "depends_on": args.depends_on}
    return _propose(ctx, PROPOSAL_TASK, payload, args.rationale, [],
                    f"{args.role}: {args.objective.strip()[:120]}")


class ListTasksArgs(BaseModel):
    status: str | None = Field(None, description="pending, running, done, failed or cancelled")
    limit: int = Field(50, ge=1, le=200)


def _list_tasks(ctx: ToolContext, args: ListTasksArgs) -> dict[str, Any]:
    names = {a.id: (a.name, a.role) for a in
             ctx.db.query(AgentInstance).filter(AgentInstance.case_id == ctx.case.id)}
    query = ctx.db.query(AgentTask).filter(AgentTask.case_id == ctx.case.id)
    if args.status:
        query = query.filter(AgentTask.status == args.status)
    rows = [{"task_id": t.id, "agent": names.get(t.agent_id, ("?", "?"))[0],
             "role": names.get(t.agent_id, ("?", "?"))[1], "kind": t.kind, "status": t.status,
             "step": t.current_step, "objective": _cell(t.objective),
             "has_report": bool(t.report)}
            for t in query.order_by(AgentTask.created_at).limit(args.limit)]
    awaiting = [{"proposal_id": p.id, **json.loads(p.payload or "{}")} for p in
                ctx.db.query(AgentProposal).filter(AgentProposal.case_id == ctx.case.id,
                                                   AgentProposal.kind == PROPOSAL_TASK,
                                                   AgentProposal.state == PROPOSAL_OPEN)]
    return fit({"tasks": rows, "proposed_tasks_awaiting_approval": awaiting}, rows_key="tasks")


class ReadTaskArgs(BaseModel):
    task_id: str


def _read_task(ctx: ToolContext, args: ReadTaskArgs) -> dict[str, Any]:
    task = ctx.db.get(AgentTask, args.task_id)
    if task is None or task.case_id != ctx.case.id:
        raise ToolError(f"No task '{args.task_id}' in this case. Call list_tasks.")
    return {"task_id": task.id, "status": task.status, "kind": task.kind,
            "objective": task.objective, "report": (task.report or "")[:8000],
            "error": task.error}


class RequestHelpArgs(BaseModel):
    need: str = Field(..., min_length=10, max_length=2000,
                      description="What you need, from which speciality, and why")


def _request_help(ctx: ToolContext, args: RequestHelpArgs) -> dict[str, Any]:
    from .delegation import ask_leader_for_help
    from .runtime import supervisor

    _, task_id = _require_caller(ctx)
    task = ctx.db.get(AgentTask, task_id)
    if task is None:
        raise ToolError("The task this request belongs to no longer exists.")
    help_task = ask_leader_for_help(ctx.db, task, args.need)
    if help_task is None:
        raise ToolError("There is no Incident Leader on this case to ask. "
                        "Say what you need in your report instead.")
    supervisor.enqueue(help_task.id)
    return {"sent_to": "incident-leader", "note": "Carry on with what you can do meanwhile."}


# ─── Registry ─────────────────────────────────────────────────────────────────

TOOLS: dict[str, Tool] = {tool.name: tool for tool in (
    Tool("case_overview",
         "Case metadata (title, TLP, severity, client) and counts of what it holds.",
         NoArgs, _case_overview),
    Tool("ingest_status",
         "Files ingested into the case with their detected kind, state, hash and errors.",
         IngestStatusArgs, _ingest_status),
    Tool("list_artifacts",
         "Parsed, queryable artifacts of the case (Explorer tables) with their ids.",
         ListArtifactsArgs, _list_artifacts),
    Tool("store_schema",
         "Columns, row count, date column and source timezone of one artifact.",
         StoreSchemaArgs, _store_schema),
    Tool("store_search",
         "Rows of one artifact matching an RQL filter and/or free text. Returns the total match count.",
         StoreSearchArgs, _store_search),
    Tool("list_iocs", "Indicators of compromise already recorded in the case.",
         ListIocsArgs, _list_iocs),
    Tool("list_assets", "Hosts and other assets recorded in the case, and which are compromised.",
         ListArgs, _list_assets),
    Tool("list_timeline", "Events already on the case timeline, oldest first.",
         ListTimelineArgs, _list_timeline),
    Tool("list_incident_log", "The incident log: actions and decisions taken, oldest first.",
         ListArgs, _list_incident_log),
    Tool("list_ttps", "MITRE ATT&CK techniques recorded on the case.",
         ListArgs, _list_ttps),
    Tool("chainsaw_alerts", "Sigma detections Chainsaw raised on the case's event logs.",
         ChainsawArgs, _chainsaw_alerts),
    Tool("process_tree",
         "Processes reconstructed from Sysmon 1 and Security 4688, with parent and command line.",
         ProcessTreeArgs, _process_tree),
    Tool("propose_ioc",
         "Propose an indicator for the analyst to add to the case. Cite the evidence.",
         ProposeIocArgs, _propose_ioc, PROPOSING),
    Tool("propose_timeline_event",
         "Propose a key event for the analyst to add to the case timeline. Cite the evidence.",
         ProposeTimelineArgs, _propose_timeline_event, PROPOSING),
    Tool("propose_task",
         "Propose a task for an analyst role. It runs only once the human analyst approves it.",
         ProposeTaskArgs, _propose_task, PROPOSING),
    Tool("list_tasks", "Tasks of the case with their agent, status and step, and proposed tasks.",
         ListTasksArgs, _list_tasks),
    Tool("read_task", "The objective and full report of one task.",
         ReadTaskArgs, _read_task),
    Tool("request_help", "Ask the Incident Leader for work outside your speciality.",
         RequestHelpArgs, _request_help, PROPOSING),
)}


def specs(grants: frozenset[str], names: list[str] | None = None) -> list[ToolSpec]:
    """The tools offered to an agent holding `grants`, limited to `names` if given."""
    return [tool.spec() for tool in TOOLS.values()
            if tool.requires <= grants and (names is None or tool.name in names)]


def run_tool(ctx: ToolContext, name: str, arguments: dict[str, Any],
             allowed: list[str] | None = None) -> dict[str, Any]:
    """Validate and run one call. Raises ToolError for anything the model got wrong."""
    tool = TOOLS.get(name)
    if tool is None or (allowed is not None and name not in allowed):
        offered = allowed if allowed is not None else list(TOOLS)
        raise ToolError(f"Tool '{name}' is not available at this step. "
                        f"Available: {', '.join(offered) or 'none'}")
    if not tool.requires <= ctx.grants:
        raise ToolError(f"Tool '{name}' is not permitted for this agent.")
    try:
        args = tool.params.model_validate(arguments or {})
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'arguments'}: {e['msg']}"
                             for e in exc.errors())
        raise ToolError(f"Invalid arguments for {name}: {problems}") from exc
    return tool.run(ctx, args)
