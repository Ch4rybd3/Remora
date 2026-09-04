"""
The parsers written here now run contained, like the Eric Zimmerman ones.

Until this landed the honest answer to "does Remora execute anything that came
out of the drop folder?" was a qualified one. The .NET tools were confined from
the day they shipped; the Python parsers ran in the worker, as root, on bytes
somebody dropped in a folder. Row and tile caps bound the *work* a parser does
and say nothing about what the code can reach.

These tests are about the boundary, not about parsing - the parsers have their
own tests. What matters here is that the work happens in another process, that
the process only sees what was staged for it, and that its output arrives
anyway.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services import sandbox
from app.services.ingest import batch
from app.services.ingest.python_parsers import PARSERS, parser_by_slug

TASK_XML = """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><URI>\\Sandboxed</URI></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>SYSTEM</UserId></Principal></Principals>
  <Settings><Enabled>true</Enabled></Settings>
  <Actions><Exec><Command>C:\\Windows\\System32\\cmd.exe</Command></Exec></Actions>
</Task>
"""


@pytest.fixture()
def scratch():
    """
    A working directory the sandbox account can actually reach.

    Not `tmp_path`. Pytest nests its temporary directories under
    `/tmp/pytest-of-root`, which is mode 0700 and owned by root - the sandbox
    chowns the working directory it is given but cannot make an ancestor
    traversable, so the confined process gets `Permission denied` on the first
    read. In production the working directory is created directly under `/tmp`,
    which is world-traversable, so this mirrors the real layout rather than
    working around the product.
    """
    import tempfile

    with tempfile.TemporaryDirectory(prefix="batch-test-") as directory:
        yield Path(directory)


def task_file(directory: Path, name: str = "Sandboxed") -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_bytes(b"\xff\xfe" + TASK_XML.encode("utf-16-le"))
    return path


# ─── Every parser is addressable across a process boundary ────────────────────

def test_every_parser_has_a_stable_name():
    """
    The label is prose for an analyst and the kinds are an unordered set;
    neither survives being passed on a command line. The slug is what does.
    """
    slugs = [p.slug for p in PARSERS]
    assert len(slugs) == len(set(slugs)), "two parsers share a slug"
    for slug in slugs:
        assert slug and slug.replace("_", "").isalnum(), slug
        assert parser_by_slug(slug) is not None


def test_an_unknown_parser_is_refused_rather_than_guessed():
    assert parser_by_slug("does-not-exist") is None


# ─── The entry point ──────────────────────────────────────────────────────────

def test_the_entry_point_runs_a_parser_and_reports_what_it_wrote(tmp_path):
    from app.services.ingest.python_parsers.__main__ import main

    staged = tmp_path / "input"
    task_file(staged)
    job = tmp_path / "job.json"
    job.write_text(json.dumps({
        "parser": "scheduled_tasks",
        "paths":  [str(staged / "Sandboxed")],
        "out":    str(tmp_path / "out"),
        "scratch": str(tmp_path / "tmp"),
        "base":   str(staged),
        "result": str(tmp_path / "result.json"),
    }))

    assert main(["prog", str(job)]) == 0
    produced = json.loads((tmp_path / "result.json").read_text())["produced"]
    assert any("scheduled_tasks.csv" in p for p in produced)


@pytest.mark.parametrize("job,code", [
    ({"parser": "nope"}, 2),
    ({}, 2),
])
def test_a_bad_job_exits_with_a_reason_not_a_traceback(tmp_path, job, code):
    from app.services.ingest.python_parsers.__main__ import main

    path = tmp_path / "job.json"
    path.write_text(json.dumps(job))
    assert main(["prog", str(path)]) == code


def test_a_missing_job_file_exits_rather_than_raising(tmp_path):
    from app.services.ingest.python_parsers.__main__ import main

    assert main(["prog", str(tmp_path / "absent.json")]) == 2


# ─── Actually confined ────────────────────────────────────────────────────────

def test_a_parser_runs_in_another_process_and_its_output_arrives(tmp_path, scratch):
    """
    The whole point, end to end: the parser executes inside the sandbox and the
    CSV still lands where the pipeline expects it.
    """
    source = task_file(tmp_path / "collection" / "Tasks")
    out_dir = tmp_path / "_parsed"

    produced = batch.run_sandboxed(
        parser_by_slug("scheduled_tasks"), [source], out_dir,
        scratch, base=tmp_path / "collection")

    assert [p.name for p in produced] == ["scheduled_tasks.csv"]
    assert (out_dir / "scheduled_tasks.csv").exists()
    assert "cmd.exe" in (out_dir / "scheduled_tasks.csv").read_text()


def test_the_parser_only_sees_what_was_staged(tmp_path, scratch):
    """
    Its idea of the filesystem is a directory we built. Not the drop folder,
    not the rest of the collection, not the evidence store.
    """
    collection = tmp_path / "collection"
    source = task_file(collection / "Tasks")
    secret = collection / "not-for-the-parser.txt"
    secret.write_text("evidence")

    batch.run_sandboxed(parser_by_slug("scheduled_tasks"), [source],
                        tmp_path / "_parsed", scratch, base=collection)

    staged = list((scratch / "input").rglob("*"))
    assert not any(p.name == "not-for-the-parser.txt" for p in staged)


def test_the_source_column_still_says_where_the_file_sat(tmp_path, scratch):
    """
    Staging mirrors the collection tree, so confinement does not cost the
    provenance the source column carries.
    """
    collection = tmp_path / "collection"
    source = task_file(collection / "C" / "Windows" / "System32" / "Tasks")
    out_dir = tmp_path / "_parsed"

    batch.run_sandboxed(parser_by_slug("scheduled_tasks"), [source], out_dir,
                        scratch, base=collection)

    assert "C/Windows/System32/Tasks/Sandboxed" in \
        (out_dir / "scheduled_tasks.csv").read_text()


def test_output_is_moved_out_rather_than_written_into_the_collection(tmp_path, scratch):
    """
    The confined account cannot write to a directory the worker made as root,
    and handing it the collection's own `_parsed/` would grant a sandboxed
    process write access to case data. The results are copied out afterwards,
    by the worker, so the boundary stays one-directional.
    """
    source = task_file(tmp_path / "collection" / "Tasks")

    batch.run_sandboxed(parser_by_slug("scheduled_tasks"), [source],
                        tmp_path / "_parsed", scratch, base=tmp_path / "collection")

    # Nothing left behind in the sandbox's own output directory.
    assert list((scratch / "out").glob("*.csv")) == []


def test_a_crashing_parser_is_an_error_with_a_reason_not_a_silence(
        tmp_path, scratch, monkeypatch):
    """
    A parser that dies is a fact about one artifact type. The batch stage logs
    it and carries on; what it must not do is carry on believing the parser
    produced nothing.
    """
    source = task_file(tmp_path / "collection" / "Tasks")

    def explode(*args, **kwargs):
        return sandbox.Result(exit_code=1, stdout="", stderr="ValueError: broken",
                              duration=0.1)

    monkeypatch.setattr(sandbox, "run", explode)

    with pytest.raises(RuntimeError, match="broken"):
        batch.run_sandboxed(parser_by_slug("scheduled_tasks"), [source],
                            tmp_path / "_parsed", scratch)


def test_a_run_the_sandbox_stopped_says_so(tmp_path, scratch, monkeypatch):
    source = task_file(tmp_path / "collection" / "Tasks")

    monkeypatch.setattr(sandbox, "run", lambda *a, **k: sandbox.Result(
        exit_code=-9, stdout="", stderr="", duration=1.0, stopped_by="wall clock"))

    with pytest.raises(RuntimeError, match="Stopped by the sandbox"):
        batch.run_sandboxed(parser_by_slug("scheduled_tasks"), [source],
                            tmp_path / "_parsed", scratch)


def test_nothing_stageable_is_refused_rather_than_run_empty(tmp_path, scratch):
    with pytest.raises(RuntimeError, match="None of the files could be staged"):
        batch.run_sandboxed(parser_by_slug("scheduled_tasks"),
                            [tmp_path / "absent"], tmp_path / "_parsed", scratch)


# ─── The batch stage uses it ──────────────────────────────────────────────────

def test_the_batch_stage_routes_python_parsers_through_the_sandbox(
        tmp_path, scratch, monkeypatch):
    """
    Asserted rather than assumed. A parser called directly would still produce
    the right CSV, and nothing about the output would show it ran unconfined.
    """
    calls: list[str] = []
    original = batch.run_sandboxed

    def record(parser, paths, out_dir, scratch, base=None):
        calls.append(parser.slug)
        return original(parser, paths, out_dir, scratch, base)

    monkeypatch.setattr(batch, "run_sandboxed", record)

    root = tmp_path / "collection"
    task_file(root / "C" / "Windows" / "System32" / "Tasks")

    jobs = [j for j in batch.jobs(base=root) if "scheduled_task" in j.kinds]
    assert len(jobs) == 1
    jobs[0].run([root / "C" / "Windows" / "System32" / "Tasks" / "Sandboxed"],
                tmp_path / "_parsed", scratch, root)

    assert calls == ["scheduled_tasks"]
