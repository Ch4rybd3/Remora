"""Ingest SrumECmd CSVs → srum_app_usage / srum_network_usage."""
from __future__ import annotations

from pathlib import Path
from sqlalchemy.orm import Session

from ...models.ez_artifacts import SrumAppUsage, SrumNetworkUsage
from .common import read_csv, _dt, _big, chunked

CHUNK = 2000


def ingest_app_usage(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    """AppResourceUseInfo and AppTimelineProvider."""
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id          = case_id,
            file_id          = file_id,
            timestamp        = _dt(r.get("Timestamp")),
            exe_info         = r.get("ExeInfo", "").strip() or None,
            exe_description  = r.get("ExeInfoDescription", "").strip() or None,
            user_name        = r.get("UserName", "").strip() or None,
            sid              = r.get("Sid", "").strip() or None,
            bg_bytes_read    = _big(r.get("BackgroundBytesRead")),
            bg_bytes_written = _big(r.get("BackgroundBytesWritten")),
            fg_bytes_read    = _big(r.get("ForegroundBytesRead")),
            fg_bytes_written = _big(r.get("ForegroundBytesWritten")),
            face_time        = _big(r.get("FaceTime")),
        ))
        if len(buf) >= CHUNK:
            db.execute(SrumAppUsage.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(SrumAppUsage.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[srum:app_usage] ingested {total} entries", flush=True)
    return total


def ingest_network_usage(csv_path: Path, case_id: str, file_id: str, db: Session) -> int:
    """NetworkUsages and NetworkConnections."""
    rows = read_csv(csv_path)
    total = 0
    buf: list[dict] = []

    for r in rows:
        buf.append(dict(
            case_id         = case_id,
            file_id         = file_id,
            timestamp       = _dt(r.get("Timestamp")),
            exe_info        = r.get("ExeInfo", "").strip() or None,
            exe_description = r.get("ExeInfoDescription", "").strip() or None,
            user_name       = r.get("UserName", "").strip() or None,
            sid             = r.get("Sid", "").strip() or None,
            bytes_received  = _big(r.get("BytesReceived")),
            bytes_sent      = _big(r.get("BytesSent")),
            profile_name    = r.get("ProfileName", "").strip() or None,
            interface_type  = r.get("InterfaceType", "").strip() or None,
        ))
        if len(buf) >= CHUNK:
            db.execute(SrumNetworkUsage.__table__.insert(), buf)
            total += len(buf)
            buf.clear()

    if buf:
        db.execute(SrumNetworkUsage.__table__.insert(), buf)
        total += len(buf)

    db.commit()
    print(f"[srum:network] ingested {total} entries", flush=True)
    return total
