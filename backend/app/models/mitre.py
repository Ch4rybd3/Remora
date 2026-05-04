import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, UniqueConstraint, ForeignKey
from app.database import Base


class CaseTTP(Base):
    """One MITRE ATT&CK technique associated with a case."""
    __tablename__ = "case_ttps"

    id             = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id        = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)

    # ATT&CK identifiers
    technique_id   = Column(String(32),  nullable=False)   # T1078 or T1078.001
    technique_name = Column(String(512), nullable=True)
    tactic         = Column(String(128), nullable=True)    # initial-access (ATT&CK short_name)
    tactic_name    = Column(String(128), nullable=True)    # Initial Access (display name)

    # Analyst metadata
    color   = Column(String(16), nullable=True)  # hex e.g. #4ade80
    score   = Column(Integer,    nullable=True)  # 0-100
    comment = Column(Text,       nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # One row per (case, technique, tactic) so a technique that spans
        # multiple tactics (e.g. T1078) can be independently toggled per column.
        UniqueConstraint("case_id", "technique_id", "tactic", name="uq_case_ttp"),
    )
