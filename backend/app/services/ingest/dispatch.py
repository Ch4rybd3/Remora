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
    STATE_BROWSABLE,
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


@dataclass(frozen=True)
class Context:
    """
    Everything a handler needs beyond the file itself.

    `out_dir` is the reason this exists. A parser writes CSVs, and the Explorer
    reads them **in place** - it does not copy them - so where they are written
    decides whether the table still has rows tomorrow. Handing each handler a
    scratch directory of its own produced tables that listed a row count and
    opened empty, because the directory was gone by the time anyone looked.

    `collection_id` travels with it so every record a handler creates can be
    attributed to the import that created it, which is what makes deleting a
    collection remove what it produced instead of orphaning it.
    """
    db:            Session
    case_id:       str
    path:          Path
    filename:      str
    #: Durable. Parser output registered in the Explorer is written here and
    #: must outlive the call - never a temporary directory.
    out_dir:       Path
    collection_id: str | None = None
    #: The `ingested_files` / `imported_files` row being parsed, when known.
    source_file_id: str | None = None

    def parsed_dir(self) -> Path:
        """
        A durable directory for this artifact's parser output, unique to it.

        Named after the artifact **and** a digest of where it came from. A KAPE
        triage collects `NTUSER.DAT` once per user profile, and a directory
        named only after the file would have the second parse overwrite the
        first - leaving one record describing another hive's rows.
        """
        import hashlib

        stem = Path(self.filename).stem[:48] or "artifact"
        # Not the filename: two artifacts share it, which is the whole problem.
        digest = hashlib.sha256(str(self.path).encode()).hexdigest()[:8]
        target = self.out_dir / f"{stem}-{digest}"
        target.mkdir(parents=True, exist_ok=True)
        return target

    def produced(self, kind: str, record_id: str | None,
                 file_path: str | None = None) -> None:
        """Attribute a record this handler just created to the collection."""
        from . import outputs

        outputs.record(
            self.db, case_id=self.case_id, collection_id=self.collection_id,
            kind=kind, record_id=record_id, file_path=file_path,
            source_file_id=self.source_file_id,
        )


#: A handler receives the context and returns what became of the file. It must
#: not raise for bad input - `parse()` converts an exception into `failed` with
#: the reason attached, because a parser crash is a fact about one file and
#: never a reason to lose it.
Handler = Callable[[Context], ParseResult]


# ─── Handlers ─────────────────────────────────────────────────────────────────

def _record_id(db: Session, row: object) -> str | None:
    """
    The primary key of a row that may not have been flushed yet.

    Several `register_*` helpers leave the id to a column default, so it does
    not exist until the INSERT runs. Reading it before the flush recorded
    `None`, and an output row with no record id names nothing.
    """
    value = getattr(row, "id", None)
    if value is None:
        db.flush()
        value = getattr(row, "id", None)
    # `str(None)` is `"None"`, which is truthy and passes for an id all the way
    # into the database. That is how `imported_files.csv_artifact_id` came to
    # hold the four characters "None" for every collection ever imported.
    return str(value) if value is not None else None


def _register_table(ctx: Context, csv_path: Path) -> str | None:
    """Register one CSV in the Explorer and attribute it to the collection."""
    from ...models.collection_output import OUTPUT_CSV_ARTIFACT
    from ...routers.csv_artifacts import register_csv_artifact

    artifact = register_csv_artifact(csv_path, ctx.case_id, ctx.db)
    if artifact is None:
        return None
    artifact_id = _record_id(ctx.db, artifact)
    ctx.produced(OUTPUT_CSV_ARTIFACT, artifact_id, str(csv_path))
    return artifact_id


def _to_explorer(ctx: Context) -> ParseResult:
    """Tabular already: register it in the Artifact Explorer as-is."""
    from ...routers.csv_artifacts import register_csv_artifact

    artifact = register_csv_artifact(ctx.path, ctx.case_id, ctx.db)
    if artifact is None:
        return ParseResult(STATE_FAILED, error="The file could not be registered")

    from ...models.collection_output import OUTPUT_CSV_ARTIFACT
    artifact_id = _record_id(ctx.db, artifact)
    ctx.produced(OUTPUT_CSV_ARTIFACT, artifact_id, str(ctx.path))
    return ParseResult(STATE_INDEXED, artifact_id=artifact_id,
                       row_count=int(artifact.row_count or 0))


