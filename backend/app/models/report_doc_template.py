from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, Integer, String

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
    #: Which design the annex tables of this template resolve to - the name of
    #: a table style in the document, or null for Remora's own rendering.
    #: Recorded at upload so a misspelt `Remora Annex` is visible on the card
    #: instead of silently falling back at export time.
    annex_style   = Column(String(255), nullable=True)
    created_at    = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    created_by    = Column(String(64), nullable=True)
