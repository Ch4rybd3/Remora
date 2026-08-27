import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import relationship

from ..database import Base


class AssetType(str, enum.Enum):
    workstation = "workstation"
    server = "server"
    domain_controller = "domain_controller"
    network_device = "network_device"
    firewall = "firewall"
    vpn = "vpn"
    application = "application"
    database = "database"
    user_account = "user_account"
    service_account = "service_account"
    cloud_resource = "cloud_resource"
    container = "container"
    mobile = "mobile"
    printer = "printer"
    iot = "iot"
    other = "other"


class Asset(Base):
    __tablename__ = "assets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(SAEnum(AssetType), default=AssetType.workstation)
    ip_address = Column(String(45), default="")
    hostname = Column(String(255), default="")
    os = Column(String(255), default="")
    domain = Column(String(255), default="")
    compromised = Column(Boolean, default=False)
    description = Column(Text, default="")
    tags = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    case = relationship("Case", back_populates="assets")
