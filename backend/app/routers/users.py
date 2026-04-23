from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.user import User, UserRole
from ..schemas.user import UserCreate, UserRead, UserUpdate, UserChangePassword
from ..services.auth_service import hash_password
from ..core.deps import get_current_user, require_admin, assert_can_manage, ROLE_RANK

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/", response_model=List[UserRead])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(User).order_by(User.created_at).all()


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    # Un admin ne peut pas créer un owner
    if ROLE_RANK[payload.role] >= ROLE_RANK[current.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Impossible de créer un compte de rôle '{payload.role.value}'",
        )
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur est déjà pris")
    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    assert_can_manage(current, user)

    if user.id == current.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="Impossible de se désactiver soi-même")

    # Vérifier que le nouveau rôle demandé est accessible
    if payload.role and ROLE_RANK[payload.role] >= ROLE_RANK[current.role]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Impossible d'assigner le rôle '{payload.role.value}'",
        )

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/password", response_model=UserRead)
def change_password(
    user_id: str,
    payload: UserChangePassword,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    # Chacun peut changer son propre mot de passe
    if current.id != user_id:
        # Sinon il faut être admin/owner ET avoir un rang supérieur
        if ROLE_RANK[current.role] < ROLE_RANK[UserRole.admin]:
            raise HTTPException(status_code=403, detail="Accès refusé")
        assert_can_manage(current, user)

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    if current.id == user_id:
        raise HTTPException(status_code=400, detail="Impossible de supprimer son propre compte")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    assert_can_manage(current, user)

    db.delete(user)
    db.commit()
