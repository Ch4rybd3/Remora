"""
Provisioning the Eric Zimmerman parsers.

Twelve .NET tools that read Windows artifacts natively. They are what turn a
registry hive, a prefetch file or an `$MFT` from "recognised" into "queryable",
and there is no Python equivalent worth the name.

**Not baked into the image.** They are fetched on first start, the same way
Chainsaw already is: 50 MB of third-party binaries in every image layer, rebuilt
on every release, is a poor trade when the alternative is a directory the
operator can also fill by hand.

**That directory is the air-gap answer too.** A forensic workstation is often
not on the internet, and a tool that can only be installed by reaching out is a
tool that cannot be installed where this one is most needed. Point
`EZ_TOOLS_PATH` at a directory holding the extracted tools and nothing is
downloaded.

**Downloads are hash-pinned.** The hashes were recorded from the official host
on 2026-08-30 - trust on first use, the same footing as any package manager, and
stated rather than implied. A mismatch does not install the tool: a changed
binary from a third-party host is exactly the event that should stop, not the
one that should be waved through. An operator who wants a newer release updates
the pin, which is a decision somebody makes rather than one that happens.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

from ..config import settings

logger = logging.getLogger("remora.ez_tools")

BASE_URL = "https://download.mikestammer.com/net9"
USER_AGENT = "remora-dfir/1.0"

#: Recorded from the official host on 2026-08-30. See the module note on why
#: these are pinned and what a mismatch means.
PINNED_SHA256: dict[str, str] = {
    "EvtxECmd":             "4d740e51c4532c340d080f832c766c2acb0351832dae118d1abe9bb49203faa4",
    "MFTECmd":              "60ae857a554b830243e38e91fafdfdf6066f31c703282c5c6f40daf3b64d3160",
    "RECmd":                "4a4e2f4beba54fdb9ba4eeb5e6f9d323e666b309e407ac89e047f82be0c963a2",
    "AmcacheParser":        "d40d1e7863159dbd9aa3ae826d919edc490ca33df84bde57e86da848a583af03",
    "AppCompatCacheParser": "67756841dbcd8ca3f47083be2b016a22f61bde0ea3450f0a776cf878bf66d42d",
    "PECmd":                "e361d397c8c64959fd537e1826fcb89ea2d6fe24b3b4b63e6666479d565caa15",
    "LECmd":                "f3e9c799ec7d3fa4cd5f553ec3f9d544c80c8e48afd04ef43456da3d48ad0760",
    "JLECmd":               "155ee54e6ac6b70bce1aa636ec52d0b0165263933764d9a45c85af97df546892",
    "SBECmd":               "88edb98a32baaf68114aa106f25f999e46d387d9d0003d3222a1168cc1b7eb9b",
    "RBCmd":                "e2b5c6ba8929a8731d861577c796763730e303ec2d4dd8d294ee0de8d5ceb541",
    "SrumECmd":             "4d7035100f771a7ef5d75ac30e7edb70761976f2c92476213d19abb50d4c8489",
    "WxTCmd":               "aa08a020cc9daa22551edbf07bca336cb8249ce29830d67cf09bc3703dffec6d",
}

#: Tools that refuse to run on Linux, and why. Verified by running each of the
#: twelve under the sandbox on 2026-08-30 - they exit with an explicit message
#: rather than failing obscurely, which is the good version of this problem.
#:
#: They are not downloaded. Shipping a parser that reports "not supported" on
#: every artifact is worse than not having it: the analyst sees a failure and
#: cannot tell it from a corrupt file.
LINUX_UNSUPPORTED: dict[str, str] = {
    "PECmd": (
        "Prefetch on Windows 10 and later is MAM-compressed, and PECmd decompresses "
        "it through a Windows API with no Linux equivalent."
    ),
    "SrumECmd": (
        "SRUM lives in an ESE database, which SrumECmd reads through Windows-only "
        "ESE libraries."
    ),
}

#: What is actually installed and used.
TOOLS = tuple(name for name in PINNED_SHA256 if name not in LINUX_UNSUPPORTED)


@dataclass(frozen=True)
class Tool:
    name:   str
    #: Path to the managed assembly. These are framework-dependent builds, so
    #: they are run as `dotnet <name>.dll`; the `.exe` beside it is the Windows
    #: launcher and is meaningless here.
    dll:    Path
    sha256: str

    @property
    def argv_prefix(self) -> list[str]:
        return ["dotnet", str(self.dll)]


def tools_root() -> Path:
    return Path(settings.ez_tools_path)


def dotnet_available() -> bool:
    return shutil.which("dotnet") is not None


# ─── Locating an installed tool ───────────────────────────────────────────────

def _find_dll(root: Path, name: str) -> Path | None:
    """
    The assembly for `name`, wherever the archive put it.

    The layouts differ between tools and the casing is not consistent:
    `MFTECmd.zip` is flat, `EvtxECmd.zip` nests under a directory spelled
    `EvtxeCmd`. Matching case-insensitively on the filename is the only thing
    that holds for all twelve.
    """
    target = f"{name.lower()}.dll"
    direct = root / name / f"{name}.dll"
    if direct.exists():
        return direct
    for candidate in root.rglob("*.dll"):
        if candidate.name.lower() == target:
            return candidate
    return None


def find(name: str) -> Tool | None:
    """An installed tool, or None. Never downloads."""
    dll = _find_dll(tools_root(), name)
    if dll is None:
        return None
    return Tool(name=name, dll=dll, sha256=PINNED_SHA256.get(name, ""))


def installed() -> dict[str, Tool]:
    return {name: tool for name in TOOLS if (tool := find(name)) is not None}


def missing() -> list[str]:
    return [name for name in TOOLS if find(name) is None]


# ─── Fetching ─────────────────────────────────────────────────────────────────

class ProvisioningError(Exception):
    pass


def _download(name: str) -> bytes:
    request = Request(f"{BASE_URL}/{name}.zip", headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=120) as response:   # noqa: S310 - fixed https host
            return response.read()
    except URLError as e:
        raise ProvisioningError(f"Could not reach the download host: {e}") from e


def _verify(name: str, payload: bytes) -> None:
    expected = PINNED_SHA256.get(name)
    if not expected:
        raise ProvisioningError(f"No pinned hash for '{name}'")
    actual = hashlib.sha256(payload).hexdigest()
    if actual != expected:
        raise ProvisioningError(
            f"{name}.zip does not match its pinned hash. Expected {expected}, "
            f"got {actual}. The published release has changed; review it and "
            f"update PINNED_SHA256 in this file rather than disabling the check."
        )


def _extract(name: str, payload: bytes, root: Path) -> Path:
    destination = root / name
    with tempfile.TemporaryDirectory(dir=str(root)) as staging:
        staging_path = Path(staging)
        with zipfile.ZipFile(_as_file(payload, staging_path)) as archive:
            for member in archive.namelist():
                # A zip entry may name a path outside the destination. These
                # come from a third party over the network; extracting them
                # without checking is how an archive writes into /etc.
                resolved = (staging_path / member).resolve()
                if not str(resolved).startswith(str(staging_path.resolve())):
                    raise ProvisioningError(f"{name}.zip contains an unsafe path: {member}")
            archive.extractall(staging_path / "out")

        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(staging_path / "out"), str(destination))

    dll = _find_dll(destination, name)
    if dll is None:
        raise ProvisioningError(f"{name}.zip contains no {name}.dll")
    return dll


def _as_file(payload: bytes, directory: Path) -> Path:
    path = directory / "download.zip"
    path.write_bytes(payload)
    return path


def install(name: str, force: bool = False) -> Tool:
    """Fetch, verify and extract one tool. Returns it, installed."""
    if not force and (existing := find(name)) is not None:
        return existing

    root = tools_root()
    root.mkdir(parents=True, exist_ok=True)

    payload = _download(name)
    _verify(name, payload)
    dll = _extract(name, payload, root)
    logger.info("installed %s at %s", name, dll)
    return Tool(name=name, dll=dll, sha256=PINNED_SHA256[name])


def setup() -> dict[str, str]:
    """
    Install whatever is missing. Called once at startup.

    Returns a per-tool status rather than raising. One tool failing to download
    must not stop the application: the other eleven still parse, and the ingest
    queue says which artifact types are unavailable and why.
    """
    if settings.skip_tool_setup:
        return dict.fromkeys(TOOLS, "skipped")

    status: dict[str, str] = {}
    for name in TOOLS:
        if find(name) is not None:
            status[name] = "present"
            continue
        try:
            install(name)
            status[name] = "installed"
        except ProvisioningError as e:
            status[name] = f"unavailable: {e}"
            logger.warning("%s not installed: %s", name, e)
    return status
