"""
Writing into the drop folder safely.

The Collection tab's upload is a courier: it puts bytes in the same folder that
`scp` puts them in, and stops there. What makes that non-trivial is the
watcher.

The watcher only picks a file up once its size and mtime have been unchanged
across two consecutive polls - that is what stops a copy in progress being read
half-written. An HTTP upload streamed straight into the case folder defeats it:
a request that stalls on a slow client looks exactly like a finished file, and
would be parsed truncated, silently, with no error anywhere.

So an upload is staged under `.incoming/<uuid>` and moved into place only once
the request body has been fully read. The move is atomic, so the watcher sees
either a complete file or no file - never a partial one.

See `docs/INGESTION.md` section 2.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from ...models.case import Case
from ..dropzone import case_dropzone_dir, mkdir_shared

#: Staging area for uploads in flight, inside the case folder so the move into
#: place stays on one filesystem. Dot-prefixed, and `list_dropped` skips
#: directories, so nothing here is ever seen by the watcher.
INCOMING_DIRNAME = ".incoming"

#: Read size when draining an upload. Bounded so a large upload does not sit in
#: memory; the file is written as it arrives.
UPLOAD_CHUNK = 1024 * 1024


class UploadTooLarge(Exception):
    """The request body exceeded the configured ceiling and was discarded."""


def incoming_dir(case: Case) -> Path:
    return mkdir_shared(case_dropzone_dir(case) / INCOMING_DIRNAME)


def unique_target(folder: Path, name: str) -> Path:
    """
    A free path for `name` in `folder`, suffixed if taken.

    `System.evtx` becomes `System (2).evtx`. Not overwritten, and not refused:
    two acquisitions legitimately contain a file of the same name, and content
    duplicates are caught by hash regardless of what they are called.
    """
    candidate = folder / name
    if not candidate.exists():
        return candidate

    stem, suffix = Path(name).stem, Path(name).suffix
    counter = 2
    while True:
        candidate = folder / f"{stem} ({counter}){suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def _move_into_place(staged: Path, target: Path) -> Path:
    """
    Move a finished upload out of staging without ever clobbering.

    `os.link` is tried first because it fails when the target exists, where
    `os.rename` would silently overwrite - and losing an artifact to a name
    collision is not a failure mode worth accepting. Hard links are unavailable
    on some mounts an analyst may point the drop folder at (SMB in particular,
    which this project ships a service for), so rename is the fallback.
    """
    try:
        os.link(staged, target)
        staged.unlink()
        return target
    except (OSError, NotImplementedError):
        # Re-check rather than trusting the earlier `unique_target`: the gap
        # between choosing a name and taking it is small but real.
        final = unique_target(target.parent, target.name)
        os.rename(staged, final)
        return final


def sweep_incoming(case: Case) -> int:
    """
    Delete anything left in staging.

    A file here is the remains of a request that never finished - the client
    disconnected, or the process died mid-upload. It is by definition
    incomplete, was never announced to anyone, and cannot be resumed. Called at
    startup, and after each upload, so staging does not accumulate.
    """
    folder = case_dropzone_dir(case, create=False) / INCOMING_DIRNAME
    if not folder.exists():
        return 0
    removed = 0
    for leftover in folder.iterdir():
        if leftover.is_file():
            try:
                leftover.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def stage_bytes(case: Case, filename: str, data: bytes) -> Path:
    """Synchronous form of `stage_upload`, for callers that already hold the bytes."""
    staged = incoming_dir(case) / str(uuid.uuid4())
    staged.write_bytes(data)
    target = unique_target(case_dropzone_dir(case), Path(filename).name)
    return _move_into_place(staged, target)


async def stage_upload(case: Case, filename: str, source, max_bytes: int) -> Path:
    """
    Drain an upload into the case folder and return where it landed.

    `source` is anything with an async `read(size)` - a Starlette `UploadFile`.
    The body is written as it arrives rather than held in memory, so the ceiling
    below is about disk and denial of service, not about RAM.

    Exceeding `max_bytes` deletes the partial file and raises. The alternative -
    keeping what arrived - would leave a truncated artifact that identifies as
    something real and parses into wrong evidence.
    """
    staged = incoming_dir(case) / str(uuid.uuid4())
    written = 0
    try:
        with open(staged, "wb") as out:
            while chunk := await source.read(UPLOAD_CHUNK):
                written += len(chunk)
                if written > max_bytes:
                    raise UploadTooLarge(filename)
                out.write(chunk)
    except BaseException:
        staged.unlink(missing_ok=True)
        raise

    target = unique_target(case_dropzone_dir(case), Path(filename).name)
    return _move_into_place(staged, target)
