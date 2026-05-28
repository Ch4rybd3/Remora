"""Ingest RECmd batch output CSV → registry_batch_entries."""
from __future__ import annotations

from pathlib import Path
from sqlalchemy.orm import Session

from ...models.ez_artifacts import RegistryBatchEntry
from .common import read_csv, _dt, chunked

CHUNK = 2000


def ingest(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id              = case_id,
            file_id              = file_id,
            hive_path            = r.get("HivePath", "").strip() or None,
            hive_type            = r.get("HiveType", "").strip() or None,
            description          = r.get("Description", "").strip() or None,
            category             = r.get("Category", "").strip() or None,
            key_path             = r.get("KeyPath", "").strip() or None,
            value_name           = r.get("ValueName", "").strip() or None,
            value_type           = r.get("ValueType", "").strip() or None,
            value_data           = r.get("ValueData", "").strip() or None,
            value_data2          = r.get("ValueData2", "").strip() or None,
            value_data3          = r.get("ValueData3", "").strip() or None,
            comment              = r.get("Comment", "").strip() or None,
            last_write_timestamp = _dt(r.get("LastWriteTimestamp")),
            plugin_detail_file   = r.get("PluginDetailFile", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(RegistryBatchEntry.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(RegistryBatchEntry.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[registry_batch] ingested {total} entries", flush=True)
    return total
