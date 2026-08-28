"""
The ingestion state machine.

One entry point, `record()`, walks a file from `discovered` to `routed` and
writes exactly one `IngestedFile` row for it. Every door into Remora - the drop
folder, the Collection tab's upload, an unpacked archive member, a connector -
calls this and nothing else. That is what makes identification, deduplication
and routing testable in one place instead of fourteen.

What this module deliberately does *not* do: parse. Parsing is per-artifact,
belongs behind the sandbox described in `docs/INGESTION.md` section 12, and
runs after routing has decided who owns the file. Mixing the two is how the
current routers ended up impossible to test.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ...models.ingest import (
    DETECTED_BY_FORCED,
    ORIGIN_DROPZONE,
    STATE_DUPLICATE,
    STATE_IDENTIFIED,
    STATE_ROUTED,
    STATE_UNIDENTIFIED,
    STATE_UNSUPPORTED,
    IngestedFile,
)
from .identify import identify
from .routing import DEST_COLLECTION, DEST_UNPACK, route_for

#: Read size for hashing. Large enough that a 400 GB E01 is not death by
#: syscall, small enough not to hold a meaningful amount of it in memory.
_HASH_CHUNK = 1024 * 1024


def compute_sha256(path: Path) -> str:
    """Stream the file through SHA-256. Never loads it whole."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(_HASH_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def find_duplicate(db: Session, case_id: str, sha256: str) -> IngestedFile | None:
    """
    The earliest file with this hash in this case, if any.

    **Per case, deliberately.** The same EVTX legitimately belongs to two
    investigations and must exist in both; blocking globally would corrupt the
    second one. Dropping it twice into a single case is a mistake worth
    surfacing, so the earliest row is returned to be referenced, not hidden.
    """
    return (
        db.query(IngestedFile)
        .filter(
            IngestedFile.case_id == case_id,
            IngestedFile.sha256 == sha256,
            IngestedFile.state != STATE_DUPLICATE,
        )
        .order_by(IngestedFile.created_at.asc())
        .first()
    )


def _resolve_state(kind: str) -> tuple[str, str | None]:
    """
    Map an identification onto a state and a destination.

    Returns `(state, routed_to)`. Nothing here raises: an unrecognised file is
    a soft signal that lands in the Collection tab for an analyst to act on,
    never an error that loses the bytes.
    """
    route = route_for(kind)

    if kind == "unknown":
        return STATE_UNIDENTIFIED, DEST_COLLECTION
    if route.primary == DEST_UNPACK:
        return STATE_IDENTIFIED, DEST_UNPACK
    if route.pending:
        # Recognised, but its parser has not shipped. The file is stored and
        # listed; it simply is not queryable yet.
        return STATE_UNSUPPORTED, route.primary or DEST_COLLECTION
    if route.primary is None and not route.to_explorer:
        return STATE_UNSUPPORTED, DEST_COLLECTION

    return STATE_ROUTED, route.primary or "artifact_explorer"


def record(
    db: Session,
    *,
    case_id: str,
    path: Path,
    original_name: str | None = None,
    origin: str = ORIGIN_DROPZONE,
    origin_detail: str | None = None,
    collection_id: str | None = None,
    parent_id: str | None = None,
    folder_hint: str | None = None,
    source_timezone: str = "UTC",
    stored_path: str | None = None,
    commit: bool = True,
) -> IngestedFile:
    """
    Walk one file through the pipeline and persist the result.

    The row is written whatever the outcome, including for duplicates and for
    files nothing could identify. A file the pipeline has seen and rejected is
    still a fact about the case, and losing that fact is how "what has been
    ingested here?" became unanswerable in the first place.
    """
    name = original_name or path.name
    size = path.stat().st_size if path.exists() else 0

    row = IngestedFile(
        id=str(uuid.uuid4()),
        case_id=case_id,
        collection_id=collection_id,
        parent_id=parent_id,
        original_name=name,
        stored_path=stored_path,
        size_bytes=size,
        origin=origin,
        origin_detail=origin_detail,
        source_timezone=source_timezone,
        created_at=datetime.utcnow(),
    )

    # ── hashed ──────────────────────────────────────────────────────────────
    try:
        row.sha256 = compute_sha256(path)
    except OSError as exc:
        row.state = STATE_UNIDENTIFIED
        row.routed_to = DEST_COLLECTION
        row.error = f"Could not read the file: {exc}"
        db.add(row)
        if commit:
            db.commit()
        return row

    # ── duplicate ───────────────────────────────────────────────────────────
    existing = find_duplicate(db, case_id, row.sha256)
    if existing is not None:
        row.state = STATE_DUPLICATE
        row.detected_kind = existing.detected_kind
        row.magic_type = existing.magic_type
        row.detection_source = existing.detection_source
        row.routed_to = existing.routed_to
        row.error = f"Already ingested in this case as '{existing.original_name}'"
        row.parsed_artifact_id = existing.id
        db.add(row)
        if commit:
            db.commit()
        return row

    # ── identified → routed ─────────────────────────────────────────────────
    found = identify(path, name=name, folder_hint=folder_hint)
    row.detected_kind    = found.kind
    row.magic_type       = found.label
    row.detection_source = found.source
    row.state, row.routed_to = _resolve_state(found.kind)

    db.add(row)
    if commit:
        db.commit()
    return row


def force_kind(db: Session, row: IngestedFile, kind: str,
               commit: bool = True) -> IngestedFile:
    """
    Override the detected type from the Collection tab.

    This is the recovery path for `unidentified`: the analyst knows the file is
    a registry hive even though it carries no signature, and says so. `forced`
    outranks every other detection source and is never recomputed, so a later
    re-scan will not quietly undo the correction.
    """
    row.detected_kind    = kind
    row.detection_source = DETECTED_BY_FORCED
    # The old magic_type is kept: what the bytes said stays true and is worth
    # having next to the override, so a wrong force is visible later.
    row.magic_type = row.magic_type or kind
    row.error = None
    row.state, row.routed_to = _resolve_state(kind)
    row.updated_at = datetime.utcnow()
    db.add(row)
    if commit:
        db.commit()
    return row


def case_summary(db: Session, case_id: str) -> dict[str, int]:
    """
    Count of files per state for one case - what the Collection tab header
    shows, and the answer to "what has been ingested into this case?".
    """
    rows = (
        db.query(IngestedFile.state, IngestedFile.id)
        .filter(IngestedFile.case_id == case_id)
        .all()
    )
    out: dict[str, int] = {}
    for state, _ in rows:
        out[state] = out.get(state, 0) + 1
    return out
