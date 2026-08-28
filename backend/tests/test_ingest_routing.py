"""
Routing table integrity.

Identification and routing are two tables that must agree. Nothing in the type
system connects them: `identify.py` can learn a new kind and `routing.py` will
happily answer "Collection tab" for it forever, silently, and the artifact just
never arrives anywhere. These tests are the connection.
"""
from __future__ import annotations

from app.services.ingest.identify import (
    _CONTAINER_REFINEMENTS,
    _EXACT_NAMES,
    _EXTENSIONS,
    _FOLDER_HINTS,
    _SIGNATURES,
)
from app.services.ingest.routing import (
    ARCHIVE_KINDS,
    DEST_UNPACK,
    KNOWN_KINDS,
    destination_pages,
    is_archive_kind,
    route_for,
)


def _all_identifiable_kinds() -> set[str]:
    """Every kind identification can possibly return."""
    kinds = {kind for _, _, kind, _ in _SIGNATURES}
    kinds |= {k for k, _ in _EXTENSIONS.values()}
    kinds |= {k for k, _ in _EXACT_NAMES.values()}
    kinds |= {k for k, _ in _FOLDER_HINTS.values()}
    for refinements in _CONTAINER_REFINEMENTS.values():
        kinds |= {refined for _, refined, _ in refinements}
    # Produced directly by the identifier rather than by a table.
    kinds |= {"unknown", "empty", "csv", "json", "jsonl", "text", "eml"}
    return kinds


def test_every_identifiable_kind_has_a_route():
    """
    The drift this catches: a signature is added, no route is written, and the
    artifact is silently parked in the Collection tab forever.
    """
    missing = sorted(_all_identifiable_kinds() - KNOWN_KINDS)
    assert not missing, (
        "These kinds can be identified but have no row in the routing table, "
        f"so they would fall through to the Collection tab: {missing}"
    )


def test_no_route_exists_for_a_kind_nothing_can_produce():
    """The reverse drift: a route left behind after its signature was removed."""
    orphans = sorted(KNOWN_KINDS - _all_identifiable_kinds())
    assert not orphans, (
        f"Routes with no way to be reached: {orphans}"
    )


def test_an_unmapped_kind_falls_back_rather_than_raising():
    route = route_for("something-invented")
    assert route.primary == "collection"
    assert not route.to_explorer


def test_archive_kinds_agree_with_the_unpack_destination():
    for kind in ARCHIVE_KINDS:
        assert route_for(kind).primary == DEST_UNPACK
        assert is_archive_kind(kind)
    assert not is_archive_kind("evtx")


def test_raw_artifacts_reach_two_destinations():
    """
    The rule from `docs/INGESTION.md` section 6: a raw EVTX belongs in Logs
    *and* in the Explorer. Producing only one of the two is what forces the
    manual re-import that exists today.
    """
    for kind in ("evtx", "mft", "pcap", "eml", "pe", "memory_dump"):
        route = route_for(kind)
        assert route.primary is not None, kind
        assert route.to_explorer, kind
        assert route.parser, f"{kind} needs a parser to reach the Explorer"


def test_already_tabular_kinds_need_no_parser():
    for kind in ("csv", "json", "jsonl", "text", "log"):
        route = route_for(kind)
        assert route.parser is None
        assert route.to_explorer


def test_case_id_is_substituted_into_destination_pages():
    pages = destination_pages("evtx", "abc-123")
    assert "/cases/abc-123/evtx" in pages
    assert not any("{case_id}" in p for p in pages)


def test_pending_routes_name_the_parser_they_are_waiting_for():
    """
    `pending` means "recognised, parser not shipped yet". A pending route with
    no parser name is a route nobody can act on.
    """
    for kind in KNOWN_KINDS:
        route = route_for(kind)
        if route.pending:
            assert route.parser, f"{kind} is pending but names no parser"
