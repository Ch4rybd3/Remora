"""
Ingest LECmd, JLECmd, SBECmd, RBCmd, WxTCmd CSVs into user activity tables.
"""
from __future__ import annotations

import re
from pathlib import Path
from sqlalchemy.orm import Session

from ...models.ez_artifacts import (
    LnkEntry, JumpListEntry, ShellbagEntry,
    RecycleBinEntry, WindowsTimelineEntry,
)
from .common import read_csv, _dt, _bool, _int, _big, chunked

CHUNK = 2000


# ─── LNK Files (LECmd) ────────────────────────────────────────────────────────

def ingest_lnk(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id         = case_id,
            file_id         = file_id,
            source_file     = r.get("SourceFile", "").strip() or None,
            source_created  = _dt(r.get("SourceCreated")),
            source_modified = _dt(r.get("SourceModified")),
            source_accessed = _dt(r.get("SourceAccessed")),
            target_created  = _dt(r.get("TargetCreated")),
            target_modified = _dt(r.get("TargetModified")),
            target_accessed = _dt(r.get("TargetAccessed")),
            file_size       = _big(r.get("FileSize")),
            local_path      = r.get("LocalPath", "").strip() or None,
            network_path    = r.get("NetworkPath", "").strip() or None,
            common_path     = r.get("CommonPath", "").strip() or None,
            arguments       = r.get("Arguments", "").strip() or None,
            target_path     = r.get("TargetIDAbsolutePath", "").strip() or None,
            machine_id      = r.get("MachineID", "").strip() or None,
            mac_address     = r.get("MachineMACAddress", "").strip() or None,
            drive_type      = r.get("DriveType", "").strip() or None,
            volume_serial   = r.get("VolumeSerialNumber", "").strip() or None,
            volume_label    = r.get("VolumeLabel", "").strip() or None,
            relative_path   = r.get("RelativePath", "").strip() or None,
            working_dir     = r.get("WorkingDirectory", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(LnkEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(LnkEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[lnk] ingested {total} entries", flush=True)
    return total


# ─── Jump Lists (JLECmd) ──────────────────────────────────────────────────────

def ingest_jumplists(csv_path: Path, case_id: str, file_id: str,
                     jl_type: str, db: Session) -> int:
    """jl_type: 'automatic' or 'custom'"""
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        # CustomDestinations use EntryName instead of MRU/EntryNumber
        buf.append(dict(
            case_id           = case_id,
            file_id           = file_id,
            jl_type           = jl_type,
            source_file       = r.get("SourceFile", "").strip() or None,
            app_id            = r.get("AppId", "").strip() or None,
            app_description   = r.get("AppIdDescription", "").strip() or None,
            mru               = _int(r.get("MRU")),
            entry_number      = _int(r.get("EntryNumber")),
            creation_time     = _dt(r.get("CreationTime")),
            last_modified     = _dt(r.get("LastModified")),
            hostname          = r.get("Hostname", "").strip() or None,
            mac_address       = r.get("MacAddress", "").strip() or None,
            path              = r.get("Path", "").strip() or None,
            interaction_count = _int(r.get("InteractionCount")),
            pin_status        = r.get("PinStatus", "").strip() or None,
            target_created    = _dt(r.get("TargetCreated")),
            target_modified   = _dt(r.get("TargetModified")),
            local_path        = r.get("LocalPath", "").strip() or None,
            target_path       = r.get("TargetIDAbsolutePath", "").strip() or None,
            file_size         = _big(r.get("FileSize")),
            drive_type        = r.get("DriveType", "").strip() or None,
            volume_serial     = r.get("VolumeSerialNumber", "").strip() or None,
            arguments         = r.get("Arguments", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(JumpListEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(JumpListEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[jumplists:{jl_type}] ingested {total} entries", flush=True)
    return total


# ─── Shellbags (SBECmd) ───────────────────────────────────────────────────────

_SID_RE = re.compile(r"S-1-5-\d+(-\d+)+", re.IGNORECASE)


def _hive_source(filename: str) -> str:
    name = filename.lower()
    if "usrclass" in name:
        return "UsrClass"
    return "NTUSER"


def ingest_shellbags(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    hive = _hive_source(csv_path.name)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id          = case_id,
            file_id          = file_id,
            bag_path         = r.get("BagPath", "").strip() or None,
            slot             = _int(r.get("Slot")),
            mru_position     = _int(r.get("MRUPosition")),
            absolute_path    = r.get("AbsolutePath", "").strip() or None,
            shell_type       = r.get("ShellType", "").strip() or None,
            created_on       = _dt(r.get("CreatedOn")),
            modified_on      = _dt(r.get("ModifiedOn")),
            accessed_on      = _dt(r.get("AccessedOn")),
            last_write_time  = _dt(r.get("LastWriteTime")),
            first_interacted = _dt(r.get("FirstInteracted")),
            last_interacted  = _dt(r.get("LastInteracted")),
            has_explored     = _bool(r.get("HasExplored")),
            hive_source      = hive,
        ))
        if len(buf) >= CHUNK:
            db.execute(ShellbagEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(ShellbagEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[shellbags:{hive}] ingested {total} entries", flush=True)
    return total


# ─── Recycle Bin (RBCmd) ──────────────────────────────────────────────────────

_SID_FROM_PATH = re.compile(r"(S-1-5-\d+(?:-\d+)+)", re.IGNORECASE)


def _extract_sid(source_name: str) -> str | None:
    m = _SID_FROM_PATH.search(source_name or "")
    return m.group(1) if m else None


def ingest_recycle_bin(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        src = r.get("SourceName", "").strip()
        buf.append(dict(
            case_id     = case_id,
            file_id     = file_id,
            source_name = src or None,
            file_type   = r.get("FileType", "").strip() or None,
            file_name   = r.get("FileName", "").strip() or None,
            file_size   = _big(r.get("FileSize")),
            deleted_on  = _dt(r.get("DeletedOn")),
            sid         = _extract_sid(src),
        ))
        if len(buf) >= CHUNK:
            db.execute(RecycleBinEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(RecycleBinEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[recycle_bin] ingested {total} entries", flush=True)
    return total


# ─── Windows Timeline (WxTCmd) ────────────────────────────────────────────────

def ingest_windows_timeline(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id       = case_id,
            file_id       = file_id,
            activity_type = r.get("ActivityType", "").strip() or None,
            executable    = r.get("Executable", "").strip() or None,
            display_text  = r.get("DisplayText", "").strip() or None,
            content_info  = r.get("ContentInfo", "").strip() or None,
            start_time    = _dt(r.get("StartTime")),
            end_time      = _dt(r.get("EndTime")),
            duration      = r.get("Duration", "").strip() or None,
            last_modified = _dt(r.get("LastModifiedTime")),
            platform      = r.get("DevicePlatform", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(WindowsTimelineEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(WindowsTimelineEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[windows_timeline] ingested {total} entries", flush=True)
    return total
