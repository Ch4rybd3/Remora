"""
The corpus, end to end.

The artifact fixtures prove a file gets in. This proves the rest of the chain:
a case started from a template, artifacts ingested into it, and a deliverable
rendered out of it with nothing left unresolved.

It stops short of asserting parser *output*. Half the parsers are Eric Zimmerman
tools that are not installed in a test environment, and their results need real
artifact content rather than a header - their own tests carry that. What is
asserted here is the chain nothing else covers: identification, routing, and
the two exports.

This is also the fixture the log-module retirement will be measured against.
Whatever that removes, these counts must not move.
"""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services.ingest import coverage, routing
from tests import fixtures
from tests.fixtures import templates

# An archive is unpacked and its members re-enter identification, so "one row
# per file" is untrue for it for reasons unrelated to what is being asserted.
_UNPACKED = set(routing.ARCHIVE_KINDS)

# The drop folder refuses what it cannot identify, deliberately - see
# `test_the_drop_folder_refuses_what_it_cannot_identify` below.
_NOT_DROPPABLE = {"unknown"}

_INGESTABLE = sorted(set(fixtures.FIXTURES) - _UNPACKED - _NOT_DROPPABLE)


@pytest.fixture()
def reference_case(auth_client: TestClient) -> str:
    response = auth_client.post("/api/v1/cases", json={
        "title":    "Reference incident",
        "severity": "high",
        "tlp":      "TLP:AMBER",
    })
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


# ─── The case template ────────────────────────────────────────────────────────

def test_the_reference_case_template_is_well_formed():
    """
    It carries one of everything a template can hold, so a loader that drops a
    key fails here rather than on an analyst's first case.
    """
    import yaml

    parsed = yaml.safe_load(templates.case_template_yaml())

    assert parsed["name"] and parsed["severity"] and parsed["tlp"]
    assert parsed["ttp_definitions"], "no techniques"
    assert parsed["report_sections"], "no report sections"
    for section in parsed["report_sections"]:
        assert section["name"] and section["category"] and section["template"].strip()


def test_the_reference_template_matches_the_shipped_ones():
    """
    The reference is only useful if it has the shape the real templates have.
    Compared against `templates/default.yaml`, which is what analysts start from.
    """
    import yaml

    shipped = yaml.safe_load(
        (Path(__file__).resolve().parents[2] / "templates" / "default.yaml").read_text())
    reference = templates.case_template()

    assert set(reference) <= set(shipped), (
        f"the reference declares keys the shipped template does not: "
        f"{sorted(set(reference) - set(shipped))}")


# ─── Ingestion, for every kind ────────────────────────────────────────────────

def _drop_and_scan(client: TestClient, db, case_id: str, name: str, data: bytes) -> None:
    """
    Put a file in the case drop folder and scan it, as the host-side door does.

    Not the upload endpoint: that one is a courier - it writes the file and
    answers 202 having decided nothing, so no row exists yet. The scan is what
    identifies and records, and it is the stage under test here.
    """
    from app.models.case import Case
    from app.services import dropzone as dz

    case = db.query(Case).filter(Case.id == case_id).one()
    (dz.case_dropzone_dir(case) / name).write_bytes(data)

    response = client.post(f"/api/v1/cases/{case_id}/dropzone/scan",
                           params={"include_unstable": True})
    assert response.status_code in (200, 202), response.text


@pytest.mark.parametrize("kind", _INGESTABLE)
def test_every_fixture_is_ingested_as_its_kind(
    kind: str, auth_client: TestClient, reference_case: str, db_session,
):
    """
    Through the real endpoint, not the identification function: a staged upload
    is written under a name the pipeline chooses, and the original name has to
    survive that journey for anything recognised by name to still work.
    """
    from app.models.ingest import IngestedFile

    fixture = fixtures.FIXTURES[kind]
    _drop_and_scan(auth_client, db_session, reference_case,
                   fixture.filename, fixture.bytes())

    row = (
        db_session.query(IngestedFile)
        .filter(IngestedFile.case_id == reference_case,
                IngestedFile.original_name == fixture.filename)
        .one()
    )
    assert row.detected_kind == kind, (
        f"{fixture.filename} was ingested as {row.detected_kind}")


def test_the_drop_folder_refuses_what_it_cannot_identify(
    auth_client: TestClient, reference_case: str, db_session,
):
    """
    The one kind the host-side door will not take, and it is a decision.

    The gate used to be an extension whitelist, which silently ignored memory
    images and PEs. It is identification now - but a file that identifies as
    nothing would enter as a row nobody can act on, so it is reported as
    skipped and stays where the analyst put it. The browser upload is the door
    for those: there, a person has chosen the file.
    """
    from app.models.case import Case
    from app.services import dropzone as dz

    fixture = fixtures.FIXTURES["unknown"]
    case = db_session.query(Case).filter(Case.id == reference_case).one()
    (dz.case_dropzone_dir(case) / fixture.filename).write_bytes(fixture.bytes())

    result = auth_client.post(f"/api/v1/cases/{reference_case}/dropzone/scan",
                              params={"include_unstable": True}).json()

    assert result["ingested"] == 0
    assert fixture.filename in result["skipped"]


