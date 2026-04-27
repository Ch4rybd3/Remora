from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from ..database import Base


class MftFile(Base):
    """One uploaded MFTECmd CSV file per case."""
    __tablename__ = "mft_files"

    id          = Column(String(36),  primary_key=True)
    case_id     = Column(String,      ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    filename    = Column(String(255), nullable=False)
    file_path   = Column(Text,        nullable=False)   # path to the original CSV
    duckdb_path = Column(Text,        nullable=True)    # path to the DuckDB file
    # pending | parsing | ready | error
    status      = Column(String(16),  default="pending", nullable=False)
    entry_count = Column(Integer,     nullable=True)
    error_msg   = Column(Text,        nullable=True)
    uploaded_at = Column(DateTime,    default=lambda: datetime.now(timezone.utc), nullable=False)
    parsed_at   = Column(DateTime,    nullable=True)
    added_to_evidence    = Column(Boolean, default=False,  nullable=False)
    parse_progress       = Column(Integer,  default=0,     nullable=False, server_default="0")
    parse_duration_seconds = Column(Integer, nullable=True)
