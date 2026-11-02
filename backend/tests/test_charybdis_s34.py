"""
Charybdis S34 part 2: model providers, TLP denials, models per role, cost.

No test reaches a model: configured providers are replaced by `FakeProvider`,
and the wire formats are checked on their pure conversion functions.
"""
from __future__ import annotations

import pytest
from test_charybdis import FakeProvider, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _say, _wait

from app.models.case import Case
from app.services.charybdis.llm import (
    ChatMessage,
    ChatResult,
    LLMError,
    Locality,
    ToolCall,
    set_provider,
)


def _provider(auth_client, name="cloudy", **extra):
    body = {"name": name, "kind": "openai", "base_url": "https://llm.example/v1",
            "locality": "cloud", "api_key": "sk-test-0123456789", "default_model": "big-model",
            "input_price": 2.0, "output_price": 10.0, **extra}
    response = auth_client.post("/api/v1/agents/providers", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _audit(auth_client, **params):
    response = auth_client.get("/api/v1/audit", params={"page_size": 200, **params})
    assert response.status_code == 200, response.text
    return response.json()["items"]


# ─── Providers ────────────────────────────────────────────────────────────────

def test_a_provider_key_is_stored_encrypted_and_never_returned(auth_client, db_session):
    from app.models.agent import AgentProvider
    from app.services.mfa import decrypt_secret

    created = _provider(auth_client, name="keyed")
    assert created["has_key"] is True and created["key_hint"] == "6789"
    assert "sk-test" not in str(auth_client.get("/api/v1/agents/providers").json())
    row = db_session.get(AgentProvider, created["id"])
    assert "sk-test" not in (row.api_key_enc or "")
    assert decrypt_secret(row.api_key_enc, row.api_key_salt) == "sk-test-0123456789"

    # An empty key in an update keeps the current one; a rename is refused.
    kept = auth_client.patch(f"/api/v1/agents/providers/{created['id']}", json={"default_model": "m2"})
    assert kept.json()["has_key"] is True and kept.json()["default_model"] == "m2"
    renamed = auth_client.patch(f"/api/v1/agents/providers/{created['id']}", json={"name": "other"})
    assert renamed.status_code == 422
    assert auth_client.post("/api/v1/agents/providers",
                            json={"name": "ollama", "kind": "openai"}).status_code == 409
    assert {e["action"] for e in _audit(auth_client, action="agent.provider")} >= {
        "agent.provider_create", "agent.provider_update"}


# ─── TLP policy and cost ──────────────────────────────────────────────────────

def _case_with_agent(auth_client, db_session, case_id, tlp, provider):
    case = db_session.get(Case, case_id)
    case.tlp = tlp
    db_session.commit()
    agent = auth_client.post(f"/api/v1/cases/{case_id}/agents/", json={"provider": provider})
    assert agent.status_code == 201, agent.text
    return agent.json()


def _run(auth_client, case_id, agent):
    auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages",
                     json={"content": "Summarise the case"})

    def finished():
        tasks = auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()
        return tasks[0] if tasks and tasks[0]["status"] in ("done", "failed") else None
    return _wait(finished)


def test_a_red_case_refuses_a_cloud_model_and_the_audit_says_so(auth_client, db_session, case_id,
                                                                fake_provider):  # noqa: F811
    _provider(auth_client, name="cloud-red")
    set_provider("cloud-red", FakeProvider([_say("never called")], locality=Locality.CLOUD))
    agent = _case_with_agent(auth_client, db_session, case_id, "TLP:RED", "cloud-red")
    task = _run(auth_client, case_id, agent)
    assert task["status"] == "failed" and "local model" in task["error"]
    denials = _audit(auth_client, action="agent.policy_denied", case_id=case_id)
    assert denials and denials[0]["details"]["provider"] == "cloud-red"


def test_a_green_case_uses_a_cloud_model_and_counts_its_cost(auth_client, db_session, case_id,
                                                             fake_provider):  # noqa: F811
    _provider(auth_client, name="cloud-green")
    set_provider("cloud-green", FakeProvider(
        [ChatResult(content="Here is the summary.", tool_calls=[], tokens_in=1000, tokens_out=500)],
        locality=Locality.CLOUD))
    agent = _case_with_agent(auth_client, db_session, case_id, "TLP:GREEN", "cloud-green")
    assert agent["model"] == "big-model"
    task = _run(auth_client, case_id, agent)
    assert task["status"] == "done"
    # 1000 in at $2/M plus 500 out at $10/M.
    assert task["cost_usd"] == pytest.approx(0.007)
    usage = auth_client.get(f"/api/v1/cases/{case_id}/agents/usage").json()
    assert usage["cost_usd"] == pytest.approx(0.007) and usage["tokens_in"] == 1000


# ─── Models per role ──────────────────────────────────────────────────────────

