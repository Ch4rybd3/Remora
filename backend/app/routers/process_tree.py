"""
Process tree — /api/v1/cases/{case_id}/process-tree

What ran, and what launched it, assembled from the event logs already in the
case. Nothing is ingested here: the tree is a view over `evtx_events`, so it
reflects whatever has been imported at the moment it is asked for.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..core.scoping import assert_case_in_scope
from ..database import get_db
from ..services import process_tree as tree

router = APIRouter(tags=["process-tree"])


@router.get("/cases/{case_id}/process-tree")
def get_process_tree(
    case_id: str,
    limit: int = Query(tree.MAX_PROCESSES, ge=1, le=tree.MAX_PROCESSES),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict:
    """
    The case's process tree.

    Built on request rather than stored. A stored tree would be wrong the
    moment another event log was imported, and rebuilding it is cheap: the four
    event ids that matter are filtered in SQL, so a case with half a million
    events reads a few thousand rows.

    Every node carries how its parent link was established - `asserted` when
    Sysmon named the parent by GUID, `inferred` when it was matched by PID
    inside a lifetime window, `orphan` when no parent was in the logs at all.
    """
    assert_case_in_scope(db, current_user, case_id)
    return tree.build(db, case_id, limit=limit)
