"""
Parsers written here, for what the Eric Zimmerman tools cannot do on Linux.

Two of the twelve refuse to run outside Windows, and one of them - PECmd - reads
the largest artifact class in a triage: 439 prefetch files out of 2058 in an
ordinary KAPE collection. A pipeline that recognises them and parses nothing is
not a uniform pipeline.

**These run in batch, not per file.** That is the important difference from the
EZ table. Parsing 439 prefetch files individually would register 439 artifacts
in the Explorer, one row each - technically complete and completely unusable.
An artifact type produces one table per collection, which is also how EvtxECmd
behaves when pointed at a folder.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import browsers, prefetch, scheduled_tasks

logger = logging.getLogger("remora.python_parsers")


@dataclass(frozen=True)
class BatchParser:
    """One parser, run once over every file of its kind in a collection."""
    kinds:   frozenset[str]
    label:   str
    #: (paths, out_dir, scratch, base) -> the CSVs written.
    #:
    #: `base` is the collection root. It exists so a source column can say
    #: where in the tree a file sat rather than only what it was called - which
    #: for a `$I` record is the account that deleted the file, and for a task
    #: is whether it came from the machine or a user profile.
    run:     Callable[[list[Path], Path, Path, Path | None], list[Path]]
    #: Why this is here rather than an Eric Zimmerman tool.
    because: str


def _parse_prefetch(paths: list[Path], out_dir: Path, scratch: Path,
                    base: Path | None = None) -> list[Path]:
    _ = scratch, base
    parsed, errors = [], {}
    for path in paths:
        try:
            parsed.append(prefetch.parse(path))
        except Exception as e:
            # One unreadable file, recorded in the output rather than lost.
            errors[path.name] = f"{type(e).__name__}: {e}"
    if not parsed and not errors:
        return []
    return prefetch.write_csv(parsed, errors, out_dir)


def _parse_browsers(paths: list[Path], out_dir: Path, scratch: Path,
                    base: Path | None = None) -> list[Path]:
    _ = base
    return browsers.parse_all(paths, out_dir, scratch)


def _parse_tasks(paths: list[Path], out_dir: Path, scratch: Path,
                 base: Path | None = None) -> list[Path]:
    _ = scratch
    return scheduled_tasks.parse_all(paths, out_dir, base)


PARSERS: tuple[BatchParser, ...] = (
    BatchParser(
        kinds=frozenset({"prefetch"}),
        label="Prefetch",
        run=_parse_prefetch,
        because="PECmd needs a Windows decompression API for MAM-compressed prefetch.",
    ),
    BatchParser(
        # Not `browser_cache`: WebCacheV01.dat is an ESE database, not SQLite.
        kinds=frozenset({"browser_history", "browser_cookies"}),
        label="Browser activity",
        run=_parse_browsers,
        because="No Eric Zimmerman tool reads browser databases.",
    ),
    BatchParser(
        kinds=frozenset({"scheduled_task"}),
        label="Scheduled tasks",
        run=_parse_tasks,
        because="No Eric Zimmerman tool reads task definitions, and 272 of them "
                "in a single triage were going unidentified. Persistence lives "
                "here.",
    ),
)

#: Every kind handled here. Checked against the routing table by a test, the
#: same way the Eric Zimmerman table is.
HANDLED_KINDS = frozenset(kind for parser in PARSERS for kind in parser.kinds)


def parser_for(kind: str) -> BatchParser | None:
    for parser in PARSERS:
        if kind in parser.kinds:
            return parser
    return None


def handles(kind: str) -> bool:
    return parser_for(kind) is not None
