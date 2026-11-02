"""
Charybdis — agents on a case, their tasks and their trace.

Registered only when `CHARYBDIS_ENABLED` is set, except `features_router`,
which is how the interface learns whether to show the module at all.

There is no route that deletes an agent. Its events are part of the case's
hash-chained trace, and removing them would break the chain for every event
that follows; an agent goes when its case goes. See docs/CHARYBDIS.md.
"""
from __future__ import annotations

import asyncio

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.orm import Session

from ..config import settings
from ..core import permissions, scoping
from ..core.deps import _decode_token, effective_grants, get_current_user
from ..database import SessionLocal, get_db
from ..models.agent import (
    EVENT_STATUS,
    EVENT_USER_MESSAGE,
    TASK_CANCELLED,
    TASK_OPEN,
    AgentEvent,
    AgentInstance,
    AgentTask,
)
from ..models.case import Case
from ..models.user import User
from ..schemas.agent import (
    AgentCreate,
    AgentEventRead,
    AgentMessageCreate,
    AgentRead,
    AgentTaskRead,
    AgentUpdate,
    ChainVerification,
    LLMHealth,
    ModelRead,
    RoleRead,
    ToolRead,
)
from ..services.audit_service import audit_log
from ..services.charybdis import events
from ..services.charybdis.llm import get_provider
from ..services.charybdis.prompts import ROLES
from ..services.charybdis.runtime import supervisor
from ..services.charybdis.tools import TOOLS

router = APIRouter(prefix="/cases/{case_id}/agents", tags=["agents"])
catalog_router = APIRouter(prefix="/agents", tags=["agents"])
socket_router = APIRouter(prefix="/agents", tags=["agents"])
features_router = APIRouter(tags=["features"])

DEFAULT_PROVIDER = "ollama"


@features_router.get("/features")
def features() -> dict[str, bool]:
    """Optional modules this installation runs."""
    return {"charybdis": settings.charybdis_enabled}


def _get_case(case_id: str, db: Session) -> Case:
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _get_agent(case_id: str, agent_id: str, db: Session) -> AgentInstance:
    agent = db.get(AgentInstance, agent_id)
    if agent is None or agent.case_id != case_id:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


