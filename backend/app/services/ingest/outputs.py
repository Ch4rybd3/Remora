"""
Recording what an ingest produced, so a collection can be undone.

One call per registration. The handlers in `dispatch.py` and the batch stage
both go through here rather than writing the row themselves, so a new
destination cannot be added without the deletion path learning about it - the
failure mode this replaces was silent, and looked exactly like success.

A record with no collection is not an error. Files reach a case through doors
that are not collections - the evidence uploader, a connector - and those are
not undone by deleting a collection because no collection created them.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ...models.collection_output import CollectionOutput

logger = logging.getLogger("remora.ingest.outputs")


def record(
    db: Session,
    *,
    case_id: str,
    collection_id: str | None,
    kind: str,
    record_id: str | None,
    file_path: str | None = None,
    source_file_id: str | None = None,
) -> None:
    """
    Note that `collection_id` produced `record_id` in the module `kind`.

    Never raises. Provenance failing to write must not fail the ingest that
    produced it - the artifact is more valuable than the note about it - but it
    is logged, because a collection that cannot be deleted cleanly later is a
    problem an operator should be able to trace back to here.
    """
    if not collection_id or not record_id:
        return
    try:
        db.add(CollectionOutput(
            case_id=case_id,
            collection_id=collection_id,
            kind=kind,
            record_id=str(record_id),
            file_path=file_path,
            source_file_id=source_file_id,
        ))
    except Exception as e:                                    # pragma: no cover
        logger.warning("could not record %s output %s: %s", kind, record_id, e)
