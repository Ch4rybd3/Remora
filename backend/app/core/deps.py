from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from ..core import permissions
from ..database import get_db
from ..models.user import User, UserRole
from ..services.auth_service import decode_access_token

_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
        user_id: str = payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # A token issued between the password and the second factor proves half a
    # login. Accepting it here would make MFA optional for anyone who stopped
    # reading the response. Absent scope means the token predates the field.
    if payload.get("scope", "access") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This token does not authorise a session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def enforce_permissions(
    request: Request,
    user: User = Depends(get_current_user),
) -> User:
    """
    The one place a role is checked.

    Attached to every authenticated router, so a new endpoint is covered the
    moment it exists rather than when somebody remembers to guard it. `/auth` is
    outside it on purpose: a read-only account still has to sign in and manage
    its own second factor, and both of those are POSTs.
    """
    permissions.enforce(request, user.role)
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Requires a role that administers users."""
    if not permissions.has(user.role, permissions.PERM_USERS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or owner role required")
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    """Owner only."""
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role required")
    return user


def assert_can_manage(actor: User, target: User) -> None:
    """
    Check that an actor may manage a target account.

    Without a rank the rule has to be stated rather than computed: an owner may
    manage anyone, an admin may manage anyone who is not an owner and not
    another admin, and nobody else manages anyone. That is what the old
    comparison did for the three roles that existed, and it now says so out
    loud instead of relying on the order of an integer map.

    Managing one's own account (role excepted) is handled separately.
    """
    if actor.id == target.id:
        return
    if not permissions.has(actor.role, permissions.PERM_USERS):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User administration requires an admin account",
        )
    if actor.role == UserRole.owner:
        return
    if target.role in permissions.MANAGING_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cannot manage an account with role '{target.role.value}'",
        )
