from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from ..database import Base


class BinaryFile(Base):
    """One uploaded binary file per case — stored encrypted at rest."""
    __tablename__ = "binary_files"

    id          = Column(String(36),  primary_key=True)
    case_id     = Column(String,      ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    filename    = Column(String(255), nullable=False)
    enc_path    = Column(Text,        nullable=False)    # path to .enc file on disk (never executed)
    salt_hex    = Column(String(64),  nullable=False)    # PBKDF2 salt, stored as hex
    sha256_hash = Column(String(64),  nullable=True)     # SHA-256 of the original file
    file_size   = Column(Integer,     nullable=True)     # size in bytes of original file
    binary_type = Column(String(16),  nullable=True)     # PE | ELF | MachO | unknown
    # pending | analysing | ready | error
    status      = Column(String(16),  nullable=False, default="pending")
    error_msg   = Column(Text,        nullable=True)
    analysis_json = Column(Text,      nullable=True)     # full analysis result (JSON)
    uploaded_at   = Column(DateTime,  nullable=False, default=lambda: datetime.now(UTC))
    analysed_at   = Column(DateTime,  nullable=True)
    added_to_evidence = Column(Boolean, nullable=False, default=False)
