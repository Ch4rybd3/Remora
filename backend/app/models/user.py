import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

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
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    last_login = Column(DateTime, nullable=True)

    # ── Second factor (TOTP) ─────────────────────────────────────────────────
    # Annotated where the rest of this model is not, because the MFA service
    # writes to all of them and a bare Column() leaves mypy seeing the
    # descriptor rather than the value.
    mfa_enabled: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)
    # Encrypted with a key derived from SECRET_KEY and the salt below. A leaked
    # database must not hand over every second factor with it.
    mfa_secret:  Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_salt:    Mapped[str | None] = mapped_column(String(64), nullable=True)
    # JSON array of bcrypt hashes. Recovery codes are passwords; storing them
    # readable would make the recovery path weaker than what it recovers.
    mfa_recovery_codes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # TOTP step of the last accepted code. A code stays valid for a whole
    # 30-second step, which is long enough to be read over a shoulder and used
    # again, so a step is never accepted twice.
    mfa_last_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Six digits is a million possibilities; a script does that in minutes.
    mfa_failed_attempts: Mapped[int | None] = mapped_column(Integer, default=0, nullable=True)
    mfa_locked_until:    Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    mfa_enrolled_at:     Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
