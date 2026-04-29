from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, JSON
from app.database import Base


class ReportDocTemplate(Base):
    """Document report templates (DOCX or Markdown) with {{tag}} placeholders."""
    __tablename__ = "report_doc_templates"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(String(255), nullable=False)
    description   = Column(String(500), default="")
    format        = Column(String(10),  nullable=False)   # 'docx' | 'markdown'
    file_path     = Column(String(1024), nullable=False)  # absolute path on disk
    file_size     = Column(Integer, default=0)
    tags_detected = Column(JSON, default=list)             # list of {{tags}} found
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    created_by    = Column(String(64), nullable=True)
