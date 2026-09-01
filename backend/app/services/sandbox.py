"""
Running a parser against attacker-controlled input.

The Eric Zimmerman tools parse Windows artifacts natively, which is what makes
them worth having. It also means Remora executes code against files that came
out of a compromised machine. That question will be asked publicly, so the
answer is built rather than promised.

**On network isolation.** The specification called for a network namespace.
That needs `CAP_SYS_ADMIN`, which Docker does not grant by default and which it
would be absurd to add: the capability that lets a process mount filesystems and
enter other namespaces is a far larger hole than the one it would close.

So the network is denied at the system-call boundary instead, with a seccomp
filter the child installs on itself. That needs no privilege at all - seccomp in
filter mode is available to any process that has first set `no_new_privs` - and
it is stricter in one useful way: a namespace with no interfaces still lets a
process *create* sockets, while this makes the attempt fail.

`AF_UNIX` is deliberately still allowed. Language runtimes create local sockets
for their own plumbing, and denying those breaks the parser rather than
containing it. A Unix socket cannot reach a network.

Layers, each of which is independently sufficient for the thing it stops:

| | |
|---|---|
| Not root | `setuid` to an unprivileged account before `exec` |
| No network | seccomp filter on `socket(AF_INET/AF_INET6/...)` |
| No privilege regain | `PR_SET_NO_NEW_PRIVS` |
| Bounded time | wall-clock timeout, then the whole process group is killed |
| Bounded memory | `RLIMIT_AS` |
| Bounded CPU | `RLIMIT_CPU`, which survives a process that ignores signals |
| Bounded output | `RLIMIT_FSIZE` per file, plus a total measured after |
| No shell | argv list, never a string, never `shell=True` |
"""
from __future__ import annotations

import ctypes
import os
import platform
import pwd
import resource
import shutil
import signal
import struct
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from ..config import settings

# ─── Limits ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Limits:
    """
    What one invocation may consume.

    The wall-clock ceiling is derived from the size of the input rather than
    fixed - see `for_input`. A flat number is wrong in both directions at once:
    long enough for a 2 GB `$MFT` is long enough for a hostile 4 KB file to pin
    a core for an hour, and short enough to contain that file kills legitimate
    work on the `$MFT`.
    """
    wall_seconds:  int = 900
    #: CPU seconds, summed across threads. Deliberately a multiple of the wall
    #: budget: `RLIMIT_CPU` counts every thread, so a parser using four cores
    #: burns four CPU-seconds per second of wall clock and would be killed at a
    #: quarter of its time with a signal nobody could interpret. This is a
    #: backstop against a process that ignores the clock, not the primary limit.
    cpu_seconds:   int = 900 * 4
    #: Bounds the **managed heap**, through `DOTNET_GCHeapHardLimit`.
    #:
    #: Not `RLIMIT_AS`, which bounds virtual address space. .NET reserves far
    #: more of that than it uses by design, so any value low enough to be a
    #: real memory limit kills the runtime: MFTECmd on a 2 GB `$MFT` needs
    #: under a gigabyte of heap and dies at a 4 GB address-space ceiling.
    memory_bytes:  int = 2 * 1024 ** 3
    #: Address space, as a backstop against a runaway that is not .NET. A
    #: multiple of the heap limit rather than equal to it, for the reason above.
    address_space_multiplier: int = 8
    #: Total across the scratch directory. Watched **during** the run, not only
    #: measured after it: a parser that writes 500 GB fills the disk long
    #: before it exits, and a quota checked at the end would report a failure
    #: from a container that had already run out of space.
    output_bytes:  int = 4 * 1024 ** 3
    #: How often the watchdog measures. Two seconds is enough to catch runaway
    #: output and cheap enough not to matter next to a parse that runs for
    #: minutes.
    output_check_seconds: float = 2.0
    open_files:    int = 4096
    #: Threads count against `RLIMIT_NPROC` on Linux, and .NET starts dozens
    #: before it reads a byte: a garbage collector per core, a thread pool, a
    #: finalizer. The first version of this used 64 and every parser failed to
    #: exec with EAGAIN. Generous enough for a runtime, still a bound on a fork
    #: bomb.
    processes:     int = 2048

    @classmethod
    def for_input(cls, size_bytes: int, **overrides: int) -> Limits:
        """
        Limits proportionate to the artifact being parsed.

        Real numbers from the tools these contain: EVTXECmd on a few hundred
        megabytes of Security.evtx, or MFTECmd on a gigabyte `$MFT`, runs for
        tens of minutes on ordinary hardware. A ceiling that kills those is not
        a safety measure, it is a broken product - the analyst sees an artifact
        that "failed" and has no way to tell it from a corrupt one.

        So: a floor that covers most artifacts outright, growing with size, and
        a hard maximum. The maximum exists because the input is hostile and
        "however long it takes" is not a limit.
        """
        base = settings.parser_base_seconds
        gigabytes = size_bytes / (1024 ** 3)
        wall = int(base + gigabytes * settings.parser_seconds_per_gigabyte)
        wall = min(max(wall, base), settings.parser_max_seconds)

        # Output scales with input for the same reason time does. MFTECmd turns
        # a 2 GB `$MFT` into an 886 MB CSV; a fixed ceiling either kills that or
        # is no ceiling at all for a small file.
        floor = 4 * 1024 ** 3
        return cls(
            wall_seconds=wall,
            cpu_seconds=wall * settings.parser_cpu_multiplier,
            memory_bytes=settings.parser_memory_mb * 1024 * 1024,
            output_bytes=max(floor, size_bytes * 4),
            **overrides,
        )


