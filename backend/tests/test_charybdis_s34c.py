"""
Charybdis S34 part 3: pause and take over, hypotheses, the evaluation bench,
and agent rows removed with their case.
"""
from __future__ import annotations

from test_charybdis import FakeProvider, _staff, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _call, _say, _wait
from test_charybdis_s32 import _context, _finding, _observe, artifact_id  # noqa: F401  (fixture)

from app.models.case import Case
from app.models.user import User
from app.services.charybdis.llm import set_provider
from app.services.charybdis.tools import run_tool


def _audit(auth_client, **params):
    return auth_client.get("/api/v1/audit", params={"page_size": 200, **params}).json()["items"]


def _analyst_task(db_session, case_id, auth_client):
    from app.services.charybdis.delegation import create_task, new_agent

    admin = db_session.query(User).filter(User.username == "admin").one()
    agent = new_agent(db_session, case_id, "analyst-windows", "admin")
    db_session.commit()
    task = create_task(db_session, agent=agent, objective="Look for RDP on DC01", kind="assigned",
                       requested_by_id=str(admin.id))
    return agent, task


# ─── Pause and take over ──────────────────────────────────────────────────────

def test_a_paused_task_resumes_at_its_step_with_the_analysts_instructions(
        auth_client, db_session, case_id, fake_provider):  # noqa: F811
    from app.models.agent import AgentTask
    from app.services.charybdis import events

    provider = FakeProvider([_say("Plan: one check."), _say("Checked."), _say("Nothing found."),
                             _say("Nothing to propose."), _say("REPORT: nothing.")])
    set_provider("ollama", provider)
    agent, task = _analyst_task(db_session, case_id, auth_client)
    base = f"/api/v1/cases/{case_id}/agents/{agent.id}/tasks/{task.id}"

    paused = auth_client.post(f"{base}/pause")
    assert paused.status_code == 200 and paused.json()["status"] == "paused"
    assert auth_client.post(f"{base}/pause").status_code == 409

    # As if the first step had completed before the pause.
    events.record(db_session, case_id=case_id, agent_id=agent.id, task_id=task.id, kind="step",
                  payload={"step": "understand", "next": "plan", "summary": "UNDERSTOOD: DC01 RDP."})
    db_session.get(AgentTask, task.id).current_step = "plan"
    db_session.commit()

    resumed = auth_client.post(f"{base}/resume", json={"note": "Focus on svc_backup only."})
    assert resumed.status_code == 200 and resumed.json()["status"] == "pending"

    def finished():
        db_session.expire_all()
        t = db_session.get(AgentTask, task.id)
        return t if t.status in ("done", "failed") else None
    assert _wait(finished).report == "REPORT: nothing."

    first_call = [m.content for m in provider.calls[0]]
    assert "UNDERSTOOD: DC01 RDP." in first_call
    assert any("took it over" in c and "svc_backup only" in c for c in first_call)
    assert any(c.startswith("Step 2/5: plan") for c in first_call)
    assert {e["action"] for e in _audit(auth_client, action="agent.task_")} >= {
        "agent.task_pause", "agent.task_resume"}


# ─── Hypotheses ───────────────────────────────────────────────────────────────

