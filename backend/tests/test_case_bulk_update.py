"""
One change applied to several cases.

A week of triage ends with thirty cases to close, a handful to reassign and a
campaign to tag, and all of it was one case at a time through the detail page.

These tests pin the batch that replaced that, and three things about it that are
easy to get wrong and expensive to discover later:

* the route is declared before `/{case_id}`, or every call lands in
  `update_case` with a case id of "bulk";
* scoping is explicit, because the case ids arrive in the *body* where the
  dependency that checks them cannot see them;
* tags are added and removed, never replaced - a batch has no way to know what
  each case carried of its own.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.routers.cases import merge_tags, split_tags

BULK = "/api/v1/cases/bulk"


@pytest.fixture()
def three_cases(auth_client: TestClient) -> list[str]:
    return [
        auth_client.post("/api/v1/cases/", json={
            "title": f"Case {i}", "severity": "low", "tags": "triage",
        }).json()["id"]
        for i in range(3)
    ]


def _case(client: TestClient, case_id: str) -> dict:
    return client.get(f"/api/v1/cases/{case_id}").json()


# ─── The route exists where it has to ─────────────────────────────────────────

def test_bulk_is_not_swallowed_by_the_case_id_route(auth_client, three_cases):
    """
    `/cases/bulk` and `/cases/{case_id}` are both PATCH, and FastAPI matches in
    declaration order. With the batch declared second, every call would reach
    `update_case` looking for a case called "bulk" and answer 404.
    """
    response = auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})

    assert response.status_code == 200, response.text
    assert set(response.json()["updated"]) == set(three_cases)


def test_a_batch_with_no_cases_is_refused(auth_client):
    assert auth_client.patch(BULK, json={"case_ids": [], "status": "closed"}).status_code == 400


def test_a_batch_with_no_change_is_refused(auth_client, three_cases):
    """Otherwise it reports success for having done nothing."""
    assert auth_client.patch(BULK, json={"case_ids": three_cases}).status_code == 400


# ─── Each field ───────────────────────────────────────────────────────────────

def test_closing_a_batch_closes_every_case(auth_client, three_cases):
    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})

    for case_id in three_cases:
        case = _case(auth_client, case_id)
        assert case["status"] == "closed"
        assert case["closed_at"] is not None


def test_reopening_clears_the_closure_date(auth_client, three_cases):
    """
    It did not. Closing stamped the date, reopening left it, and a reopened case
    reported a closure date while its status said Open - which `{{case.closed_at}}`
    then printed in a client's report.
    """
    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})
    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "in_progress"})

    for case_id in three_cases:
        case = _case(auth_client, case_id)
        assert case["status"] == "in_progress"
        assert case["closed_at"] is None, "the case still claims a closure date"


def test_reopening_one_case_clears_it_too(auth_client, three_cases):
    """The same bug lived in the single-case route, which is where it started."""
    case_id = three_cases[0]
    auth_client.patch(f"/api/v1/cases/{case_id}", json={"status": "closed"})
    auth_client.patch(f"/api/v1/cases/{case_id}", json={"status": "open"})

    assert _case(auth_client, case_id)["closed_at"] is None


def test_closing_an_already_closed_case_keeps_the_first_date(auth_client, three_cases):
    """A second sweep must not restate when the case was closed."""
    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})
    first = _case(auth_client, three_cases[0])["closed_at"]

    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})

    assert _case(auth_client, three_cases[0])["closed_at"] == first


def test_severity_and_assignee_apply_to_the_batch(auth_client, three_cases):
    auth_client.patch(BULK, json={
        "case_ids": three_cases, "severity": "critical", "assigned_to": "mallory"})

    for case_id in three_cases:
        case = _case(auth_client, case_id)
        assert case["severity"] == "critical"
        assert case["assigned_to"] == "mallory"


def test_the_response_names_the_fields_it_set(auth_client, three_cases):
    """What the interface puts in its confirmation line."""
    result = auth_client.patch(BULK, json={
        "case_ids": three_cases, "status": "closed", "add_tags": ["qakbot"]}).json()

    assert set(result["fields"]) == {"status", "tags"}


# ─── Tags are added, never replaced ───────────────────────────────────────────

def test_a_tag_is_added_beside_what_the_case_already_had(auth_client, three_cases):
    auth_client.patch(BULK, json={"case_ids": three_cases, "add_tags": ["qakbot"]})

    assert split_tags(_case(auth_client, three_cases[0])["tags"]) == ["triage", "qakbot"]


def test_removing_a_tag_leaves_the_others(auth_client, three_cases):
    auth_client.patch(BULK, json={"case_ids": three_cases, "add_tags": ["qakbot", "emotet"]})
    auth_client.patch(BULK, json={"case_ids": three_cases, "remove_tags": ["qakbot"]})

    assert split_tags(_case(auth_client, three_cases[0])["tags"]) == ["triage", "emotet"]


@pytest.mark.parametrize("current,add,remove,expected", [
    ("",               ["a"],  [],    "a"),
    ("a, b",           ["c"],  [],    "a, b, c"),
    ("a, b",           ["b"],  [],    "a, b"),          # already there
    ("a, b",           ["B"],  [],    "a, b"),          # same tag, other case
    ("Phishing, b",    [],     ["phishing"], "b"),      # removing ignores case
    ("  a , , b  ",    [],     [],    "a, b"),          # blanks and padding
    ("a",              ["  "], [],    "a"),             # a blank is not a tag
])
def test_tag_arithmetic(current, add, remove, expected):
    assert merge_tags(current, add, remove) == expected


# ─── Cases the batch cannot touch ─────────────────────────────────────────────
# The scoping half lives in test_client_scoping.py, beside the fixtures that
# build a restricted account.

def test_an_unknown_case_is_reported_as_skipped(auth_client, three_cases):
    """Silently dropping it would read as success for a case that never changed."""
    result = auth_client.patch(BULK, json={
        "case_ids": [*three_cases, "no-such-case"], "status": "closed"}).json()

    assert result["skipped"] == ["no-such-case"]
    assert len(result["updated"]) == 3


# ─── The audit trail ──────────────────────────────────────────────────────────

def test_the_trail_carries_one_entry_per_case(auth_client, three_cases, db_session):
    """
    Not one for the batch. "Who closed this case and when" has to be answerable
    from the case that was closed, and an entry naming thirty others does not
    answer it.
    """
    from app.models.audit import AuditLog

    auth_client.patch(BULK, json={"case_ids": three_cases, "status": "closed"})

    entries = db_session.query(AuditLog).filter(
        AuditLog.action == "case.bulk_update",
        AuditLog.case_id.in_(three_cases)).all()

    assert {str(entry.case_id) for entry in entries} == set(three_cases)
    assert all(entry.details.get("batch_size") == 3 for entry in entries)
