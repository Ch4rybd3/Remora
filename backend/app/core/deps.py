from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..services.auth_service import decode_access_token

_bearer = HTTPBearer()

# Hiérarchie des rôles : owner > admin > analyst
ROLE_RANK: dict[UserRole, int] = {
    UserRole.analyst: 0,
    UserRole.admin:   1,
    UserRole.owner:   2,
}


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
            detail="Token invalide ou expiré",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Admin ou owner requis."""
    if ROLE_RANK[user.role] < ROLE_RANK[UserRole.admin]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Rôle admin ou owner requis")
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    """Owner uniquement."""
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Rôle owner requis")
    return user


def assert_can_manage(actor: User, target: User) -> None:
    """Vérifie qu'un acteur peut gérer un compte cible.
    Règle : on ne peut modifier que des comptes de rang strictement inférieur au sien.
    Exception : se modifier soi-même (hors rôle) est géré séparément.
    """
    if ROLE_RANK[actor.role] <= ROLE_RANK[target.role] and actor.id != target.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Impossible de gérer un compte de rôle '{target.role.value}'",
        )
