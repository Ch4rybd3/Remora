"""
Audit log query API — read-only, admin/owner only.
"""
from __future__ import annotations

import math
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..core import scoping
from ..core.deps import require_admin
from ..database import get_db
from ..models.audit import AuditLog
from ..models.user import User
from ..schemas.audit import AuditLogOut, AuditPage

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditPage)
def list_audit(
    page:          int           = Query(1, ge=1),
    page_size:     int           = Query(50, ge=1, le=200),
    search:        str | None = Query(None),           # free-text across username/action/resource_name
    username:      str | None = Query(None),
    action:        str | None = Query(None),           # exact or prefix, e.g. "case"
    resource_type: str | None = Query(None),
    case_id:       str | None = Query(None),
    date_from:     str | None = Query(None),           # ISO datetime
    date_to:       str | None = Query(None),
    db:            Session       = Depends(get_db),
    _current:      User        = Depends(require_admin),
):
    q = db.query(AuditLog)

    # Audit entries carry the case they were recorded against. A scoped
    # administrator is still scoped: the trail would otherwise name cases,
    # clients and artifact filenames they cannot open.
    visible = scoping.visible_case_ids(db, _current)
    if visible is not None:
        q = q.filter(or_(AuditLog.case_id.is_(None), AuditLog.case_id.in_(visible)))

    if search:
        pat = f"%{search}%"
        q = q.filter(
            or_(
                AuditLog.username.ilike(pat),
                AuditLog.action.ilike(pat),
                AuditLog.resource_name.ilike(pat),
                AuditLog.resource_type.ilike(pat),
                AuditLog.case_title.ilike(pat),
            )
        )

    if username:
        q = q.filter(AuditLog.username.ilike(f"%{username}%"))

    if action:
        # "case" matches "case.create", "case.update", …
        q = q.filter(AuditLog.action.ilike(f"{action}%"))

    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)

    if case_id:
        q = q.filter(AuditLog.case_id == case_id)

    if date_from:
        try:
            q = q.filter(AuditLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass

    if date_to:
        try:
            q = q.filter(AuditLog.timestamp <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    total = q.count()
    items = (
        q.order_by(AuditLog.timestamp.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return AuditPage(
        total     = total,
        page      = page,
        page_size = page_size,
        pages     = max(1, math.ceil(total / page_size)),
        items     = [AuditLogOut.model_validate(e) for e in items],
    )


@router.get("/meta", response_model=dict)
def audit_meta(
    db:       Session = Depends(get_db),
    _current: User  = Depends(require_admin),
):
    """Return distinct values for filter dropdowns."""
    from sqlalchemy import distinct

    usernames = [
        r[0] for r in db.query(distinct(AuditLog.username))
        .filter(AuditLog.username.isnot(None))
        .order_by(AuditLog.username)
        .all()
    ]
    actions = [
        r[0] for r in db.query(distinct(AuditLog.action))
        .order_by(AuditLog.action)
        .all()
    ]
    resource_types = [
        r[0] for r in db.query(distinct(AuditLog.resource_type))
        .filter(AuditLog.resource_type.isnot(None))
        .order_by(AuditLog.resource_type)
        .all()
    ]

    return {
        "usernames":      usernames,
        "actions":        actions,
        "resource_types": resource_types,
    }
