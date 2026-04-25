from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, Index
from app.database import Base


class ReportVersion(Base):
    """Immutable snapshot of a case report, created on every save."""
    __tablename__ = "report_versions"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    case_id    = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    version    = Column(Integer, nullable=False)          # monotonic per case (1, 2, 3…)
    content    = Column(Text,    nullable=False)
    line_count = Column(Integer, nullable=False, default=0)
    created_by = Column(String(64), nullable=True)        # username
    created_at = Column(DateTime,
                        default=lambda: datetime.now(timezone.utc),
                        nullable=False)

    __table_args__ = (
        Index("ix_report_versions_case", "case_id"),
    )
