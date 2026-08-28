"""
Provenance for what was ingested before the pipeline existed.

Without this, an installation that upgrades sees an empty ingest queue for
cases full of artifacts - the table would only know about files added after the
upgrade, which makes "what has been ingested into this case?" answerable only
for recent history. On a case opened months ago that is the wrong half.

The source is `ImportedFile`, which already records what was imported, into
which collection, and what became of it. What it does not record is the hash,
the real type, or which door the file came through. The first two are recovered
by reading the file where it still exists; the third is unrecoverable and is
recorded as `legacy` rather than guessed.

Idempotent by construction: a file already carrying an `ingested_files` row is
skipped, so the pass can run at every startup and be interrupted at any point.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ...config import settings
from ...models.case import Case
from ...models.ez_artifacts import ImportedFile
from ...models.ingest import (
    DETECTED_BY_EXTENSION,
    ORIGIN_LEGACY,
    STATE_DISCOVERED,
    STATE_FAILED,
    STATE_INDEXED,
    STATE_UNSUPPORTED,
    IngestedFile,
)
from .identify import identify
from .service import compute_sha256

#: `ImportedFile.status` to pipeline state. The old vocabulary was four values
#: for a process that has ten; mapping is lossy in one direction only, which is
#: acceptable because nothing reads the old column any more.
_STATUS_TO_STATE = {
    "imported":    STATE_INDEXED,
    "error":       STATE_FAILED,
    "unsupported": STATE_UNSUPPORTED,
    "pending":     STATE_DISCOVERED,
}


def _extracted_path(case_id: str, collection_id: str, filename: str) -> Path:
    """Where the collection importer put this file."""
    return (settings.case_data_path / "cases" / case_id / "collections"
            / collection_id / "extracted" / filename)


def backfill_case(db: Session, case_id: str, commit: bool = True) -> int:
    """
    Write the missing `ingested_files` rows for one case. Returns how many.

    Files whose bytes are gone - collections expire after 90 days - still get a
    row. The record that a file was ingested is itself evidence about the
    investigation, and losing it because the artifact was cleaned up would
    defeat the purpose of the table.
    """
    existing = {
        (row.collection_id, row.original_name)
        for row in db.query(IngestedFile.collection_id, IngestedFile.original_name)
                     .filter(IngestedFile.case_id == case_id).all()
    }

    written = 0
    for old in db.query(ImportedFile).filter(ImportedFile.case_id == case_id).all():
        name = Path(old.filename).name
        if (old.collection_id, name) in existing:
            continue

        # str() around the legacy columns: `ImportedFile` is declared with bare
        # `Column()`, so mypy sees the class-level `Column[str]` rather than the
        # `str` the instance actually holds. A no-op at runtime.
        path = _extracted_path(case_id, str(old.collection_id), str(old.filename))
        row = IngestedFile(
            id=str(uuid.uuid4()),
            case_id=case_id,
            collection_id=old.collection_id,
            original_name=name,
            stored_path=str(path) if path.exists() else None,
            size_bytes=old.file_size or 0,
            origin=ORIGIN_LEGACY,
            origin_detail="imported before the ingestion pipeline",
            state=_STATUS_TO_STATE.get(str(old.status or ""), STATE_DISCOVERED),
            error=old.error_message,
            parsed_artifact_id=old.csv_artifact_id,
            created_at=old.imported_at or datetime.utcnow(),
        )

        if path.exists():
            # Read the real bytes rather than trusting the recorded category:
            # the old detection matched on filename, so its answer is exactly
            # the thing this pipeline exists to stop believing.
            try:
                row.sha256 = compute_sha256(path)
            except OSError:
                pass
            found = identify(path, name=name)
            row.detected_kind    = found.kind
            row.magic_type       = found.label
            row.detection_source = found.source
        else:
            # Nothing to read. The old category is a weaker answer than a
            # signature, and it is labelled as such so it can be overridden.
            row.detected_kind    = old.category
            row.magic_type       = old.category_label
            row.detection_source = DETECTED_BY_EXTENSION if old.category else None
            row.error = row.error or "Original file is no longer on disk"

        db.add(row)
        written += 1

    if commit and written:
        db.commit()
    return written


def backfill_all(db: Session) -> int:
    """Run the pass over every case. Safe to call on every startup."""
    total = 0
    for case in db.query(Case).all():
        try:
            total += backfill_case(db, str(case.id))
        except Exception as e:
            # One unreadable case must not stop the rest, and must never stop
            # the application from starting.
            db.rollback()
            print(f"[ingest] backfill failed for case {case.id}: {e}", flush=True)
    return total
