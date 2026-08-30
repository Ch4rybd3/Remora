"""
The parser sandbox.

Remora is about to execute code against files that came out of a compromised
machine. These tests are the answer to the question that will be asked on
announcement day, so they check the containment rather than the happy path.

They run real processes. That is the point: a sandbox asserted only through
mocks proves nothing about the kernel.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from app.services import sandbox

pytestmark = pytest.mark.skipif(
    not sys.platform.startswith("linux"),
    reason="The sandbox is built on Linux primitives; Remora ships on Linux",
)


def _python(code: str) -> list[str]:
    return [sys.executable, "-c", code]


# ─── It runs things ───────────────────────────────────────────────────────────

def test_a_program_runs_and_its_output_comes_back(tmp_path: Path):
    result = sandbox.run(_python("print('hello')"), workdir=tmp_path)
    assert result.ok
    assert result.stdout.strip() == "hello"


def test_a_failing_program_is_a_result_not_an_exception(tmp_path: Path):
    """
    One crashing artifact must never take down the ingest of the collection it
    arrived in.
    """
    result = sandbox.run(_python("import sys; sys.exit(3)"), workdir=tmp_path)
    assert not result.ok
    assert result.exit_code == 3
    assert result.stopped_by is None    # the program failed, the sandbox did not


def test_stderr_is_captured_so_a_failure_can_be_explained(tmp_path: Path):
    result = sandbox.run(_python("import sys; print('boom', file=sys.stderr)"),
                         workdir=tmp_path)
    assert "boom" in result.stderr


def test_a_missing_program_is_a_sandbox_error(tmp_path: Path):
    """
    Distinct from a parser failing: the tool not being installed is a
    deployment problem, and running on regardless is not an option.
    """
    with pytest.raises(sandbox.SandboxError):
        sandbox.run(["definitely-not-installed-xyz"], workdir=tmp_path)


def test_nothing_is_passed_through_a_shell(tmp_path: Path):
    """
    A filename out of a compromised machine has no business being parsed by a
    shell. The argument is passed through, metacharacters and all.
    """
    hostile = "; touch /tmp/pwned; echo "
    result = sandbox.run(_python("import sys; print(repr(sys.argv[1]))") + [hostile],
                         workdir=tmp_path)
    assert hostile in result.stdout
    assert not Path("/tmp/pwned").exists()


# ─── It contains them ─────────────────────────────────────────────────────────

@pytest.mark.skipif(not sandbox.seccomp_available(), reason="seccomp unavailable here")
def test_a_parser_cannot_open_a_network_socket(tmp_path: Path):
    """
    The exit criterion, asserted against the kernel rather than promised.

    The specification asked for a network namespace. That needs CAP_SYS_ADMIN,
    which would be a far larger hole than the one it closes, so the network is
    denied at the system-call boundary instead - and more strictly: a namespace
    with no interfaces still lets a process create a socket.
    """
    result = sandbox.run(_python(
        "import socket, sys\n"
        "try:\n"
        "    socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
        "    print('SOCKET CREATED')\n"
        "except OSError as e:\n"
        "    print('DENIED', e.errno)\n"
    ), workdir=tmp_path)

    assert "SOCKET CREATED" not in result.stdout
    assert "DENIED" in result.stdout


@pytest.mark.skipif(not sandbox.seccomp_available(), reason="seccomp unavailable here")
def test_a_parser_cannot_reach_a_real_host(tmp_path: Path):
    """The same thing end to end, through a connection attempt rather than a syscall."""
    result = sandbox.run(_python(
        "import socket\n"
        "try:\n"
        "    socket.create_connection(('1.1.1.1', 53), timeout=2)\n"
        "    print('CONNECTED')\n"
        "except Exception as e:\n"
        "    print('BLOCKED', type(e).__name__)\n"
    ), workdir=tmp_path)

    assert "CONNECTED" not in result.stdout
    assert "BLOCKED" in result.stdout


@pytest.mark.skipif(not sandbox.seccomp_available(), reason="seccomp unavailable here")
def test_a_local_socket_still_works(tmp_path: Path):
    """
    AF_UNIX is allowed on purpose. Language runtimes create local sockets for
    their own plumbing, and denying those breaks the parser rather than
    containing it - a Unix socket cannot reach a network.
    """
    result = sandbox.run(_python(
        "import socket\n"
        "s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)\n"
        "print('LOCAL OK')\n"
    ), workdir=tmp_path)
    assert "LOCAL OK" in result.stdout


def test_a_runaway_parser_is_stopped(tmp_path: Path):
    result = sandbox.run(
        _python("import time; time.sleep(60)"),
        workdir=tmp_path,
        limits=sandbox.Limits(wall_seconds=2, cpu_seconds=60),
    )
    assert result.stopped_by is not None
    assert "timeout" in result.stopped_by
    assert result.duration < 20


def test_the_whole_process_group_is_killed(tmp_path: Path):
    """
    A parser that forks would otherwise leave children running after the one we
    know about is gone, still holding the output directory open.
    """
    marker = tmp_path / "child-still-alive"
    result = sandbox.run(_python(
        "import os, time\n"
        "if os.fork() == 0:\n"
        "    time.sleep(8)\n"
        f"    open({str(marker)!r}, 'w').write('x')\n"
        "    os._exit(0)\n"
        "time.sleep(60)\n"
    ), workdir=tmp_path, limits=sandbox.Limits(wall_seconds=2, cpu_seconds=60))

    assert result.stopped_by is not None
    import time as _time
    _time.sleep(9)
    assert not marker.exists(), "a forked child outlived the kill"


def test_a_memory_hog_is_refused(tmp_path: Path):
    result = sandbox.run(
        _python("x = bytearray(600 * 1024 * 1024); print('ALLOCATED')"),
        workdir=tmp_path,
        limits=sandbox.Limits(memory_bytes=128 * 1024 * 1024),
    )
    assert "ALLOCATED" not in result.stdout
    assert not result.ok


def test_output_beyond_the_quota_fails_the_run(tmp_path: Path):
    """
    Exceeding it fails the run rather than filling the disk. Reported as
    stopped by the sandbox, not as a parser that succeeded.
    """
    result = sandbox.run(
        _python("open('big.bin','wb').write(b'x' * (3 * 1024 * 1024))"),
        workdir=tmp_path,
        limits=sandbox.Limits(output_bytes=1024 * 1024),
    )
    assert result.stopped_by is not None
    assert "over the" in result.stopped_by


def test_a_single_oversized_file_is_stopped_by_the_kernel(tmp_path: Path):
    result = sandbox.run(
        _python("open('big.bin','wb').write(b'x' * (5 * 1024 * 1024))"),
        workdir=tmp_path,
        limits=sandbox.Limits(file_bytes=1024 * 1024, output_bytes=10 ** 9),
    )
    assert not result.ok


def test_what_was_enforced_is_reported(tmp_path: Path):
    """
    So a deployment where the sandbox is weaker than intended can say so,
    rather than looking identical to one where it is not.
    """
    result = sandbox.run(_python("pass"), workdir=tmp_path)
    assert "rlimits" in result.applied
    assert "no-shell" in result.applied
    if sandbox.seccomp_available():
        assert "no-network" in result.applied


@pytest.mark.skipif(os.geteuid() != 0, reason="privilege drop only applies when root")
def test_the_parser_does_not_run_as_root(tmp_path: Path):
    result = sandbox.run(_python("import os; print('UID', os.getuid())"),
                         workdir=tmp_path, sandbox_user="nobody")
    assert "UID 0" not in result.stdout
    assert any(a.startswith("uid=") for a in result.applied)


@pytest.mark.skipif(os.geteuid() != 0, reason="privilege drop only applies when root")
def test_an_unknown_sandbox_account_refuses_to_run(tmp_path: Path):
    """
    Running unconfined because the account is missing would be the worst
    outcome: it looks like it worked.
    """
    with pytest.raises(sandbox.SandboxError, match="does not exist"):
        sandbox.run(_python("pass"), workdir=tmp_path, sandbox_user="no-such-account")


@pytest.mark.skipif(os.geteuid() != 0, reason="privilege drop only applies when root")
def test_the_sandbox_account_may_not_be_root(tmp_path: Path):
    with pytest.raises(sandbox.SandboxError, match="is root"):
        sandbox.run(_python("pass"), workdir=tmp_path, sandbox_user="root")


# ─── How long a parser is given ───────────────────────────────────────────────

def test_a_small_artifact_gets_the_floor():
    """
    Most artifacts are small and the floor covers them outright. It is not
    tight: .NET spends the first seconds starting up before reading anything.
    """
    limits = sandbox.Limits.for_input(2 * 1024 * 1024)
    # The floor plus the couple of seconds two megabytes are worth - the point
    # is that a small artifact is not given a small budget.
    assert 900 <= limits.wall_seconds < 960


def test_a_large_artifact_gets_proportionately_longer():
    """
    MFTECmd on a gigabyte `$MFT` runs for tens of minutes on ordinary hardware.
    A ceiling that kills that is not a safety measure - the analyst sees an
    artifact that "failed" and cannot tell it from a corrupt one.
    """
    small = sandbox.Limits.for_input(10 * 1024 * 1024)
    large = sandbox.Limits.for_input(2 * 1024 ** 3)
    assert large.wall_seconds > small.wall_seconds
    assert large.wall_seconds >= 3600      # at least an hour for 2 GB


def test_there_is_still_a_hard_maximum():
    """The input is hostile. "However long it takes" is not a limit."""
    enormous = sandbox.Limits.for_input(500 * 1024 ** 3)
    assert enormous.wall_seconds == 4 * 3600


def test_the_cpu_budget_allows_more_than_one_core():
    """
    `RLIMIT_CPU` sums every thread. Equal to the wall budget, a parser using
    four cores would be killed at a quarter of its time with a signal nobody
    could interpret - which is exactly what the first version of this did.
    """
    limits = sandbox.Limits.for_input(1024 ** 3)
    assert limits.cpu_seconds >= limits.wall_seconds * 2
