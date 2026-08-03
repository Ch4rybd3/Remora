from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from datetime import datetime, timezone
import uuid

from ..database import Base


class CsvArtifactFile(Base):
    __tablename__ = "csv_artifact_files"

    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id       = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    original_name = Column(String(255), nullable=False)
    file_path     = Column(String, nullable=False)
    columns       = Column(Text, nullable=False, default="[]")   # JSON list of column names
    row_count     = Column(Integer, default=0)
    date_column     = Column(String(200), nullable=True)           # auto-detected timestamp col
    ez_label        = Column(String(100), nullable=True)           # e.g. "Shimcache (AppCompatCache)"
    ez_category     = Column(String(100), nullable=True)           # internal category key
    source_timezone = Column(String(100), nullable=True)           # IANA tz of raw timestamps (null = UTC)
    uploaded_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    evidence_id     = Column(String, ForeignKey("evidences.id", ondelete="SET NULL"), nullable=True)
