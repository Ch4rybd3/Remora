"""
Charybdis S32: observations, findings, review and reporting.

As in the S30 and S31 tests, no test reaches a model: the scripted
`FakeProvider` answers for every agent, in the order they run.
"""
from __future__ import annotations

import json

import pytest
from test_charybdis import FakeProvider, _staff, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _call, _say, _wait

from app.models.case import Case
from app.models.user import User
from app.services.charybdis.llm import set_provider
from app.services.charybdis.tools import AGENT_PERMISSIONS, ToolContext, ToolError, run_tool

CSV = (
    "EventRecordId,TimeCreated,EventId,LogonType,IpAddress\n"
    "4510,2024-03-02 10:10:00,4624,3,10.1.2.9\n"
    "4512,2024-03-02 10:14:07,4624,10,10.1.2.3\n"
    "4513,2024-03-02 10:14:09,4624,10,10.1.2.3\n"
)


@pytest.fixture
def artifact_id(db_session, case_id, tmp_path) -> str:
    from app.models.csv_artifact import CsvArtifactFile
    path = tmp_path / "Security.csv"
    path.write_text(CSV, encoding="utf-8")
    artifact = CsvArtifactFile(case_id=case_id, original_name="Security.csv", file_path=str(path),
                               columns=json.dumps(CSV.splitlines()[0].split(",")), row_count=3,
                               date_column="TimeCreated", ez_label="Event logs")
    db_session.add(artifact)
    db_session.commit()
    return str(artifact.id)


def _context(db_session, case_id, agent_id):
    from app.models.agent import AgentTask
    admin = db_session.query(User).filter(User.username == "admin").one()
    task = AgentTask(case_id=case_id, agent_id=agent_id, objective="x", requested_by_id=admin.id)
    db_session.add(task)
    db_session.commit()
    return ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS,
                       agent_id=agent_id, task_id=task.id, actor="Analyst")


def _audit(auth_client, **params) -> list[dict]:
    response = auth_client.get("/api/v1/audit", params={"page_size": 200, **params})
    assert response.status_code == 200, response.text
    return response.json()["items"]


def _observe(ctx, artifact_id, rql="EventRecordId = 4512"):
    return run_tool(ctx, "record_observation",
                    {"artifact_id": artifact_id, "rql": rql, "note": "RDP logon from 10.1.2.3"})


def _finding(ctx, observation_ids, title="RDP logon on DC01 from 10.1.2.3"):
    return run_tool(ctx, "propose_finding", {
        "title": title, "statement": "An interactive RDP logon came from 10.1.2.3.",
        "severity": "high", "confidence": "high",
        "confidence_reason": "LogonType 10 in the Security log",
        "observation_ids": observation_ids, "attack_ids": ["T1021.001"]})


# ─── Definitions ──────────────────────────────────────────────────────────────

def test_the_reviewer_and_reporter_roles_load_and_only_workers_are_assignable():
    from app.services.charybdis.definitions import definitions
    roles = definitions().roles
    assert roles["reviewer"].process == "review-finding"
    assert roles["reporter"].process == "report-drafting"
    assert {r.id for r in roles.values() if r.assignable} == {"analyst-windows", "reporter"}


# ─── Observations ─────────────────────────────────────────────────────────────

