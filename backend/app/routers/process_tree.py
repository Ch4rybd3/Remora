"""
Process tree — /api/v1/cases/{case_id}/process-tree

What ran, and what launched it, assembled from the parsed event logs already in
the case. Nothing is ingested here and nothing is stored: the tree is a view
over the Artifact Explorer's tables, so it reflects whatever has been imported
at the moment it is asked for.

Two ways to ask. Without a focus, the whole case - what the old case tab
showed. With one, a single process and its line, which is what an analyst
right-clicking a suspicious event actually wants: the chain that produced it
and what it went on to do, not twenty thousand nodes to search.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..core.scoping import assert_case_in_scope
from ..database import get_db
from ..services import process_tree as tree

router = APIRouter(tags=["process-tree"])


def _parse_at(raw: str | None) -> datetime | None:
    """
    The event's own timestamp, as sent by the table the analyst clicked in.

    Unparseable is not an error: `at` only breaks ties between processes that
    shared a PID, so losing it widens the answer rather than invalidating it.
    """
    if not raw:
        return None
    value = raw.strip().replace("Z", "").replace("T", " ")
    for shape in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, shape)
        except ValueError:
            continue
    return None


@router.get("/cases/{case_id}/process-tree")
def get_process_tree(
    case_id: str,
    limit: int = Query(tree.MAX_PROCESSES, ge=1, le=tree.MAX_PROCESSES),
    guid:  str | None = Query(None, description="Sysmon process GUID to focus on"),
    pid:   int | None = Query(None, description="Process id to focus on"),
    at:    str | None = Query(None, description="The focused event's timestamp"),
    image: str | None = Query(None, description="Executable name, to break a PID tie"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> dict:
    """
    The case's process tree, whole or around one process.

    Built on request rather than stored. A stored tree would be wrong the
    moment another event log was imported, and rebuilding it is cheap: the four
    event ids that matter are pushed down to the store, so a case with half a
    million events reads a few thousand rows.

    Every node carries how its parent link was established - `asserted` when
    Sysmon named the parent by GUID, `inferred` when it was matched by PID
    inside a lifetime window, `orphan` when no parent was in the logs at all.

    `focus.found` is false when the process asked about is not in these logs.
    That is a different answer from an empty tree, and the caller has to be
    able to tell them apart: one means "nothing was collected", the other
    means "this ran on a machine whose logs you do not have".
    """
    assert_case_in_scope(db, current_user, case_id)

    focus = None
    if guid or pid is not None:
        focus = tree.Focus(guid=guid or None, pid=pid,
                           at=_parse_at(at), image=image or None)

    return tree.build(db, case_id, limit=limit, focus=focus)
