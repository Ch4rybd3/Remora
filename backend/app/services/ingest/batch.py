"""
Parsing a collection's artifacts by type, once each.

The per-file pipeline is right for an EVTX or an `$MFT`: one file in, one table
out. It is wrong for prefetch, where a triage holds four hundred of them and
each carries a handful of rows - parsed individually they become four hundred
artifacts in the Explorer, technically complete and completely unusable.

So after a collection's per-file pass, the files it left behind are grouped by
kind and handed to a batch parser. One table per artifact type per collection,
carrying a source column that says which file each row came from.

Two families of parser arrive here and are treated the same way:

* the Python parsers in `python_parsers/`, for what the Eric Zimmerman tools
  cannot do on Linux;
* the Eric Zimmerman tools that read a **directory** - EvtxECmd, LECmd, JLECmd.
  Pointed at a folder each writes a single CSV with a `SourceFile` column,
  which is what they were designed for and what per-file invocation threw away.

Failures here are logged and never raised. This runs after the ingest that
matters; a parser that crashes must not undo it.
"""
from __future__ import annotations

import json
import logging
import shutil
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from . import ez_parsers
from .identify import identify
from .python_parsers import PARSERS, BatchParser

logger = logging.getLogger("remora.batch")

#: Files a batch parser will not be asked about, whatever they contain. Walking
#: a KAPE triage means walking every user document it collected.
#:
#: `_parsed` is where this stage and the per-file parsers write their output.
#: Without it the second run over a collection would identify its own CSVs as
#: artifacts and parse them again.
_SKIP_DIRECTORIES = {".processed", ".failed", ".incoming", "_parsed"}

#: Where a collection's parser output lives, relative to the extracted tree.
#: Inside the collection so deleting the collection removes it, and outside the
#: extracted artifacts so it is never mistaken for one.
PARSED_DIRNAME = "_parsed"


@dataclass(frozen=True)
class _Job:
    """One parser and the kinds it claims, whichever family it comes from."""
    kinds: frozenset[str]
    label: str
    #: (paths, out_dir, scratch, base) -> the CSVs written. `base` is the
    #: collection root, so a source column can say where a file sat.
    run:   Callable[[list[Path], Path, Path, Path | None], list[Path]]


#: Where the confined process finds the application. The sandbox replaces the
#: environment wholesale - no inherited `PYTHONPATH` - so the one thing the
#: parser needs to import itself has to be handed to it explicitly.
def _import_root() -> Path:
    """
    The `backend/` directory, from this file's own location.

    `app/services/ingest/batch.py` - four levels up is `backend/`, which is
    what has to be on the path for `app` to be importable. Derived rather than
    configured: an installed layout that moved would break loudly here instead
    of silently running the parser unconfined.
    """
    return Path(__file__).resolve().parents[3]


