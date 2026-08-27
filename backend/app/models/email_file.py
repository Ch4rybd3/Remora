import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from ..database import Base


class EmailFile(Base):
    __tablename__ = "email_files"

    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id     = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    filename    = Column(String(255), nullable=False)
    analysis    = Column(Text, nullable=False)   # JSON EmailAnalysisResult
    warning_count = Column(Integer, default=0)   # cached for list view
    uploaded_at = Column(DateTime, default=lambda: datetime.now(UTC))
