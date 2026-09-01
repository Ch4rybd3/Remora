"""
Parsing a collection's artifacts by type, once each.

The per-file pipeline is right for an EVTX or an `$MFT`: one file in, one table
out. It is wrong for prefetch, where a triage holds four hundred of them and
each carries a handful of rows - parsed individually they become four hundred
artifacts in the Explorer, technically complete and completely unusable.

So after a collection's per-file pass, the files it left behind are grouped by
kind and handed to a batch parser. One table per artifact type per collection,
which is also what EvtxECmd does when pointed at a folder.

Failures here are logged and never raised. This runs after the ingest that
matters; a parser that crashes must not undo it.
"""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from sqlalchemy.orm import Session

from .identify import identify
from .python_parsers import PARSERS

logger = logging.getLogger("remora.batch")

#: Files a batch parser will not be asked about, whatever they contain. Walking
#: a KAPE triage means walking every user document it collected.
_SKIP_DIRECTORIES = {".processed", ".failed", ".incoming"}


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
    wanted = {kind for parser in PARSERS for kind in parser.kinds}
    grouped: dict[str, list[Path]] = {}
    for path in _candidates(root):
        try:
            kind = identify(path).kind
        except Exception:
            continue
        if kind in wanted:
            grouped.setdefault(kind, []).append(path)
    return grouped


def run(db: Session, case_id: str, root: Path) -> list[str]:
    """
    Parse every batch-handled artifact under `root`, register the results.

    Returns the artifact ids created, for the caller to record.
    """
    from ...routers.csv_artifacts import register_csv_artifact

    grouped = group_by_kind(root)
    if not grouped:
        return []

    created: list[str] = []
    for parser in PARSERS:
        paths = [p for kind in parser.kinds for p in grouped.get(kind, [])]
        if not paths:
            continue

        # Output lives beside the collection, not in a temporary directory: the
        # Explorer reads the CSV in place, so it has to outlive this call.
        out_dir = root / "_parsed"
        with tempfile.TemporaryDirectory(prefix="batch-") as scratch:
            try:
                produced = parser.run(paths, out_dir, Path(scratch))
            except Exception as e:
                logger.warning("%s parser failed over %d files: %s",
                               parser.label, len(paths), e)
                print(f"[batch] {parser.label} failed: {e}", flush=True)
                continue

        for csv_path in produced:
            try:
                artifact = register_csv_artifact(csv_path, case_id, db)
            except Exception as e:
                logger.warning("could not register %s: %s", csv_path.name, e)
                continue
            if artifact is not None:
                created.append(str(artifact.id))
        if produced:
            print(f"[batch] {parser.label}: {len(paths)} file(s) -> "
                  f"{len(produced)} table(s)", flush=True)

    return created
