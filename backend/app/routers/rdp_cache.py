"""
RDP Cache — /api/v1/cases/{case_id}/rdp-cache

`mstsc` caches the remote screen in 64x64 tiles and keeps them on disk. The
ingest pipeline decodes them into contact sheets and an index table; this
serves both, because the Artifact Explorer shows tables and these are pictures.

**No table of its own.** A cache's index is a `csv_artifact_files` row like any
other parser output, and the sheets sit beside it in the same directory. That
means deleting the collection removes both with no extra bookkeeping, and the
chain of custody works on the index without this module knowing anything about
it.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..core.scoping import assert_case_in_scope
from ..database import get_db
from ..models.csv_artifact import CsvArtifactFile
from ..services.store import Query, get_store

router = APIRouter(tags=["rdp-cache"])

#: What the parser calls its index. Matching on the name is what lets this
#: module find its own output without a second table recording where it went.
INDEX_NAME = "rdp_bitmap_cache.csv"


def _indexes(case_id: str, db: Session) -> list[CsvArtifactFile]:
    return (
        db.query(CsvArtifactFile)
        .filter(CsvArtifactFile.case_id == case_id,
                CsvArtifactFile.original_name == INDEX_NAME)
        .order_by(CsvArtifactFile.uploaded_at.desc())
        .all()
    )


def _get_index(case_id: str, artifact_id: str, db: Session) -> CsvArtifactFile:
    row = (
        db.query(CsvArtifactFile)
        .filter(CsvArtifactFile.id == artifact_id,
                CsvArtifactFile.case_id == case_id,
                CsvArtifactFile.original_name == INDEX_NAME)
        .first()
    )
    if not row:
        raise HTTPException(404, "Cache index not found")
    return row


@router.get("/cases/{case_id}/rdp-cache")
def list_caches(case_id: str, db: Session = Depends(get_db),
                current_user=Depends(get_current_user)) -> list[dict]:
    """
    Every decoded cache in this case, by source file and sheet.

    Counted through the artifact store rather than by reading the CSV: the
    index for a full triage runs to 38,000 rows, and the store has already
    converted it to a columnar form that answers a group-by without parsing
    anything.
    """
    assert_case_in_scope(db, current_user, case_id)

    result: list[dict] = []
    for index in _indexes(case_id, db):
        columns = json.loads(str(index.columns))
        path = Path(str(index.file_path))
        if not path.exists():
            result.append({
                "artifact_id": index.id, "available": False,
                "tiles": int(index.row_count or 0), "sources": [],
            })
            continue

        try:
            groups = get_store().aggregate(
                str(path), columns, Query(), ["SourceFile", "Sheet"])
        except Exception:
            groups = []

        by_source: dict[str, list[dict]] = {}
        for group in groups:
            source = str(group.values.get("SourceFile", ""))
            by_source.setdefault(source, []).append({
                "sheet": str(group.values.get("Sheet", "")),
                "tiles": group.count,
            })

        result.append({
            "artifact_id": index.id,
            "available":   True,
            "tiles":       int(index.row_count or 0),
            "uploaded_at": index.uploaded_at.isoformat() if index.uploaded_at else None,
            "sources": [
                {"source": name,
                 "sheets": sorted(sheets, key=lambda entry: str(entry["sheet"]))}
                for name, sheets in sorted(by_source.items())
            ],
        })
    return result


@router.get("/cases/{case_id}/rdp-cache/{artifact_id}/sheets/{sheet}")
def get_sheet(case_id: str, artifact_id: str, sheet: str,
              db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    One contact sheet, as a PNG.

    The filename is checked against the sheet names the index actually
    contains, not merely sanitised. An allowlist drawn from the artifact's own
    data cannot be walked out of, whatever the request asks for.
    """
    assert_case_in_scope(db, current_user, case_id)
    index = _get_index(case_id, artifact_id, db)

    columns = json.loads(str(index.columns))
    source = Path(str(index.file_path))
    if not source.exists():
        raise HTTPException(410, "The cache index is registered but its file is gone")

    try:
        known = {
            str(group.values.get("Sheet", ""))
            for group in get_store().aggregate(str(source), columns, Query(), ["Sheet"])
        }
    except Exception:
        known = set()

    if sheet not in known:
        raise HTTPException(404, "No such sheet in this cache")

    target = source.parent / sheet
    if not target.is_file():
        raise HTTPException(410, "The sheet was indexed but its image is gone")

    return FileResponse(path=str(target), media_type="image/png", filename=sheet)
