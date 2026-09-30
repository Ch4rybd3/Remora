"""
One shape for report content.

A case used to carry three fixed columns - `report_analysis`,
`report_remediation`, `report_conclusion` - alongside a slug-keyed blob holding
one entry per section its template declared. The Report tab chose between them
at render time, so the same case could hold content in two shapes and the
exporter had four tags for the same material.

These tests pin what replaced it: the sections are the report, they keep the
order the template declares, and the combined view is derived rather than
edited. The last of those is the one that would rot quietly - a `{{report_content}}`
that had drifted from the sections it claims to combine would be wrong in a
client deliverable and right nowhere.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.services import report_tags
from app.services.report_service import (
    DEFAULT_SECTIONS,
    ReportService,
    section_slug,
    sections_for,
)

TEMPLATE = {
    "report_sections": [
        {"name": "Incident Overview", "category": "analysis",    "template": "How it was found."},
        {"name": "Technical Analysis", "category": "analysis",   "template": "The attack path.",
         "required": True},
        {"name": "Containment",       "category": "remediation", "template": "What was isolated."},
    ]
}


# ─── Slugs ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("section,expected", [
    ({"name": "Technical Analysis"},          "technical_analysis"),
    ({"name": "Conclusion & Recommendations"}, "conclusion_recommendations"),
    ({"name": "  Impact  "},                   "impact"),
    ({"name": "Analyse Technique"},            "analyse_technique"),
    ({"name": "!!!"},                          "section"),
])
def test_a_section_name_becomes_a_usable_tag(section, expected):
    assert section_slug(section) == expected


def test_an_explicit_tag_wins_over_the_name():
    """
    A section renamed for one client must not change the tag every report
    template already places. `tag:` is how a template author pins it.
    """
    assert section_slug({"name": "Deep Dive", "tag": "technical_analysis"}) \
        == "technical_analysis"


# ─── Order is the template's ──────────────────────────────────────────────────

def test_sections_keep_the_order_the_template_declares():
    """
    It is the order of the editors in the Report tab and of the headings in the
    exported document. Sorting it would overrule whoever wrote the template.
    """
    assert [s.slug for s in sections_for(TEMPLATE)] == [
        "incident_overview", "technical_analysis", "containment",
    ]


def test_a_case_with_no_template_still_has_sections():
    """Not an empty report: the three the product shipped with, as sections."""
    slugs = [s.slug for s in sections_for(None)]

    assert slugs == [section_slug(s) for s in DEFAULT_SECTIONS]
    assert len(slugs) == 3


def test_two_sections_cannot_claim_one_tag():
    """
    The second would be unaddressable and would silently overwrite the first at
    export - the worst possible place to discover a duplicate.
    """
    clashing = {"report_sections": [
        {"name": "Impact"},
        {"name": "impact!"},          # slugifies to the same thing
    ]}

    assert [s.slug for s in sections_for(clashing)] == ["impact"]


def test_a_section_can_declare_itself_required():
    required = {s.slug for s in sections_for(TEMPLATE) if s.required}

    assert required == {"technical_analysis"}


# ─── The starting draft ───────────────────────────────────────────────────────

def test_generating_fills_every_section_with_its_own_guidance():
    result = ReportService().generate_analysis(None, TEMPLATE)  # type: ignore[arg-type]

    assert [s["slug"] for s in result["sections"]] == [
        "incident_overview", "technical_analysis", "containment",
    ]
    assert "The attack path." in result["sections_data"]["technical_analysis"]
    assert result["sections_data"]["technical_analysis"].startswith("## Technical Analysis")


def test_generating_returns_the_sections_not_just_their_content():
    """
    So the Report tab can lay out editors in template order without fetching
    the case template separately - two requests that could disagree about the
    order is one request too many.
    """
    result = ReportService().generate_analysis(None, TEMPLATE)  # type: ignore[arg-type]

    assert set(result["sections"][0]) == {"slug", "name", "category", "required"}


# ─── The three tags are gone ──────────────────────────────────────────────────

@pytest.mark.parametrize("retired", [
    "report_analysis", "report_remediation", "report_conclusion",
])
def test_the_three_fixed_tags_are_no_longer_registered(retired):
    assert not report_tags.is_known(retired)


def test_report_content_survives_as_the_whole_report():
    """
    Kept, because a template that wants everything in one place is a reasonable
    template. Its meaning changed from "the three boxes" to "every section".
    """
    assert report_tags.is_known("report_content")
    description = next(
        t.description for t in report_tags.all_tags() if t.name == "report_content")
    assert "section" in description.lower()


def test_a_case_has_no_columns_for_the_retired_boxes():
    from app.models.case import Case

    for column in ("report_analysis", "report_remediation", "report_conclusion"):
        assert not hasattr(Case, column), f"{column} is still on the model"


# ─── Saving derives the combined view ─────────────────────────────────────────

@pytest.fixture()
def saved_case(auth_client: TestClient, db_session):
    """A case whose report has been saved through the API."""
    case_id = auth_client.post("/api/v1/cases/", json={"title": "Sections"}).json()["id"]

    response = auth_client.post(
        f"/api/v1/cases/{case_id}/report/save",
        json={"sections_data": {
            "technical_analysis": "## Technical Analysis\n\nThe loader ran from Outlook.",
            "containment":        "## Containment\n\nWKS-042 isolated.",
        }},
    )
    assert response.status_code == 200, response.text
    return case_id


def test_saving_stores_the_sections(auth_client, saved_case, db_session):
    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == saved_case).one()
    db_session.refresh(case)

    stored = json.loads(str(case.report_sections_data))
    assert set(stored) == {"technical_analysis", "containment"}


def test_saving_derives_the_combined_report(auth_client, saved_case, db_session):
    """
    `case.report` is what `{{report_content}}` injects and what a version
    snapshots. Derived on save rather than edited, so it cannot drift away from
    the sections it claims to combine.
    """
    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == saved_case).one()
    db_session.refresh(case)

    assert "The loader ran from Outlook." in str(case.report)
    assert "WKS-042 isolated." in str(case.report)


def test_an_empty_section_is_not_concatenated(auth_client, db_session):
    """A blank editor must not contribute a stray separator to the deliverable."""
    from app.models.case import Case

    case_id = auth_client.post("/api/v1/cases/", json={"title": "Blanks"}).json()["id"]
    auth_client.post(f"/api/v1/cases/{case_id}/report/save",
                     json={"sections_data": {"a": "Written.", "b": "   ", "c": ""}})

    case = db_session.query(Case).filter(Case.id == case_id).one()
    db_session.refresh(case)

    assert str(case.report).strip() == "Written."


# ─── The reference panel can ask about a case template ────────────────────────

def test_the_tags_endpoint_alone_returns_only_the_registry(auth_client: TestClient):
    served = auth_client.get("/api/v1/report-doc-templates/tags").json()

    assert [t["name"] for t in served] == report_tags.names()


def test_a_case_template_adds_its_section_tags(auth_client: TestClient):
    """
    The half a report-template author could not previously discover: which
    `{{slug}}` tags exist depends on the kind of investigation.
    """
    listed = auth_client.get("/api/v1/templates/").json()
    assert listed, "no case template is installed"
    template_id = listed[0]["id"]

    served = auth_client.get("/api/v1/report-doc-templates/tags",
                             params={"case_template_id": template_id}).json()
    names = [t["name"] for t in served]

    assert names[:len(report_tags.names())] == report_tags.names()
    assert len(names) > len(report_tags.names()), "no section tags were appended"
    assert all("case template" in t["group_label"].lower()
               for t in served[len(report_tags.names()):])


def test_an_unknown_case_template_is_a_404_not_a_silent_registry(auth_client: TestClient):
    """Returning just the registry would look like a template with no sections."""
    response = auth_client.get("/api/v1/report-doc-templates/tags",
                               params={"case_template_id": "does-not-exist"})

    assert response.status_code == 404
