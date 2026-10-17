"""
What Remora can parse, derived from the tables that do the parsing.

"Which artifacts does it support?" is the first question anyone asks, and until
now it was answered by reading source - `docs/COVERAGE.md` was measured against
a real triage once and has been drifting since, because nothing connects it to
the code.

Nothing here declares anything. Every row is a join across the registries that
already exist:

| Source | What it contributes |
|---|---|
| `_SIGNATURES` | Which kinds bytes can prove |
| `_EXTENSIONS` `_EXACT_NAMES` `_FOLDER_HINTS` | Which kinds a name can suggest |
| `_CONTAINER_REFINEMENTS` | Which kinds are a named artifact inside SQLite, ESE or OLECF |
| `routing._ROUTES` | Where a kind goes, which parser, and whether that parser has shipped |
| `ez_parsers.RECIPES` | Which Eric Zimmerman tool runs, and over a file or a directory |
| `python_parsers.PARSERS` | Which parser we wrote ourselves, and why it had to exist |
| `dispatch._NEEDS_INPUT` | Which kinds are stored and deliberately not parsed |

A parser added without a row appearing here means one of those registries was
bypassed, which is the bug this module exists to make visible.
"""
from __future__ import annotations

from dataclasses import dataclass

from . import ez_parsers, python_parsers, routing

# `from . import identify` would bind the *function* the package re-exports,
# not the module - `__init__.py` rebinds the name. The tables live on the
# module, so it is imported the long way round.
from .identify import (
    _CONTAINER_REFINEMENTS,
    _EXACT_NAMES,
    _EXTENSIONS,
    _FOLDER_HINTS,
    _SIGNATURES,
)

# ─── Status vocabulary ────────────────────────────────────────────────────────
# Ordered from "most useful to the analyst" down, which is also the order the
# generated table sorts by within a group.

STATUS_TABULAR   = "tabular"        # already a table; straight into the Explorer
STATUS_PARSED    = "parsed"         # a parser runs and produces tables
STATUS_BROWSE    = "browse"         # readable in its own module, never tabulated
STATUS_ANALYST   = "needs_analyst"  # recognised and stored; a person must choose
STATUS_PENDING   = "pending"        # parser named, not yet shipped
STATUS_CONTAINER = "container"      # unpacked, members re-enter identification
STATUS_HELD      = "held"           # stored and listed, awaiting a decision
STATUS_GAP       = "gap"            # routed to a parser nothing actually calls

STATUS_LABELS: dict[str, str] = {
    STATUS_TABULAR:   "Tabular already",
    STATUS_PARSED:    "Parsed",
    STATUS_BROWSE:    "Browsable, not tabulated",
    STATUS_ANALYST:   "Needs an analyst",
    STATUS_PENDING:   "Parser not shipped",
    STATUS_CONTAINER: "Unpacked",
    STATUS_HELD:      "Held for a decision",
    STATUS_GAP:       "Routed but never dispatched",
}

#: Parser slugs implemented inside a module rather than by a shared registry.
#: Listed here because there is no table to read them from - if that changes,
#: this set should shrink to nothing.
_MODULE_PARSERS: dict[str, str] = {
    "pcap":                "PCAP module",
    "mail":                "Email Analysis module",
    "binary":              "Binary Analysis module",
    "volatility":          "Memory module (Volatility 3)",
    "filesystem_listing":  "Disk Images module (dissect.target)",
}


@dataclass(frozen=True)
class KindCoverage:
    kind:          str
    label:         str
    #: "magic", "extension", "filename", "folder", "inside a container"
    recognised_by: tuple[str, ...]
    #: The extensions and file names that reach this kind.
    formats:       tuple[str, ...]
    destination:   str | None
    parser:        str | None
    #: Who runs it: an Eric Zimmerman tool, one of ours, or a module.
    engine:        str | None
    status:        str
    note:          str
    pages:         tuple[str, ...]

    @property
    def status_label(self) -> str:
        return STATUS_LABELS.get(self.status, self.status)


# ─── Reading the identification tables ────────────────────────────────────────

