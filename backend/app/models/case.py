import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import relationship

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


class CaseType(str, enum.Enum):
    ir = "ir"           # Incident Response
    ctf = "ctf"         # Capture The Flag
    pentest = "pentest" # Penetration Test
    sample = "sample"   # Sample / Test


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
    case_type = Column(SAEnum(CaseType), default=CaseType.ir, nullable=False)
    client_name = Column(String(255), default="")  # legacy free-text, kept in sync with client.name
    client_id = Column(String, ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)

    executive_summary = Column(Text, default="")
    quick_notes = Column(Text, default="")
    report = Column(Text, default="")            # legacy combined field — kept for backward compat

    # ── Report sections (split editor) ─────────────────────────────────────────
    report_analysis    = Column(Text, default="")   # Analyse Technique  → {{report_analysis}}
    report_remediation = Column(Text, default="")   # Remédiations       → {{report_remediation}}
    report_conclusion  = Column(Text, default="")   # Conclusion         → {{report_conclusion}}

    # Dynamic per-section content — JSON dict {slug: markdown_text}
    # Used when the case template defines report_sections with explicit tags/slugs.
    report_sections_data = Column(Text, default="{}")

    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC))
    closed_at = Column(DateTime, nullable=True)

    iocs = relationship("IOC", back_populates="case", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="case", cascade="all, delete-orphan")
    evidences = relationship("Evidence", back_populates="case", cascade="all, delete-orphan")
    timeline = relationship("TimelineEvent", back_populates="case",
                            cascade="all, delete-orphan", order_by="TimelineEvent.event_ts")
    incident_log = relationship("IncidentLogEntry", back_populates="case",
                                cascade="all, delete-orphan", order_by="IncidentLogEntry.event_ts")
    client = relationship("Client", back_populates="cases")
    evtx_files = relationship("EvtxFile", back_populates="case", cascade="all, delete-orphan")
    ttps = relationship("CaseTTP", cascade="all, delete-orphan",
                        foreign_keys="CaseTTP.case_id",
                        order_by="CaseTTP.tactic, CaseTTP.technique_id")