def test_a_role_is_staffed_with_its_configured_model(auth_client, case_id):
    _provider(auth_client, name="role-cloud")
    set_role = auth_client.put("/api/v1/agents/role-models/analyst-windows",
                               json={"provider": "role-cloud", "model": "analyst-model"})
    assert set_role.status_code == 200, set_role.text
    assert auth_client.put("/api/v1/agents/role-models/analyst-windows",
                           json={"provider": "nope"}).status_code == 422

    team = {a["role"]: a for a in auth_client.post(f"/api/v1/cases/{case_id}/agents/team").json()}
    assert (team["analyst-windows"]["provider"], team["analyst-windows"]["model"]) == (
        "role-cloud", "analyst-model")
    assert team["incident-leader"]["provider"] == "ollama"

    auth_client.delete("/api/v1/agents/role-models/analyst-windows")
    roles = {r["role"]: r for r in auth_client.get("/api/v1/agents/role-models").json()}
    assert roles["analyst-windows"]["provider"] == "ollama" and not roles["analyst-windows"]["custom"]


# ─── Wire formats ─────────────────────────────────────────────────────────────

def _conversation():
    return [
        ChatMessage("system", "You help."),
        ChatMessage("user", "What is here?"),
        ChatMessage("assistant", "", tool_calls=[ToolCall("case_overview", {}), ToolCall("list_iocs", {"limit": 5})]),
        ChatMessage("tool", '{"ok": true}', tool_name="case_overview"),
        ChatMessage("tool", '{"ok": true}', tool_name="list_iocs"),
    ]


def test_openai_tool_results_answer_their_calls_by_id():
    from app.services.charybdis.llm.openai_compat import parse_completion, wire_messages

    wire = wire_messages(_conversation())
    call_ids = [c["id"] for c in wire[2]["tool_calls"]]
    assert [m["tool_call_id"] for m in wire[3:]] == call_ids
    assert wire[2]["tool_calls"][1]["function"]["arguments"] == '{"limit": 5}'

    result = parse_completion({"choices": [{"message": {"content": None, "tool_calls": [
        {"id": "c1", "function": {"name": "list_iocs", "arguments": '{"limit": 3}'}}]}}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 4}})
    assert result.tool_calls[0].arguments == {"limit": 3} and result.tokens_in == 12


def test_anthropic_turns_replay_blocks_and_group_tool_results():
    from app.services.charybdis.llm.anthropic_provider import parse_message, wire_messages

    system, wire = wire_messages(_conversation())
    assert system == "You help." and wire[0] == {"role": "user", "content": "What is here?"}
    ids = [b["id"] for b in wire[1]["content"] if b["type"] == "tool_use"]
    # Both results go back in one user turn, answering their calls.
    assert [b["tool_use_id"] for b in wire[2]["content"]] == ids and len(wire) == 3

    blocks = [{"type": "thinking", "thinking": "Look first.", "signature": "sig"},
              {"type": "tool_use", "id": "toolu_9", "name": "case_overview", "input": {}}]
    result = parse_message({"content": blocks, "stop_reason": "tool_use",
                            "usage": {"input_tokens": 10, "cache_read_input_tokens": 90, "output_tokens": 7}})
    assert result.tool_calls[0].id == "toolu_9" and result.tokens_in == 100 and result.raw == blocks
    # The turn goes back exactly as received, thinking block included.
    _, replay = wire_messages([ChatMessage("user", "q"),
                               ChatMessage("assistant", "", tool_calls=result.tool_calls, raw=result.raw),
                               ChatMessage("tool", "{}", tool_name="case_overview")])
    assert replay[1]["content"] == blocks and replay[2]["content"][0]["tool_use_id"] == "toolu_9"

    with pytest.raises(LLMError, match="declined"):
        parse_message({"content": [], "stop_reason": "refusal", "stop_details": {"category": "cyber"}})


def test_an_email_header_is_quoted_as_the_model_reads_it(db_session, case_id, auth_client):
    """A real run quoted 'Reply-To: ...' and was refused: headers are stored as name and value."""
    import json as _json

    from test_charybdis import _staff
    from test_charybdis_s32 import _context

    from app.models.email_file import EmailFile
    from app.services.charybdis.tools import run_tool

    email = EmailFile(case_id=case_id, filename="invoice.eml", analysis=_json.dumps({
        "subject": "Invoice", "key_headers": [{"name": "Reply-To", "value": "payments@secure-pay-portal.top"},
                                              {"name": "From", "value": '"Accounts" <billing@micros0ft-invoices.com>'}]}))
    db_session.add(email)
    db_session.commit()
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    shown = run_tool(ctx, "read_email", {"email_id": email.id, "part": "key_headers"})["content"]
    assert "Reply-To: payments@secure-pay-portal.top" in shown
    kept = run_tool(ctx, "record_source_observation", {
        "source": "email", "source_id": email.id, "part": "key_headers",
        "quote": 'From: "Accounts" <billing@micros0ft-invoices.com>', "note": "Look-alike sender domain"})
    assert kept["row"]["match_1"].startswith("From: ")
