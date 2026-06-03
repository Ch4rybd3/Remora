"""Ingest AppCompatCacheParser CSV → shimcache_entries."""
from __future__ import annotations

from pathlib import Path
from sqlalchemy.orm import Session

from ...models.ez_artifacts import ShimcacheEntry
from .common import read_csv, _dt, _bool, _int, chunked

CHUNK = 2000


def ingest(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id        = case_id,
            file_id        = file_id,
            control_set    = _int(r.get("ControlSet")),
            cache_position = _int(r.get("CacheEntryPosition")),
            path           = r.get("Path", "").strip() or None,
            last_modified  = _dt(r.get("LastModifiedTimeUTC")),
            executed       = r.get("Executed", "").strip() or None,
            duplicate      = _bool(r.get("Duplicate")),
            source_hive    = r.get("SourceFile", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(ShimcacheEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(ShimcacheEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[shimcache] ingested {total} entries", flush=True)
    return total
