"""
The supervisor and the agent loop.

Agent loops outlive the request that started them, which `BackgroundTasks`
was not designed for, so a small supervisor runs on the application's event
loop: a queue of task ids and `charybdis_concurrency` workers draining it.
It runs in-process; the same entry points move to a separate container if
SQLite write contention ever calls for it (`docs/CHARYBDIS.md` section 5.3).

A task follows its role's process (`templates/agents/processes/`). A step ends
when the model answers without calling a tool; the answer is the step's
summary, and the next step's instructions are given as the next message. The
last step's answer is the task's report.

Database work never shares a session across threads: each piece opens its own
session in a worker thread (`_in_thread`) and closes it, so the event loop is
never blocked on SQLite or DuckDB.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from ...core import scoping
from ...core.deps import effective_grants
from ...database import SessionLocal
from ...models.agent import (
    AGENT_BLOCKED,
    AGENT_ERROR,
    AGENT_IDLE,
    AGENT_THINKING,
    AGENT_TOOL,
    EVENT_AGENT_MESSAGE,
    EVENT_ERROR,
    EVENT_PROPOSAL,
    EVENT_STATUS,
    EVENT_STEP,
    EVENT_THOUGHT,
    EVENT_TOOL_CALL,
    EVENT_TOOL_RESULT,
    EVENT_USER_MESSAGE,
    TASK_CANCELLED,
    TASK_DONE,
    TASK_FAILED,
    TASK_KIND_MESSAGE,
    TASK_PENDING,
    TASK_RUNNING,
    AgentEvent,
    AgentInstance,
    AgentTask,
)
from ...models.case import Case
from ...models.user import User
from . import delegation, events
from .definitions import ProcessDef, RoleDef, definitions, system_prompt
from .llm import ChatMessage, LLMError, PolicyDenied, ToolCall
from .llm import chat as llm_chat
from .tools import ToolContext, ToolError, agent_grants, run_tool, specs

#: Earlier analyst and agent messages replayed to the model, newest last.
HISTORY_MESSAGES = 20


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _in_thread[T](fn: Callable[[Session], T]) -> T:
    def _run() -> T:
        db = SessionLocal()
        try:
            return fn(db)
        finally:
            db.close()
    return await asyncio.to_thread(_run)


def _set_agent_status(db: Session, agent: AgentInstance, status: str, task_id: str | None) -> None:
    if agent.status == status:
        return
    agent.status = status
    db.commit()
    events.record(db, case_id=agent.case_id, agent_id=agent.id, task_id=task_id,
                  kind=EVENT_STATUS, payload={"status": status}, actor=agent.name)


@dataclass
class _Run:
    """What a task needs, loaded once at the start of the run."""
    task_id:   str
    agent_id:  str
    case_id:   str
    actor:     str
    provider:  str
    model:     str
    tlp:       str | None
    grants:    frozenset[str]
    role:      RoleDef
    process:   ProcessDef
    step_index: int
    messages:  list[ChatMessage]
    max_steps: int
    steps_used: int
    summaries: list[str] = field(default_factory=list)


# ─── Context ──────────────────────────────────────────────────────────────────

def _history(db: Session, agent: AgentInstance, exclude_task: str) -> list[ChatMessage]:
    """
    The agent's conversation so far: the analyst's messages, the agent's answers,
    and the analyst's decisions on its proposals - a rejection with a comment is
    feedback the agent must see the next time it works.
    """
    rows = (db.query(AgentEvent)
            .filter(AgentEvent.agent_id == agent.id,
                    AgentEvent.kind.in_((EVENT_USER_MESSAGE, EVENT_AGENT_MESSAGE, EVENT_PROPOSAL)))
            .order_by(AgentEvent.seq.desc())
            .limit(HISTORY_MESSAGES * 2)
            .all())
    messages: list[ChatMessage] = []
    for event in reversed(rows):
        payload = json.loads(event.payload or "{}")
        if event.kind == EVENT_PROPOSAL:
            if payload.get("action") not in ("accepted", "rejected"):
                continue
            note = f"[The analyst {payload['action']} your proposal: {payload.get('summary', '')}"
            if payload.get("comment"):
                note += f" - comment: {payload['comment']}"
            messages.append(ChatMessage("user", note + "]"))
        elif event.task_id != exclude_task:
            role = "user" if event.kind == EVENT_USER_MESSAGE else "assistant"
            messages.append(ChatMessage(role, payload.get("text", "")))
    return messages[-HISTORY_MESSAGES:]


def _step_message(process: ProcessDef, index: int) -> str:
    step = process.steps[index]
    total = len(process.steps)
    head = f"Step {index + 1}/{total}: {step.id}." if total > 1 else ""
    tail = ("\nAnswer without calling a tool when this step is done; your answer is its summary."
            if total > 1 else "")
    return f"{head}\n{step.instructions.strip()}{tail}".strip()


def _start(db: Session, task_id: str) -> _Run | None:
    """Claim a pending task and build its context. None if it cannot run now."""
    task = db.get(AgentTask, task_id)
    if task is None or task.status != TASK_PENDING:
        return None
    agent = db.get(AgentInstance, task.agent_id)
    case = db.get(Case, task.case_id)
    user = db.get(User, task.requested_by_id)
    if agent is None or case is None:
        return None
    # Left pending, and woken again when something else in the case finishes.
    if delegation.agent_is_busy(db, task) or not delegation.dependencies_met(db, task):
        return None

    # The analyst's rights are re-read now, not when they asked: a deactivated
    # account or a narrowed client scope stops its agents as well.
    refusal = None
    if user is None or not user.is_active:
        refusal = "The account that asked is no longer active."
    elif not scoping.may_see_case(db, user, str(case.id)):
        refusal = "The account that asked can no longer see this case."
    grants = agent_grants(effective_grants(user)[0]) if user else frozenset()
    if refusal is None and not grants:
        refusal = "The account that asked has no access to artifact data."
    if refusal:
        task.status, task.error, task.finished_at = TASK_FAILED, refusal, _now()
        db.commit()
        events.record(db, case_id=str(case.id), agent_id=agent.id, task_id=task.id,
                      kind=EVENT_ERROR, payload={"message": refusal}, actor=agent.name)
        return None

    defs = definitions()
    role = defs.role(agent.role)
    process = defs.processes.get(task.process_id or "") or defs.process_for(
        role, assigned=task.kind != TASK_KIND_MESSAGE)
    index, _ = process.step(task.current_step)

    task.status, task.started_at = TASK_RUNNING, task.started_at or _now()
    task.process_id = process.id
    task.current_step = process.steps[index].id
    db.commit()
    _set_agent_status(db, agent, AGENT_THINKING, task.id)

    messages = [ChatMessage("system", system_prompt(role, case))]
    messages += _history(db, agent, exclude_task=task.id)
    messages.append(ChatMessage("user", task.objective if task.kind == TASK_KIND_MESSAGE
                                else f"Your task:\n{task.objective}"))
    messages.append(ChatMessage("user", _step_message(process, index)))

    return _Run(task.id, agent.id, str(case.id), agent.name, agent.provider, agent.model,
                str(case.tlp) if case.tlp else None, grants, role, process, index,
                messages, task.max_steps, task.steps_used)


# ─── Writes the loop makes ────────────────────────────────────────────────────

def _is_cancelled(db: Session, task_id: str) -> bool:
    task = db.get(AgentTask, task_id)
    return task is None or task.status == TASK_CANCELLED


def _usage(run: _Run, tokens_in: int, tokens_out: int) -> Callable[[Session], None]:
    def _write(db: Session) -> None:
        task = db.get(AgentTask, run.task_id)
        if task is not None:
            task.steps_used += 1
            task.tokens_in += tokens_in
            task.tokens_out += tokens_out
            db.commit()
    return _write


def _record(run: _Run, kind: str, payload: dict[str, Any]) -> Callable[[Session], None]:
    def _write(db: Session) -> None:
        events.record(db, case_id=run.case_id, agent_id=run.agent_id, task_id=run.task_id,
                      kind=kind, payload=payload, actor=run.actor)
    return _write


def _agent_status(run: _Run, status: str) -> Callable[[Session], None]:
    def _write(db: Session) -> None:
        agent = db.get(AgentInstance, run.agent_id)
        if agent is not None:
            _set_agent_status(db, agent, status, run.task_id)
    return _write


def _advance(run: _Run, summary: str) -> Callable[[Session], None]:
    def _write(db: Session) -> None:
        task = db.get(AgentTask, run.task_id)
        if task is not None:
            task.current_step = run.process.steps[run.step_index].id
            db.commit()
        events.record(db, case_id=run.case_id, agent_id=run.agent_id, task_id=run.task_id,
                      kind=EVENT_STEP,
                      payload={"step": run.process.steps[run.step_index - 1].id,
                               "next": run.process.steps[run.step_index].id,
                               "summary": summary},
                      actor=run.actor)
    return _write


def _execute_tool(run: _Run, call: ToolCall, allowed: list[str]) -> Callable[[Session], dict[str, Any]]:
    def _go(db: Session) -> dict[str, Any]:
        case = db.get(Case, run.case_id)
        if case is None:
            return {"ok": False, "error": "The case no longer exists."}
        ctx = ToolContext(db, case, run.grants, agent_id=run.agent_id, task_id=run.task_id,
                          actor=run.actor)
        try:
            return {"ok": True, "result": run_tool(ctx, call.name, call.arguments, allowed)}
        except ToolError as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:
            db.rollback()
            print(f"[charybdis] tool {call.name} crashed: {exc!r}", flush=True)
            return {"ok": False, "error": f"The tool failed ({type(exc).__name__})."}
    return _go


def _finish(run: _Run, status: str, error: str | None, agent_status: str,
            report: str | None = None) -> Callable[[Session], list[str]]:
    """Close the task, hand its report up, and return the tasks that may now run."""
    def _write(db: Session) -> list[str]:
        task = db.get(AgentTask, run.task_id)
        if task is not None and task.status == TASK_RUNNING:
            task.status, task.error, task.finished_at = status, error, _now()
            if report is not None:
                task.report = report
            db.commit()
            delegation.report_to_leader(db, task)
        agent = db.get(AgentInstance, run.agent_id)
        if agent is not None:
            _set_agent_status(db, agent, agent_status, run.task_id)
        return delegation.waiting_tasks(db, run.case_id)
    return _write


# ─── The loop ─────────────────────────────────────────────────────────────────

async def run_task(task_id: str) -> list[str]:
    """Run one task to its end. Returns the case's tasks that may now be able to run."""
    run = await _in_thread(lambda db: _start(db, task_id))
    if run is None:
        return []

    calls_left = max(0, run.max_steps - run.steps_used)
    try:
        while calls_left > 0:
            if await _in_thread(lambda db: _is_cancelled(db, run.task_id)):
                await _in_thread(_agent_status(run, AGENT_IDLE))
                return await _in_thread(lambda db: delegation.waiting_tasks(db, run.case_id))

            step = run.process.steps[run.step_index]
            allowed = run.role.step_tools(step)
            result = await llm_chat(kind=run.provider, model=run.model, case_tlp=run.tlp,
                                    messages=run.messages, tools=specs(run.grants, allowed))
            calls_left -= 1
            await _in_thread(_usage(run, result.tokens_in, result.tokens_out))
            if result.thinking.strip():
                await _in_thread(_record(run, EVENT_THOUGHT, {"text": result.thinking.strip(),
                                                               "step": step.id}))

            if result.tool_calls:
                run.messages.append(ChatMessage("assistant", result.content,
                                                tool_calls=result.tool_calls))
                await _in_thread(_agent_status(run, AGENT_TOOL))
                for call in result.tool_calls:
                    await _in_thread(_record(run, EVENT_TOOL_CALL, {"tool": call.name,
                                                                    "arguments": call.arguments,
                                                                    "step": step.id}))
                    outcome = await _in_thread(_execute_tool(run, call, allowed))
                    await _in_thread(_record(run, EVENT_TOOL_RESULT, {"tool": call.name, **outcome}))
                    run.messages.append(ChatMessage("tool", json.dumps(outcome, default=str),
                                                    tool_name=call.name))
                await _in_thread(_agent_status(run, AGENT_THINKING))
                continue

            # An answer without tool calls ends the step.
            summary = result.content.strip()
            run.summaries.append(summary)
            run.messages.append(ChatMessage("assistant", summary))
            if run.step_index + 1 < len(run.process.steps):
                run.step_index += 1
                await _in_thread(_advance(run, summary))
                run.messages.append(ChatMessage("user", _step_message(run.process, run.step_index)))
                continue

            await _in_thread(_record(run, EVENT_AGENT_MESSAGE, {"text": summary}))
            return await _in_thread(_finish(run, TASK_DONE, None, AGENT_IDLE, report=summary))

        message = (f"Stopped after {run.max_steps} model calls, at step "
                   f"'{run.process.steps[run.step_index].id}'. Ask a narrower question, or continue.")
        await _in_thread(_record(run, EVENT_ERROR, {"message": message, "reason": "budget"}))
        partial = "\n\n".join(run.summaries) or None
        return await _in_thread(_finish(run, TASK_FAILED, message, AGENT_BLOCKED, report=partial))
    except PolicyDenied as exc:
        await _in_thread(_record(run, EVENT_ERROR, {"message": str(exc), "reason": "policy"}))
        return await _in_thread(_finish(run, TASK_FAILED, str(exc), AGENT_BLOCKED))
    except LLMError as exc:
        await _in_thread(_record(run, EVENT_ERROR, {"message": str(exc), "reason": "provider"}))
        return await _in_thread(_finish(run, TASK_FAILED, str(exc), AGENT_BLOCKED))
    except Exception as exc:
        print(f"[charybdis] task {run.task_id} crashed: {exc!r}", flush=True)
        message = f"Internal error ({type(exc).__name__})."
        await _in_thread(_record(run, EVENT_ERROR, {"message": message, "reason": "internal"}))
        return await _in_thread(_finish(run, TASK_FAILED, message, AGENT_ERROR))


