from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer
from datetime import datetime, timezone
import uuid

from ..database import Base


class EmailFile(Base):
    __tablename__ = "email_files"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id     = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    filename    = Column(String(255), nullable=False)
    analysis    = Column(Text, nullable=False)   # JSON EmailAnalysisResult
    warning_count = Column(Integer, default=0)   # cached for list view
    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
