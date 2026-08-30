"""
Choosing and running an Eric Zimmerman parser.

These test the *choice* - which tool reads which artifact, and what is said
when none does. Running the tools themselves needs the tools installed and real
Windows artifacts; the sandbox they run in has its own tests.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services import ez_tools
from app.services.ingest import ez_parsers

# ─── The tool inventory ───────────────────────────────────────────────────────


def test_the_two_windows_only_tools_are_not_shipped():
    """
    PECmd and SrumECmd exit with "not supported" on Linux - prefetch needs a
    Windows decompression API, SRUM needs Windows ESE libraries. Shipping a
    parser that fails on every artifact is worse than not having it: the
    analyst sees a failure and cannot tell it from a corrupt file.
    """
    assert "PECmd" not in ez_tools.TOOLS
    assert "SrumECmd" not in ez_tools.TOOLS
    assert set(ez_tools.LINUX_UNSUPPORTED) == {"PECmd", "SrumECmd"}


def test_every_shipped_tool_has_a_pinned_hash():
    """
    A binary fetched from a third-party host and run against evidence is
    exactly the thing that should be pinned.
    """
    for name in ez_tools.TOOLS:
        assert ez_tools.PINNED_SHA256.get(name), name
        assert len(ez_tools.PINNED_SHA256[name]) == 64


def test_a_hash_mismatch_refuses_the_tool():
    """
    A changed binary from a third-party host is the event that should stop, not
    the one that should be waved through.
    """
    with pytest.raises(ez_tools.ProvisioningError, match="pinned hash"):
        ez_tools._verify("MFTECmd", b"not the real archive")


def test_an_unknown_tool_has_no_pin_and_is_refused():
    with pytest.raises(ez_tools.ProvisioningError, match="No pinned hash"):
        ez_tools._verify("SomeOtherTool", b"anything")


# ─── Choosing a recipe ────────────────────────────────────────────────────────

@pytest.mark.parametrize("kind,expected", [
    ("evtx",            "EvtxECmd"),
    ("mft",             "MFTECmd"),
    ("usnjrnl",         "MFTECmd"),
    ("lnk",             "LECmd"),
    ("jumplist_auto",   "JLECmd"),
    ("jumplist_custom", "JLECmd"),
    ("windows_timeline", "WxTCmd"),
])
def test_a_kind_maps_to_its_tool(kind: str, expected: str):
    recipe = ez_parsers.recipe_for(kind, "artifact.bin")
    assert recipe is not None and recipe.tool == expected


@pytest.mark.parametrize("filename,expected", [
    ("Amcache.hve",                    "AmcacheParser"),
    ("WKSTN01_20260830_Amcache.hve",   "AmcacheParser"),
    ("SYSTEM",                         "AppCompatCacheParser"),
    ("UsrClass.dat",                   "SBECmd"),
    ("NTUSER.DAT",                     "SBECmd"),
])
def test_a_registry_hive_is_resolved_by_its_name(filename: str, expected: str):
    """
    A hive is not one artifact. The signature says "hive"; the name says which
    one - the same refinement identification does for SQLite and ESE
    containers, and for the same reason. KAPE prefixes the machine name and a
    timestamp, so this matches on a substring.
    """
    recipe = ez_parsers.recipe_for("registry_hive", filename)
    assert recipe is not None and recipe.tool == expected


@pytest.mark.parametrize("filename", ["SOFTWARE", "SECURITY", "SAM"])
def test_a_general_purpose_hive_is_deliberately_not_parsed(filename: str):
    """
    RECmd would read them, and needs a batch file naming which keys to extract.
    Which keys matter is an analyst's decision; shipping one would quietly
    define what "the registry" means for every investigation.
    """
    assert ez_parsers.recipe_for("registry_hive", filename) is None


def test_a_kind_with_no_tool_returns_nothing():
    assert ez_parsers.recipe_for("csv", "table.csv") is None


def test_the_kinds_a_handler_is_registered_for_all_resolve():
    """
    A kind in `PARSEABLE_KINDS` with no reachable recipe would be a handler
    that always fails - and would look like a broken tool rather than a missing
    one.
    """
    for kind in ez_parsers.PARSEABLE_KINDS:
        if kind == "registry_hive":
            assert ez_parsers.recipe_for(kind, "Amcache.hve") is not None
        else:
            assert ez_parsers.recipe_for(kind, "x") is not None


# ─── Failing honestly ─────────────────────────────────────────────────────────

def test_a_missing_tool_is_reported_not_raised(tmp_path: Path, monkeypatch):
    """
    One artifact whose tool is absent must not stop the collection it arrived
    in from ingesting.
    """
    monkeypatch.setattr(ez_tools, "find", lambda name: None)
    artifact = tmp_path / "Security.evtx"
    artifact.write_bytes(b"ElfFile\x00" + b"\x00" * 64)

    outcome = ez_parsers.run("evtx", artifact, tmp_path / "work")
    assert not outcome.ok
    assert "not installed" in (outcome.error or "")


def test_an_unparseable_kind_says_why(tmp_path: Path):
    artifact = tmp_path / "SOFTWARE"
    artifact.write_bytes(b"regf" + b"\x00" * 64)

    outcome = ez_parsers.run("registry_hive", artifact, tmp_path / "work")
    assert not outcome.ok
    assert "which keys matter" in (outcome.error or "")


def test_prefetch_and_srum_say_what_is_missing():
    """
    Recognised, kept, preservable as evidence - and honest about why they are
    not parsed here.
    """
    assert "Windows API" in ez_parsers.UNHANDLED_NOTE["prefetch"]
    assert "Windows-only" in ez_parsers.UNHANDLED_NOTE["srum"]
