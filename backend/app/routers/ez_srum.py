"""
SRUM router — SrumECmd outputs
GET /api/v1/cases/{case_id}/srum/app-usage
GET /api/v1/cases/{case_id}/srum/network
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from ..models.ez_artifacts import SrumAppUsage, SrumNetworkUsage

router = APIRouter()


@router.get("/cases/{case_id}/srum/app-usage")
def get_srum_app_usage(
    case_id: str,
    search: str = Query(""),
    user: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(SrumAppUsage).filter(SrumAppUsage.case_id == case_id)
    if file_id:
        q = q.filter(SrumAppUsage.file_id == file_id)
    if user:
        q = q.filter(SrumAppUsage.user_name == user)
    if search:
        q = q.filter(or_(
            SrumAppUsage.exe_info.ilike(f"%{search}%"),
            SrumAppUsage.exe_description.ilike(f"%{search}%"),
        ))
    total = q.count()
    rows = q.order_by(SrumAppUsage.timestamp.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_app_dto(r) for r in rows]}


def _app_dto(r: SrumAppUsage) -> dict:
    return {
        "id": r.id,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        "exe_info": r.exe_info,
        "exe_description": r.exe_description,
        "user_name": r.user_name,
        "sid": r.sid,
        "bg_bytes_read": r.bg_bytes_read,
        "bg_bytes_written": r.bg_bytes_written,
        "fg_bytes_read": r.fg_bytes_read,
        "fg_bytes_written": r.fg_bytes_written,
        "face_time": r.face_time,
    }


@router.get("/cases/{case_id}/srum/network")
def get_srum_network(
    case_id: str,
    search: str = Query(""),
    user: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(SrumNetworkUsage).filter(SrumNetworkUsage.case_id == case_id)
    if file_id:
        q = q.filter(SrumNetworkUsage.file_id == file_id)
    if user:
        q = q.filter(SrumNetworkUsage.user_name == user)
    if search:
        q = q.filter(or_(
            SrumNetworkUsage.exe_info.ilike(f"%{search}%"),
            SrumNetworkUsage.profile_name.ilike(f"%{search}%"),
        ))
    total = q.count()
    rows = q.order_by(SrumNetworkUsage.timestamp.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_net_dto(r) for r in rows]}


def _net_dto(r: SrumNetworkUsage) -> dict:
    return {
        "id": r.id,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        "exe_info": r.exe_info,
        "exe_description": r.exe_description,
        "user_name": r.user_name,
        "sid": r.sid,
        "bytes_received": r.bytes_received,
        "bytes_sent": r.bytes_sent,
        "profile_name": r.profile_name,
        "interface_type": r.interface_type,
    }
