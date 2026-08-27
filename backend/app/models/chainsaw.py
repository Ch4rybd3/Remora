import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class ChainsawScan(Base):
    """One Chainsaw scan run against one EVTX file."""
    __tablename__ = "chainsaw_scans"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    file_id     = Column(String, ForeignKey("evtx_files.id",  ondelete="CASCADE"), nullable=False, index=True)
    case_id     = Column(String, ForeignKey("cases.id",        ondelete="CASCADE"), nullable=False, index=True)
    status      = Column(String(16), nullable=False, default="pending")  # pending|scanning|ready|error
    alert_count = Column(Integer, nullable=True)
    error_msg   = Column(Text,    nullable=True)
    scanned_at  = Column(DateTime, nullable=True)
    created_at  = Column(DateTime, default=lambda: datetime.now(UTC))

    alerts = relationship(
        "ChainsawAlert", back_populates="scan",
        cascade="all, delete-orphan", lazy="dynamic",
    )


class ChainsawAlert(Base):
    """One Sigma rule match returned by a Chainsaw scan."""
    __tablename__ = "chainsaw_alerts"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    scan_id      = Column(String, ForeignKey("chainsaw_scans.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id      = Column(String, ForeignKey("evtx_files.id",    ondelete="CASCADE"), nullable=False)
    case_id      = Column(String, ForeignKey("cases.id",          ondelete="CASCADE"), nullable=False, index=True)

    # Sigma rule metadata
    rule_name    = Column(String(512), nullable=False, index=True)
    level        = Column(String(32),  nullable=True, index=True)   # critical/high/medium/low/informational
    sigma_status = Column(String(32),  nullable=True)               # stable/test/experimental
    group_name   = Column(String(255), nullable=True)
    tags         = Column(Text, nullable=True)                      # comma-separated
    authors      = Column(Text, nullable=True)

    # Event fields
    timestamp  = Column(DateTime, nullable=True, index=True)
    event_id   = Column(Integer,  nullable=True)
    channel    = Column(String(255), nullable=True)
    computer   = Column(String(255), nullable=True)
    provider   = Column(String(512), nullable=True)
    event_data = Column(JSON, nullable=True)   # all EventData/UserData fields

    added_to_timeline = Column(Boolean, default=False, nullable=False)

    scan = relationship("ChainsawScan", back_populates="alerts")

    __table_args__ = (
        Index("ix_chainsaw_alerts_case_ts",    "case_id", "timestamp"),
        Index("ix_chainsaw_alerts_case_level", "case_id", "level"),
        Index("ix_chainsaw_alerts_scan_level", "scan_id", "level"),
    )


class ChainsawCaseSelection(Base):
    """Persists the analyst's pinned Chainsaw alert selection per case (one row per case)."""
    __tablename__ = "chainsaw_case_selections"

    case_id    = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    alert_ids  = Column(JSON, nullable=False, default=list)   # list[str] of alert UUIDs
    sent_ids   = Column(JSON, nullable=False, default=list)   # alert UUIDs already pushed to timeline
    updated_at = Column(DateTime,
                        default=lambda:  datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC),
                        nullable=False)
