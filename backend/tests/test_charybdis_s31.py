"""
Charybdis S31: definitions, the process engine, delegation and proposals.

As in `test_charybdis.py`, no test reaches a model: the scripted
`FakeProvider` answers for every agent, in the order they run.
"""
from __future__ import annotations

import json
import time

import pytest
from test_charybdis import FakeProvider, _staff, fake_provider  # noqa: F401  (fixture)

from app.models.case import Case
from app.models.user import User
from app.services.charybdis.llm import ChatResult, ToolCall, set_provider
from app.services.charybdis.tools import AGENT_PERMISSIONS, ToolContext, ToolError, run_tool

# ─── Definitions ──────────────────────────────────────────────────────────────

def test_the_shipped_definitions_load():
    from app.services.charybdis.definitions import definitions
    defs = definitions()
    assert {"assistant", "incident-leader", "analyst-windows"} <= set(defs.roles)
    analyst = defs.roles["analyst-windows"]
    assert analyst.reports_to == "incident-leader"
    assert [s.id for s in defs.processes[analyst.process].steps] == [
        "understand", "plan", "execute", "propose", "report"]
    assert analyst.prompt_text


def _write_definitions(root, role_tools="[case_overview]", step_tools="[case_overview]",
                       process="p"):
    (root / "roles").mkdir(parents=True)
    (root / "processes").mkdir()
    (root / "prompts").mkdir()
    (root / "prompts" / "a.md").write_text("You help.", encoding="utf-8")
    (root / "processes" / "p.yaml").write_text(
        f"id: p\nsteps:\n  - id: s\n    instructions: Do it.\n    tools: {step_tools}\n",
        encoding="utf-8")
    (root / "roles" / "assistant.yaml").write_text(
        f"id: assistant\nname: A\nprompt: a.md\nprocess: {process}\n"
        f"conversation_process: {process}\ntools: {role_tools}\n", encoding="utf-8")


@pytest.mark.parametrize(("kwargs", "message"), [
    ({"role_tools": "[no_such_tool]", "step_tools": "[]"}, "unknown tools"),
    ({"step_tools": "[store_search]"},                      "does not hold"),
    ({"process": "missing"},                                "not found"),
])
def test_an_invalid_definition_is_refused_with_its_file(tmp_path, kwargs, message):
    from app.services.charybdis.definitions import DefinitionError, load
    _write_definitions(tmp_path, **kwargs)
    with pytest.raises(DefinitionError, match=message):
        load(tmp_path)


# ─── Delegation, proposals, reports ───────────────────────────────────────────

def _say(text: str) -> ChatResult:
    return ChatResult(content=text, tool_calls=[])


def _call(name: str, **arguments) -> ChatResult:
    return ChatResult(content="", tool_calls=[ToolCall(name, arguments)])


def _proposals(auth_client, case_id, state="proposed"):
    return auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals",
                           params={"state": state}).json()


def _wait(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("condition not met in time")


def test_the_leader_delegates_and_the_analyst_proposes_and_reports(auth_client, case_id,
                                                                  fake_provider):  # noqa: F811
    """The S31 exit criterion, end to end, against a scripted model."""
    set_provider("ollama", FakeProvider([
        # Leader, talking with the analyst.
        _call("propose_task", role="analyst-windows",
              objective="Look for RDP logons on the domain controller",
              rationale="H1: lateral movement over RDP"),
        _say("I propose one task."),
        # Windows analyst, through its five steps.
        _say("Objective understood."),
        _say("Plan: search 4624 type 10."),
        _say("Found one RDP logon from 10.1.2.3."),
        _call("propose_ioc", type="ip", value="10.1.2.3", confidence="high",
              rationale="Source of the RDP logon",
              evidence=["Security.evtx EventRecordId 4512, 2024-03-02 10:14:07Z"]),
        _say("Proposed the source IP."),
        _say("REPORT: one RDP logon from 10.1.2.3 at 2024-03-02 10:14:07Z."),
        # Leader, reviewing the report.
        _say("Situation: RDP from 10.1.2.3 confirmed."),
    ]))

    team = auth_client.post(f"/api/v1/cases/{case_id}/agents/team")
    assert team.status_code == 201, team.text
    roles = {a["role"]: a for a in team.json()}
    assert set(roles) == {"incident-leader", "analyst-windows", "reviewer", "reporter"}
    # Staffing twice adds nobody.
    assert auth_client.post(f"/api/v1/cases/{case_id}/agents/team").json() == []

    leader = roles["incident-leader"]
    auth_client.post(f"/api/v1/cases/{case_id}/agents/{leader['id']}/messages",
                     json={"content": "A user reported a strange RDP session."})
    task_proposal = _wait(lambda: _proposals(auth_client, case_id))[0]
    assert task_proposal["kind"] == "task"
    assert task_proposal["payload"]["role"] == "analyst-windows"

    accepted = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/proposals/{task_proposal['id']}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    task_id = accepted.json()["result_id"]

    ioc_proposal = _wait(lambda: [p for p in _proposals(auth_client, case_id)
                                  if p["kind"] == "ioc"])[0]
    assert ioc_proposal["evidence"] == ["Security.evtx EventRecordId 4512, 2024-03-02 10:14:07Z"]
    accepted = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/proposals/{ioc_proposal['id']}/accept",
        json={"payload": {"description": "RDP source"}})
    assert accepted.status_code == 200, accepted.text
    iocs = auth_client.get(f"/api/v1/cases/{case_id}/iocs/").json()
    assert [(i["value"], i["description"]) for i in iocs] == [("10.1.2.3", "RDP source")]

    def tasks():
        return {t["id"]: t for t in
                auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()}

    analyst_task = _wait(lambda: tasks()[task_id] if tasks()[task_id]["status"] == "done" else None)
    assert analyst_task["report"].startswith("REPORT:")
    assert analyst_task["process_id"] == "analyst-investigation"
    review = _wait(lambda: [t for t in tasks().values()
                            if t["kind"] == "report" and t["status"] == "done"])[0]
    assert review["parent_task_id"] == task_id
    assert review["agent_id"] == leader["id"]

    trace = auth_client.get(f"/api/v1/cases/{case_id}/agents/events").json()
    steps = [e["payload"]["step"] for e in trace if e["kind"] == "step"]
    assert steps == ["understand", "plan", "execute", "propose"]
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/events/verify").json()["ok"] is True


