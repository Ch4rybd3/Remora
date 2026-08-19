from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from ..database import Base


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    event_ts = Column(DateTime, nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    actor = Column(String(255), default="")
    source = Column(String(255), default="")
    tags = Column(Text, default="")

    # Provenance of the event — drives the badge shown in the Timeline tab.
    #   manual       — typed by hand in the Timeline tab
    #   incident_log — dual-written from an IncidentLogEntry
    #   artifact     — exported from the Artifact Explorer pinned panel
    #   ioc          — derived from an IOC
    origin = Column(String(32), default="manual", nullable=False)
    # Full untouched source record (JSON object of column -> value), shown
    # under a chevron so it never pollutes title/description, which stay
    # freely editable by the analyst.
    raw_payload = Column(Text, nullable=True)
    # Human-readable pointer back to where raw_payload came from
    # (e.g. "EVTX Security.evtx" or "MFT $MFT_Output.csv").
    raw_source = Column(String(512), default="")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    case = relationship("Case", back_populates="timeline")
