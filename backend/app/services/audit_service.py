"""
Centralized audit logging service.

Usage in routers:
    from ..services.audit_service import audit_log

    # inside an endpoint, after the main DB write, before or at commit:
    audit_log(db, user=current_user, action="case.create",
              resource_type="case", resource_id=case.id,
              resource_name=case.title, request=request)
    db.commit()

The entry is added to the session — it commits together with the main
operation, so if the main operation rolls back, the audit entry does too.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from ..models.audit import AuditLog

if TYPE_CHECKING:
    from fastapi import Request

    from ..models.user import User


def audit_log(
    db: Session,
    *,
    user: User,
    action: str,
    resource_type: str | None = None,
    resource_id:   str | None = None,
    resource_name: str | None = None,
    case_id:       str | None = None,
    case_title:    str | None = None,
    details:       dict[str, Any] | None = None,
    request:       Request | None = None,
) -> None:
    """
    Append an audit entry to the current DB session.

    Do NOT call db.commit() here — the caller's commit will persist it.
    If you need a fire-and-forget audit (outside a transaction), call
    db.commit() after this function.
    """
    ip: str | None = None
    if request is not None:
        try:
            ip = request.client.host if request.client else None
        except Exception:
            ip = None

    entry = AuditLog(
        username      = getattr(user, "username", str(user)),
        user_role     = getattr(user, "role", None) and str(user.role.value),
        action        = action,
        resource_type = resource_type,
        resource_id   = str(resource_id) if resource_id is not None else None,
        resource_name = str(resource_name)[:512] if resource_name is not None else None,
        case_id       = str(case_id) if case_id is not None else None,
        case_title    = str(case_title)[:512] if case_title is not None else None,
        details       = details,
        ip_address    = ip,
    )
    db.add(entry)
