"""Shared helpers for EZ Tools CSV ingest services."""
from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path
from typing import Optional


def _dt(val: Optional[str]) -> Optional[datetime]:
    """Parse common EZ Tools datetime formats to datetime (UTC assumed)."""
    if not val or val.strip() in ("", "0", "N/A", "NA", "null", "NULL"):
        return None
    val = val.strip()
    # EZ formats: "2026-05-28 08:00:00", "2026-05-28T08:00:00", "2026-05-28T08:00:00.0000000Z"
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%m/%d/%Y %H:%M:%S",
    ):
        try:
            return datetime.strptime(val, fmt)
        except ValueError:
            continue
    return None


def _bool(val: Optional[str]) -> Optional[bool]:
    if val is None:
        return None
    return val.strip().lower() in ("true", "yes", "1")


def _int(val: Optional[str]) -> Optional[int]:
    try:
        return int(val.strip()) if val and val.strip() else None
    except (ValueError, AttributeError):
        return None


def _big(val: Optional[str]) -> Optional[int]:
    return _int(val)


def read_csv(path: Path, encoding: str = "utf-8-sig") -> list[dict]:
    """Read a CSV file, handling BOM and various encodings."""
    for enc in (encoding, "utf-8", "latin-1", "cp1252"):
        try:
            text = path.read_text(encoding=enc)
            reader = csv.DictReader(io.StringIO(text))
            return [row for row in reader]
        except (UnicodeDecodeError, Exception):
            continue
    return []


def chunked(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]
