"""
The report tag registry.

The list of `{{tags}}` used to live in seven places, and drift between them was
silent in both directions: a tag missing from the documentation still worked,
and a tag missing from the exporter's block set was written into the delivered
report as literal `{{text}}`. A client-facing document is the worst possible
place to discover a bookkeeping error.

So the registry is the single source, and these tests are what make that true
rather than aspirational - including the one that regenerates the documentation
and fails when the file has drifted.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services import report_tags

DOC = Path(__file__).resolve().parents[2] / "docs" / "REPORT_TEMPLATES.md"


class FakeCase:
    """Only what the resolvers touch. A real Case needs a session; this does not."""
    id                   = "c0ffee00-0000-0000-0000-000000000000"
    title                = "Acme ransomware"
    status               = None
    severity             = None
    tlp                  = "AMBER"
    created_at           = None
    closed_at            = None
    description          = "Encrypted file servers"
    executive_summary    = ""
    quick_notes          = ""
    assigned_to          = None
    tags                 = "ransomware, acme"
    report_sections_data = json.dumps({
        "scope":       "Three file servers and one domain controller.",
        "containment": "",
    })


# ─── The registry is coherent ─────────────────────────────────────────────────

def test_every_tag_declares_a_group_and_a_description():
    for tag in report_tags.all_tags():
        assert tag.name, "a tag with no name is unaddressable"
        assert tag.group in report_tags.GROUP_LABELS, f"{tag.name} has group {tag.group!r}"
        assert tag.description.strip(), f"{tag.name} has no description"


def test_text_tags_resolve_and_block_tags_do_not():
    """
    The distinction is load-bearing: a text tag is substituted in place, a
    block tag replaces its paragraph. Getting it wrong in either direction
    produces a broken document rather than an error.
    """
    for tag in report_tags.all_tags():
        if tag.kind == "text":
            assert tag.resolve is not None
        else:
            assert tag.resolve is None


def test_a_tag_cannot_be_registered_twice():
    with pytest.raises(ValueError, match="registered twice"):
        report_tags.block_tag("ioc_table", report_tags.GROUP_ANNEX, "a duplicate")


def test_every_text_tag_resolves_to_a_string():
    context = report_tags.build_context(FakeCase(), "analyst")

    assert context["case.title"] == "Acme ransomware"
    assert context["report.author"] == "analyst"
    assert all(isinstance(v, str) for v in context.values())


def test_the_context_holds_text_tags_only():
    """A block tag in the context would be substituted as a bare string and
    the table it stands for would never be drawn."""
    context = report_tags.build_context(FakeCase(), "analyst")

    assert report_tags.block_names().isdisjoint(context)


# ─── Per-case sections ────────────────────────────────────────────────────────

def test_case_sections_are_tags_without_being_registered():
    sections = report_tags.section_tags(FakeCase())

    assert set(sections) == {"scope", "containment"}
    assert sections["scope"].startswith("Three file servers")


def test_a_section_cannot_shadow_a_registered_tag():
    """Otherwise a section called `ioc_table` would silently replace the table."""
    class Shadowing(FakeCase):
        report_sections_data = json.dumps({"ioc_table": "not the IOC table"})

    assert report_tags.section_tags(Shadowing()) == {}


@pytest.mark.parametrize("raw", ["", None, "not json", "[1, 2]", "null"])
def test_unreadable_section_data_is_no_sections_rather_than_a_crash(raw):
    class Broken(FakeCase):
        report_sections_data = raw

    assert report_tags.section_tags(Broken()) == {}


# ─── The API serves the registry ──────────────────────────────────────────────

def test_the_tags_endpoint_returns_the_registry(auth_client: TestClient):
    response = auth_client.get("/api/v1/report-doc-templates/tags")
    assert response.status_code == 200, response.text

    served = response.json()
    assert [t["name"] for t in served] == report_tags.names()
    assert all(t["description"] and t["group_label"] for t in served)


# ─── The documentation is a consequence, not a promise ────────────────────────

def test_the_tag_reference_matches_the_registry():
    """
    Regenerates the fenced block in docs/REPORT_TEMPLATES.md and compares.

    If this fails, the registry changed and the document did not. Do not edit
    the table by hand - run the fix below, which is what generated it:

        python -c "from pathlib import Path; \\
                   from app.services import report_tags as r; \\
                   p = Path('docs/REPORT_TEMPLATES.md'); \\
                   p.write_text(r.render_doc_section(p.read_text()))"
    """
    current = DOC.read_text()

    assert report_tags.render_doc_section(current) == current, (
        "docs/REPORT_TEMPLATES.md is out of date with the tag registry")


def test_every_registered_tag_appears_in_the_reference():
    """The point of the whole exercise, asserted directly."""
    reference = DOC.read_text()

    for tag in report_tags.all_tags():
        assert f"`{{{{{tag.name}}}}}`" in reference, f"{tag.name} is undocumented"
