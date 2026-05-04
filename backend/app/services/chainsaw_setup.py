"""
Auto-setup for Chainsaw + Sigma rules.

Called once at startup.  If the binary is already present (either at the
path configured in .env or in the auto-install directory) nothing is
downloaded.  Otherwise the latest release is fetched from GitHub, extracted,
and the in-memory settings are patched so the rest of the app uses the
correct paths without restarting.

Download location: <data_dir>/chainsaw/
  <data_dir>/chainsaw/chainsaw[.exe]
  <data_dir>/chainsaw/rules/
  <data_dir>/chainsaw/mappings/
"""
from __future__ import annotations

import io
import json
import logging
import platform
import re
import shutil
import stat
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("remora.chainsaw_setup")

GITHUB_API = "https://api.github.com/repos/WithSecureLabs/chainsaw/releases/latest"
USER_AGENT = "remora-dfir/1.0"

# ── Platform detection ────────────────────────────────────────────────────────

def _asset_suffix() -> str:
    """Return the release asset name suffix for the current OS + arch."""
    machine = platform.machine().lower()
    is_arm  = machine in ("aarch64", "arm64", "armv8")

    if sys.platform == "win32":
        return "x86_64-pc-windows-msvc.zip"
    elif sys.platform == "darwin":
        arch = "aarch64" if is_arm else "x86_64"
        return f"{arch}-apple-darwin.tar.gz"
    else:  # Linux
        arch = "aarch64" if is_arm else "x86_64"
        return f"{arch}-unknown-linux-gnu.tar.gz"


# ── GitHub fetch ──────────────────────────────────────────────────────────────

def _http_get(url: str, timeout: int = 60) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
    with urlopen(req, timeout=timeout) as r:
        return r.read()


def _latest_release() -> dict:
    req = Request(GITHUB_API, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=30) as r:
        return json.loads(r.read())


# ── Archive extraction ────────────────────────────────────────────────────────

def _extract(data: bytes, name: str, dest: Path) -> None:
    """
    Extract zip or tar.gz into *dest*.
    If the archive has a single top-level directory, its contents are
    moved up one level so the binary ends up directly in *dest*.
    """
    with tempfile.TemporaryDirectory() as tmp_str:
        tmp = Path(tmp_str)

        if name.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                zf.extractall(tmp)
        else:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
                tf.extractall(tmp)

        # Detect single top-level dir wrapper (common in some releases)
        children = list(tmp.iterdir())
        root = children[0] if len(children) == 1 and children[0].is_dir() else tmp

        # Copy contents into dest
        dest.mkdir(parents=True, exist_ok=True)
        for item in root.iterdir():
            target = dest / item.name
            if target.exists():
                shutil.rmtree(target) if target.is_dir() else target.unlink()
            shutil.copytree(item, target) if item.is_dir() else shutil.copy2(item, target)


def _make_executable(path: Path) -> None:
    if sys.platform != "win32" and path.exists():
        path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


# ── Rules path resolution ─────────────────────────────────────────────────────

def _find_rules(install_dir: Path) -> str:
    """
    Return the best rules directory inside *install_dir*.

    Preference order:
      1. rules/sigma/builtin  — Sigma-format built-ins
      2. rules/sigma          — Sigma-format root
      3. rules/evtx           — Chainsaw native EVTX rules (from release bundle)
      4. rules                — any other rule tree

    NOTE: deliberately excludes the `mappings/` directory — mapping files
    are NOT detection rules and must not be passed as a rules argument.
    """
    candidates = [
        install_dir / "rules" / "sigma" / "builtin",
        install_dir / "rules" / "sigma",
        install_dir / "rules" / "evtx",
        install_dir / "rules",
    ]
    for c in candidates:
        if c.is_dir() and any(c.rglob("*.yml")):
            return str(c)

    return ""


# Fallback source-archive branches to try if the release asset is missing
_SOURCE_BRANCHES = ("master", "main")


def _extract_rules_from_zip(data: bytes, install_dir: Path) -> str:
    """
    Given a zip archive (release bundle or source archive), find any
    `rules/` subtree inside it and install the files into
    *install_dir/rules/*.  Returns the rules path on success, "" on failure.
    """
    rules_dest = install_dir / "rules"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        rule_members = [
            m for m in zf.infolist()
            if re.search(r"/rules/", m.filename) and not m.filename.endswith("/")
        ]
        if not rule_members:
            return ""

        for member in rule_members:
            # Strip everything up to and including the first "rules/" component
            rel = re.sub(r"^.*?/rules/", "", member.filename)
            if not rel:
                continue
            dest_file = rules_dest / rel
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            dest_file.write_bytes(zf.read(member))

    yml_count = len(list(rules_dest.rglob("*.yml")))
    logger.info("[chainsaw] Rules installed: %d .yml files in %s", yml_count, rules_dest)
    return _find_rules(install_dir)


