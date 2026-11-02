"""
What an agent can do, as typed adapters over Remora services.

An agent never gets a shell, a path or SQL. Each tool takes arguments that a
Pydantic model validates, reaches data through the same service the
interface uses, and returns a bounded JSON object. Everything in S30 reads;
nothing writes.

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

from ...core.permissions import PERM_ARTIFACTS
from ...models.asset import Asset
from ...models.case import Case
from ...models.client import Client
from ...models.csv_artifact import CsvArtifactFile
from ...models.ingest import IngestedFile
from ...models.ioc import IOC
from ...models.timeline import TimelineEvent
from ..store import Query, Source, SourceMissing, get_store
from .llm import ToolSpec

#: What an agent may ever hold, whoever launched it. Intersected with the
#: launching user's own grants, so an agent is never more than its analyst
#: and, in S30, never able to write (`docs/CHARYBDIS.md` section 3).
AGENT_PERMISSIONS = frozenset({PERM_ARTIFACTS})

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
    db:     Session
    case:   Case
    grants: frozenset[str]


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
    return fit({"total": total, "rows": rows})


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
)}


def specs(grants: frozenset[str]) -> list[ToolSpec]:
    """The tools an agent holding `grants` is offered."""
    return [tool.spec() for tool in TOOLS.values() if tool.requires <= grants]


def run_tool(ctx: ToolContext, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate and run one call. Raises ToolError for anything the model got wrong."""
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolError(f"Unknown tool '{name}'. Available: {', '.join(TOOLS)}")
    if not tool.requires <= ctx.grants:
        raise ToolError(f"Tool '{name}' is not permitted for this agent.")
    try:
        args = tool.params.model_validate(arguments or {})
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'arguments'}: {e['msg']}"
                             for e in exc.errors())
        raise ToolError(f"Invalid arguments for {name}: {problems}") from exc
    return tool.run(ctx, args)
