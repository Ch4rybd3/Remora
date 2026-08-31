"""
Archives the standard library cannot decompress.

Written after a 400 MB KAPE triage sat in a drop folder untouched. Python's
`zipfile` knows the *name* of every ZIP compression method and implements four;
method 9, Deflate64, is what 7-Zip and several Windows tools produce for large
archives, and the stdlib raises `NotImplementedError: That compression method is
not supported`.

Worse than the failure itself: the exception escaped and killed the whole drop
folder sweep, so every other artifact in the folder waited behind it.
"""
from __future__ import annotations

import shutil
import subprocess
import zipfile
from pathlib import Path

import pytest

from app.services import archives


def _sevenzip() -> str | None:
    for candidate in ("7z", "7za", "7zz"):
        if shutil.which(candidate):
            return candidate
    return None


@pytest.fixture()
def deflate64_zip(tmp_path: Path) -> Path:
    """A real Deflate64 archive, built with 7-Zip rather than simulated."""
    binary = _sevenzip()
    if not binary:
        pytest.skip("7z is not installed here")

    source = tmp_path / "content"
    source.mkdir()
    # Compressible on purpose: 7-Zip stores incompressible data verbatim, and a
    # stored entry reads fine in the stdlib - the test would pass while proving
    # nothing about method 9.
    (source / "Security.evtx").write_bytes(b"ElfFile\x00" + b"\x00" * 400_000)
    (source / "Amcache.csv").write_text("a,b\n" + "1,2\n" * 20_000)

    archive = tmp_path / "kapetriage.zip"
    result = subprocess.run(
        [binary, "a", "-tzip", "-mm=Deflate64", str(archive), str(source / "*")],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0 or not archive.exists():
        pytest.skip(f"could not build a Deflate64 archive: {result.stderr[:200]}")

    with zipfile.ZipFile(archive) as zf:
        if 9 not in {i.compress_type for i in zf.infolist()}:
            pytest.skip("7-Zip did not produce method 9 here")
    return archive


def test_the_standard_library_really_cannot_read_it(deflate64_zip: Path):
    """
    The premise, asserted rather than assumed. If a future Python gains
    Deflate64 this test fails and the fallback below becomes unnecessary -
    which is worth being told about.
    """
    with zipfile.ZipFile(deflate64_zip) as zf:
        name = next(n for n in zf.namelist() if not n.endswith("/"))
        with pytest.raises(NotImplementedError):
            zf.read(name)


def test_it_is_listed(deflate64_zip: Path):
    """
    Listing works even without the decompressor - the central directory is not
    compressed - so a broken archive announces the right contents and only
    fails later. Both paths fall back, so the two agree.
    """
    entries = archives.list_entries(deflate64_zip, deflate64_zip.name)
    assert any(e.endswith("Security.evtx") for e in entries)


def test_it_extracts_through_the_fallback(deflate64_zip: Path, tmp_path: Path):
    """p7zip is already in the image for .7z and .rar; it reads Deflate64 too."""
    out = tmp_path / "out"
    archives.extract_all(deflate64_zip, out, deflate64_zip.name)

    extracted = {p.name for p in out.rglob("*") if p.is_file()}
    assert "Security.evtx" in extracted
    assert (next(p for p in out.rglob("Security.evtx"))).read_bytes().startswith(b"ElfFile")


def test_an_unreadable_archive_raises_ArchiveError_not_something_else(tmp_path: Path):
    """
    Every failure has to leave as `ArchiveError`. A `NotImplementedError`
    escaping this function is what killed the sweep.
    """
    broken = tmp_path / "broken.zip"
    broken.write_bytes(b"PK\x03\x04" + b"\xff" * 200)

    with pytest.raises(archives.ArchiveError):
        archives.extract_all(broken, tmp_path / "out", broken.name)


# ─── End to end, through the drop folder ──────────────────────────────────────

def test_a_deflate64_archive_dropped_in_a_case_folder_is_ingested(
    auth_client, db_session, deflate64_zip: Path
):
    """
    The reported failure, from the analyst's side: a 400 MB KAPE triage in a
    case folder, showing as waiting and never arriving.
    """
    import shutil as _shutil

    from app.models.case import Case
    from app.models.ingest import IngestedFile
    from app.services import dropzone as dz

    case_id = auth_client.post("/api/v1/cases/", json={"title": "deflate64"}).json()["id"]
    case = db_session.query(Case).filter(Case.id == case_id).one()
    _shutil.copy2(deflate64_zip, dz.case_dropzone_dir(case) / "kapetriage2.zip")

    response = auth_client.post(f"/api/v1/cases/{case_id}/dropzone/scan",
                                params={"include_unstable": True})
    assert response.status_code == 200, response.text
    assert response.json()["ingested"] > 0, "the archive produced no files"

    names = {
        row.original_name
        for row in db_session.query(IngestedFile).filter(IngestedFile.case_id == case_id)
    }
    assert "Security.evtx" in names
    assert "Amcache.csv" in names


def test_one_unreadable_archive_does_not_stop_the_rest(auth_client, db_session, tmp_path):
    """
    This is what actually cost five minutes of silence: the exception escaped
    `ingest_files` and killed the sweep, so every other artifact in the folder
    waited behind an archive nobody could read.
    """
    from app.models.case import Case
    from app.models.ingest import IngestedFile
    from app.services import dropzone as dz

    case_id = auth_client.post("/api/v1/cases/", json={"title": "one bad apple"}).json()["id"]
    case = db_session.query(Case).filter(Case.id == case_id).one()
    folder = dz.case_dropzone_dir(case)

    (folder / "corrupt.zip").write_bytes(b"PK\x03\x04" + b"\xff" * 400)
    (folder / "good.csv").write_text("a,b\n1,2\n3,4\n")

    response = auth_client.post(f"/api/v1/cases/{case_id}/dropzone/scan",
                                params={"include_unstable": True})
    assert response.status_code == 200, response.text

    rows = list(db_session.query(IngestedFile).filter(IngestedFile.case_id == case_id))
    names = [row.original_name for row in rows]
    assert "good.csv" in names, "a readable file was skipped because another failed"

    # Exactly one row for the archive. The first version of this recorded it
    # twice - once here and once in the provenance pass - and the second was
    # marked `duplicate` by its own hash. Collecting into a dict by name hid
    # that, and which of the two survived depended on row order, so the test
    # passed locally and failed in CI.
    archive_rows = [row for row in rows if row.original_name == "corrupt.zip"]
    assert len(archive_rows) == 1, f"expected one row, got {[r.state for r in archive_rows]}"
    assert archive_rows[0].state == "failed"
    assert archive_rows[0].error
