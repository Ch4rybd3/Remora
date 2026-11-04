"""
Charybdis S40: report language, executive briefing, attack graph links.
"""
from __future__ import annotations

import uuid

import pytest
from test_charybdis import _staff
from test_charybdis_s32 import _audit, _context

from app.models.case import Case
from app.services.charybdis.tools import ToolError, run_tool


def _finding(db_session, case_id, agent_id, ref=1, state="validated", severity="high"):
    from app.models.agent import AgentFinding
    db_session.add(AgentFinding(case_id=case_id, agent_id=agent_id, ref=ref, title=f"Finding {ref}",
                                statement="s", severity=severity, confidence="high", state=state))
    db_session.commit()


def _accept(auth_client, case_id, kind):
    proposal = next(p for p in auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()
                    if p["kind"] == kind and p["state"] == "proposed")
    accepted = auth_client.post(f"/api/v1/cases/{case_id}/agents/proposals/{proposal['id']}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    return proposal


# ─── Report language ──────────────────────────────────────────────────────────

def test_the_report_language_reaches_every_agent(auth_client, db_session, case_id):
    from app.services.charybdis.definitions import definitions, system_prompt

    assert "fr" in auth_client.get("/api/v1/report-languages").json()
    assert auth_client.put(f"/api/v1/cases/{case_id}/report-language", json={"language": "xx"}).status_code == 422
    set_ = auth_client.put(f"/api/v1/cases/{case_id}/report-language", json={"language": "fr"})
    assert set_.status_code == 200 and set_.json()["report_language"] == "fr"
    assert _audit(auth_client, action="case.report_language", case_id=case_id)
    db_session.expire_all()
    prompt = system_prompt(definitions().role("reporter"), db_session.get(Case, case_id))
    assert "briefing in French" in prompt and "No tool takes a language argument" in prompt


# ─── Executive briefing ───────────────────────────────────────────────────────

def test_the_briefing_counts_the_case_and_carries_an_accepted_status(auth_client, db_session, case_id):
    agent = _staff(auth_client, case_id)
    _finding(db_session, case_id, agent["id"], 1, severity="critical")
    _finding(db_session, case_id, agent["id"], 2, state="proposed")
    briefing = auth_client.get(f"/api/v1/cases/{case_id}/briefing").json()
    kpis = {k["key"]: k["value"] for k in briefing["kpis"]}
    assert kpis["findings"] == "1" and kpis["serious"] == "1" and briefing["briefing"] == ""

    ctx = _context(db_session, case_id, agent["id"])
    with pytest.raises(ToolError, match="not validated"):
        run_tool(ctx, "propose_briefing", {"text": "An attacker reached the file server through a stolen "
                                                   "account and copied payroll files. [F2]"})
    run_tool(ctx, "propose_briefing", {"text": "An attacker reached the file server through a stolen account "
                                               "and copied payroll files. [F1]\n\nThe server is isolated. [F1]"})
    _accept(auth_client, case_id, "briefing")
    briefing = auth_client.get(f"/api/v1/cases/{case_id}/briefing").json()
    assert briefing["briefing"].startswith("An attacker reached the file server") and "[F1]" not in briefing["briefing"]
    assert "accepted by" in briefing["briefing_by"]

    edited = auth_client.put(f"/api/v1/cases/{case_id}/briefing", json={"briefing": "Contained. Payroll files copied."})
    assert edited.status_code == 200 and edited.json()["briefing"] == "Contained. Payroll files copied."
    assert _audit(auth_client, action="case.briefing_update", case_id=case_id)


def test_an_executive_reads_the_briefing_but_not_the_agents(client, auth_client, case_id):
    username, password = f"s40-{uuid.uuid4().hex[:8]}", "Executive-pass-40!x"
    created = auth_client.post("/api/v1/users/", json={"username": username, "password": password,
                                                        "role": "executive"})
    assert created.status_code == 201, created.text
    token = client.post("/api/v1/auth/login", json={"username": username, "password": password}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get(f"/api/v1/cases/{case_id}/briefing", headers=headers).status_code == 200
    assert client.get(f"/api/v1/cases/{case_id}/agents/proposals", headers=headers).status_code == 403
    assert client.put(f"/api/v1/cases/{case_id}/briefing", headers=headers,
                      json={"briefing": "x"}).status_code == 403


def test_the_reporter_is_asked_for_the_briefing(auth_client, case_id):
    asked = auth_client.post(f"/api/v1/cases/{case_id}/agents/briefing")
    assert asked.status_code == 202 and asked.json()["agent_name"] == "Reporter"
    task = next(t for t in auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()
                if t["id"] == asked.json()["task_id"])
    assert "propose_briefing" in task["objective"] and task["process_id"] == "report-drafting"


# ─── Attack graph links ───────────────────────────────────────────────────────

def test_an_accepted_link_lands_on_the_graph_without_moving_the_drawing(auth_client, db_session, case_id):
    from app.models.asset import Asset
    from app.models.attack_graph import AttackGraph

    a, b = Asset(case_id=case_id, name="WKS-042", hostname="wks-042.corp"), Asset(case_id=case_id, name="DC01")
    db_session.add_all([a, b])
    db_session.commit()
    drawn = {"id": "n1", "type": "asset", "position": {"x": 40, "y": 60},
             "data": {"label": "WKS-042", "nodeKind": "asset", "sourceId": a.id}}
    db_session.add(AttackGraph(case_id=case_id, nodes=[drawn], edges=[]))
    db_session.commit()

    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    base = {"source": "wks-042.corp", "target": "DC01", "label": "RDP logon as svc_backup",
            "technique_id": "t1021.001", "rationale": "4624 type 10 from the workstation", "evidence": ["Security.csv 4512"]}
    with pytest.raises(ToolError, match="not an asset or indicator"):
        run_tool(ctx, "propose_graph_edge", {**base, "target": "FILESRV"})
    with pytest.raises(ToolError, match="two different nodes"):
        run_tool(ctx, "propose_graph_edge", {**base, "target": "WKS-042"})
    run_tool(ctx, "propose_graph_edge", base)
    with pytest.raises(ToolError, match="Already proposed"):
        run_tool(ctx, "propose_graph_edge", base)
    _accept(auth_client, case_id, "graph_edge")

    graph = auth_client.get(f"/api/v1/cases/{case_id}/attack-graph").json()
    assert graph["nodes"][0] == drawn
    dc = next(n for n in graph["nodes"] if n["data"].get("sourceId") == b.id)
    assert dc["data"]["addedBy"] == "agent" and dc["position"]["y"] > 60
    edge = graph["edges"][0]
    assert (edge["source"], edge["target"]) == ("n1", dc["id"])
    assert edge["label"] == "RDP logon as svc_backup (T1021.001)"
    with pytest.raises(ToolError, match="already on the graph"):
        run_tool(ctx, "propose_graph_edge", base)
    assert "RDP logon" in str(run_tool(ctx, "attack_graph_summary", {}))


def test_the_attacker_node_is_reused_or_drawn(auth_client, db_session, case_id):
    from app.models.asset import Asset

    db_session.add(Asset(case_id=case_id, name="VPN01"))
    db_session.commit()
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    run_tool(ctx, "propose_graph_edge", {"source": "attacker", "target": "VPN01", "label": "Password spray",
                                         "rationale": "Many 4625 then a success", "evidence": ["vpn.csv"]})
    _accept(auth_client, case_id, "graph_edge")
    graph = auth_client.get(f"/api/v1/cases/{case_id}/attack-graph").json()
    assert {n["data"]["nodeKind"] for n in graph["nodes"]} == {"attacker", "asset"}
