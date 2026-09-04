"""
Running one Python parser as its own process, so it can be contained.

The Eric Zimmerman tools have always executed inside `services/sandbox.py` -
non-root, no network, bounded in time, memory and output. The parsers written
here did not: they ran in the worker, as root, on bytes out of an artifact
somebody dropped in a folder. Row and tile caps bounded the *work*, which is
not the same as bounding what the code can reach.

This module is what makes them containable. It is a process boundary and
nothing else: a job file in, the parsers' own functions run, the paths they
produced written back out. No database, no network, no configuration - the
parsers are pure `(paths, out_dir, scratch, base) -> [paths]` functions, which
is the property that made this possible at all.

Invoked by `services/ingest/batch.py`, never by hand:

    python -m app.services.ingest.python_parsers <job.json>

The job and everything it names live inside the sandbox's working directory,
because that is the only thing the confined account can read and write.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from . import parser_by_slug


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m app.services.ingest.python_parsers <job.json>",
              file=sys.stderr)
        return 2

    job_path = Path(argv[1])
    try:
        job = json.loads(job_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"unreadable job file: {e}", file=sys.stderr)
        return 2

    parser = parser_by_slug(str(job.get("parser", "")))
    if parser is None:
        print(f"no parser named {job.get('parser')!r}", file=sys.stderr)
        return 2

    paths   = [Path(p) for p in job.get("paths", [])]
    out_dir = Path(job["out"])
    scratch = Path(job["scratch"])
    base    = Path(job["base"]) if job.get("base") else None

    out_dir.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)

    try:
        produced = parser.run(paths, out_dir, scratch, base)
    except Exception:
        # The traceback goes to stderr, which the sandbox captures and the
        # caller records on the ingest row. A parser that crashes is a fact
        # about one artifact type, and the collection has to keep going.
        traceback.print_exc()
        return 1

    Path(job["result"]).write_text(
        json.dumps({"produced": [str(p) for p in produced]}), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
