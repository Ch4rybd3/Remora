"""
Report document templates — DOCX and Markdown with {{tag}} placeholders.

Supported tags
──────────────
Text tags (inline replacement):
  {{case.title}}              Case title
  {{case.id}}                 Case UUID
  {{case.status}}             Case status
  {{case.severity}}           Case severity (upper-case)
  {{case.tlp}}                TLP classification
  {{case.created_at}}         Creation date (YYYY-MM-DD HH:MM UTC)
  {{case.closed_at}}          Closure date  (or "N/A")
  {{case.description}}        Case description
  {{case.executive_summary}}  Executive summary
  {{case.quick_notes}}        Quick notes
  {{case.assigned_to}}        Assigned analyst(s)
  {{case.tags}}               Case tags (comma-separated)
  {{report.date}}             Report generation date (YYYY-MM-DD)
  {{report.author}}           Username of the analyst generating the report

Block tags (replaced with a table or image):
  {{ioc_table}}               Full IOC table
  {{asset_table}}             Full asset table
  {{evidence_table}}          Full evidence table
  {{timeline_table}}          Timeline (chronological)
  {{attack_graph}}            Attack-graph PNG image (DOCX) or placeholder (MD)
"""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.report_doc_template import ReportDocTemplate
from ..models.case import Case
from ..models.attack_graph import AttackGraph
from ..models.user import User
from ..core.deps import get_current_user
from ..config import settings

router = APIRouter(prefix="/report-doc-templates", tags=["report-doc-templates"])

# ── Storage directory ──────────────────────────────────────────────────────────

TEMPLATES_DIR: Path = settings.evidence_store_path.parent / "report_doc_templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

# ── Tag constants ──────────────────────────────────────────────────────────────

TAG_RE = re.compile(r'\{\{[\w.]+\}\}')

BLOCK_TAGS: set[str] = {
    "ioc_table", "asset_table", "evidence_table", "timeline_table", "attack_graph",
}

ALL_TAGS: list[str] = [
    "case.title", "case.id", "case.status", "case.severity", "case.tlp",
    "case.created_at", "case.closed_at", "case.description",
    "case.executive_summary", "case.quick_notes", "case.assigned_to", "case.tags",
    "report.date", "report.author",
    "ioc_table", "asset_table", "evidence_table", "timeline_table", "attack_graph",
]

# ── Pydantic schema ────────────────────────────────────────────────────────────

class ReportDocTemplateOut(BaseModel):
    id:            int
    name:          str
    description:   str
    format:        str
    file_size:     int
    tags_detected: list[str]
    created_at:    datetime
    created_by:    Optional[str]

    model_config = {"from_attributes": True}


# ── Tag detection ──────────────────────────────────────────────────────────────

def _detect_tags(text: str) -> list[str]:
    """Return sorted unique {{tag}} keys found in *text*."""
    return sorted({m[2:-2] for m in TAG_RE.findall(text)})


def _detect_tags_docx(file_bytes: bytes) -> list[str]:
    from docx import Document  # type: ignore
    doc = Document(io.BytesIO(file_bytes))
    parts: list[str] = []
    for para in doc.paragraphs:
        parts.append("".join(r.text for r in para.runs))
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    parts.append("".join(r.text for r in para.runs))
    for section in doc.sections:
        for hdr_ftr in (section.header, section.footer):
            if hdr_ftr and not hdr_ftr.is_linked_to_previous:
                for para in hdr_ftr.paragraphs:
                    parts.append("".join(r.text for r in para.runs))
    return _detect_tags("\n".join(parts))


# ── Context builder ────────────────────────────────────────────────────────────

def _fmt_dt(dt: Optional[datetime]) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "N/A"


def _build_context(case: Case, author: str) -> dict[str, str]:
    return {
        "case.title":             case.title or "",
        "case.id":                case.id or "",
        "case.status":            (case.status.value if case.status else "").replace("_", " ").title(),
        "case.severity":          (case.severity.value if case.severity else "").upper(),
        "case.tlp":               case.tlp or "",
        "case.created_at":        _fmt_dt(case.created_at),
        "case.closed_at":         _fmt_dt(case.closed_at),
        "case.description":       case.description or "",
        "case.executive_summary": case.executive_summary or "",
        "case.quick_notes":       case.quick_notes or "",
        "case.assigned_to":       case.assigned_to or "Unassigned",
        "case.tags":              case.tags or "",
        "report.date":            datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "report.author":          author,
    }


