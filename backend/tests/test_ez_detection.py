"""
EZ Tools artifact detection unit tests.

Detection decides where an artifact is routed. A wrong answer misfiles evidence
silently, so the mapping is asserted explicitly rather than smoke-tested.
"""
from __future__ import annotations

import pytest

from app.services.ez_detection import detect, detect_zip_contents

# (filename, expected category)
KNOWN = [
    ("20260101120000_EvtxECmd_Output.csv", "evtx_ez"),
    ("20260101120000_RBCmd_Output.csv", "recycle_bin"),
    ("20260101120000_LECmd_Output.csv", "lnk_files"),
    ("AutomaticDestinations.csv", "jump_lists_auto"),
    ("CustomDestinations.csv", "jump_lists_custom"),
    ("20260101_Activity.csv", "windows_timeline"),
]


@pytest.mark.parametrize("filename,expected", KNOWN, ids=[f for f, _ in KNOWN])
def test_known_artifacts_are_categorised(filename: str, expected: str) -> None:
    result = detect(filename)
    assert result is not None, f"{filename} was not recognised"
    assert result.category == expected


@pytest.mark.parametrize("filename,_expected", KNOWN, ids=[f for f, _ in KNOWN])
def test_detection_is_case_insensitive(filename: str, _expected: str) -> None:
    assert detect(filename.upper()) is not None
    assert detect(filename.lower()) is not None


@pytest.mark.parametrize(
    "path",
    [
        "C:\\KAPE\\out\\20260101120000_EvtxECmd_Output.csv",
        "/mnt/kape/out/20260101120000_EvtxECmd_Output.csv",
        "out\\sub\\AutomaticDestinations.csv",
    ],
)
def test_leading_directories_are_ignored(path: str) -> None:
    """Detection reads the basename, so both separators must work."""
    assert detect(path) is not None


@pytest.mark.parametrize(
    "filename",
    ["notes.txt", "screenshot.png", "report.docx", "", "random.csv"],
)
def test_unknown_files_return_none(filename: str) -> None:
    assert detect(filename) is None


def test_every_result_routes_to_the_explorer() -> None:
    """All detected artifacts land in the Artifact Explorer; a result that
    points anywhere else means the routing contract has drifted."""
    for filename, _ in KNOWN:
        result = detect(filename)
        assert result is not None
        assert result.destination_page == "/artifacts/explorer"
        assert result.category_label, "a category must carry a human-readable label"


def test_zip_contents_maps_every_entry() -> None:
    entries = ["AutomaticDestinations.csv", "unknown.bin"]
    results = detect_zip_contents(entries)
    assert set(results) == set(entries)
    assert results["AutomaticDestinations.csv"] is not None
    assert results["unknown.bin"] is None
