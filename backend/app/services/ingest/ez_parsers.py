"""
Running an Eric Zimmerman tool on one artifact.

Each entry says which tool reads which kind and how it is invoked. The tools
share a family resemblance but not an interface: some take `-f` for a file,
some take `-d` for a directory, one needs a batch file naming which registry
keys to extract, and the CSV they produce lands in a directory rather than at a
path you choose.

Everything runs through `services/sandbox.py`. Nothing here builds a command
string - the argv list goes to the kernel as it is written, because a filename
out of a compromised machine has no business being read by a shell.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from ... import services
from ...services import ez_tools, sandbox

logger = logging.getLogger("remora.ez_parsers")

_ = services  # keeps the package import explicit for the reader


@dataclass(frozen=True)
class Recipe:
    """How to run one tool against one kind of artifact."""
    tool: str
    #: Builds the arguments after the assembly path. `source` is the artifact,
    #: `out` the directory the tool should write its CSV into.
    args: Callable[[Path, Path], list[str]]
    #: Human name for the ingest queue.
    label: str
    #: Some tools emit several CSVs from one input - AmcacheParser writes a file
    #: per entry type. All of them are registered.
    multi_output: bool = False
    notes: str = ""


def _file_in_dir_out(flag: str = "-f") -> Callable[[Path, Path], list[str]]:
    """The common shape: read one file, write CSVs into a directory."""
    def build(source: Path, out: Path) -> list[str]:
        return [flag, str(source), "--csv", str(out)]
    return build


RECIPES: dict[str, Recipe] = {
    "evtx": Recipe(
        tool="EvtxECmd", args=_file_in_dir_out(),
        label="Event log (EvtxECmd)",
    ),
    "mft": Recipe(
        tool="MFTECmd", args=_file_in_dir_out(),
        label="NTFS Master File Table (MFTECmd)",
    ),
    "usnjrnl": Recipe(
        tool="MFTECmd", args=_file_in_dir_out(),
        label="USN Journal (MFTECmd)",
    ),
    "lnk": Recipe(
        tool="LECmd", args=_file_in_dir_out(),
        label="Shortcut (LECmd)",
    ),
    "jumplist_auto": Recipe(
        tool="JLECmd", args=_file_in_dir_out(),
        label="Jump list (JLECmd)",
    ),
    "jumplist_custom": Recipe(
        tool="JLECmd", args=_file_in_dir_out(),
        label="Jump list (JLECmd)",
    ),
    "windows_timeline": Recipe(
        tool="WxTCmd", args=_file_in_dir_out(),
        label="Windows Timeline (WxTCmd)",
        multi_output=True,
    ),
    # A registry hive is not one artifact. Which tool reads it depends on which
    # hive it is, and that is resolved by name in `recipe_for` below - the same
    # refinement identification does for SQLite and ESE containers, and for the
    # same reason: the signature says "hive", the name says which one.
}

#: Registry hives, matched case-insensitively against the filename. KAPE
#: prefixes the machine name and a timestamp, so this is a substring test.
#:
#: Order matters. `Amcache.hve` and `SYSTEM` are unambiguous; `NTUSER.DAT` and
#: `UsrClass.dat` hold shellbags among much else, and SBECmd is the tool that
#: reads that much else usefully.
HIVE_RECIPES: list[tuple[str, Recipe]] = [
    ("amcache", Recipe(
        tool="AmcacheParser", args=_file_in_dir_out(),
        label="Amcache (AmcacheParser)", multi_output=True,
        notes="One CSV per entry type: files, programs, devices, drivers.",
    )),
    ("system", Recipe(
        tool="AppCompatCacheParser", args=_file_in_dir_out(),
        label="Shimcache (AppCompatCacheParser)",
        notes="Shimcache lives in the SYSTEM hive.",
    )),
    ("usrclass", Recipe(
        tool="SBECmd", args=_file_in_dir_out("-d"),
        label="Shellbags (SBECmd)", multi_output=True,
        notes="Reads a directory; the hive is isolated into one first.",
    )),
    ("ntuser", Recipe(
        tool="SBECmd", args=_file_in_dir_out("-d"),
        label="Shellbags (SBECmd)", multi_output=True,
        notes="Reads a directory; the hive is isolated into one first.",
    )),
]


def recipe_for(kind: str, filename: str = "") -> Recipe | None:
    """
    The recipe for this artifact, resolving a registry hive by its name.

    `SOFTWARE` and `SECURITY` deliberately match nothing: RECmd would read them
    but needs a batch file naming which keys to extract, and which keys matter
    is an analyst's decision rather than a default. Shipping one would quietly
    define what "the registry" means for every investigation.
    """
    if kind != "registry_hive":
        return RECIPES.get(kind)

    lowered = filename.lower()
    for needle, recipe in HIVE_RECIPES:
        if needle in lowered:
            return recipe
    return None


#: Kinds Remora recognises and cannot parse here, each saying why. Shown on the
#: row in the ingest queue: an analyst learns what is missing at the moment they
#: look, instead of seeing a failure they cannot tell from a corrupt file.
UNHANDLED_NOTE: dict[str, str] = {
    "registry_hive": (
        "A registry hive holds everything, and which keys matter is an analyst's "
        "decision rather than a default - shipping one would quietly define what "
        "'the registry' means for every investigation. Amcache and Shimcache are "
        "parsed from their own artifacts."
    ),
    "prefetch": (
        "Prefetch on Windows 10 and later is MAM-compressed, and PECmd decompresses "
        "it through a Windows API with no Linux equivalent. The file is kept and "
        "can be preserved as evidence."
    ),
    "srum": (
        "SRUM lives in an ESE database, which SrumECmd reads through Windows-only "
        "libraries. The file is kept and can be preserved as evidence."
    ),
}


@dataclass
class ParseOutcome:
    ok:       bool
    csv_files: list[Path] = field(default_factory=list)
    error:    str | None = None
    tool:     str | None = None
    #: Hash of the tool archive, recorded so a parse can be reproduced.
    tool_sha256: str | None = None
    duration: float = 0.0


def supports(kind: str, filename: str = "") -> bool:
    return recipe_for(kind, filename) is not None


def available(kind: str, filename: str = "") -> bool:
    """Whether the tool for this artifact is actually installed."""
    recipe = recipe_for(kind, filename)
    return bool(recipe and ez_tools.find(recipe.tool))


#: Every kind a recipe can be chosen for, including the hive family. Used by
#: the dispatch table, which registers a handler per kind.
PARSEABLE_KINDS = frozenset(RECIPES) | {"registry_hive"}


def run(kind: str, source: Path, workdir: Path) -> ParseOutcome:
    """
    Parse one artifact, returning the CSVs it produced.

    Never raises for a failing tool. A crashing parser is a fact about one
    artifact, and the collection it arrived in has to keep ingesting.
    """
    recipe = recipe_for(kind, source.name)
    if recipe is None:
        if kind == "registry_hive":
            return ParseOutcome(False, error=UNHANDLED_NOTE["registry_hive"])
        return ParseOutcome(False, error=f"No Eric Zimmerman tool reads '{kind}'")

    tool = ez_tools.find(recipe.tool)
    if tool is None:
        return ParseOutcome(
            False, tool=recipe.tool,
            error=f"{recipe.tool} is not installed. See the tool status in Config.")
    if not ez_tools.dotnet_available():
        return ParseOutcome(False, tool=recipe.tool,
                            error="The .NET runtime is not present in this image")

    workdir.mkdir(parents=True, exist_ok=True)
    out = workdir / "out"
    out.mkdir(exist_ok=True)

    target = source
    if recipe.args is not None and "-d" in recipe.args(source, out):
        # A directory-reading tool gets a directory holding this artifact and
        # nothing else, so a hive is not parsed together with its neighbours.
        isolated = workdir / "input"
        isolated.mkdir(exist_ok=True)
        linked = isolated / source.name
        if not linked.exists():
            try:
                linked.hardlink_to(source)
            except OSError:
                # Different filesystem, or a mount that forbids links. Copying
                # an artifact is wasteful but correct; failing would be neither.
                import shutil
                shutil.copy2(source, linked)
        target = isolated

    try:
        size = source.stat().st_size
    except OSError:
        size = 0

    result = sandbox.run(
        [*tool.argv_prefix, *recipe.args(target, out)],
        workdir=workdir,
        limits=sandbox.Limits.for_input(size),
    )

    produced = sorted(p for p in out.rglob("*.csv") if p.is_file())

    if result.stopped_by:
        return ParseOutcome(False, tool=recipe.tool, tool_sha256=tool.sha256,
                            duration=result.duration,
                            error=f"Stopped by the sandbox: {result.stopped_by}")

    if not result.ok and not produced:
        # Some tools exit non-zero having still written usable output - a hive
        # with one unreadable key, for instance. Output is the better signal.
        detail = (result.stderr or result.stdout or "").strip()[:500]
        return ParseOutcome(False, tool=recipe.tool, tool_sha256=tool.sha256,
                            duration=result.duration,
                            error=detail or f"{recipe.tool} exited {result.exit_code}")

    if not produced:
        return ParseOutcome(False, tool=recipe.tool, tool_sha256=tool.sha256,
                            duration=result.duration,
                            error=f"{recipe.tool} produced no output")

    return ParseOutcome(True, csv_files=produced, tool=recipe.tool,
                        tool_sha256=tool.sha256, duration=result.duration)
