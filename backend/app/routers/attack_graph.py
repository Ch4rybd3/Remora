"""
Attack Graph API — one graph per case, stored as React Flow nodes/edges JSON.
"""
from __future__ import annotations

# A canvas screenshot; anything past this is not a graph, it is a mistake.
MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.attack_graph import AttackGraph
from ..models.case import Case
from ..models.user import User
from ..schemas.attack_graph import AttackGraphRead, AttackGraphSave
from ..services.audit_service import audit_log
from ..services.graph_render import render_attack_graph_png

router = APIRouter(tags=["attack_graph"])


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/cases/{case_id}/attack-graph", response_model=AttackGraphRead)
def get_attack_graph(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    graph = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    if not graph:
        # Return empty graph — no 404, just an empty canvas
        return AttackGraphRead(
            case_id=case_id,
            nodes=[],
            edges=[],
            updated_at=datetime.now(UTC),
        )
    return graph


@router.put("/cases/{case_id}/attack-graph/snapshot", status_code=204)
async def save_attack_graph_snapshot(
    case_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Store a PNG of the canvas, rasterised by the browser that drew it.

    The server can redraw this graph from the stored coordinates, and still does
    when no snapshot exists — but a redrawing never quite matches the screen.
    Keeping what the analyst actually saw is what lets the report embed the
    picture they arranged rather than an approximation of it.
    """
    case = _get_case(case_id, db)
    png = await request.body()
    if not png.startswith(b"\x89PNG"):
        raise HTTPException(status_code=400, detail="Body must be a PNG image")
    if len(png) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Snapshot exceeds {MAX_SNAPSHOT_BYTES // 1024 // 1024} MB",
        )

    graph = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    if not graph:
        raise HTTPException(status_code=404, detail="This case has no attack graph yet")

    graph.snapshot_png = png
    graph.snapshot_at = datetime.now(UTC)
    # Recorded separately from the save above, because this is the picture that
    # `{{attack_graph}}` puts in a client's report. "Who produced the figure the
    # client saw" is a different question from "who drew the graph".
    audit_log(db, user=current_user, action="attack_graph.snapshot",
              resource_type="attack_graph", resource_id=case_id,
              case_id=case_id, case_title=str(case.title),
              details={"bytes": len(png)})
    db.commit()
    return Response(status_code=204)


@router.get("/cases/{case_id}/attack-graph/png")
def export_attack_graph_png(case_id: str, db: Session = Depends(get_db)):
    """
    The graph as a PNG.

    Prefers the snapshot the browser stored, which is the canvas as the analyst
    arranged it. Falls back to rendering server-side when no snapshot exists —
    a graph saved before this feature, or one whose tab was never opened.
    """
    case = _get_case(case_id, db)
    graph = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    if not graph or not graph.nodes:
        raise HTTPException(status_code=404, detail="This case has no attack graph yet")

    png = graph.snapshot_png or render_attack_graph_png(graph.nodes, graph.edges or [])
    if png is None:
        raise HTTPException(
            status_code=503,
            detail="Graph rendering is unavailable — matplotlib is not installed in the backend image",
        )

    filename = f"{case.title.replace(' ', '_')}_attack_graph.png"
    return Response(
        content=png,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/cases/{case_id}/attack-graph", response_model=AttackGraphRead)
def save_attack_graph(
    case_id: str,
    payload: AttackGraphSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    graph = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    if graph:
        graph.nodes      = payload.nodes
        graph.edges      = payload.edges
        graph.updated_at = datetime.now(UTC)
    else:
        graph = AttackGraph(
            case_id=case_id,
            nodes=payload.nodes,
            edges=payload.edges,
        )
        db.add(graph)
    # The graph is the analyst's reconstruction of the attack, not a view of
    # data recorded elsewhere. Who asserted which machine reached which, and
    # when they asserted it, is the kind of thing an investigation into the
    # investigation asks about.
    audit_log(db, user=current_user, action="attack_graph.save",
              resource_type="attack_graph", resource_id=case_id,
              case_id=case_id, case_title=str(case.title),
              details={"nodes": len(payload.nodes), "edges": len(payload.edges)})
    db.commit()
    db.refresh(graph)
    return graph
