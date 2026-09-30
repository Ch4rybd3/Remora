"""
The sections a report is made of.

A case template declares `report_sections`; each one becomes an editor in the
Report tab, a `{{slug}}` tag a report template can place, and a heading in the
exported document. That chain is the whole model.

**There used to be a second one.** A case carried three fixed columns -
`report_analysis`, `report_remediation`, `report_conclusion` - alongside the
per-section blob, and the Report tab chose between them at render time
depending on whether the case's template defined sections. So one case could
hold content in two shapes, the exporter had four tags for the same material,
and "which of the three does this belong in" was a question the analyst had to
answer about their own writing.

Sections only now. A template that wants everything in one place still has
`{{report_content}}`, which is every section in order.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..models.case import Case


@dataclass(frozen=True)
class Section:
    """One section of a report, as the template declares it."""
    slug:     str
    name:     str
    #: What the analyst starts from. Markdown, shown as placeholder text.
    template: str
    #: Free-form, from the case template. No longer routes content anywhere -
    #: it was the bucket key - but it is what a template author writes to say
    #: what a section is, so it travels with the section.
    category: str
    #: An export refuses to produce a deliverable with this section empty.
    required: bool = False


def section_slug(section: dict) -> str:
    """
    The tag a section is addressed by.

    An explicit `tag:` in the template wins, because a section renamed for a
    client must not silently change the tag every report template already
    places. Without one, the name is slugified.
    """
    explicit = (section.get("tag") or "").lower().strip()
    if explicit:
        return explicit
    name = section.get("name", "section")
    return re.sub(r"[^a-z0-9]+", "_", name.lower().strip()).strip("_") or "section"


#: Used when a case has no template, or its template declares no sections.
#: Deliberately the three the product shipped with, so a case started without
#: a template reads the way it always did - as sections now, not as boxes.
DEFAULT_SECTIONS: list[dict] = [
    {
        "name":     "Technical Analysis",
        "category": "analysis",
        "required": True,
        "template": (
            "### Root Cause\n\n"
            "*Describe how the incident started (initial vector, vulnerability exploited...)*\n\n"
            "### Attack Chain\n\n"
            "*Describe chronologically how the attack progressed.*\n\n"
            "### Impact\n\n"
            "*Describe the technical and business impact of the incident.*"
        ),
    },
    {
        "name":     "Remediations",
        "category": "remediation",
        "required": True,
        "template": (
            "*List the remediation actions completed or in progress, with status and owner.*\n\n"
            "- [ ] Action 1\n"
            "- [ ] Action 2"
        ),
    },
    {
        "name":     "Conclusion & Recommendations",
        "category": "conclusion",
        "required": False,
        "template": (
            "*Summary of the incident and long-term recommendations to reduce the attack "
            "surface and prevent a recurrence.*\n\n"
            "- [ ] Recommendation 1\n"
            "- [ ] Recommendation 2"
        ),
    },
]


def sections_for(template: dict | None) -> list[Section]:
    """
    The sections this template declares, in the order it declares them.

    Order matters and is the template's: it is the order of the editors in the
    Report tab, and of the headings in `{{report_content}}`. Sorting it here
    would quietly overrule whoever wrote the template.
    """
    declared = (template.get("report_sections") if template else None) or DEFAULT_SECTIONS

    sections: list[Section] = []
    seen: set[str] = set()
    for raw in declared:
        slug = section_slug(raw)
        if slug in seen:
            # Two sections resolving to one tag would make the second
            # unaddressable and silently overwrite the first at export.
            continue
        seen.add(slug)
        sections.append(Section(
            slug     = slug,
            name     = raw.get("name", "Section"),
            template = (raw.get("template") or "").strip(),
            category = (raw.get("category") or "analysis").lower().strip(),
            required = bool(raw.get("required", False)),
        ))
    return sections


class ReportService:
    def generate_analysis(self, case: Case, template: dict | None = None) -> dict:
        """
        The starting draft: every section, filled with its own guidance.

        Returns the sections themselves as well as the slug-keyed content, so
        the Report tab can lay out editors in template order without asking
        for the template separately.
        """
        sections = sections_for(template)

        return {
            "sections": [
                {
                    "slug":     s.slug,
                    "name":     s.name,
                    "category": s.category,
                    "required": s.required,
                }
                for s in sections
            ],
            "sections_data": {
                s.slug: (f"## {s.name}\n\n{s.template}" if s.template
                         else f"## {s.name}\n\n*...*")
                for s in sections
            },
        }
