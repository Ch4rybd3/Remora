"""
Charybdis S38: the role and process editor, playbook steps handed to agents.
"""
from __future__ import annotations

import json

import pytest
from test_charybdis import FakeProvider, fake_provider  # noqa: F401  (fixture)
from test_charybdis_s31 import _say, _wait

from app.services.charybdis.llm import set_provider

STARTER_ROLE = """id: analyst-cloud
name: Cloud analyst
description: Reads cloud audit logs.
reports_to: incident-leader
prompt: analyst-cloud.md
process: analyst-investigation
conversation_process: conversation
assignable: true
max_steps: 12
tools: [case_overview, list_evidence, ingest_status, list_artifacts, store_schema, store_search,
        list_iocs, list_timeline, list_findings, record_observation, propose_finding, propose_ioc,
        propose_timeline_event, propose_ttp, request_help]
"""


@pytest.fixture
def clean_definitions(db_session):
    """Edited definitions are global: leave none behind for the next test."""
    from app.models.agent import AgentDefinitionOverride
    from app.services.charybdis.definitions import reload
    yield
    db_session.query(AgentDefinitionOverride).delete()
    db_session.commit()
    reload()


def _definitions(auth_client):
    return {(d["kind"], d["name"]): d for d in auth_client.get("/api/v1/agents/definitions").json()}


# ─── Editor ───────────────────────────────────────────────────────────────────

def test_a_new_role_is_checked_then_staffed(auth_client, case_id, clean_definitions):
    put = lambda kind, name, content: auth_client.put(  # noqa: E731
        f"/api/v1/agents/definitions/{kind}/{name}", json={"content": content})

    refused = put("role", "analyst-cloud", STARTER_ROLE)
    assert refused.status_code == 422 and "prompt analyst-cloud.md not found" in refused.json()["detail"]
    assert put("prompt", "analyst-cloud.md", "You read cloud audit logs. Never invent a value.").status_code == 200
    saved = put("role", "analyst-cloud", STARTER_ROLE)
    assert saved.status_code == 200, saved.text
    assert saved.json()["origin"] == "custom"

    roles = {r["id"]: r for r in auth_client.get("/api/v1/agents/roles").json()}
    assert roles["analyst-cloud"]["assignable"] and roles["analyst-cloud"]["name"] == "Cloud analyst"
    agent = auth_client.post(f"/api/v1/cases/{case_id}/agents/", json={"role": "analyst-cloud"})
    assert agent.status_code == 201 and agent.json()["role"] == "analyst-cloud"

    # The prompt is still needed by the role: removing it would break it.
    blocked = auth_client.delete("/api/v1/agents/definitions/prompt/analyst-cloud.md")
    assert blocked.status_code == 422
    assert auth_client.delete("/api/v1/agents/definitions/role/analyst-cloud").status_code == 204
    assert auth_client.delete("/api/v1/agents/definitions/prompt/analyst-cloud.md").status_code == 204
    assert ("role", "analyst-cloud") not in _definitions(auth_client)


def test_an_edit_that_breaks_a_role_is_refused_with_the_reason(auth_client, clean_definitions):
    original = _definitions(auth_client)[("role", "analyst-email")]
    assert original["origin"] == "builtin"
    unknown_tool = original["content"].replace("tools: [", "tools: [launch_missiles, ", 1)
    refused = auth_client.put("/api/v1/agents/definitions/role/analyst-email", json={"content": unknown_tool})
    assert refused.status_code == 422 and "launch_missiles" in refused.json()["detail"]
    renamed = auth_client.put("/api/v1/agents/definitions/role/analyst-email",
                              json={"content": original["content"].replace("id: analyst-email", "id: other", 1)})
    assert renamed.status_code == 422 and "its id is 'other'" in renamed.json()["detail"]
    assert auth_client.put("/api/v1/agents/definitions/role/Bad Name", json={"content": "x"}).status_code == 422