def _to_logs(ctx: Context) -> ParseResult:
    """
    An EVTX has **two homes**, and gets both.

    It goes to the Logs module, where Sigma detections run against it, and its
    EvtxECmd output goes to the Artifact Explorer, where a field can be pivoted
    on. Producing only one of the two is what forced a manual re-import: the
    analyst chasing a detection and the analyst chasing an account name are
    looking at the same file and need different tools on it.

    Only the Logs half happens here. The Explorer half is built once for the
    whole collection by the batch stage, because a triage holds hundreds of
    event logs and parsing them one at a time produced hundreds of one-file
    tables - each named `..._EvtxECmd_Output.csv`, none of them the table the
    analyst wanted. EvtxECmd pointed at a directory writes a single table with
    a `SourceFile` column instead.
    """
    from ...models.collection_output import OUTPUT_EVTX_FILE
    from ...routers.evtx import register_evtx_file

    try:
        row = register_evtx_file(ctx.path, ctx.case_id, ctx.filename, ctx.db)
        # The module keeps its own copy under the case's evtx directory, which
        # is outside the collection. Its path is recorded, not the source's, or
        # deleting the collection would leave the copy behind.
        ctx.produced(OUTPUT_EVTX_FILE, _record_id(ctx.db, row), str(row.file_path))
    except Exception as e:
        print(f"[dispatch] {ctx.filename} could not be registered in Logs: {e}",
              flush=True)
        return ParseResult(STATE_FAILED, error=str(e)[:500])

    # `parsed`, not `indexed`: the module parses in a daemon thread, and the
    # Explorer table is built at the end of the collection rather than here.
    return ParseResult(
        STATE_PARSED,
        error="In Logs. Its table is built with the rest of the event logs "
              "in this collection.",
    )


def _to_mail(ctx: Context) -> ParseResult:
    from ...models.collection_output import OUTPUT_EMAIL_FILE
    from ...routers.case_emails import register_email_file

    row = register_email_file(ctx.path, ctx.case_id, Path(ctx.filename).name, ctx.db)
    # No file path: Email Analysis stores the parsed message, not the .eml.
    ctx.produced(OUTPUT_EMAIL_FILE, _record_id(ctx.db, row))
    return ParseResult(STATE_INDEXED, row_count=1)


def _to_pcap(ctx: Context) -> ParseResult:
    """Dissect the capture, then register the packet list like any other table."""
    from ...services.pcap import convert_to_csv

    csv_path = convert_to_csv(ctx.path)
    artifact_id = _register_table(ctx, csv_path)
    if artifact_id is None:
        return ParseResult(STATE_FAILED, error="The packet list could not be registered")
    return ParseResult(STATE_INDEXED, artifact_id=artifact_id)


def _to_memory(ctx: Context) -> ParseResult:
    """
    Register a dump whose format already says which OS it came from.

    `parsed` rather than `indexed`: Volatility runs in a daemon thread and the
    plugin output is not queryable when this returns.
    """
    from ...models.collection_output import OUTPUT_MEMORY_DUMP
    from ...routers.memory import register_memory_dump

    kind = identify(ctx.path, name=ctx.filename).kind
    os_type = "linux" if kind == "memory_dump_linux" else "windows"
    row = register_memory_dump(ctx.path, ctx.case_id, ctx.filename, os_type, ctx.db)
    ctx.produced(OUTPUT_MEMORY_DUMP, _record_id(ctx.db, row), str(row.file_path))
    return ParseResult(STATE_PARSED)


#: Kinds a module opens as they stand, when no parser claims them. Not a
#: failure and not a gap: the file reached a page where it is useful, which is
#: the whole point of routing it.
_BROWSABLE_IN: dict[str, str] = {
    "registry_hive": "Browse it key by key in the Registry Explorer.",
}


