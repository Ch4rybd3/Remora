"""
The sample of every artifact kind.

Two claims, and the second is the one that keeps working after everybody has
forgotten this file exists.

**Each sample is what it says it is.** A fixture that no longer identifies as
its kind means either the sample or the identification changed, and both are
worth stopping for. Building these found three real defects: an .eml opening
with `From:` was filed as a text file and never reached Email Analysis, an mbox
was claimed as a single message, and every XML document was labelled prose.

**Every kind is accounted for.** `FIXTURES` and `NO_FIXTURE` together must be
exactly the catalogue. So a parser added for a new kind fails here with "has
neither a fixture nor a stated reason" - the question nobody would otherwise
remember to ask.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.ingest import coverage, routing
from app.services.ingest.identify import identify
from tests import fixtures


def _written(fixture: fixtures.Fixture, tmp_path: Path) -> Path:
    path = tmp_path / fixture.filename
    path.write_bytes(fixture.bytes())
    return path


_ALL = sorted(fixtures.FIXTURES)


# ─── Every kind is accounted for ──────────────────────────────────────────────

def test_the_two_registries_cover_the_catalogue_exactly():
    """
    The gate. A kind with neither a sample nor a reason is a gap in the test
    corpus, and a name in neither table is a kind that no longer exists.
    """
    known    = {row.kind for row in coverage.catalogue()}
    accounted = set(fixtures.FIXTURES) | set(fixtures.NO_FIXTURE)

    assert not known - accounted, (
        f"no fixture and no stated reason: {sorted(known - accounted)}. "
        f"Add a builder to tests/fixtures, or an entry to NO_FIXTURE saying why not.")
    assert not accounted - known, (
        f"fixtures for kinds the pipeline no longer knows: {sorted(accounted - known)}")


def test_a_kind_is_never_in_both_registries():
    assert not set(fixtures.FIXTURES) & set(fixtures.NO_FIXTURE)


def test_every_exemption_gives_a_reason():
    """"No fixture" with no reason is indistinguishable from an oversight."""
    for kind, reason in fixtures.NO_FIXTURE.items():
        assert len(reason.strip()) > 40, f"{kind} is exempted without a real reason"


def test_the_exemptions_stay_a_minority():
    """
    Not a coverage target - a ratio nobody reads. A guard: if most kinds became
    unsynthesisable, this corpus would have stopped proving anything and should
    fail loudly rather than pass on eight samples.
    """
    assert len(fixtures.NO_FIXTURE) < len(fixtures.FIXTURES) / 2


# ─── Every sample is what it claims ───────────────────────────────────────────

@pytest.mark.parametrize("kind", _ALL)
def test_the_fixture_identifies_as_its_kind(kind: str, tmp_path: Path):
    fixture = fixtures.FIXTURES[kind]

    found = identify(_written(fixture, tmp_path), fixture.filename)

    assert found.kind == kind, (
        f"{fixture.filename} was built as {kind} and identifies as {found.kind} "
        f"(by {found.source})")


@pytest.mark.parametrize("kind", _ALL)
def test_the_fixture_reaches_a_route(kind: str):
    """Identification without a route would leave the file in the queue."""
    assert kind in routing.KNOWN_KINDS


@pytest.mark.parametrize("kind", _ALL)
def test_the_fixture_carries_a_label(kind: str, tmp_path: Path):
    """The Collection tab shows this string; an empty one is a blank row."""
    fixture = fixtures.FIXTURES[kind]

    assert identify(_written(fixture, tmp_path), fixture.filename).label.strip()


def test_a_fixture_recognised_by_bytes_survives_a_wrong_name(tmp_path: Path):
    """
    A staged upload arrives under a UUID and an archive member under whatever
    path it had inside. Anything with a signature must not depend on the name.
    """
    for kind, fixture in fixtures.FIXTURES.items():
        if fixture.needs_name:
            continue
        path = tmp_path / f"{kind}-staged.tmp"
        path.write_bytes(fixture.bytes())

        found = identify(path, path.name)

        assert found.kind == kind, (
            f"{kind} is only recognised under its own name; mark it needs_name=True "
            f"if that is intended")


# ─── The samples are samples, not evidence ────────────────────────────────────

def test_no_fixture_is_large():
    """
    A test corpus that grows into megabytes stops being checked in and starts
    being downloaded, which is how a suite becomes unrunnable offline.
    """
    for kind, fixture in fixtures.FIXTURES.items():
        size = len(fixture.bytes())
        assert size <= 64 * 1024, f"{kind} builds {size} bytes"


def test_fixtures_are_built_rather_than_committed():
    """
    Nothing in the package is a file on disk. A real artifact carries somebody's
    machine in it, which a DFIR product's repository must not - and the moment
    one binary is checked in, the next one is easier to justify.
    """
    package = Path(fixtures.__file__).parent
    committed = [p for p in package.iterdir()
                 if p.is_file() and p.suffix not in {".py", ".pyc"}]

    assert not committed, f"binary fixtures checked in: {[p.name for p in committed]}"


def test_a_fixture_builds_the_same_bytes_twice():
    """A builder reading the clock or a random source would make a failure
    impossible to reproduce from the message."""
    for kind, fixture in fixtures.FIXTURES.items():
        assert fixture.bytes() == fixture.bytes(), f"{kind} is not deterministic"
