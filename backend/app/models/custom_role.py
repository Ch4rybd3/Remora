import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text

from ..database import Base


class CustomRole(Base):
    """
    A named permission profile that an admin defines and assigns to accounts.

    Standard roles (`UserRole` enum) are built in and unchanged. A custom role
    supplements them: it overrides the permissions of any account it is attached
    to, without touching the account's base enum role (which stays for backward
    compatibility with anything that reads `user.role` directly).

    Custom roles intentionally omit `PERM_USERS` and `PERM_CONFIG`. User
    administration and global configuration are admin/owner capabilities, and
    letting a custom role claim them would let an analyst create an admin
    account. The two available checkboxes map to `PERM_WRITE` and
    `PERM_ARTIFACTS`.
    """
    __tablename__ = "custom_roles"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(64), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    color = Column(String(64), nullable=True)

    # ── Permissions ───────────────────────────────────────────────────────────
    #: Maps to PERM_WRITE — create / update / delete case content.
    can_write = Column(Boolean, default=False, nullable=False)
    #: Maps to PERM_ARTIFACTS — read artifact-level data (Explorer, logs, etc.).
    can_read_artifacts = Column(Boolean, default=True, nullable=False)
    #: Whether accounts with this role may change their own password.
    #: Turned off for the "Demo" profile to prevent a demo credential from
    #: being silently replaced by a visitor.
    can_change_own_password = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC))
