from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String

from app.database import Base


class AttackGraph(Base):
    """One attack graph per case — case_id is the PK."""
    __tablename__ = "attack_graphs"

    case_id    = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    nodes      = Column(JSON, nullable=False, default=list)
    edges      = Column(JSON, nullable=False, default=list)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