def _labels_and_recognition() -> tuple[dict[str, str], dict[str, set[str]], dict[str, set[str]]]:
    """
    Per kind: its best label, how it can be recognised, and by which names.

    The label preferred is the one attached to the most specific evidence - a
    magic number beats an extension, because that is also the order
    `identify()` itself trusts them in.
    """
    labels:  dict[str, str]      = {}
    how:     dict[str, set[str]] = {}
    formats: dict[str, set[str]] = {}

    def note(kind: str, label: str, source: str, fmt: str | None, strong: bool) -> None:
        if strong or kind not in labels:
            labels[kind] = label
        how.setdefault(kind, set()).add(source)
        if fmt:
            formats.setdefault(kind, set()).add(fmt)

    for _offset, magic, kind, label in _SIGNATURES:
        note(kind, label, "magic", None, strong=True)
        _ = magic

    for container, members in _CONTAINER_REFINEMENTS.items():
        for needle, kind, label in members:
            note(kind, label, f"inside {container}", needle, strong=True)

    for ext, (kind, label) in _EXTENSIONS.items():
        note(kind, label, "extension", ext, strong=False)

    for name, (kind, label) in _EXACT_NAMES.items():
        note(kind, label, "filename", name, strong=False)

    for folder, (kind, label) in _FOLDER_HINTS.items():
        note(kind, label, "folder", f"{folder}/", strong=False)

    # A hive's *name* is what selects its parser, so the names that select one
    # belong in the formats column rather than being invisible.
    for needle, _recipe in ez_parsers.HIVE_RECIPES:
        formats.setdefault("registry_hive", set()).add(needle)

    return labels, how, formats


# ─── Reading the parser registries ────────────────────────────────────────────

def _engine_for(kind: str, parser: str | None) -> str | None:
    """
    Who actually does the work, named.

    Not keyed on the routing table's `parser` slug alone: a registry hive has
    no slug there and is still parsed, by whichever Eric Zimmerman tool its
    *filename* selects. Reporting that as "no parser" was the first thing this
    catalogue got wrong about itself.
    """
    own = python_parsers.parser_for(kind)
    if own is not None:
        return f"Remora parser ({own.label})"

    if kind == "registry_hive":
        tools = sorted({recipe.tool for _needle, recipe in ez_parsers.HIVE_RECIPES})
        return f"{', '.join(tools)} - which one depends on the hive"

    recipe = ez_parsers.recipe_for(kind)
    if recipe is not None:
        over = "a directory" if recipe.dir_args else "one file at a time"
        return f"{recipe.tool}, over {over}"

    return _MODULE_PARSERS.get(parser) if parser else None


def _needs_analyst() -> dict[str, str]:
    """Kinds the pipeline deliberately does not parse, and what is missing."""
    from .dispatch import _NEEDS_INPUT

    return dict(_NEEDS_INPUT)


def _handler_name(kind: str) -> str | None:
    """
    Which dispatch stage claims this kind, by function name.

    Read rather than inferred. `_HANDLERS` is what actually runs, and it is
    assembled at import time from three sources - an explicit table, the
    Python parsers, and the Eric Zimmerman recipes - so it is the only place
    that knows the final answer. Deriving the status from the routing table
    instead put a registry hive under "already tabular", because its route
    carries no parser and still reaches the Explorer page.
    """
    from .dispatch import _HANDLERS

    handler = _HANDLERS.get(kind)
    return handler.__name__ if handler else None


def _status_for(kind: str, route: routing.Route, engine: str | None) -> str:
    if route.primary == routing.DEST_UNPACK:
        return STATUS_CONTAINER
    if kind in _needs_analyst():
        return STATUS_ANALYST
    if route.pending:
        return STATUS_PENDING

    handler = _handler_name(kind)
    if handler == "_to_explorer":
        # Already a table. The "parser" is a read, not a conversion.
        return STATUS_TABULAR
    if handler is not None:
        return STATUS_PARSED
    if route.parser is not None:
        # The routing table promises a parser and no dispatch stage claims the
        # kind, so the file is stored and silently does nothing. This is drift
        # between two registries, not a decision - which is the whole reason
        # the catalogue is a join rather than a list.
        return STATUS_GAP
    if route.primary == routing.DEST_COLLECTION:
        return STATUS_HELD
    return STATUS_BROWSE