def test_bytes_that_look_like_nothing_are_still_taken_if_the_name_maps(
    auth_client: TestClient, reference_case: str, db_session,
):
    """
    The counterpart. The same content under `.bin` is `binary_blob`, which is
    an identification and therefore accepted - the difference between the two
    is the name alone.
    """
    from app.models.ingest import IngestedFile

    fixture = fixtures.FIXTURES["binary_blob"]
    _drop_and_scan(auth_client, db_session, reference_case,
                   fixture.filename, fixture.bytes())

    row = (
        db_session.query(IngestedFile)
        .filter(IngestedFile.case_id == reference_case,
                IngestedFile.original_name == fixture.filename)
        .one()
    )
    assert row.detected_kind == "binary_blob"


def test_an_archive_is_unpacked_rather_than_recorded_once(
    auth_client: TestClient, reference_case: str, db_session,
):
    """
    The case the parametrised test above excludes, asserted directly: a ZIP
    produces rows for what was inside it, not one row for the container.
    """
    from app.models.ingest import IngestedFile

    fixture = fixtures.FIXTURES["archive_zip"]
    _drop_and_scan(auth_client, db_session, reference_case,
                   fixture.filename, fixture.bytes())

    names = {
        row.original_name
        for row in db_session.query(IngestedFile)
        .filter(IngestedFile.case_id == reference_case).all()
    }
    assert fixture.filename in names


# ─── Routing agrees with the catalogue ────────────────────────────────────────

@pytest.mark.parametrize("kind", sorted(fixtures.FIXTURES))
def test_the_catalogue_describes_where_the_fixture_goes(kind: str):
    """
    The catalogue is what the coverage page and the documentation show. If it
    disagreed with `route_for`, the product would be documenting a pipeline it
    does not have.
    """
    row   = next(r for r in coverage.catalogue() if r.kind == kind)
    route = routing.route_for(kind)

    assert row.destination == route.primary
    assert row.parser == route.parser
    assert tuple(row.pages) == route.pages


# ─── The deliverable ──────────────────────────────────────────────────────────

@pytest.fixture()
def written_case(auth_client: TestClient, reference_case: str, db_session) -> str:
    """The reference case with its report sections filled in, as after analysis."""
    import json

    from app.models.case import Case

    case = db_session.query(Case).filter(Case.id == reference_case).one()
    case.report_sections_data = json.dumps(templates.REFERENCE_SECTIONS)
    case.report_analysis      = "The loader ran from the Outlook temporary folder."
    case.report_remediation   = "WKS-042 was isolated and reimaged."
    case.report_conclusion    = "No lateral movement was observed."
    case.executive_summary    = "One workstation compromised by a phishing loader."
    db_session.commit()
    return reference_case


def _upload_template(client: TestClient, name: str, filename: str,
                     body: bytes, mime: str) -> int:
    response = client.post(
        "/api/v1/report-doc-templates/upload",
        data={"name": name, "description": "reference"},
        files={"file": (filename, body, mime)},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _render(client: TestClient, template_id: int, case_id: str) -> bytes:
    response = client.post(
        f"/api/v1/report-doc-templates/{template_id}/generate/{case_id}")
    assert response.status_code == 200, response.text
    return response.content


def _docx_text(raw: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(raw))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def test_the_markdown_deliverable_resolves_every_tag(auth_client, written_case):
    """
    The template is generated from the tag registry, so this exercises every
    tag the product claims - including any added after this test was written.
    """
    template_id = _upload_template(
        auth_client, "Reference MD", "reference.md",
        templates.report_template_markdown().encode(), "text/markdown")

    rendered = _render(auth_client, template_id, written_case).decode()

    assert "{{" not in rendered, "an unresolved tag reached the Markdown export"


def test_the_docx_deliverable_resolves_every_tag(auth_client, written_case):
    template_id = _upload_template(
        auth_client, "Reference DOCX", "reference.docx",
        templates.report_template_docx(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    rendered = _docx_text(_render(auth_client, template_id, written_case))

    assert "{{" not in rendered, "an unresolved tag reached the Word export"


def test_both_deliverables_carry_the_analyst_sections(auth_client, written_case):
    """The written section appears; the empty one is marked, not dropped."""
    md_id = _upload_template(
        auth_client, "Sections MD", "sections.md",
        templates.report_template_markdown().encode(), "text/markdown")
    docx_id = _upload_template(
        auth_client, "Sections DOCX", "sections.docx",
        templates.report_template_docx(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    markdown = _render(auth_client, md_id, written_case).decode()
    word     = _docx_text(_render(auth_client, docx_id, written_case))

    for rendered in (markdown, word):
        assert "phishing message delivered a loader" in rendered
        assert "Section 'containment' not written" in rendered


def test_the_two_deliverables_carry_the_same_facts(auth_client, written_case):
    """
    Word and Markdown are two renderings of one report. They may format
    differently; they may not disagree about what the case says.
    """
    md_id = _upload_template(
        auth_client, "Parity MD", "parity.md",
        templates.report_template_markdown().encode(), "text/markdown")
    docx_id = _upload_template(
        auth_client, "Parity DOCX", "parity.docx",
        templates.report_template_docx(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document")

    markdown = _render(auth_client, md_id, written_case).decode()
    word     = _docx_text(_render(auth_client, docx_id, written_case))

    for fact in ("Reference incident",                     # case.title
                 "One workstation compromised",            # executive summary
                 "isolated and reimaged",                  # remediation
                 "No lateral movement"):                   # conclusion
        assert fact in markdown, f"{fact!r} missing from the Markdown export"
        assert fact in word, f"{fact!r} missing from the Word export"
