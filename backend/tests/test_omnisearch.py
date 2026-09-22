"""
Cross-artifact search.

One claim, and it is the one that was broken: the omnisearch is a fan-out over
every artifact in a case, so a single unreadable artifact must cost the analyst
that file's hits and nothing more.

It used to cost them the whole query. A collection deleted from disk leaves its
rows behind - the file list already badges them - and the first such row raised
`SourceMissing` out of the loop, returning a 500 for the entire search. The
Explorer rendered that as "No results", so the failure looked like an answer.
That is the specific confusion these tests exist to keep out.
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

CSV_HIT = (
    "Timestamp,Process Name,PID,CommandLine\n"
    "2026-01-01T10:00:00,powershell.exe,1042,powershell -enc SQBFAFgA\n"
    "2026-01-01T10:00:05,cmd.exe,2001,cmd /c whoami\n"
)
CSV_MISS = (
    "Timestamp,Process Name,PID,CommandLine\n"
    "2026-01-01T11:00:00,explorer.exe,900,explorer.exe\n"
)


def _upload(auth_client: TestClient, case_id: str, name: str, body: str) -> dict:
    response = auth_client.post(
        f"/api/v1/cases/{case_id}/artifacts/upload",
        files={"file": (name, body.encode(), "text/csv")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _search(auth_client: TestClient, case_id: str, q: str, **params) -> dict:
    response = auth_client.get(
        f"/api/v1/cases/{case_id}/artifacts/search", params={"q": q, **params})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture()
def live(auth_client: TestClient, case_id: str) -> dict:
    return _upload(auth_client, case_id, "live.csv", CSV_HIT)


@pytest.fixture()
def dead(auth_client: TestClient, case_id: str, db_session) -> dict:
    """An artifact whose file is gone - the state a deleted collection leaves."""
    from app.models.csv_artifact import CsvArtifactFile

    meta = _upload(auth_client, case_id, "dead.csv", CSV_HIT)
    row  = db_session.get(CsvArtifactFile, meta["id"])
    os.unlink(row.file_path)
    return meta


# ─── The regression ───────────────────────────────────────────────────────────

def test_a_deleted_file_does_not_kill_the_search(auth_client, case_id, live, dead):
    """The whole point. One dead artifact, and the live one still answers."""
    result = _search(auth_client, case_id, "powershell")

    assert result["total_hits"] > 0
    assert [f["id"] for f in result["files"]] == [live["id"]]
    assert [s["id"] for s in result["skipped"]] == [dead["id"]]
    assert result["searched"] == 1


def test_a_skipped_artifact_says_which_file_and_why(auth_client, case_id, dead):
    """
    An analyst concluding "this indicator is not in the case" has to be able to
    see that the search did not cover every file, and which one it missed.
    """
    skipped = _search(auth_client, case_id, "powershell")["skipped"]

    assert len(skipped) == 1
    assert skipped[0]["original_name"] == "dead.csv"
    assert "no longer on disk" in skipped[0]["reason"]


def test_nothing_skipped_when_every_file_reads(auth_client, case_id, live):
    result = _search(auth_client, case_id, "powershell")

    assert result["skipped"] == []
    assert result["searched"] == 1


# ─── Empty is still empty ─────────────────────────────────────────────────────

def test_no_match_is_reported_as_no_match_not_as_a_failure(auth_client, case_id, live):
    """
    The fix must not make a genuinely empty result look like a problem - that
    would be the same conflation in the other direction.
    """
    result = _search(auth_client, case_id, "mimikatz")

    assert result["total_hits"] == 0
    assert result["files"] == []
    assert result["skipped"] == []
    assert result["searched"] == 1


def test_hits_are_counted_across_files(auth_client, case_id):
    _upload(auth_client, case_id, "one.csv", CSV_HIT)
    _upload(auth_client, case_id, "two.csv", CSV_MISS)

    result = _search(auth_client, case_id, "exe")

    assert result["searched"] == 2
    assert len(result["files"]) == 2
    assert result["total_hits"] == sum(f["hit_count"] for f in result["files"])


# ─── A bad pattern is a per-artifact failure, not a 500 ───────────────────────

def test_an_invalid_regex_is_reported_rather_than_raised(auth_client, case_id, live):
    """
    Regex is a toggle in the Explorer's search bar, so a malformed pattern is
    analyst input arriving on a normal path. It must come back as a skipped
    artifact carrying a reason, not as a server error.
    """
    result = _search(auth_client, case_id, "powershell(", regex=True)

    assert result["total_hits"] == 0
    assert result["searched"] == 0
    assert len(result["skipped"]) == 1
    assert "could not be searched" in result["skipped"][0]["reason"]