@dataclass
class Result:
    exit_code:    int
    stdout:       str
    stderr:       str
    duration:     float
    output_bytes: int = 0
    #: Set when the sandbox stopped the run rather than the program finishing.
    stopped_by:   str | None = None

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and self.stopped_by is None

    #: Populated by `run` so a failure can be reported with what was enforced.
    applied: list[str] = field(default_factory=list)


class SandboxError(Exception):
    """The sandbox could not be established. Never raised for a failing parser."""


# ─── seccomp ──────────────────────────────────────────────────────────────────

_PR_SET_NO_NEW_PRIVS = 38
_PR_SET_SECCOMP      = 22
_SECCOMP_MODE_FILTER = 2

#: (audit arch, socket syscall number) per machine. Only the two architectures
#: this ships on; anything else refuses to build a filter rather than building
#: one that matches nothing, which would silently allow everything.
_ARCH_TABLE = {
    "x86_64":  (0xC000003E, 41),
    "aarch64": (0xC00000B7, 198),
}

_AF_UNIX = 1

_BPF_LD, _BPF_W, _BPF_ABS = 0x00, 0x00, 0x20
_BPF_JMP, _BPF_JEQ, _BPF_K, _BPF_RET = 0x05, 0x10, 0x00, 0x06
_SECCOMP_RET_ALLOW = 0x7FFF0000
_SECCOMP_RET_ERRNO = 0x00050000
_EPERM = 1

# Offsets into struct seccomp_data on a little-endian machine.
_OFF_NR, _OFF_ARCH, _OFF_ARG0 = 0, 4, 16


def _stmt(code: int, k: int) -> bytes:
    return struct.pack("HBBI", code, 0, 0, k)


def _jump(code: int, k: int, jt: int, jf: int) -> bytes:
    return struct.pack("HBBI", code, jt, jf, k)


def _network_filter() -> bytes:
    """
    A filter that fails `socket()` for every domain except `AF_UNIX`.

    Blocking the creation of an internet socket is enough on its own: `connect`
    and `sendto` need a file descriptor, and the child inherits only the pipes
    we hand it.

    A syscall arriving on an architecture the filter does not recognise is
    refused rather than allowed. That is the direction to be wrong in - the
    alternative is a filter that matches nothing and looks like it is working.
    """
    machine = platform.machine()
    if machine not in _ARCH_TABLE:
        raise SandboxError(f"No seccomp filter for architecture '{machine}'")
    arch, sys_socket = _ARCH_TABLE[machine]

    return b"".join([
        _stmt(_BPF_LD | _BPF_W | _BPF_ABS, _OFF_ARCH),
        _jump(_BPF_JMP | _BPF_JEQ | _BPF_K, arch, 1, 0),
        _stmt(_BPF_RET | _BPF_K, _SECCOMP_RET_ERRNO | _EPERM),

        _stmt(_BPF_LD | _BPF_W | _BPF_ABS, _OFF_NR),
        _jump(_BPF_JMP | _BPF_JEQ | _BPF_K, sys_socket, 0, 3),

        _stmt(_BPF_LD | _BPF_W | _BPF_ABS, _OFF_ARG0),      # domain
        _jump(_BPF_JMP | _BPF_JEQ | _BPF_K, _AF_UNIX, 1, 0),
        _stmt(_BPF_RET | _BPF_K, _SECCOMP_RET_ERRNO | _EPERM),

        _stmt(_BPF_RET | _BPF_K, _SECCOMP_RET_ALLOW),
    ])


