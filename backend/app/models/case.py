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
    #: Every section concatenated, in template order. What `{{report_content}}`
    #: injects and what a version snapshot stores - derived from the sections
    #: on every save, never edited directly.
    report = Column(Text, default="")

    #: The report itself: a JSON dict of {slug: markdown}, one entry per
    #: section the case template declares.
    #:
    #: There used to be three fixed columns beside this one, and the Report tab
    #: chose between them and this depending on whether the template declared
    #: sections - so one case could hold content in two shapes and the exporter
    #: had four tags for the same material. See services/report_service.py.
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
    # Deleting a case drops its claim on an image, never the image itself: the
    # bytes sit on a mounted volume this application does not own.
    disk_images = relationship("DiskImage", back_populates="case",
                               cascade="all, delete-orphan",
                               order_by="DiskImage.name")
    ttps = relationship("CaseTTP", cascade="all, delete-orphan",
                        foreign_keys="CaseTTP.case_id",
                        order_by="CaseTTP.tactic, CaseTTP.technique_id")
