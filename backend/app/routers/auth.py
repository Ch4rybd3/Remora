import time
from collections import defaultdict
from datetime import UTC, datetime
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.user import User
from ..schemas.user import LoginPayload, TokenResponse, UserRead
from ..services.audit_service import audit_log
from ..services.auth_service import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# ── In-memory rate limiter ────────────────────────────────────────────────────
# Tracks failed login attempts per username.
# State: username -> [fail_count, window_start, locked_until]

_attempts: dict[str, list] = defaultdict(lambda: [0, 0.0, 0.0])
_attempts_lock = Lock()
_MAX_ATTEMPTS    = 5
_LOCKOUT_SECONDS = 30
_WINDOW_SECONDS  = 300   # reset counter after 5 min of no failures


def _check_rate_limit(username: str) -> None:
    with _attempts_lock:
        state = _attempts[username]
        now   = time.monotonic()
        if now < state[2]:
            remaining = int(state[2] - now) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Trop de tentatives. Réessayez dans {remaining}s.",
            )
        if now - state[1] > _WINDOW_SECONDS:
            state[0] = 0
            state[1] = now
            state[2] = 0.0


def _record_failure(username: str) -> None:
    with _attempts_lock:
        state = _attempts[username]
        now   = time.monotonic()
        if now - state[1] > _WINDOW_SECONDS:
            state[0] = 0
            state[1] = now
        state[0] += 1
        if state[0] >= _MAX_ATTEMPTS:
            state[2] = now + _LOCKOUT_SECONDS
            print(f"[remora] auth: account '{username}' locked for {_LOCKOUT_SECONDS}s after {_MAX_ATTEMPTS} failed attempts", flush=True)


def _record_success(username: str) -> None:
    with _attempts_lock:
        _attempts[username] = [0, 0.0, 0.0]


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(payload.username)

    user = db.query(User).filter(
        User.username == payload.username,
        User.is_active.is_(True),
    ).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_failure(payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects",
        )
    _record_success(payload.username)
    user.last_login = datetime.now(UTC)
    audit_log(db, user=user, action="auth.login",
              resource_type="user", resource_id=user.id,
              resource_name=user.username, request=request)
    db.commit()
    token = create_access_token(user.id, user.role.value)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)):
    return current_user
