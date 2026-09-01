"""
What a role may do.

The model this replaces was a linear rank - analyst < admin < owner - and a
rank cannot express the two roles that were asked for. "Sees everything, writes
nothing" is not below or above an analyst; it is sideways. "Sees KPIs only" is
narrower than every existing role while still being a legitimate account.

So a role is a set of permissions, and enforcement is **default-deny by HTTP
method and path**, applied once to every authenticated router - not opt-in per
endpoint. That polarity is the whole point: there are 121 write endpoints and,
before this, exactly two routers checked a role at all. Guarding them one by one
would work until the first one anybody forgot, and a read-only account that can
write is worse than no read-only account, because it is trusted.
"""
from __future__ import annotations

import re

from fastapi import HTTPException, Request, status

from ..models.user import UserRole

# ─── Permissions ──────────────────────────────────────────────────────────────

#: Create, change or delete anything in a case.
PERM_WRITE = "write"
#: See artifact-level data: the Explorer, logs, memory, captures, evidence.
#: An executive account has the case list and the dashboard, and not this.
PERM_ARTIFACTS = "artifacts"
#: User administration.
PERM_USERS = "users"
#: Global configuration: connectors, rule packs, templates, vaults, backups.
PERM_CONFIG = "config"


ROLE_PERMISSIONS: dict[UserRole, frozenset[str]] = {
    # owner and admin hold the same permissions. What separates them is who
    # they may act on, which `assert_can_manage` answers - an admin cannot
    # touch an owner.
    UserRole.owner:     frozenset({PERM_WRITE, PERM_ARTIFACTS, PERM_USERS, PERM_CONFIG}),
    UserRole.admin:     frozenset({PERM_WRITE, PERM_ARTIFACTS, PERM_USERS, PERM_CONFIG}),
    UserRole.analyst:   frozenset({PERM_WRITE, PERM_ARTIFACTS}),
    # Everything an analyst can see, and nothing they can change.
    UserRole.read_only: frozenset({PERM_ARTIFACTS}),
    # No artifact access at all. Reads the case list, the dashboard and reports.
    UserRole.executive: frozenset(),
}

#: Human labels, shown wherever a role is displayed.
ROLE_LABELS: dict[UserRole, str] = {
    UserRole.owner:     "Owner",
    UserRole.admin:     "Administrator",
    UserRole.analyst:   "Analyst",
    UserRole.read_only: "Read-only",
    UserRole.executive: "Executive",
}

#: Roles that may administer users. Not a rank - a set.
MANAGING_ROLES = frozenset({UserRole.owner, UserRole.admin})


def permissions_for(role: UserRole) -> frozenset[str]:
    """Unknown roles get nothing. A permission model must fail closed."""
    return ROLE_PERMISSIONS.get(role, frozenset())


def has(role: UserRole, permission: str) -> bool:
    return permission in permissions_for(role)


# ─── Request classification ───────────────────────────────────────────────────

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: POST endpoints that only read. Both are threat-intelligence lookups, which
#: take a body because a list of indicators does not fit in a query string.
#: Listed explicitly rather than pattern-matched: this is the one place a
#: read-only account is allowed to send a POST, and it should be short enough
#: to check by eye.
READING_POST_PATHS = frozenset({
    "/api/v1/cti/lookup",
    "/api/v1/cti/batch",
})

#: The same idea where the path carries an id. Rendering a report to DOCX is a
#: POST because it takes a template and a case, and it streams the document
#: without writing anything - a read-only auditor who cannot export the report
#: they are auditing is not much of an auditor.
READING_POST_PATTERNS = (
    re.compile(r"^/api/v1/report-doc-templates/[^/]+/generate/[^/]+$"),
)

#: Any path segment here means artifact-level data, wherever it appears -
#: `/api/v1/cases/{id}/artifacts` and `/api/v1/artifacts/...` both match.
#: Segment matching rather than prefix matching because these hang off cases as
#: often as off the root.
ARTIFACT_SEGMENTS = frozenset({
    "artifacts", "evtx", "memory", "binary", "pcap", "disk-images", "emails",
    "chainsaw", "ingest", "collection-imports", "dropzone", "evidences",
    "custody", "vaults", "cti", "knowledge", "backup", "connectors", "audit",
    "iocs", "assets", "timeline", "incident-log", "attack-graph", "playbooks",
    "ttp", "notes", "templates", "report-doc-templates", "registry",
})

