"""
Charybdis S30: the gateway, the trace, the tools, the loop and the routes.

No test reaches a model. The loop runs against `FakeProvider`, which replays
a script of responses, and the configured Ollama URL points at a closed port.
"""
from __future__ import annotations

import time
import uuid
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import settings
from app.models.agent import AgentEvent
from app.models.case import Case
from app.models.user import User, UserRole
from app.services.auth_service import create_access_token, hash_password
from app.services.charybdis import events
from app.services.charybdis.llm import (
    ChatResult,
    Locality,
    ProviderHealth,
    ToolCall,
    provider_allowed,
    set_provider,
)
from app.services.charybdis.llm.gateway import _providers
from app.services.charybdis.llm.ollama import OllamaProvider, parse_chat_response
from app.services.charybdis.tools import (
    AGENT_PERMISSIONS,
    TOOLS,
    ToolContext,
    ToolError,
    fit,
    run_tool,
    specs,
)


class FakeProvider:
    kind = "ollama"

    def __init__(self, script: list[ChatResult], locality: Locality = Locality.LOCAL):
        self.script = list(script)
        self.locality = locality
        self.calls: list[list] = []

    async def chat(self, model, messages, tools):
        self.calls.append(list(messages))
        if len(self.script) > 1:
            return self.script.pop(0)
        return self.script[0]

    async def health(self):
        return ProviderHealth(reachable=True, models=[])


@pytest.fixture()
def fake_provider() -> Iterator[None]:
    saved = dict(_providers)
    yield
    _providers.clear()
    _providers.update(saved)


def _wait_for(auth_client: TestClient, case_id: str, kind: str, timeout: float = 10.0) -> list[dict]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        trace = auth_client.get(f"/api/v1/cases/{case_id}/agents/events").json()
        if any(e["kind"] == kind for e in trace):
            return trace
        time.sleep(0.05)
    raise AssertionError(f"no {kind} event within {timeout}s: {[e['kind'] for e in trace]}")


def _staff(auth_client: TestClient, case_id: str) -> dict:
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/", json={})
    assert response.status_code == 201, response.text
    return response.json()


# ─── Gateway ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("tlp", "local", "cloud"), [
    ("TLP:RED",          True, False),
    ("TLP:AMBER+STRICT", True, False),
    ("amber+strict",     True, False),
    ("TLP:AMBER",        True, True),
    ("TLP:GREEN",        True, True),
    ("TLP:CLEAR",        True, True),
    ("",                 True, False),
    (None,               True, False),
])
def test_the_tlp_decides_which_providers_a_case_may_reach(tlp, local, cloud):
    assert provider_allowed(tlp, Locality.LOCAL) is local
    assert provider_allowed(tlp, Locality.CLOUD) is cloud


def test_an_ollama_response_with_tool_calls_is_parsed():
    result = parse_chat_response({
        "message": {
            "content": "",
            "thinking": "Need the overview first.",
            "tool_calls": [
                {"function": {"name": "case_overview", "arguments": {}}},
                {"function": {"name": "store_search", "arguments": '{"artifact_id": "a1"}'}},
                {"function": {"arguments": {}}},
            ],
        },
        "prompt_eval_count": 120,
        "eval_count": 30,
    })
    assert [c.name for c in result.tool_calls] == ["case_overview", "store_search"]
    assert result.tool_calls[1].arguments == {"artifact_id": "a1"}
    assert result.thinking == "Need the overview first."
    assert (result.tokens_in, result.tokens_out) == (120, 30)


def test_ollama_sends_the_context_window_and_reports_a_missing_model():
    import asyncio

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(__import__("json").loads(request.content))
        return httpx.Response(404, json={"error": "model not found"})

    provider = OllamaProvider("http://ollama.test", timeout_seconds=5, num_ctx=8192,
                              transport=httpx.MockTransport(handler))
    with pytest.raises(Exception, match="ollama pull qwen3:8b"):
        asyncio.run(provider.chat("qwen3:8b", [], []))
    assert seen["options"]["num_ctx"] == 8192
    assert seen["stream"] is False


