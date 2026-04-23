from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from ..database import Base


class Evidence(Base):
    __tablename__ = "evidences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    file_path = Column(String(1024), nullable=True)  # relative to evidence store
    original_filename = Column(String(255), default="")
    file_size = Column(Integer, default=0)
    mime_type = Column(String(128), default="")
    md5_hash = Column(String(32), default="")
    sha256_hash = Column(String(64), default="")
    collected_at = Column(DateTime, nullable=True)
    collected_by = Column(String(255), default="")
    chain_of_custody = Column(Text, default="")
    tags = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    case = relationship("Case", back_populates="evidences")
