import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, DateTime, Integer, Text, JSON, Boolean, ForeignKey, Index,
)
from sqlalchemy.orm import relationship
from app.database import Base


class MemoryDump(Base):
    """One memory dump file per upload."""
    __tablename__ = "memory_dumps"

    id           = Column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id      = Column(String,  ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    filename     = Column(String(512),  nullable=False)
    file_path    = Column(String(1024), nullable=False)
    os_type      = Column(String(16),   nullable=False)   # "windows" | "linux"
    symbols_path = Column(String(1024), nullable=True)    # optional ISF / symbol dir
    file_size    = Column(Integer,  nullable=True)
    status       = Column(String(32), default="uploaded") # uploaded | analyzing | done | error
    error_msg    = Column(Text,     nullable=True)
    uploaded_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    plugins = relationship(
        "MemoryPluginResult",
        back_populates="dump",
        cascade="all, delete-orphan",
        lazy="dynamic",
        order_by="MemoryPluginResult.id",
    )

    __table_args__ = (
        Index("ix_memory_dump_case_id", "case_id"),
    )


class MemoryPluginResult(Base):
    """Result of one volatility3 plugin run against a dump."""
    __tablename__ = "memory_plugin_results"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    dump_id      = Column(String,  ForeignKey("memory_dumps.id", ondelete="CASCADE"), nullable=False)
    plugin_name  = Column(String(128), nullable=False)   # e.g. "windows.pslist"
    plugin_args  = Column(JSON,    nullable=True)         # extra CLI args dict
    status       = Column(String(32), default="pending")  # pending|running|done|error
    output       = Column(Text,    nullable=True)
    error        = Column(Text,    nullable=True)
    started_at   = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    is_custom    = Column(Boolean,  default=False)        # True = user-initiated run

    dump = relationship("MemoryDump", back_populates="plugins")

    __table_args__ = (
        Index("ix_mem_plugin_dump_id",    "dump_id"),
        Index("ix_mem_plugin_name",       "plugin_name"),
        Index("ix_mem_plugin_is_custom",  "is_custom"),
    )
