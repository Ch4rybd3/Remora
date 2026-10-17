"""
Parsing coverage — /api/v1/coverage

"Which artifacts does Remora support?" answered from the tables that do the
supporting, rather than from a document somebody has to remember to update.

The router holds no knowledge. `services/ingest/coverage.py` joins the
identification, routing and parser registries; this exposes the result.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..core.deps import get_current_user
from ..services.ingest import coverage as coverage_service

router = APIRouter(tags=["coverage"])


class CoverageRow(BaseModel):
    kind:          str
    label:         str
    #: magic, extension, filename, folder, or "inside <container>"
    recognised_by: list[str]
    #: The extensions and names that reach this kind.
    formats:       list[str]
    destination:   str | None
    parser:        str | None
    #: Who does the work: an Eric Zimmerman tool, a Remora parser, or a module.
    engine:        str | None
    status:        str
    status_label:  str
    note:          str
    #: Frontend routes where an artifact of this kind can be opened.
    pages:         list[str]


class CoverageOut(BaseModel):
    #: Kinds per status, for the headline counts.
    summary: dict[str, int]
    #: Status key to the label the UI should print.
    labels:  dict[str, str]
    kinds:   list[CoverageRow]


@router.get("/coverage", response_model=CoverageOut)
def get_coverage(current_user=Depends(get_current_user)) -> dict:
    """Every artifact kind the pipeline recognises, and what happens to it."""
    return {
        "summary": coverage_service.summary(),
        "labels":  coverage_service.STATUS_LABELS,
        "kinds":   coverage_service.as_dicts(),
    }