# ── Markdown helpers ───────────────────────────────────────────────────────────

def _md_ioc_table(case: Case) -> str:
    if not case.iocs:
        return "*No IOCs recorded.*"
    rows = [
        "| Type | Value | Confidence | TLP | Description |",
        "|------|-------|------------|-----|-------------|",
    ]
    for ioc in case.iocs:
        rows.append(
            f"| {ioc.type.value} | `{ioc.value}` | {ioc.confidence.value} "
            f"| {ioc.tlp} | {ioc.description or ''} |"
        )
    return "\n".join(rows)


def _md_asset_table(case: Case) -> str:
    if not case.assets:
        return "*No assets recorded.*"
    rows = [
        "| Name | Type | IP | Hostname | OS | Compromised |",
        "|------|------|----|----------|----|-------------|",
    ]
    for a in case.assets:
        rows.append(
            f"| {a.name} | {a.type.value} | {a.ip_address or ''} "
            f"| {a.hostname or ''} | {a.os or ''} | {'Yes' if a.compromised else 'No'} |"
        )
    return "\n".join(rows)


def _md_evidence_table(case: Case) -> str:
    if not case.evidences:
        return "*No evidence recorded.*"
    rows = [
        "| Name | File | Type | SHA-256 | Collected By |",
        "|------|------|------|---------|--------------|",
    ]
    for e in case.evidences:
        sha = (e.sha256_hash[:16] + "…") if e.sha256_hash else "N/A"
        rows.append(
            f"| {e.name} | {e.original_filename or ''} | {e.evidence_type.value} "
            f"| `{sha}` | {e.collected_by or ''} |"
        )
    return "\n".join(rows)


def _md_timeline_table(case: Case) -> str:
    if not case.timeline:
        return "*No timeline events recorded.*"
    rows = [
        "| Timestamp | Event | Actor | Source |",
        "|-----------|-------|-------|--------|",
    ]
    for ev in case.timeline:
        ts = ev.event_ts.strftime("%Y-%m-%d %H:%M UTC")
        rows.append(f"| {ts} | {ev.title} | {ev.actor or ''} | {ev.source or ''} |")
    return "\n".join(rows)


def _render_markdown(template_text: str, case: Case, ctx: dict[str, str]) -> str:
    text = template_text
    for tag, value in ctx.items():
        text = text.replace(f"{{{{{tag}}}}}", str(value))
    text = text.replace("{{ioc_table}}", _md_ioc_table(case))
    text = text.replace("{{asset_table}}", _md_asset_table(case))
    text = text.replace("{{evidence_table}}", _md_evidence_table(case))
    text = text.replace("{{timeline_table}}", _md_timeline_table(case))
    text = text.replace("{{attack_graph}}", "_[Attach the attack graph image — export it from the Attack Graph tab]_")
    return text


# ── DOCX helpers ───────────────────────────────────────────────────────────────

def _para_text(para) -> str:
    return "".join(r.text for r in para.runs)


def _replace_text_in_para(para, ctx: dict[str, str]) -> bool:
    """Merge all runs into one and replace {{tags}}. Returns True if changed."""
    from docx.oxml.ns import qn  # type: ignore
    full = _para_text(para)
    new_text = full
    for tag, value in ctx.items():
        new_text = new_text.replace(f"{{{{{tag}}}}}", str(value))
    if new_text == full:
        return False
    # Remove all existing <w:r> elements
    for r_elem in list(para._p.findall(qn("w:r"))):
        para._p.remove(r_elem)
    if new_text:
        para.add_run(new_text)
    return True


def _set_cell_bg(cell, color_hex: str) -> None:
    """Apply background shading to a table cell (no leading #)."""
    from docx.oxml.ns import qn  # type: ignore
    from docx.oxml import OxmlElement  # type: ignore
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for existing in tcPr.findall(qn("w:shd")):
        tcPr.remove(existing)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color_hex.lstrip("#").upper())
    tcPr.append(shd)


