
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core import permissions, scoping
from ..core.deps import assert_can_manage, get_current_user, require_admin
from ..database import get_db
from ..models.user import User
from ..schemas.user import UserChangePassword, UserCreate, UserRead, UserUpdate
from ..services.audit_service import audit_log
from ..services.auth_service import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=list[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(User).order_by(User.created_at).all()


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    # Only an owner may hand out `owner`.
    if not permissions.may_assign_role(current.role, payload.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cannot create an account with role '{payload.role.value}'",
        )
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="Username already taken")
    # Checked rather than left to the unique constraint, which surfaces as an
    # unhandled 500 the interface cannot explain.
    if payload.email and db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(
            status_code=409, detail=f"'{payload.email}' is already used by another account")
    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    audit_log(db, user=current, action="user.create",
              resource_type="user", resource_id=user.id,
              resource_name=user.username,
              details={"role": payload.role.value}, request=request)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    assert_can_manage(current, user)

    if user.id == current.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    if payload.role and not permissions.may_assign_role(current.role, payload.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cannot assign role '{payload.role.value}'",
        )

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(user, key, value)
    audit_log(db, user=current, action="user.update",
              resource_type="user", resource_id=user_id,
              resource_name=user.username,
              details={"fields": list(updates.keys())}, request=request)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/password", response_model=UserRead)
def change_password(
    user_id: str,
    payload: UserChangePassword,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Anyone may change their own password
    if current.id != user_id:
        # Otherwise the actor must administer users, and be allowed to act on
        # this particular account.
        if not permissions.has(current.role, permissions.PERM_USERS):
            raise HTTPException(status_code=403, detail="Access denied")
        assert_can_manage(current, user)

    user.hashed_password = hash_password(payload.new_password)
    audit_log(db, user=current, action="user.password_change",
              resource_type="user", resource_id=user_id,
              resource_name=user.username, request=request)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    if current.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    assert_can_manage(current, user)

    audit_log(db, user=current, action="user.delete",
              resource_type="user", resource_id=user_id,
              resource_name=user.username, request=request)
    db.delete(user)
    db.commit()


@router.put("/{user_id}/clients", response_model=UserRead)
def set_user_clients(
    user_id: str,
    body: dict,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    """
    Restrict an account to a set of clients, or lift the restriction.

    Body: `{"client_ids": ["...", "..."]}`. An **empty list means
    unrestricted** - the same rule as the model: no attached clients is the
    absence of a restriction, not the absence of access. That is what lets
    scoping exist without having locked out every account on the day it
    shipped.

    An administrator who is themselves scoped cannot hand out a client they
    cannot see, which would otherwise be a way to widen their own reach by
    proxy through an account they then log in as.
    """
    from ..models.client import Client

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    assert_can_manage(current, user)

    requested = [str(c) for c in (body or {}).get("client_ids") or []]
    actor_scope = scoping.scoped_client_ids(current)
    if actor_scope is not None:
        outside = [c for c in requested if c not in actor_scope]
        if outside:
            raise HTTPException(
                status_code=403,
                detail="Cannot grant access to a client you do not have yourself",
            )

    clients = db.query(Client).filter(Client.id.in_(requested)).all() if requested else []
    missing = set(requested) - {str(c.id) for c in clients}
    if missing:
        raise HTTPException(status_code=404, detail=f"Unknown client: {', '.join(sorted(missing))}")

    user.clients = clients
    audit_log(db, user=current, action="user.clients_set",
              resource_type="user", resource_id=user_id,
              resource_name=user.username, request=request,
              details={"client_ids": sorted(requested) or "unrestricted"})
    db.commit()
    db.refresh(user)
    return user
