from __future__ import annotations


from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from ..database import Base


class ConnectorConfig(Base):
    """One record per external connector (VirusTotal, AbuseIPDB, MISP, …)."""
    __tablename__ = "connector_configs"

    id         = Column(Integer,     primary_key=True, autoincrement=True)
    name       = Column(String(64),  nullable=False, unique=True)   # slug: 'virustotal'
    api_key    = Column(Text,        nullable=True)
    base_url   = Column(String(512), nullable=True)                 # for self-hosted (MISP)
    enabled    = Column(Boolean,     nullable=False, default=True)
    updated_at = Column(DateTime,    nullable=True)
    updated_by = Column(String(100), nullable=True)
