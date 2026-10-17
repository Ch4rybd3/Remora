"""
Browser history reader — /api/v1/cases/{case_id}/browser

The browser parser produces one CSV per question (history, downloads,
cookies, logins). Those CSVs land in the artifact store as regular
CsvArtifactFile rows with ez_label = "browser_history" / "browser_downloads"
/ "browser_cookies" / "browser_logins". This router surfaces them through a
dedicated endpoint so the frontend can show a browser-specific view rather
than the generic explorer.

No new models, no migrations: everything is already on disk.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.csv_artifact import CsvArtifactFile
from ..models.user import User
from ..services.store import Query as StoreQuery
from ..services.store import SourceMissing, get_store

router = APIRouter(tags=["browser"])

# Kind → ez_label mapping.  The parser uses these exact strings.
_KIND_LABEL: dict[str, str] = {
    "history":   "browser_history",
    "downloads": "browser_downloads",
    "cookies":   "browser_cookies",
    "logins":    "browser_logins",
}


def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


def _source(artifact: CsvArtifactFile):
    from ..services.store import as_source
    return as_source(artifact.file_path, artifact.source_timezone)


@router.get("/cases/{case_id}/browser/")
def list_browser_files(
    case_id: str,
    db:      Session = Depends(get_db),
    _:       User    = Depends(get_current_user),
) -> list[dict]:
    """List all browser CSV artifacts available for this case."""
    _get_case_or_404(case_id, db)
    rows = (
        db.query(CsvArtifactFile)
        .filter(
            CsvArtifactFile.case_id == case_id,
            CsvArtifactFile.ez_label.in_(list(_KIND_LABEL.values())),
        )
        .order_by(CsvArtifactFile.uploaded_at.desc())
        .all()
    )
    import os
    return [
        {
            "id":         r.id,
            "ez_label":   r.ez_label,
            "row_count":  r.row_count,
            "uploaded_at": r.uploaded_at.isoformat(),
            "available":  os.path.exists(str(r.file_path)),
        }
        for r in rows
    ]


@router.get("/cases/{case_id}/browser/{kind}")
def get_browser_rows(
    case_id:   str,
    kind:      str,
    page:      int      = Query(1, ge=1),
    page_size: int      = Query(100, ge=1, le=2000),
    sort_col:  str | None = Query(None),
    sort_dir:  str      = Query("desc"),
    q:         str | None = Query(None),
    db:        Session  = Depends(get_db),
    _:         User     = Depends(get_current_user),
) -> dict:
    """Paginated rows for a browser artifact kind (history/downloads/cookies/logins)."""
    if kind not in _KIND_LABEL:
        raise HTTPException(status_code=400, detail=f"Unknown kind '{kind}'. "
                            f"Valid: {', '.join(_KIND_LABEL)}")
    _get_case_or_404(case_id, db)

    ez_label = _KIND_LABEL[kind]
    artifact = (
        db.query(CsvArtifactFile)
        .filter(
            CsvArtifactFile.case_id == case_id,
            CsvArtifactFile.ez_label == ez_label,
        )
        .order_by(CsvArtifactFile.uploaded_at.desc())
        .first()
    )
    if artifact is None:
        return {"total": 0, "pages": 0, "page": page, "page_size": page_size,
                "columns": [], "items": [], "artifact_id": None}

    cols = json.loads(artifact.columns)

    # Default sort: timestamp column desc so newest appears first.
    effective_sort = sort_col or artifact.date_column
    # Browsers store times in VisitTime / StartTime / Created / LastUsed.
    if effective_sort is None:
        ts_candidates = ["VisitTime", "StartTime", "Created", "LastUsed", "LastAccess"]
        effective_sort = next((c for c in ts_candidates if c in cols), None)

    try:
        result = get_store().search(
            _source(artifact), cols,
            StoreQuery(text=q),
            sort_col=effective_sort, sort_dir=sort_dir,
            page=page, page_size=page_size,
        )
    except SourceMissing:
        raise HTTPException(
            status_code=410,
            detail=f"Browser {kind} file is registered but no longer on disk.",
        )

    return {
        "total":       result.total,
        "pages":       result.pages,
        "page":        page,
        "page_size":   page_size,
        "columns":     cols,
        "items":       result.rows,
        "artifact_id": artifact.id,
    }
