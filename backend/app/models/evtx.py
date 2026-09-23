import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class EvtxFileStatus(str, enum.Enum):
    #: Only ever `ready` in practice since the second parse was retired - a
    #: file is scannable the moment its bytes are on disk. The other two are
    #: kept for rows written before that, and for an upload that fails.
    pending = "pending"
    ready   = "ready"
    error   = "error"


class EvtxFile(Base):
    """
    An event log this case holds.

    The registry, not a reader. It records which EVTX files are in the case and
    where their bytes are - which is what Chainsaw scans, since a Sigma run
    reads the file itself rather than a database of it.

    `event_count` and `parsed_at` are vestigial: they were filled by a second
    parse this module no longer performs. Kept because the columns cost
    nothing and a value written before the change is still true about the file
    it describes.
    """
    __tablename__ = "evtx_files"

    id           = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id      = Column(String, ForeignKey("cases.id"), nullable=False, index=True)
    filename     = Column(String(255), nullable=False)
    file_path    = Column(String(1024), nullable=False)   # absolute path on server
    status       = Column(String(16), default="pending", nullable=False)
    event_count  = Column(Integer, nullable=True)
    error_msg    = Column(Text, nullable=True)
    uploaded_at  = Column(DateTime, default=lambda: datetime.now(UTC))
    parsed_at    = Column(DateTime, nullable=True)
    added_to_evidence = Column(Boolean, default=False, nullable=False)

    case = relationship("Case", back_populates="evtx_files")
