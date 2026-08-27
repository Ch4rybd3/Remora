
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.ioc import IOC
from ..models.user import User
from ..schemas.ioc import IOCCreate, IOCRead, IOCUpdate
from ..services.audit_service import audit_log

router = APIRouter(prefix="/cases/{case_id}/iocs", tags=["iocs"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/", response_model=list[IOCRead])
def list_iocs(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(IOC).filter(IOC.case_id == case_id).all()


@router.post("/", response_model=IOCRead, status_code=status.HTTP_201_CREATED)
def create_ioc(
    case_id: str,
    payload: IOCCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    ioc = IOC(case_id=case_id, **payload.model_dump())
    db.add(ioc)
    db.flush()
    audit_log(db, user=current_user, action="ioc.create",
              resource_type="ioc", resource_id=ioc.id,
              resource_name=getattr(ioc, "value", None),
              case_id=case_id, case_title=case.title)
    db.commit()
    db.refresh(ioc)
    return ioc


@router.patch("/{ioc_id}", response_model=IOCRead)
def update_ioc(
    case_id: str,
    ioc_id: str,
    payload: IOCUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ioc = db.query(IOC).filter(IOC.id == ioc_id, IOC.case_id == case_id).first()
    if not ioc:
        raise HTTPException(status_code=404, detail="IOC not found")
    case = _get_case(case_id, db)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(ioc, key, value)
    audit_log(db, user=current_user, action="ioc.update",
              resource_type="ioc", resource_id=ioc_id,
              resource_name=getattr(ioc, "value", None),
              case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(ioc)
    return ioc


@router.delete("/{ioc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ioc(
    case_id: str,
    ioc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ioc = db.query(IOC).filter(IOC.id == ioc_id, IOC.case_id == case_id).first()
    if not ioc:
        raise HTTPException(status_code=404, detail="IOC not found")
    case = _get_case(case_id, db)
    audit_log(db, user=current_user, action="ioc.delete",
              resource_type="ioc", resource_id=ioc_id,
              resource_name=getattr(ioc, "value", None),
              case_id=case_id, case_title=case.title)
    db.delete(ioc)
    db.commit()
