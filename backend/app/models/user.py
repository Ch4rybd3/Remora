from sqlalchemy import Column, String, Boolean, DateTime, Enum as SAEnum
from datetime import datetime, timezone
import uuid
import enum

from ..database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    owner = "owner"
    analyst = "analyst"


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), default=UserRole.analyst, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, nullable=True)