# ─── Trace ────────────────────────────────────────────────────────────────────

def test_the_trace_is_numbered_and_chained(db_session, case_id):
    for i in range(3):
        events.append_event(db_session, case_id=case_id, kind="status", payload={"n": i})
    rows = (db_session.query(AgentEvent).filter(AgentEvent.case_id == case_id)
            .order_by(AgentEvent.seq).all())
    assert [r.seq for r in rows] == [1, 2, 3]
    assert rows[0].prev_hash == ""
    assert rows[1].prev_hash == rows[0].hash
    assert events.verify_chain(db_session, case_id) == {"ok": True, "events": 3, "broken_at_seq": None}


def test_an_edited_event_breaks_the_chain_from_that_point(db_session, case_id):
    for i in range(3):
        events.append_event(db_session, case_id=case_id, kind="status", payload={"n": i})
    db_session.execute(
        text("UPDATE agent_events SET payload = :p WHERE case_id = :c AND seq = 2"),
        {"p": '{"n": 99}', "c": case_id})
    db_session.commit()
    result = events.verify_chain(db_session, case_id)
    assert result["ok"] is False
    assert result["broken_at_seq"] == 2


def test_an_unknown_event_kind_is_refused(db_session, case_id):
    with pytest.raises(ValueError):
        events.append_event(db_session, case_id=case_id, kind="made.up", payload={})


# ─── Tools ────────────────────────────────────────────────────────────────────

def test_agents_read_artifacts_and_propose_and_nothing_else():
    from app.core.permissions import PERM_ARTIFACTS
    from app.services.charybdis.tools import PERM_PROPOSE
    assert AGENT_PERMISSIONS == frozenset({PERM_ARTIFACTS, PERM_PROPOSE})


@pytest.mark.parametrize(("role", "expected"), [
    (UserRole.analyst,   {"artifacts", "propose"}),
    (UserRole.read_only, {"artifacts"}),
    (UserRole.executive, set()),
])
def test_an_agent_is_never_more_than_its_analyst(role, expected):
    from app.core.permissions import permissions_for
    from app.services.charybdis.tools import agent_grants
    assert agent_grants(permissions_for(role)) == expected


def test_an_agent_without_grants_is_offered_no_tools():
    assert specs(frozenset()) == []
    assert {s.name for s in specs(AGENT_PERMISSIONS)} == set(TOOLS)


def test_tool_schemas_carry_no_titles():
    for spec in specs(AGENT_PERMISSIONS):
        assert "title" not in spec.parameters
        for prop in spec.parameters.get("properties", {}).values():
            assert "title" not in prop


def test_case_overview_describes_the_case(db_session, case_id):
    case = db_session.get(Case, case_id)
    result = run_tool(ToolContext(db_session, case, AGENT_PERMISSIONS), "case_overview", {})
    assert result["title"] == case.title
    assert set(result["counts"]) == {"iocs", "assets", "timeline_events", "artifacts"}


@pytest.mark.parametrize(("name", "arguments", "message"), [
    ("no_such_tool",  {},                       "not available"),
    ("ingest_status", {"limit": 0},             "Invalid arguments"),
    ("store_schema",  {},                       "Invalid arguments"),
    ("store_search",  {"artifact_id": "nope"},  "No artifact"),
])
def test_a_bad_call_comes_back_as_a_message_the_model_can_read(db_session, case_id, name,
                                                                arguments, message):
    case = db_session.get(Case, case_id)
    with pytest.raises(ToolError, match=message):
        run_tool(ToolContext(db_session, case, AGENT_PERMISSIONS), name, arguments)


def test_a_tool_needs_its_permission(db_session, case_id):
    case = db_session.get(Case, case_id)
    with pytest.raises(ToolError, match="not permitted"):
        run_tool(ToolContext(db_session, case, frozenset()), "case_overview", {})