def test_a_rejection_reaches_the_agent_with_its_comment(auth_client, db_session, case_id):
    from app.models.agent import AgentInstance, AgentProposal
    from app.services.charybdis.runtime import _history

    agent = _staff(auth_client, case_id)
    proposal = AgentProposal(case_id=case_id, agent_id=agent["id"], kind="ioc",
                             payload='{"type": "ip", "value": "8.8.8.8"}', rationale="seen")
    db_session.add(proposal)
    db_session.commit()
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/proposals/{proposal.id}/reject",
                                json={"comment": "That is a public resolver"})
    assert response.status_code == 200
    assert response.json()["state"] == "rejected"
    again = auth_client.post(f"/api/v1/cases/{case_id}/agents/proposals/{proposal.id}/accept",
                             json={})
    assert again.status_code == 409

    db_session.expire_all()
    notes = [m.content for m in
             _history(db_session, db_session.get(AgentInstance, agent["id"]), "")]
    assert any("rejected" in n and "public resolver" in n for n in notes)


def test_a_task_waits_for_the_proposals_and_tasks_it_depends_on(db_session, case_id, auth_client):
    from app.models.agent import AgentProposal, AgentTask
    from app.services.charybdis.delegation import dependencies_met

    agent = _staff(auth_client, case_id)
    admin = db_session.query(User).filter(User.username == "admin").one()
    open_proposal = AgentProposal(case_id=case_id, agent_id=agent["id"], kind="task",
                                  payload="{}")
    running = AgentTask(case_id=case_id, agent_id=agent["id"], objective="first",
                        requested_by_id=admin.id, status="running")
    db_session.add_all([open_proposal, running])
    db_session.commit()

    def waiting_on(*refs):
        return AgentTask(case_id=case_id, agent_id=agent["id"], objective="x",
                         requested_by_id=admin.id, depends_on=json.dumps(list(refs)))

    assert dependencies_met(db_session, waiting_on()) is True
    assert dependencies_met(db_session, waiting_on(open_proposal.id)) is False
    assert dependencies_met(db_session, waiting_on(running.id)) is False
    running.status = "done"
    open_proposal.state = "rejected"
    db_session.commit()
    assert dependencies_met(db_session, waiting_on(open_proposal.id, running.id)) is True


def test_an_indicator_already_in_the_case_is_not_proposed_again(db_session, case_id, auth_client):
    from app.models.agent import AgentTask
    from app.models.ioc import IOC

    agent = _staff(auth_client, case_id)
    admin = db_session.query(User).filter(User.username == "admin").one()
    task = AgentTask(case_id=case_id, agent_id=agent["id"], objective="x",
                     requested_by_id=admin.id)
    db_session.add_all([task, IOC(case_id=case_id, type="ip", value="10.9.9.9")])
    db_session.commit()
    ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS,
                      agent_id=agent["id"], task_id=task.id)
    args = {"type": "ip", "rationale": "r", "evidence": ["e"]}
    with pytest.raises(ToolError, match="Already recorded"):
        run_tool(ctx, "propose_ioc", {**args, "value": "10.9.9.9"})
    run_tool(ctx, "propose_ioc", {**args, "value": "10.9.9.8"})
    with pytest.raises(ToolError, match="Already proposed"):
        run_tool(ctx, "propose_ioc", {**args, "value": "10.9.9.8"})


def test_a_proposal_must_cite_evidence(db_session, case_id):
    ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS,
                      agent_id="a", task_id="t")
    with pytest.raises(ToolError, match="evidence"):
        run_tool(ctx, "propose_ioc", {"type": "ip", "value": "1.2.3.4", "rationale": "r",
                                      "evidence": []})


def test_a_step_offers_only_its_own_tools(db_session, case_id):
    ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS)
    with pytest.raises(ToolError, match="not available at this step"):
        run_tool(ctx, "store_search", {"artifact_id": "x"}, allowed=["case_overview"])


def test_ingest_status_explains_the_states_it_returns(db_session, case_id):
    from app.models.ingest import IngestedFile
    db_session.add(IngestedFile(case_id=case_id, original_name="x.evtx", state="routed"))
    db_session.commit()
    result = run_tool(ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS),
                      "ingest_status", {})
    assert "not parsed" in result["states"]["routed"]


def test_the_case_object_tools_read_what_the_analyst_recorded(db_session, case_id):
    from app.models.ioc import IOC
    db_session.add(IOC(case_id=case_id, type="domain", value="evil.example"))
    db_session.commit()
    ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS)
    rows = run_tool(ctx, "list_iocs", {})["rows"]
    assert [(r["type"], r["value"]) for r in rows] == [("domain", "evil.example")]
    for name in ("list_assets", "list_timeline", "list_incident_log", "list_ttps",
                 "chainsaw_alerts", "process_tree", "list_tasks"):
        assert "total" in run_tool(ctx, name, {}) or "tasks" in run_tool(ctx, name, {})
