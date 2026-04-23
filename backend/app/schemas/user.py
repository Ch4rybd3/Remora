from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from ..models.user import UserRole


class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    role: UserRole = UserRole.analyst


class UserUpdate(BaseModel):
    email: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class UserChangePassword(BaseModel):
    new_password: str


class UserRead(BaseModel):
    id: str
    username: str
    email: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    model_config = {"from_attributes": True}


class LoginPayload(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead
