"""
Refusals reach the audit trail.

Sign-ins were audited and refusals were not, which left the trail able to
answer "who came in" and not "who reached for what they could not have". The
second question is the one an investigation into the investigators starts with,
and in a tool whose output is meant to survive scrutiny it is the more
important half.

Two shapes of refusal, and they are recorded for different reasons. A role
denial answers 403 and says so. A scoping denial answers **404** on purpose -
telling a scoped account that a case exists but is forbidden leaks which client
an incident belongs to - so the audit entry is the only place the attempt is
recorded at all.
"""
from __future__ import annotations

import pytest

from app.models.audit import AuditLog
from app.models.user import User, UserRole
from app.services.auth_service import hash_password


def _denials(db_session, username: str | None = None) -> list[AuditLog]:
    query = db_session.query(AuditLog).filter(AuditLog.action == "auth.denied")
    if username:
        query = query.filter(AuditLog.username == username)
    return query.order_by(AuditLog.id.desc()).all()


@pytest.fixture()
def account(client, db_session):
    """A signed-in account of a given role, and a client bound to its token."""
    from fastapi.testclient import TestClient

    from app.main import app

    made: list[str] = []

    def _make(role: UserRole, username: str, clients: list | None = None) -> TestClient:
        user = User(username=username, email=f"{username}@example.test",
                    hashed_password=hash_password("test-pass-12345"), role=role,
                    is_active=True)
        if clients is not None:
            user.clients = clients
        db_session.add(user)
        db_session.commit()
        made.append(username)

        session = TestClient(app)
        token = session.post("/api/v1/auth/login", json={
            "username": username, "password": "test-pass-12345"}).json()["access_token"]
        session.headers["Authorization"] = f"Bearer {token}"
        return session

    yield _make

    for name in made:
        row = db_session.query(User).filter(User.username == name).first()
        if row:
            db_session.delete(row)
    db_session.commit()


# ─── Role refusals ────────────────────────────────────────────────────────────

def test_a_read_only_account_writing_is_recorded(account, db_session):
    session = account(UserRole.read_only, "denied-writer")

    response = session.post("/api/v1/cases/", json={"title": "Nope"})
    assert response.status_code == 403

    entry = _denials(db_session, "denied-writer")[0]
    assert entry.details is not None
    assert "write" in str(entry.details)
    assert "POST /api/v1/cases/" in (entry.resource_name or "")


def test_an_executive_reaching_for_artifacts_is_recorded(account, db_session):
    session = account(UserRole.executive, "denied-exec")

    response = session.get("/api/v1/cases/anything/artifacts")
    assert response.status_code == 403

    entry = _denials(db_session, "denied-exec")[0]
    assert "artifacts" in str(entry.details)


def test_the_entry_says_which_rule_refused_not_only_that_one_did(account, db_session):
    """
    The message an analyst reads is prose, and prose is not something you can
    count. "Somebody is walking the artifact endpoints" has to be a query.
    """
    session = account(UserRole.read_only, "denied-reason")
    session.post("/api/v1/cases/", json={"title": "x"})

    entry = _denials(db_session, "denied-reason")[0]
    assert entry.details["reason"] == "write"
    assert entry.details["status"] == 403
    assert entry.details["role"] == "read_only"


def test_an_allowed_request_records_nothing(account, db_session):
    before = len(_denials(db_session))
    session = account(UserRole.analyst, "allowed-analyst")

    assert session.get("/api/v1/cases/").status_code == 200
    assert len(_denials(db_session)) == before


# ─── Scope refusals ───────────────────────────────────────────────────────────

def test_a_case_outside_an_account_scope_is_recorded_despite_the_404(
    account, db_session, client
):
    """
    The status code is a deliberate lie to the caller and the truth to the
    audit log. Without this entry the attempt leaves no trace anywhere.
    """
    from app.models.case import Case
    from app.models.client import Client

    theirs = Client(name="Their client")
    ours   = Client(name="Our client")
    db_session.add_all([theirs, ours])
    db_session.commit()

    case = Case(title="Bank breach", client_id=theirs.id)
    db_session.add(case)
    db_session.commit()

    session = account(UserRole.analyst, "denied-scoped", clients=[ours])
    response = session.get(f"/api/v1/cases/{case.id}")
    assert response.status_code == 404

    entry = _denials(db_session, "denied-scoped")[0]
    assert entry.details["reason"] == "case_scope"
    assert entry.details["status"] == 404
    assert entry.case_id == case.id


def test_an_unscoped_account_reaches_everything_without_an_entry(
    account, db_session
):
    """
    Scoping is opt-in: an account with no clients attached sees everything, and
    must not fill the audit log with refusals that never happened.
    """
    from app.models.case import Case
    from app.models.client import Client

    someone = Client(name="Someone")
    db_session.add(someone)
    db_session.commit()
    case = Case(title="Open case", client_id=someone.id)
    db_session.add(case)
    db_session.commit()

    session = account(UserRole.analyst, "unscoped-analyst")
    assert session.get(f"/api/v1/cases/{case.id}").status_code == 200
    assert _denials(db_session, "unscoped-analyst") == []


# ─── The refusal must survive its own logging ─────────────────────────────────

def test_a_failing_audit_write_does_not_turn_a_refusal_into_an_error(
    account, db_session, monkeypatch
):
    """
    A denial that answered 500 because its own logging broke would be a refusal
    an attacker could tell apart from a success.
    """
    from app.services import audit_service

    def explode(*args, **kwargs):
        raise RuntimeError("audit table is gone")

    monkeypatch.setattr(audit_service, "audit_log", explode)
    session = account(UserRole.read_only, "denied-brokenaudit")

    assert session.post("/api/v1/cases/", json={"title": "x"}).status_code == 403