def _to_ez_parsed(ctx: Context) -> ParseResult:
    """
    Run the Eric Zimmerman tool for this artifact and index what it produced.

    This is the `raw -> parsed -> Explorer` chain: a registry-derived artifact
    or an `$MFT` arrives as bytes nothing could query, and leaves as a table.

    The output goes to `ctx.out_dir`, which outlives this call. It used to go to
    a `TemporaryDirectory`, and the CSVs were registered and then deleted with
    it three lines later - the row count was read before the deletion, so the
    Explorer listed tables of 1,006 rows that opened empty. The scratch
    directory the sandbox works in is still temporary; only the output is not.

    A tool that emits several CSVs from one input - AmcacheParser writes one per
    entry type - registers all of them. Returning only the first would hide
    entire artifact classes behind a successful-looking parse.
    """
    import tempfile

    from . import ez_parsers

    kind = identify(ctx.path, name=ctx.filename).kind

    if not ez_parsers.supports(kind, ctx.filename) and kind in _BROWSABLE_IN:
        # A `SOFTWARE` hive has no tool and needs none. Calling that `failed`
        # put a red row in the queue for a file that had arrived exactly where
        # it belongs.
        return ParseResult(STATE_BROWSABLE, error=_BROWSABLE_IN[kind])

    out_dir = ctx.parsed_dir()

    with tempfile.TemporaryDirectory(prefix="ez-") as scratch:
        outcome = ez_parsers.run(kind, ctx.path, Path(scratch), out_dir=out_dir)

    if not outcome.ok:
        return ParseResult(STATE_FAILED, error=outcome.error)

    artifact_id = None
    rows = 0
    for csv_path in outcome.csv_files:
        registered = _register_table(ctx, csv_path)
        if registered is None:
            continue
        artifact_id = artifact_id or registered
        rows += _row_count(ctx.db, registered)

    if artifact_id is None:
        return ParseResult(STATE_FAILED,
                           error=f"{outcome.tool} produced output nothing could read")
    return ParseResult(STATE_INDEXED, artifact_id=artifact_id, row_count=rows)


def _row_count(db: Session, artifact_id: str) -> int:
    from ...models.csv_artifact import CsvArtifactFile

    row = db.get(CsvArtifactFile, artifact_id)
    return int(row.row_count or 0) if row else 0


def _to_batch(ctx: Context) -> ParseResult:
    """
    An artifact that is only useful alongside the others of its type.

    Four hundred prefetch files are one table, not four hundred, so the parsing
    happens once for the whole collection after the per-file pass - see
    `services/ingest/batch.py`. The row says `parsed` rather than `indexed`:
    the table exists at the end of the collection, not at the end of this call.
    """
    from . import batch

    kind = identify(ctx.path, name=ctx.filename).kind
    label = batch.label_for(kind) or kind
    return ParseResult(STATE_PARSED,
                       error=f"Parsed with the rest of the {label} in this collection")


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
    "Disk images are read in place, never copied - an acquisition is far too "
    "large to duplicate. Open it from the Disk Images page; the drop folder is "
    "a readable location, so it does not need to be moved anywhere."
)

def _unhandled_notes() -> dict[str, str]:
    """
    Why a recognised kind is not parsed - minus the ones a batch parser now
    covers. Telling an analyst prefetch cannot be read while reading it is
    worse than saying nothing.
    """
    from . import ez_parsers
    from .python_parsers import HANDLED_KINDS

    return {k: v for k, v in ez_parsers.UNHANDLED_NOTE.items() if k not in HANDLED_KINDS}


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

# The Eric Zimmerman parsers, added from their own table so the two stay in
# step: a recipe without a handler would be a tool nothing ever calls.
def _register_batch_handlers() -> None:
    """
    Kinds whose table is built once for the whole collection.

    Both families: the Python parsers written here, and the Eric Zimmerman
    tools that read a directory. What they share is that one file of the kind
    is not a useful table - a triage carries hundreds of event logs, shortcuts
    and prefetch files, and one table per file is the same data in a form
    nobody can query.

    Registered before the per-file table below, so `setdefault` there leaves
    these alone.
    """
    from . import ez_parsers
    from .python_parsers import HANDLED_KINDS

    for kind in HANDLED_KINDS:
        _HANDLERS.setdefault(kind, _to_batch)
    for kind in ez_parsers.BATCH_KINDS:
        # EVTX keeps `_to_logs`: it has a second home the batch stage does not
        # serve, and the module registration is per file.
        _HANDLERS.setdefault(kind, _to_batch)


