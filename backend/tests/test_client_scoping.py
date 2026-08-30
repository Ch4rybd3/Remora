"""
Restricting an account to a set of clients.

A consultancy runs cases for several clients out of one Remora, and the analyst
on the retail breach has no business reading the bank's evidence. Saying so in
a contract is not the same as enforcing it.

The test that matters most is the last one: it walks every route carrying a
case id and asserts the scoping dependency is attached, so a new artifact page
under a case cannot be added unscoped.
"""
from __future__ import annotations

import uuid

import pytest

from app.core import scoping
from app.main import app
from app.models.case import Case
from app.models.client import Client
from app.models.user import User

PASSWORD = "Test-Password-42"


@pytest.fixture()
def two_clients(db_session):
    """Two clients, each with one case."""
    made = {}
    for label in ("retail", "bank"):
        client = Client(id=str(uuid.uuid4()), name=f"{label}-{uuid.uuid4().hex[:6]}")
        case = Case(id=str(uuid.uuid4()), title=f"{label} incident", client_id=client.id)
        db_session.add_all([client, case])
        made[label] = {"client": client, "case": case}
    db_session.commit()
    return made


@pytest.fixture()
def scoped_session(client, auth_client, db_session, two_clients):
    """An analyst restricted to the retail client, and their auth header."""
    username = f"scoped-{uuid.uuid4().hex[:8]}"
    created = auth_client.post("/api/v1/users/", json={
        "username": username, "password": PASSWORD, "role": "analyst"})
    assert created.status_code == 201, created.text

    assigned = auth_client.put(
        f"/api/v1/users/{created.json()['id']}/clients",
        json={"client_ids": [two_clients["retail"]["client"].id]})
    assert assigned.status_code == 200, assigned.text

    login = client.post("/api/v1/auth/login",
                        json={"username": username, "password": PASSWORD})
    return {"headers": {"Authorization": f"Bearer {login.json()['access_token']}"},
            "id": created.json()["id"], "username": username}


# ─── The rule ─────────────────────────────────────────────────────────────────

def test_an_account_with_no_clients_sees_everything(db_session):
    """
    Opt-in, so introducing scoping changed nothing for any account that existed.
    "Empty means nothing" would have locked everyone out on the first deploy.
    """
    unrestricted = User(id=str(uuid.uuid4()), username=f"u-{uuid.uuid4().hex[:6]}",
                        hashed_password="x")
    assert scoping.scoped_client_ids(unrestricted) is None
    assert not scoping.is_scoped(unrestricted)


def test_a_scoped_account_reports_its_clients(db_session, two_clients):
    user = User(id=str(uuid.uuid4()), username=f"u-{uuid.uuid4().hex[:6]}",
                hashed_password="x", clients=[two_clients["bank"]["client"]])
    db_session.add(user)
    db_session.commit()
    assert scoping.scoped_client_ids(user) == {two_clients["bank"]["client"].id}


# ─── What a scoped account can see ────────────────────────────────────────────

def test_the_case_list_hides_other_clients(client, scoped_session, two_clients):
    listed = client.get("/api/v1/cases/", headers=scoped_session["headers"]).json()
    titles = {c["title"] for c in listed}
    assert two_clients["retail"]["case"].title in titles
    assert two_clients["bank"]["case"].title not in titles


def test_the_client_list_hides_other_clients(client, scoped_session, two_clients):
    listed = client.get("/api/v1/clients/", headers=scoped_session["headers"]).json()
    names = {c["name"] for c in listed}
    assert two_clients["retail"]["client"].name in names
    assert two_clients["bank"]["client"].name not in names


def test_another_clients_case_is_not_found(client, scoped_session, two_clients):
    """
    404 rather than 403. Which client an incident belongs to is itself
    information, and a refusal that differs from "does not exist" tells a
    scoped account that something is there.
    """
    response = client.get(f"/api/v1/cases/{two_clients['bank']['case'].id}",
                          headers=scoped_session["headers"])
    assert response.status_code == 404


def test_its_own_clients_case_opens(client, scoped_session, two_clients):
    response = client.get(f"/api/v1/cases/{two_clients['retail']['case'].id}",
                          headers=scoped_session["headers"])
    assert response.status_code == 200


def test_artifacts_under_another_clients_case_are_refused(client, scoped_session,
                                                          two_clients):
    """
    The structural part: nothing in the artifact routers knows about scoping.
    The case id in the path is what stops this.
    """
    bank_case = two_clients["bank"]["case"].id
    for path in (
        f"/api/v1/cases/{bank_case}/artifacts",
        f"/api/v1/cases/{bank_case}/evidences/",
        f"/api/v1/cases/{bank_case}/timeline",
        f"/api/v1/cases/{bank_case}/ingest",
        f"/api/v1/cases/{bank_case}/custody",
    ):
        assert client.get(path, headers=scoped_session["headers"]).status_code == 404, path


def test_writing_to_another_clients_case_is_refused(client, scoped_session, two_clients):
    response = client.patch(f"/api/v1/cases/{two_clients['bank']['case'].id}",
                            json={"title": "hijacked"},
                            headers=scoped_session["headers"])
    assert response.status_code == 404


def test_a_missing_case_is_still_a_plain_not_found(client, scoped_session):
    """
    Scoping must not turn every typo into a permission problem, or a 404 stops
    meaning anything.
    """
    response = client.get("/api/v1/cases/no-such-case", headers=scoped_session["headers"])
    assert response.status_code == 404


# ─── Assigning scope ──────────────────────────────────────────────────────────

def test_an_empty_list_lifts_the_restriction(client, auth_client, scoped_session,
                                             two_clients):
    auth_client.put(f"/api/v1/users/{scoped_session['id']}/clients",
                    json={"client_ids": []})

    listed = client.get("/api/v1/cases/", headers=scoped_session["headers"]).json()
    titles = {c["title"] for c in listed}
    assert two_clients["bank"]["case"].title in titles


def test_an_unknown_client_is_refused(auth_client, scoped_session):
    response = auth_client.put(f"/api/v1/users/{scoped_session['id']}/clients",
                               json={"client_ids": ["not-a-client"]})
    assert response.status_code == 404


def test_the_account_reports_the_clients_it_is_scoped_to(auth_client, scoped_session,
                                                         two_clients):
    """
    Shown so an administrator is not left guessing why a colleague sees fewer
    cases than they do.
    """
    users = auth_client.get("/api/v1/users/").json()
    scoped = next(u for u in users if u["id"] == scoped_session["id"])
    assert [c["id"] for c in scoped["clients"]] == [two_clients["retail"]["client"].id]


# ─── The structural guarantee ─────────────────────────────────────────────────

def test_every_case_route_goes_through_the_scoping_dependency():
    """
    The one that stops this rotting.

    Nothing in an artifact router knows about clients: scoping works because
    every route carrying a case id runs `enforce_permissions`, which checks it.
    A router mounted without that dependency would be a hole, and the only way
    to notice is to look for it.
    """
    from app.core.deps import enforce_permissions

    unscoped = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if "{case_id}" not in path and "{client_id}" not in path:
            continue
        dependencies = getattr(route, "dependencies", [])
        calls = {getattr(d, "dependency", None) for d in dependencies}
        # A route may also declare it itself rather than inherit it.
        for dependant in getattr(route, "dependant", None).dependencies if getattr(route, "dependant", None) else []:
            calls.add(dependant.call)
        if enforce_permissions not in calls:
            unscoped.append(path)

    assert unscoped == [], (
        "These routes carry a case or client id but do not run the scoping "
        f"dependency, so a scoped account can reach them: {sorted(set(unscoped))}"
    )
