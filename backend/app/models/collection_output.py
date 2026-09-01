"""
What a collection produced.

Ingesting a collection creates records in other modules - a table in the
Artifact Explorer, a file in the Logs module, a capture in PCAP - and until
this table existed nothing recorded that it had. Deleting the collection
removed the directory and the ingest rows, and left every record it had
created behind, pointing at bytes that were no longer there.

So each registration appends a row here. The collection now knows what it
produced, which makes three things possible: deleting it cleanly, showing the
analyst what deletion will remove before they confirm, and answering "where did
this table come from?" from the table's own side.

Deliberately **not** a foreign key to the record it names. The rows point into
five different tables, and a polymorphic reference is the honest shape for
that. The trade-off is that a dangling row is possible; deletion treats a
record that has already gone as done rather than as an error.

See `docs/INGESTION.md` section 15.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ─── Output kinds ─────────────────────────────────────────────────────────────
# One value per destination module. The deletion service holds a resolver per
# kind; a kind with no resolver deletes the file and leaves the record, which
# is the safe direction to fail in.

OUTPUT_CSV_ARTIFACT = "csv_artifact"   # a table in the Artifact Explorer
OUTPUT_EVTX_FILE    = "evtx_file"      # a file in the Logs module
OUTPUT_EMAIL_FILE   = "email_file"     # a message in Email Analysis
OUTPUT_MEMORY_DUMP  = "memory_dump"    # an image in the Memory module

ALL_OUTPUT_KINDS = frozenset({
    OUTPUT_CSV_ARTIFACT, OUTPUT_EVTX_FILE, OUTPUT_EMAIL_FILE, OUTPUT_MEMORY_DUMP,
})


class CollectionOutput(Base):
    """One record some module holds because a collection was ingested."""

    __tablename__ = "collection_outputs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)

    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)

    collection_id: Mapped[str] = mapped_column(
        String, ForeignKey("imported_collections.id", ondelete="CASCADE"),
        nullable=False, index=True)

    #: One of the OUTPUT_* constants above.
    kind: Mapped[str] = mapped_column(String, nullable=False)

    #: Primary key in the destination table. Not a foreign key - see the module
    #: docstring.
    record_id: Mapped[str] = mapped_column(String, nullable=False)

    #: Absolute path of the bytes the record reads, when it has any. Recorded
    #: separately because deleting the row does not delete the file, and a
    #: parser's CSV output is not reachable from the collection directory once
    #: the record naming it is gone.
    file_path: Mapped[str | None] = mapped_column(String, nullable=True)

    #: The `ingested_files` or `imported_files` row this came from, when the
    #: caller knows it. Deletion consults it: an artifact whose source has been
    #: preserved in the chain of custody survives the collection.
    source_file_id: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)

    __table_args__ = (
        # Deletion asks for one collection's outputs and nothing else asks
        # anything, so the collection index above carries the only query.
        # This one exists for the reverse question - "which collection produced
        # this table?" - which the Explorer will want when it shows provenance.
        Index("ix_collection_outputs_record", "kind", "record_id"),
    )