def test_a_large_result_is_cut_and_says_so():
    result = fit({"rows": [{"x": "y" * 200} for _ in range(500)]})
    assert result["truncated"] is True
    assert 0 < len(result["rows"]) < 500


# ─── Routes and the loop ──────────────────────────────────────────────────────

def test_the_interface_can_ask_whether_charybdis_runs(auth_client):
    assert auth_client.get("/api/v1/features").json() == {"charybdis": True}


def test_an_unknown_role_is_refused(auth_client, case_id):
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/", json={"role": "wizard"})
    assert response.status_code == 422


def test_an_agent_is_staffed_with_the_default_model(auth_client, case_id):
    agent = _staff(auth_client, case_id)
    assert agent["model"] == settings.charybdis_default_model
    assert agent["provider"] == "ollama"
    assert agent["status"] == "idle"
    assert [a["id"] for a in auth_client.get(f"/api/v1/cases/{case_id}/agents/").json()] == [agent["id"]]


def test_a_message_runs_tools_and_ends_with_an_answer(auth_client, case_id, fake_provider):
    provider = FakeProvider([
        ChatResult(content="", tool_calls=[ToolCall("case_overview", {})],
                   thinking="Start with the overview.", tokens_in=50, tokens_out=10),
        ChatResult(content="The case has no artifacts yet.", tool_calls=[],
                   tokens_in=80, tokens_out=12),
    ])
    set_provider("ollama", provider)
    agent = _staff(auth_client, case_id)

    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages",
                                json={"content": "What is in this case?"})
    assert response.status_code == 202, response.text

    trace = _wait_for(auth_client, case_id, "message.agent")
    kinds = [e["kind"] for e in trace]
    assert kinds[0] == "message.user"
    assert "thought" in kinds and "tool.call" in kinds and "tool.result" in kinds
    result = next(e for e in trace if e["kind"] == "tool.result")
    assert result["payload"]["ok"] is True
    assert trace[-1]["kind"] in ("message.agent", "status")

    # The second model call saw the tool's answer.
    assert provider.calls[1][-1].role == "tool"
    assert provider.calls[0][0].role == "system"

    task = auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()[0]
    assert task["status"] == "done"
    assert (task["tokens_in"], task["tokens_out"], task["steps_used"]) == (130, 22, 2)
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/events/verify").json()["ok"] is True


def test_an_agent_that_never_answers_stops_at_its_budget(auth_client, case_id, fake_provider,
                                                         monkeypatch):
    monkeypatch.setattr(settings, "charybdis_max_steps", 2)
    set_provider("ollama", FakeProvider([
        ChatResult(content="", tool_calls=[ToolCall("case_overview", {})]),
    ]))
    agent = _staff(auth_client, case_id)
    auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages",
                     json={"content": "Loop forever"})

    trace = _wait_for(auth_client, case_id, "error")
    error = next(e for e in trace if e["kind"] == "error")
    assert error["payload"]["reason"] == "budget"
    task = auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()[0]
    assert task["status"] == "failed"
    assert task["steps_used"] == 2


def test_a_red_case_never_reaches_a_cloud_model(auth_client, db_session, case_id, fake_provider):
    db_session.get(Case, case_id).tlp = "TLP:RED"
    db_session.commit()
    cloud = FakeProvider([ChatResult(content="leaked", tool_calls=[])], locality=Locality.CLOUD)
    set_provider("ollama", cloud)
    agent = _staff(auth_client, case_id)
    auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages",
                     json={"content": "Summarise"})

    trace = _wait_for(auth_client, case_id, "error")
    assert next(e for e in trace if e["kind"] == "error")["payload"]["reason"] == "policy"
    assert cloud.calls == []
    assert not any(e["kind"] == "message.agent" for e in trace)


