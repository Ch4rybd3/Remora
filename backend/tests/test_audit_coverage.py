"""
Every mutating route is accounted for in the audit trail.

The trail was written one call site at a time, and it showed: 68 of 124
mutating routes recorded an entry and 56 did not - including the entire
ingestion path, so nothing said what had entered a case or who let it in. That
is the first question a dispute about evidence asks.

Nothing here tests a single endpoint. It tests the *table*, because a rule that
depends on somebody remembering is the rule that failed. Three gates:

* a route is declared or exempted - a new one fails until somebody decides;
* a declared route's handler really calls `audit_log`, checked against source,
  so "declared" cannot drift from "implemented";
* `PENDING` only shrinks.
"""
from __future__ import annotations

import inspect

import pytest
from fastapi.routing import APIRoute

from app.core import audit_routes
from app.main import app

#: Methods that change something. HEAD and OPTIONS are protocol, GET is a read.
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _routes() -> list[tuple[str, str, object]]:
    """(method, template, endpoint) for every mutating route the app serves."""
    found = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods & _MUTATING):
            found.append((method, route.path, route.endpoint))
    return sorted(found, key=lambda r: (r[1], r[0]))


_ROUTES = _routes()
_IDS    = [f"{m} {p}" for m, p, _ in _ROUTES]


def _calls_audit_log(endpoint) -> bool:
    """
    Whether the handler's own source records an entry.

    Source inspection rather than a runtime check: exercising 124 endpoints
    would need a fixture per endpoint, and the thing worth catching is a route
    that *never* audits, which the source shows plainly.
    """
    try:
        return "audit_log(" in inspect.getsource(endpoint)
    except OSError:                                        # pragma: no cover
        return False


# ─── Every route is decided about ─────────────────────────────────────────────

@pytest.mark.parametrize("method,template,endpoint", _ROUTES, ids=_IDS)
def test_a_mutating_route_is_declared_or_exempt(method, template, endpoint):
    """
    The gate. A new mutating route fails here until it is either given an
    audit action or exempted with a reason - which is the decision that used
    to be skipped silently.
    """
    declared = audit_routes.action_for(method, template)
    exempt   = audit_routes.exemption_for(method, template)

    assert declared or exempt, (
        f"{method} {template} records nothing and says nothing about why. "
        f"Add it to ACTIONS in core/audit_routes.py, or to EXEMPT with the "
        f"reason it writes nothing.")


def test_no_route_is_both_declared_and_exempt():
    overlap = set(audit_routes.ACTIONS) & set(audit_routes.EXEMPT)

    assert not overlap, f"declared and exempted at once: {sorted(overlap)}"


def test_every_exemption_gives_a_reason():
    for route, reason in audit_routes.EXEMPT.items():
        assert len(reason.strip()) > 40, f"{route} is exempted without a real reason"


def test_the_table_describes_routes_that_exist():
    """A stale entry is a route that was renamed or removed, and the table
    would then be quietly wrong about the one that replaced it."""
    live = {(m, t) for m, t, _ in _ROUTES}
    declared = set(audit_routes.ACTIONS) | set(audit_routes.EXEMPT)

    assert not declared - live, (
        f"declared for routes that no longer exist: {sorted(declared - live)}")


# ─── Declared means implemented ───────────────────────────────────────────────

@pytest.mark.parametrize("method,template,endpoint", _ROUTES, ids=_IDS)
def test_a_declared_route_records_an_entry(method, template, endpoint):
    """
    "Declared" and "implemented" are different claims, and the table is only
    worth having if they cannot drift apart. `PENDING` is what predates the
    table; everything else must actually write.
    """
    if audit_routes.exemption_for(method, template):
        pytest.skip("exempt: writes nothing")
    if audit_routes.is_pending(method, template):
        pytest.skip("on the PENDING ratchet")

    assert _calls_audit_log(endpoint), (
        f"{method} {template} is declared as "
        f"'{audit_routes.action_for(method, template)}' and records nothing. "
        f"Call audit_log in the handler, or add the route to PENDING only if "
        f"it already predates this table - which it does not.")


# ─── The ratchet ──────────────────────────────────────────────────────────────

def test_the_pending_list_only_shrinks():
    """
    Same shape as the mypy ratchet in pyproject.toml: a route may be removed
    once it audits, and nothing may ever be added. Without this the table
    becomes a place to put work off rather than a record of it.
    """
    still_missing = {
        (method, template)
        for method, template, endpoint in _ROUTES
        if not audit_routes.exemption_for(method, template)
        and not _calls_audit_log(endpoint)
    }

    assert still_missing <= audit_routes.PENDING, (
        f"new routes recording nothing: {sorted(still_missing - audit_routes.PENDING)}. "
        f"PENDING is a ratchet - nothing may be added to it.")


def test_the_ratchet_carries_no_route_that_already_audits():
    """
    Housekeeping that keeps the list honest: a route on PENDING whose handler
    now audits should be taken off it, or the list stops describing anything.
    """
    stale = {
        (method, template)
        for method, template, endpoint in _ROUTES
        if audit_routes.is_pending(method, template) and _calls_audit_log(endpoint)
    }

    assert not stale, (
        f"these audit now and can leave PENDING: {sorted(stale)}")


# ─── The vocabulary ───────────────────────────────────────────────────────────

def test_actions_are_dotted_lower_case():
    """
    `binary_delete` and `evidence.delete` in one trail means filtering the
    Audit page for a domain misses half of it.
    """
    for route, action in audit_routes.ACTIONS.items():
        assert action == action.lower(), f"{route}: {action!r} is not lower case"
        assert "." in action, f"{route}: {action!r} has no domain prefix"
        assert " " not in action, f"{route}: {action!r} contains a space"


def test_the_ingestion_path_is_covered():
    """
    The group the user named, asserted by name rather than by counting: what
    entered a case, and who let it in.
    """
    required = {
        "ingest.upload", "ingest.scan", "ingest.force_kind", "ingest.retry",
        "ingest.set_memory_os", "ingest.inbox_assign", "ingest.inbox_delete",
        "collection.import", "collection.delete",
    }

    declared = set(audit_routes.ACTIONS.values())
    assert required <= declared, f"missing: {sorted(required - declared)}"

    for action in required:
        route = next(r for r, a in audit_routes.ACTIONS.items() if a == action)
        assert route not in audit_routes.PENDING, f"{action} is still pending"
