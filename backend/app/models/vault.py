from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime, timezone

from ..database import Base


class Vault(Base):
    __tablename__ = "vaults"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(255), nullable=False)
    description = Column(Text, default="")
    tags        = Column(Text, default="")          # comma-separated
    file_path   = Column(String, nullable=False)    # absolute path on disk
    file_name   = Column(String(255), nullable=False)  # original filename
    file_size   = Column(Integer, default=0)        # bytes
    mime_type   = Column(String(120), default="")
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    created_by  = Column(String(100), nullable=True)