def _note_for(kind: str, status: str) -> str:
    if status == STATUS_ANALYST:
        return _needs_analyst().get(kind, "")
    own = python_parsers.parser_for(kind)
    if own is not None:
        return own.because
    return ez_parsers.UNHANDLED_NOTE.get(kind, "")


# ─── The catalogue ────────────────────────────────────────────────────────────

def catalogue() -> list[KindCoverage]:
    """
    Every kind the pipeline knows, joined across the registries.

    Ordered by status, then by kind, so reading it top to bottom goes from
    what an analyst gets for free to what still needs a decision.
    """
    labels, how, formats = _labels_and_recognition()
    order = list(STATUS_LABELS)
    rows: list[KindCoverage] = []

    for kind in routing.KNOWN_KINDS:
        route  = routing.route_for(kind)
        engine = _engine_for(kind, route.parser)
        status = _status_for(kind, route, engine)
        rows.append(KindCoverage(
            kind          = kind,
            label         = labels.get(kind, kind.replace("_", " ").title()),
            recognised_by = tuple(sorted(how.get(kind, set()))),
            formats       = tuple(sorted(formats.get(kind, set()))),
            destination   = route.primary,
            parser        = route.parser,
            engine        = engine,
            status        = status,
            note          = _note_for(kind, status),
            pages         = route.pages,
        ))

    rows.sort(key=lambda r: (order.index(r.status), r.kind))
    return rows


def as_dicts() -> list[dict]:
    """The catalogue as JSON, for `GET /api/v1/coverage` and the UI."""
    return [
        {
            "kind":          row.kind,
            "label":         row.label,
            "recognised_by": list(row.recognised_by),
            "formats":       list(row.formats),
            "destination":   row.destination,
            "parser":        row.parser,
            "engine":        row.engine,
            "status":        row.status,
            "status_label":  row.status_label,
            "note":          row.note,
            "pages":         list(row.pages),
        }
        for row in catalogue()
    ]


def summary() -> dict[str, int]:
    """How many kinds sit in each status. The headline number for the page."""
    counts: dict[str, int] = dict.fromkeys(STATUS_LABELS, 0)
    for row in catalogue():
        counts[row.status] += 1
    return counts


# ─── Documentation ────────────────────────────────────────────────────────────

DOC_BEGIN = "<!-- BEGIN GENERATED COVERAGE - edit the ingest registries, not this -->"
DOC_END   = "<!-- END GENERATED COVERAGE -->"


def _cell(values: tuple[str, ...]) -> str:
    return ", ".join(f"`{v}`" for v in values) if values else "—"


def as_markdown() -> str:
    """The catalogue as the Markdown tables that belong in COVERAGE.md."""
    rows   = catalogue()
    counts = summary()
    lines: list[str] = []

    lines.append(f"**{len(rows)} artifact kinds** the pipeline recognises:")
    lines.append("")
    for status, label in STATUS_LABELS.items():
        if counts[status]:
            lines.append(f"- **{counts[status]}** {label.lower()}")
    lines.append("")

    for status, label in STATUS_LABELS.items():
        group = [r for r in rows if r.status == status]
        if not group:
            continue
        lines.append(f"### {label}")
        lines.append("")
        lines.append("| Kind | Artifact | Recognised by | Formats | Parser |")
        lines.append("|---|---|---|---|---|")
        for row in group:
            engine = row.engine or ("—" if not row.parser else f"`{row.parser}`")
            lines.append(
                f"| `{row.kind}` | {row.label} | {_cell(row.recognised_by)} "
                f"| {_cell(row.formats)} | {engine} |")
        lines.append("")

    return "\n".join(lines).rstrip()


def render_doc_section(current: str) -> str:
    """`current` with the fenced block replaced by the generated tables."""
    if DOC_BEGIN not in current or DOC_END not in current:
        raise ValueError(
            f"The coverage document is missing its {DOC_BEGIN!r} / {DOC_END!r} fences")
    head, rest = current.split(DOC_BEGIN, 1)
    _, tail    = rest.split(DOC_END, 1)
    return f"{head}{DOC_BEGIN}\n\n{as_markdown()}\n\n{DOC_END}{tail}"
