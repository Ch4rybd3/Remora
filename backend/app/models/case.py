from sqlalchemy import Column, String, Text, DateTime, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from ..database import Base


class CaseStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    closed = "closed"
    archived = "archived"


class CaseSeverity(str, enum.Enum):
    informational = "informational"
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class Case(Base):
    __tablename__ = "cases"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    status = Column(SAEnum(CaseStatus), default=CaseStatus.open, nullable=False)
    severity = Column(SAEnum(CaseSeverity), default=CaseSeverity.medium, nullable=False)
    tags = Column(Text, default="")  # comma-separated
    template_id = Column(String, nullable=True)
    assigned_to = Column(String(255), default="")
    tlp = Column(String(10), default="TLP:AMBER")

    executive_summary = Column(Text, default="")
    quick_notes = Column(Text, default="")
    report = Column(Text, default="")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))
    closed_at = Column(DateTime, nullable=True)

    iocs = relationship("IOC", back_populates="case", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="case", cascade="all, delete-orphan")
    evidences = relationship("Evidence", back_populates="case", cascade="all, delete-orphan")
    timeline = relationship("TimelineEvent", back_populates="case",
                            cascade="all, delete-orphan", order_by="TimelineEvent.event_ts")
    evtx_files = relationship("EvtxFile", back_populates="case", cascade="all, delete-orphan")
    ttps = relationship("CaseTTP", cascade="all, delete-orphan",
                        foreign_keys="CaseTTP.case_id",
                        order_by="CaseTTP.tactic, CaseTTP.technique_id")
