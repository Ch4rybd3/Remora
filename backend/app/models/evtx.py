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
    parsing  = "parsing"
    ready    = "ready"
    error    = "error"


class EvtxFile(Base):
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
    Persists the analyst's pinned-event selection for a case in the
    Filesystem & Logs page.  One row per case (upserted on every save).

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
