"""
User Activity router — LNK, JumpLists, Shellbags, RecycleBin, WindowsTimeline
GET /api/v1/cases/{case_id}/user-activity/lnk
GET /api/v1/cases/{case_id}/user-activity/jumplists
GET /api/v1/cases/{case_id}/user-activity/shellbags
GET /api/v1/cases/{case_id}/user-activity/recycle-bin
GET /api/v1/cases/{case_id}/user-activity/windows-timeline
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..core.deps import get_current_user
from ..models.ez_artifacts import (
    LnkEntry, JumpListEntry, ShellbagEntry,
    RecycleBinEntry, WindowsTimelineEntry,
)

router = APIRouter()


# ─── LNK Files ────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/user-activity/lnk")
def get_lnk(
    case_id: str,
    search: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(LnkEntry).filter(LnkEntry.case_id == case_id)
    if file_id:
        q = q.filter(LnkEntry.file_id == file_id)
    if search:
        q = q.filter(or_(
            LnkEntry.local_path.ilike(f"%{search}%"),
            LnkEntry.network_path.ilike(f"%{search}%"),
            LnkEntry.target_path.ilike(f"%{search}%"),
            LnkEntry.machine_id.ilike(f"%{search}%"),
        ))
    total = q.count()
    rows = q.order_by(LnkEntry.source_modified.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_lnk_dto(r) for r in rows]}


def _lnk_dto(r: LnkEntry) -> dict:
    return {
        "id": r.id,
        "source_file": r.source_file,
        "source_created": r.source_created.isoformat() if r.source_created else None,
        "source_modified": r.source_modified.isoformat() if r.source_modified else None,
        "target_created": r.target_created.isoformat() if r.target_created else None,
        "target_modified": r.target_modified.isoformat() if r.target_modified else None,
        "target_accessed": r.target_accessed.isoformat() if r.target_accessed else None,
        "file_size": r.file_size,
        "local_path": r.local_path,
        "network_path": r.network_path,
        "target_path": r.target_path,
        "arguments": r.arguments,
        "machine_id": r.machine_id,
        "mac_address": r.mac_address,
        "drive_type": r.drive_type,
        "volume_label": r.volume_label,
        "relative_path": r.relative_path,
    }


# ─── Jump Lists ───────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/user-activity/jumplists")
def get_jumplists(
    case_id: str,
    search: str = Query(""),
    jl_type: str = Query(""),     # automatic | custom | ""
    app_id: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(JumpListEntry).filter(JumpListEntry.case_id == case_id)
    if file_id:
        q = q.filter(JumpListEntry.file_id == file_id)
    if jl_type:
        q = q.filter(JumpListEntry.jl_type == jl_type)
    if app_id:
        q = q.filter(JumpListEntry.app_id == app_id)
    if search:
        q = q.filter(or_(
            JumpListEntry.path.ilike(f"%{search}%"),
            JumpListEntry.local_path.ilike(f"%{search}%"),
            JumpListEntry.app_description.ilike(f"%{search}%"),
        ))
    total = q.count()
    rows = q.order_by(JumpListEntry.last_modified.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_jl_dto(r) for r in rows]}


def _jl_dto(r: JumpListEntry) -> dict:
    return {
        "id": r.id,
        "jl_type": r.jl_type,
        "app_id": r.app_id,
        "app_description": r.app_description,
        "mru": r.mru,
        "entry_number": r.entry_number,
        "creation_time": r.creation_time.isoformat() if r.creation_time else None,
        "last_modified": r.last_modified.isoformat() if r.last_modified else None,
        "hostname": r.hostname,
        "mac_address": r.mac_address,
        "path": r.path,
        "interaction_count": r.interaction_count,
        "local_path": r.local_path,
        "target_path": r.target_path,
        "file_size": r.file_size,
        "pin_status": r.pin_status,
        "arguments": r.arguments,
    }


# ─── Shellbags ────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/user-activity/shellbags")
def get_shellbags(
    case_id: str,
    search: str = Query(""),
    hive_source: str = Query(""),  # NTUSER | UsrClass | ""
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(ShellbagEntry).filter(ShellbagEntry.case_id == case_id)
    if file_id:
        q = q.filter(ShellbagEntry.file_id == file_id)
    if hive_source:
        q = q.filter(ShellbagEntry.hive_source == hive_source)
    if search:
        q = q.filter(ShellbagEntry.absolute_path.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(ShellbagEntry.last_interacted.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_sb_dto(r) for r in rows]}


def _sb_dto(r: ShellbagEntry) -> dict:
    return {
        "id": r.id,
        "bag_path": r.bag_path,
        "slot": r.slot,
        "mru_position": r.mru_position,
        "absolute_path": r.absolute_path,
        "shell_type": r.shell_type,
        "created_on": r.created_on.isoformat() if r.created_on else None,
        "modified_on": r.modified_on.isoformat() if r.modified_on else None,
        "accessed_on": r.accessed_on.isoformat() if r.accessed_on else None,
        "last_write_time": r.last_write_time.isoformat() if r.last_write_time else None,
        "first_interacted": r.first_interacted.isoformat() if r.first_interacted else None,
        "last_interacted": r.last_interacted.isoformat() if r.last_interacted else None,
        "has_explored": r.has_explored,
        "hive_source": r.hive_source,
    }


# ─── Recycle Bin ──────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/user-activity/recycle-bin")
def get_recycle_bin(
    case_id: str,
    search: str = Query(""),
    sid: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(RecycleBinEntry).filter(RecycleBinEntry.case_id == case_id)
    if file_id:
        q = q.filter(RecycleBinEntry.file_id == file_id)
    if sid:
        q = q.filter(RecycleBinEntry.sid == sid)
    if search:
        q = q.filter(RecycleBinEntry.file_name.ilike(f"%{search}%"))
    total = q.count()
    rows = q.order_by(RecycleBinEntry.deleted_on.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_rb_dto(r) for r in rows]}


def _rb_dto(r: RecycleBinEntry) -> dict:
    return {
        "id": r.id,
        "source_name": r.source_name,
        "file_type": r.file_type,
        "file_name": r.file_name,
        "file_size": r.file_size,
        "deleted_on": r.deleted_on.isoformat() if r.deleted_on else None,
        "sid": r.sid,
    }


# ─── Windows Timeline ─────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/user-activity/windows-timeline")
def get_windows_timeline(
    case_id: str,
    search: str = Query(""),
    activity_type: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(WindowsTimelineEntry).filter(WindowsTimelineEntry.case_id == case_id)
    if file_id:
        q = q.filter(WindowsTimelineEntry.file_id == file_id)
    if activity_type:
        q = q.filter(WindowsTimelineEntry.activity_type == activity_type)
    if search:
        q = q.filter(or_(
            WindowsTimelineEntry.executable.ilike(f"%{search}%"),
            WindowsTimelineEntry.display_text.ilike(f"%{search}%"),
        ))
    total = q.count()
    rows = q.order_by(WindowsTimelineEntry.start_time.desc()).offset(skip).limit(limit).all()
    return {"total": total, "items": [_wt_dto(r) for r in rows]}


def _wt_dto(r: WindowsTimelineEntry) -> dict:
    return {
        "id": r.id,
        "activity_type": r.activity_type,
        "executable": r.executable,
        "display_text": r.display_text,
        "content_info": r.content_info,
        "start_time": r.start_time.isoformat() if r.start_time else None,
        "end_time": r.end_time.isoformat() if r.end_time else None,
        "duration": r.duration,
        "last_modified": r.last_modified.isoformat() if r.last_modified else None,
        "platform": r.platform,
    }
