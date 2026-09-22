"""
The parsing catalogue.

"Which artifacts does Remora support?" had no answer except reading source.
`docs/COVERAGE.md` measured a real triage once, in September, and nothing
connected it to the code afterwards - so it could only get further from the
truth.

The catalogue is a join across the registries that actually run, and these
tests are what keep it a join rather than a fourth list to maintain. Two of
them matter most: the one that regenerates the document, and the ones that
assert the registries agree with each other, because a parser reachable from
one table and not another is invisible in exactly the way this is meant to
prevent.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services.ingest import coverage, ez_parsers, python_parsers, routing
from app.services.ingest.dispatch import _HANDLERS, _NEEDS_INPUT

DOC = Path(__file__).resolve().parents[2] / "docs" / "COVERAGE.md"


@pytest.fixture(scope="module")
def rows() -> list[coverage.KindCoverage]:
    return coverage.catalogue()


# ─── The catalogue covers the pipeline ────────────────────────────────────────

def test_every_routed_kind_appears(rows):
    """The routing table is the vocabulary. Nothing in it may be missing here."""
    assert {r.kind for r in rows} == set(routing.KNOWN_KINDS)


def test_no_kind_appears_twice(rows):
    kinds = [r.kind for r in rows]
    assert len(kinds) == len(set(kinds))


def test_every_kind_has_a_label_and_a_status(rows):
    for row in rows:
        assert row.label.strip(), f"{row.kind} has no label"
        assert row.status in coverage.STATUS_LABELS, f"{row.kind}: {row.status!r}"


def test_the_summary_counts_every_kind(rows):
    assert sum(coverage.summary().values()) == len(rows)


# ─── The registries agree ─────────────────────────────────────────────────────

def test_every_parser_reaches_a_routed_kind():
    """
    A parser written for a kind the routing table does not know would never
    run. It would also be invisible: the catalogue reads the routing table, so
    the parser would simply not appear anywhere.
    """
    parser_kinds = set(python_parsers.HANDLED_KINDS) | set(ez_parsers.PARSEABLE_KINDS)

    assert parser_kinds <= set(routing.KNOWN_KINDS), (
        f"parsers for unrouted kinds: {sorted(parser_kinds - set(routing.KNOWN_KINDS))}")


def test_every_dispatched_kind_is_routed():
    assert set(_HANDLERS) <= set(routing.KNOWN_KINDS)


def test_a_kind_needing_an_analyst_is_never_also_dispatched():
    """
    The two are contradictory: `_NEEDS_INPUT` promises the file waits for a
    person, a handler parses it immediately. A kind in both would show the
    analyst a note explaining why nothing happened, next to the result.
    """
    both = set(_NEEDS_INPUT) & set(_HANDLERS)

    assert not both, f"claimed by a handler and by _NEEDS_INPUT: {sorted(both)}"


def test_a_parsed_kind_names_who_parses_it(rows):
    """
    Status and engine must not contradict each other. They did on the first
    attempt: a registry hive dispatched to an Eric Zimmerman tool reported no
    parser at all, because its routing row carries no parser slug and the tool
    is chosen from the file name instead.
    """
    for row in rows:
        if row.status == coverage.STATUS_PARSED:
            assert row.engine, f"{row.kind} is parsed by nothing named"


def test_a_pending_kind_names_the_parser_it_is_waiting_for(rows):
    for row in rows:
        if row.status == coverage.STATUS_PENDING:
            assert row.parser, f"{row.kind} is pending an unnamed parser"


def test_a_kind_needing_an_analyst_says_what_is_missing(rows):
    """An analyst seeing "not parsed" with no reason cannot act on it."""
    for row in rows:
        if row.status == coverage.STATUS_ANALYST:
            assert row.note.strip(), f"{row.kind} gives no reason"


# ─── Individual answers, pinned ───────────────────────────────────────────────

def _row(rows, kind: str) -> coverage.KindCoverage:
    return next(r for r in rows if r.kind == kind)


def test_a_csv_is_tabular_not_parsed(rows):
    assert _row(rows, "csv").status == coverage.STATUS_TABULAR


def test_a_registry_hive_is_parsed_by_whichever_tool_its_name_selects(rows):
    """
    The conditional case, and the one worth pinning: SYSTEM goes to
    AppCompatCacheParser, Amcache.hve to AmcacheParser, UsrClass.dat to SBECmd,
    and SOFTWARE deliberately to nothing.
    """
    hive = _row(rows, "registry_hive")

    assert hive.status == coverage.STATUS_PARSED
    assert "AmcacheParser" in hive.engine
    assert "amcache" in hive.formats


def test_an_archive_is_unpacked_rather_than_parsed(rows):
    assert _row(rows, "archive_zip").status == coverage.STATUS_CONTAINER


def test_a_raw_memory_dump_waits_for_an_analyst(rows):
    dump = _row(rows, "memory_dump")

    assert dump.status == coverage.STATUS_ANALYST
    assert "OS" in dump.note or "os" in dump.note.lower()


def test_an_unidentified_file_is_held_not_refused(rows):
    """A pipeline that rejects files becomes a prison, and analysts route
    around prisons - docs/INGESTION.md section 6."""
    assert _row(rows, "unknown").status == coverage.STATUS_HELD


# ─── The API serves it ────────────────────────────────────────────────────────

def test_the_coverage_endpoint_returns_the_catalogue(auth_client: TestClient):
    response = auth_client.get("/api/v1/coverage")
    assert response.status_code == 200, response.text

    body = response.json()
    assert {r["kind"] for r in body["kinds"]} == set(routing.KNOWN_KINDS)
    assert body["summary"] == coverage.summary()
    assert set(body["labels"]) == set(coverage.STATUS_LABELS)


def test_the_coverage_endpoint_needs_a_session(client: TestClient):
    # 401 or 403 depending on whether the header was absent or rejected, the
    # same pair the route contract test accepts.
    assert client.get("/api/v1/coverage").status_code in (401, 403)


# ─── The documentation is a consequence ───────────────────────────────────────

def test_the_coverage_document_matches_the_registries():
    """
    If this fails, a parser or a route changed and docs/COVERAGE.md did not.
    Do not edit the table by hand - regenerate it:

        python -c "from pathlib import Path; \\
                   from app.services.ingest import coverage as c; \\
                   p = Path('docs/COVERAGE.md'); \\
                   p.write_text(c.render_doc_section(p.read_text()))"
    """
    current = DOC.read_text()

    assert coverage.render_doc_section(current) == current, (
        "docs/COVERAGE.md is out of date with the ingest registries")


def test_every_kind_is_named_in_the_document(rows):
    reference = DOC.read_text()

    for row in rows:
        assert f"`{row.kind}`" in reference, f"{row.kind} is undocumented"
