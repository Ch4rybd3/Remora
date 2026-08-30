import re
from datetime import datetime

from pydantic import BaseModel, field_validator

from ..models.user import UserRole

_PW_RE_UPPER   = re.compile(r'[A-Z]')
_PW_RE_LOWER   = re.compile(r'[a-z]')
_PW_RE_DIGIT   = re.compile(r'\d')
_PW_RE_SPECIAL = re.compile(r'[!@#$%^&*()\-_=+\[\]{}|;:\'",.<>?/\\`~]')


def _validate_password(v: str) -> str:
    errors = []
    if len(v) < 8:
        errors.append("at least 8 characters")
    if not _PW_RE_UPPER.search(v):
        errors.append("an uppercase letter")
    if not _PW_RE_LOWER.search(v):
        errors.append("a lowercase letter")
    if not _PW_RE_DIGIT.search(v):
        errors.append("a digit")
    if not _PW_RE_SPECIAL.search(v):
        errors.append("a special character")
    if errors:
        raise ValueError("Password must contain: " + ", ".join(errors))
    return v


class UserCreate(BaseModel):
    username: str
    email: str | None = None
    password: str
    role: UserRole = UserRole.analyst

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserUpdate(BaseModel):
    email: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None


class UserChangePassword(BaseModel):
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class UserRead(BaseModel):
    id: str
    username: str
    email: str | None
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login: datetime | None

    model_config = {"from_attributes": True}


class LoginPayload(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    """
    A finished login, or a login waiting on its second factor.

    One shape rather than two so the client has one branch to write: when
    `mfa_required` is set there is no session yet, and `mfa_token` is what the
    code check is presented with.
    """
    access_token: str | None = None
    token_type: str = "bearer"
    user: UserRead | None = None
    mfa_required: bool = False
    mfa_token: str | None = None
