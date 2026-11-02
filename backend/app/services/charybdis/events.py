"""
The trace: every message, thought, tool call and result, in order.

Two halves. `append_event` writes a row - append-only, numbered per case, and
chained by hash to the row before it, so that editing or deleting any event
breaks verification from that point on. `bus` fans each new event out to the
browsers watching the case, over the WebSocket in `routers/agents.py`.

The hash is tamper *evidence*, not tamper proof: someone with write access to
the database can recompute the chain. What it does guarantee is that a trace
which verifies has not been altered through anything but a full rewrite, and
that a partial edit - the realistic accident - is caught.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import threading
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.agent import EVENT_KINDS, AgentEvent

# One writer at a time per process. `seq` is max+1, and two threads reading
# the same max would collide on the unique index.
_append_lock = threading.Lock()


def _digest(prev_hash: str, *, case_id: str, seq: int, kind: str, agent_id: str | None,
            task_id: str | None, actor: str, payload: str, created_at: datetime) -> str:
    canonical = json.dumps(
        [prev_hash, case_id, seq, kind, agent_id, task_id, actor, payload,
         created_at.replace(tzinfo=None).isoformat()],
        separators=(",", ":"), ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def append_event(
    db: Session, *, case_id: str, kind: str, payload: dict[str, Any],
    agent_id: str | None = None, task_id: str | None = None, actor: str = "",
) -> AgentEvent:
    """Write one event and commit it. Returns the stored row."""
    if kind not in EVENT_KINDS:
        raise ValueError(f"Unknown agent event kind '{kind}'")
    body = json.dumps(payload, default=str, ensure_ascii=False)
    with _append_lock:
        last = (db.query(AgentEvent.seq, AgentEvent.hash)
                .filter(AgentEvent.case_id == case_id)
                .order_by(AgentEvent.seq.desc())
                .first())
        seq, prev_hash = (last[0] + 1, last[1]) if last else (1, "")
        created_at = datetime.now(UTC).replace(tzinfo=None)
        event = AgentEvent(
            case_id=case_id, agent_id=agent_id, task_id=task_id, seq=seq, kind=kind,
            payload=body, actor=actor, prev_hash=prev_hash, created_at=created_at,
            hash=_digest(prev_hash, case_id=case_id, seq=seq, kind=kind, agent_id=agent_id,
                         task_id=task_id, actor=actor, payload=body, created_at=created_at),
        )
        db.add(event)
        db.commit()
    db.refresh(event)
    return event


def serialise(event: AgentEvent) -> dict[str, Any]:
    return {
        "id":         event.id,
        "case_id":    event.case_id,
        "agent_id":   event.agent_id,
        "task_id":    event.task_id,
        "seq":        event.seq,
        "kind":       event.kind,
        "payload":    json.loads(event.payload or "{}"),
        "actor":      event.actor,
        "hash":       event.hash,
        "created_at": event.created_at.isoformat() + "Z",
    }


def verify_chain(db: Session, case_id: str) -> dict[str, Any]:
    """Recompute the chain for a case. Reports the first event that fails."""
    prev_hash = ""
    expected_seq = 1
    count = 0
    for event in (db.query(AgentEvent).filter(AgentEvent.case_id == case_id)
                  .order_by(AgentEvent.seq).yield_per(500)):
        count += 1
        recomputed = _digest(prev_hash, case_id=event.case_id, seq=event.seq, kind=event.kind,
                             agent_id=event.agent_id, task_id=event.task_id, actor=event.actor,
                             payload=event.payload, created_at=event.created_at)
        if event.seq != expected_seq or event.prev_hash != prev_hash or event.hash != recomputed:
            return {"ok": False, "events": count, "broken_at_seq": event.seq}
        prev_hash, expected_seq = event.hash, expected_seq + 1
    return {"ok": True, "events": count, "broken_at_seq": None}


def last_seq(db: Session, case_id: str) -> int:
    return int(db.query(func.max(AgentEvent.seq)).filter(AgentEvent.case_id == case_id).scalar() or 0)


# ─── Live fan-out ─────────────────────────────────────────────────────────────

class EventBus:
    """
    Per-case subscriber queues, owned by the application's event loop.

    Events are produced in two places: the agent loop, which runs on the event
    loop, and the REST handlers, which FastAPI runs in a worker thread.
    `publish` is safe from both.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, case_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self._subscribers[case_id].add(queue)
        return queue

    def unsubscribe(self, case_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers[case_id].discard(queue)
        if not self._subscribers[case_id]:
            self._subscribers.pop(case_id, None)

    def _deliver(self, case_id: str, message: dict[str, Any]) -> None:
        for queue in list(self._subscribers.get(case_id, ())):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # A browser that stopped reading. It resumes from `seq` on
                # reconnect, so dropping here loses nothing permanently.
                pass

    def publish(self, case_id: str, message: dict[str, Any]) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is loop:
            self._deliver(case_id, message)
        else:
            loop.call_soon_threadsafe(self._deliver, case_id, message)


bus = EventBus()


def record(db: Session, **kwargs: Any) -> dict[str, Any]:
    """Append an event and publish it. The usual way to write to the trace."""
    event = serialise(append_event(db, **kwargs))
    bus.publish(event["case_id"], {"type": "event", "event": event})
    return event