def run_sandboxed(parser: BatchParser, paths: list[Path], out_dir: Path,
                  scratch: Path, base: Path | None = None) -> list[Path]:
    """
    Run one Python parser as a confined subprocess, and return what it wrote.

    The shape is the same as the Eric Zimmerman tools': stage the inputs into a
    directory the sandbox prepared, run, collect the output. Two things follow
    from that and are worth stating.

    **The parser only ever sees what was staged.** Not the drop folder, not the
    rest of the collection, not the evidence store. Its idea of the filesystem
    is a directory we built for it.

    **Output is written inside the workdir and moved afterwards.** The confined
    account cannot write to a directory the worker created as root, and
    handing it the collection's own `_parsed/` would mean granting a sandboxed
    process write access to case data. Moving the results out afterwards, as
    the worker, keeps the boundary in one direction.
    """
    from ...services import sandbox

    scratch.mkdir(parents=True, exist_ok=True)
    staged_dir = scratch / "input"
    inner_out  = scratch / "out"
    inner_tmp  = scratch / "tmp"
    for directory in (staged_dir, inner_out, inner_tmp):
        directory.mkdir(parents=True, exist_ok=True)

    staged: list[Path] = []
    for source in paths:
        try:
            staged.append(ez_parsers.stage_for_batch(source, staged_dir, base, None))
        except OSError as e:
            logger.warning("could not stage %s for %s: %s", source.name, parser.slug, e)

    if not staged:
        raise RuntimeError("None of the files could be staged for parsing")

    job_file    = scratch / "job.json"
    result_file = scratch / "result.json"
    job_file.write_text(json.dumps({
        "parser":  parser.slug,
        "paths":   [str(p) for p in staged],
        "out":     str(inner_out),
        "scratch": str(inner_tmp),
        # The staged tree mirrors the collection, so a source column still says
        # where a file sat - see `stage_for_batch`.
        "base":    str(staged_dir),
        "result":  str(result_file),
    }), encoding="utf-8")

    total = 0
    for source in paths:
        try:
            total += source.stat().st_size
        except OSError:
            pass

    result = sandbox.run(
        [sys.executable, "-m", "app.services.ingest.python_parsers", str(job_file)],
        workdir=scratch,
        limits=sandbox.Limits.for_input(total),
        env={"PYTHONPATH": str(_import_root()), "PYTHONDONTWRITEBYTECODE": "1"},
    )

    if result.stopped_by:
        raise RuntimeError(f"Stopped by the sandbox: {result.stopped_by}")
    if not result.ok:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        raise RuntimeError(detail[-1][:400] if detail
                           else f"{parser.slug} exited {result.exit_code}")

    try:
        produced = [Path(p) for p in
                    json.loads(result_file.read_text(encoding="utf-8"))["produced"]]
    except Exception as e:
        raise RuntimeError(f"{parser.slug} produced no readable result: {e}") from e

    return _collect(produced, inner_out, out_dir)


