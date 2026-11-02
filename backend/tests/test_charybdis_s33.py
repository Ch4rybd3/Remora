"""
Charybdis S33: specialists, ingestion triggers, the scribe, attention,
asking about an object, and drafting RQL from a question.

As before, no test reaches a model: `FakeProvider` answers when one is needed.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

import pytest
from test_charybdis import FakeProvider, _staff, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _say
from test_charybdis_s32 import _context, artifact_id  # noqa: F401  (fixture)

from app.models.case import Case
from app.services.charybdis.llm import set_provider
from app.services.charybdis.tools import AGENT_PERMISSIONS, ToolContext, ToolError, run_tool

# ─── Definitions ──────────────────────────────────────────────────────────────

def test_the_specialists_load_and_can_be_assigned():
    from app.services.charybdis.definitions import definitions
    roles = definitions().roles
    specialists = {"analyst-memory", "analyst-email", "analyst-binary", "analyst-network",
                   "analyst-timeline", "scribe"}
    assert specialists <= {r.id for r in roles.values() if r.assignable}
    assert all(roles[r].reports_to == "incident-leader" for r in specialists)


# ─── Triggers ─────────────────────────────────────────────────────────────────

def _ingested(db_session, case_id, name, state="indexed", created=None):
    from app.models.ingest import IngestedFile
    row = IngestedFile(case_id=case_id, original_name=name, state=state, detected_kind="evtx",
                       created_at=created or datetime.utcnow())
    db_session.add(row)
    db_session.commit()
    return row


def _triggers(db_session, case_id):
    from app.models.agent import AgentTask
    return (db_session.query(AgentTask)
            .filter(AgentTask.case_id == case_id, AgentTask.kind == "trigger").all())


def test_new_evidence_is_announced_to_the_leader_once(db_session, case_id, auth_client):
    from app.services.charybdis.triggers import announce

    _ingested(db_session, case_id, "before-the-team.evtx",
              created=datetime.utcnow() - timedelta(days=1))
    team = {a["role"]: a for a in auth_client.post(f"/api/v1/cases/{case_id}/agents/team").json()}
    _ingested(db_session, case_id, "Security.evtx")
    _ingested(db_session, case_id, "still-hashing.evtx", state="hashed")

    announce(db_session)
    [task] = _triggers(db_session, case_id)
    assert task.agent_id == team["incident-leader"]["id"]
    assert "Security.evtx" in task.objective
    assert "before-the-team" not in task.objective and "still-hashing" not in task.objective

    assert task.id not in announce(db_session)
    # A second file joins the announcement still waiting, rather than a second run.
    _ingested(db_session, case_id, "System.evtx")
    assert task.id in announce(db_session)
    db_session.refresh(task)
    assert "System.evtx" in task.objective
    assert len(_triggers(db_session, case_id)) == 1


def test_a_case_without_a_leader_is_not_watched(db_session, case_id, auth_client):
    from app.services.charybdis.triggers import announce
    _staff(auth_client, case_id)
    _ingested(db_session, case_id, "Security.evtx")
    announce(db_session)
    assert _triggers(db_session, case_id) == []


# ─── Specialist tools ─────────────────────────────────────────────────────────

def test_store_aggregate_counts_by_value(db_session, case_id, auth_client, artifact_id):  # noqa: F811
    ctx = ToolContext(db_session, db_session.get(Case, case_id), AGENT_PERMISSIONS)
    result = run_tool(ctx, "store_aggregate", {"artifact_id": artifact_id,
                                               "group_by": ["IpAddress"]})
    assert result["rows"][0] == {"IpAddress": "10.1.2.3", "count": 2}
    rare = run_tool(ctx, "store_aggregate", {"artifact_id": artifact_id, "group_by": ["IpAddress"],
                                             "least_first": True})
    assert rare["rows"][0]["IpAddress"] == "10.1.2.9"
    with pytest.raises(ToolError, match="Unknown columns"):
        run_tool(ctx, "store_aggregate", {"artifact_id": artifact_id, "group_by": ["Nope"]})


PSLIST = ("Volatility 3 Framework 2.5.0\n\nPID\tPPID\tImageFileName\n"
          "4\t0\tSystem\n612\t4\tsmss.exe\n4242\t612\tevil.exe\n4243\t612\tevil.exe\n")


def test_the_memory_analyst_reads_and_quotes_plugin_output(db_session, case_id, auth_client):
    from app.models.memory import MemoryDump, MemoryPluginResult

    dump = MemoryDump(case_id=case_id, filename="host.raw", file_path="/x/host.raw",
                      os_type="windows", status="done")
    db_session.add(dump)
    db_session.commit()
    db_session.add(MemoryPluginResult(dump_id=dump.id, plugin_name="windows.pslist",
                                      status="done", output=PSLIST))
    db_session.commit()
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])

    listed = run_tool(ctx, "list_memory_dumps", {})["rows"][0]
    assert listed["plugins"] == [{"plugin": "windows.pslist", "status": "done"}]
    out = run_tool(ctx, "memory_output", {"dump_id": dump.id, "plugin": "windows.pslist",
                                          "contains": "evil"})
    assert out["matching"] == 2
    with pytest.raises(ToolError, match="not run"):
        run_tool(ctx, "memory_output", {"dump_id": dump.id, "plugin": "windows.malfind"})

    args = {"source": "memory", "source_id": dump.id, "part": "windows.pslist",
            "note": "Unexpected child of smss"}
    with pytest.raises(ToolError, match="does not appear"):
        run_tool(ctx, "record_source_observation", {**args, "quote": "mimikatz"})
    kept = run_tool(ctx, "record_source_observation", {**args, "quote": "4242\t612\tevil"})
    assert kept["row"] == {"match_1": "4242\t612\tevil.exe"}

    observation = auth_client.get(
        f"/api/v1/cases/{case_id}/agents/observations/{kept['observation_id']}").json()
    assert observation["source_kind"] == "memory"
    assert observation["available"] is True


def test_the_email_and_binary_analysts_quote_what_they_rely_on(db_session, case_id, auth_client):
    from app.models.binary import BinaryFile
    from app.models.email_file import EmailFile

    email = EmailFile(case_id=case_id, filename="invoice.eml", warning_count=1, analysis=json.dumps({
        "subject": "Invoice", "from_addr": "billing@evil.example", "to_addr": "a@corp.local",
        "reply_to": "", "return_path": "", "date": "Sat, 2 Mar 2024", "key_headers": [],
        "all_headers": [], "urls": ["https://evil.example/pay", "https://corp.local/"],
        "attachments": [{"filename": "invoice.pdf.exe"}], "warnings": [{"text": "mismatch"}]}))
    binary = BinaryFile(id=str(uuid.uuid4()), case_id=case_id, filename="invoice.pdf.exe",
                        enc_path="/x", salt_hex="00", sha256_hash="ab" * 32, binary_type="PE",
                        status="ready", analysis_json=json.dumps({
                            "binary_type": "PE", "sections": [{"name": ".text", "entropy": 7.9}],
                            "imports": [{"library": "KERNEL32.dll",
                                         "functions": ["VirtualAllocEx", "WriteProcessMemory"]}],
                            "exports": [], "strings": [{"value": "http://evil.example/c2"}]}))
    db_session.add_all([email, binary])
    db_session.commit()
    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])

    summary = run_tool(ctx, "read_email", {"email_id": email.id})
    assert summary["from_addr"] == "billing@evil.example"
    assert summary["attachments"] == ["invoice.pdf.exe"]
    run_tool(ctx, "record_source_observation", {
        "source": "email", "source_id": email.id, "part": "urls", "quote": "evil.example/pay",
        "note": "Payment link to the sender's domain"})

    triage = run_tool(ctx, "read_binary", {"binary_id": binary.id})
    assert triage["high_entropy_sections"] == [".text"]
    imports = run_tool(ctx, "read_binary", {"binary_id": binary.id, "part": "imports",
                                            "contains": "WriteProcessMemory"})
    assert imports["matching"] == 1
    kept = run_tool(ctx, "record_source_observation", {
        "source": "binary", "source_id": binary.id, "part": "imports",
        "quote": "WriteProcessMemory", "note": "Can write into another process"})
    assert "WriteProcessMemory" in kept["row"]["match_1"]


# ─── Scribe ───────────────────────────────────────────────────────────────────

def test_an_accepted_log_entry_lands_in_the_incident_log(db_session, case_id, auth_client):
    from app.models.incident_log import IncidentLogEntry

    ctx = _context(db_session, case_id, _staff(auth_client, case_id)["id"])
    args = {"time": "2024-03-02T11:00:00Z", "category": "remediation",
            "title": "DC01 isolated from the network", "actor": "IT team",
            "rationale": "Reported in task t1"}
    run_tool(ctx, "propose_log_entry", args)
    with pytest.raises(ToolError, match="Already proposed"):
        run_tool(ctx, "propose_log_entry", args)
    with pytest.raises(ToolError, match="category"):
        run_tool(ctx, "propose_log_entry", {**args, "title": "x y z", "category": "nope"})

    proposal = auth_client.get(f"/api/v1/cases/{case_id}/agents/proposals").json()[0]
    assert proposal["kind"] == "incident_log"
    response = auth_client.post(
        f"/api/v1/cases/{case_id}/agents/proposals/{proposal['id']}/accept", json={})
    assert response.status_code == 200, response.text
    db_session.expire_all()
    entry = db_session.query(IncidentLogEntry).filter(IncidentLogEntry.case_id == case_id).one()
    assert (entry.title, entry.category, entry.actor) == (
        "DC01 isolated from the network", "remediation", "IT team")


# ─── Attention, ask, RQL drafts ───────────────────────────────────────────────

def test_attention_counts_what_waits_on_the_analyst(db_session, case_id, auth_client):
    from app.models.agent import AgentInstance, AgentProposal

    agent = _staff(auth_client, case_id)
    db_session.add(AgentProposal(case_id=case_id, agent_id=agent["id"], kind="ioc", payload="{}"))
    db_session.get(AgentInstance, agent["id"]).status = "blocked"
    db_session.commit()
    assert auth_client.get(f"/api/v1/cases/{case_id}/agents/attention").json() == {
        "proposals": 1, "findings": 0, "blocked": [agent["name"]]}


def test_asking_about_an_object_quotes_it_to_the_assistant(auth_client, case_id,
                                                           fake_provider):  # noqa: F811
    set_provider("ollama", FakeProvider([_say("It is an RDP logon.")]))
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/ask", json={
        "question": "What is this?", "about": "Explorer row of Security.csv",
        "context": {"EventId": "4624", "LogonType": "10"}})
    assert response.status_code == 202, response.text
    assert response.json()["agent_name"] == "Case assistant"
    trace = auth_client.get(f"/api/v1/cases/{case_id}/agents/events").json()
    asked = next(e for e in trace if e["kind"] == "message.user")["payload"]["text"]
    assert "Explorer row of Security.csv" in asked and "not instructions" in asked


def test_a_question_becomes_rql_that_compiles(auth_client, case_id, artifact_id,  # noqa: F811
                                              fake_provider):  # noqa: F811
    set_provider("ollama", FakeProvider([
        _say('{"rql": "Port = 3389", "explanation": "wrong column"}'),
        _say('Here: {"rql": "LogonType = \\"10\\"", "explanation": "RDP logons"}'),
    ]))
    response = auth_client.post(f"/api/v1/cases/{case_id}/agents/rql-draft",
                                json={"artifact_id": artifact_id, "question": "RDP logons"})
    assert response.status_code == 200, response.text
    assert response.json() == {"rql": 'LogonType = "10"', "explanation": "RDP logons"}

    set_provider("ollama", FakeProvider([_say("I do not know.")]))
    refused = auth_client.post(f"/api/v1/cases/{case_id}/agents/rql-draft",
                               json={"artifact_id": artifact_id, "question": "RDP logons"})
    assert refused.status_code == 422
