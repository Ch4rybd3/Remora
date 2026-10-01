"""
Word mechanics the DOCX exporter needs: annex table styling, and the TOC field.

**Annex tables.** Remora used to paint every annex table itself - navy header,
white bold text, grey banding, 9/8 pt - with the colours written as literals in
the exporter. That is a visual identity, and it was Remora's, not the client's:
a firm whose report template is set in their own typeface and palette got four
tables in ours in the middle of it.

So the document decides now, by convention, with two fallbacks:

1. a table style named **Remora Annex** in the report template - the author
   designs the annex tables in Word, where designing tables belongs;
2. failing that, the document's own default table style, when its author set
   one that is not Word's borderless ``Normal Table``;
3. failing that, the rendering Remora always had.

Only the look is delegated. Column proportions, header-row repetition and the
order of the rows are information design and stay here in every case.

**The table of contents.** A real Word ``TOC`` field, not a rendered list, so it
is clickable, updates with the document and picks up the heading styles the
template defines. Marked *dirty*, which is the flag that tells Word to build it
when the document is opened - the text Remora leaves in the field is only what
shows in a viewer that refuses to.
"""
from __future__ import annotations

from dataclasses import dataclass

#: The convention. A report template that defines a table style under this name
#: gets it applied to every annex table, and nothing of Remora's own painting.
ANNEX_STYLE_NAME = "Remora Annex"

#: Word's own default table style, which has no borders at all. Finding it as
#: "the document default" means nobody chose anything, not that the author wants
#: invisible annex tables.
_WORD_DEFAULT_TABLE_STYLES = {"Normal Table", "Table Normal", "TableNormal"}

#: What `{{toc}}` becomes. `\o "1-3"` takes Heading 1 to 3, `\h` makes the
#: entries hyperlinks, `\z` hides page numbers in web layout, `\u` uses the
#: outline level of the paragraph.
TOC_INSTRUCTION = r' TOC \o "1-3" \h \z \u '

#: Shown only where the field was never built - Word builds it on open.
TOC_PLACEHOLDER = (
    "Table of contents - right-click here and choose Update Field if your "
    "reader has not built it."
)


@dataclass(frozen=True)
class AnnexStyle:
    """How the annex tables of one document should look."""

    #: A Word table style to apply, or None when Remora paints the table.
    name:   str | None
    #: Where that decision came from: "template", "document" or "built-in".
    source: str

    @property
    def paints(self) -> bool:
        """True when Remora applies its own borders, fills and font sizes."""
        return self.name is None


BUILT_IN = AnnexStyle(name=None, source="built-in")


def annex_style(doc) -> AnnexStyle:
    """
    Resolve which of the three the report template asked for.

    Reading the styles of an uploaded document is best-effort by nature: it is a
    file somebody produced in some version of some word processor. A style that
    cannot be read is not a reason to fail an export, so anything unexpected
    falls through to the rendering that needs nothing from the document.
    """
    from docx.enum.style import WD_STYLE_TYPE  # type: ignore

    try:
        styles = doc.styles
    except Exception:
        return BUILT_IN

    for style in styles:
        try:
            if style.type == WD_STYLE_TYPE.TABLE and style.name == ANNEX_STYLE_NAME:
                return AnnexStyle(name=ANNEX_STYLE_NAME, source="template")
        except Exception:
            continue

    try:
        default = styles.default(WD_STYLE_TYPE.TABLE)
        if default is not None and default.name not in _WORD_DEFAULT_TABLE_STYLES:
            return AnnexStyle(name=str(default.name), source="document")
    except Exception:
        pass

    return BUILT_IN


def apply_annex_style(table, style: AnnexStyle) -> None:
    """Put *style* on *table*, if it names one. A style Word rejects is skipped."""
    if style.name is None:
        return
    try:
        table.style = style.name
    except (KeyError, ValueError):
        pass


def repeat_header_row(table) -> None:
    """
    Mark the first row as a header, so it repeats on every page.

    Nothing to do with the look: an annex table of two hundred indicators runs
    over three pages, and on pages two and three the columns were unlabelled.
    """
    from docx.oxml import OxmlElement  # type: ignore
    from docx.oxml.ns import qn  # type: ignore

    tr = table.rows[0]._tr
    trPr = tr.get_or_add_trPr()
    if trPr.find(qn("w:tblHeader")) is not None:
        return
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    trPr.append(header)


# ─── Table of contents ────────────────────────────────────────────────────────

def insert_toc_field(paragraph) -> None:
    """
    Turn *paragraph* into a Word table-of-contents field.

    The runs that held `{{toc}}` are removed and replaced by the five runs a
    field is made of: begin, instruction, separate, the result, end. `w:dirty`
    on the opening character is what makes Word rebuild the result when the
    document opens, which is the whole reason this is a field and not a list.
    """
    from docx.oxml import OxmlElement  # type: ignore
    from docx.oxml.ns import qn  # type: ignore

    for run in list(paragraph._p.findall(qn("w:r"))):
        paragraph._p.remove(run)

    def _char(kind: str, dirty: bool = False):
        run = OxmlElement("w:r")
        fld = OxmlElement("w:fldChar")
        fld.set(qn("w:fldCharType"), kind)
        if dirty:
            fld.set(qn("w:dirty"), "true")
        run.append(fld)
        return run

    instruction = OxmlElement("w:r")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = TOC_INSTRUCTION
    instruction.append(instr_text)

    paragraph._p.append(_char("begin", dirty=True))
    paragraph._p.append(instruction)
    paragraph._p.append(_char("separate"))
    paragraph.add_run(TOC_PLACEHOLDER)
    paragraph._p.append(_char("end"))


def markdown_toc(rendered: str) -> str:
    """
    A table of contents for the Markdown export, built from its own headings.

    Markdown has no field to update, so the only honest options were a literal
    note saying the feature is DOCX-only or an actual list. The list is better
    and costs the headings a second read. It is built from the *rendered*
    document, after every section has been substituted in, because the headings
    live inside those sections.
    """
    entries: list[tuple[int, str]] = []
    in_code = False

    for line in rendered.split("\n"):
        if line.lstrip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        stripped = line.strip()
        level = len(stripped) - len(stripped.lstrip("#"))
        if 1 <= level <= 3 and stripped[level:level + 1] == " ":
            title = stripped[level + 1:].strip()
            if title:
                entries.append((level, title))

    if not entries:
        return "*No headings to list.*"

    import re

    lines = []
    for level, title in entries:
        anchor = re.sub(r"[^a-z0-9\s-]", "", title.lower())
        anchor = re.sub(r"\s+", "-", anchor.strip())
        lines.append(f"{'  ' * (level - 1)}- [{title}](#{anchor})")
    return "\n".join(lines)