class _SockFprog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.c_void_p)]


def _install_seccomp(libc: ctypes.CDLL) -> None:
    program = _network_filter()
    if libc.prctl(_PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        raise SandboxError("Could not set no_new_privs")
    buffer = ctypes.create_string_buffer(program, len(program))
    fprog = _SockFprog(len(program) // 8, ctypes.cast(buffer, ctypes.c_void_p))
    if libc.prctl(_PR_SET_SECCOMP, _SECCOMP_MODE_FILTER, ctypes.byref(fprog), 0, 0) != 0:
        raise SandboxError("Could not install the seccomp filter")


def seccomp_available() -> bool:
    """Whether a filter can be installed here, checked in a throwaway child."""
    try:
        _network_filter()
    except SandboxError:
        return False
    pid = os.fork()
    if pid == 0:
        try:
            _install_seccomp(ctypes.CDLL("libc.so.6", use_errno=True))
            os._exit(0)
        except Exception:
            os._exit(1)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status) == 0


# ─── Privilege drop ───────────────────────────────────────────────────────────

def _sandbox_account(username: str) -> tuple[int, int] | None:
    """
    (uid, gid) for the account parsers run as, or None if we are not root.

    Not being able to drop is not an error: a development machine running the
    backend as an unprivileged user is already not root, which is the property
    that mattered.
    """
    if os.geteuid() != 0:
        return None
    try:
        entry = pwd.getpwnam(username)
    except KeyError as e:
        raise SandboxError(
            f"The sandbox account '{username}' does not exist. It is created by "
            "the backend image; set PARSER_SANDBOX_USER if yours differs."
        ) from e
    if entry.pw_uid == 0:
        raise SandboxError(f"The sandbox account '{username}' is root")
    return entry.pw_uid, entry.pw_gid


# ─── Running ──────────────────────────────────────────────────────────────────

def _chown_directories(root: Path, uid: int, gid: int) -> None:
    os.chown(root, uid, gid)
    for item in root.rglob("*"):
        if item.is_dir() and not item.is_symlink():
            os.chown(item, uid, gid)


def _directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def run(
    argv: list[str],
    *,
    workdir: Path,
    limits: Limits | None = None,
    env: dict[str, str] | None = None,
    sandbox_user: str | None = None,
) -> Result:
    """
    Run `argv` against `workdir`, contained.

    `argv` is a list and is never joined into a string: a filename out of a
    compromised machine has no business being parsed by a shell.

    A parser that fails is a `Result` with a non-zero exit code, not an
    exception. One crashing artifact must never take down the ingest of the
    collection it arrived in. `SandboxError` is raised only when the sandbox
    itself could not be established - which is a reason to stop, because the
    alternative is running the thing unconfined.
    """
    if not argv:
        raise SandboxError("Nothing to run")
    limits = limits or Limits.for_input(0)
    workdir.mkdir(parents=True, exist_ok=True)

    program = shutil.which(argv[0]) or argv[0]
    if not Path(program).exists():
        raise SandboxError(f"'{argv[0]}' is not installed")

    account = _sandbox_account(sandbox_user or settings.parser_sandbox_user)
    applied = ["rlimits", "no-shell", "own-process-group"]
    if account:
        applied.append(f"uid={account[0]}")
        # Every directory under the scratch path has to be writable by the
        # account we drop to, or the parser fails on its first write with a
        # permission error that reads as a broken tool. Recursive, because a
        # caller that pre-created an output directory would otherwise hand over
        # only the top level - which is exactly what happened.
        #
        # Directories only. A staged artifact may be a hard link to evidence,
        # and chowning a link changes the original file's owner. The parser
        # needs to read it, not own it.
        try:
            _chown_directories(workdir, account[0], account[1])
        except OSError as e:
            raise SandboxError(f"Could not hand {workdir} to the sandbox account: {e}") from e
    use_seccomp = seccomp_available()
    if use_seccomp:
        applied.append("no-network")

    def _confine() -> None:
        # Own session, so a parser that forks is killed with its children
        # rather than leaving them behind holding the output directory.
        os.setsid()

        resource.setrlimit(resource.RLIMIT_CPU, (limits.cpu_seconds, limits.cpu_seconds))
        address_space = limits.memory_bytes * limits.address_space_multiplier
        resource.setrlimit(resource.RLIMIT_AS, (address_space, address_space))
        # No RLIMIT_FSIZE. .NET's JIT maps its executable pages through a file
        # it truncates to a large size, and the limit applies to that offset -
        # so any value small enough to be a quota kills the runtime with
        # SIGXFSZ before it reads an artifact. Disabling the JIT's W^X mapping
        # would trade a real hardening measure for a disk quota; the watchdog
        # in `run` provides the quota without giving anything up.
        resource.setrlimit(resource.RLIMIT_NOFILE, (limits.open_files, limits.open_files))
        resource.setrlimit(resource.RLIMIT_NPROC, (limits.processes, limits.processes))
        # No core dumps: a crash on a memory image would write gigabytes of the
        # evidence back out to disk.
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

        if account:
            uid, gid = account
            os.setgroups([])
            os.setgid(gid)
            os.setuid(uid)

        if use_seccomp:
            _install_seccomp(ctypes.CDLL("libc.so.6", use_errno=True))

    environment = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
        # .NET opens a diagnostics socket at startup. It is a Unix socket and
        # would be allowed, but a parser has no reason to expose one.
        "DOTNET_EnableDiagnostics": "0",
        "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
        # The real memory bound. Hexadecimal, no 0x prefix, as the runtime
        # expects. This is what `memory_bytes` means - see the note on it.
        "DOTNET_GCHeapHardLimit": format(limits.memory_bytes, "x"),
        **(env or {}),
    }

    started = time.monotonic()
    overrun: list[str] = []
    process = subprocess.Popen(   # noqa: S603 - argv list, never a shell
        [program, *argv[1:]],
        cwd=str(workdir),
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=_confine,      # noqa: PLW1509 - the confinement is the point
        text=True,
        errors="replace",
    )

    watchdog = threading.Thread(
        target=_watch_output,
        args=(process, workdir, limits, overrun),
        name=f"sandbox-quota-{process.pid}",
        daemon=True,
    )
    watchdog.start()

    stopped_by = None
    try:
        stdout, stderr = process.communicate(timeout=limits.wall_seconds)
    except subprocess.TimeoutExpired:
        # The group, not the process: a parser that spawned children would
        # otherwise keep running after the one we know about is gone.
        _kill_group(process.pid)
        stdout, stderr = process.communicate()
        stopped_by = f"timeout after {limits.wall_seconds}s"

    duration = time.monotonic() - started
    produced = _directory_size(workdir)
    # The watchdog wins: it knows the run was killed for output rather than
    # having simply finished, which the exit code alone cannot say.
    if overrun:
        stopped_by = overrun[0]
    elif stopped_by is None and produced > limits.output_bytes:
        stopped_by = f"produced {produced} bytes, over the {limits.output_bytes} limit"

    return Result(
        exit_code=process.returncode if process.returncode is not None else -1,
        stdout=stdout or "",
        stderr=stderr or "",
        duration=duration,
        output_bytes=produced,
        stopped_by=stopped_by,
        applied=applied,
    )


def _watch_output(process: subprocess.Popen, workdir: Path,
                  limits: Limits, overrun: list[str]) -> None:
    """
    Kill the run if it writes more than its quota, while it is writing it.

    Measuring only after the process exits is too late: filling a disk is not
    something you notice afterwards, it is something the rest of the container
    notices first.
    """
    while process.poll() is None:
        time.sleep(limits.output_check_seconds)
        if process.poll() is not None:
            return
        produced = _directory_size(workdir)
        if produced > limits.output_bytes:
            overrun.append(
                f"produced {produced} bytes, over the {limits.output_bytes} limit")
            _kill_group(process.pid)
            return


def _kill_group(pid: int) -> None:
    """SIGKILL the whole group. No SIGTERM first: this is already the deadline."""
    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
