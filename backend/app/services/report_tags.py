"""
The `{{tag}}` vocabulary a report template may use.

One registry, because the list used to live in seven places: the router's
module docstring, its `BLOCK_TAGS` set, its `ALL_TAGS` list, an inline tuple in
the DOCX renderer, two `Set`s in `ReportTemplates.tsx`, that page's `TAG_DOCS`
table, and `docs/REPORT_TEMPLATES.md`. Adding a tag meant editing seven lists
and the failure was silent in both directions - a tag missing from `ALL_TAGS`
worked but was undocumented, and a tag missing from `BLOCK_TAGS` was left in
the exported document as literal `{{text}}`.

Two kinds of tag live here:

*Text* tags carry a resolver and are substituted inline wherever they appear,
including in tables, headers and footers.

*Block* tags replace the paragraph they sit in with a table or an image, so
they are rendered by the exporter rather than resolved here - a table is built
very differently in DOCX and in Markdown. The registry still owns their names
and descriptions, which is what the "is this paragraph a block?" scan needs.

A third kind is not registered at all: the analyst's own report sections. Those
are per-case, created in the Report tab, and `section_tags()` derives them from
the case so a section invented this morning is a usable tag this afternoon.
That is the part that was missing - see the note on `section_tags`.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from ..models.case import Case

#: Groups, in the order the reference panel and the documentation show them.
GROUP_METADATA = "metadata"
GROUP_CONTENT  = "content"
GROUP_ANNEX    = "annex"

GROUP_LABELS: dict[str, str] = {
    GROUP_METADATA: "Incident metadata",
    GROUP_CONTENT:  "Analysis, remediation and conclusions",
    GROUP_ANNEX:    "Annexes - tables and images",
}

Resolver = Callable[["Case", str], str]


@dataclass(frozen=True)
class ReportTag:
    name:        str
    group:       str
    description: str
    #: Text tags resolve to a string here. Block tags leave it unset: their
    #: rendering is format-specific and belongs to the exporter.
    resolve:     Resolver | None = None

    @property
    def kind(self) -> str:
        return "text" if self.resolve is not None else "block"


_REGISTRY: dict[str, ReportTag] = {}


def _add(tag: ReportTag) -> ReportTag:
    if tag.name in _REGISTRY:
        raise ValueError(f"Report tag '{tag.name}' is registered twice")
    _REGISTRY[tag.name] = tag
    return tag


def text_tag(name: str, group: str, description: str) -> Callable[[Resolver], Resolver]:
    """Register a tag substituted inline, with the function producing its value."""
    def decorate(fn: Resolver) -> Resolver:
        _add(ReportTag(name=name, group=group, description=description, resolve=fn))
        return fn
    return decorate


def block_tag(name: str, group: str, description: str) -> ReportTag:
    """Register a tag the exporter replaces with a table or an image."""
    return _add(ReportTag(name=name, group=group, description=description))


# ─── Incident metadata ────────────────────────────────────────────────────────

def _fmt_dt(dt: datetime | None) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC") if dt else "N/A"


@text_tag("case.title", GROUP_METADATA, "Case title")
def _case_title(case: Case, author: str) -> str:
    return str(case.title or "")


@text_tag("case.id", GROUP_METADATA, "Case UUID")
def _case_id(case: Case, author: str) -> str:
    return str(case.id or "")


@text_tag("case.status", GROUP_METADATA, "Status - Open, In Progress, Closed, Archived")
def _case_status(case: Case, author: str) -> str:
    return str(case.status.value if case.status else "").replace("_", " ").title()


@text_tag("case.severity", GROUP_METADATA, "Severity, upper-case - CRITICAL, HIGH, …")
def _case_severity(case: Case, author: str) -> str:
    return str(case.severity.value if case.severity else "").upper()


@text_tag("case.tlp", GROUP_METADATA, "TLP classification")
def _case_tlp(case: Case, author: str) -> str:
    return str(case.tlp or "")


@text_tag("case.created_at", GROUP_METADATA, "Creation date - YYYY-MM-DD HH:MM UTC")
def _case_created(case: Case, author: str) -> str:
    return _fmt_dt(cast("datetime | None", case.created_at))


@text_tag("case.closed_at", GROUP_METADATA, "Closure date, or N/A while the case is open")
def _case_closed(case: Case, author: str) -> str:
    return _fmt_dt(cast("datetime | None", case.closed_at))


@text_tag("case.description", GROUP_METADATA, "Case description")
def _case_description(case: Case, author: str) -> str:
    return str(case.description or "")


@text_tag("case.executive_summary", GROUP_METADATA, "Executive summary")
def _case_exec_summary(case: Case, author: str) -> str:
    return str(case.executive_summary or "")


@text_tag("case.quick_notes", GROUP_METADATA, "Quick notes")
def _case_quick_notes(case: Case, author: str) -> str:
    return str(case.quick_notes or "")


@text_tag("case.assigned_to", GROUP_METADATA, "Assigned analyst(s), or Unassigned")
def _case_assigned(case: Case, author: str) -> str:
    return str(case.assigned_to or "Unassigned")


@text_tag("case.tags", GROUP_METADATA, "Case tags, comma-separated")
def _case_tags(case: Case, author: str) -> str:
    return str(case.tags or "")


@text_tag("report.date", GROUP_METADATA, "Report generation date - YYYY-MM-DD")
def _report_date(case: Case, author: str) -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


@text_tag("report.author", GROUP_METADATA, "Username of the analyst generating the report")
def _report_author(case: Case, author: str) -> str:
    return author


# ─── Analyst-authored content ─────────────────────────────────────────────────
# Block tags: the Markdown in these boxes becomes formatted DOCX paragraphs,
# which is a paragraph-level rewrite rather than a string substitution.

block_tag("report_analysis", GROUP_CONTENT,
          "Box 1 of the Report tab - Technical Analysis. In DOCX the Markdown "
          "is converted to formatted Word paragraphs; in Markdown it is "
          "inserted as it was written.")
block_tag("report_remediation", GROUP_CONTENT,
          "Box 2 of the Report tab - Remediation.")
block_tag("report_conclusion", GROUP_CONTENT,
          "Box 3 of the Report tab - Conclusion and recommendations.")
block_tag("report_content", GROUP_CONTENT,
          "All three boxes in sequence. Kept for templates written before the "
          "Report tab was split into three.")


# ─── Annexes ──────────────────────────────────────────────────────────────────

block_tag("ioc_table", GROUP_ANNEX, "Table of indicators of compromise")
block_tag("asset_table", GROUP_ANNEX, "Table of the assets involved")
block_tag("evidence_table", GROUP_ANNEX, "Table of evidence items")
block_tag("timeline_table", GROUP_ANNEX, "Consolidated timeline, chronological")
block_tag("attack_graph", GROUP_ANNEX,
          "Attack graph as a PNG image. DOCX only - Markdown gets a placeholder "
          "telling the analyst to export the PNG from the Attack Graph tab.")
block_tag("mitre_matrix", GROUP_ANNEX,
          "MITRE ATT&CK coverage as a text table. Parent techniques are expanded "
          "only where sub-techniques are selected.")
block_tag("mitre_matrix_img", GROUP_ANNEX,
          "MITRE ATT&CK matrix as a visual PNG image. DOCX only.")


# ─── Reading the registry ─────────────────────────────────────────────────────

def all_tags() -> list[ReportTag]:
    """Every registered tag, in declaration order."""
    return list(_REGISTRY.values())


def names() -> list[str]:
    return list(_REGISTRY)


def block_names() -> set[str]:
    return {t.name for t in _REGISTRY.values() if t.kind == "block"}


def is_known(name: str) -> bool:
    return name in _REGISTRY


def catalogue() -> list[dict]:
    """The registry as data, for the API and the documentation generator."""
    return [
        {
            "name":        t.name,
            "kind":        t.kind,
            "group":       t.group,
            "group_label": GROUP_LABELS.get(t.group, t.group),
            "description": t.description,
        }
        for t in _REGISTRY.values()
    ]


def build_context(case: Case, author: str) -> dict[str, str]:
    """Every text tag resolved for this case. Block tags are not in here."""
    return {
        t.name: t.resolve(case, author)          # type: ignore[misc]
        for t in _REGISTRY.values() if t.resolve is not None
    }


# ─── Per-case sections ────────────────────────────────────────────────────────

def section_tags(case: Case) -> dict[str, str]:
    """
    The analyst's own report sections, as tag name to written content.

    These cannot be registered: they are created per case in the Report tab and
    stored as a slug-keyed JSON blob on the case. Deriving them at render time
    is what makes a section invented this morning usable in a template this
    afternoon.

    Reading it was also where the two exporters disagreed. The Markdown path
    looped over this blob and substituted; the DOCX path scanned for a fixed
    set of block names, so a section slug never matched anything and came out
    of Word as a literal `{{slug}}`. Both paths now ask here.
    """
    raw = getattr(case, "report_sections_data", None) or "{}"
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {
        str(slug): str(content or "")
        for slug, content in data.items()
        # A section may not shadow a registered tag: `{{ioc_table}}` must stay
        # the IOC table whatever an analyst names a section.
        if str(slug) and not is_known(str(slug))
    }


def section_placeholder(slug: str) -> str:
    """What an unwritten section renders as, identically in both exporters."""
    return f"_[Section '{slug}' not written.]_"


# ─── Documentation ────────────────────────────────────────────────────────────

#: Fences around the generated block in docs/REPORT_TEMPLATES.md. A test
#: regenerates between them and fails when the file has drifted, which is what
#: makes the documentation a consequence of the registry rather than a promise
#: somebody has to keep.
DOC_BEGIN = "<!-- BEGIN GENERATED TAGS - edit services/report_tags.py, not this -->"
DOC_END   = "<!-- END GENERATED TAGS -->"


def as_markdown() -> str:
    """The registry as the Markdown table that belongs in the tag reference."""
    lines: list[str] = []
    for group in (GROUP_METADATA, GROUP_CONTENT, GROUP_ANNEX):
        tags = [t for t in _REGISTRY.values() if t.group == group]
        if not tags:
            continue
        lines.append(f"### {GROUP_LABELS[group]}")
        lines.append("")
        lines.append("| Tag | Kind | What it inserts |")
        lines.append("|---|---|---|")
        for tag in tags:
            description = tag.description.replace("|", "\\|")
            lines.append(f"| `{{{{{tag.name}}}}}` | {tag.kind} | {description} |")
        lines.append("")
    return "\n".join(lines).rstrip()


def render_doc_section(current: str) -> str:
    """`current` with the fenced block replaced by the registry's own table."""
    if DOC_BEGIN not in current or DOC_END not in current:
        raise ValueError(
            f"The tag reference is missing its {DOC_BEGIN!r} / {DOC_END!r} fences")
    head, rest = current.split(DOC_BEGIN, 1)
    _, tail    = rest.split(DOC_END, 1)
    return f"{head}{DOC_BEGIN}\n\n{as_markdown()}\n\n{DOC_END}{tail}"
