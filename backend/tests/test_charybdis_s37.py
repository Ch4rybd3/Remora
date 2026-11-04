"""
Charybdis S37: the approval queue, third-party MCP servers, drafted detection rules.
"""
from __future__ import annotations

import json

import httpx
import pytest
from test_charybdis import FakeProvider, _staff, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _call, _say, _wait
from test_charybdis_s32 import _audit, _context

from app.models.case import Case
from app.services.charybdis.llm import set_provider
from app.services.charybdis.tools import ToolError, run_tool


def _tlp(db_session, case_id, tlp):
    case = db_session.get(Case, case_id)
    case.tlp = tlp
    db_session.commit()


class _FakeResult:
    def __init__(self, value):
        self.value = value

    def model_dump(self, exclude_none=False):
        return {"value": self.value, "virustotal": {"malicious": 12}}


@pytest.fixture
def fake_cti(monkeypatch):
    sent: list[str] = []

    def lookup(body, db, current_user):
        sent.append(body.value)
        return _FakeResult(body.value)
    monkeypatch.setattr("app.routers.cti.lookup", lookup)
    return sent


def _mcp_transport(seen: list[dict]):
    """A streamable-HTTP MCP server: JSON for initialize, an event stream for the call."""
    def handler(request: httpx.Request) -> httpx.Response:
        message = json.loads(request.content)
        seen.append({"message": message, "auth": request.headers.get("authorization"),
                     "session": request.headers.get("mcp-session-id")})
        if message.get("method") == "initialize":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}},
                                  headers={"Mcp-Session-Id": "s-1"})
        if "id" not in message:
            return httpx.Response(202)
        if message["method"] == "tools/list":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 2, "result": {"tools": [
                {"name": "whois", "description": "Domain registration", "inputSchema": {}}]}})
        body = json.dumps({"jsonrpc": "2.0", "id": 2, "result": {
            "content": [{"type": "text", "text": f"registered 2026-10-01: {message['params']['arguments']}"}]}})
        return httpx.Response(200, text=f"event: message\ndata: {body}\n\n",
                              headers={"content-type": "text/event-stream"})
    return httpx.MockTransport(handler)


class _OwnConversation(FakeProvider):
    """Scripted for one conversation only: a task left by an earlier test gets a plain answer."""

    def __init__(self, marker, script):
        super().__init__(script)
        self.marker = marker

    async def chat(self, model, messages, tools):
        if not any(self.marker in m.content for m in messages if m.role == "user"):
            return _say("Nothing to add.")
        return await super().chat(model, messages, tools)


# ─── Approval queue ───────────────────────────────────────────────────────────

