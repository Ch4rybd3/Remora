"""
Attack Graph API — one graph per case, stored as React Flow nodes/edges JSON.
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.attack_graph import AttackGraph
from ..models.case import Case
from ..schemas.attack_graph import AttackGraphRead, AttackGraphSave
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


@router.get("/cases/{case_id}/attack-graph/png")
def export_attack_graph_png(case_id: str, db: Session = Depends(get_db)):
    """
    The graph as a PNG, rendered by the same code the DOCX report uses.

    One renderer, two callers: what an analyst downloads here is pixel-identical
    to what the report embeds. A second client-side renderer would drift, and a
    report that no longer matches the screen it came from is worse than no
    export at all.
    """
    case = _get_case(case_id, db)
    graph = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    if not graph or not graph.nodes:
        raise HTTPException(status_code=404, detail="This case has no attack graph yet")

    png = render_attack_graph_png(graph.nodes, graph.edges or [])
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
):
    _get_case(case_id, db)
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
    db.commit()
    db.refresh(graph)
    return graph
