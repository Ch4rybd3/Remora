"""
What an agent can do, as typed adapters over Remora services.

An agent never gets a shell, a path or SQL. Each tool takes arguments that a
Pydantic model validates, reaches data through the same service the
interface uses, and returns a bounded JSON object. Tools read Remora data;
the only writes are proposals, tasks, observations and findings, which live
in the module's own tables and reach the case only when the analyst accepts
them.

The registry here is the single source of the tool vocabulary: the runner
offers it to the model, the API lists it, and `docs/CHARYBDIS.md` is checked
against it (`test_charybdis_tools.py`).
"""
from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from ...core.permissions import PERM_ARTIFACTS, PERM_WRITE
from ...models.agent import (
    EVENT_FINDING,
    EVENT_PROPOSAL,
    FINDING_IN_REVIEW,
    FINDING_PROPOSED,
    FINDING_VALIDATED,
    PROPOSAL_EXECUTIVE_SUMMARY,
    PROPOSAL_INCIDENT_LOG,
    PROPOSAL_IOC,
    PROPOSAL_OPEN,
    PROPOSAL_REPORT_SECTION,
    PROPOSAL_TASK,
    PROPOSAL_TIMELINE,
    PROPOSAL_TTP,
    SOURCE_BINARY,
    SOURCE_EMAIL,
    SOURCE_MEMORY,
    VERDICT_SUPPORTED,
    VERDICT_UNSUPPORTED,
    AgentFinding,
    AgentInstance,
    AgentObservation,
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
    # Files uploaded on their own page never appear here: see list_evidence.
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


# ─── list_evidence ────────────────────────────────────────────────────────────

class ListEvidenceArgs(BaseModel):
    kind: str | None = Field(None, description="Only table, email, memory or binary")


def _list_evidence(ctx: ToolContext, args: ListEvidenceArgs) -> dict[str, Any]:
    """
    What the case holds that agents can read, whatever it came through. The
    ingestion log only knows the drop folder; a file uploaded on its own page
    is here and not there.
    """
    from .triggers import collect

    items = [e for e in collect(ctx.db, str(ctx.case.id)) if not args.kind or e.kind == args.kind]
    rows = [{"kind": e.kind, "id": e.id, "name": e.name, "detail": e.detail, "read_by": e.reader}
            for e in items]
    note = None if rows else "Nothing readable in the case yet."
    return fit({"total": len(rows), "note": note,
                "ids": "table: artifact_id; email: email_id; memory: dump_id; binary: binary_id",
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
    from .definitions import definitions

    roles = definitions().roles
    if args.role not in roles or not roles[args.role].assignable:
        assignable = sorted(r.id for r in roles.values() if r.assignable)
        raise ToolError(f"Cannot assign to '{args.role}'. Roles: {', '.join(assignable)}")
    for ref in args.depends_on:
        task = ctx.db.get(AgentTask, ref)
        owner: AgentTask | AgentProposal | None = task or ctx.db.get(AgentProposal, ref)
        if owner is None or owner.case_id != ctx.case.id:
            raise ToolError(f"depends_on: '{ref}' is not a task or proposal of this case.")
    from .delegation import auto_start
    from .runtime import supervisor

    payload = {"role": args.role, "objective": args.objective.strip(),
               "depends_on": args.depends_on}
    result = _propose(ctx, PROPOSAL_TASK, payload, args.rationale, [],
                      f"{args.role}: {args.objective.strip()[:120]}")
    proposal = ctx.db.get(AgentProposal, result["proposal_id"])
    started, held = auto_start(ctx.db, proposal) if proposal is not None else (None, None)
    if started is None:
        if held:
            return {**result, "note": f"Waiting for the analyst despite auto-start: {held}."}
        return result
    supervisor.enqueue(started.id)
    return {**result, "state": "accepted", "task_id": started.id,
            "note": "Started at once: the analyst turned auto-start on for this case."}


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


# ─── Observations and findings ────────────────────────────────────────────────

#: A cell kept in an observation's copy of its row. Longer than a cell handed
#: to the model: the copy is what the analyst reads when the table is gone.
MAX_OBSERVED_CELL_CHARS = 4000


class RecordObservationArgs(BaseModel):
    artifact_id: str = Field(..., description="Id from list_artifacts")
    rql: str = Field(..., min_length=1,
                     description="RQL matching exactly one row, e.g. EventRecordId = 4512")
    note: str = Field(..., min_length=1, max_length=2000,
                      description="What this row shows, in one or two sentences")


def _record_observation(ctx: ToolContext, args: RecordObservationArgs) -> dict[str, Any]:
    """
    Re-read the row from the store before keeping it. A model that misremembers
    a record id gets an error here, not a citation pointing at nothing.
    """
    from ..rql_parser import RQLSyntaxError

    agent_id, task_id = _require_caller(ctx)
    artifact = _artifact(ctx, args.artifact_id)
    columns: list[str] = json.loads(str(artifact.columns or "[]"))
    try:
        page = get_store().search(_source(artifact), columns, Query(rql=args.rql.strip()),
                                  page=1, page_size=2)
    except RQLSyntaxError as exc:
        raise ToolError(str(exc)) from exc
    except SourceMissing as exc:
        raise ToolError("The artifact's file is no longer on disk.") from exc
    if page.total != 1:
        hint = ("Nothing matches; check the values with store_search." if page.total == 0 else
                "Add a condition on a column that identifies one row, e.g. a record id "
                "or the exact timestamp.")
        raise ToolError(f"The filter matches {page.total} rows, not one. {hint}")

    row = {c: (v[:MAX_OBSERVED_CELL_CHARS] if isinstance(v, str) else v)
           for c, v in page.rows[0].items()}
    observation = AgentObservation(
        case_id=ctx.case.id, agent_id=agent_id, task_id=task_id, artifact_id=artifact.id,
        artifact_name=str(artifact.original_name),
        artifact_label=str(artifact.ez_label) if artifact.ez_label else None,
        locator=args.rql.strip(), row=json.dumps(row, default=str), note=args.note.strip())
    ctx.db.add(observation)
    ctx.db.commit()
    return {"observation_id": observation.id,
            "row": {c: _cell(v) for c, v in row.items()},
            "note": "Cite this id in propose_finding."}


SEVERITIES = ("critical", "high", "medium", "low", "info")
CONFIDENCES = ("low", "medium", "high")
ATTACK_ID = re.compile(r"^T\d{4}(\.\d{3})?$")


class ProposeFindingArgs(BaseModel):
    title: str = Field(..., min_length=5, max_length=255)
    statement: str = Field(..., min_length=10, max_length=8000,
                           description="What happened, stated so the observations can prove or disprove it")
    severity: str = Field(..., description="critical, high, medium, low or info")
    confidence: str = Field(..., description="low, medium or high")
    confidence_reason: str = Field(..., min_length=5, max_length=2000,
                                   description="Why this confidence: what is certain, what is inferred")
    observation_ids: list[str] = Field(..., min_length=1,
                                       description="Ids from record_observation the finding rests on")
    attack_ids: list[str] = Field(default_factory=list, description="ATT&CK technique ids, e.g. T1021.001")


def _finding_ref(db: Session, case_id: str) -> int:
    last = (db.query(AgentFinding.ref).filter(AgentFinding.case_id == case_id)
            .order_by(AgentFinding.ref.desc()).first())
    return (last[0] if last else 0) + 1


def _propose_finding(ctx: ToolContext, args: ProposeFindingArgs) -> dict[str, Any]:
    from .delegation import request_review
    from .runtime import supervisor

    agent_id, task_id = _require_caller(ctx)
    if args.severity not in SEVERITIES:
        raise ToolError(f"severity must be one of: {', '.join(SEVERITIES)}")
    if args.confidence not in CONFIDENCES:
        raise ToolError("confidence must be low, medium or high")
    bad = [a for a in args.attack_ids if not ATTACK_ID.match(a.strip())]
    if bad:
        raise ToolError(f"Not ATT&CK technique ids: {bad}. Write them like T1059 or T1021.001.")
    known = {o.id for o in ctx.db.query(AgentObservation.id)
             .filter(AgentObservation.case_id == ctx.case.id,
                     AgentObservation.id.in_(args.observation_ids))}
    missing = [o for o in args.observation_ids if o not in known]
    if missing:
        raise ToolError(
            f"Unknown observations {missing}. An observation id is what record_observation (a "
            "table row) or record_source_observation (a memory line, an email part, a binary "
            "entry) returned. Call one of them for each fact first, then cite the ids it returned.")

    finding = AgentFinding(
        case_id=ctx.case.id, agent_id=agent_id, task_id=task_id,
        ref=_finding_ref(ctx.db, str(ctx.case.id)), title=args.title.strip(),
        statement=args.statement.strip(), severity=args.severity, confidence=args.confidence,
        confidence_reason=args.confidence_reason.strip(),
        attack_ids=json.dumps([a.strip() for a in args.attack_ids]),
        observation_ids=json.dumps(args.observation_ids), state=FINDING_PROPOSED)
    ctx.db.add(finding)
    ctx.db.commit()
    review = request_review(ctx.db, finding)
    from . import events
    events.record(ctx.db, case_id=str(ctx.case.id), agent_id=agent_id, task_id=task_id,
                  kind=EVENT_FINDING,
                  payload={"action": "proposed", "finding_id": finding.id,
                           "summary": f"F{finding.ref} {finding.title}",
                           "review_task_id": review.id if review else None},
                  actor=ctx.actor)
    if review is not None:
        supervisor.enqueue(review.id)
    return {"finding": f"F{finding.ref}", "finding_id": finding.id, "state": finding.state,
            "note": ("Sent to the reviewer, then to the analyst." if review else
                     "Waiting for the analyst to validate or reject it.")}


class ListFindingsArgs(BaseModel):
    state: str | None = Field(None, description="in_review, proposed, validated or rejected")
    limit: int = Field(50, ge=1, le=200)


def _list_findings(ctx: ToolContext, args: ListFindingsArgs) -> dict[str, Any]:
    query = ctx.db.query(AgentFinding).filter(AgentFinding.case_id == ctx.case.id)
    if args.state:
        query = query.filter(AgentFinding.state == args.state)
    rows = [{"finding": f"F{f.ref}", "finding_id": f.id, "title": f.title, "state": f.state,
             "severity": f.severity, "confidence": f.confidence,
             "attack_ids": json.loads(f.attack_ids or "[]"),
             "observations": len(json.loads(f.observation_ids or "[]")),
             "review": f.review_verdict}
            for f in query.order_by(AgentFinding.ref).limit(args.limit)]
    return fit({"total": query.count(), "rows": rows})


def _find(ctx: ToolContext, ref: str) -> AgentFinding:
    """A finding by id or by its `F<n>` reference."""
    ref = ref.strip()
    finding = None
    match = re.fullmatch(r"[Ff](\d+)", ref)
    if match:
        finding = (ctx.db.query(AgentFinding)
                   .filter(AgentFinding.case_id == ctx.case.id,
                           AgentFinding.ref == int(match.group(1))).first())
    else:
        finding = ctx.db.get(AgentFinding, ref)
    if finding is None or finding.case_id != ctx.case.id:
        raise ToolError(f"No finding '{ref}' in this case. Call list_findings.")
    return finding


class ReadFindingArgs(BaseModel):
    finding: str = Field(..., description="F<n> reference or finding id")


def _read_finding(ctx: ToolContext, args: ReadFindingArgs) -> dict[str, Any]:
    f = _find(ctx, args.finding)
    ids = json.loads(f.observation_ids or "[]")
    observations = [
        {"observation_id": o.id, "source": o.source_kind, "artifact_id": o.artifact_id, "artifact": o.artifact_name,
         "locator": o.locator, "note": o.note,
         "row": {c: _cell(v) for c, v in json.loads(o.row or "{}").items()}}
        for o in ctx.db.query(AgentObservation).filter(AgentObservation.id.in_(ids))
    ]
    return fit({"finding": f"F{f.ref}", "finding_id": f.id, "title": f.title,
                "statement": f.statement, "severity": f.severity, "confidence": f.confidence,
                "confidence_reason": f.confidence_reason,
                "attack_ids": json.loads(f.attack_ids or "[]"), "state": f.state,
                "review": ({"verdict": f.review_verdict, "comment": f.review_comment,
                            "alternatives": f.review_alternatives}
                           if f.review_verdict else None),
                "analyst_comment": f.decision_comment,
                "observations": observations}, rows_key="observations")


class ReviewFindingArgs(BaseModel):
    finding: str = Field(..., description="F<n> reference or finding id")
    verdict: str = Field(..., description="supported or unsupported")
    comment: str = Field(..., min_length=10, max_length=4000,
                         description="What the evidence does and does not show")
    alternatives: str = Field("", max_length=4000,
                              description="Other explanations of the same evidence, and why they fit or not")


def _review_finding(ctx: ToolContext, args: ReviewFindingArgs) -> dict[str, Any]:
    from . import events

    _, task_id = _require_caller(ctx)
    f = _find(ctx, args.finding)
    if f.review_task_id != task_id:
        raise ToolError(f"F{f.ref} was not given to you to review.")
    if f.state != FINDING_IN_REVIEW:
        raise ToolError(f"F{f.ref} is {f.state}, not waiting for a review.")
    if args.verdict not in (VERDICT_SUPPORTED, VERDICT_UNSUPPORTED):
        raise ToolError("verdict must be supported or unsupported")
    f.review_verdict = args.verdict
    f.review_comment = args.comment.strip()
    f.review_alternatives = args.alternatives.strip() or None
    f.reviewed_by = ctx.actor
    f.state = FINDING_PROPOSED
    ctx.db.commit()
    # Recorded on the author's line of the trace: the review is feedback the
    # author reads the next time it works (`runtime._history`).
    events.record(ctx.db, case_id=str(ctx.case.id), agent_id=f.agent_id, task_id=ctx.task_id,
                  kind=EVENT_FINDING,
                  payload={"action": "reviewed", "finding_id": f.id,
                           "summary": f"F{f.ref} {f.title}", "verdict": args.verdict,
                           "comment": f.review_comment},
                  actor=ctx.actor)
    return {"finding": f"F{f.ref}", "verdict": args.verdict,
            "note": "Recorded. The analyst now decides."}


# ─── Reporting ────────────────────────────────────────────────────────────────

#: How report text cites a finding: `[F3]`.
CITATION = re.compile(r"\[F(\d+)\]")


def _sections(ctx: ToolContext) -> list[Any]:
    from ..report_service import sections_for
    from ..template_service import TemplateService

    template = (TemplateService().get_template(str(ctx.case.template_id))
                if ctx.case.template_id else None)
    return sections_for(template)


def _report_outline(ctx: ToolContext, _: NoArgs) -> dict[str, Any]:
    written = json.loads(str(ctx.case.report_sections_data or "{}"))
    return {
        "sections": [{"section": s.slug, "name": s.name, "required": s.required,
                      "guidance": _cell(s.template), "written_chars": len(str(written.get(s.slug) or ""))}
                     for s in _sections(ctx)],
        "executive_summary_chars": len(str(ctx.case.executive_summary or "")),
        "citation_format": "Cite validated findings as [F1], [F2] at the end of each paragraph.",
    }


def _checked_citations(ctx: ToolContext, text: str) -> list[int]:
    """
    Every paragraph cites at least one finding, and every finding it cites is
    validated. Headings are exempt. Returns the cited references.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    uncited = [p[:80] for p in paragraphs if not p.startswith("#") and not CITATION.search(p)]
    if uncited:
        raise ToolError(f"Every paragraph must cite a validated finding as [F<n>]. Uncited: {uncited}")
    refs = sorted({int(n) for n in CITATION.findall(text)})
    validated = {ref for (ref,) in ctx.db.query(AgentFinding.ref)
                 .filter(AgentFinding.case_id == ctx.case.id, AgentFinding.ref.in_(refs),
                         AgentFinding.state == FINDING_VALIDATED)}
    stray = [f"F{r}" for r in refs if r not in validated]
    if stray:
        raise ToolError(f"Only validated findings may be cited; not validated: {stray}. "
                        "Call list_findings with state validated.")
    return refs


class ProposeSectionArgs(BaseModel):
    section: str = Field(..., description="Section slug from report_outline")
    text: str = Field(..., min_length=20, max_length=20000,
                      description="Markdown. Each paragraph ends with the findings it rests on, e.g. [F2]")


def _propose_report_section(ctx: ToolContext, args: ProposeSectionArgs) -> dict[str, Any]:
    sections = {s.slug: s for s in _sections(ctx)}
    if args.section not in sections:
        raise ToolError(f"Unknown section '{args.section}'. Sections: {', '.join(sections)}")
    refs = _checked_citations(ctx, args.text)
    payload = {"section": args.section, "name": sections[args.section].name,
               "text": args.text.strip(), "findings": [f"F{r}" for r in refs]}
    return _propose(ctx, PROPOSAL_REPORT_SECTION, payload,
                    f"Drafted from {', '.join(payload['findings'])}", [],
                    f"Report section {sections[args.section].name}")


class ProposeSummaryArgs(BaseModel):
    text: str = Field(..., min_length=20, max_length=8000,
                      description="Plain language for a non-technical reader, each paragraph citing [F<n>]")


def _propose_executive_summary(ctx: ToolContext, args: ProposeSummaryArgs) -> dict[str, Any]:
    refs = _checked_citations(ctx, args.text)
    payload = {"text": args.text.strip(), "findings": [f"F{r}" for r in refs]}
    return _propose(ctx, PROPOSAL_EXECUTIVE_SUMMARY, payload,
                    f"Drafted from {', '.join(payload['findings'])}", [], "Executive summary")


class ProposeTtpArgs(BaseModel):
    technique_id: str = Field(..., description="ATT&CK technique id, e.g. T1021.001")
    technique_name: str = Field("", max_length=255)
    tactic: str = Field("", max_length=64, description="Tactic short name, e.g. lateral-movement")
    comment: str = Field("", max_length=2000, description="How it was used in this incident")
    rationale: str = Field(..., min_length=1)
    evidence: list[str] = Field(..., min_length=1, description=EVIDENCE_HELP)


def _propose_ttp(ctx: ToolContext, args: ProposeTtpArgs) -> dict[str, Any]:
    technique = args.technique_id.strip().upper()
    if not ATTACK_ID.match(technique):
        raise ToolError("Write the technique id like T1059 or T1021.001.")
    if ctx.db.query(CaseTTP).filter(CaseTTP.case_id == ctx.case.id,
                                    CaseTTP.technique_id == technique).first():
        raise ToolError(f"{technique} is already on the case matrix.")
    if any(p.get("technique_id") == technique for p in _open_proposals(ctx, PROPOSAL_TTP)):
        raise ToolError("Already proposed and waiting for the analyst.")
    payload = {"technique_id": technique, "technique_name": args.technique_name.strip(),
               "tactic": args.tactic.strip(), "comment": args.comment.strip()}
    return _propose(ctx, PROPOSAL_TTP, payload, args.rationale, args.evidence,
                    f"TTP {technique} {args.technique_name}".strip())


# ─── Aggregation ──────────────────────────────────────────────────────────────

class StoreAggregateArgs(BaseModel):
    artifact_id: str = Field(..., description="Id from list_artifacts")
    group_by: list[str] = Field(..., min_length=1, max_length=3,
                                description="Columns to count by, e.g. [DestinationIp, DestinationPort]")
    rql: str | None = Field(None, description="RQL filter applied before counting")
    limit: int = Field(30, ge=1, le=100)
    least_first: bool = Field(False, description="Rarest combinations first: useful to spot the odd one")


def _store_aggregate(ctx: ToolContext, args: StoreAggregateArgs) -> dict[str, Any]:
    """Counts per value: top talkers, rare processes, beacon candidates."""
    from ..rql_parser import RQLSyntaxError

    artifact = _artifact(ctx, args.artifact_id)
    columns: list[str] = json.loads(str(artifact.columns or "[]"))
    unknown = [c for c in args.group_by if c not in columns]
    if unknown:
        raise ToolError(f"Unknown columns {unknown}. Call store_schema for the column list.")
    try:
        groups = get_store().aggregate(_source(artifact), columns, Query(rql=args.rql or None),
                                       args.group_by)
    except RQLSyntaxError as exc:
        raise ToolError(str(exc)) from exc
    except SourceMissing as exc:
        raise ToolError("The artifact's file is no longer on disk.") from exc
    ordered = sorted(groups, key=lambda g: g.count, reverse=not args.least_first)
    rows = [{**{k: _cell(v) for k, v in g.values.items()}, "count": g.count}
            for g in ordered[: args.limit]]
    return fit({"artifact_id": artifact.id, "groups": len(groups), "rows": rows})


# ─── Memory, email, binaries ──────────────────────────────────────────────────

#: Lines of a Volatility plugin's text output handed back at most.
MAX_PLUGIN_LINES = 120


def _bounded(value: Any, depth: int = 0) -> Any:
    """A JSON value cut down: long strings, long lists and deep nesting."""
    if isinstance(value, str):
        return value if len(value) <= 2000 else value[:2000] + "…"
    if isinstance(value, list):
        return [_bounded(v, depth + 1) for v in value[:60]] + (["…"] if len(value) > 60 else [])
    if isinstance(value, dict):
        if depth > 4:
            return "…"
        return {k: _bounded(v, depth + 1) for k, v in value.items()}
    return value


def _dump(ctx: ToolContext, dump_id: str) -> Any:
    from ...models.memory import MemoryDump

    dump = ctx.db.get(MemoryDump, dump_id)
    if dump is None or dump.case_id != ctx.case.id:
        raise ToolError(f"No memory dump '{dump_id}' in this case. Call list_memory_dumps.")
    return dump


def _list_memory_dumps(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    from ...models.memory import MemoryDump, MemoryPluginResult

    dumps = (ctx.db.query(MemoryDump).filter(MemoryDump.case_id == ctx.case.id)
             .order_by(MemoryDump.uploaded_at).limit(args.limit).all())
    rows = []
    for d in dumps:
        plugins = (ctx.db.query(MemoryPluginResult.plugin_name, MemoryPluginResult.status)
                   .filter(MemoryPluginResult.dump_id == d.id).all())
        rows.append({"dump_id": d.id, "filename": d.filename, "os": d.os_type, "status": d.status,
                     "plugins": [{"plugin": name, "status": status} for name, status in plugins]})
    note = None if rows else "No memory dump in this case."
    return fit({"total": len(rows), "note": note, "rows": rows})


def _plugin_lines(ctx: ToolContext, dump_id: str, plugin: str) -> list[str]:
    from ...models.memory import MemoryPluginResult

    dump = _dump(ctx, dump_id)
    result = (ctx.db.query(MemoryPluginResult)
              .filter(MemoryPluginResult.dump_id == dump.id,
                      MemoryPluginResult.plugin_name == plugin)
              .order_by(MemoryPluginResult.id.desc()).first())
    if result is None or result.status != "done" or not result.output:
        state = result.status if result is not None else "not run"
        raise ToolError(f"{plugin} is {state} on this dump. Plugins are run by the analyst from "
                        "the Memory page; ask for it in your report if you need it.")
    return str(result.output).splitlines()


class MemoryOutputArgs(BaseModel):
    dump_id: str = Field(..., description="Id from list_memory_dumps")
    plugin: str = Field(..., description="Plugin name, e.g. windows.pslist, windows.netscan, windows.malfind")
    contains: str | None = Field(None, description="Only lines containing this text (case-insensitive)")
    limit: int = Field(60, ge=1, le=MAX_PLUGIN_LINES)


def _memory_output(ctx: ToolContext, args: MemoryOutputArgs) -> dict[str, Any]:
    lines = _plugin_lines(ctx, args.dump_id, args.plugin.strip())
    header = [line for line in lines[:4] if line.strip()]
    body = lines[len(lines[:4]):]
    if args.contains:
        needle = args.contains.lower()
        body = [line for line in body if needle in line.lower()]
    return fit({"plugin": args.plugin, "header": header, "matching": len(body),
                "rows": [_cell(line) for line in body[: args.limit]]})


def _email(ctx: ToolContext, email_id: str) -> Any:
    from ...models.email_file import EmailFile

    email = ctx.db.get(EmailFile, email_id)
    if email is None or email.case_id != ctx.case.id:
        raise ToolError(f"No email '{email_id}' in this case. Call list_emails.")
    return email


def _list_emails(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    from ...models.email_file import EmailFile

    rows = []
    for e in (ctx.db.query(EmailFile).filter(EmailFile.case_id == ctx.case.id)
              .order_by(EmailFile.uploaded_at).limit(args.limit)):
        analysis = json.loads(str(e.analysis or "{}"))
        rows.append({"email_id": e.id, "filename": e.filename, "subject": analysis.get("subject"),
                     "from": analysis.get("from_addr"), "date": analysis.get("date"),
                     "warnings": e.warning_count})
    return fit({"total": len(rows), "rows": rows})


EMAIL_PARTS = ("summary", "key_headers", "all_headers", "urls", "attachments", "warnings",
               "body_plain", "body_html")


class ReadEmailArgs(BaseModel):
    email_id: str = Field(..., description="Id from list_emails")
    part: str = Field("summary", description="One of: " + ", ".join(EMAIL_PARTS))


def _read_email(ctx: ToolContext, args: ReadEmailArgs) -> dict[str, Any]:
    if args.part not in EMAIL_PARTS:
        raise ToolError(f"part must be one of: {', '.join(EMAIL_PARTS)}")
    email = _email(ctx, args.email_id)
    analysis = json.loads(str(email.analysis or "{}"))
    if args.part == "summary":
        keep = ("subject", "from_addr", "to_addr", "reply_to", "return_path", "date")
        return {"email_id": email.id, "filename": email.filename,
                **{k: analysis.get(k) for k in keep},
                "urls": len(analysis.get("urls") or []),
                "attachments": [a.get("filename") for a in analysis.get("attachments") or []
                                if isinstance(a, dict)],
                "warnings": _bounded(analysis.get("warnings") or [])}
    return {"email_id": email.id, "part": args.part, "content": _bounded(analysis.get(args.part))}


def _binary(ctx: ToolContext, binary_id: str) -> Any:
    from ...models.binary import BinaryFile

    binary = ctx.db.get(BinaryFile, binary_id)
    if binary is None or binary.case_id != ctx.case.id:
        raise ToolError(f"No binary '{binary_id}' in this case. Call list_binaries.")
    if binary.status != "ready" or not binary.analysis_json:
        raise ToolError(f"The analysis of {binary.filename} is {binary.status}, not ready.")
    return binary


def _list_binaries(ctx: ToolContext, args: ListArgs) -> dict[str, Any]:
    from ...models.binary import BinaryFile

    rows = [{"binary_id": b.id, "filename": b.filename, "sha256": b.sha256_hash,
             "type": b.binary_type, "size": b.file_size, "status": b.status}
            for b in (ctx.db.query(BinaryFile).filter(BinaryFile.case_id == ctx.case.id)
                      .order_by(BinaryFile.uploaded_at).limit(args.limit))]
    return fit({"total": len(rows), "rows": rows})


BINARY_PARTS = ("summary", "sections", "imports", "exports", "strings")


class ReadBinaryArgs(BaseModel):
    binary_id: str = Field(..., description="Id from list_binaries")
    part: str = Field("summary", description="One of: " + ", ".join(BINARY_PARTS))
    contains: str | None = Field(None, description="Only entries containing this text (case-insensitive)")
    limit: int = Field(60, ge=1, le=200)


def _binary_entries(analysis: dict[str, Any], part: str, contains: str | None) -> list[Any]:
    entries = analysis.get(part) or []
    if contains:
        needle = contains.lower()
        entries = [e for e in entries if needle in json.dumps(e, default=str).lower()]
    return list(entries)


def _read_binary(ctx: ToolContext, args: ReadBinaryArgs) -> dict[str, Any]:
    if args.part not in BINARY_PARTS:
        raise ToolError(f"part must be one of: {', '.join(BINARY_PARTS)}")
    binary = _binary(ctx, args.binary_id)
    analysis = json.loads(str(binary.analysis_json))
    if args.part == "summary":
        keep = ("binary_type", "architecture", "entrypoint", "image_base", "overall_entropy")
        return {"binary_id": binary.id, "filename": binary.filename, "sha256": binary.sha256_hash,
                **{k: analysis.get(k) for k in keep},
                **{f"{k}_count": len(analysis.get(k) or []) for k in BINARY_PARTS[1:]},
                "high_entropy_sections": [s.get("name") for s in analysis.get("sections") or []
                                          if isinstance(s, dict) and (s.get("entropy") or 0) > 7.2]}
    entries = _binary_entries(analysis, args.part, args.contains)
    return fit({"binary_id": binary.id, "part": args.part, "matching": len(entries),
                "rows": _bounded(entries[: args.limit])})


#: A source observation quotes at most this many matching lines or entries:
#: more means the quote does not identify what the agent relied on.
MAX_SOURCE_MATCHES = 5


class RecordSourceObservationArgs(BaseModel):
    source: str = Field(..., description="memory, email or binary")
    source_id: str = Field(..., description="dump_id, email_id or binary_id")
    part: str = Field(..., description="memory: plugin name; email: " + ", ".join(EMAIL_PARTS[1:])
                      + "; binary: " + ", ".join(BINARY_PARTS[1:]))
    quote: str = Field(..., min_length=3, max_length=500,
                       description="Exact text that identifies the line or entry, e.g. a PID and process name")
    note: str = Field(..., min_length=1, max_length=2000, description="What it shows")


def _record_source_observation(ctx: ToolContext, args: RecordSourceObservationArgs) -> dict[str, Any]:
    """
    The memory, email and binary counterpart of `record_observation`: the quote
    is looked up in the source now, and what matches is copied.
    """
    agent_id, task_id = _require_caller(ctx)
    needle = args.quote.strip().lower()
    part = args.part.strip()
    if args.source == SOURCE_MEMORY:
        name = str(_dump(ctx, args.source_id).filename)
        matches: list[Any] = [line for line in _plugin_lines(ctx, args.source_id, part)
                              if needle in line.lower()]
    elif args.source == SOURCE_EMAIL:
        if part not in EMAIL_PARTS[1:]:
            raise ToolError(f"part must be one of: {', '.join(EMAIL_PARTS[1:])}")
        email = _email(ctx, args.source_id)
        name = str(email.filename)
        value = json.loads(str(email.analysis or "{}")).get(part)
        items = value if isinstance(value, list) else [value] if value else []
        matches = []
        for item in items:
            text = item if isinstance(item, str) else json.dumps(item, default=str)
            at = text.lower().find(needle)
            if at >= 0:
                matches.append(text[max(0, at - 200): at + len(needle) + 200])
    elif args.source == SOURCE_BINARY:
        if part not in BINARY_PARTS[1:]:
            raise ToolError(f"part must be one of: {', '.join(BINARY_PARTS[1:])}")
        binary = _binary(ctx, args.source_id)
        name = str(binary.filename)
        matches = _binary_entries(json.loads(str(binary.analysis_json)), part, needle)
    else:
        raise ToolError("source must be memory, email or binary. Use record_observation for tables.")
    if not matches:
        raise ToolError(f"'{args.quote}' does not appear in {part} of {name}.")
    if len(matches) > MAX_SOURCE_MATCHES:
        raise ToolError(f"'{args.quote}' matches {len(matches)} entries; quote more of the one you mean.")

    row = {f"match_{i + 1}": (m if isinstance(m, str) else json.dumps(m, default=str))[:MAX_OBSERVED_CELL_CHARS]
           for i, m in enumerate(matches)}
    observation = AgentObservation(
        case_id=ctx.case.id, agent_id=agent_id, task_id=task_id, source_kind=args.source,
        artifact_id=args.source_id, artifact_name=name, artifact_label=part,
        locator=f"{part}: {args.quote.strip()}", row=json.dumps(row), note=args.note.strip())
    ctx.db.add(observation)
    ctx.db.commit()
    return {"observation_id": observation.id, "row": {k: _cell(v) for k, v in row.items()},
            "note": "Cite this id in propose_finding."}


# ─── Incident log ─────────────────────────────────────────────────────────────

LOG_CATEGORIES = ("remediation", "handover", "communication", "investigation", "other")


class ProposeLogEntryArgs(BaseModel):
    time: str = Field(..., description="When it happened, UTC, yyyy-MM-ddTHH:mm:ssZ")
    category: str = Field("investigation", description="One of: " + ", ".join(LOG_CATEGORIES))
    title: str = Field(..., min_length=3, max_length=255)
    description: str = Field("", max_length=4000)
    actor: str = Field("", max_length=255, description="Who did it, if a person or team did")
    rationale: str = Field(..., min_length=1, description="Which task, finding or decision it records")


def _propose_log_entry(ctx: ToolContext, args: ProposeLogEntryArgs) -> dict[str, Any]:
    from datetime import UTC, datetime

    if args.category not in LOG_CATEGORIES:
        raise ToolError(f"category must be one of: {', '.join(LOG_CATEGORIES)}")
    try:
        when = datetime.fromisoformat(args.time.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise ToolError(f"Cannot read time '{args.time}'. Use yyyy-MM-ddTHH:mm:ssZ.") from exc
    when = (when.astimezone(UTC) if when.tzinfo else when).replace(tzinfo=None)
    title = args.title.strip()
    if any(p.get("title", "").lower() == title.lower() for p in _open_proposals(ctx, PROPOSAL_INCIDENT_LOG)):
        raise ToolError("Already proposed and waiting for the analyst.")
    payload = {"event_ts": when.isoformat(), "category": args.category, "title": title,
               "description": args.description.strip(), "actor": args.actor.strip()}
    return _propose(ctx, PROPOSAL_INCIDENT_LOG, payload, args.rationale, [],
                    f"{when.isoformat()}Z {title}")


# ─── Registry ─────────────────────────────────────────────────────────────────

TOOLS: dict[str, Tool] = {tool.name: tool for tool in (
    Tool("case_overview",
         "Case metadata (title, TLP, severity, client) and counts of what it holds.",
         NoArgs, _case_overview),
    Tool("ingest_status",
         "Files that came through the drop folder or a collection, with kind, state, hash and "
         "errors. Files uploaded on their own page are not here: use list_evidence.",
         IngestStatusArgs, _ingest_status),
    Tool("list_evidence",
         "Everything readable in the case - Explorer tables, emails, memory dumps, binaries - "
         "with the id each tool takes.",
         ListEvidenceArgs, _list_evidence),
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
    Tool("record_observation",
         "Keep one artifact row as evidence. The filter must match exactly one row.",
         RecordObservationArgs, _record_observation, PROPOSING),
    Tool("propose_finding",
         "Propose a finding resting on recorded observations, for review and analyst validation.",
         ProposeFindingArgs, _propose_finding, PROPOSING),
    Tool("list_findings", "Findings of the case with their state and review verdict.",
         ListFindingsArgs, _list_findings),
    Tool("read_finding", "One finding in full, with the rows of its observations and its review.",
         ReadFindingArgs, _read_finding),
    Tool("review_finding",
         "Give the verdict on a finding in review: does its evidence show what it claims?",
         ReviewFindingArgs, _review_finding, PROPOSING),
    Tool("report_outline", "The report's sections, their guidance, and how much is written.",
         NoArgs, _report_outline),
    Tool("propose_report_section",
         "Propose text for one report section, citing validated findings only.",
         ProposeSectionArgs, _propose_report_section, PROPOSING),
    Tool("propose_executive_summary",
         "Propose the executive summary, citing validated findings only.",
         ProposeSummaryArgs, _propose_executive_summary, PROPOSING),
    Tool("propose_ttp", "Propose an ATT&CK technique for the case matrix. Cite the evidence.",
         ProposeTtpArgs, _propose_ttp, PROPOSING),
    Tool("store_aggregate",
         "Count rows of one artifact per value of up to three columns, most or least frequent first.",
         StoreAggregateArgs, _store_aggregate),
    Tool("list_memory_dumps", "Memory dumps of the case and the Volatility plugins already run on each.",
         ListArgs, _list_memory_dumps),
    Tool("memory_output", "Lines of one Volatility plugin's output on a dump, optionally filtered.",
         MemoryOutputArgs, _memory_output),
    Tool("list_emails", "Emails analysed in the case, with subject, sender and warning count.",
         ListArgs, _list_emails),
    Tool("read_email", "One part of an email's analysis: headers, URLs, attachments, warnings, body.",
         ReadEmailArgs, _read_email),
    Tool("list_binaries", "Binaries analysed in the case, with hash, type and status.",
         ListArgs, _list_binaries),
    Tool("read_binary", "One part of a binary's static analysis: summary, sections, imports, exports, strings.",
         ReadBinaryArgs, _read_binary),
    Tool("record_source_observation",
         "Keep a memory plugin line, an email part or a binary entry as evidence, by quoting it.",
         RecordSourceObservationArgs, _record_source_observation, PROPOSING),
    Tool("propose_log_entry",
         "Propose an incident log entry: an action, decision or discovery and when it happened.",
         ProposeLogEntryArgs, _propose_log_entry, PROPOSING),
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