def test_a_cti_lookup_waits_for_approval_then_the_agent_resumes_with_the_result(
        auth_client, db_session, case_id, fake_cti, fake_provider):  # noqa: F811
    _tlp(db_session, case_id, "TLP:GREEN")
    provider = _OwnConversation("Check the IP", [
        _call("cti_lookup", value="203.0.113.7", reason="Is the RDP source known as malicious?"),
        _say("203.0.113.7 is flagged by 12 engines."),
    ])
    set_provider("ollama", provider)
    agent = auth_client.post(f"/api/v1/cases/{case_id}/agents/", json={"role": "analyst-windows"}).json()
    auth_client.post(f"/api/v1/cases/{case_id}/agents/{agent['id']}/messages", json={"content": "Check the IP"})

    pending = _wait(lambda: auth_client.get(f"/api/v1/cases/{case_id}/agents/approvals").json())
    assert pending[0]["state"] == "pending" and "203.0.113.7" in pending[0]["summary"]
    assert fake_cti == []
    task = _wait(lambda: [t for t in auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()
                          if t["status"] == "paused"])[0]
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/attention").json()["approvals"] == 1

    approved = auth_client.post(f"/api/v1/cases/{case_id}/agents/approvals/{pending[0]['id']}/approve",
                                json={"comment": "Fine, it is public"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["state"] == "approved" and "malicious" in approved.json()["result"]
    assert fake_cti == ["203.0.113.7"]
    def resumed_call():
        return [" ".join(m.content for m in call if m.role == "user") for call in provider.calls
                if any("approved cti_lookup" in m.content for m in call if m.role == "user")]
    resumed = _wait(resumed_call)[0]
    assert "approved cti_lookup" in resumed and "malicious" in resumed and "Fine, it is public" in resumed
    _wait(lambda: next(t for t in auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()
                       if t["id"] == task["id"])["status"] == "done")
    assert auth_client.post(f"/api/v1/cases/{case_id}/agents/approvals/{pending[0]['id']}/deny",
                            json={}).status_code == 409
    assert _audit(auth_client, action="agent.approval_approve", case_id=case_id)


def test_a_denied_action_is_never_run(auth_client, db_session, case_id, fake_cti):
    _tlp(db_session, case_id, "TLP:GREEN")
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    held = run_tool(ctx, "cti_lookup", {"value": "evil.example.org", "reason": "Reputation of the domain"})
    denied = auth_client.post(f"/api/v1/cases/{case_id}/agents/approvals/{held['approval_id']}/deny",
                              json={"comment": "Do not tip off the actor"})
    assert denied.status_code == 200 and denied.json()["state"] == "denied"
    assert fake_cti == []
    trace = auth_client.get(f"/api/v1/cases/{case_id}/agents/events").json()
    note = [e for e in trace if e["kind"] == "message.user" and e["payload"].get("approval")]
    assert "refused cti_lookup" in note[0]["payload"]["text"] and "tip off" in note[0]["payload"]["text"]


@pytest.mark.parametrize("tlp", ["TLP:RED", "TLP:AMBER+STRICT", ""])
def test_a_restricted_case_never_asks_to_send_indicators_out(auth_client, db_session, case_id, tlp):
    _tlp(db_session, case_id, tlp)
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    with pytest.raises(ToolError, match="may not be sent"):
        run_tool(ctx, "cti_lookup", {"value": "203.0.113.7", "reason": "Reputation of the IP"})
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/approvals").json() == []


def test_asking_again_for_a_decided_action_returns_the_decision(auth_client, db_session, case_id, fake_cti):
    """Seen on qwen3:8b: resumed with the result, the agent asked for the same call again."""
    _tlp(db_session, case_id, "TLP:GREEN")
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    args = {"value": "evil.example.org", "reason": "Reputation of the domain"}
    held = run_tool(ctx, "cti_lookup", args)
    assert run_tool(ctx, "cti_lookup", args)["approval_id"] == held["approval_id"]
    auth_client.post(f"/api/v1/cases/{case_id}/agents/approvals/{held['approval_id']}/approve", json={})
    again = run_tool(ctx, "cti_lookup", args)
    assert again["state"] == "approved" and "malicious" in again["result"]
    assert fake_cti == ["evil.example.org"]
    assert len(auth_client.get(f"/api/v1/cases/{case_id}/agents/approvals").json()) == 1


# ─── Third-party MCP servers ──────────────────────────────────────────────────

def _register(auth_client, name, locality="local"):
    created = auth_client.post("/api/v1/agents/mcp-servers", json={
        "name": name, "url": "https://mcp.example.test/mcp", "locality": locality,
        "authorization": "Bearer s3cret", "description": "Domain intelligence"})
    assert created.status_code == 201, created.text
    return created.json()


def test_an_mcp_server_is_registered_with_its_credential_hidden(auth_client, db_session):
    from app.services.charybdis import mcp_client

    server = _register(auth_client, "whois-s37")
    assert server["has_authorization"] and "s3cret" not in json.dumps(server)
    assert auth_client.post("/api/v1/agents/mcp-servers", json={
        "name": "whois-s37", "url": "https://x.test"}).status_code == 409
    assert auth_client.post("/api/v1/agents/mcp-servers", json={
        "name": "bad-s37", "url": "file:///etc/passwd"}).status_code == 422

    seen: list[dict] = []
    loaded = mcp_client.load(db_session, "whois-s37")
    tools = mcp_client.list_tools(loaded, transport=_mcp_transport(seen))
    assert tools[0]["name"] == "whois"
    assert seen[0]["auth"] == "Bearer s3cret" and seen[-1]["session"] == "s-1"
    answer = mcp_client.call_tool(loaded, "whois", {"domain": "evil.example.org"}, transport=_mcp_transport(seen))
    assert "registered 2026-10-01" in answer["text"] and not answer["is_error"]

    auth_client.patch(f"/api/v1/agents/mcp-servers/{server['id']}", json={"enabled": False})
    with pytest.raises(mcp_client.McpError, match="No enabled"):
        mcp_client.load(db_session, "whois-s37")
    assert auth_client.delete(f"/api/v1/agents/mcp-servers/{server['id']}").status_code == 204
    assert _audit(auth_client, action="agent.mcp_server_create")


def test_an_approved_mcp_call_runs_and_a_cloud_server_is_refused_on_red(
        auth_client, db_session, case_id, monkeypatch):
    from app.services.charybdis import mcp_client

    _register(auth_client, "local-s37")
    _register(auth_client, "cloud-s37", locality="cloud")
    seen: list[dict] = []
    real = mcp_client.call_tool
    monkeypatch.setattr(mcp_client, "call_tool",
                        lambda server, name, arguments: real(server, name, arguments, _mcp_transport(seen)))

    _tlp(db_session, case_id, "TLP:RED")
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    with pytest.raises(ToolError, match="cloud service"):
        run_tool(ctx, "mcp_call", {"server": "cloud-s37", "tool": "whois",
                                   "arguments": {"domain": "evil.example.org"}, "reason": "Who registered it"})
    held = run_tool(ctx, "mcp_call", {"server": "local-s37", "tool": "whois",
                                      "arguments": {"domain": "evil.example.org"}, "reason": "Who registered it"})
    assert seen == []
    approved = auth_client.post(f"/api/v1/cases/{case_id}/agents/approvals/{held['approval_id']}/approve",
                                json={})
    assert approved.status_code == 200, approved.text
    assert "registered 2026-10-01" in approved.json()["result"]
    assert seen[-1]["message"]["params"] == {"name": "whois", "arguments": {"domain": "evil.example.org"}}


# ─── Detection rules ──────────────────────────────────────────────────────────

SIGMA = """title: RDP logon from an external address
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID: 4624
    LogonType: 10
  condition: selection
level: high
"""

YARA = """rule Invoice_Dropper {
  strings:
    $a = "invoice.example.com"
  condition:
    $a
}"""


def test_a_drafted_rule_is_checked_accepted_and_downloaded(auth_client, db_session, case_id):
    from app.models.agent import AgentFinding

    agent = _staff(auth_client, case_id)
    db_session.add(AgentFinding(case_id=case_id, agent_id=agent["id"], ref=1, title="RDP logon",
                                statement="s", severity="high", confidence="high", state="validated"))
    db_session.commit()
    ctx = _context(db_session, case_id, agent["id"])
    base = {"title": "RDP logon from outside", "findings": ["F1"], "rationale": "Remote interactive logons"}
    with pytest.raises(ToolError, match="lacks"):
        run_tool(ctx, "propose_detection_rule", {**base, "kind": "sigma", "rule": "title: x\ndetection: {}\n"})
    with pytest.raises(ToolError, match="braces"):
        run_tool(ctx, "propose_detection_rule", {**base, "kind": "yara", "rule": YARA + "}"})
    with pytest.raises(ToolError, match="Unknown findings"):
        run_tool(ctx, "propose_detection_rule", {**base, "kind": "sigma", "rule": SIGMA, "findings": ["F9"]})
    run_tool(ctx, "propose_detection_rule", {**base, "kind": "yara", "rule": YARA, "title": "Invoice dropper"})
    run_tool(ctx, "propose_detection_rule", {**base, "kind": "sigma", "rule": SIGMA})

    proposals = {p["payload"]["kind"]: p for p in auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()}
    accepted = auth_client.post(f"/api/v1/cases/{case_id}/agents/proposals/{proposals['sigma']['id']}/accept",
                                json={})
    assert accepted.status_code == 200, accepted.text
    rules = [r for r in auth_client.get("/api/v1/agents/detection-rules").json() if r["case_id"] == case_id]
    assert len(rules) == 1 and rules[0]["kind"] == "sigma" and rules[0]["findings"] == ["F1"]
    download = auth_client.get(f"/api/v1/agents/detection-rules/{rules[0]['id']}/download")
    assert download.status_code == 200 and "LogonType: 10" in download.text
    assert download.headers["content-disposition"].endswith('.yml"')
