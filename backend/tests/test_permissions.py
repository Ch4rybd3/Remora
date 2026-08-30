"""
Role permissions.

The reason this file walks every route in the application rather than testing a
handful: there are 121 write endpoints, and before this change exactly two
routers checked a role at all. A read-only account that can write is worse than
no read-only account, because it is trusted. So the guarantee has to be
structural, and the test has to be able to fail when somebody adds a route.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core import permissions as perms
from app.main import app
from app.models.user import UserRole


class _Request:
    """The two things `is_write` and `enforce` look at."""

    def __init__(self, method: str, path: str):
        self.method = method
        self.url = type("_Url", (), {"path": path})()


def _routes() -> list[tuple[str, str]]:
    """(method, path) for every API route, HEAD and OPTIONS excluded."""
    out = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/v1/"):
            continue
        for method in getattr(route, "methods", set()):
            if method not in ("HEAD", "OPTIONS"):
                out.append((method, path))
    return sorted(out)


def _allowed(role: UserRole, method: str, path: str) -> bool:
    try:
        perms.enforce(_Request(method, path), role)
        return True
    except HTTPException:
        return False


# ─── The model itself ─────────────────────────────────────────────────────────

def test_every_role_has_a_permission_set():
    """A role missing from the table would silently get nothing, or everything."""
    for role in UserRole:
        assert role in perms.ROLE_PERMISSIONS, role
        assert role in perms.ROLE_LABELS, role


def test_an_unknown_role_gets_nothing():
    """A permission model has to fail closed."""
    assert perms.permissions_for("not-a-role") == frozenset()   # type: ignore[arg-type]


def test_owner_and_admin_hold_the_same_permissions():
    """
    What separates them is who they may act on, not what they may do. That
    distinction lives in `assert_can_manage`.
    """
    assert perms.ROLE_PERMISSIONS[UserRole.owner] == perms.ROLE_PERMISSIONS[UserRole.admin]


def test_the_three_original_roles_keep_their_reach():
    """
    The change must be invisible to every account that already exists. An
    analyst could write and see artifacts before; that is exactly the set they
    have now.
    """
    assert perms.has(UserRole.analyst, perms.PERM_WRITE)
    assert perms.has(UserRole.analyst, perms.PERM_ARTIFACTS)
    assert not perms.has(UserRole.analyst, perms.PERM_USERS)
    assert perms.has(UserRole.admin, perms.PERM_USERS)


# ─── Read-only ────────────────────────────────────────────────────────────────

def test_read_only_can_reach_every_get_an_analyst_can():
    """
    The role is "sees everything, writes nothing". A read-only account that
    cannot see a page is not read-only, it is broken.
    """
    blocked = [
        (m, p) for m, p in _routes()
        if m == "GET" and _allowed(UserRole.analyst, m, p) and not _allowed(UserRole.read_only, m, p)
    ]
    assert blocked == []


def test_read_only_cannot_reach_any_write_endpoint():
    """
    The guarantee, asserted over the whole application rather than a sample.
    Adding an unguarded write endpoint fails here.
    """
    def is_reading_post(path: str) -> bool:
        return path in perms.READING_POST_PATHS or any(
            pattern.match(path) for pattern in perms.READING_POST_PATTERNS)

    writable = [
        (m, p) for m, p in _routes()
        if m != "GET" and not is_reading_post(p) and _allowed(UserRole.read_only, m, p)
    ]
    assert writable == [], f"read_only can write to: {writable}"


def test_the_two_reading_posts_are_the_only_exception():
    """
    Threat-intelligence lookups take a body because a list of indicators does
    not fit in a query string. Kept short enough to check by eye.
    """
    assert perms.READING_POST_PATHS == {
        "/api/v1/cti/lookup", "/api/v1/cti/batch",
    }
    # Plus report rendering, where the path carries an id. A read-only auditor
    # who cannot export the report they are auditing is not much of an auditor.
    assert _allowed(
        UserRole.read_only, "POST",
        "/api/v1/report-doc-templates/some-template/generate/some-case")
    # They are still refused for an executive, who has no artifact access.
    assert not _allowed(UserRole.executive, "POST", "/api/v1/cti/lookup")


def test_a_new_method_is_covered_without_being_listed():
    """Method-based, so an endpoint is guarded the moment it exists."""
    assert not _allowed(UserRole.read_only, "PATCH", "/api/v1/cases/anything/invented")


# ─── Executive ────────────────────────────────────────────────────────────────

#: Everything an executive account may reach, checked in deliberately.
#:
#: This is a golden list, not a description. It fails when routes change, which
#: forces somebody to decide whether the new one belongs here - the safe
#: direction to be wrong in, because the default is refusal.
EXECUTIVE_REACHABLE = {
    ("GET", "/api/v1/cases/"),
    ("GET", "/api/v1/cases/{case_id}"),
    # `generate` renders the report sections and writes nothing, despite the
    # verb in its name.
    ("GET", "/api/v1/cases/{case_id}/report/generate"),
    ("GET", "/api/v1/cases/{case_id}/report/versions"),
    ("GET", "/api/v1/cases/{case_id}/report/versions/{version_id}"),
    ("GET", "/api/v1/clients/"),
    ("GET", "/api/v1/clients/{client_id}"),
    ("GET", "/api/v1/dashboard/stats"),
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/mitre/status"),
    ("GET", "/api/v1/mitre/techniques"),
    ("GET", "/api/v1/version"),
}


def test_executive_reaches_exactly_the_checked_in_list():
    reachable = {(m, p) for m, p in _routes() if _allowed(UserRole.executive, m, p)}

    added = reachable - EXECUTIVE_REACHABLE
    removed = EXECUTIVE_REACHABLE - reachable
    assert not added, (
        "New routes an executive account can now reach. Decide whether they "
        f"belong, then update EXECUTIVE_REACHABLE: {sorted(added)}"
    )
    assert not removed, (
        "Routes an executive account could reach and no longer can. If that is "
        f"deliberate, remove them from EXECUTIVE_REACHABLE: {sorted(removed)}"
    )


def test_executive_cannot_reach_client_document_management():
    """
    Under `/clients`, which is otherwise allowed. Contract and template work is
    not what an executive dashboard reports on.
    """
    for path in (
        "/api/v1/clients/doc-templates",
        "/api/v1/clients/x/documents",
        "/api/v1/clients/x/documents/y/content",
    ):
        assert not _allowed(UserRole.executive, "GET", path), path


def test_executive_cannot_reach_artifacts_under_a_case():
    """
    The failure a prefix allowlist would have: `/api/v1/cases` is allowed, and
    artifacts hang off it.
    """
    for path in (
        "/api/v1/cases/x/artifacts",
        "/api/v1/cases/x/evidences",
        "/api/v1/cases/x/timeline",
        "/api/v1/cases/x/iocs",
        "/api/v1/cases/x/ingest",
    ):
        assert not _allowed(UserRole.executive, "GET", path), path


def test_executive_cannot_reach_an_unclassified_route():
    """
    An allowlist, so a route nobody has thought about is refused rather than
    permitted. A new page is invisible to an executive until somebody decides.
    """
    assert not _allowed(UserRole.executive, "GET", "/api/v1/something-new")


def test_executive_cannot_write_to_what_it_can_read():
    assert _allowed(UserRole.executive, "GET", "/api/v1/cases")
    assert not _allowed(UserRole.executive, "POST", "/api/v1/cases")


# ─── User administration ──────────────────────────────────────────────────────

def test_only_admin_roles_reach_user_administration():
    for role in (UserRole.analyst, UserRole.read_only, UserRole.executive):
        assert not _allowed(role, "GET", "/api/v1/users"), role
    for role in (UserRole.admin, UserRole.owner):
        assert _allowed(role, "GET", "/api/v1/users"), role


def test_an_admin_cannot_manage_another_admin_or_an_owner():
    """
    What the rank comparison used to say, now stated rather than computed.
    """
    from app.core.deps import assert_can_manage

    class _U:
        def __init__(self, role, uid="a"):
            self.role, self.id = role, uid

    admin = _U(UserRole.admin, "admin-1")

    assert_can_manage(admin, _U(UserRole.analyst, "x"))
    assert_can_manage(admin, _U(UserRole.read_only, "y"))
    assert_can_manage(admin, _U(UserRole.executive, "z"))

    for protected in (UserRole.admin, UserRole.owner):
        with pytest.raises(HTTPException):
            assert_can_manage(admin, _U(protected, "other"))


def test_an_owner_can_manage_anyone():
    from app.core.deps import assert_can_manage

    class _U:
        def __init__(self, role, uid="a"):
            self.role, self.id = role, uid

    owner = _U(UserRole.owner, "owner-1")
    for role in UserRole:
        assert_can_manage(owner, _U(role, "other"))


def test_a_non_admin_cannot_manage_anyone_but_themselves():
    from app.core.deps import assert_can_manage

    class _U:
        def __init__(self, role, uid="a"):
            self.role, self.id = role, uid

    analyst = _U(UserRole.analyst, "me")
    assert_can_manage(analyst, _U(UserRole.analyst, "me"))    # own account
    with pytest.raises(HTTPException):
        assert_can_manage(analyst, _U(UserRole.analyst, "someone-else"))
