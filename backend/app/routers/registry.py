"""
Registry Explorer — /api/v1/cases/{case_id}/registry

Browsing a hive rather than parsing one. `SOFTWARE`, `SECURITY` and `SAM` were
recognised by the pipeline and deliberately left unparsed, because which keys
matter is an analyst's decision and shipping a list of them would quietly
define what "the registry" means for every investigation. Navigation is the
answer that does not make that choice.

**No table of its own.** The hives listed here are `ingested_files` rows whose
detected kind is `registry_hive` - the same rows the ingest queue shows, read
from where the pipeline stored them. A second table would be a second thing to
keep in step, and would survive the collection its files came from.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..core.scoping import assert_case_in_scope
from ..database import get_db
from ..models.case import Case
from ..models.ingest import STATE_DUPLICATE, IngestedFile
from ..services import registry as reg
from ..services.ingest.dispatch import resolve_stored_path

router = APIRouter(tags=["registry"])

#: The kind identification gives every hive. Refinement by filename happens in
#: the parser table, not here - this page opens all of them the same way.
HIVE_KIND = "registry_hive"


def _get_case(case_id: str, db: Session, user) -> Case:
    # Scope first: a scoped account must not be able to learn that a case
    # exists from the shape of the refusal.
    assert_case_in_scope(db, user, case_id)
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_hive(case_id: str, hive_id: str, db: Session) -> tuple[IngestedFile, Path]:
    """
    The ingest row and the file behind it, or a 404/410 saying which is missing.

    Scoped by case in the query rather than checked afterwards: a hive id from
    another investigation must not resolve to a path, whatever else is true
    about the request.
    """
    row = (
        db.query(IngestedFile)
        .filter(IngestedFile.id == hive_id, IngestedFile.case_id == case_id)
        .first()
    )
    if not row:
        raise HTTPException(404, "Hive not found")

    path = resolve_stored_path(str(row.stored_path or ""))
    if path is None:
        # 410, not 404: the record is right here. What is gone is the file.
        raise HTTPException(
            410,
            f"'{row.original_name}' is registered but its file is no longer on "
            f"disk. It was most likely removed with the collection it came from.")
    return row, path


def _hive_dto(row: IngestedFile, available: bool) -> dict:
    return {
        "id":            row.id,
        "name":          row.original_name,
        "size_bytes":    row.size_bytes,
        "sha256":        row.sha256,
        "collection_id": row.collection_id,
        "state":         row.state,
        "preserved":     bool(row.evidence_id),
        "available":     available,
        "created_at":    row.created_at.isoformat() if row.created_at else None,
    }


# ─── Hives ────────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/registry/hives")
def list_hives(case_id: str, db: Session = Depends(get_db),
               current_user=Depends(get_current_user)) -> list[dict]:
    """Every registry hive the pipeline has ingested into this case."""
    _get_case(case_id, db, current_user)
    rows = (
        db.query(IngestedFile)
        .filter(
            IngestedFile.case_id == case_id,
            IngestedFile.detected_kind == HIVE_KIND,
            # A duplicate is the same bytes under a second name. Listing it
            # would offer the analyst two identical trees to choose between.
            IngestedFile.state != STATE_DUPLICATE,
        )
        .order_by(IngestedFile.original_name.asc())
        .all()
    )
    return [
        _hive_dto(row, resolve_stored_path(str(row.stored_path or "")) is not None)
        for row in rows
    ]


@router.get("/cases/{case_id}/registry/hives/{hive_id}")
def hive_info(case_id: str, hive_id: str, db: Session = Depends(get_db),
              current_user=Depends(get_current_user)) -> dict:
    """
    What the hive's header says, before a key is read.

    Includes the two warnings that decide how much the contents can be trusted:
    a hive collected mid-write, and one collected mid-transaction. Remora reads
    it as it stands - replaying the transaction logs would mean writing to
    evidence - so an analyst has to be told when the newest values may be
    missing.
    """
    _get_case(case_id, db, current_user)
    row, path = _get_hive(case_id, hive_id, db)
    try:
        detail = reg.info(path)
    except reg.RegistryError as e:
        raise HTTPException(422, str(e))

    return {
        **_hive_dto(row, True),
        "internal_name":  detail.internal_name,
        "version":        detail.version,
        "dirty":          detail.dirty,
        "in_transaction": detail.in_transaction,
        "root_name":      detail.root_name,
        "subkey_count":   detail.subkey_count,
        "value_count":    detail.value_count,
        # Said on the hive rather than in a manual. Registry Explorer does both
        # of these and an analyst coming from it will expect them.
        "limitations": [
            "Transaction logs are not replayed, so a dirty hive is read as it "
            "stands and its newest writes may be missing.",
            "Deleted keys and values are not recovered from unallocated space.",
        ],
    }


# ─── Navigation ───────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/registry/hives/{hive_id}/keys")
def list_keys(
    case_id: str, hive_id: str,
    path: str = Query("", description="Key path from the hive root, backslash separated"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
) -> dict:
    """One level of the tree. Lazy: a hive holds far too much to send at once."""
    _get_case(case_id, db, current_user)
    _, file_path = _get_hive(case_id, hive_id, db)
    try:
        entries = reg.list_keys(file_path, path)
    except reg.RegistryError as e:
        raise HTTPException(404, str(e))

    return {
        "path": path,
        "keys": [
            {
                "name":         entry.name,
                "path":         entry.path,
                "subkey_count": entry.subkey_count,
                "value_count":  entry.value_count,
                "last_written": entry.last_written.isoformat() if entry.last_written else None,
            }
            for entry in entries
        ],
    }


@router.get("/cases/{case_id}/registry/hives/{hive_id}/values")
def list_values(
    case_id: str, hive_id: str,
    path: str = Query("", description="Key path from the hive root"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
) -> dict:
    """The values held at one key, with a preview of each."""
    _get_case(case_id, db, current_user)
    _, file_path = _get_hive(case_id, hive_id, db)
    try:
        entries = reg.list_values(file_path, path)
    except reg.RegistryError as e:
        raise HTTPException(404, str(e))

    return {
        "path": path,
        "values": [
            {
                "name":      entry.name,
                "type":      entry.type,
                "size":      entry.size,
                "preview":   entry.preview,
                "truncated": entry.truncated,
            }
            for entry in entries
        ],
    }


@router.get("/cases/{case_id}/registry/hives/{hive_id}/value")
def value_detail(
    case_id: str, hive_id: str,
    path: str = Query(..., description="Key path from the hive root"),
    name: str = Query(..., description="Value name"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
) -> dict:
    """
    One value in full, as text and as bytes.

    Both, because they answer different questions. The text is what the value
    means; the hex is what is stored, which is what an analyst quotes when the
    two disagree - a `REG_SZ` holding a path with a trailing null being the
    case that comes up most.
    """
    _get_case(case_id, db, current_user)
    _, file_path = _get_hive(case_id, hive_id, db)
    try:
        return reg.value_detail(file_path, path, name)
    except reg.RegistryError as e:
        raise HTTPException(404, str(e))


@router.get("/cases/{case_id}/registry/hives/{hive_id}/search")
def search(
    case_id: str, hive_id: str,
    q:      str  = Query(..., min_length=2),
    limit:  int  = Query(200, ge=1, le=1000),
    values: bool = Query(True,  description="Match value names"),
    data:   bool = Query(True,  description="Match value data"),
    db: Session = Depends(get_db), current_user=Depends(get_current_user),
) -> dict:
    """
    Find a string anywhere in the hive.

    Bounded by a key budget as well as a result limit. A `SOFTWARE` hive holds
    hundreds of thousands of keys, and `exhausted` says the walk stopped early
    rather than letting a partial answer pass for a complete one.
    """
    _get_case(case_id, db, current_user)
    _, file_path = _get_hive(case_id, hive_id, db)
    try:
        result = reg.search(file_path, q, limit=limit, in_values=values, in_data=data)
    except reg.RegistryError as e:
        raise HTTPException(422, str(e))

    return {
        "query":     q,
        "exhausted": result.exhausted,
        "scanned":   result.scanned,
        "hits": [
            {
                "key_path":   hit.key_path,
                "value_name": hit.value_name,
                "matched":    hit.matched,
                "preview":    hit.preview,
            }
            for hit in result.hits
        ],
    }
