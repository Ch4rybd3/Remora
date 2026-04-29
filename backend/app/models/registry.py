from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from ..database import Base


class RegistryFile(Base):
    """One uploaded RECmd / Registry Explorer CSV export per case."""
    __tablename__ = "registry_files"

    id            = Column(String(36),  primary_key=True)
    case_id       = Column(String,      ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    filename      = Column(String(255), nullable=False)
    file_path     = Column(Text,        nullable=False)   # path to the original CSV
    duckdb_path   = Column(Text,        nullable=True)    # path to the per-file DuckDB
    hive_type     = Column(String(32),  nullable=False, default="GENERIC")  # NTUSER | SYSTEM | … | BATCH
    # pending | parsing | ready | error
    status        = Column(String(16),  nullable=False, default="pending")
    entry_count   = Column(Integer,     nullable=True)
    error_msg     = Column(Text,        nullable=True)
    uploaded_at   = Column(DateTime,    nullable=False, default=lambda: datetime.now(timezone.utc))
    parsed_at     = Column(DateTime,    nullable=True)
    added_to_evidence      = Column(Boolean, nullable=False, default=False)
    parse_progress         = Column(Integer, nullable=False, default=0, server_default="0")
    parse_duration_seconds = Column(Integer, nullable=True)
    columns_json           = Column(Text,    nullable=True)  # JSON list of original CSV column names