def test_an_edited_role_is_used_and_reverted(auth_client, clean_definitions):
    from app.services.charybdis.definitions import definitions

    original = _definitions(auth_client)[("role", "analyst-email")]
    edited = original["content"].replace("max_steps:", "max_steps: 7\n# was:", 1) \
        if "max_steps:" in original["content"] else original["content"] + "\nmax_steps: 7\n"
    saved = auth_client.put("/api/v1/agents/definitions/role/analyst-email", json={"content": edited})
    assert saved.status_code == 200, saved.text
    assert saved.json()["origin"] == "modified" and definitions().role("analyst-email").max_steps == 7
    assert auth_client.delete("/api/v1/agents/definitions/role/analyst-email").status_code == 204
    assert definitions().role("analyst-email").max_steps != 7
    assert _definitions(auth_client)[("role", "analyst-email")]["origin"] == "builtin"


def test_editing_definitions_is_for_administrators(client, auth_client):
    import uuid
    username = f"s38-{uuid.uuid4().hex[:8]}"
    password = "Analyst-pass-38!x"
    created = auth_client.post("/api/v1/users/", json={"username": username, "password": password,
                                                        "role": "analyst"})
    assert created.status_code == 201, created.text
    token = client.post("/api/v1/auth/login", json={"username": username,
                                                     "password": password}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/agents/definitions", headers=headers).status_code == 403
    assert client.put("/api/v1/agents/definitions/prompt/x.md", headers=headers,
                      json={"content": "x"}).status_code == 403


# ─── Playbook steps ───────────────────────────────────────────────────────────

def _playbook(auth_client, case_id):
    pb = auth_client.post("/api/v1/playbooks", json={"name": "Phishing response", "nodes": [
        {"id": "n1", "type": "step", "data": {"label": "Check the reported email",
                                              "description": "Sender, links and attachments."}}]}).json()
    cp = auth_client.post(f"/api/v1/cases/{case_id}/playbooks", json={"playbook_id": pb["id"]})
    assert cp.status_code == 201, cp.text
    return cp.json()


def test_a_playbook_step_handed_to_an_agent_comes_back_in_its_notes(auth_client, case_id,
                                                                    fake_provider):  # noqa: F811
    set_provider("ollama", FakeProvider([_say("The sender domain was registered yesterday.")]))
    cp = _playbook(auth_client, case_id)
    assigned = auth_client.patch(f"/api/v1/cases/{case_id}/playbooks/{cp['id']}/steps/n1/assignee", json={
        "assignee": {"kind": "agent", "role": "analyst-email", "label": "Email analyst"}})
    assert assigned.status_code == 200, assigned.text
    state = assigned.json()["step_states"]["n1"]
    task_id = state["assignee"]["agent_task_id"]
    assert task_id and state["agent_status"] == "pending"

    tasks = {t["id"]: t for t in auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json()}
    assert 'step "Check the reported email"' in tasks[task_id]["objective"]
    assert "Sender, links and attachments." in tasks[task_id]["objective"]

    def written_back():
        cps = auth_client.get(f"/api/v1/cases/{case_id}/playbooks").json()
        step = next(c for c in cps if c["id"] == cp["id"])["step_states"]["n1"]
        return step if step.get("agent_status") == "done" else None
    step = _wait(written_back, timeout=20)
    assert "registered yesterday" in step["notes"] and "Email analyst" in step["notes"]
    assert step["done"] is False


def test_a_step_cannot_go_to_the_leader_or_an_unknown_role(auth_client, case_id):
    cp = _playbook(auth_client, case_id)
    for role in ("incident-leader", "nobody"):
        refused = auth_client.patch(f"/api/v1/cases/{case_id}/playbooks/{cp['id']}/steps/n1/assignee", json={
            "assignee": {"kind": "agent", "role": role, "label": role}})
        assert refused.status_code == 422
    assert json.loads(json.dumps(auth_client.get(f"/api/v1/cases/{case_id}/agents/tasks").json())) == []
