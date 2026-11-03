"""
Charybdis S35: Remora as an MCP server, knowledge and lessons learned,
correlation across cases.
"""
from __future__ import annotations

from test_charybdis import _staff
from test_charybdis_s32 import _context

from app.models.case import Case
from app.models.user import User
from app.services.charybdis.tools import AGENT_PERMISSIONS, ToolContext, ToolError, run_tool

MCP = "/api/v1/agents/mcp"


def _token(auth_client, name="claude code"):
    response = auth_client.post("/api/v1/agents/mcp-tokens", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _rpc(auth_client, token, method, params=None, message_id=1):
    body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if message_id is not None:
        body["id"] = message_id
    return auth_client.post(MCP, json=body, headers={"Authorization": f"Bearer {token}"})


def _audit(auth_client, **params):
    return auth_client.get("/api/v1/audit", params={"page_size": 200, **params}).json()["items"]


# ─── MCP server ───────────────────────────────────────────────────────────────

def test_an_mcp_client_reads_a_case_with_its_owners_rights(auth_client, db_session, case_id):
    token = _token(auth_client)["token"]
    assert token.startswith("rmcp_")
    assert "token" not in str(auth_client.get("/api/v1/agents/mcp-tokens").json()[0].get("token") or "")

    init = _rpc(auth_client, token, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                                   "clientInfo": {"name": "test", "version": "1"}})
    assert init.status_code == 200 and init.json()["result"]["capabilities"]["tools"] is not None
    assert _rpc(auth_client, token, "notifications/initialized", message_id=None).status_code == 202

    tools = {t["name"] for t in _rpc(auth_client, token, "tools/list").json()["result"]["tools"]}
    assert {"list_cases", "list_findings", "store_search"} <= tools
    assert not {t for t in tools if t.startswith(("propose_", "record_", "review_"))}

    cases = _rpc(auth_client, token, "tools/call", {"name": "list_cases", "arguments": {}}).json()["result"]
    assert case_id in cases["content"][0]["text"]
    findings = _rpc(auth_client, token, "tools/call",
                    {"name": "list_findings", "arguments": {"case_id": case_id}}).json()["result"]
    assert findings["isError"] is False and '"total": 0' in findings["content"][0]["text"]
    missing = _rpc(auth_client, token, "tools/call",
                   {"name": "list_findings", "arguments": {"case_id": "nope"}}).json()["result"]
    assert missing["isError"] is True
    assert _rpc(auth_client, token, "resources/list").json()["error"]["code"] == -32601

    calls = _audit(auth_client, action="agent.mcp_call")
    assert any(c["case_id"] == case_id and c["resource_name"] == "list_findings" for c in calls)


def test_mcp_refuses_bad_tokens_and_restricted_cases(auth_client, db_session, case_id):
    created = _token(auth_client)
    assert _rpc(auth_client, "rmcp_not-a-token", "ping").status_code == 401
    assert auth_client.post(MCP, json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
                            headers={"Authorization": ""}).status_code == 401

    case = db_session.get(Case, case_id)
    case.tlp = "TLP:RED"
    db_session.commit()
    red = _rpc(auth_client, created["token"], "tools/call",
               {"name": "case_overview", "arguments": {"case_id": case_id}}).json()["result"]
    assert red["isError"] is True and "TLP:RED" in red["content"][0]["text"]

    assert auth_client.delete(f"/api/v1/agents/mcp-tokens/{created['id']}").status_code == 204
    assert _rpc(auth_client, created["token"], "ping").status_code == 401


# ─── Lessons ──────────────────────────────────────────────────────────────────

