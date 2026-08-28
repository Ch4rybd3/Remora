"""
Test configuration.

Environment is set before `app` is imported anywhere, because the settings
object binds the database engine and every storage path at import time. A test
run must never touch a real database, a real evidence store, or the network.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="remora-tests-"))

os.environ.update(
    SECRET_KEY="test-secret-key-not-used-outside-tests",
    DATABASE_URL=f"sqlite:///{_TMP / 'test.db'}",
    EVIDENCE_STORE_PATH=str(_TMP / "evidences"),
    DROPZONE_PATH=str(_TMP / "dropzone"),
    CASE_DATA_PATH=str(_TMP / "case-data"),
    DROPZONE_AUTO_INGEST="false",
    SKIP_TOOL_SETUP="true",
    DEFAULT_ADMIN_PASSWORD="test-admin-password",
    CORS_ORIGINS="http://testserver",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Anonymous client. Entering the context manager fires startup, which
    runs the migrations and seeds the default admin."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def token(client: TestClient) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "test-admin-password"},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


@pytest.fixture(scope="session")
def auth_client(client: TestClient, token: str) -> TestClient:
    """A separate instance, so the anonymous `client` is never given a token.

    Startup has already run via the `client` fixture, so this one does not need
    the context manager.
    """
    authenticated = TestClient(app)
    authenticated.headers.update({"Authorization": f"Bearer {token}"})
    return authenticated


@pytest.fixture()
def db_session(client: TestClient):
    """
    A session on the migrated test database.

    Depends on `client` so startup - and therefore the migration runner - has
    already brought the schema to head. Testing against the migrated schema
    rather than `create_all` means a missing migration fails here too, instead
    of these tests quietly passing against a schema that exists nowhere else.
    """
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture()
def case_id(db_session) -> str:
    """A throwaway case for ingested files to hang off."""
    import uuid as _uuid

    from app.models.case import Case

    new_id = str(_uuid.uuid4())
    db_session.add(Case(id=new_id, title=f"Ingest test {new_id[:8]}"))
    db_session.commit()
    return new_id
