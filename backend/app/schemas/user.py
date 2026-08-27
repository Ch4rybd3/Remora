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
        errors.append("au moins 8 caractères")
    if not _PW_RE_UPPER.search(v):
        errors.append("une majuscule")
    if not _PW_RE_LOWER.search(v):
        errors.append("une minuscule")
    if not _PW_RE_DIGIT.search(v):
        errors.append("un chiffre")
    if not _PW_RE_SPECIAL.search(v):
        errors.append("un caractère spécial")
    if errors:
        raise ValueError("Le mot de passe doit contenir : " + ", ".join(errors))
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
    access_token: str
    token_type: str = "bearer"
    user: UserRead