def _build_word_table(
    doc,
    headers: list[str],
    rows: list[list[str]],
    header_color: str = "1E3A5F",
) -> "Table":  # type: ignore[name-defined]
    """
    Create a fully styled Word table:
    - Extends ~0.5 cm beyond the page text-area on both sides
    - Solid borders (outer 1pt, inner 0.5pt) in neutral grey
    - Coloured header row with white bold text (colour per table type)
    - Alternating light-grey row shading for readability
    - Font size 9pt header / 8pt body
    """
    from docx.oxml.ns import qn  # type: ignore
    from docx.oxml import OxmlElement  # type: ignore
    from docx.shared import Pt, RGBColor  # type: ignore

    EMU_PER_TWIP = 635        # 914 400 EMU/in ÷ 1 440 twips/in
    EXT_TWIPS    = 284         # ~0.5 cm extension into each margin
    BORDER_COLOR = "9CA3AF"   # tailwind gray-400 — neutral on any background

    n_cols = len(headers)
    n_rows = len(rows)
    table = doc.add_table(rows=1 + n_rows, cols=n_cols)

    tbl  = table._tbl
    tblPr = tbl.find(qn("w:tblPr"))
    if tblPr is None:
        tblPr = OxmlElement("w:tblPr")
        tbl.insert(0, tblPr)

    # ── Width: extend beyond the text area ───────────────────────────────────
    col_w_twips: Optional[int] = None
    try:
        section  = doc.sections[0]
        text_w   = int((section.page_width - section.left_margin - section.right_margin)
                       / EMU_PER_TWIP)
        table_w  = text_w + 2 * EXT_TWIPS

        tblW = OxmlElement("w:tblW")
        tblW.set(qn("w:w"), str(table_w))
        tblW.set(qn("w:type"), "dxa")
        tblPr.append(tblW)

        tblInd = OxmlElement("w:tblInd")
        tblInd.set(qn("w:w"), str(-EXT_TWIPS))
        tblInd.set(qn("w:type"), "dxa")
        tblPr.append(tblInd)

        col_w_twips = table_w // n_cols
    except Exception:
        # Fallback: 100 % of text area, no extension
        tblW = OxmlElement("w:tblW")
        tblW.set(qn("w:w"), "5000")
        tblW.set(qn("w:type"), "pct")
        tblPr.append(tblW)

    # ── Borders ───────────────────────────────────────────────────────────────
    tblBorders = OxmlElement("w:tblBorders")
    for side, sz in [
        ("top", "12"), ("left", "12"), ("bottom", "12"), ("right", "12"),
        ("insideH", "6"), ("insideV", "4"),
    ]:
        b = OxmlElement(f"w:{side}")
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), sz)       # half-points: 12 = 1.5 pt, 6 = 0.75 pt
        b.set(qn("w:space"), "0")
        b.set(qn("w:color"), BORDER_COLOR)
        tblBorders.append(b)
    tblPr.append(tblBorders)

    # ── tblGrid: even column widths ───────────────────────────────────────────
    if col_w_twips:
        tblGrid = OxmlElement("w:tblGrid")
        for _ in headers:
            gc = OxmlElement("w:gridCol")
            gc.set(qn("w:w"), str(col_w_twips))
            tblGrid.append(gc)
        tblPr.addnext(tblGrid)

    # ── Header row ────────────────────────────────────────────────────────────
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        cell = hdr_cells[i]
        _set_cell_bg(cell, header_color)
        # Set column width on header cell too
        if col_w_twips:
            tc = cell._tc
            tcPr = tc.get_or_add_tcPr()
            tcW = OxmlElement("w:tcW")
            tcW.set(qn("w:w"), str(col_w_twips))
            tcW.set(qn("w:type"), "dxa")
            tcPr.append(tcW)
        para = cell.paragraphs[0]
        run = para.add_run(h)
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.size = Pt(9)

    # ── Data rows ─────────────────────────────────────────────────────────────
    ALT_BG = "F3F4F6"   # tailwind gray-100 — subtle alternating shade
    for r_i, row_data in enumerate(rows):
        cells = table.rows[r_i + 1].cells
        for c_i, val in enumerate(row_data):
            cell = cells[c_i]
            if r_i % 2 == 1:
                _set_cell_bg(cell, ALT_BG)
            if col_w_twips:
                tc = cell._tc
                tcPr = tc.get_or_add_tcPr()
                tcW = OxmlElement("w:tcW")
                tcW.set(qn("w:w"), str(col_w_twips))
                tcW.set(qn("w:type"), "dxa")
                tcPr.append(tcW)
            para = cell.paragraphs[0]
            run = para.add_run(str(val) if val is not None else "")
            run.font.size = Pt(8)

    return table


