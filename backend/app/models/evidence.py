import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import relationship

from ..database import Base


class EvidenceType(str, enum.Enum):
    malware          = "malware"
    artifact         = "artifact"
    log              = "log"
    memory_dump      = "memory_dump"
    disk_image       = "disk_image"
    network_capture  = "network_capture"
    document         = "document"
    report           = "report"
    other            = "other"


class AcquisitionMethod(str, enum.Enum):
    manual            = "manual"
    forensic_copy     = "forensic_copy"
    live_acquisition  = "live_acquisition"
    logical_copy      = "logical_copy"
    remote_collection = "remote_collection"
    other             = "other"


class Evidence(Base):
    __tablename__ = "evidences"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    file_path = Column(String(1024), nullable=True)  # relative to evidence store
    original_filename = Column(String(255), default="")
    file_size = Column(Integer, default=0)
    mime_type = Column(String(128), default="")
    md5_hash = Column(String(32), default="")
    sha256_hash = Column(String(64), default="")
    evidence_type     = Column(SAEnum(EvidenceType), default=EvidenceType.other, nullable=False)
    source_location   = Column(Text, default="")
    acquisition_method = Column(SAEnum(AcquisitionMethod), default=AcquisitionMethod.manual, nullable=False)
    collected_at      = Column(DateTime, nullable=True)
    collected_by      = Column(String(255), default="")
    chain_of_custody  = Column(Text, default="")
    tags              = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    case = relationship("Case", back_populates="evidences")