def _download_rules(install_dir: Path) -> str:
    """
    Obtain Sigma rules and install them into *install_dir/rules/*.

    Strategy (in order):
      1. Download the 'all_platforms+rules+examples' asset from the latest
         GitHub release — version-matched to the binary, purpose-built.
      2. Fall back to the source-archive zip for known branch names
         (master, main).

    Returns the path to the rules directory, or "" on failure.
    """
    # ── 1. Try the bundled release asset ─────────────────────────────────
    logger.info("[chainsaw] Looking for rules asset in latest GitHub release …")
    try:
        release = _latest_release()
        assets  = release.get("assets", [])
        # Look for the asset whose name contains "rules" (case-insensitive)
        rules_asset = next(
            (a for a in assets if "rules" in a["name"].lower() and a["name"].endswith(".zip")),
            None,
        )
        if rules_asset:
            url  = rules_asset["browser_download_url"]
            size = rules_asset.get("size", 0)
            logger.info(
                "[chainsaw] Downloading rules asset: %s (%.1f MB) …",
                rules_asset["name"], size / 1_048_576,
            )
            data = _http_get(url, timeout=300)
            result = _extract_rules_from_zip(data, install_dir)
            if result:
                return result
            logger.warning("[chainsaw] Rules asset had no rules/ directory — trying source archive")
        else:
            logger.info("[chainsaw] No rules asset found in release — trying source archive")
    except Exception as exc:
        logger.warning("[chainsaw] Release asset lookup failed: %s — trying source archive", exc)

    # ── 2. Fall back to source archive ───────────────────────────────────
    for branch in _SOURCE_BRANCHES:
        url = f"https://github.com/WithSecureLabs/chainsaw/archive/refs/heads/{branch}.zip"
        logger.info("[chainsaw] Trying source archive branch '%s' …", branch)
        try:
            data   = _http_get(url, timeout=120)
            result = _extract_rules_from_zip(data, install_dir)
            if result:
                return result
            logger.warning("[chainsaw] Branch '%s' zip had no rules/ directory", branch)
        except Exception as exc:
            logger.warning("[chainsaw] Source archive '%s' failed: %s", branch, exc)

    logger.error(
        "[chainsaw] Could not obtain Sigma rules automatically. "
        "Download them manually and set CHAINSAW_RULES_PATH in .env."
    )
    return ""


# ── Public entry point ────────────────────────────────────────────────────────

def setup_chainsaw(install_dir: Path, current_bin: str, current_rules: str) -> tuple[str, str]:
    """
    Ensure Chainsaw is available and return *(bin_path, rules_path)*.

    Priority:
      1. Manually configured paths in .env (if both exist → use them as-is)
      2. Auto-install dir (if binary present from a previous startup)
      3. Binary in system PATH (if rules also set)
      4. Download latest release from GitHub → extract → return new paths
    """
    bin_name = "chainsaw.exe" if sys.platform == "win32" else "chainsaw"

    # ── 1. .env paths provided and valid ─────────────────────────────────
    if current_bin != "chainsaw" and Path(current_bin).is_file():
        logger.info("[chainsaw] Using configured binary: %s", current_bin)
        rules = current_rules or _find_rules(Path(current_bin).parent)
        if not rules:
            rules = _download_rules(install_dir)
        return current_bin, rules

    # ── 2. Auto-install dir already populated ─────────────────────────────
    auto_bin = install_dir / bin_name
    if auto_bin.is_file():
        logger.info("[chainsaw] Found in auto-install dir: %s", auto_bin)
        rules = current_rules or _find_rules(install_dir)
        if not rules:
            logger.info("[chainsaw] No Sigma rules found — downloading from source repo …")
            rules = _download_rules(install_dir)
        return str(auto_bin), rules

    # ── 3. Binary in system PATH (user installed it manually) ────────────
    in_path = shutil.which(current_bin)
    if in_path and current_rules:
        logger.info("[chainsaw] Found in PATH: %s", in_path)
        return in_path, current_rules

    # ── 4. Download from GitHub ───────────────────────────────────────────
    logger.info("[chainsaw] Not found — fetching latest release from GitHub …")
    try:
        release = _latest_release()
        version = release.get("tag_name", "?")
        suffix  = _asset_suffix()

        asset = next(
            (a for a in release.get("assets", []) if a["name"].endswith(suffix)),
            None,
        )
        if asset is None:
            logger.warning(
                "[chainsaw] No asset matches platform suffix '%s' in release %s. "
                "Download Chainsaw manually and set CHAINSAW_BIN_PATH in .env.",
                suffix, version,
            )
            return current_bin, current_rules

        url  = asset["browser_download_url"]
        name = asset["name"]
        size = asset.get("size", 0)
        logger.info("[chainsaw] Downloading %s (%s, %.1f MB) …", name, version, size / 1_048_576)

        data = _http_get(url, timeout=300)
        logger.info("[chainsaw] Download complete — extracting to %s …", install_dir)

        _extract(data, name, install_dir)

        # Make executable
        _make_executable(auto_bin)

        # Verify
        if not auto_bin.is_file():
            # Binary landed somewhere else (nested dir?) — search for it
            found = list(install_dir.glob(f"**/{bin_name}"))
            if found:
                auto_bin_resolved = found[0]
                _make_executable(auto_bin_resolved)
                logger.info("[chainsaw] Binary found at %s", auto_bin_resolved)
                rules = _find_rules(auto_bin_resolved.parent)
                return str(auto_bin_resolved), rules
            logger.error(
                "[chainsaw] Binary '%s' not found after extraction. "
                "Check the archive contents and set CHAINSAW_BIN_PATH manually.",
                bin_name,
            )
            return current_bin, current_rules

        rules = _find_rules(install_dir)
        if not rules:
            logger.info("[chainsaw] No Sigma rules bundled — downloading from source repo …")
            rules = _download_rules(install_dir)
        logger.info(
            "[chainsaw] Ready — binary: %s | rules: %s",
            auto_bin, rules or "(none found)",
        )
        return str(auto_bin), rules

    except URLError as exc:
        logger.warning(
            "[chainsaw] Network error during auto-download (%s). "
            "Chainsaw will not be available until configured manually.",
            exc,
        )
    except Exception as exc:
        logger.warning(
            "[chainsaw] Auto-download failed: %s. "
            "Chainsaw will not be available until configured manually.",
            exc,
        )

    return current_bin, current_rules