def _collect(produced: list[Path], inner_out: Path, out_dir: Path) -> list[Path]:
    """
    Move what the sandbox wrote into the collection, as the worker.

    Files, not the directory: the sandbox account owns what it created, and a
    move preserves that ownership. Copying and removing hands the results back
    to the worker, which is who the rest of the pipeline runs as.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    collected: list[Path] = []
    for source in produced:
        if not source.exists():
            continue
        try:
            relative = source.relative_to(inner_out)
        except ValueError:
            relative = Path(source.name)
        target = out_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        try:
            source.unlink()
        except OSError:
            pass
        collected.append(target)
    return collected


def _python_job(parser: BatchParser, base: Path | None = None) -> _Job:
    """
    A parser written here, run as its own process inside the sandbox.

    It used to be called directly, in the worker, as root. The Eric Zimmerman
    tools were contained from the day they shipped and these were not, which
    made the honest answer to "does Remora execute anything from the drop
    folder?" a qualified one. Row and tile caps bound the *work* a parser does;
    they say nothing about what the code can reach.

    Nothing about the parsers changed to make this possible - they are pure
    `(paths, out_dir, scratch, base) -> [paths]` functions with no database and
    no configuration, which is the property that let a process boundary be
    drawn around them at all.
    """
    def run(paths: list[Path], out_dir: Path, scratch: Path,
            _base: Path | None = None) -> list[Path]:
        return run_sandboxed(parser, paths, out_dir, scratch, base)

    return _Job(kinds=parser.kinds, label=parser.label, run=run)


def _ez_job(kinds: frozenset[str], recipe: ez_parsers.Recipe,
            base: Path | None = None) -> _Job:
    """
    One Eric Zimmerman tool, run once over every artifact it reads.

    `kinds` can hold more than one. JLECmd reads automatic and custom jump
    lists, which identification tells apart because their formats differ and
    the tool does not care - pointed at a directory it reads both and writes a
    table for each. Two jobs here would run it twice over half the files each,
    into the same output directory.
    """
    first = sorted(kinds)[0]

    def run(paths: list[Path], out_dir: Path, scratch: Path,
            _base: Path | None = None) -> list[Path]:
        outcome = ez_parsers.run_batch(first, paths, out_dir, scratch, base=base)
        if not outcome.ok:
            raise RuntimeError(outcome.error or f"{recipe.tool} produced nothing")
        return outcome.csv_files

    return _Job(kinds=kinds, label=recipe.label, run=run)


def jobs(base: Path | None = None) -> list[_Job]:
    """
    Every batch parser, both families, in one list.

    Built on each call rather than frozen at import: the Eric Zimmerman table
    is consulted for which tools are installed, and a constant taken here would
    be decided before provisioning had run.

    `base` is the collection root, passed through so a tool sees each artifact
    where it sat rather than in a flat pile. Callers that only want the labels
    omit it.
    """
    out = [_python_job(parser, base) for parser in PARSERS]

    # Grouped by tool, not by kind - see `_ez_job`.
    by_tool: dict[str, set[str]] = {}
    recipes: dict[str, ez_parsers.Recipe] = {}
    for kind, recipe in ez_parsers.BATCH_KINDS.items():
        by_tool.setdefault(recipe.tool, set()).add(kind)
        recipes.setdefault(recipe.tool, recipe)
    out += [_ez_job(frozenset(kinds), recipes[tool], base)
            for tool, kinds in sorted(by_tool.items())]
    return out


def label_for(kind: str) -> str | None:
    """The human name of the parser that will handle this kind in batch."""
    for job in jobs():
        if kind in job.kinds:
            return job.label
    return None


def _candidates(root: Path) -> list[Path]:
    return [
        path for path in root.rglob("*")
        if path.is_file()
        and not any(part in _SKIP_DIRECTORIES for part in path.parts)
    ]


def group_by_kind(root: Path) -> dict[str, list[Path]]:
    """
    Every file under `root` that a batch parser handles, by kind.

    Identification runs again here rather than being carried through: the batch
    stage is given a directory, not the ingest records, so that it works
    equally for a collection, an unpacked archive, or a folder somebody points
    it at.
    """
    wanted = {kind for job in jobs() for kind in job.kinds}
    grouped: dict[str, list[Path]] = {}
    for path in _candidates(root):
        try:
            kind = identify(path).kind
        except Exception:
            continue
        if kind in wanted:
            grouped.setdefault(kind, []).append(path)
    return grouped


def run(db: Session, case_id: str, root: Path,
        collection_id: str | None = None) -> list[str]:
    """
    Parse every batch-handled artifact under `root`, register the results.

    Returns the artifact ids created, for the caller to record.
    """
    from ...models.collection_output import OUTPUT_CSV_ARTIFACT
    from ...routers.csv_artifacts import register_csv_artifact
    from . import outputs

    grouped = group_by_kind(root)
    if not grouped:
        return []

    # Output lives beside the collection, not in a temporary directory: the
    # Explorer reads the CSV in place, so it has to outlive this call.
    out_root = root / PARSED_DIRNAME

    created: list[str] = []
    for job in jobs(base=root):
        paths = [p for kind in sorted(job.kinds) for p in grouped.get(kind, [])]
        if not paths:
            continue

        # One directory per parser, so two tools writing a file of the same
        # name - both `..._Output.csv` - do not overwrite each other.
        out_dir = out_root / job.label.split(" (")[0].replace(" ", "_").lower()

        with tempfile.TemporaryDirectory(prefix="batch-") as scratch:
            try:
                produced = job.run(paths, out_dir, Path(scratch), root)
            except Exception as e:
                logger.warning("%s parser failed over %d files: %s",
                               job.label, len(paths), e)
                print(f"[batch] {job.label} failed: {e}", flush=True)
                continue

        for csv_path in produced:
            try:
                artifact = register_csv_artifact(csv_path, case_id, db)
            except Exception as e:
                logger.warning("could not register %s: %s", csv_path.name, e)
                continue
            if artifact is not None:
                created.append(str(artifact.id))
                outputs.record(db, case_id=case_id, collection_id=collection_id,
                               kind=OUTPUT_CSV_ARTIFACT, record_id=str(artifact.id),
                               file_path=str(csv_path))
        if produced:
            print(f"[batch] {job.label}: {len(paths)} file(s) -> "
                  f"{len(produced)} table(s)", flush=True)

    return created
