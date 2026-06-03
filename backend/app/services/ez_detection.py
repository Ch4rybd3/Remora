"""
EZ Tools artifact detection engine.

Given a filename (and optionally the first line of a CSV), returns the
artifact category, human-readable label, and destination page info.

Supports outputs from:
  EvtxECmd, RBCmd, LECmd, JLECmd, SBECmd, MFTECmd,
  AppCompatCacheParser, AmcacheParser, SrumECmd, WxTCmd, RECmd
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class DetectionResult:
    category: str          # internal key, e.g. "shimcache"
    category_label: str    # human-readable, e.g. "Shimcache (AppCompatCache)"
    destination_page: str  # frontend route template, e.g. "/cases/{case_id}/execution"
    destination_label: str # e.g. "Execution Artifacts"
    tab: str               # sub-tab within destination page


# ─── Pattern registry ─────────────────────────────────────────────────────────
# Each entry: (regex_on_filename, category, label, dest_page, dest_label, tab)
# Patterns are checked in order; first match wins.

_PATTERNS: list[tuple[str, str, str, str, str, str]] = [
    # ── Event Logs ─────────────────────────────────────────────────────────
    (r"(?i)evtxecmd.*output\.csv$",
     "evtx_ez", "Event Logs (EvtxECmd)",
     "/artifacts/filesystem", "Event Logs", "evtx"),

    # ── Recycle Bin ────────────────────────────────────────────────────────
    (r"(?i)rbcmd.*output\.csv$",
     "recycle_bin", "Recycle Bin (RBCmd)",
     "/artifacts/user-activity", "User Activity", "recycle-bin"),

    # ── Jump Lists (automatic / custom) ────────────────────────────────────
    (r"(?i)automaticdestinations\.csv$",
     "jump_lists_auto", "Jump Lists — Automatic (JLECmd)",
     "/artifacts/user-activity", "User Activity", "jump-lists"),

    (r"(?i)customdestinations\.csv$",
     "jump_lists_custom", "Jump Lists — Custom (JLECmd)",
     "/artifacts/user-activity", "User Activity", "jump-lists"),

    # ── LNK files ──────────────────────────────────────────────────────────
    (r"(?i)lecmd.*output\.csv$",
     "lnk_files", "LNK Files (LECmd)",
     "/artifacts/user-activity", "User Activity", "lnk"),

    # ── Windows Timeline (WxTCmd) ───────────────────────────────────────────
    # *_Activity.csv (but NOT *_PackageIDs.csv)
    (r"(?i)_activity\.csv$",
     "windows_timeline", "Windows Timeline (WxTCmd)",
     "/artifacts/user-activity", "User Activity", "windows-timeline"),

    (r"(?i)_activity_packageids\.csv$",
     "windows_timeline_pkg", "Windows Timeline Package IDs (WxTCmd)",
     "/artifacts/user-activity", "User Activity", "windows-timeline"),

    # ── Shellbags (SBECmd) ─────────────────────────────────────────────────
    # *_NTUSER.csv or *_UsrClass.csv produced by SBECmd
    (r"(?i)_(ntuser|usrclass)\.csv$",
     "shellbags", "Shellbags (SBECmd)",
     "/artifacts/user-activity", "User Activity", "shellbags"),

    # ── Filesystem — MFT ───────────────────────────────────────────────────
    (r"(?i)mftecmd.*\$mft.*output\.csv$",
     "mft_ez", "MFT (MFTECmd)",
     "/artifacts/mft", "MFT / USN", "mft"),

    # ── Filesystem — USN / $J ──────────────────────────────────────────────
    (r"(?i)mftecmd.*\$j.*output\.csv$",
     "usn_ez", "USN Journal / $J (MFTECmd)",
     "/artifacts/mft", "MFT / USN", "usn"),

    # ── Filesystem — $Boot ─────────────────────────────────────────────────
    (r"(?i)mftecmd.*\$boot.*output\.csv$",
     "mft_boot", "MFT $Boot (MFTECmd)",
     "/artifacts/mft", "MFT / USN", "boot"),

    # ── Shimcache ──────────────────────────────────────────────────────────
    (r"(?i)appcompatcache\.csv$",
     "shimcache", "Shimcache / AppCompatCache (AppCompatCacheParser)",
     "/artifacts/execution", "Execution Artifacts", "shimcache"),

    # ── Amcache ────────────────────────────────────────────────────────────
    (r"(?i)amcache_unassociatedfileentries\.csv$",
     "amcache_unassociated", "Amcache — Unassociated Files (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_associatedfileentries\.csv$",
     "amcache_associated", "Amcache — Associated Files (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_programentries\.csv$",
     "amcache_programs", "Amcache — Programs (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_devicecontainers\.csv$",
     "amcache_devices", "Amcache — Device Containers (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_devicepnps\.csv$",
     "amcache_pnp", "Amcache — Device PnPs (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_drivebinaries\.csv$",
     "amcache_drivers", "Amcache — Driver Binaries (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    (r"(?i)amcache_shortcuts\.csv$",
     "amcache_shortcuts", "Amcache — Shortcuts (AmcacheParser)",
     "/artifacts/execution", "Execution Artifacts", "amcache"),

    # ── SRUM ───────────────────────────────────────────────────────────────
    (r"(?i)srumecmd_appresourceuseinfo.*output\.csv$",
     "srum_app_usage", "SRUM — App Resource Usage (SrumECmd)",
     "/artifacts/srum", "SRUM", "app-usage"),

    (r"(?i)srumecmd_networkusages.*output\.csv$",
     "srum_network", "SRUM — Network Usage (SrumECmd)",
     "/artifacts/srum", "SRUM", "network"),

    (r"(?i)srumecmd_networkconnections.*output\.csv$",
     "srum_net_conn", "SRUM — Network Connections (SrumECmd)",
     "/artifacts/srum", "SRUM", "network"),

    (r"(?i)srumecmd_apptimelineprovider.*output\.csv$",
     "srum_timeline", "SRUM — App Timeline (SrumECmd)",
     "/artifacts/srum", "SRUM", "app-usage"),

    (r"(?i)srumecmd_energyusage.*output\.csv$",
     "srum_energy", "SRUM — Energy Usage (SrumECmd)",
     "/artifacts/srum", "SRUM", "app-usage"),

    # ── Registry — RECmd batch output ──────────────────────────────────────
    (r"(?i)recmd_batch.*output\.csv$",
     "registry_batch", "Registry Batch (RECmd)",
     "/artifacts/registry", "Registry", "batch"),

    # ── Registry — RECmd individual plugin outputs ─────────────────────────
    # Pattern: *_<PluginName>__<HivePath>.csv  (double underscore)
    (r"(?i)_[a-z][a-z0-9]+__.*\.csv$",
     "registry_plugin", "Registry Plugin (RECmd)",
     "/artifacts/registry", "Registry", "plugins"),
]

_COMPILED: list[tuple[re.Pattern, str, str, str, str, str]] = [
    (re.compile(pat), cat, lbl, pg, plbl, tab)
    for pat, cat, lbl, pg, plbl, tab in _PATTERNS
]


def detect(filename: str, first_line: Optional[str] = None) -> Optional[DetectionResult]:
    """
    Return a DetectionResult for the given CSV filename, or None if unknown.

    :param filename:   Bare filename (no directory component needed, but full path is OK).
    :param first_line: Optional header row for secondary validation (not currently used
                       but reserved for ambiguous cases).
    """
    name = filename.replace("\\", "/").split("/")[-1]

    for pattern, cat, lbl, pg, plbl, tab in _COMPILED:
        if pattern.search(name):
            return DetectionResult(
                category=cat,
                category_label=lbl,
                destination_page=pg,
                destination_label=plbl,
                tab=tab,
            )

    return None


def detect_zip_contents(entries: list[str]) -> dict[str, Optional[DetectionResult]]:
    """
    Given a list of filenames (from a ZIP), return a dict mapping
    each filename → DetectionResult (or None).
    """
    return {e: detect(e) for e in entries}


# ─── Category grouping (for UI display) ───────────────────────────────────────

CATEGORY_GROUPS: dict[str, dict] = {
    "execution": {
        "label": "Execution Artifacts",
        "categories": ["shimcache", "amcache_unassociated", "amcache_associated",
                        "amcache_programs", "amcache_devices", "amcache_pnp",
                        "amcache_drivers", "amcache_shortcuts"],
        "icon": "⚡",
    },
    "user_activity": {
        "label": "User Activity",
        "categories": ["lnk_files", "jump_lists_auto", "jump_lists_custom",
                        "shellbags", "recycle_bin", "windows_timeline",
                        "windows_timeline_pkg"],
        "icon": "👤",
    },
    "event_logs": {
        "label": "Event Logs",
        "categories": ["evtx_ez"],
        "icon": "📋",
    },
    "filesystem": {
        "label": "MFT / USN",
        "categories": ["mft_ez", "usn_ez", "mft_boot"],
        "icon": "💾",
    },
    "srum": {
        "label": "SRUM",
        "categories": ["srum_app_usage", "srum_network", "srum_net_conn",
                        "srum_timeline", "srum_energy"],
        "icon": "📊",
    },
    "registry": {
        "label": "Registry",
        "categories": ["registry_batch", "registry_plugin"],
        "icon": "🗂",
    },
}