# ─── Supervisor ───────────────────────────────────────────────────────────────

class Supervisor:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._workers: list[asyncio.Task[None]] = []
        self._queued: set[str] = set()

    @property
    def running(self) -> bool:
        return bool(self._workers)

    async def start(self, concurrency: int) -> None:
        if self._workers:
            return
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()
        events.bus.bind(self._loop)
        pending = await _in_thread(_recover)
        for task_id in pending:
            self._put(task_id)
        self._workers = [asyncio.create_task(self._work(), name=f"charybdis-worker-{i}")
                         for i in range(max(1, concurrency))]
        print(f"[charybdis] supervisor started, {len(self._workers)} worker(s), "
              f"{len(pending)} task(s) resumed", flush=True)

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers = []

    def _put(self, task_id: str) -> None:
        # A task already waiting in the queue is not queued twice.
        if self._queue is not None and task_id not in self._queued:
            self._queued.add(task_id)
            self._queue.put_nowait(task_id)

    def enqueue(self, task_id: str) -> None:
        """Safe from a request thread as well as from the loop."""
        if self._loop is None or self._queue is None:
            return
        self._loop.call_soon_threadsafe(self._put, task_id)

    async def _work(self) -> None:
        assert self._queue is not None
        while True:
            task_id = await self._queue.get()
            self._queued.discard(task_id)
            try:
                for woken in await run_task(task_id):
                    if woken != task_id:
                        self._put(woken)
            except Exception as exc:
                print(f"[charybdis] worker error on {task_id}: {exc!r}", flush=True)
            finally:
                self._queue.task_done()


def _recover(db: Session) -> list[str]:
    """
    Make the state after a restart honest.

    A task that was running when the process died did not finish, and saying
    so is better than resuming a model call half way. Pending tasks never
    started, so they are queued again.
    """
    interrupted = db.query(AgentTask).filter(AgentTask.status == TASK_RUNNING).all()
    for task in interrupted:
        task.status, task.error, task.finished_at = TASK_FAILED, "Interrupted by a restart.", _now()
    db.query(AgentInstance).filter(AgentInstance.status != AGENT_IDLE).update(
        {AgentInstance.status: AGENT_IDLE}, synchronize_session=False)
    db.commit()
    for task in interrupted:
        events.record(db, case_id=task.case_id, agent_id=task.agent_id, task_id=task.id,
                      kind=EVENT_ERROR, payload={"message": "Interrupted by a restart.",
                                                 "reason": "restart"})
    return [task_id for (task_id,) in
            db.query(AgentTask.id).filter(AgentTask.status == TASK_PENDING)
            .order_by(AgentTask.created_at)]


supervisor = Supervisor()
