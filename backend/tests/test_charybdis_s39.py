"""
Charybdis S39: collection requests for missing evidence, phases of the response.
"""
from __future__ import annotations

import pytest
from test_charybdis import _staff
from test_charybdis_s32 import _audit, _context

from app.models.case import Case
from app.services.charybdis.tools import ToolError, run_tool


def _accept(auth_client, case_id, proposal_id, payload=None):
    accepted = auth_client.post(f"/api/v1/cases/{case_id}/agents/proposals/{proposal_id}/accept",
                                json={"payload": payload} if payload else {})
    assert accepted.status_code == 200, accepted.text
    return accepted.json()


# ─── Collection requests ──────────────────────────────────────────────────────

def test_missing_evidence_becomes_a_request_list_per_host(auth_client, db_session, case_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    base = {"host": "WKS-042", "artifact": "prefetch", "reason": "Which binaries ran after the RDP logon?"}
    with pytest.raises(ToolError, match="Unknown artifact kind 'browsing'"):
        run_tool(ctx, "propose_collection", {**base, "artifact": "browsing"})
    with pytest.raises(ToolError, match="Unknown hypothesis H7"):
        run_tool(ctx, "propose_collection", {**base, "hypothesis": "H7"})
    run_tool(ctx, "propose_collection", base)
    with pytest.raises(ToolError, match="Already proposed"):
        run_tool(ctx, "propose_collection", {**base, "host": "wks-042"})
    run_tool(ctx, "propose_collection", {**base, "artifact": "evtx", "reason": "Logons on the workstation"})
    run_tool(ctx, "propose_collection", {"host": "DC01", "artifact": "ntds", "reason": "Which accounts exist?"})

    proposals = {p["payload"]["artifact"]: p for p in auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()}
    assert proposals["prefetch"]["payload"]["label"].startswith("Prefetch")
    for artifact in ("prefetch", "evtx", "ntds"):
        _accept(auth_client, case_id, proposals[artifact]["id"])
    with pytest.raises(ToolError, match="Already requested"):
        run_tool(ctx, "propose_collection", base)

    requests = auth_client.get(f"/api/v1/cases/{case_id}/agents/collection-requests").json()
    assert [(r["host"], r["artifact"]) for r in requests] == [("DC01", "ntds"), ("WKS-042", "prefetch"),
                                                               ("WKS-042", "evtx")]
    ntds = requests[0]
    updated = auth_client.patch(f"/api/v1/cases/{case_id}/agents/collection-requests/{ntds['id']}",
                                json={"state": "collected", "note": "Received from the client on Tuesday"})
    assert updated.status_code == 200 and updated.json()["state"] == "collected"
    assert auth_client.patch(f"/api/v1/cases/{case_id}/agents/collection-requests/{ntds['id']}",
                             json={"state": "lost"}).status_code == 422
    assert _audit(auth_client, action="agent.collection_update", case_id=case_id)

    export = auth_client.get(f"/api/v1/cases/{case_id}/agents/collection-requests/export")
    assert export.status_code == 200 and "## WKS-042" in export.text
    assert "Which binaries ran after the RDP logon?" in export.text and "DC01" not in export.text
    assert run_tool(ctx, "list_collection_requests", {})["total"] == 3


def test_a_request_can_name_the_hypothesis_it_would_decide(auth_client, db_session, case_id):
    from app.models.agent import AgentHypothesis

    agent = _staff(auth_client, case_id)
    db_session.add(AgentHypothesis(case_id=case_id, ref=1, statement="The attacker came in over RDP."))
    db_session.commit()
    ctx = _context(db_session, case_id, agent["id"])
    run_tool(ctx, "propose_collection", {"host": "FW01", "artifact": "log", "hypothesis": "h1",
                                         "reason": "Inbound 3389 at the perimeter"})
    proposal = auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()[0]
    assert proposal["payload"]["hypothesis"] == "H1"


# ─── Phases ───────────────────────────────────────────────────────────────────

def test_the_phase_is_set_by_the_analyst_and_known_to_agents(auth_client, db_session, case_id):
    from app.services.charybdis.definitions import definitions, system_prompt

    phase = auth_client.get(f"/api/v1/cases/{case_id}/agents/phase").json()
    assert phase["phase"] == "identification"
    assert [p["id"] for p in phase["phases"]] == ["identification", "containment", "eradication",
                                                  "recovery", "lessons"]
    assert phase["phases"][1]["questions"]
    assert auth_client.put(f"/api/v1/cases/{case_id}/agents/phase", json={"phase": "panic"}).status_code == 422
    moved = auth_client.put(f"/api/v1/cases/{case_id}/agents/phase", json={"phase": "containment"})
    assert moved.status_code == 200 and moved.json()["phase"] == "containment"
    assert _audit(auth_client, action="case.phase_change", case_id=case_id)

    db_session.expire_all()
    case = db_session.get(Case, case_id)
    prompt = system_prompt(definitions().role("incident-leader"), case)
    assert "Phase: Containment" in prompt and "isolated or disabled" in prompt


def test_the_leader_proposes_the_next_phase_and_the_analyst_decides(auth_client, db_session, case_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    assert run_tool(ctx, "case_phase", {})["phase"] == "identification"
    with pytest.raises(ToolError, match="already in identification"):
        run_tool(ctx, "propose_phase", {"phase": "identification", "rationale": "Nothing changed at all"})
    with pytest.raises(ToolError, match="phase must be one of"):
        run_tool(ctx, "propose_phase", {"phase": "celebration", "rationale": "We are done here, surely"})
    run_tool(ctx, "propose_phase", {"phase": "containment",
                                    "rationale": "Patient zero, the access path and the affected hosts are known"})
    with pytest.raises(ToolError, match="already waiting"):
        run_tool(ctx, "propose_phase", {"phase": "eradication", "rationale": "Skipping ahead to eradication"})
    proposal = auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()[0]
    assert proposal["kind"] == "phase" and proposal["payload"] == {"phase": "containment", "from": "identification"}
    _accept(auth_client, case_id, proposal["id"])
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/phase").json()["phase"] == "containment"


def test_definitions_give_analysts_and_the_leader_the_new_tools():
    from app.services.charybdis.definitions import definitions

    d = definitions()
    assert {"case_phase", "propose_phase", "propose_collection"} <= set(d.role("incident-leader").tools)
    for role in ("analyst-windows", "analyst-email", "analyst-memory"):
        assert "propose_collection" in d.role(role).tools
    assert "propose_collection" in d.processes["specialist-investigation"].steps[2].instructions
