"""
Attack graph links accepted from agents (`docs/CHARYBDIS_FEATURES.md`, E6).

The graph is the analyst's drawing, stored as React Flow nodes and edges. An
accepted link adds an edge between the nodes of its two ends, placing a node
for an end that is not drawn yet below what is there, so nothing the analyst
arranged moves.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models.attack_graph import AttackGraph

#: Same width as the interface's nodes (AttackGraphNodes.NODE_WIDTH), on its 20px grid.
NODE_WIDTH = 200
ROW = 120


def _node_for(nodes: list[dict[str, Any]], end: dict[str, Any]) -> str:
    if end["kind"] == "attacker":
        found = next((n for n in nodes if (n.get("data") or {}).get("nodeKind") == "attacker"), None)
    else:
        found = next((n for n in nodes if (n.get("data") or {}).get("sourceId") == end["id"]), None)
    if found is not None:
        return str(found["id"])
    lowest = max((float((n.get("position") or {}).get("y", 0)) for n in nodes), default=-ROW)
    column = sum(1 for n in nodes if n.get("data", {}).get("addedBy") == "agent") % 4
    node_id = f"agent-{uuid.uuid4().hex[:8]}"
    kind = end["kind"]
    data: dict[str, Any] = {"label": end["label"], "nodeKind": kind, "addedBy": "agent"}
    if kind != "attacker":
        data["sourceId"] = end["id"]
    nodes.append({"id": node_id, "type": kind, "position": {"x": column * (NODE_WIDTH + 40), "y": lowest + ROW},
                  "style": {"width": NODE_WIDTH}, "data": data})
    return node_id


def add_edge(db: Session, case_id: str, data: dict[str, Any]) -> str:
    """Add the accepted link to the case's graph. Returns the edge id."""
    graph = db.get(AttackGraph, case_id)
    if graph is None:
        graph = AttackGraph(case_id=case_id, nodes=[], edges=[])
        db.add(graph)
    nodes = list(graph.nodes or [])
    edges = list(graph.edges or [])
    source = _node_for(nodes, data["source"])
    target = _node_for(nodes, data["target"])
    edge_id = f"agent-edge-{uuid.uuid4().hex[:8]}"
    edges.append({"id": edge_id, "source": source, "target": target, "type": "reshapable", "animated": True,
                  "label": str(data.get("label", ""))})
    graph.nodes, graph.edges = nodes, edges  # type: ignore[assignment]
    flag_modified(graph, "nodes")
    flag_modified(graph, "edges")
    graph.updated_at = datetime.now(UTC)  # type: ignore[assignment]
    db.flush()
    return edge_id
