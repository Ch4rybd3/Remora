from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from ..core import permissions, scoping
from ..database import get_db
from ..models.user import User, UserRole
from ..services.auth_service import decode_access_token

_bearer = HTTPBearer()


def _decode_token(token: str, db: Session) -> User | None:
    """Decode a raw JWT string and return the active user, or None.

    Used by WebSocket endpoints that cannot send an Authorization header and
    pass the token as a query parameter instead.
    """
    try:
        payload = decode_access_token(token)
        if payload.get("scope", "access") != "access":
            return None
        user_id: str = payload["sub"]
    except (JWTError, KeyError):
        return None
    return db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()


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


def _effective_grants(user: User) -> tuple[frozenset[str], str]:
    """
    Effective permission set and display label for a user.

    When the user has a custom role, its flags override the built-in role.
    Otherwise the built-in role's defaults apply.
    """
    cr = getattr(user, "custom_role", None)
    if user.custom_role_id and cr is not None:
        granted: set[str] = set()
        if cr.can_write:          granted.add(permissions.PERM_WRITE)
        if cr.can_read_artifacts: granted.add(permissions.PERM_ARTIFACTS)
        return frozenset(granted), str(cr.name)
    return (
        permissions.permissions_for(user.role),
        permissions.ROLE_LABELS.get(user.role, str(user.role)),
    )


def enforce_permissions(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """
    The one place a role is checked.

    Attached to every authenticated router, so a new endpoint is covered the
    moment it exists rather than when somebody remembers to guard it. `/auth` is
    outside it on purpose: a read-only account still has to sign in and manage
    its own second factor, and both of those are POSTs.
    """
    try:
        granted, label = _effective_grants(user)
        permissions.enforce_grants(request, granted, label)

        # Almost every route carrying case data has the case id in its path, so
        # checking it here scopes a new artifact page the moment it exists. The
        # endpoints that aggregate across cases filter explicitly - see
        # `core/scoping.py` and the test that asserts that list is complete.
        case_id = request.path_params.get("case_id")
        if case_id:
            scoping.assert_case_in_scope(db, user, str(case_id))

        client_id = request.path_params.get("client_id")
        if client_id:
            scoping.assert_client_in_scope(user, str(client_id))
    except (permissions.Denied, scoping.OutOfScope) as refusal:
        _record_denial(db, user, request, refusal)
        raise

    return user


def _record_denial(
    db: Session,
    user: User,
    request: Request,
    refusal: permissions.Denied | scoping.OutOfScope,
) -> None:
    """
    Write a refused request to the audit trail.

    Sign-ins were audited and refusals were not, which left the trail able to
    answer "who came in" but not "who reached for what they could not have" -
    and the second question is the one an investigation into the investigators
    starts with.

    Committed here rather than left to the caller. Every other audit entry
    rides along on a request that is about to succeed; this one rides on a
    request that is about to raise, so nothing downstream will ever commit it.

    Never allowed to change the outcome. If the audit write fails the refusal
    still stands - a denial that turned into a 500 because its own logging
    broke would be a refusal an attacker could distinguish from a success.
    """
    from ..services.audit_service import audit_log

    try:
        cr = getattr(user, "custom_role", None)
        role_label = (
            str(cr.name) if user.custom_role_id and cr is not None
            else getattr(user.role, "value", str(user.role))
        )
        audit_log(
            db, user=user, action="auth.denied", request=request,
            resource_type="endpoint",
            resource_name=f"{request.method} {request.url.path}",
            case_id=str(request.path_params.get("case_id") or "") or None,
            details={
                "reason": refusal.reason,
                "status": refusal.status_code,
                "role":   role_label,
            },
        )
        db.commit()
    except Exception:
        db.rollback()


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Requires a role that administers users."""
    granted, _ = _effective_grants(user)
    if permissions.PERM_USERS not in granted:
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
