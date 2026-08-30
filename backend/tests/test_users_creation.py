"""
Creating accounts.

Written after a report that creation silently did nothing: the form said
"Creating", went back to "Create", and no account appeared. The cause was an
empty email stored as `""` on a unique column - the first account without an
address worked and every one after it collided, as an unhandled 500 that the
interface had no error handler for.
"""
from __future__ import annotations

import uuid

PASSWORD = "Test-Password-42"


def _name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def test_two_accounts_can_be_created_without_an_email(auth_client):
    """
    The regression itself. A unique constraint treats two empty strings as a
    duplicate and two NULLs as distinct, so the address has to be stored as the
    absence of one.
    """
    for _ in range(2):
        response = auth_client.post("/api/v1/users/", json={
            "username": _name("no-email"), "email": "", "password": PASSWORD,
            "role": "analyst",
        })
        assert response.status_code == 201, response.text
        assert response.json()["email"] is None


def test_whitespace_is_not_an_email_either(auth_client):
    response = auth_client.post("/api/v1/users/", json={
        "username": _name("blank-email"), "email": "   ", "password": PASSWORD,
    })
    assert response.status_code == 201, response.text
    assert response.json()["email"] is None


def test_a_real_duplicate_email_is_refused_with_a_reason(auth_client):
    """
    A 409 saying what is wrong, not a 500 the interface cannot explain.
    """
    shared = f"{uuid.uuid4().hex[:8]}@example.com"
    first = auth_client.post("/api/v1/users/", json={
        "username": _name("first"), "email": shared, "password": PASSWORD})
    assert first.status_code == 201, first.text

    second = auth_client.post("/api/v1/users/", json={
        "username": _name("second"), "email": shared, "password": PASSWORD})
    assert second.status_code == 409
    assert shared in second.json()["detail"]


def test_the_new_roles_can_be_created(auth_client):
    for role in ("read_only", "executive"):
        response = auth_client.post("/api/v1/users/", json={
            "username": _name(role), "password": PASSWORD, "role": role})
        assert response.status_code == 201, response.text
        assert response.json()["role"] == role


def test_clearing_an_email_stores_nothing_not_an_empty_string(auth_client):
    created = auth_client.post("/api/v1/users/", json={
        "username": _name("to-clear"), "email": f"{uuid.uuid4().hex[:8]}@example.com",
        "password": PASSWORD}).json()

    updated = auth_client.patch(f"/api/v1/users/{created['id']}", json={"email": ""})
    assert updated.status_code == 200, updated.text
    assert updated.json()["email"] is None