def test_an_accepted_lesson_outlives_its_case_and_informs_the_next(auth_client, db_session):
    from app.models.agent import AgentLesson

    old = auth_client.post("/api/v1/cases/", json={"title": "Old phishing", "tlp": "TLP:GREEN"}).json()
    ctx = _context(db_session, old["id"], _staff(auth_client, old["id"])["id"])
    run_tool(ctx, "propose_lesson", {
        "title": "Block look-alike domains at the mail gateway",
        "lesson": "The phishing domain imitated the vendor; a look-alike rule would have quarantined it.",
        "tags": "phishing,mail-gateway", "rationale": "F1 and the incident log"})
    proposal = auth_client.get(f"/api/v1/cases/{old['id']}/agents/proposals").json()[0]
    accepted = auth_client.post(f"/api/v1/cases/{old['id']}/agents/proposals/{proposal['id']}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    assert auth_client.delete(f"/api/v1/cases/{old['id']}").status_code in (200, 204)

    db_session.expire_all()
    lesson = db_session.query(AgentLesson).filter(AgentLesson.case_title == "Old phishing").one()
    assert lesson.case_id == old["id"] and lesson.accepted_by == "admin"

    new = auth_client.post("/api/v1/cases/", json={"title": "New phishing", "tlp": "TLP:GREEN"}).json()
    admin = db_session.query(User).filter(User.username == "admin").one()
    ctx = ToolContext(db_session, db_session.get(Case, new["id"]), AGENT_PERMISSIONS, user_id=admin.id)
    found = run_tool(ctx, "search_lessons", {"query": "look-alike domain"})["rows"]
    assert found and found[0]["case"] == "Old phishing"


def test_closing_a_case_asks_the_leader_for_its_lessons_once(auth_client, db_session, case_id):
    from app.models.agent import AgentTask
    from app.services.charybdis.triggers import announce

    auth_client.post(f"/api/v1/cases/{case_id}/agents/team")
    auth_client.patch(f"/api/v1/cases/{case_id}", json={"status": "closed"})
    announce(db_session)
    announce(db_session)
    lessons = db_session.query(AgentTask).filter(AgentTask.case_id == case_id,
                                                 AgentTask.kind == "lessons").all()
    assert len(lessons) == 1 and "propose_lesson" in lessons[0].objective


# ─── Correlation and knowledge ────────────────────────────────────────────────

def test_indicators_are_correlated_only_within_what_the_account_sees(auth_client, db_session, case_id):
    from app.models.ioc import IOC

    other = auth_client.post("/api/v1/cases/", json={"title": "Earlier intrusion", "tlp": "TLP:GREEN"}).json()
    db_session.add_all([IOC(case_id=case_id, type="ip", value="198.51.100.77"),
                        IOC(case_id=other["id"], type="ip", value="198.51.100.77")])
    db_session.commit()
    admin = db_session.query(User).filter(User.username == "admin").one()
    seen = run_tool(ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS,
                                user_id=admin.id), "correlate_iocs", {})
    assert [r["case"] for r in seen["rows"]] == ["Earlier intrusion"]
    # An agent with no account behind it looks at nothing beyond its case.
    alone = run_tool(ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS),
                     "correlate_iocs", {})
    assert alone["rows"] == []


def test_agents_search_and_read_the_knowledge_base(db_session, case_id):
    from app.routers.knowledge import KNOWLEDGE_DIR

    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    page = KNOWLEDGE_DIR / "charybdis-test-rdp.md"
    page.write_text("# RDP triage\n\nCheck 4624 LogonType 10 then 4672 on the same logon id.\n",
                    encoding="utf-8")
    try:
        ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS)
        hits = run_tool(ctx, "search_knowledge", {"query": "LogonType 4672"})["rows"]
        assert hits[0]["path"] == "charybdis-test-rdp.md"
        assert "4672" in run_tool(ctx, "read_knowledge", {"path": hits[0]["path"]})["content"]
        try:
            run_tool(ctx, "read_knowledge", {"path": "../../etc/passwd.md"})
            raise AssertionError("path traversal was not refused")
        except ToolError:
            pass
    finally:
        page.unlink()


def test_the_leader_is_given_matching_lessons_and_told_to_cite_no_other(db_session, case_id):
    """A real run had the leader invent 'Finance Phishing 2023'; it now starts from the real list."""
    from app.models.agent import AgentLesson, AgentTask
    from app.services.charybdis.runtime import _recalled_lessons

    admin = db_session.query(User).filter(User.username == "admin").one()
    case = db_session.get(Case, case_id)
    case.title, case.tags, case.description = "Quokkazz alert", "quokkazz", ""
    task = AgentTask(case_id=case_id, agent_id="a", objective="x", requested_by_id=admin.id)
    assert "there are none to cite" in _recalled_lessons(db_session, case, task)

    db_session.add(AgentLesson(case_title="Fake invoice phishing", title="Quokkazz containment",
                               lesson="Isolate the quokkazz hosts first.", tags="quokkazz"))
    db_session.commit()
    recalled = _recalled_lessons(db_session, case, task)
    assert 'From case "Fake invoice phishing": Quokkazz containment' in recalled
    assert "never cite another" in recalled
