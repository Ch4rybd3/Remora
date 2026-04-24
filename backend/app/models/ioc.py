from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
import enum

from ..database import Base


class IOCType(str, enum.Enum):
    # Network
    ip = "ip"
    domain = "domain"
    url = "url"
    asn = "asn"
    # File
    hash_md5 = "hash_md5"
    hash_sha1 = "hash_sha1"
    hash_sha256 = "hash_sha256"
    filename = "filename"
    certificate = "certificate"
    # Email
    email = "email"
    email_subject = "email_subject"
    sender_name = "sender_name"
    # System
    registry = "registry"
    user_agent = "user_agent"
    # Identity
    phone = "phone"
    # Other
    other = "other"


class IOCConfidence(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class IOC(Base):
    __tablename__ = "iocs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    type = Column(SAEnum(IOCType), nullable=False)
    value = Column(String(2048), nullable=False)
    description = Column(Text, default="")
    tags = Column(Text, default="")
    confidence = Column(SAEnum(IOCConfidence), default=IOCConfidence.medium)
    tlp = Column(String(20), default="TLP:AMBER")
    first_seen = Column(DateTime, nullable=True)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    case = relationship("Case", back_populates="iocs")
