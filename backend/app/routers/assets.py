
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.asset import Asset
from ..models.case import Case
from ..models.user import User
from ..schemas.asset import AssetCreate, AssetRead, AssetUpdate
from ..services.audit_service import audit_log

router = APIRouter(prefix="/cases/{case_id}/assets", tags=["assets"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/", response_model=list[AssetRead])
def list_assets(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(Asset).filter(Asset.case_id == case_id).all()


@router.post("/", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
def create_asset(
    case_id: str,
    payload: AssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    asset = Asset(case_id=case_id, **payload.model_dump())
    db.add(asset)
    db.flush()
    audit_log(db, user=current_user, action="asset.create",
              resource_type="asset", resource_id=asset.id,
              resource_name=getattr(asset, "name", None) or getattr(asset, "hostname", None),
              case_id=case_id, case_title=case.title)
    db.commit()
    db.refresh(asset)
    return asset


@router.patch("/{asset_id}", response_model=AssetRead)
def update_asset(
    case_id: str,
    asset_id: str,
    payload: AssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.case_id == case_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    case = _get_case(case_id, db)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(asset, key, value)
    audit_log(db, user=current_user, action="asset.update",
              resource_type="asset", resource_id=asset_id,
              resource_name=getattr(asset, "name", None) or getattr(asset, "hostname", None),
              case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    case_id: str,
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.case_id == case_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    case = _get_case(case_id, db)
    audit_log(db, user=current_user, action="asset.delete",
              resource_type="asset", resource_id=asset_id,
              resource_name=getattr(asset, "name", None) or getattr(asset, "hostname", None),
              case_id=case_id, case_title=case.title)
    db.delete(asset)
    db.commit()
