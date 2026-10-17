import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..core import scoping
from ..core.deps import get_current_user
from ..core.permissions import PERM_ARTIFACTS, has as perm_has
from ..database import get_db
from ..models.asset import Asset
from ..models.case import Case, CaseStatus
from ..models.client import Client
from ..models.ioc import IOC
from ..models.timeline import TimelineEvent
from ..models.user import User
from ..schemas.case import (
    BulkCaseResult,
    BulkCaseUpdate,
    CaseCreate,
    CaseRead,
    CaseSummary,
    CaseUpdate,
)
from ..services.audit_service import audit_log
from ..services.template_service import TemplateService

NOTE_IMAGES_DIR = settings.evidence_store_path.parent / "note_images"

router = APIRouter(prefix="/cases", tags=["cases"])


# ── Shared field handling ─────────────────────────────────────────────────────

def split_tags(raw: str | None) -> list[str]:
    """A case's tag string as a list, in the order it was written."""
    return [tag.strip() for tag in (raw or "").split(",") if tag.strip()]


def merge_tags(current: str | None, add: list[str], remove: list[str]) -> str:
    """
    `current` with `add` appended and `remove` taken out, as a tag string.

    Added rather than replaced, because a batch cannot know what each case
    carried of its own. Matching is case-insensitive in both directions: an
    analyst who types "Phishing" to remove the "phishing" they typed last week
    means the same tag, and leaving both would be the surprise.
    """
    tags   = split_tags(current)
    seen   = {tag.lower() for tag in tags}
    for tag in add:
        clean = tag.strip()
        if clean and clean.lower() not in seen:
            tags.append(clean)
            seen.add(clean.lower())
    dropped = {tag.strip().lower() for tag in remove if tag.strip()}
    return ", ".join(tag for tag in tags if tag.lower() not in dropped)


def apply_status(case: Case, new_status: CaseStatus) -> None:
    """
    Set the status and keep `closed_at` honest.

    Closing stamped the date and reopening left it, so a reopened case reported
    a closure date while its status said Open - and `{{case.closed_at}}` put
    that date in a client's report. Reopening clears it now.
    """
    case.status = new_status
    if new_status == CaseStatus.closed:
        if case.closed_at is None:
            case.closed_at = datetime.now(UTC)
    else:
        case.closed_at = None


class CaseSearchHit(BaseModel):
    case_id:      str
    case_title:   str
    client_name:  str | None
    match_type:   str   # "title" | "ioc" | "asset" | "timeline"
    match_field:  str   # the column that matched
    match_snippet: str  # short excerpt of the matching value


@router.get("/search", response_model=list[CaseSearchHit])
def search_cases(
    q: str = Query(..., min_length=2),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CaseSearchHit]:
    """
    Full-content case search.

    Searches case title and client name for everyone; IOC values, asset names /
    hostnames / IPs, and timeline titles for roles with artifact access.
    Returns one hit per matching field (multiple hits for the same case are
    possible — the frontend deduplicates by case_id for the case list).
    """
    term = q.strip().lower()
    if not term:
        return []

    # Limit to cases this user may see.
    visible_cases = (
        scoping.filter_cases(db.query(Case), current_user)
        .all()
    )
    visible_ids = {c.id for c in visible_cases}
    case_map:   dict[str, Case] = {c.id: c for c in visible_cases}

    hits: list[CaseSearchHit] = []

    def _hit(case_id: str, match_type: str, match_field: str, match_value: str) -> None:
        c = case_map[case_id]
        hits.append(CaseSearchHit(
            case_id      = case_id,
            case_title   = str(c.title),
            client_name  = str(c.client_name) if c.client_name else None,
            match_type   = match_type,
            match_field  = match_field,
            match_snippet = match_value[:120],
        ))

    # ── Case metadata (all roles) ─────────────────────────────────────────────
    for case in visible_cases:
        if term in str(case.title or '').lower():
            _hit(case.id, "title", "title", str(case.title))
        elif term in str(case.client_name or '').lower():
            _hit(case.id, "title", "client", str(case.client_name))
        elif term in str(case.tags or '').lower():
            _hit(case.id, "title", "tags", str(case.tags))

    # ── Artifact-level content (analyst / read_only / admin / owner only) ────
    if perm_has(current_user.role, PERM_ARTIFACTS):
        # IOCs
        ioc_rows = (
            db.query(IOC)
            .filter(
                IOC.case_id.in_(list(visible_ids)),
                IOC.value.ilike(f"%{q}%"),
            )
            .limit(200)
            .all()
        )
        for row in ioc_rows:
            _hit(str(row.case_id), "ioc", str(row.type.value), str(row.value))

        # IOC descriptions
        ioc_desc = (
            db.query(IOC)
            .filter(
                IOC.case_id.in_(list(visible_ids)),
                IOC.description.ilike(f"%{q}%"),
            )
            .limit(100)
            .all()
        )
        for row in ioc_desc:
            _hit(str(row.case_id), "ioc", "description", str(row.description or ''))

        # Assets — name, hostname, IP
        for field, col in [("name", Asset.name), ("hostname", Asset.hostname),
                           ("ip_address", Asset.ip_address)]:
            asset_rows = (
                db.query(Asset)
                .filter(
                    Asset.case_id.in_(list(visible_ids)),
                    col.ilike(f"%{q}%"),
                )
                .limit(100)
                .all()
            )
            for row in asset_rows:
                val = getattr(row, field, '') or ''
                if val:
                    _hit(str(row.case_id), "asset", field, str(val))

        # Timeline events — title
        tl_rows = (
            db.query(TimelineEvent)
            .filter(
                TimelineEvent.case_id.in_(list(visible_ids)),
                TimelineEvent.title.ilike(f"%{q}%"),
            )
            .limit(100)
            .all()
        )
        for row in tl_rows:
            _hit(str(row.case_id), "timeline", "title", str(row.title))

    return hits


