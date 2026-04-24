from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, JSON, Index
from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    timestamp     = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    # Who
    username      = Column(String(255), nullable=True)   # None only for system-level events
    user_role     = Column(String(32),  nullable=True)

    # What
    action        = Column(String(64),  nullable=False)  # e.g. "case.create"
    resource_type = Column(String(64),  nullable=True)   # e.g. "case", "ioc"
    resource_id   = Column(String(255), nullable=True)
    resource_name = Column(String(512), nullable=True)   # human-readable label

    # Context
    case_id       = Column(String(255), nullable=True)   # parent case when relevant
    case_title    = Column(String(512), nullable=True)
    details       = Column(JSON,        nullable=True)   # free-form extra info
    ip_address    = Column(String(64),  nullable=True)

    __table_args__ = (
        Index("ix_audit_timestamp",     "timestamp"),
        Index("ix_audit_action",        "action"),
        Index("ix_audit_resource_type", "resource_type"),
        Index("ix_audit_username",      "username"),
        Index("ix_audit_case_id",       "case_id"),
    )
