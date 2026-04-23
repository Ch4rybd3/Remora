from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from ..database import get_db
from ..models.user import User
from ..schemas.user import LoginPayload, TokenResponse, UserRead
from ..services.auth_service import verify_password, create_access_token
from ..core.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.username == payload.username,
        User.is_active == True,
    ).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects",
        )
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    token = create_access_token(user.id, user.role.value)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user
