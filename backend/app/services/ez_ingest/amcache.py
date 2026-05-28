"""Ingest AmcacheParser CSVs → amcache_file_entries / amcache_program_entries."""
from __future__ import annotations

from pathlib import Path
from sqlalchemy.orm import Session

from ...models.ez_artifacts import AmcacheFileEntry, AmcacheProgramEntry
from .common import read_csv, _dt, _bool, _int, _big, chunked

CHUNK = 2000


def ingest_file_entries(csv_path: Path, case_id: str, file_id: str,
                        entry_type: str, db: Session) -> int:
    """Handles both UnassociatedFileEntries and AssociatedFileEntries."""
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id             = case_id,
            file_id             = file_id,
            entry_type          = entry_type,
            application_name    = r.get("ApplicationName", "").strip() or None,
            program_id          = r.get("ProgramId", "").strip() or None,
            file_key_last_write = _dt(r.get("FileKeyLastWriteTimestamp")),
            sha1                = r.get("SHA1", "").strip() or None,
            is_os_component     = _bool(r.get("IsOsComponent")),
            full_path           = r.get("FullPath", "").strip() or None,
            name                = r.get("Name", "").strip() or None,
            file_extension      = r.get("FileExtension", "").strip() or None,
            link_date           = _dt(r.get("LinkDate")),
            product_name        = r.get("ProductName", "").strip() or None,
            size                = _big(r.get("Size")),
            version             = r.get("Version", "").strip() or None,
            is_pe_file          = _bool(r.get("IsPeFile")),
            language            = r.get("Language", "").strip() or None,
            description         = r.get("Description", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(AmcacheFileEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(AmcacheFileEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[amcache:{entry_type}] ingested {total} entries", flush=True)
    return total


def ingest_program_entries(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id         = case_id,
            file_id         = file_id,
            program_id      = r.get("ProgramId", "").strip() or None,
            key_last_write  = _dt(r.get("KeyLastWriteTimestamp")),
            name            = r.get("Name", "").strip() or None,
            version         = r.get("Version", "").strip() or None,
            publisher       = r.get("Publisher", "").strip() or None,
            install_date    = _dt(r.get("InstallDate") or r.get("InstallDateArpLastModified")),
            root_dir_path   = r.get("RootDirPath", "").strip() or None,
            uninstall_string = r.get("UninstallString", "").strip() or None,
            source          = r.get("Source", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(AmcacheProgramEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(AmcacheProgramEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[amcache:programs] ingested {total} entries", flush=True)
    return total