def test_a_second_message_waits_for_the_first(auth_client, db_session, case_id):
    from app.models.agent import AgentTask

    agent = _staff(auth_client, case_id)
    admin = db_session.query(User).filter(User.username == "admin").one()
    # A task the supervisor has not reached, without depending on its timing.
    db_session.add(AgentTask(case_id=case_id, agent_id=agent["id"], objective="busy",
                             requested_by_id=admin.id, status="running"))
    db_session.commit()
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages",
                                json={"content": "And now?"})
    assert response.status_code == 409


def test_an_agent_from_another_case_is_not_found(auth_client, db_session, case_id):
    agent = _staff(auth_client, case_id)
    other = str(uuid.uuid4())
    db_session.add(Case(id=other, title="Other case"))
    db_session.commit()
    response = auth_client.patch(f"/api/v1/cases/{other}/agents/{agent['id']}",
                                 json={"name": "Renamed"})
    assert response.status_code == 404


def test_the_llm_health_check_reports_an_unreachable_ollama(auth_client):
    body = auth_client.get("/api/v1/agents/llm/health").json()
    assert body["reachable"] is False
    assert body["default_model"] == settings.charybdis_default_model


# ─── The socket ───────────────────────────────────────────────────────────────

def _user(db_session, role: UserRole) -> User:
    user = User(username=f"ws-{uuid.uuid4().hex[:8]}", hashed_password=hash_password("x" * 12),
                role=role)
    db_session.add(user)
    db_session.commit()
    return user


def test_the_socket_states_its_own_access_rules(db_session, case_id):
    from app.routers.agents import authorise_socket

    analyst = _user(db_session, UserRole.analyst)
    executive = _user(db_session, UserRole.executive)
    good = create_access_token(analyst.id, analyst.role.value)

    assert authorise_socket(db_session, "not-a-token", case_id) == (None, 4401)
    assert authorise_socket(db_session, create_access_token(executive.id, "executive"),
                            case_id) == (None, 4403)
    assert authorise_socket(db_session, good, str(uuid.uuid4())) == (None, 4404)
    user, refusal = authorise_socket(db_session, good, case_id)
    assert refusal is None and user is not None and user.id == analyst.id


def test_the_socket_replays_the_backlog_then_signals_ready(client, token, db_session, case_id):
    events.append_event(db_session, case_id=case_id, kind="status", payload={"status": "idle"})
    events.append_event(db_session, case_id=case_id, kind="status", payload={"status": "idle"})
    with client.websocket_connect(
            f"/api/v1/agents/ws?case_id={case_id}&token={token}&after_seq=1") as socket:
        first = socket.receive_json()
        assert first["type"] == "event" and first["event"]["seq"] == 2
        assert socket.receive_json() == {"type": "ready"}


# ─── Restart ──────────────────────────────────────────────────────────────────

def test_a_restart_fails_running_tasks_and_requeues_pending_ones(auth_client, db_session, case_id):
    from app.models.agent import AgentInstance, AgentTask
    from app.services.charybdis.runtime import _recover

    agent = _staff(auth_client, case_id)
    admin = db_session.query(User).filter(User.username == "admin").one()
    running = AgentTask(case_id=case_id, agent_id=agent["id"], objective="mid-flight",
                        requested_by_id=admin.id, status="running")
    pending = AgentTask(case_id=case_id, agent_id=agent["id"], objective="not started",
                        requested_by_id=admin.id, status="pending")
    db_session.add_all([running, pending])
    db_session.get(AgentInstance, agent["id"]).status = "thinking"
    db_session.commit()

    requeued = _recover(db_session)

    db_session.expire_all()
    assert pending.id in requeued
    assert db_session.get(AgentTask, running.id).status == "failed"
    assert db_session.get(AgentTask, running.id).error == "Interrupted by a restart."
    assert db_session.get(AgentInstance, agent["id"]).status == "idle"
    trace = auth_client.get(f"/api/v1/cases/{case_id}/agents/events").json()
    assert any(e["kind"] == "error" and e["payload"]["reason"] == "restart" for e in trace)
