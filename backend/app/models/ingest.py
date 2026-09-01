"""
Provenance for everything that enters a case.

One row per file the ingestion pipeline has seen, whatever door it came
through. This is the single answer to "what has been ingested into this case,
where did it come from, and what did we decide it was?" — a question the
fourteen independent upload endpoints could not answer between them.

Written with SQLAlchemy 2.0's `Mapped` annotations rather than the bare
`Column()` the older models use. That is not a style preference: `Column()`
leaves mypy seeing `Column[str]` where the code assigns a `str`, and the
type-checking ratchet in `pyproject.toml` forbids adding new modules to the
exemption list. Annotated columns type-check as what they actually hold.

See `docs/INGESTION.md` sections 2 and 4.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ─── States ───────────────────────────────────────────────────────────────────
# The pipeline is a state machine, not a boolean. `docs/INGESTION.md` section 4
# holds the diagram; the design rule it encodes is that **no state discards the
# file**. Unrecognised input is a soft signal, never an error.

STATE_DISCOVERED   = "discovered"      # seen, stable, not yet read
STATE_HASHED       = "hashed"          # SHA-256 computed
STATE_DUPLICATE    = "duplicate"       # hash already in this case. Terminal.
STATE_IDENTIFIED   = "identified"      # type determined
STATE_UNIDENTIFIED = "unidentified"    # no signature matched. Recoverable.
STATE_ROUTED       = "routed"          # destination chosen, record created
STATE_PARSED       = "parsed"          # converted to tabular form
STATE_INDEXED      = "indexed"         # queryable in the Artifact Explorer
# Stored, and a module opens it as it stands - no table, and none wanted. A
# registry hive is the case this exists for: `SOFTWARE` holds thousands of
# unrelated facts and which of them matter is an analyst's decision, so Remora
# supplies the navigation instead of the conclusions. Reporting that as
# `unsupported` said the pipeline had no answer when it had a better one than a
# table would have been. Terminal.
STATE_BROWSABLE    = "browsable"
STATE_FAILED       = "failed"          # parser crashed / timed out. Recoverable.
STATE_UNSUPPORTED  = "unsupported"     # known type, no handler yet

#: States a file will never leave without an analyst acting on it.
TERMINAL_STATES = frozenset({
    STATE_DUPLICATE, STATE_INDEXED, STATE_BROWSABLE, STATE_UNSUPPORTED,
})

#: States the Collection tab offers an action for: force a type, retry.
RECOVERABLE_STATES = frozenset({STATE_UNIDENTIFIED, STATE_FAILED})

ALL_STATES = frozenset({
    STATE_DISCOVERED, STATE_HASHED, STATE_DUPLICATE, STATE_IDENTIFIED,
    STATE_UNIDENTIFIED, STATE_ROUTED, STATE_PARSED, STATE_INDEXED,
    STATE_BROWSABLE, STATE_FAILED, STATE_UNSUPPORTED,
})

# ─── Origins ──────────────────────────────────────────────────────────────────
# How the bytes reached the drop folder. Every value lands in the same folder
# and goes through the same service; this records only which door was used.

ORIGIN_DROPZONE  = "dropzone"   # copied onto the host: cp, scp, rsync, a mount
ORIGIN_UPLOAD    = "upload"     # the Collection tab's drop area
ORIGIN_ARCHIVE   = "archive"    # unpacked from a container already ingested
ORIGIN_CONNECTOR = "connector"  # pulled by an integration
# Ingested before this table existed, by one of the fourteen upload endpoints.
# Which door it used was never recorded, and inventing an answer would be
# fabricating provenance in a tool whose output is meant to survive scrutiny.
# "We do not know" is the only honest value, so it is a value.
ORIGIN_LEGACY    = "legacy"

ALL_ORIGINS = frozenset({
    ORIGIN_DROPZONE, ORIGIN_UPLOAD, ORIGIN_ARCHIVE, ORIGIN_CONNECTOR,
    ORIGIN_LEGACY,
})

# ─── Detection sources ────────────────────────────────────────────────────────
# Recorded because they are not equally trustworthy. A file identified by
# `extension` is a guess an analyst may need to override; one identified by
# `magic` is not.

DETECTED_BY_MAGIC     = "magic"        # byte signature
DETECTED_BY_EXTENSION = "extension"    # filename suffix, no signature matched
DETECTED_BY_HINT      = "folder_hint"  # the evtx/ or registry/ sub-folder
DETECTED_BY_CONTENT   = "content"      # text-shape heuristic (CSV vs JSON vs log)
DETECTED_BY_FORCED    = "forced"       # an analyst said so. Outranks everything.


class IngestedFile(Base):
    """One file seen by the ingestion pipeline."""

    __tablename__ = "ingested_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)

    # No index=True: `ix_ingested_files_case_sha` leads on case_id and SQLite
    # uses its leftmost prefix for a plain case lookup. A third index on the
    # same leading column would only cost writes.
    case_id: Mapped[str] = mapped_column(
        String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)

    # Groups a batch, or an archive and everything unpacked out of it, into one
    # logical import. Nullable while the legacy Collection Import still owns
    # some ingests (`docs/INGESTION.md` section 14, step 1).
    collection_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("imported_collections.id", ondelete="CASCADE"),
        nullable=True, index=True)

    # An archive member points at the container it came out of, so a whole
    # import traces back to the one file the analyst actually dropped.
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("ingested_files.id", ondelete="CASCADE"),
        nullable=True, index=True)

    original_name: Mapped[str]         = mapped_column(String, nullable=False)
    stored_path:   Mapped[str | None]  = mapped_column(String, nullable=True)
    size_bytes:    Mapped[int]         = mapped_column(BigInteger, default=0)

    origin:        Mapped[str]         = mapped_column(
        String, nullable=False, default=ORIGIN_DROPZONE)
    origin_detail: Mapped[str | None]  = mapped_column(String, nullable=True)

    # Indexed on its own as well as with the case: deduplication is per case,
    # but "where else has this exact file been seen?" is worth being able to
    # answer across an installation, and the composite cannot serve it.
    sha256: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    magic_type:       Mapped[str | None] = mapped_column(String, nullable=True)
    detected_kind:    Mapped[str | None] = mapped_column(String, nullable=True)
    detection_source: Mapped[str | None] = mapped_column(String, nullable=True)

    # IANA name. UTC is a default, not a fact — hence the warning the Collection
    # tab shows when a collection is left at the default and its parser produced
    # naive timestamps (`docs/INGESTION.md` section 8).
    source_timezone: Mapped[str] = mapped_column(String, default="UTC")

    # Likewise covered by `ix_ingested_files_case_state`. Alone, state has ten
    # possible values and no planner would choose an index over a scan.
    state: Mapped[str]        = mapped_column(
        String, nullable=False, default=STATE_DISCOVERED)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    routed_to:          Mapped[str | None] = mapped_column(String, nullable=True)
    parsed_artifact_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Set once the file has been preserved in the chain of custody. Its
    # presence is what exempts the file from the 90-day collection expiry:
    # a preserved copy lives in the evidence store, which nothing expires.
    # The constraint is named: SQLite's batch migration cannot drop an unnamed
    # one, so an anonymous foreign key here makes the downgrade unrunnable.
    evidence_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("evidences.id", ondelete="SET NULL",
                   name="fk_ingested_files_evidence_id"),
        nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # Deduplication is per case: the same EVTX legitimately belongs to two
        # different investigations, and blocking it globally would corrupt the
        # second one. Not unique — a duplicate is recorded rather than refused,
        # so the analyst can see that they dropped it twice.
        Index("ix_ingested_files_case_sha", "case_id", "sha256"),
        Index("ix_ingested_files_case_state", "case_id", "state"),
    )
