"""
A reference case template and a reference report template.

These are the other half of the corpus. The artifact fixtures prove a file gets
in; these prove a case gets *out* - that an investigation started from a
template can be rendered into a deliverable without a placeholder surviving
into the document.

The report template is **generated from the tag registry**, which is the whole
point. A template with a hand-written list of tags would test the tags somebody
remembered, and the tag nobody remembered is exactly the one that reaches a
client as literal `{{text}}`. Generated, it necessarily exercises every tag the
product claims to support, including the ones added after this file was written.

The case template is hand-written, because it is an example of the thing an
analyst authors and its shape is the point. It is deliberately small: the
shipped templates in `templates/` are the real ones, and duplicating their
content here would only mean maintaining them twice.
"""
from __future__ import annotations

import io

import yaml

from app.services import report_tags

#: Sections the reference case carries, as an analyst's Report tab would hold
#: them. `containment` is left empty on purpose: an unwritten section must
#: render as a marked placeholder rather than vanishing, in both formats.
REFERENCE_SECTIONS: dict[str, str] = {
    "incident_overview": (
        "A phishing message delivered a loader to WKS-042 on 2026-01-01 at 10:00 UTC."
    ),
    "technical_analysis": (
        "### Root cause\n\n"
        "`powershell.exe -enc` ran from the Outlook temporary folder, "
        "spawned by `cmd.exe` (PID 2001).\n\n"
        "- Initial access: T1566.001\n"
        "- Execution: T1059.001\n"
    ),
    "containment": "",
}


# ─── The case template ────────────────────────────────────────────────────────

def case_template() -> dict:
    """
    A minimal but complete case template, as a parsed document.

    Carries one entry of everything a template can hold, so a loader that
    silently drops a key fails here rather than on an analyst's first case.
    """
    return {
        "name":        "Reference incident",
        "description": "The template the test corpus builds a case from.",
        "version":     "1.0",
        "tags":        ["reference", "fixture"],
        "severity":    "high",
        "tlp":         "TLP:AMBER",
        "metadata":    {"category": "reference", "classification": "TLP:AMBER"},
        "ttp_definitions": [
            {
                "technique_id":   "T1566.001",
                "technique_name": "Spearphishing Attachment",
                "tactic":         "initial-access",
                "tactic_name":    "Initial Access",
            },
            {
                "technique_id":   "T1059.001",
                "technique_name": "PowerShell",
                "tactic":         "execution",
                "tactic_name":    "Execution",
            },
        ],
        "report_sections": [
            {
                "name":     "Incident Overview",
                "category": "analyse",
                "template": "Describe how the incident was discovered.\n",
            },
            {
                "name":     "Technical Analysis",
                "category": "analyse",
                "template": "### Root cause\n\nDetail the attack path.\n",
            },
            {
                "name":     "Containment",
                "category": "remediation",
                "template": "What was isolated, and when.\n",
            },
        ],
    }


def case_template_yaml() -> str:
    """The same document as the file an analyst would drop in `templates/`."""
    return yaml.safe_dump(case_template(), sort_keys=False, allow_unicode=True)


# ─── The report template ──────────────────────────────────────────────────────

def _tag_lines() -> list[str]:
    """
    One line per registered tag, block tags alone on their own line.

    A block tag shares its paragraph with nothing because the DOCX exporter
    replaces the whole paragraph - a heading on the same line would be
    destroyed with it, which is the mistake this layout exists to not teach.
    """
    lines: list[str] = []
    for group in (report_tags.GROUP_METADATA,
                  report_tags.GROUP_CONTENT,
                  report_tags.GROUP_ANNEX):
        tags = [t for t in report_tags.all_tags() if t.group == group]
        if not tags:
            continue
        lines.append(f"## {report_tags.GROUP_LABELS[group]}")
        lines.append("")
        for tag in tags:
            if tag.kind == "text":
                # Text tags are substituted in place, so a label beside one is
                # both realistic and a check that the surrounding text survives.
                lines.append(f"- {tag.name}: {{{{{tag.name}}}}}")
            else:
                lines.append("")
                lines.append(f"{{{{{tag.name}}}}}")
                lines.append("")
        lines.append("")
    return lines


def _section_lines(sections: dict[str, str]) -> list[str]:
    """The analyst's own sections, which no registry can list."""
    lines = ["## Case sections", ""]
    for slug in sections:
        lines.append(f"{{{{{slug}}}}}")
        lines.append("")
    return lines


def report_template_markdown(sections: dict[str, str] | None = None) -> str:
    """Every registered tag, plus the reference case's own sections."""
    head = ["# {{case.title}}", ""]
    body = _tag_lines() + _section_lines(sections or REFERENCE_SECTIONS)
    return "\n".join(head + body).rstrip() + "\n"


def report_template_docx(sections: dict[str, str] | None = None) -> bytes:
    """
    The same template as a Word document.

    One paragraph per line, which is what a real template looks like and what
    the block-tag replacement requires: the exporter finds the paragraph whose
    whole text is the tag and rewrites it.
    """
    from docx import Document

    document = Document()
    for line in report_template_markdown(sections).splitlines():
        document.add_paragraph(line)

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()
