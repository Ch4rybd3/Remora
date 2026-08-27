import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from ..database import Base


class IncidentLogEntry(Base):
    """Main courante — chronological, client-shareable log of analyst actions.

    Every entry is dual-written: it lives here (for the exportable incident
    log) AND as a TimelineEvent (for the consolidated case timeline). The
    optional `timeline_event_id` links the two so edits/deletes can stay
    in sync.
    """
    __tablename__ = "incident_log_entries"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    timeline_event_id = Column(String, ForeignKey("timeline_events.id", ondelete="SET NULL"), nullable=True)

    event_ts = Column(DateTime, nullable=False)
    category = Column(String(50), default="remediation")  # remediation | handover | communication | investigation | other
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    actor = Column(String(255), default="")

    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    case = relationship("Case", back_populates="incident_log")
