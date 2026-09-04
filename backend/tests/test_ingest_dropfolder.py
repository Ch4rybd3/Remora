"""
The two access points.

What these tests hold in place is the claim in `docs/INGESTION.md` section 2:
the Collection tab's upload is a courier, not an importer, and the watcher can
never see a partially written file.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.models.case import Case
from app.services import dropzone as dz
from app.services.ingest import dropfolder

EVTX = b"ElfFile\x00" + b"\x00" * 128


class _FakeUpload:
    """A Starlette UploadFile as far as `stage_upload` is concerned."""

    def __init__(self, data: bytes, chunk: int = 7):
        self._data, self._chunk, self._pos = data, chunk, 0

    async def read(self, size: int = -1) -> bytes:
        take = self._chunk if size == -1 else min(size, self._chunk)
        out = self._data[self._pos:self._pos + take]
        self._pos += len(out)
        return out


@pytest.fixture()
def case(db_session) -> Case:
    row = Case(id=str(uuid.uuid4()), title="Dropfolder test")
    db_session.add(row)
    db_session.commit()
    return row


# ─── Staging and the atomic move ──────────────────────────────────────────────

@pytest.mark.anyio
async def test_an_upload_lands_in_the_case_folder(case: Case):
    landed = await dropfolder.stage_upload(case, "Security.evtx", _FakeUpload(EVTX), 10 ** 9)

    assert landed.parent == dz.case_dropzone_dir(case)
    assert landed.read_bytes() == EVTX
    assert landed.name == "Security.evtx"


@pytest.mark.anyio
async def test_staging_is_empty_once_the_upload_completes(case: Case):
    await dropfolder.stage_upload(case, "a.evtx", _FakeUpload(EVTX), 10 ** 9)
    staging = dz.case_dropzone_dir(case) / dropfolder.INCOMING_DIRNAME
    assert list(staging.iterdir()) == []


@pytest.mark.anyio
async def test_the_watcher_never_sees_a_file_in_staging(case: Case):
    """
    The reason `.incoming/` exists.

    A body still arriving must be invisible to `list_dropped`, or a stalled
    request looks exactly like a finished file and gets parsed truncated.
    """
    staging = dropfolder.incoming_dir(case)
    (staging / "half-written").write_bytes(EVTX[:4])

    visible = {f.name for f in dz.list_dropped(dz.case_dropzone_dir(case))}
    assert "half-written" not in visible


@pytest.mark.anyio
async def test_an_interrupted_upload_leaves_nothing_ingestible(case: Case):
    class _Failing:
        def __init__(self):
            self.calls = 0

        async def read(self, size: int = -1) -> bytes:
            self.calls += 1
            if self.calls == 1:
                return b"ElfFile\x00"
            raise ConnectionResetError("client went away")

    with pytest.raises(ConnectionResetError):
        await dropfolder.stage_upload(case, "truncated.evtx", _Failing(), 10 ** 9)

    assert list(dropfolder.incoming_dir(case).iterdir()) == []
    assert not (dz.case_dropzone_dir(case) / "truncated.evtx").exists()


@pytest.mark.anyio
async def test_an_oversized_upload_is_discarded_not_truncated(case: Case):
    """
    Keeping what arrived would leave a file that identifies as something real
    and parses into wrong evidence. Refusing it is the only safe answer.
    """
    with pytest.raises(dropfolder.UploadTooLarge):
        await dropfolder.stage_upload(case, "big.evtx", _FakeUpload(EVTX), max_bytes=16)

    assert list(dropfolder.incoming_dir(case).iterdir()) == []
    assert not (dz.case_dropzone_dir(case) / "big.evtx").exists()


# ─── Name collisions ──────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_a_name_collision_is_suffixed_not_overwritten(case: Case):
    """
    Two acquisitions legitimately contain a `System.evtx`.

    Overwriting would destroy evidence; refusing would block a legitimate
    import. Content-level duplicates are caught by hash regardless of the name.
    """
    first  = await dropfolder.stage_upload(case, "System.evtx", _FakeUpload(EVTX), 10 ** 9)
    second = await dropfolder.stage_upload(case, "System.evtx", _FakeUpload(EVTX + b"\x01"), 10 ** 9)

    assert first.name == "System.evtx"
    assert second.name == "System (2).evtx"
    assert first.read_bytes() != second.read_bytes()
    assert first.exists()


def test_unique_target_keeps_the_extension(tmp_path: Path):
    (tmp_path / "report.evtx").write_bytes(b"x")
    assert dropfolder.unique_target(tmp_path, "report.evtx").name == "report (2).evtx"


def test_a_path_in_the_filename_cannot_escape_the_case_folder(case: Case):
    """
    An upload naming itself `../../etc/passwd` must not write outside the case.

    `Path(name).name` is applied before the target is chosen, so only the
    basename survives.
    """
    target = dropfolder.unique_target(
        dz.case_dropzone_dir(case), Path("../../../etc/passwd").name)
    assert target.parent == dz.case_dropzone_dir(case)
    assert target.name == "passwd"


# ─── Housekeeping ─────────────────────────────────────────────────────────────

def test_sweeping_clears_interrupted_uploads(case: Case):
    staging = dropfolder.incoming_dir(case)
    (staging / "leftover-1").write_bytes(b"partial")
    (staging / "leftover-2").write_bytes(b"partial")

    assert dropfolder.sweep_incoming(case) == 2
    assert list(staging.iterdir()) == []


def test_sweeping_a_case_with_no_staging_is_not_an_error(db_session):
    orphan = Case(id=str(uuid.uuid4()), title="Never uploaded to")
    db_session.add(orphan)
    db_session.commit()
    assert dropfolder.sweep_incoming(orphan) == 0
