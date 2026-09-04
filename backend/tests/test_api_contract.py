"""
Contract tests over the whole route table.

These are deliberately shallow. Their job is to make a route that was broken by
an unrelated change fail here rather than in front of an analyst, and to make
"I forgot the auth dependency" impossible to merge. Depth belongs in the
service-level tests.
"""
from __future__ import annotations

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app

# Routes that are public by design.
PUBLIC_PATHS = {
    "/api/v1/health",
    "/api/v1/version",
    "/api/v1/auth/login",
}


def _api_routes() -> list[APIRoute]:
    return [
        r for r in app.routes
        if isinstance(r, APIRoute) and r.path.startswith("/api/v1")
    ]


def _parameterless_get_routes() -> list[APIRoute]:
    return [
        r for r in _api_routes()
        if "GET" in r.methods and "{" not in r.path and r.path not in PUBLIC_PATHS
    ]


def test_route_table_is_not_empty() -> None:
    assert len(_api_routes()) > 100, "route table collapsed — check main.py imports"


def test_health_is_public(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_version_is_public_and_well_formed(client: TestClient) -> None:
    response = client.get("/api/v1/version")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"version", "commit", "built_at"}
    major, minor, patch = body["version"].split(".")
    assert all(part.isdigit() for part in (major, minor, patch))


@pytest.mark.parametrize(
    "path",
    sorted({r.path for r in _api_routes() if "GET" in r.methods and r.path not in PUBLIC_PATHS}),
)
def test_protected_get_routes_reject_anonymous(client: TestClient, path: str) -> None:
    """A protected route must not serve data without a token.

    The path may contain placeholders; an unauthenticated request is rejected
    before the path parameter is ever parsed, so sending the literal path is
    enough to prove the dependency is wired.
    """
    response = client.get(path)
    assert response.status_code in (401, 403), (
        f"{path} answered {response.status_code} without a token"
    )


@pytest.mark.parametrize("route", _parameterless_get_routes(), ids=lambda r: r.path)
def test_authenticated_get_routes_do_not_crash(auth_client: TestClient, route: APIRoute) -> None:
    response = auth_client.get(route.path)
    assert response.status_code < 500, (
        f"{route.path} returned {response.status_code}: {response.text[:300]}"
    )


def test_login_rejects_a_wrong_password(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "definitely-not-the-password"},
    )
    assert response.status_code in (401, 403)
    assert "access_token" not in response.text
