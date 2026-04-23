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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    case = relationship("Case", back_populates="timeline")