#: The only roots an account with no permissions at all may reach. An allowlist
#: rather than a denylist: for the narrowest role, anything unclassified must be
#: refused, not permitted. A new route is invisible to an executive until
#: somebody decides otherwise, which is the safe direction to be wrong in.
EXECUTIVE_ROOTS = frozenset({
    "dashboard", "cases", "clients", "mitre", "version", "health",
})

#: Sub-resources of a case an executive may still read. `report` is the whole
#: point of the role, and `generate` renders its sections without writing
#: anything - a GET that only reads, despite the verb in its name.
EXECUTIVE_CASE_SEGMENTS = frozenset({"report", "generate"})

#: Detail an executive has no business in, beyond artifact data. Client
#: document management sits under `/clients`, which is otherwise allowed, and
#: is contract and template work rather than anything an executive dashboard
#: reports on.
EXECUTIVE_DENIED_SEGMENTS = ARTIFACT_SEGMENTS | frozenset({"documents", "doc-templates"})


def _segments(path: str) -> list[str]:
    return [segment for segment in path.split("/") if segment]


def is_write(request: Request) -> bool:
    """
    Whether this request changes anything.

    Method-based, so a new endpoint is covered the moment it exists. The two
    read-only POSTs are named above.
    """
    if request.method.upper() in SAFE_METHODS:
        return False
    path = request.url.path
    if path in READING_POST_PATHS:
        return False
    return not any(pattern.match(path) for pattern in READING_POST_PATTERNS)


def touches_artifacts(path: str) -> bool:
    return any(segment in ARTIFACT_SEGMENTS for segment in _segments(path))


def executive_may_read(path: str) -> bool:
    """
    Whether the narrowest role may see this path at all.

    Two conditions, both required: the root has to be one of the handful an
    executive account exists to read, and no segment anywhere may be artifact
    data. The second is what stops `/cases/{id}/artifacts` slipping through on
    the strength of its first segment.
    """
    segments = _segments(path)
    # /api/v1/<root>/...
    if len(segments) < 3 or segments[0] != "api" or segments[1] != "v1":
        return False
    root = segments[2]
    if root not in EXECUTIVE_ROOTS:
        return False
    rest = segments[3:]
    return not any(
        segment in EXECUTIVE_DENIED_SEGMENTS and segment not in EXECUTIVE_CASE_SEGMENTS
        for segment in rest
    )


# ─── Enforcement ──────────────────────────────────────────────────────────────

def enforce(request: Request, role: UserRole) -> None:
    """
    Refuse the request if the role does not allow it. Raises 403, or returns.

    Applied to every authenticated router at once. `/auth` is deliberately
    outside it: a read-only account still has to sign in and manage its own
    second factor, and both are POSTs.
    """
    granted = permissions_for(role)
    path = request.url.path

    if PERM_ARTIFACTS not in granted and not executive_may_read(path):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"The {ROLE_LABELS.get(role, role.value)} role does not have access to this data",
        )

    if is_write(request) and PERM_WRITE not in granted:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"The {ROLE_LABELS.get(role, role.value)} role is read-only",
        )

    if touches_users(path) and PERM_USERS not in granted:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "User administration requires an admin account")


def may_assign_role(actor_role: UserRole, target_role: UserRole) -> bool:
    """
    Whether an actor may create an account with, or move an account to, a role.

    Only an owner may hand out `owner`. Everything else an administrator can
    grant - which is what the rank comparison allowed, restated so it does not
    depend on where a new role happens to sit in an integer map. Adding
    `read_only` to a ranked model would have silently made it assignable or not
    depending on the number it was given.
    """
    if target_role == UserRole.owner:
        return actor_role == UserRole.owner
    return actor_role in MANAGING_ROLES


def touches_users(path: str) -> bool:
    return _segments(path)[2:3] == ["users"]
