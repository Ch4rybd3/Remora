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
    #: How to run the tool over a **directory** of artifacts of this kind,
    #: producing one table instead of one per file. Set only for the tools that
    #: support it; the rest are parsed one at a time.
    #:
    #: This is what the analyst asked for and what these tools were designed
    #: for: EvtxECmd over a folder writes a single CSV carrying a `SourceFile`
    #: column, so four hundred event logs become one table that says which log
    #: each row came from. Per-file parsing produced four hundred tables all
    #: named `..._EvtxECmd_Output.csv`.
    dir_args: Callable[[Path, Path], list[str]] | None = None
    notes: str = ""


def _file_in_dir_out(flag: str = "-f") -> Callable[[Path, Path], list[str]]:
    """The common shape: read one file, write CSVs into a directory."""
    def build(source: Path, out: Path) -> list[str]:
        return [flag, str(source), "--csv", str(out)]
    return build


RECIPES: dict[str, Recipe] = {
    "evtx": Recipe(
        tool="EvtxECmd", args=_file_in_dir_out(),
        dir_args=_file_in_dir_out("-d"),
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
        dir_args=_file_in_dir_out("-d"),
        label="Shortcut (LECmd)",
    ),
    "jumplist_auto": Recipe(
        tool="JLECmd", args=_file_in_dir_out(),
        dir_args=_file_in_dir_out("-d"),
        label="Jump list (JLECmd)", multi_output=True,
        notes="Automatic and custom destinations have different columns, so "
              "JLECmd writes one table for each. That is two tables, not two "
              "hundred.",
    ),
    "jumplist_custom": Recipe(
        tool="JLECmd", args=_file_in_dir_out(),
        dir_args=_file_in_dir_out("-d"),
        label="Jump list (JLECmd)", multi_output=True,
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


def _stage(source: Path, staged_dir: Path) -> Path:
    """
    Put a copy of the artifact where the parser will run, and return it.

    The artifact is always staged, never read where it happens to live.

    Two reasons. The parser's ability to open it otherwise depends on the
    permissions of every directory above it, and when that fails MFTECmd prints
    "File not found" and exits **zero** - which reads as an artifact that
    produced nothing rather than one it could not open. And a parser that only
    ever sees a directory we prepared cannot see the rest of the drop folder,
    which is the point of a sandbox.
    """
    staged_dir.mkdir(parents=True, exist_ok=True)
    staged = staged_dir / source.name
    if staged.exists():
        # Two artifacts of the same name from different directories - a triage
        # collects `NTUSER.DAT` once per user profile. Disambiguated rather
        # than overwritten, because the second one is not a duplicate.
        stem, suffix = staged.stem, staged.suffix
        n = 1
        while staged.exists():
            staged = staged_dir / f"{stem}_{n}{suffix}"
            n += 1
    try:
        # Free on the same filesystem, whatever the artifact's size. The link
        # is never chowned: it shares an inode with evidence.
        staged.hardlink_to(source)
    except OSError:
        import shutil
        shutil.copy2(source, staged)
    return staged


def _outcome(recipe: Recipe, tool, result, out: Path) -> ParseOutcome:
    """Read the sandbox result and the output directory into one answer."""
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
        # Include what the tool said. Several of them report a fatal problem on
        # stdout and exit zero - "File not found. Exiting" is the one that cost
        # an afternoon - so an exit code alone explains nothing.
        said = (result.stdout or result.stderr or "").strip().splitlines()
        detail = said[-1][:300] if said else ""
        return ParseOutcome(False, tool=recipe.tool, tool_sha256=tool.sha256,
                            duration=result.duration,
                            error=f"{recipe.tool} produced no output"
                                  + (f": {detail}" if detail else ""))

    return ParseOutcome(True, csv_files=produced, tool=recipe.tool,
                        tool_sha256=tool.sha256, duration=result.duration)


def _unavailable(recipe: Recipe) -> ParseOutcome | None:
    """Whatever stops this recipe from running at all, said plainly."""
    if ez_tools.find(recipe.tool) is None:
        return ParseOutcome(
            False, tool=recipe.tool,
            error=f"{recipe.tool} is not installed. See the tool status in Config.")
    if not ez_tools.dotnet_available():
        return ParseOutcome(False, tool=recipe.tool,
                            error="The .NET runtime is not present in this image")
    return None


def run(kind: str, source: Path, workdir: Path,
        out_dir: Path | None = None) -> ParseOutcome:
    """
    Parse one artifact, returning the CSVs it produced.

    `out_dir` is where those CSVs are written and **must outlive this call**:
    the Artifact Explorer reads them in place rather than copying them. The
    default puts them under `workdir`, which is right only for a caller that
    keeps `workdir` around - passing a `TemporaryDirectory` and registering the
    result produced tables that reported a row count and opened empty.

    Never raises for a failing tool. A crashing parser is a fact about one
    artifact, and the collection it arrived in has to keep ingesting.
    """
    recipe = recipe_for(kind, source.name)
    if recipe is None:
        if kind == "registry_hive":
            return ParseOutcome(False, error=UNHANDLED_NOTE["registry_hive"])
        return ParseOutcome(False, error=f"No Eric Zimmerman tool reads '{kind}'")

    blocked = _unavailable(recipe)
    if blocked:
        return blocked
    tool = ez_tools.find(recipe.tool)
    assert tool is not None                       # _unavailable checked it

    workdir.mkdir(parents=True, exist_ok=True)
    out = out_dir if out_dir is not None else (workdir / "out")
    out.mkdir(parents=True, exist_ok=True)

    staged = _stage(source, workdir / "input")

    # A directory-reading tool gets a directory holding this artifact and
    # nothing else, so a hive is never parsed together with its neighbours.
    target = staged.parent if "-d" in recipe.args(source, out) else staged

    try:
        size = source.stat().st_size
    except OSError:
        size = 0

    result = sandbox.run(
        [*tool.argv_prefix, *recipe.args(target, out)],
        workdir=workdir,
        limits=sandbox.Limits.for_input(size),
    )
    return _outcome(recipe, tool, result, out)


# ─── Batch mode ───────────────────────────────────────────────────────────────
# One table per artifact type per collection, rather than one per file.
#
# This is the mode these tools were built for. EvtxECmd, LECmd and JLECmd all
# accept a directory and write a single CSV with a `SourceFile` column naming
# the file each row came from - which is exactly the shape an analyst wants and
# the shape per-file parsing cannot produce. A triage with 300 event logs used
# to become 300 tables, all called `..._EvtxECmd_Output.csv`.

#: Kinds parsed once per collection instead of once per file.
BATCH_KINDS: dict[str, Recipe] = {
    kind: recipe for kind, recipe in RECIPES.items() if recipe.dir_args is not None
}


def run_batch(kind: str, sources: list[Path], out_dir: Path,
              scratch: Path) -> ParseOutcome:
    """
    Parse every artifact of one kind together, producing one table.

    `sources` are staged into a single directory the tool is pointed at, so it
    reads exactly these files and nothing else that happens to sit near them.
    Output goes to `out_dir`, which outlives this call.
    """
    recipe = BATCH_KINDS.get(kind)
    if recipe is None or recipe.dir_args is None:
        return ParseOutcome(False, error=f"'{kind}' is not parsed in batch")
    if not sources:
        return ParseOutcome(False, tool=recipe.tool, error="No file to parse")

    blocked = _unavailable(recipe)
    if blocked:
        return blocked
    tool = ez_tools.find(recipe.tool)
    assert tool is not None

    scratch.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    staged_dir = scratch / "input"
    for source in sources:
        try:
            _stage(source, staged_dir)
        except OSError as e:
            # One unreadable file does not cost the other three hundred their
            # table. It stays in the ingest queue with its own row.
            logger.warning("could not stage %s for %s: %s", source.name, recipe.tool, e)

    if not any(staged_dir.iterdir()):
        return ParseOutcome(False, tool=recipe.tool,
                            error="None of the files could be staged for parsing")

    total = 0
    for source in sources:
        try:
            total += source.stat().st_size
        except OSError:
            pass

    result = sandbox.run(
        [*tool.argv_prefix, *recipe.dir_args(staged_dir, out_dir)],
        workdir=scratch,
        limits=sandbox.Limits.for_input(total),
    )
    return _outcome(recipe, tool, result, out_dir)
