from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..core.deps import get_current_user, require_admin
from ..database import get_db
from ..models.custom_role import CustomRole
from ..models.user import User
from ..services.audit_service import audit_log

router = APIRouter(prefix="/custom-roles", tags=["custom-roles"])

_COLOR_RE = None  # lazy: any short string accepted; the frontend enforces the palette


class CustomRoleCreate(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None
    can_write: bool = False
    can_read_artifacts: bool = True
    can_change_own_password: bool = True

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v


class CustomRoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    can_write: bool | None = None
    can_read_artifacts: bool | None = None
    can_change_own_password: bool | None = None


class CustomRoleRead(BaseModel):
    id: str
    name: str
    description: str | None
    color: str | None
    can_write: bool
    can_read_artifacts: bool
    can_change_own_password: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[CustomRoleRead])
def list_custom_roles(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return db.query(CustomRole).order_by(CustomRole.name).all()


@router.post("/", response_model=CustomRoleRead, status_code=status.HTTP_201_CREATED)
def create_custom_role(
    payload: CustomRoleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    if db.query(CustomRole).filter(CustomRole.name == payload.name).first():
        raise HTTPException(status_code=409, detail="A custom role with this name already exists")
    role = CustomRole(**payload.model_dump())
    db.add(role)
    db.flush()
    audit_log(db, user=current, action="custom_role.create",
              resource_type="custom_role", resource_id=str(role.id),
              resource_name=str(role.name), request=request)
    db.commit()
    db.refresh(role)
    return role


@router.get("/{role_id}", response_model=CustomRoleRead)
def get_custom_role(
    role_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    role = db.query(CustomRole).filter(CustomRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")
    return role


@router.patch("/{role_id}", response_model=CustomRoleRead)
def update_custom_role(
    role_id: str,
    payload: CustomRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    role = db.query(CustomRole).filter(CustomRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        existing = db.query(CustomRole).filter(
            CustomRole.name == updates["name"],
            CustomRole.id != role_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="A custom role with this name already exists")

    for key, value in updates.items():
        setattr(role, key, value)
    role.updated_at = datetime.now(UTC)  # type: ignore[assignment]

    audit_log(db, user=current, action="custom_role.update",
              resource_type="custom_role", resource_id=role_id,
              resource_name=str(role.name), details={"fields": list(updates.keys())},
              request=request)
    db.commit()
    db.refresh(role)
    return role


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_role(
    role_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    role = db.query(CustomRole).filter(CustomRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Custom role not found")

    # The FK has ondelete="SET NULL", so users keep their base role.
    audit_log(db, user=current, action="custom_role.delete",
              resource_type="custom_role", resource_id=role_id,
              resource_name=str(role.name), request=request)
    db.delete(role)
    db.commit()