def _render_attack_graph_png(nodes: list, edges: list) -> Optional[bytes]:
    """
    Render the attack graph using the actual ReactFlow node positions and types,
    reproducing the visual style of the AttackGraph tab.

    Nodes are stored as ReactFlow Node objects:
      { id, type, position: {x, y}, data: {label, subLabel, nodeKind, notes,
        compromised, iocType, ...}, style: {width: 200} }
    Edges: { id, source, target, ... }
    """
    try:
        import matplotlib                           # type: ignore
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt            # type: ignore
        import matplotlib.patches as mpatches      # type: ignore
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
                arrowprops=dict(
                    arrowstyle="-|>",
                    color="#4b5563",
                    lw=1.2,
                    connectionstyle="arc3,rad=0.04",
                ),
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


def _render_docx(template_path: str, case: Case, ctx: dict[str, str],
                 attack_graph_png: Optional[bytes]) -> bytes:
    from docx import Document  # type: ignore
    from docx.shared import Inches  # type: ignore
    from docx.oxml.ns import qn  # type: ignore

    doc = Document(template_path)

    # ── Table data ─────────────────────────────────────────────────────────────
    ioc_headers = ["Type", "Value", "Confidence", "TLP", "Description"]
    ioc_rows = (
        [[i.type.value, i.value, i.confidence.value, i.tlp, i.description or ""]
         for i in case.iocs]
        if case.iocs else [["No IOCs recorded", "", "", "", ""]]
    )

    asset_headers = ["Name", "Type", "IP", "Hostname", "OS", "Compromised"]
    asset_rows = (
        [[a.name, a.type.value, a.ip_address or "", a.hostname or "",
          a.os or "", "Yes" if a.compromised else "No"]
         for a in case.assets]
        if case.assets else [["No assets recorded", "", "", "", "", ""]]
    )

    evidence_headers = ["Name", "File", "Type", "SHA-256", "Collected By"]
    evidence_rows = (
        [[e.name, e.original_filename or "", e.evidence_type.value,
          (e.sha256_hash[:16] + "…") if e.sha256_hash else "N/A",
          e.collected_by or ""]
         for e in case.evidences]
        if case.evidences else [["No evidence recorded", "", "", "", ""]]
    )

    timeline_headers = ["Timestamp", "Event", "Actor", "Source"]
    timeline_rows = (
        [[ev.event_ts.strftime("%Y-%m-%d %H:%M UTC"), ev.title,
          ev.actor or "", ev.source or ""]
         for ev in case.timeline]
        if case.timeline else [["No timeline events recorded", "", "", ""]]
    )

    # ── First pass: body paragraphs ────────────────────────────────────────────
    # Collect block-tag paragraphs; replace text in all others.
    block_paras: list[tuple] = []
    for para in list(doc.paragraphs):
        full = _para_text(para)
        block_found = next((bt for bt in BLOCK_TAGS if f"{{{{{bt}}}}}" in full), None)
        if block_found:
            block_paras.append((para, block_found))
        else:
            _replace_text_in_para(para, ctx)

    # ── Table cells (text only, no block tags) ─────────────────────────────────
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    _replace_text_in_para(para, ctx)

    # ── Headers / footers (text only) ─────────────────────────────────────────
    for section in doc.sections:
        for hf in (section.header, section.footer):
            if hf and not hf.is_linked_to_previous:
                for para in hf.paragraphs:
                    _replace_text_in_para(para, ctx)
                for tbl in hf.tables:
                    for row in tbl.rows:
                        for cell in row.cells:
                            for para in cell.paragraphs:
                                _replace_text_in_para(para, ctx)

    # ── Second pass: replace block-tag paragraphs ──────────────────────────────
    for para, block_tag in block_paras:

        if block_tag == "attack_graph":
            # Clear runs, insert picture (or placeholder text)
            for r_elem in list(para._p.findall(qn("w:r"))):
                para._p.remove(r_elem)
            if attack_graph_png:
                para.add_run().add_picture(io.BytesIO(attack_graph_png), width=Inches(6))
            else:
                para.add_run("[Attack graph not available — no data recorded]")

        else:
            # Build the appropriate Word table (header colour per type)
            if block_tag == "ioc_table":
                # Dark red — threat indicators
                tbl = _build_word_table(doc, ioc_headers, ioc_rows, "7F1D1D")
            elif block_tag == "asset_table":
                # Dark blue — infrastructure
                tbl = _build_word_table(doc, asset_headers, asset_rows, "1E3A5F")
            elif block_tag == "evidence_table":
                # Dark slate — forensic artefacts
                tbl = _build_word_table(doc, evidence_headers, evidence_rows, "1E293B")
            else:  # timeline_table
                # Dark green — chronology
                tbl = _build_word_table(doc, timeline_headers, timeline_rows, "14532D")

            # Move the new table (currently at end of body) to replace the paragraph.
            # addnext() moves tbl._tbl from its current parent to after para._p.
            para._p.addnext(tbl._tbl)
            para._p.getparent().remove(para._p)

    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf.read()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ReportDocTemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return (
        db.query(ReportDocTemplate)
        .order_by(ReportDocTemplate.created_at.desc())
        .all()
    )