def _register_ez_handlers() -> None:
    from . import ez_parsers

    for kind in ez_parsers.PARSEABLE_KINDS:
        # `setdefault`: a kind with a richer handler keeps it.
        _HANDLERS.setdefault(kind, _to_ez_parsed)


_register_batch_handlers()
_register_ez_handlers()

def handled_kinds() -> frozenset[str]:
    """
    Everything with a parser, computed rather than frozen at import.

    The Eric Zimmerman handlers register themselves below, so a constant taken
    here would be missing every one of them - and would look right.
    """
    return frozenset(_HANDLERS)


def has_handler(kind: str) -> bool:
    return kind in _HANDLERS


# ─── Entry points ─────────────────────────────────────────────────────────────

#: Where parser output goes when the caller did not say. A bare drop with no
#: collection around it still needs a durable directory, and beside the
#: artifact is the only place guaranteed to be writable and to survive.
PARSED_DIRNAME = "_parsed"


def parse(db: Session, *, case_id: str, path: Path, filename: str,
          kind: str | None = None, out_dir: Path | None = None,
          collection_id: str | None = None,
          source_file_id: str | None = None) -> ParseResult:
    """
    Parse one file and say what became of it.

    `kind` is optional: omitted, the file is identified from its bytes. That is
    the upgrade the legacy import gets by calling this - it dispatched on the
    filename extension, so a `.txt` that is really an EVTX went to the Explorer
    as a one-column table of binary garbage.

    `out_dir` is where a parser's output is written, and it must outlive this
    call: the Explorer reads those CSVs in place. Callers that know the
    collection pass its directory; the default puts them beside the artifact.
    """
    if not path.exists():
        return ParseResult(STATE_FAILED, error=f"File not found: {filename}")

    resolved = kind or identify(path, name=filename).kind
    handler = _HANDLERS.get(resolved)

    if handler is None:
        route = route_for(resolved)
        detail = _NEEDS_INPUT.get(resolved) or _unhandled_notes().get(resolved) or (
            f"'{resolved}' is recognised but its parser has not shipped yet"
            if route.pending else
            f"Nothing parses '{resolved}' yet")
        return ParseResult(STATE_UNSUPPORTED, error=detail)

    ctx = Context(
        db=db, case_id=case_id, path=path, filename=filename,
        out_dir=out_dir or (path.parent / PARSED_DIRNAME),
        collection_id=collection_id, source_file_id=source_file_id,
    )

    try:
        return handler(ctx)
    except Exception as e:
        # A parser crash is a fact about one file, never a reason to lose it or
        # to stop the batch it arrived in.
        db.rollback()
        return ParseResult(STATE_FAILED, error=str(e)[:500])


def resolve_stored_path(stored_path: str, base_path: Path | None = None) -> Path | None:
    """
    Find a file from its recorded `stored_path`, or None if it is gone.

    Paths are recorded relative to one of two roots - the drop folder for
    anything the pipeline ingested, the case data directory for anything the
    backfill found - and absolute for rows written before that was settled. All
    three are tried, because guessing wrong here reads as "the file is gone".
    """
    from ...config import settings

    candidate = Path(stored_path)
    if not stored_path:
        return None
    if candidate.is_absolute():
        return candidate if candidate.exists() else None
    roots = [base_path] if base_path else []
    roots += [Path(settings.dropzone_path), settings.case_data_path]
    for root in roots:
        if root and (root / candidate).exists():
            return root / candidate
    return None


def dispatch_file(db: Session, row: IngestedFile, base_path: Path | None = None,
                  commit: bool = True) -> ParseResult:
    """
    Advance one `ingested_files` row through parsing, and record the outcome.

    The row is updated whatever happens, including on failure - `failed` is a
    recoverable state carrying its reason, which is what makes the retry in the
    Collection tab worth offering.
    """
    path = resolve_stored_path(str(row.stored_path or ""), base_path) \
        or Path(str(row.stored_path or ""))

    result = parse(db, case_id=str(row.case_id), path=path,
                   filename=str(row.original_name),
                   kind=str(row.detected_kind) if row.detected_kind else None,
                   collection_id=str(row.collection_id) if row.collection_id else None,
                   source_file_id=str(row.id))

    row.state = result.state
    row.error = result.error
    if result.artifact_id:
        row.parsed_artifact_id = result.artifact_id
    db.add(row)
    if commit:
        db.commit()
    return result
