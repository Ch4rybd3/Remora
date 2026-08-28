"""
Turning a routed file into something the analyst can query.

Routing decides *where* a file belongs; this decides *what happens to it*. Until
this stage existed, `identify` and `route_for` produced a correct answer that
led nowhere - the pipeline knew a file was an EVTX bound for the Logs module and
had no way to send it there.

The handler table is declarative for the same reason the routing table is: a new
artifact type is one entry plus one parser, not an edit inside a router.

**These handlers wrap the parsers that already exist.** `register_csv_artifact`,
`register_evtx_file`, `register_email_file` and the PCAP converter are the code
that has been doing this work in production; wrapping rather than rewriting is
what makes it safe to route the legacy import through here too. The parsing
behaviour does not change - only who decides which parser runs, and on what
evidence.

See `docs/INGESTION.md` sections 4 and 6.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from ...models.ingest import (
    STATE_FAILED,
    STATE_INDEXED,
    STATE_PARSED,
    STATE_UNSUPPORTED,
    IngestedFile,
)
from .identify import identify
from .routing import route_for


@dataclass
class ParseResult:
    """What happened to one file."""
    state:       str
    artifact_id: str | None = None
    row_count:   int = 0
    error:       str | None = None

    @property
    def ok(self) -> bool:
        return self.state != STATE_FAILED


#: A handler receives the file and returns what became of it. It must not raise
#: for bad input - `parse()` converts an exception into `failed` with the reason
#: attached, because a parser crash is a fact about one file and never a reason
#: to lose it.
Handler = Callable[[Session, str, Path, str], ParseResult]


# ─── Handlers ─────────────────────────────────────────────────────────────────

def _to_explorer(db: Session, case_id: str, path: Path, filename: str) -> ParseResult:
    """Tabular already: register it in the Artifact Explorer as-is."""
    from ...routers.csv_artifacts import register_csv_artifact

    _ = filename
    artifact = register_csv_artifact(path, case_id, db)
    if artifact is None:
        return ParseResult(STATE_FAILED, error="The file could not be registered")
    return ParseResult(STATE_INDEXED, artifact_id=str(artifact.id),
                       row_count=int(artifact.row_count or 0))


def _to_logs(db: Session, case_id: str, path: Path, filename: str) -> ParseResult:
    """
    Hand an EVTX to the Logs module, which parses it in a daemon thread.

    `parsed` rather than `indexed`: the events are not queryable at the moment
    this returns, and saying otherwise would have the queue claim a file is
    ready before it is.
    """
    from ...routers.evtx import register_evtx_file

    register_evtx_file(path, case_id, filename, db)
    return ParseResult(STATE_PARSED)


def _to_mail(db: Session, case_id: str, path: Path, filename: str) -> ParseResult:
    from ...routers.case_emails import register_email_file

    register_email_file(path, case_id, Path(filename).name, db)
    return ParseResult(STATE_INDEXED, row_count=1)


def _to_pcap(db: Session, case_id: str, path: Path, filename: str) -> ParseResult:
    """Dissect the capture, then register the packet list like any other table."""
    from ...routers.csv_artifacts import register_csv_artifact
    from ...services.pcap import convert_to_csv

    _ = filename
    csv_path = convert_to_csv(path)
    artifact = register_csv_artifact(csv_path, case_id, db)
    if artifact is None:
        return ParseResult(STATE_FAILED, error="The packet list could not be registered")
    return ParseResult(STATE_INDEXED, artifact_id=str(artifact.id),
                       row_count=int(artifact.row_count or 0))


def _to_memory(db: Session, case_id: str, path: Path, filename: str) -> ParseResult:
    """
    Register a dump whose format already says which OS it came from.

    `parsed` rather than `indexed`: Volatility runs in a daemon thread and the
    plugin output is not queryable when this returns.
    """
    from ...routers.memory import register_memory_dump

    os_type = "linux" if identify(path, name=filename).kind == "memory_dump_linux" else "windows"
    register_memory_dump(path, case_id, filename, os_type, db)
    return ParseResult(STATE_PARSED)


#: Kinds the pipeline recognises but cannot act on without something only a
#: person can supply. Saying which is worth far more than a generic "no parser":
#: the analyst learns what to do instead, on the row, at the moment they look.
_RAW_MEMORY_NOTE = (
    "A raw memory image does not record which OS it came from, and guessing "
    "would queue the wrong Volatility plugins. Upload it from the Memory page, "
    "where the OS is chosen."
)
_BINARY_NOTE = (
    "Binaries are encrypted at rest under a password you choose, which the drop "
    "folder cannot ask for. Upload it from the Binary Analysis page."
)
_IMAGE_NOTE = (
    "Disk images are read in place from the images directory and never copied - "
    "a full acquisition is far too large. Point the Disk Images page at it."
)

_NEEDS_INPUT: dict[str, str] = {
    "memory_dump": _RAW_MEMORY_NOTE,
    "pe":       _BINARY_NOTE,
    "elf":      _BINARY_NOTE,
    "macho":    _BINARY_NOTE,
    "ewf":      _IMAGE_NOTE,
    "vmdk":     _IMAGE_NOTE,
    "vhd":      _IMAGE_NOTE,
    "vhdx":     _IMAGE_NOTE,
    "qcow":     _IMAGE_NOTE,
    "ad1":      _IMAGE_NOTE,
    "disk_raw": _IMAGE_NOTE,
}


#: Detected kind to handler. A kind absent from this table is stored and listed
#: but not parsed - `unsupported`, which is the honest answer while its parser
#: has not shipped. Binaries and raw disk images are deliberately absent: they
#: need something only a person can supply, and `_NEEDS_INPUT` above says what.
_HANDLERS: dict[str, Handler] = {
    "csv":    _to_explorer,
    "json":   _to_explorer,
    "jsonl":  _to_explorer,
    "text":   _to_explorer,
    "log":    _to_explorer,
    "xml":    _to_explorer,
    "evtx":   _to_logs,
    "eml":    _to_mail,
    "pcap":   _to_pcap,
    "pcapng": _to_pcap,
    "memory_dump_windows": _to_memory,
    "memory_dump_linux":   _to_memory,
}

HANDLED_KINDS = frozenset(_HANDLERS)


def has_handler(kind: str) -> bool:
    return kind in _HANDLERS


# ─── Entry points ─────────────────────────────────────────────────────────────

def parse(db: Session, *, case_id: str, path: Path, filename: str,
          kind: str | None = None) -> ParseResult:
    """
    Parse one file and say what became of it.

    `kind` is optional: omitted, the file is identified from its bytes. That is
    the upgrade the legacy import gets by calling this - it dispatched on the
    filename extension, so a `.txt` that is really an EVTX went to the Explorer
    as a one-column table of binary garbage.
    """
    if not path.exists():
        return ParseResult(STATE_FAILED, error=f"File not found: {filename}")

    resolved = kind or identify(path, name=filename).kind
    handler = _HANDLERS.get(resolved)

    if handler is None:
        route = route_for(resolved)
        detail = _NEEDS_INPUT.get(resolved) or (
            f"'{resolved}' is recognised but its parser has not shipped yet"
            if route.pending else
            f"Nothing parses '{resolved}' yet")
        return ParseResult(STATE_UNSUPPORTED, error=detail)

    try:
        return handler(db, case_id, path, filename)
    except Exception as e:
        # A parser crash is a fact about one file, never a reason to lose it or
        # to stop the batch it arrived in.
        db.rollback()
        return ParseResult(STATE_FAILED, error=str(e)[:500])


def dispatch_file(db: Session, row: IngestedFile, base_path: Path | None = None,
                  commit: bool = True) -> ParseResult:
    """
    Advance one `ingested_files` row through parsing, and record the outcome.

    The row is updated whatever happens, including on failure - `failed` is a
    recoverable state carrying its reason, which is what makes the retry in the
    Collection tab worth offering.
    """
    stored = str(row.stored_path or "")
    path = Path(stored)
    if base_path and not path.is_absolute():
        path = base_path / path

    result = parse(db, case_id=str(row.case_id), path=path,
                   filename=str(row.original_name),
                   kind=str(row.detected_kind) if row.detected_kind else None)

    row.state = result.state
    row.error = result.error
    if result.artifact_id:
        row.parsed_artifact_id = result.artifact_id
    db.add(row)
    if commit:
        db.commit()
    return result