@router.get("/tags", response_model=list[str])
def list_available_tags():
    """Return all supported {{tags}}."""
    return ALL_TAGS


@router.post("/upload", response_model=ReportDocTemplateOut)
async def upload_template(
    name:         str        = Form(...),
    description:  str        = Form(""),
    file:         UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    fname = file.filename or ""
    if fname.endswith(".docx"):
        fmt = "docx"
    elif fname.endswith(".md"):
        fmt = "markdown"
    else:
        raise HTTPException(400, "Only .docx and .md files are accepted")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "Uploaded file is empty")

    # Detect tags
    if fmt == "docx":
        tags = _detect_tags_docx(file_bytes)
    else:
        tags = _detect_tags(file_bytes.decode("utf-8", errors="replace"))

    # Persist to disk
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^\w\-.]", "_", fname)
    dest = TEMPLATES_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{safe_name}"
    dest.write_bytes(file_bytes)

    tpl = ReportDocTemplate(
        name=name,
        description=description,
        format=fmt,
        file_path=str(dest),
        file_size=len(file_bytes),
        tags_detected=tags,
        created_by=current_user.username,
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl


@router.delete("/{template_id}")
def delete_template(
    template_id:  int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    tpl = db.query(ReportDocTemplate).filter(ReportDocTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template not found")
    try:
        Path(tpl.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(tpl)
    db.commit()
    return {"deleted": template_id}


@router.post("/{template_id}/generate/{case_id}")
def generate_report(
    template_id:  int,
    case_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    tpl = db.query(ReportDocTemplate).filter(ReportDocTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template not found")
    if not Path(tpl.file_path).exists():
        raise HTTPException(410, "Template file missing on disk")

    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")

    ctx = _build_context(case, current_user.username)
    safe_title = re.sub(r"[^\w\-]", "_", case.title or "report")

    if tpl.format == "markdown":
        template_text = Path(tpl.file_path).read_text(encoding="utf-8")
        content = _render_markdown(template_text, case, ctx)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8")),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}_report.md"'},
        )

    # DOCX
    ag = db.query(AttackGraph).filter(AttackGraph.case_id == case_id).first()
    png_bytes: Optional[bytes] = None
    if ag and ag.nodes:
        png_bytes = _render_attack_graph_png(ag.nodes, ag.edges or [])

    docx_bytes = _render_docx(tpl.file_path, case, ctx, png_bytes)
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return StreamingResponse(
        io.BytesIO(docx_bytes),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_report.docx"'},
    )
