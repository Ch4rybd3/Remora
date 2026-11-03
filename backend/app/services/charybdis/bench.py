"""
The evaluation bench (`docs/CHARYBDIS_FEATURES.md`, G9).

A golden case is a small piece of evidence whose content is known, a role and
an objective, and the things a good investigation of it must produce: an
indicator, a finding naming an account, a cited row. A run gives the case to
one agent on one model, in a scratch case deleted afterwards, and scores what
the agent proposed against those expectations. Comparing two models, or a
prompt before and after a change, is comparing their scores on the same cases.

Cases live in `templates/agents/bench/`, beside the roles they exercise, so a
prompt change and the evidence it was measured on are reviewed together.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from ...config import settings
from ...models.agent import (
    BENCH_DONE,
    BENCH_FAILED,
    PROPOSAL_IOC,
    PROPOSAL_TTP,
    TASK_KIND_ASSIGNED,
    AgentBenchRun,
    AgentFinding,
    AgentObservation,
    AgentProposal,
    AgentTask,
)
from ...models.case import Case
from ...models.csv_artifact import CsvArtifactFile
from ...models.user import User


class EvidenceDef(BaseModel):
    table: str | None = None
    email: str | None = None


class ExpectDef(BaseModel):
    kind: Literal["ioc", "ttp", "finding", "observation", "finding_or_report"]
    label: str
    value: str | None = None
    contains: list[str] | str | None = None

    def words(self) -> list[str]:
        if isinstance(self.contains, str):
            return [self.contains]
        return list(self.contains or [])


class CaseDef(BaseModel):
    description: str
    tags: str = ""


class BenchDef(BaseModel):
    id: str = Field(..., pattern=r"^[a-z][a-z0-9-]*$")
    title: str
    description: str = ""
    case: CaseDef
    role: str
    objective: str
    evidence: list[EvidenceDef] = Field(..., min_length=1)
    expect: list[ExpectDef] = Field(..., min_length=1)


class BenchError(Exception):
    """A golden case file is invalid. The message names the file."""


def bench_root() -> Path:
    return settings.templates_path / "agents" / "bench"


@lru_cache(maxsize=1)
def benches() -> dict[str, BenchDef]:
    found: dict[str, BenchDef] = {}
    for path in sorted(bench_root().glob("*.yaml")):
        try:
            bench = BenchDef.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        except (yaml.YAMLError, ValidationError) as exc:
            raise BenchError(f"bench/{path.name}: {exc}") from exc
        for item in bench.evidence:
            name = item.table or item.email
            if not name or not (bench_root() / "data" / name).is_file():
                raise BenchError(f"bench/{path.name}: evidence file {name!r} not found in bench/data")
        found[bench.id] = bench
    return found


@dataclass(frozen=True)
class Prepared:
    case_id: str
    task_id: str


def prepare(db: Session, run: AgentBenchRun) -> Prepared:
    """A scratch case holding the golden evidence, and the task that works it."""
    from .delegation import create_task, new_agent

    bench = benches()[run.bench_id]
    user = db.query(User).filter(User.username == run.started_by).one()
    case = Case(title=f"[bench] {bench.title}", description=bench.case.description,
                tags=f"charybdis-bench,{bench.case.tags}".strip(","), tlp="TLP:AMBER")
    db.add(case)
    db.flush()
    data = bench_root() / "data"
    for item in bench.evidence:
        if item.table:
            path = data / item.table
            columns = path.read_text(encoding="utf-8").splitlines()[0].split(",")
            rows = len(path.read_text(encoding="utf-8").splitlines()) - 1
            db.add(CsvArtifactFile(case_id=case.id, original_name=item.table, file_path=str(path),
                                   columns=json.dumps(columns), row_count=rows,
                                   date_column="TimeCreated" if "TimeCreated" in columns else None,
                                   ez_label="Event logs"))
        elif item.email:
            from ...routers.case_emails import register_email_file
            register_email_file(data / item.email, str(case.id), item.email, db)
    db.commit()
    agent = new_agent(db, str(case.id), bench.role, str(user.username or ""),
                      provider=run.provider, model=run.model)
    db.commit()
    task = create_task(db, agent=agent, objective=bench.objective, kind=TASK_KIND_ASSIGNED,
                       requested_by_id=str(user.id))
    return Prepared(str(case.id), task.id)


def score(db: Session, bench: BenchDef, case_id: str, task: AgentTask | None) -> list[dict]:
    """Each expectation, whether the run met it, and what met it."""
    proposals = db.query(AgentProposal).filter(AgentProposal.case_id == case_id).all()
    findings = db.query(AgentFinding).filter(AgentFinding.case_id == case_id).all()
    observations = db.query(AgentObservation).filter(AgentObservation.case_id == case_id).all()
    finding_texts = [f"{f.title}\n{f.statement}" for f in findings]
    report_texts = finding_texts + [task.report or "" if task else ""] + [p.payload for p in proposals]

    def first(texts: list[str], words: list[str]) -> str | None:
        for text in texts:
            if all(w.lower() in text.lower() for w in words):
                return text[:160]
        return None

    results = []
    for expect in bench.expect:
        matched: str | None = None
        if expect.kind in (PROPOSAL_IOC, PROPOSAL_TTP):
            key = "value" if expect.kind == PROPOSAL_IOC else "technique_id"
            values = [str(json.loads(p.payload or "{}").get(key, "")) for p in proposals if p.kind == expect.kind]
            wanted = (expect.value or "").lower()
            matched = next((v for v in values if v.lower() == wanted
                            or (expect.kind == PROPOSAL_TTP and v.lower().startswith(wanted))), None)
        elif expect.kind == "finding":
            matched = first(finding_texts, expect.words())
        elif expect.kind == "observation":
            matched = first([f"{o.locator}\n{o.row}" for o in observations], expect.words())
        else:
            matched = first(report_texts, expect.words())
        results.append({"label": expect.label, "kind": expect.kind, "met": matched is not None,
                        "matched": matched})
    return results


def finish(db: Session, run_id: str, prepared: Prepared | None, error: str | None) -> None:
    """Score the run, record what it cost, and delete its scratch case."""
    from .delegation import purge_case

    run = db.get(AgentBenchRun, run_id)
    if run is None:
        return
    if prepared is not None:
        task = db.get(AgentTask, prepared.task_id)
        results = score(db, benches()[run.bench_id], prepared.case_id, task)
        run.details = json.dumps(results)
        run.score = sum(1 for r in results if r["met"])
        run.total = len(results)
        if task is not None:
            run.tokens_in, run.tokens_out = task.tokens_in, task.tokens_out
            run.cost_usd, run.model_calls = task.cost_usd, task.steps_used
            error = error or (task.error if task.status != "done" else None)
        purge_case(db, prepared.case_id)
        db.query(CsvArtifactFile).filter(CsvArtifactFile.case_id == prepared.case_id).delete()
        from ...models.email_file import EmailFile
        db.query(EmailFile).filter(EmailFile.case_id == prepared.case_id).delete()
        case = db.get(Case, prepared.case_id)
        if case is not None:
            db.delete(case)
    run.status = BENCH_FAILED if error and not run.score else BENCH_DONE
    run.error = error
    run.finished_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()


async def run_bench(run_id: str) -> None:
    """Run one golden case to the end. Never raises: the outcome is on the run row."""
    from .runtime import _in_thread, run_task

    prepared: Prepared | None = None
    error: str | None = None
    try:
        def _prepare(db: Session) -> Prepared:
            run = db.get(AgentBenchRun, run_id)
            assert run is not None
            return prepare(db, run)
        prepared = await _in_thread(_prepare)
        await run_task(prepared.task_id)
    except Exception as exc:
        print(f"[charybdis] bench run {run_id} failed: {exc!r}", flush=True)
        error = f"The run failed ({type(exc).__name__}): {exc}"[:500]
    finally:
        done = prepared

        def _finish(db: Session) -> None:
            finish(db, run_id, done, error)
        await _in_thread(_finish)
