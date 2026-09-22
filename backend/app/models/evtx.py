import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class EvtxFileStatus(str, enum.Enum):
    pending  = "pending"
    #: Retired with the module's second parse. Rows written before that may
    #: still carry it; nothing sets it any more.
    parsing  = "parsing"
    ready    = "ready"
    error    = "error"


class EvtxFile(Base):
    """
    An event log this case holds.

    The registry, not a reader. It records which EVTX files are in the case and
    where their bytes are - which is what Chainsaw scans, since a Sigma run
    reads the file itself rather than a database of it.

    `event_count` and `parsed_at` were filled by a second parse this module no
    longer performs. They are kept because rows written before that carry real
    values, and a column removed is a column that cannot be looked back at.
    """
    __tablename__ = "evtx_files"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id      = Column(String, ForeignKey("cases.id"), nullable=False, index=True)
    filename     = Column(String(255), nullable=False)
    file_path    = Column(String(1024), nullable=False)   # absolute path on server
    status       = Column(String(16), default="pending", nullable=False)
    event_count  = Column(Integer, nullable=True)
    error_msg    = Column(Text, nullable=True)
    uploaded_at  = Column(DateTime, default=lambda: datetime.now(UTC))
    parsed_at    = Column(DateTime, nullable=True)
    added_to_evidence = Column(Boolean, default=False, nullable=False)

    case   = relationship("Case",      back_populates="evtx_files")
    events = relationship("EvtxEvent", back_populates="evtx_file",
                          cascade="all, delete-orphan", lazy="dynamic")


class EvtxEvent(Base):
    """
    Records from the module's own parse of an EVTX. **No longer written.**

    The Logs module parsed every event log a second time and stored the
    records here, while EvtxECmd had already parsed the same file into the
    Artifact Explorer during ingestion. Two parses of one file, and two tables
    that could disagree. The Explorer's is the one that stayed.

    The table is kept rather than dropped. Nothing writes it and nothing reads
    it, but it holds records from real collections, the source EVTX may since
    have been removed from the case, and destroying forensic records is not a
    side effect a refactor gets to have. Dropping it is a separate decision
    with its own migration.
    """
    __tablename__ = "evtx_events"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    file_id        = Column(String, ForeignKey("evtx_files.id"), nullable=False)
    record_id      = Column(Integer, nullable=True)
    time_created   = Column(DateTime, nullable=True)
    event_id       = Column(Integer, nullable=True, index=True)
    level          = Column(Integer, nullable=True)
    level_name     = Column(String(32), nullable=True)
    channel        = Column(String(255), nullable=True)
    provider       = Column(String(512), nullable=True)
    computer       = Column(String(255), nullable=True)
    user_id        = Column(String(64), nullable=True)
    event_data     = Column(JSON, nullable=True)
    # Flattened string of all event_data values — used for LIKE-based search
    searchable_text = Column(Text, nullable=True)

    evtx_file = relationship("EvtxFile", back_populates="events")

    __table_args__ = (
        Index("ix_evtx_events_file_time",    "file_id", "time_created"),
        Index("ix_evtx_events_file_channel", "file_id", "channel"),
        Index("ix_evtx_events_file_eid",     "file_id", "event_id"),
        Index("ix_evtx_events_file_level",   "file_id", "level"),
    )


class EvtxCaseSelection(Base):
    """
    Events an analyst pinned in the Logs page. **No longer written.**

    Pinning lives in the Artifact Explorer now. This table is kept for a
    stronger reason than `evtx_events`: those were a machine re-parse, these
    are a person's judgement about which events mattered. Anything already
    sent to the case timeline is there; the rest is work that exists nowhere
    else, and it is not this refactor's to discard.

    events   – JSON array of full event objects (EvtxEvent fields + _filename).
    sent_ids – JSON array of event IDs (int) already pushed to the case timeline.
    """
    __tablename__ = "evtx_case_selections"

    case_id    = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    events     = Column(JSON, nullable=False, default=list)
    sent_ids   = Column(JSON, nullable=False, default=list)
    updated_at = Column(DateTime,
                        default=lambda: datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC),
                        nullable=False)
