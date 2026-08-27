"""
EZ Tools artifact detection engine.

Given a filename, returns the artifact category and human-readable label.
All detected artifacts are routed to the Artifact Explorer.

Supports outputs from:
  EvtxECmd, RBCmd, LECmd, JLECmd, SBECmd, MFTECmd,
  AppCompatCacheParser, AmcacheParser, SrumECmd, WxTCmd, RECmd
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_EXPLORER = "/artifacts/explorer"
_EXPLORER_LABEL = "Artifact Explorer"


@dataclass
class DetectionResult:
    category: str          # internal key, e.g. "shimcache"
    category_label: str    # human-readable, e.g. "Shimcache (AppCompatCache)"
    destination_page: str  # always "/artifacts/explorer"
    destination_label: str # always "Artifact Explorer"
    tab: str               # kept for compatibility (unused)


# ─── Pattern registry ─────────────────────────────────────────────────────────
# Each entry: (regex_on_filename, category, label)
# Patterns are checked in order; first match wins.

_PATTERNS: list[tuple[str, str, str]] = [
    # ── Event Logs ─────────────────────────────────────────────────────────
    (r"(?i)evtxecmd.*output\.csv$",
     "evtx_ez", "Event Logs (EvtxECmd)"),

    # ── Recycle Bin ────────────────────────────────────────────────────────
    (r"(?i)rbcmd.*output\.csv$",
     "recycle_bin", "Recycle Bin (RBCmd)"),

    # ── Jump Lists ─────────────────────────────────────────────────────────
    (r"(?i)automaticdestinations\.csv$",
     "jump_lists_auto", "Jump Lists — Automatic (JLECmd)"),

    (r"(?i)customdestinations\.csv$",
     "jump_lists_custom", "Jump Lists — Custom (JLECmd)"),

    # ── LNK files ──────────────────────────────────────────────────────────
    (r"(?i)lecmd.*output\.csv$",
     "lnk_files", "LNK Files (LECmd)"),

    # ── Windows Timeline ───────────────────────────────────────────────────
    (r"(?i)_activity\.csv$",
     "windows_timeline", "Windows Timeline (WxTCmd)"),

    (r"(?i)_activity_packageids\.csv$",
     "windows_timeline_pkg", "Windows Timeline Package IDs (WxTCmd)"),

    # ── Shellbags ──────────────────────────────────────────────────────────
    (r"(?i)_(ntuser|usrclass)\.csv$",
     "shellbags", "Shellbags (SBECmd)"),

    # ── MFT ────────────────────────────────────────────────────────────────
    (r"(?i)mftecmd.*\$mft.*output\.csv$",
     "mft_ez", "MFT (MFTECmd)"),

    # ── USN / $J ───────────────────────────────────────────────────────────
    (r"(?i)mftecmd.*\$j.*output\.csv$",
     "usn_ez", "USN Journal / $J (MFTECmd)"),

    # ── $Boot ──────────────────────────────────────────────────────────────
    (r"(?i)mftecmd.*\$boot.*output\.csv$",
     "mft_boot", "MFT $Boot (MFTECmd)"),

    # ── Shimcache ──────────────────────────────────────────────────────────
    (r"(?i)appcompatcache\.csv$",
     "shimcache", "Shimcache / AppCompatCache (AppCompatCacheParser)"),

    # ── Amcache ────────────────────────────────────────────────────────────
    (r"(?i)amcache_unassociatedfileentries\.csv$",
     "amcache_unassociated", "Amcache — Unassociated Files (AmcacheParser)"),

    (r"(?i)amcache_associatedfileentries\.csv$",
     "amcache_associated", "Amcache — Associated Files (AmcacheParser)"),

    (r"(?i)amcache_programentries\.csv$",
     "amcache_programs", "Amcache — Programs (AmcacheParser)"),

    (r"(?i)amcache_devicecontainers\.csv$",
     "amcache_devices", "Amcache — Device Containers (AmcacheParser)"),

    (r"(?i)amcache_devicepnps\.csv$",
     "amcache_pnp", "Amcache — Device PnPs (AmcacheParser)"),

    (r"(?i)amcache_drivebinaries\.csv$",
     "amcache_drivers", "Amcache — Driver Binaries (AmcacheParser)"),

    (r"(?i)amcache_shortcuts\.csv$",
     "amcache_shortcuts", "Amcache — Shortcuts (AmcacheParser)"),

    # ── SRUM ───────────────────────────────────────────────────────────────
    (r"(?i)srumecmd_appresourceuseinfo.*output\.csv$",
     "srum_app_usage", "SRUM — App Resource Usage (SrumECmd)"),

    (r"(?i)srumecmd_networkusages.*output\.csv$",
     "srum_network", "SRUM — Network Usage (SrumECmd)"),

    (r"(?i)srumecmd_networkconnections.*output\.csv$",
     "srum_net_conn", "SRUM — Network Connections (SrumECmd)"),

    (r"(?i)srumecmd_apptimelineprovider.*output\.csv$",
     "srum_timeline", "SRUM — App Timeline (SrumECmd)"),

    (r"(?i)srumecmd_energyusage.*output\.csv$",
     "srum_energy", "SRUM — Energy Usage (SrumECmd)"),

    # ── Registry ───────────────────────────────────────────────────────────
    (r"(?i)recmd_batch.*output\.csv$",
     "registry_batch", "Registry Batch (RECmd)"),

    (r"(?i)_[a-z][a-z0-9]+__.*\.csv$",
     "registry_plugin", "Registry Plugin (RECmd)"),
]

_COMPILED: list[tuple[re.Pattern, str, str]] = [
    (re.compile(pat), cat, lbl)
    for pat, cat, lbl in _PATTERNS
]


def detect(filename: str, first_line: str | None = None) -> DetectionResult | None:
    """
    Return a DetectionResult for the given CSV filename, or None if unknown.
    All results route to the Artifact Explorer.
    """
    name = filename.replace("\\", "/").split("/")[-1]

    for pattern, cat, lbl in _COMPILED:
        if pattern.search(name):
            return DetectionResult(
                category=cat,
                category_label=lbl,
                destination_page=_EXPLORER,
                destination_label=_EXPLORER_LABEL,
                tab="",
            )

    return None


def detect_zip_contents(entries: list[str]) -> dict[str, DetectionResult | None]:
    return {e: detect(e) for e in entries}
