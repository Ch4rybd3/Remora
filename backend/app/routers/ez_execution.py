"""
Execution Artifacts router — Shimcache + Amcache
GET /api/v1/cases/{case_id}/execution/shimcache
GET /api/v1/cases/{case_id}/execution/amcache/files
GET /api/v1/cases/{case_id}/execution/amcache/programs
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..core.deps import get_current_user
from ..models.ez_artifacts import ShimcacheEntry, AmcacheFileEntry, AmcacheProgramEntry

router = APIRouter()


# ─── Shimcache ────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/execution/shimcache")
def get_shimcache(
    case_id: str,
    search: str = Query(""),
    executed: str = Query(""),     # Yes | No | NA | ""
    file_id: str = Query(""),
    skip: int = 0,
    limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(ShimcacheEntry).filter(ShimcacheEntry.case_id == case_id)
    if file_id:
        q = q.filter(ShimcacheEntry.file_id == file_id)
    if executed:
        q = q.filter(ShimcacheEntry.executed == executed)
    if search:
        q = q.filter(ShimcacheEntry.path.ilike(f"%{search}%"))

    total = q.count()
    rows = q.order_by(ShimcacheEntry.cache_position).offset(skip).limit(limit).all()
    return {
        "total": total,
        "items": [_shimcache_dto(r) for r in rows],
    }


def _shimcache_dto(r: ShimcacheEntry) -> dict:
    return {
        "id": r.id,
        "control_set": r.control_set,
        "cache_position": r.cache_position,
        "path": r.path,
        "last_modified": r.last_modified.isoformat() if r.last_modified else None,
        "executed": r.executed,
        "duplicate": r.duplicate,
        "source_hive": r.source_hive,
    }


# ─── Amcache — File Entries ───────────────────────────────────────────────────

@router.get("/cases/{case_id}/execution/amcache/files")
def get_amcache_files(
    case_id: str,
    search: str = Query(""),
    entry_type: str = Query(""),   # unassociated | associated | ""
    ext: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0,
    limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(AmcacheFileEntry).filter(AmcacheFileEntry.case_id == case_id)
    if file_id:
        q = q.filter(AmcacheFileEntry.file_id == file_id)
    if entry_type:
        q = q.filter(AmcacheFileEntry.entry_type == entry_type)
    if ext:
        q = q.filter(AmcacheFileEntry.file_extension.ilike(ext))
    if search:
        q = q.filter(
            or_(
                AmcacheFileEntry.full_path.ilike(f"%{search}%"),
                AmcacheFileEntry.sha1.ilike(f"%{search}%"),
                AmcacheFileEntry.product_name.ilike(f"%{search}%"),
            )
        )

    total = q.count()
    rows = q.order_by(AmcacheFileEntry.file_key_last_write.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "items": [_amcache_file_dto(r) for r in rows],
    }


def _amcache_file_dto(r: AmcacheFileEntry) -> dict:
    return {
        "id": r.id,
        "entry_type": r.entry_type,
        "application_name": r.application_name,
        "program_id": r.program_id,
        "file_key_last_write": r.file_key_last_write.isoformat() if r.file_key_last_write else None,
        "sha1": r.sha1,
        "is_os_component": r.is_os_component,
        "full_path": r.full_path,
        "name": r.name,
        "file_extension": r.file_extension,
        "link_date": r.link_date.isoformat() if r.link_date else None,
        "product_name": r.product_name,
        "size": r.size,
        "version": r.version,
        "is_pe_file": r.is_pe_file,
        "language": r.language,
        "description": r.description,
    }


# ─── Amcache — Program Entries ────────────────────────────────────────────────

@router.get("/cases/{case_id}/execution/amcache/programs")
def get_amcache_programs(
    case_id: str,
    search: str = Query(""),
    file_id: str = Query(""),
    skip: int = 0,
    limit: int = 500,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = db.query(AmcacheProgramEntry).filter(AmcacheProgramEntry.case_id == case_id)
    if file_id:
        q = q.filter(AmcacheProgramEntry.file_id == file_id)
    if search:
        q = q.filter(
            or_(
                AmcacheProgramEntry.name.ilike(f"%{search}%"),
                AmcacheProgramEntry.publisher.ilike(f"%{search}%"),
            )
        )

    total = q.count()
    rows = q.order_by(AmcacheProgramEntry.key_last_write.desc()).offset(skip).limit(limit).all()
    return {
        "total": total,
        "items": [_amcache_prog_dto(r) for r in rows],
    }


def _amcache_prog_dto(r: AmcacheProgramEntry) -> dict:
    return {
        "id": r.id,
        "program_id": r.program_id,
        "key_last_write": r.key_last_write.isoformat() if r.key_last_write else None,
        "name": r.name,
        "version": r.version,
        "publisher": r.publisher,
        "install_date": r.install_date.isoformat() if r.install_date else None,
        "root_dir_path": r.root_dir_path,
        "uninstall_string": r.uninstall_string,
        "source": r.source,
    }