# ─── Agents ───────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[AgentRead])
def list_agents(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return (db.query(AgentInstance).filter(AgentInstance.case_id == case_id)
            .order_by(AgentInstance.created_at).all())


@router.post("/", response_model=AgentRead, status_code=status.HTTP_201_CREATED)
def create_agent(
    case_id: str,
    payload: AgentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    role = ROLES.get(payload.role)
    if role is None:
        raise HTTPException(status_code=422, detail=f"Unknown agent role '{payload.role}'")
    existing = db.query(AgentInstance).filter(AgentInstance.case_id == case_id).count()
    agent = AgentInstance(
        case_id=case_id,
        role=role.id,
        name=(payload.name or "").strip() or (role.name if not existing else f"{role.name} {existing + 1}"),
        provider=DEFAULT_PROVIDER,
        model=(payload.model or "").strip() or settings.charybdis_default_model,
        launched_by=current_user.username or "",
    )
    db.add(agent)
    db.flush()
    audit_log(db, user=current_user, action="agent.create", request=request,
              resource_type="agent", resource_id=agent.id, resource_name=agent.name,
              case_id=case_id, case_title=str(case.title),
              details={"role": agent.role, "provider": agent.provider, "model": agent.model})
    db.commit()
    db.refresh(agent)
    return agent


@router.patch("/{agent_id}", response_model=AgentRead)
def update_agent(
    case_id: str,
    agent_id: str,
    payload: AgentUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    agent = _get_agent(case_id, agent_id, db)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(agent, field, value.strip())
    audit_log(db, user=current_user, action="agent.update", request=request,
              resource_type="agent", resource_id=agent.id, resource_name=agent.name,
              case_id=case_id, case_title=str(case.title), details=changes)
    db.commit()
    db.refresh(agent)
    return agent


# ─── Messages and tasks ───────────────────────────────────────────────────────

@router.post("/{agent_id}/messages", response_model=AgentTaskRead,
             status_code=status.HTTP_202_ACCEPTED)
def send_message(
    case_id: str,
    agent_id: str,
    payload: AgentMessageCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Give the agent something to do. Answers at once; the work and its result
    arrive on the trace, over the WebSocket.
    """
    case = _get_case(case_id, db)
    agent = _get_agent(case_id, agent_id, db)
    busy = (db.query(AgentTask)
            .filter(AgentTask.agent_id == agent.id, AgentTask.status.in_(TASK_OPEN))
            .first())
    if busy is not None:
        raise HTTPException(status_code=409,
                            detail="The agent is still working on the previous message")

    task = AgentTask(case_id=case_id, agent_id=agent.id, objective=payload.content.strip(),
                     requested_by_id=current_user.id, max_steps=settings.charybdis_max_steps)
    db.add(task)
    db.flush()
    audit_log(db, user=current_user, action="agent.message", request=request,
              resource_type="agent", resource_id=agent.id, resource_name=agent.name,
              case_id=case_id, case_title=str(case.title), details={"task_id": task.id})
    db.commit()
    db.refresh(task)

    events.record(db, case_id=case_id, agent_id=agent.id, task_id=task.id,
                  kind=EVENT_USER_MESSAGE, payload={"text": task.objective},
                  actor=current_user.username or "")
    supervisor.enqueue(task.id)
    return task


@router.post("/{agent_id}/tasks/{task_id}/cancel", response_model=AgentTaskRead)
def cancel_task(
    case_id: str,
    agent_id: str,
    task_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stop a task. A model call already in flight finishes; nothing after it runs."""
    case = _get_case(case_id, db)
    agent = _get_agent(case_id, agent_id, db)
    task = db.get(AgentTask, task_id)
    if task is None or task.agent_id != agent.id:
        raise HTTPException(status_code=404, detail="Agent task not found")
    if task.status not in TASK_OPEN:
        raise HTTPException(status_code=409, detail=f"The task is already {task.status}")
    task.status = TASK_CANCELLED
    audit_log(db, user=current_user, action="agent.task_cancel", request=request,
              resource_type="agent_task", resource_id=task.id, resource_name=agent.name,
              case_id=case_id, case_title=str(case.title))
    db.commit()
    db.refresh(task)
    events.record(db, case_id=case_id, agent_id=agent.id, task_id=task.id,
                  kind=EVENT_STATUS, payload={"status": "cancelled"},
                  actor=current_user.username or "")
    return task


@router.get("/tasks", response_model=list[AgentTaskRead])
def list_tasks(
    case_id: str,
    agent_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    _get_case(case_id, db)
    query = db.query(AgentTask).filter(AgentTask.case_id == case_id)
    if agent_id:
        query = query.filter(AgentTask.agent_id == agent_id)
    return query.order_by(AgentTask.created_at.desc()).limit(limit).all()


# ─── Trace ────────────────────────────────────────────────────────────────────

@router.get("/events", response_model=list[AgentEventRead])
def list_events(
    case_id: str,
    after_seq: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    _get_case(case_id, db)
    rows = (db.query(AgentEvent)
            .filter(AgentEvent.case_id == case_id, AgentEvent.seq > after_seq)
            .order_by(AgentEvent.seq).limit(limit).all())
    return [events.serialise(e) for e in rows]


@router.get("/events/verify", response_model=ChainVerification)
def verify_events(case_id: str, db: Session = Depends(get_db)):
    """Recompute the trace's hash chain. `ok` is false from the first altered event."""
    _get_case(case_id, db)
    return events.verify_chain(db, case_id)


# ─── Catalogue and provider health ────────────────────────────────────────────

@catalog_router.get("/roles", response_model=list[RoleRead])
def list_roles():
    return [RoleRead(id=r.id, name=r.name, description=r.description) for r in ROLES.values()]


@catalog_router.get("/tools", response_model=list[ToolRead])
def list_tools():
    return [ToolRead(name=t.name, description=t.description) for t in TOOLS.values()]


@catalog_router.get("/llm/health", response_model=LLMHealth)
async def llm_health():
    health = await get_provider(DEFAULT_PROVIDER).health()
    return LLMHealth(
        provider=DEFAULT_PROVIDER,
        reachable=health.reachable,
        detail=health.detail,
        default_model=settings.charybdis_default_model,
        models=[ModelRead(name=m.name, size_bytes=m.size_bytes) for m in health.models],
    )


# ─── Live trace ───────────────────────────────────────────────────────────────

#: Close codes. 4401/4403/4404 mirror the HTTP answers a request would get.
WS_UNAUTHENTICATED = 4401
WS_FORBIDDEN       = 4403
WS_NOT_FOUND       = 4404


def authorise_socket(db: Session, token: str, case_id: str) -> tuple[User | None, int | None]:
    """
    The checks `enforce_permissions` makes for HTTP, made by hand.

    A WebSocket cannot carry the bearer header and does not run router
    dependencies, so this is the one route that has to state its own rules:
    an active account, artifact access, and the case within its client scope.
    A scoped account gets "not found" for a case outside its clients, as it
    does over HTTP, so the socket cannot be used to probe for case ids.
    """
    user = _decode_token(token, db)
    if user is None or not user.is_active:
        return None, WS_UNAUTHENTICATED
    granted, _ = effective_grants(user)
    if permissions.PERM_ARTIFACTS not in granted:
        return None, WS_FORBIDDEN
    if db.get(Case, case_id) is None or not scoping.may_see_case(db, user, case_id):
        return None, WS_NOT_FOUND
    return user, None


@socket_router.websocket("/ws")
async def agents_socket(
    websocket: WebSocket,
    case_id: str = Query(...),
    token: str = Query(..., description="JWT access token"),
    after_seq: int = Query(0, ge=0),
) -> None:
    """Every new event of a case, starting after `after_seq`."""
    def _authorise() -> tuple[User | None, int | None]:
        db = SessionLocal()
        try:
            return authorise_socket(db, token, case_id)
        finally:
            db.close()

    user, refusal = await asyncio.to_thread(_authorise)
    if refusal is not None:
        await websocket.close(code=refusal)
        return

    await websocket.accept()
    # Subscribe before reading the backlog, so nothing written in between is
    # lost. The client drops anything it has already seen by `seq`.
    queue = events.bus.subscribe(case_id)
    receiver: asyncio.Task[str] | None = None
    try:
        def _backlog() -> list[dict]:
            db = SessionLocal()
            try:
                rows = (db.query(AgentEvent)
                        .filter(AgentEvent.case_id == case_id, AgentEvent.seq > after_seq)
                        .order_by(AgentEvent.seq).limit(2000).all())
                return [events.serialise(e) for e in rows]
            finally:
                db.close()

        for event in await asyncio.to_thread(_backlog):
            await websocket.send_json({"type": "event", "event": event})
        await websocket.send_json({"type": "ready"})

        receiver = asyncio.create_task(websocket.receive_text())
        while True:
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({getter, receiver}, return_when=asyncio.FIRST_COMPLETED)
            if receiver in done:
                getter.cancel()
                # The client only ever closes; anything it sends is ignored.
                receiver.result()
                receiver = asyncio.create_task(websocket.receive_text())
                continue
            await websocket.send_json(getter.result())
    except WebSocketDisconnect:
        pass
    finally:
        events.bus.unsubscribe(case_id, queue)
        if receiver is not None:
            receiver.cancel()
