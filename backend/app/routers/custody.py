"""
Chain of custody router — /api/v1/cases/{case_id}/custody

The one place an artifact is promoted to evidence, whatever page the analyst is
looking at. A page that lists artifacts calls this; it does not grow its own
promotion logic. Adding a new artifact page means registering a source kind in
`services/custody.py`, not writing this again.

Promotion copies the file into the evidence store, which is what makes the
90-day collection expiry stop applying to it. Withdrawal deletes that copy and
is guarded accordingly.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.evidence import Evidence
from ..models.user import User
from ..services.audit_service import audit_log
from ..services.custody import (
    KNOWN_SOURCE_KINDS,
    PromotionError,
    custody_status,
    promote,
    withdraw,
)

router = APIRouter(tags=["custody"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _dto(ev: Evidence) -> dict:
    contained = bool(ev.file_path and str(ev.file_path).endswith(".ioc.zip"))
    return {
        "id":                ev.id,
        "name":              ev.name,
        "description":       ev.description,
        "evidence_type":     ev.evidence_type.value if ev.evidence_type else None,
        "original_filename": ev.original_filename,
        "file_size":         ev.file_size,
        "md5_hash":          ev.md5_hash,
        "sha256_hash":       ev.sha256_hash,
        "collected_by":      ev.collected_by,
        "collected_at":      ev.collected_at.isoformat() if ev.collected_at else None,
        "tags":              ev.tags,
        "chain_of_custody":  ev.chain_of_custody,
        "contained":         contained,
        # Shown next to the download so nobody has to be told the password out
        # of band. It is containment, not confidentiality - see services/custody.py.
        "archive_password":  settings.ioc_archive_password if contained else None,
        "created_at":        ev.created_at.isoformat() if ev.created_at else None,
    }


@router.get("/cases/{case_id}/custody")
def list_custody(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Everything preserved for this case, newest first."""
    _get_case(case_id, db)
    rows = (
        db.query(Evidence)
        .filter(Evidence.case_id == case_id)
        .order_by(Evidence.created_at.desc())
        .all()
    )
    return {"items": [_dto(e) for e in rows], "summary": custody_status(db, case_id)}


@router.post("/cases/{case_id}/custody", status_code=status.HTTP_201_CREATED)
def promote_to_custody(
    case_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Preserve an artifact as evidence.

    Body: `{"kind": "ingested_file", "source_id": "...", "as_ioc": false,
            "name": "...", "description": "...", "tags": "..."}`

    `as_ioc` wraps the preserved copy in a password-protected archive. Use it
    for anything that could execute: the containment is what stops a
    double-click after download, and stops endpoint protection quarantining a
    sample out of the evidence store.
    """
    case = _get_case(case_id, db)

    kind = str((body or {}).get("kind") or "")
    source_id = str((body or {}).get("source_id") or "")
    if kind not in KNOWN_SOURCE_KINDS:
        raise HTTPException(
            400, f"Unknown source kind '{kind}'. Known: {', '.join(sorted(KNOWN_SOURCE_KINDS))}")
    if not source_id:
        raise HTTPException(400, "source_id is required")

    try:
        evidence = promote(
            db,
            case_id=case_id,
            case_title=str(case.title),
            kind=kind,
            source_id=source_id,
            username=str(current_user.username),
            as_ioc=bool(body.get("as_ioc")),
            name=body.get("name"),
            description=body.get("description"),
            tags=body.get("tags"),
            commit=False,
        )
    except PromotionError as e:
        raise HTTPException(409, str(e)) from None

    audit_log(db, user=current_user, action="custody.promote",
              resource_type="evidence", resource_id=str(evidence.id),
              resource_name=str(evidence.name), case_id=case_id,
              case_title=str(case.title),
              details={"kind": kind, "source_id": source_id,
                       "contained": bool(body.get("as_ioc"))})
    db.commit()
    db.refresh(evidence)
    return _dto(evidence)


@router.delete("/cases/{case_id}/custody/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_from_custody(
    case_id: str,
    evidence_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Remove an item from the chain of custody and delete its preserved copy.

    Body: `{"reason": "..."}` - required. Withdrawing preserved evidence is not
    a routine action, and an unexplained one is exactly the gap a chain of
    custody exists to close. The frontend asks for confirmation; the reason is
    what makes the record of that confirmation worth anything.
    """
    case = _get_case(case_id, db)

    evidence = (
        db.query(Evidence)
        .filter(Evidence.id == evidence_id, Evidence.case_id == case_id)
        .first()
    )
    if not evidence:
        raise HTTPException(404, "Evidence item not found")

    reason = str((body or {}).get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "A reason is required to withdraw an item from custody")

    name = str(evidence.name)
    # Audited before the row goes: the audit entry is the only thing that will
    # still exist afterwards, and it has to name what was removed and why.
    audit_log(db, user=current_user, action="custody.withdraw",
              resource_type="evidence", resource_id=evidence_id,
              resource_name=name, case_id=case_id, case_title=str(case.title),
              details={"reason": reason, "sha256": str(evidence.sha256_hash or "")})

    try:
        withdraw(db, evidence, str(current_user.username), reason, commit=False)
    except PromotionError as e:
        raise HTTPException(409, str(e)) from None

    db.commit()


@router.get("/custody/source-kinds")
def list_source_kinds(current_user: User = Depends(get_current_user)):
    """
    What can be promoted. Lets a page check it is registered before offering
    the button, rather than discovering it is not on the first click.
    """
    return {"kinds": sorted(KNOWN_SOURCE_KINDS)}
