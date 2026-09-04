"""
Second factor.

Authentication code, so these tests are written around the ways it can be
wrong rather than the way it is meant to work: a half-authenticated token used
as a session, a code replayed inside its own validity window, a brute-force
budget that resets, a recovery code burned by a typo.
"""
from __future__ import annotations

import json
import time
import uuid

import pyotp
import pytest

from app.services import mfa

PASSWORD = "Test-Password-42"


def _unique(prefix: str) -> str:
    """Usernames are unique in the schema and the test database is shared."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.fixture()
def enrolled(auth_client, client, db_session):
    """
    A fresh account with MFA switched on, and its TOTP generator.

    Created through the API so the enrolment handshake itself is exercised.
    """
    username = _unique("mfa-user")
    created = auth_client.post("/api/v1/users", json={
        "username": username, "password": PASSWORD, "role": "analyst",
    })
    assert created.status_code in (200, 201), created.text

    login = client.post("/api/v1/auth/login",
                        json={"username": username, "password": PASSWORD})
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    setup = client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200, setup.text
    body = setup.json()

    secret = pyotp.parse_uri(body["provisioning_uri"]).secret
    totp = pyotp.TOTP(secret, interval=mfa.STEP_SECONDS)

    confirm = client.post("/api/v1/auth/mfa/confirm",
                          json={"code": totp.now()}, headers=headers)
    assert confirm.status_code == 200, confirm.text

    # Confirming consumed the current step, and a step is never accepted twice.
    # In practice a user's first login is a few seconds later and lands in the
    # next one; here the clock does not move, so the record is cleared to stand
    # in for that. The replay rule itself is covered by its own unit test.
    from app.models.user import User

    account = db_session.query(User).filter(User.username == username).one()
    account.mfa_last_step = None
    db_session.commit()

    return {"totp": totp, "headers": headers, "username": username,
            "recovery_codes": body["recovery_codes"], "secret": secret}


# ─── The unit that does the work ──────────────────────────────────────────────

def test_a_secret_survives_a_round_trip():
    ciphertext, salt = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert ciphertext != "JBSWY3DPEHPK3PXP"
    assert mfa.decrypt_secret(ciphertext, salt) == "JBSWY3DPEHPK3PXP"


def test_the_same_secret_encrypts_differently_for_two_users():
    """A per-user salt, so a shared secret is not visible as a shared ciphertext."""
    first, _ = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    second, _ = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert first != second


def test_an_undecryptable_secret_says_why():
    """
    The alternative is an operator watching every login fail with "invalid
    code" and concluding the authenticator is broken.
    """
    _, salt = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    with pytest.raises(mfa.MfaError, match="SECRET_KEY"):
        mfa.decrypt_secret("gAAAAABmnot-a-real-token", salt)


def test_a_code_cannot_be_used_twice():
    """
    A TOTP is valid for a whole 30-second step - long enough for one read over
    a shoulder to be typed in twice.
    """
    secret = pyotp.random_base32()
    code = pyotp.TOTP(secret, interval=mfa.STEP_SECONDS).now()

    step = mfa.verify_code(secret, code, last_step=None)
    with pytest.raises(mfa.MfaError, match="already been used"):
        mfa.verify_code(secret, code, last_step=step)


def test_a_code_from_the_previous_step_is_still_accepted():
    """One step of tolerance, for a phone whose clock has drifted."""
    secret = pyotp.random_base32()
    now = time.time()
    previous = pyotp.TOTP(secret, interval=mfa.STEP_SECONDS).at(int(now) - mfa.STEP_SECONDS)
    assert mfa.verify_code(secret, previous, last_step=None, at=now)


def test_a_wrong_code_is_refused():
    secret = pyotp.random_base32()
    with pytest.raises(mfa.MfaError, match="Incorrect"):
        mfa.verify_code(secret, "000000", last_step=None)


def test_recovery_codes_avoid_ambiguous_characters():
    """
    These are read off a screen and typed back, often from a printout. A code
    that cannot be transcribed is not a recovery path.
    """
    codes, _ = mfa.generate_recovery_codes()
    assert len(codes) == mfa.RECOVERY_CODE_COUNT
    for character in "".join(codes).replace("-", ""):
        assert character not in "O0I1L"


def test_a_recovery_code_is_removed_when_used():
    codes, stored = mfa.generate_recovery_codes()
    remaining = mfa.consume_recovery_code(codes[0], stored)
    assert remaining is not None
    assert len(json.loads(remaining)) == mfa.RECOVERY_CODE_COUNT - 1
    assert mfa.consume_recovery_code(codes[0], remaining) is None


def test_recovery_codes_are_not_stored_readable():
    codes, stored = mfa.generate_recovery_codes()
    assert codes[0] not in stored


# ─── The login handshake ──────────────────────────────────────────────────────

def test_login_without_mfa_still_returns_a_session(client):
    body = client.post("/api/v1/auth/login",
                       json={"username": "admin", "password": "test-admin-password"}).json()
    assert body["access_token"]
    assert body["mfa_required"] is False


def test_login_with_mfa_returns_no_session(client, enrolled):
    body = client.post("/api/v1/auth/login",
                       json={"username": enrolled["username"], "password": PASSWORD}).json()
    assert body["mfa_required"] is True
    assert body["access_token"] is None
    assert body["mfa_token"]


def test_the_intermediate_token_is_not_a_session(client, enrolled):
    """
    The failure this prevents: a client that ignores `mfa_required` and uses
    whatever token it was handed. That would make MFA optional for anyone who
    stopped reading the response.
    """
    mfa_token = client.post("/api/v1/auth/login",
                            json={"username": enrolled["username"], "password": PASSWORD}
                            ).json()["mfa_token"]

    response = client.get("/api/v1/auth/me",
                          headers={"Authorization": f"Bearer {mfa_token}"})
    assert response.status_code == 401
    assert "does not authorise a session" in response.json()["detail"]


def test_a_code_completes_the_login(client, enrolled):
    mfa_token = client.post("/api/v1/auth/login",
                            json={"username": enrolled["username"], "password": PASSWORD}
                            ).json()["mfa_token"]

    body = client.post("/api/v1/auth/mfa/verify", json={
        "mfa_token": mfa_token, "code": enrolled["totp"].now(),
    }).json()

    assert body["access_token"]
    assert body["user"]["username"] == enrolled["username"]
    # And the resulting token really is a session.
    assert client.get("/api/v1/auth/me", headers={
        "Authorization": f"Bearer {body['access_token']}"}).status_code == 200


def test_a_recovery_code_completes_the_login(client, enrolled):
    mfa_token = client.post("/api/v1/auth/login",
                            json={"username": enrolled["username"], "password": PASSWORD}
                            ).json()["mfa_token"]

    body = client.post("/api/v1/auth/mfa/verify", json={
        "mfa_token": mfa_token, "code": enrolled["recovery_codes"][0],
    })
    assert body.status_code == 200, body.text
    assert body.json()["access_token"]


def test_a_recovery_code_works_only_once(client, enrolled):
    code = enrolled["recovery_codes"][1]
    for expected in (200, 401):
        mfa_token = client.post("/api/v1/auth/login",
                                json={"username": enrolled["username"], "password": PASSWORD}
                                ).json()["mfa_token"]
        response = client.post("/api/v1/auth/mfa/verify",
                               json={"mfa_token": mfa_token, "code": code})
        assert response.status_code == expected


def test_a_session_token_cannot_stand_in_for_the_login_token(client, enrolled):
    """The reverse of the earlier check: scopes are not interchangeable."""
    response = client.post("/api/v1/auth/mfa/verify", json={
        "mfa_token": enrolled["headers"]["Authorization"].split()[1],
        "code": enrolled["totp"].now(),
    })
    assert response.status_code == 401


def test_an_expired_login_says_to_start_again(client, enrolled, monkeypatch):
    from app.services import auth_service

    monkeypatch.setattr(auth_service, "MFA_TOKEN_EXPIRE_MINUTES", -1)
    mfa_token = auth_service.create_mfa_token("whoever")

    response = client.post("/api/v1/auth/mfa/verify",
                           json={"mfa_token": mfa_token, "code": "123456"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"]


# ─── Enrolment ────────────────────────────────────────────────────────────────

def _fresh_session(client, auth_client, prefix: str) -> dict:
    """A brand new account with no second factor, and its auth header."""
    username = _unique(prefix)
    created = auth_client.post("/api/v1/users", json={
        "username": username, "password": PASSWORD, "role": "analyst"})
    assert created.status_code in (200, 201), created.text

    login = client.post("/api/v1/auth/login",
                        json={"username": username, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_enrolment_is_two_steps(client, auth_client):
    """
    Enabling in one step would lock out anyone whose phone clock is wrong or
    who mistyped the secret. Setup stores it; confirm proves it works.
    """
    headers = _fresh_session(client, auth_client, "two-step")

    assert client.post("/api/v1/auth/mfa/setup", headers=headers).status_code == 200
    # Still off until a code is proved.
    assert client.get("/api/v1/auth/mfa/status", headers=headers).json()["enabled"] is False


def test_a_wrong_code_does_not_enable_it(client, auth_client):
    headers = _fresh_session(client, auth_client, "bad-confirm")

    client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert client.post("/api/v1/auth/mfa/confirm",
                       json={"code": "000000"}, headers=headers).status_code == 401
    assert client.get("/api/v1/auth/mfa/status", headers=headers).json()["enabled"] is False


def test_confirming_without_starting_is_refused(client, auth_client):
    headers = _fresh_session(client, auth_client, "no-setup")
    assert client.post("/api/v1/auth/mfa/confirm",
                       json={"code": "000000"}, headers=headers).status_code == 409


def test_enrolling_twice_is_refused(client, enrolled):
    assert client.post("/api/v1/auth/mfa/setup",
                       headers=enrolled["headers"]).status_code == 409


def test_the_status_reports_how_many_recovery_codes_remain(client, enrolled):
    body = client.get("/api/v1/auth/mfa/status", headers=enrolled["headers"]).json()
    assert body["enabled"] is True
    assert body["recovery_codes_left"] == mfa.RECOVERY_CODE_COUNT


# ─── Turning it off ───────────────────────────────────────────────────────────

def test_disabling_needs_the_password_as_well_as_a_code(client, enrolled):
    """
    A session alone is not enough. An unattended browser is exactly the
    situation MFA exists to survive, so removing it must be harder than using it.
    """
    response = client.post("/api/v1/auth/mfa/disable", headers=enrolled["headers"],
                           json={"password": "wrong", "code": enrolled["totp"].now()})
    assert response.status_code == 401
    assert client.get("/api/v1/auth/mfa/status",
                      headers=enrolled["headers"]).json()["enabled"] is True


def test_disabling_needs_a_code_as_well_as_the_password(client, enrolled):
    response = client.post("/api/v1/auth/mfa/disable", headers=enrolled["headers"],
                           json={"password": PASSWORD, "code": "000000"})
    assert response.status_code == 401


def test_disabling_clears_the_secret(client, enrolled, db_session):
    from app.models.user import User

    response = client.post("/api/v1/auth/mfa/disable", headers=enrolled["headers"],
                           json={"password": PASSWORD, "code": enrolled["totp"].now()})
    assert response.status_code == 200, response.text

    db_session.expire_all()
    user = db_session.query(User).filter(User.username == enrolled["username"]).one()
    assert user.mfa_enabled is False
    assert user.mfa_secret is None
    assert user.mfa_recovery_codes is None


# ─── Brute force ──────────────────────────────────────────────────────────────

def test_repeated_wrong_codes_lock_the_account(client, enrolled):
    """
    Six digits is a million possibilities and a script does that in minutes.
    The counter lives on the user row, not in memory, so a restart does not
    hand an attacker a fresh budget.
    """
    for _ in range(mfa.MAX_ATTEMPTS):
        mfa_token = client.post("/api/v1/auth/login",
                                json={"username": enrolled["username"], "password": PASSWORD}
                                ).json()["mfa_token"]
        client.post("/api/v1/auth/mfa/verify",
                    json={"mfa_token": mfa_token, "code": "000000"})

    mfa_token = client.post("/api/v1/auth/login",
                            json={"username": enrolled["username"], "password": PASSWORD}
                            ).json()["mfa_token"]
    response = client.post("/api/v1/auth/mfa/verify",
                           json={"mfa_token": mfa_token, "code": enrolled["totp"].now()})
    assert response.status_code == 429
    assert "Try again in" in response.json()["detail"]