def test_the_leader_weighs_findings_against_hypotheses_and_the_analyst_decides(
        auth_client, db_session, case_id, artifact_id):  # noqa: F811
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    finding = _finding(ctx, [_observe(ctx, artifact_id)["observation_id"]])
    h1 = run_tool(ctx, "state_hypothesis", {"statement": "An outsider used svc_backup over RDP."})
    run_tool(ctx, "state_hypothesis", {"statement": "An administrator used svc_backup for maintenance."})
    assert h1["hypothesis"] == "H1"
    run_tool(ctx, "weigh_finding", {"hypothesis": "H1", "finding": finding["finding"], "stance": "for",
                                    "note": "The logon came from an unknown host"})
    board = run_tool(ctx, "list_hypotheses", {})["rows"]
    assert board[0]["for"] == ["F1"] and board[1]["for"] == []

    hypotheses = auth_client.get(f"/api/v1/cases/{case_id}/agents/hypotheses").json()
    h2 = hypotheses[1]
    linked = auth_client.put(f"/api/v1/cases/{case_id}/agents/hypotheses/{h2['id']}/links/{finding['finding_id']}",
                             json={"stance": "against", "note": "No change ticket for this logon"})
    assert linked.status_code == 200 and linked.json()["links"][0]["stance"] == "against"
    decided = auth_client.patch(f"/api/v1/cases/{case_id}/agents/hypotheses/{hypotheses[0]['id']}",
                                json={"state": "supported"})
    assert decided.json()["state"] == "supported" and decided.json()["decided_by"] == "admin"
    assert auth_client.patch(f"/api/v1/cases/{case_id}/agents/hypotheses/{h2['id']}",
                             json={"state": "maybe"}).status_code == 422


# ─── Evaluation bench ─────────────────────────────────────────────────────────

def test_the_golden_cases_load():
    from app.services.charybdis.bench import benches
    found = benches()
    assert {"rdp-intrusion", "invoice-phishing"} <= set(found)
    assert all(b.expect for b in found.values())


def test_a_bench_run_scores_what_the_agent_proposed_and_leaves_no_case(
        auth_client, db_session, fake_provider):  # noqa: F811
    from app.models.agent import AgentInstance

    set_provider("ollama", FakeProvider([
        _say("Understood: one email."), _say("Read it: a lure domain."),
        _call("propose_ioc", type="domain", value="secure-pay-portal.top", confidence="high",
              rationale="Payment link of the email", evidence=["invoice.eml urls"]),
        _say("Proposed the lure domain."), _say("REPORT: one indicator."),
    ]))
    before = db_session.query(Case).count()
    started = auth_client.post("/api/v1/agents/bench/runs", json={"bench_id": "invoice-phishing"})
    assert started.status_code == 202, started.text
    run_id = started.json()["id"]

    def finished():
        runs = {r["id"]: r for r in auth_client.get("/api/v1/agents/bench/runs").json()}
        return runs[run_id] if runs[run_id]["status"] != "running" else None
    run = _wait(finished, timeout=20)
    assert run["status"] == "done", run
    assert (run["score"], run["total"]) == (1, 5)
    met = [d["label"] for d in run["details"] if d["met"]]
    assert met == ["The lure domain is proposed as an indicator"]
    assert run["model_calls"] == 5

    db_session.expire_all()
    assert db_session.query(Case).count() == before
    assert not db_session.query(Case).filter(Case.title.like("[bench]%")).first()
    assert not db_session.query(AgentInstance).filter(AgentInstance.case_id.notin_(
        [c for (c,) in db_session.query(Case.id)])).first()
    assert auth_client.post("/api/v1/agents/bench/runs", json={"bench_id": "nope"}).status_code == 404


# ─── Case deletion ────────────────────────────────────────────────────────────

def test_deleting_a_case_removes_its_agents_and_trace(auth_client, db_session):
    from app.models.agent import AgentEvent, AgentInstance

    case = auth_client.post("/api/v1/cases/", json={"title": "To delete", "tlp": "TLP:GREEN"}).json()
    auth_client.post(f"/api/v1/cases/{case['id']}/agents/team")
    auth_client.post(f"/api/v1/cases/{case['id']}/agents/hypotheses",
                     json={"statement": "Something happened on this host."})
    assert auth_client.delete(f"/api/v1/cases/{case['id']}").status_code in (200, 204)
    db_session.expire_all()
    assert db_session.query(AgentInstance).filter(AgentInstance.case_id == case["id"]).count() == 0
    assert db_session.query(AgentEvent).filter(AgentEvent.case_id == case["id"]).count() == 0
