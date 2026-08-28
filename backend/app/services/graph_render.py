"""
Server-side rendering of a case's attack graph to PNG.

There is exactly one renderer, and both callers use it: the DOCX report, which
embeds the image, and the Attack Graph tab, which lets an analyst download it.
A second client-side renderer would drift from this one, and the report would
stop looking like the screen it came from.

Rendered with matplotlib's Agg backend from the stored ReactFlow nodes, so the
image reflects the positions the analyst arranged rather than a re-layout.
"""
from __future__ import annotations

import io


def render_attack_graph_png(nodes: list, edges: list) -> bytes | None:
    """
    Render the attack graph using the actual ReactFlow node positions and types,
    reproducing the visual style of the AttackGraph tab.

    Nodes are stored as ReactFlow Node objects:
      { id, type, position: {x, y}, data: {label, subLabel, nodeKind, notes,
        compromised, iocType, ...}, style: {width: 200} }
    Edges: { id, source, target, ... }
    """
    try:
        import matplotlib  # type: ignore
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt  # type: ignore
        from matplotlib.patches import FancyBboxPatch  # type: ignore

        if not nodes:
            return None

        # ── Constants matching the frontend ───────────────────────────────────
        NODE_W  = 200    # matches NODE_WIDTH in AttackGraphNodes.tsx
        NODE_H  = 72     # estimated — label (18) + subLabel (14) + padding (40)
        BG      = "#0B121F"

        # Border + fill colours per nodeKind
        THEME = {
            "timeline":           {"border": "#9FEF00", "fill": "#0e1f05"},
            "asset":              {"border": "#3b82f6", "fill": "#050f20"},
            "asset_compromised":  {"border": "#ef4444", "fill": "#1a0505"},
            "attacker":           {"border": "#ef4444", "fill": "#1a0505"},
            "free":               {"border": "#4b5563", "fill": "#111827"},
        }
        IOC_COLORS = {
            "ip":          "#ef4444",
            "domain":      "#f97316",
            "url":         "#fb923c",
            "hash_md5":    "#a855f7",
            "hash_sha1":   "#a855f7",
            "hash_sha256": "#a855f7",
            "email":       "#3b82f6",
            "filename":    "#eab308",
            "registry":    "#ec4899",
            "certificate": "#ec4899",
            "email_subject": "#60a5fa",
        }

        node_map: dict[str, dict] = {str(n["id"]): n for n in nodes}

        # ── Compute bounding box from real positions ────────────────────────
        xs = [n.get("position", {}).get("x", 0) for n in nodes]
        ys = [n.get("position", {}).get("y", 0) for n in nodes]
        pad = 80
        min_x, max_x = min(xs) - pad, max(xs) + NODE_W + pad
        min_y, max_y = min(ys) - pad, max(ys) + NODE_H + pad
        data_w = max(max_x - min_x, 1)
        data_h = max(max_y - min_y, 1)

        # Scale to a reasonable figure size (1 in ≈ 120 data units, cap at 20 in)
        SCALE = 120
        fig_w = max(10.0, min(20.0, data_w / SCALE))
        fig_h = max(6.0,  min(14.0, data_h / SCALE))

        fig, ax = plt.subplots(figsize=(fig_w, fig_h))
        fig.patch.set_facecolor(BG)
        ax.set_facecolor(BG)
        # ReactFlow: Y increases downward → invert matplotlib Y axis
        ax.set_xlim(min_x, max_x)
        ax.set_ylim(max_y, min_y)
        ax.axis("off")

        # ── Draw edges ─────────────────────────────────────────────────────
        for edge in (edges or []):
            src_node = node_map.get(str(edge.get("source", "")))
            tgt_node = node_map.get(str(edge.get("target", "")))
            if not src_node or not tgt_node:
                continue
            sp = src_node.get("position", {"x": 0, "y": 0})
            tp = tgt_node.get("position", {"x": 0, "y": 0})
            x1 = sp["x"] + NODE_W / 2
            y1 = sp["y"] + NODE_H       # bottom-centre of source
            x2 = tp["x"] + NODE_W / 2
            y2 = tp["y"]                # top-centre of target
            ax.annotate(
                "", xy=(x2, y2), xytext=(x1, y1),
                arrowprops={
                    "arrowstyle": "-|>",
                    "color": "#4b5563",
                    "lw": 1.2,
                    "connectionstyle": "arc3,rad=0.04",
                },
                zorder=1,
            )

        # ── Draw nodes ─────────────────────────────────────────────────────
        for node in nodes:
            pos  = node.get("position", {"x": 0, "y": 0})
            data = node.get("data", {})
            ntype = str(node.get("type", "free"))
            x, y = pos["x"], pos["y"]

            # Pick theme
            if ntype == "attacker":
                th = THEME["attacker"]
            elif ntype == "timeline":
                th = THEME["timeline"]
            elif ntype == "asset":
                th = THEME["asset_compromised"] if data.get("compromised") else THEME["asset"]
            elif ntype == "ioc":
                col = IOC_COLORS.get(str(data.get("iocType", "")), "#a855f7")
                th = {"border": col, "fill": "#0d0516"}
            else:  # free / unknown
                th = THEME["free"]

            # Rounded rectangle
            rect = FancyBboxPatch(
                (x + 1, y + 1), NODE_W - 2, NODE_H - 2,
                boxstyle="round,pad=0,rounding_size=6",
                facecolor=th["fill"],
                edgecolor=th["border"],
                linewidth=1.8,
                zorder=2,
            )
            ax.add_patch(rect)

            # Attacker node: pill shape label centred
            label     = str(data.get("label", node.get("id", "")))
            sub_label = str(data.get("subLabel", ""))
            notes     = str(data.get("notes", ""))

            # Truncate long strings
            if len(label) > 32:
                label = label[:30] + "…"
            if len(sub_label) > 36:
                sub_label = sub_label[:34] + "…"
            if len(notes) > 52:
                notes = notes[:50] + "…"

            text_x = x + 10
            if sub_label:
                ax.text(text_x, y + 12, sub_label,
                        color=th["border"], fontsize=6.0, va="top", ha="left",
                        fontstyle="italic", zorder=3)
                ax.text(text_x, y + 26, label,
                        color="white", fontsize=7.5, fontweight="bold",
                        va="top", ha="left", zorder=3)
                if notes:
                    ax.text(text_x, y + 47, notes,
                            color="#8b949e", fontsize=5.5, va="top", ha="left", zorder=3)
            else:
                ax.text(text_x, y + NODE_H / 2, label,
                        color="white", fontsize=7.5, fontweight="bold",
                        va="center", ha="left", zorder=3)
                if notes:
                    ax.text(text_x, y + NODE_H / 2 + 12, notes,
                            color="#8b949e", fontsize=5.5, va="top", ha="left", zorder=3)

        buf = io.BytesIO()
        plt.savefig(buf, format="png", bbox_inches="tight",
                    facecolor=BG, dpi=150)
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    except Exception:
        return None
