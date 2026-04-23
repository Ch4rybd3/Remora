from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.case import Case
from ..models.asset import Asset
from ..schemas.asset import AssetCreate, AssetRead, AssetUpdate

router = APIRouter(prefix="/cases/{case_id}/assets", tags=["assets"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/", response_model=List[AssetRead])
def list_assets(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(Asset).filter(Asset.case_id == case_id).all()


@router.post("/", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
def create_asset(case_id: str, payload: AssetCreate, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    asset = Asset(case_id=case_id, **payload.model_dump())
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.patch("/{asset_id}", response_model=AssetRead)
def update_asset(case_id: str, asset_id: str, payload: AssetUpdate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.case_id == case_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(asset, key, value)
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(case_id: str, asset_id: str, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.case_id == case_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    db.delete(asset)
    db.commit()