@router.get("/", response_model=list[CaseSummary])
def list_cases(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Filtered explicitly: this query does not carry a case id in the path, so
    # the scoping dependency has nothing to check. See `core/scoping.py`.
    cases = (
        scoping.filter_cases(db.query(Case), current_user)
        .order_by(Case.updated_at.desc())
        .all()
    )
    result = []
    for case in cases:
        result.append(CaseSummary(
            id=case.id,
            title=case.title,
            status=case.status,
            severity=case.severity,
            tags=case.tags,
            assigned_to=case.assigned_to,
            tlp=case.tlp,
            case_type=case.case_type,
            client_name=case.client_name,
            client_id=case.client_id,
            created_at=case.created_at,
            updated_at=case.updated_at,
            ioc_count=len(case.iocs),
            asset_count=len(case.assets),
            evidence_count=len(case.evidences),
            timeline_count=len(case.timeline),
        ))
    return result


@router.post("/", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump()
    template_ttps: list[dict] = []

    client = None
    if data.get("client_id"):
        client = db.query(Client).filter(Client.id == data["client_id"]).first()
    if not client:
        client = db.query(Client).filter(Client.is_default == True).first()  # noqa: E712
    if client:
        data["client_id"] = client.id
        data["client_name"] = client.name

    if data.get("template_id"):
        tpl = TemplateService().get_template(data["template_id"])
        if tpl:
            if not data.get("executive_summary") and tpl.get("executive_summary_template"):
                data["executive_summary"] = tpl["executive_summary_template"]
            # Collect TTP definitions from the template (if any)
            template_ttps = tpl.get("ttp_definitions", [])

    case = Case(**data)
    db.add(case)
    db.flush()   # populate case.id before auditing

    # Seed TTPs from template
    if template_ttps:
        from ..models.mitre import CaseTTP
        for ttp_def in template_ttps:
            tid = ttp_def.get("technique_id", "").strip()
            if not tid:
                continue
            ttp = CaseTTP(
                id             = str(uuid.uuid4()),
                case_id        = case.id,
                technique_id   = tid,
                technique_name = ttp_def.get("technique_name"),
                tactic         = ttp_def.get("tactic", ""),
                tactic_name    = ttp_def.get("tactic_name"),
            )
            db.add(ttp)

    audit_log(db, user=current_user, action="case.create",
              resource_type="case", resource_id=case.id,
              resource_name=case.title, case_id=case.id, case_title=case.title)
    db.commit()
    db.refresh(case)

    # Drop folder for this case — created eagerly so the analyst can start
    # dropping artifacts straight away. Never fatal to case creation.
    try:
        from ..services.dropzone import ensure_case_folder
        ensure_case_folder(case)
    except Exception as e:
        print(f"[cases] could not create drop folder for {case.id}: {e}", flush=True)

    return case


@router.patch("/bulk", response_model=BulkCaseResult)
def bulk_update_cases(
    payload: BulkCaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Apply one change to several cases.

    **Declared before `/{case_id}`, and that matters.** FastAPI matches routes in
    the order they are declared, so with this below the parameterised route
    every call would arrive at `update_case` with `case_id="bulk"` and answer
    404. A test pins the order rather than a comment asking nobody to move it.

    **Scoping is explicit here.** Almost every case route carries the case id in
    its path, which is what `enforce_permissions` checks. This one carries them
    in the body, where that dependency cannot see them - so the query is filtered
    the same way the case list is, and cases an account may not see come back as
    skipped rather than quietly updated.

    One audit entry per case, not one for the batch. The trail is read from a
    case: "who closed this and when" has to be answerable from the case that was
    closed, and an entry naming thirty others does not answer it.
    """
    if not payload.case_ids:
        raise HTTPException(status_code=400, detail="No cases given")

    visible = (
        scoping.filter_cases(db.query(Case), current_user)
        .filter(Case.id.in_(payload.case_ids))
        .all()
    )
    by_id = {str(case.id): case for case in visible}

    fields: list[str] = []
    if payload.status      is not None: fields.append("status")
    if payload.severity    is not None: fields.append("severity")
    if payload.assigned_to is not None: fields.append("assigned_to")
    if payload.add_tags or payload.remove_tags: fields.append("tags")
    if not fields:
        raise HTTPException(status_code=400, detail="No change requested")

    now = datetime.now(UTC)
    for case in visible:
        if payload.status is not None:
            apply_status(case, payload.status)
        if payload.severity is not None:
            case.severity = payload.severity
        if payload.assigned_to is not None:
            case.assigned_to = payload.assigned_to
        if payload.add_tags or payload.remove_tags:
            case.tags = merge_tags(
                str(case.tags or ""), payload.add_tags, payload.remove_tags)
        case.updated_at = now
        audit_log(db, user=current_user, action="case.bulk_update",
                  resource_type="case", resource_id=str(case.id),
                  resource_name=str(case.title), case_id=str(case.id),
                  case_title=str(case.title),
                  details={"fields": fields, "batch_size": len(payload.case_ids)})
    db.commit()

    return BulkCaseResult(
        updated = [str(case.id) for case in visible],
        skipped = [cid for cid in payload.case_ids if cid not in by_id],
        fields  = fields,
    )


@router.get("/{case_id}", response_model=CaseRead)
def get_case(case_id: str, db: Session = Depends(get_db)):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.patch("/{case_id}", response_model=CaseRead)
def update_case(
    case_id: str,
    payload: CaseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("client_id"):
        client = db.query(Client).filter(Client.id == updates["client_id"]).first()
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        updates["client_name"] = client.name
    for key, value in updates.items():
        setattr(case, key, value)
    if "status" in updates and updates["status"] is not None:
        apply_status(case, CaseStatus(updates["status"]))
    case.updated_at = datetime.now(UTC)
    audit_log(db, user=current_user, action="case.update",
              resource_type="case", resource_id=case_id,
              resource_name=case.title, case_id=case_id, case_title=case.title,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(case)
    return case


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    audit_log(db, user=current_user, action="case.delete",
              resource_type="case", resource_id=case_id,
              resource_name=case.title, case_id=case_id, case_title=case.title)
    db.delete(case)
    db.commit()


# ── Note images ───────────────────────────────────────────────────────────────

@router.post("/{case_id}/notes/images")
async def upload_note_image(
    case_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    An image pasted into a case note.

    Audited because the directory it lands in is **served without
    authentication** - anything uploaded here is readable by anyone who can
    guess the URL, and the trail is the only record of what was put there.
    """
    dest_dir = NOTE_IMAGES_DIR / case_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "image.png").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = dest_dir / filename
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    audit_log(db, user=current_user, action="case.note_image_upload",
              resource_type="note_image", resource_id=filename,
              resource_name=str(file.filename or filename), case_id=case_id,
              details={"bytes": dest.stat().st_size})
    db.commit()

    # Served by StaticFiles mounted at /note-images (no auth)
    return {"url": f"/note-images/{case_id}/{filename}"}
