from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..database import get_db
from ..models.case import Case
from ..models.ioc import IOC
from ..schemas.ioc import IOCCreate, IOCRead, IOCUpdate

router = APIRouter(prefix="/cases/{case_id}/iocs", tags=["iocs"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/", response_model=List[IOCRead])
def list_iocs(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(IOC).filter(IOC.case_id == case_id).all()


@router.post("/", response_model=IOCRead, status_code=status.HTTP_201_CREATED)
def create_ioc(case_id: str, payload: IOCCreate, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    ioc = IOC(case_id=case_id, **payload.model_dump())
    db.add(ioc)
    db.commit()
    db.refresh(ioc)
    return ioc


@router.patch("/{ioc_id}", response_model=IOCRead)
def update_ioc(case_id: str, ioc_id: str, payload: IOCUpdate, db: Session = Depends(get_db)):
    ioc = db.query(IOC).filter(IOC.id == ioc_id, IOC.case_id == case_id).first()
    if not ioc:
        raise HTTPException(status_code=404, detail="IOC not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(ioc, key, value)
    db.commit()
    db.refresh(ioc)
    return ioc


@router.delete("/{ioc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ioc(case_id: str, ioc_id: str, db: Session = Depends(get_db)):
    ioc = db.query(IOC).filter(IOC.id == ioc_id, IOC.case_id == case_id).first()
    if not ioc:
        raise HTTPException(status_code=404, detail="IOC not found")
    db.delete(ioc)
    db.commit()