def test_an_observation_is_re_read_and_must_match_exactly_one_row(db_session, case_id,
                                                                   auth_client, artifact_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    with pytest.raises(ToolError, match="matches 2 rows"):
        _observe(ctx, artifact_id, rql="LogonType = 10")
    with pytest.raises(ToolError, match="matches 0 rows"):
        _observe(ctx, artifact_id, rql="EventRecordId = 9999")

    result = _observe(ctx, artifact_id)
    assert result["row"]["IpAddress"] == "10.1.2.3"

    cited = auth_client.get(
        f"/api/v1/cases/{case_id}/agents/observations/{result['observation_id']}").json()
    assert cited["locator"] == "EventRecordId = 4512"
    assert cited["artifact_id"] == artifact_id
    assert cited["row"]["EventRecordId"] == "4512"
    assert cited["available"] is True


def test_a_finding_must_rest_on_recorded_observations(db_session, case_id, auth_client,
                                                      artifact_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    with pytest.raises(ToolError, match="Unknown observations"):
        _finding(ctx, ["made-up"])
    with pytest.raises(ToolError, match="ATT&CK"):
        run_tool(ctx, "propose_finding", {
            "title": "Something", "statement": "Something happened here.", "severity": "high",
            "confidence": "low", "confidence_reason": "a guess",
            "observation_ids": [_observe(ctx, artifact_id)["observation_id"]],
            "attack_ids": ["lateral movement"]})

    first = _finding(ctx, [_observe(ctx, artifact_id)["observation_id"]])
    second = _finding(ctx, [_observe(ctx, artifact_id, "EventRecordId = 4513")["observation_id"]],
                      title="Second RDP logon from 10.1.2.3")
    # No reviewer on this case: straight to the analyst, numbered per case.
    assert (first["finding"], first["state"]) == ("F1", "proposed")
    assert second["finding"] == "F2"
    read = run_tool(ctx, "read_finding", {"finding": "F1"})
    assert read["observations"][0]["row"]["LogonType"] == "10"


# ─── Review ───────────────────────────────────────────────────────────────────

def test_the_reviewer_challenges_a_finding_and_the_author_reads_why(
        auth_client, db_session, case_id, artifact_id, fake_provider):  # noqa: F811
    """S32 exit criterion: the reviewer rejects a finding with a reason."""
    from app.models.agent import AgentInstance
    from app.services.charybdis.runtime import _history

    set_provider("ollama", FakeProvider([
        _say("The row is a logon of type 10 but nothing ties it to DC01."),
        _call("review_finding", finding="F1", verdict="unsupported",
              comment="The cited row does not name the host; DC01 is assumed.",
              alternatives="The logon could be on any host whose log was collected."),
        _say("Unsupported: the host is not shown."),
    ]))
    team = {a["role"]: a for a in auth_client.post(f"/api/v1/cases/{case_id}/agents/team").json()}
    assert set(team) == {"incident-leader", "analyst-windows", "reviewer", "reporter"}
    analyst = team["analyst-windows"]

    ctx = _context(db_session, case_id, analyst["id"])
    proposed = _finding(ctx, [_observe(ctx, artifact_id)["observation_id"]])
    assert proposed["state"] == "in_review"

    def finding():
        return auth_client.get(f"/api/v1/cases/{case_id}/agents/findings").json()[0]

    reviewed = _wait(lambda: finding() if finding()["state"] == "proposed" else None)
    assert reviewed["review_verdict"] == "unsupported"
    assert "DC01 is assumed" in reviewed["review_comment"]
    assert reviewed["reviewed_by"] == team["reviewer"]["name"]
    assert reviewed["observations"][0]["locator"] == "EventRecordId = 4512"

    rejected = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/findings/{reviewed['id']}/reject",
        json={"comment": "Agree with the reviewer"})
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["state"] == "rejected"
    again = auth_client.post(f"/api/v1/cases/{case_id}/agents/findings/{reviewed['id']}/validate",
                             json={})
    assert again.status_code == 409

    db_session.expire_all()
    notes = [m.content for m in _history(db_session, db_session.get(AgentInstance, analyst["id"]), "")]
    assert any("unsupported" in n and "DC01 is assumed" in n for n in notes)
    assert any("rejected your finding" in n and "Agree with the reviewer" in n for n in notes)

    entries = _audit(auth_client, action="agent.finding_reject")
    assert entries and entries[0]["resource_name"].startswith("F1 ")
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/events/verify").json()["ok"] is True


def test_cancelling_a_review_hands_the_finding_to_the_analyst(db_session, case_id, auth_client,
                                                              artifact_id, fake_provider):  # noqa: F811
    from app.models.agent import AgentFinding, AgentInstance, AgentTask
    from app.services.charybdis.delegation import request_review

    # A reviewer that would take forever: the task is cancelled before it runs.
    set_provider("ollama", FakeProvider([_say("thinking")]))
    analyst = _staff(auth_client, case_id)
    ctx = _context(db_session, case_id, analyst["id"])
    observation = _observe(ctx, artifact_id)["observation_id"]
    _finding(ctx, [observation])
    reviewer = AgentInstance(case_id=case_id, role="reviewer", name="Reviewer",
                             provider="ollama", model="m")
    db_session.add(reviewer)
    db_session.commit()
    finding = db_session.query(AgentFinding).filter(AgentFinding.case_id == case_id).one()
    finding.state = "proposed"
    task = request_review(db_session, finding)
    assert task is not None and finding.state == "in_review"

    response = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/{reviewer.id}/tasks/{task.id}/cancel")
    if response.status_code == 409:
        # The fake answered first; the review then ended without a verdict.
        assert db_session.get(AgentTask, task.id) is not None
    db_session.expire_all()
    finding = db_session.get(AgentFinding, finding.id)
    assert finding.state == "proposed"
    assert "without a verdict" in (finding.review_comment or "")


# ─── Reporting ────────────────────────────────────────────────────────────────

def _validated_and_open(db_session, case_id, auth_client, artifact_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    one = _finding(ctx, [_observe(ctx, artifact_id)["observation_id"]])
    _finding(ctx, [_observe(ctx, artifact_id, "EventRecordId = 4513")["observation_id"]],
             title="Second RDP logon from 10.1.2.3")
    response = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/findings/{one['finding_id']}/validate", json={})
    assert response.status_code == 200, response.text
    return ctx


def test_report_text_may_cite_validated_findings_only(db_session, case_id, auth_client,
                                                      artifact_id):
    ctx = _validated_and_open(db_session, case_id, auth_client, artifact_id)
    section = run_tool(ctx, "report_outline", {})["sections"][0]["section"]

    with pytest.raises(ToolError, match="Every paragraph must cite"):
        run_tool(ctx, "propose_report_section", {
            "section": section, "text": "An RDP logon came from 10.1.2.3. [F1]\n\nIt was bad."})
    with pytest.raises(ToolError, match=r"not validated: \['F2'\]"):
        run_tool(ctx, "propose_report_section", {
            "section": section, "text": "Two RDP logons came from 10.1.2.3. [F1][F2]"})
    with pytest.raises(ToolError, match="Unknown section"):
        run_tool(ctx, "propose_report_section", {"section": "nope", "text": "x" * 30 + " [F1]"})

    run_tool(ctx, "propose_report_section", {
        "section": section,
        "text": "## Access\n\nAn interactive RDP logon came from 10.1.2.3. [F1]"})


def test_accepting_report_text_appends_it_without_the_citation_marks(db_session, case_id,
                                                                     auth_client, artifact_id):
    ctx = _validated_and_open(db_session, case_id, auth_client, artifact_id)
    section = run_tool(ctx, "report_outline", {})["sections"][0]["section"]
    case = db_session.get(Case, case_id)
    case.report_sections_data = json.dumps({section: "Written by the analyst."})
    case.executive_summary = ""
    db_session.commit()

    run_tool(ctx, "propose_report_section",
             {"section": section, "text": "An RDP logon came from 10.1.2.3. [F1]"})
    run_tool(ctx, "propose_executive_summary",
             {"text": "An outsider reached a server through remote desktop. [F1]"})
    for proposal in auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals",
                                    params={"state": "proposed"}).json():
        response = auth_client.post(
            f"/api/v1/cases/{case_id}/agents/proposals/{proposal['id']}/accept", json={})
        assert response.status_code == 200, response.text

    db_session.expire_all()
    case = db_session.get(Case, case_id)
    assert json.loads(case.report_sections_data)[section] == (
        "Written by the analyst.\n\nAn RDP logon came from 10.1.2.3.")
    assert case.executive_summary == "An outsider reached a server through remote desktop."
    actions = {e["action"] for e in _audit(auth_client)}
    assert {"report.save", "case.update", "agent.proposal_accept"} <= actions


def test_a_technique_is_proposed_once_and_lands_on_the_matrix(db_session, case_id, auth_client):
    from app.models.mitre import CaseTTP

    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    args = {"technique_id": "t1021.001", "technique_name": "Remote Desktop Protocol",
            "tactic": "lateral-movement", "rationale": "RDP logon", "evidence": ["observation x"]}
    run_tool(ctx, "propose_ttp", args)
    with pytest.raises(ToolError, match="Already proposed"):
        run_tool(ctx, "propose_ttp", args)
    proposal = auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()[0]
    assert proposal["payload"]["technique_id"] == "T1021.001"
    response = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/proposals/{proposal['id']}/accept", json={})
    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert db_session.query(CaseTTP).filter(CaseTTP.case_id == case_id).one().technique_id == "T1021.001"
    with pytest.raises(ToolError, match="already on the case matrix"):
        run_tool(ctx, "propose_ttp", args)


# ─── Trace export ─────────────────────────────────────────────────────────────

def test_the_trace_exports_as_json_lines_with_its_chain(db_session, case_id, auth_client,
                                                        artifact_id):
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    _finding(ctx, [_observe(ctx, artifact_id)["observation_id"]])
    response = auth_client.get(f"/api/v1/cases/{case_id}/agents/events/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]
    lines = [json.loads(line) for line in response.text.splitlines()]
    assert lines and lines[-1]["kind"] == "finding"
    assert all(b["prev_hash"] == a["hash"] for a, b in zip(lines, lines[1:], strict=False))
