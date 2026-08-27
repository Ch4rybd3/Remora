"""
EVTX upload, background parsing, and timeline explorer API.

Parsing uses the `evtx` Python package (Rust-based, pip install evtx).
Events are stored in evtx_events table with proper indexes for fast
server-side filtering & pagination.

Auth is handled at the router-include level in main.py (**_auth).
"""
from __future__ import annotations

import hashlib
import html as _html
import json
import math
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models.case import Case
from ..models.evidence import Evidence, EvidenceType, AcquisitionMethod
from ..models.evtx import EvtxFile, EvtxEvent, EvtxCaseSelection
from ..models.user import User
from ..schemas.evtx import EvtxFileOut, EventsPage, EvtxEventOut, FileSummary, ChannelStat, EvtxSelectionOut, EvtxSelectionSave
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/evtx", tags=["evtx"])

# ── Storage ───────────────────────────────────────────────────────────────────

EVTX_DIR = settings.evidence_store_path.parent / "evtx"

LEVEL_MAP: dict[int, str] = {
    0: "Information",
    1: "Critical",
    2: "Error",
    3: "Warning",
    4: "Information",
    5: "Verbose",
}

# ── DB helpers ────────────────────────────────────────────────────────────────

def _case_dir(case_id: str) -> Path:
    d = EVTX_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_file_or_404(file_id: str, case_id: str, db: Session) -> EvtxFile:
    f = db.query(EvtxFile).filter(
        EvtxFile.id == file_id, EvtxFile.case_id == case_id
    ).first()
    if not f:
        raise HTTPException(404, "EVTX file not found")
    return f


# ── EVTX field extraction ─────────────────────────────────────────────────────

def _str(v: Any) -> str:
    """Safely convert any value to string, unescaping XML/HTML entities."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v).lower()
    return _html.unescape(str(v))


def _get_attr_name(obj: dict) -> str | None:
    """
    Extract the XML Name attribute from a JSON-serialised XML element.
    The evtx Rust lib uses the '#attributes' convention:
        {"#attributes": {"Name": "LogonType"}, "#text": "3"}
    Some builds may use '@Name' directly at the top level.
    """
    # Convention 1: {"#attributes": {"Name": ...}}
    attrs = obj.get("#attributes")
    if isinstance(attrs, dict):
        name = attrs.get("Name") or attrs.get("name")
        if name:
            return str(name)

    # Convention 2: {"@Name": ...}
    name = obj.get("@Name") or obj.get("@name")
    if name:
        return str(name)

    return None


def _extract_item(item: Any, index: int, out: dict) -> None:
    """Extract a single <Data> (or similar) element into out{}."""
    if item is None:
        return

    if isinstance(item, (str, int, float, bool)):
        out[f"Data_{index}"] = _str(item)
        return

    if not isinstance(item, dict):
        out[f"Data_{index}"] = _str(item)
        return

    name  = _get_attr_name(item)
    value = item.get("#text")

    if name:
        out[name] = _str(value)
    else:
        # Unnamed element: store text if present, else recurse into children
        if value is not None:
            out[f"Data_{index}"] = _str(value)
        else:
            # Walk all child keys (skip meta-keys)
            META = {"#attributes", "#text", "@Name", "@name"}
            for k, v in item.items():
                if k in META:
                    continue
                if isinstance(v, dict):
                    # one level of nesting (e.g. UserData sub-elements)
                    child_name = _get_attr_name(v) or k
                    child_val  = v.get("#text")
                    if child_val is not None:
                        out[child_name] = _str(child_val)
                    else:
                        out[k] = _str(v)
                elif isinstance(v, list):
                    for j, sub in enumerate(v):
                        _extract_item(sub, j, out)
                else:
                    out[k] = _str(v)


def _extract_event_data(raw: Any) -> dict[str, str]:
    """
    Robustly parse EventData or UserData into a flat {name: value} dict.

    Handles:
    - Named Data list:  <Data Name="X">val</Data>  → [{"#attributes":{"Name":"X"},"#text":"val"},…]
    - Unnamed Data list: <Data>val</Data>           → [{"#text":"val"},…]  or  ["val",…]
    - Single Data element (dict, not list)
    - Plain string EventData
    - Nested UserData structures
    - @Name convention (alternate XML→JSON libraries)
    - Integer / null #text values
    """
    out: dict[str, str] = {}

    if not raw:
        return out

    if isinstance(raw, str):
        out["Data"] = raw
        return out

    if not isinstance(raw, dict):
        out["Data"] = _str(raw)
        return out

    items = raw.get("Data")

    if items is None:
        # No "Data" key: treat dict keys directly as fields
        # (some UserData elements look like this)
        META = {"#attributes", "#text", "@Name", "@name"}
        for k, v in raw.items():
            if k in META:
                continue
            if isinstance(v, dict):
                sub_name = _get_attr_name(v) or k
                sub_val  = v.get("#text")
                out[sub_name] = _str(sub_val)
            elif isinstance(v, list):
                for j, sub in enumerate(v):
                    _extract_item(sub, j, out)
            else:
                out[k] = _str(v)
        return out

    if isinstance(items, list):
        for i, item in enumerate(items):
            _extract_item(item, i, out)

    elif isinstance(items, dict):
        _extract_item(items, 0, out)

    elif isinstance(items, str):
        out["Data"] = items

    return out


def _parse_record(record: dict, file_id: str) -> dict | None:
    """Parse one evtx record_json() entry into a DB-ready dict."""
    data_str = record.get("data", "{}")
    try:
        data = json.loads(data_str) if isinstance(data_str, str) else data_str
    except json.JSONDecodeError:
        return None

    event  = data.get("Event", {}) or {}
    system = event.get("System", {}) or {}

    # ── EventID ───────────────────────────────────────────────────────────────
    eid_raw = system.get("EventID", 0)
    if isinstance(eid_raw, dict):
        event_id = int(_str(eid_raw.get("#text") or 0))
    else:
        try:
            event_id = int(eid_raw or 0)
        except (ValueError, TypeError):
            event_id = 0

    # ── Timestamp ─────────────────────────────────────────────────────────────
    # Prefer record-level timestamp (always UTC ISO)
    time_created: datetime | None = None
    ts_raw = record.get("timestamp") or ""
    if ts_raw:
        try:
            time_created = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        except Exception:
            pass

    if time_created is None:
        tc_raw = system.get("TimeCreated", {})
        if isinstance(tc_raw, dict):
            sys_time = (
                tc_raw.get("#attributes", {}).get("SystemTime")
                or tc_raw.get("@SystemTime", "")
            )
            if sys_time:
                try:
                    time_created = datetime.fromisoformat(
                        _str(sys_time).replace("Z", "+00:00")
                    )
                except Exception:
                    pass

    # ── Level ─────────────────────────────────────────────────────────────────
    lvl_raw = system.get("Level", 4)
    if isinstance(lvl_raw, dict):
        level = int(_str(lvl_raw.get("#text") or 4))
    else:
        try:
            level = int(lvl_raw or 4)
        except (ValueError, TypeError):
            level = 4
    level_name = LEVEL_MAP.get(level, "Information")

    # ── Provider ──────────────────────────────────────────────────────────────
    prov_raw = system.get("Provider", {})
    if isinstance(prov_raw, dict):
        provider = (
            (prov_raw.get("#attributes") or {}).get("Name")
            or prov_raw.get("@Name")
            or ""
        )
        provider = _str(provider)
    else:
        provider = _str(prov_raw)

    # ── Channel / Computer ────────────────────────────────────────────────────
    channel  = _str(system.get("Channel")  or "")
    computer = _str(system.get("Computer") or "")

    # ── UserID ────────────────────────────────────────────────────────────────
    sec_raw = system.get("Security") or {}
    if isinstance(sec_raw, dict):
        user_id = (
            (sec_raw.get("#attributes") or {}).get("UserID")
            or sec_raw.get("@UserID")
            or None
        )
        user_id = _str(user_id) or None
    else:
        user_id = None

    # ── EventData ─────────────────────────────────────────────────────────────
    event_data = _extract_event_data(event.get("EventData"))

    # If EventData empty, try UserData
    if not event_data:
        event_data = _extract_event_data(event.get("UserData"))

    # If still empty, dump remaining Event keys as a fallback
    if not event_data:
        SKIP = {"System", "EventData", "UserData", "xmlns", "#attributes", "#text"}
        for k, v in event.items():
            if k not in SKIP:
                event_data[k] = _str(v)

    # ── Searchable text: field names + values for maximum search coverage ─────
    searchable_text = " ".join(
        f"{k} {v}" for k, v in event_data.items()
    )

    return {
        "id":               None,   # autoincrement
        "file_id":          file_id,
        "record_id":        record.get("event_record_id"),
        "time_created":     time_created,
        "event_id":         event_id,
        "level":            level,
        "level_name":       level_name,
        "channel":          channel  or None,
        "provider":         provider or None,
        "computer":         computer or None,
        "user_id":          user_id,
        "event_data":       event_data,
        "searchable_text":  searchable_text,
    }


# ── Background parser ─────────────────────────────────────────────────────────

def _parse_evtx_background(file_id: str, file_path: str) -> None:
    """Parse an EVTX file and bulk-insert events into the DB."""
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        evtx_file = db.query(EvtxFile).filter(EvtxFile.id == file_id).first()
        if not evtx_file:
            return

        evtx_file.status = "parsing"
        db.commit()

        try:
            import evtx as evtx_lib
        except ImportError:
            evtx_file.status    = "error"
            evtx_file.error_msg = "Python 'evtx' package not installed — run: pip install evtx"
            db.commit()
            return

        rows: list[dict] = []
        CHUNK = 500

        try:
            parser = evtx_lib.PyEvtxParser(file_path)
            for record in parser.records_json():
                try:
                    row = _parse_record(record, file_id)
                    if row:
                        rows.append(row)
                except Exception:
                    continue

                if len(rows) >= CHUNK:
                    db.execute(EvtxEvent.__table__.insert(), rows)
                    db.commit()
                    rows = []

            if rows:
                db.execute(EvtxEvent.__table__.insert(), rows)
                db.commit()

            total = (
                db.query(func.count(EvtxEvent.id))
                .filter(EvtxEvent.file_id == file_id)
                .scalar() or 0
            )

            evtx_file.status      = "ready"
            evtx_file.event_count = total
            evtx_file.parsed_at   = datetime.now(timezone.utc)
            db.commit()

        except Exception as exc:
            db.rollback()
            evtx_file = db.query(EvtxFile).filter(EvtxFile.id == file_id).first()
            if evtx_file:
                evtx_file.status    = "error"
                evtx_file.error_msg = str(exc)
                db.commit()
    finally:
        db.close()


# ── Column-level filter helper ────────────────────────────────────────────────

_COL_MAP = {
    "event_id":   EvtxEvent.event_id,
    "level_name": EvtxEvent.level_name,
    "channel":    EvtxEvent.channel,
    "provider":   EvtxEvent.provider,
    "computer":   EvtxEvent.computer,
    "data":       EvtxEvent.searchable_text,
}
_INT_COLS = {"event_id"}

# Only allow safe key names (prevent path injection in json_extract)
_SAFE_KEY = re.compile(r'^[\w\-\.]{1,128}$')


def _apply_field_filters(q, field_filters_json: str):
    """
    Filter on specific EventData keys via SQLite json_extract().

    Payload: [{"key": "LogonType", "mode": "=", "value": "5"}, ...]

    Supported modes: =  ~(contains)  !=  !~(!contains)
    """
    try:
        filters: list[dict] = json.loads(field_filters_json)
        if not isinstance(filters, list):
            return q
    except (json.JSONDecodeError, TypeError):
        return q

    for filt in filters:
        key   = str(filt.get("key",   "")).strip()
        mode  = str(filt.get("mode",  "=")).strip()
        value = str(filt.get("value", "")).strip()

        if not key or not value:
            continue
        if not _SAFE_KEY.match(key):
            continue  # reject unsafe key names

        # json_extract(event_data, '$.Key') — returns the JSON value as text
        extracted = func.json_extract(EvtxEvent.event_data, f"$.{key}")

        if mode == "=":
            q = q.filter(extracted == value)
        elif mode == "~":
            q = q.filter(extracted.ilike(f"%{value}%"))
        elif mode == "!=":
            q = q.filter((extracted != value) | extracted.is_(None))
        elif mode == "!~":
            q = q.filter(extracted.notilike(f"%{value}%") | extracted.is_(None))

    return q


def _apply_col_filters(q, col_filters_json: str):
    try:
        cf: dict = json.loads(col_filters_json)
    except (json.JSONDecodeError, TypeError):
        return q

    for col_key, filt in cf.items():
        if col_key not in _COL_MAP:
            continue
        col   = _COL_MAP[col_key]
        mode  = filt.get("mode", "contains")
        value = filt.get("value", "").strip()
        if not value:
            continue

        if mode == "contains":
            q = q.filter(col.ilike(f"%{value}%"))
        elif mode == "=":
            if col_key in _INT_COLS:
                try:
                    q = q.filter(col == int(value))
                except ValueError:
                    pass
            else:
                q = q.filter(col == value)
        elif mode == "!contains":
            q = q.filter(col.notilike(f"%{value}%") | col.is_(None))
        elif mode == "!=":
            if col_key in _INT_COLS:
                try:
                    q = q.filter((col != int(value)) | col.is_(None))
                except ValueError:
                    pass
            else:
                q = q.filter((col != value) | col.is_(None))

    return q


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=EvtxFileOut)
async def upload_evtx(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    db:               Session   = Depends(get_db),
    current_user:     User      = Depends(get_current_user),
):
    case = _get_case_or_404(case_id, db)

    if not file.filename or not file.filename.lower().endswith(".evtx"):
        raise HTTPException(400, "Only .evtx files are accepted")

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = f"{file_id}_{Path(file.filename).name}"
    dest_path = dest_dir / safe_name

    contents = await file.read()
    dest_path.write_bytes(contents)

    db_file = EvtxFile(
        id        = file_id,
        case_id   = case_id,
        filename  = file.filename,
        file_path = str(dest_path),
        status    = "pending",
    )
    db.add(db_file)
    audit_log(db, user=current_user, action="evtx.upload",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=file.filename, case_id=case_id,
              case_title=getattr(case, "title", None),
              details={"filename": file.filename, "size": len(contents)})
    db.commit()
    db.refresh(db_file)

    background_tasks.add_task(_parse_evtx_background, file_id, str(dest_path))
    return db_file


@router.get("/{case_id}/files", response_model=list[EvtxFileOut])
def list_files(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(EvtxFile)
        .filter(EvtxFile.case_id == case_id)
        .order_by(EvtxFile.uploaded_at.desc())
        .all()
    )


@router.delete("/{case_id}/files/{file_id}", status_code=204)
def delete_file(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    audit_log(db, user=current_user, action="evtx.delete",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    try:
        Path(f.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(f)
    db.commit()


@router.get("/{case_id}/files/{file_id}/summary", response_model=FileSummary)
def file_summary(case_id: str, file_id: str, db: Session = Depends(get_db)):
    _get_file_or_404(file_id, case_id, db)

    ch_rows = (
        db.query(EvtxEvent.channel, func.count(EvtxEvent.id).label("cnt"))
        .filter(EvtxEvent.file_id == file_id)
        .group_by(EvtxEvent.channel)
        .order_by(func.count(EvtxEvent.id).desc())
        .all()
    )
    channels = [ChannelStat(channel=r.channel or "Unknown", event_count=r.cnt) for r in ch_rows]

    lv_rows = (
        db.query(EvtxEvent.level_name, func.count(EvtxEvent.id).label("cnt"))
        .filter(EvtxEvent.file_id == file_id)
        .group_by(EvtxEvent.level_name)
        .all()
    )
    levels = {r.level_name or "Information": r.cnt for r in lv_rows}

    eid_rows = (
        db.query(EvtxEvent.event_id)
        .filter(EvtxEvent.file_id == file_id)
        .group_by(EvtxEvent.event_id)
        .order_by(func.count(EvtxEvent.id).desc())
        .limit(20)
        .all()
    )
    event_ids = [r.event_id for r in eid_rows if r.event_id is not None]

    return FileSummary(channels=channels, levels=levels, event_ids=event_ids)


@router.get("/{case_id}/files/{file_id}/events", response_model=EventsPage)
def list_events(
    case_id:     str,
    file_id:     str,
    page:        int           = Query(1, ge=1),
    page_size:   int           = Query(100, ge=1, le=500),
    search:      Optional[str] = Query(None),
    channels:    Optional[str] = Query(None),
    levels:      Optional[str] = Query(None),
    event_ids:   Optional[str] = Query(None),
    time_from:   Optional[str] = Query(None),
    time_to:     Optional[str] = Query(None),
    sort_dir:      str           = Query("asc"),
    col_filters:   Optional[str] = Query(None),
    field_filters: Optional[str] = Query(None),
    db:            Session       = Depends(get_db),
):
    _get_file_or_404(file_id, case_id, db)

    q = db.query(EvtxEvent).filter(EvtxEvent.file_id == file_id)

    if search:
        pattern = f"%{search}%"
        q = q.filter(
            EvtxEvent.searchable_text.ilike(pattern)
            | EvtxEvent.channel.ilike(pattern)
            | EvtxEvent.provider.ilike(pattern)
            | EvtxEvent.computer.ilike(pattern)
        )

    if channels:
        ch_list = [c.strip() for c in channels.split(",") if c.strip()]
        if ch_list:
            q = q.filter(EvtxEvent.channel.in_(ch_list))

    if levels:
        lv_list = [lv.strip() for lv in levels.split(",") if lv.strip()]
        if lv_list:
            q = q.filter(EvtxEvent.level_name.in_(lv_list))

    if event_ids:
        try:
            eid_list = [int(e) for e in event_ids.split(",") if e.strip()]
            if eid_list:
                q = q.filter(EvtxEvent.event_id.in_(eid_list))
        except ValueError:
            pass

    if time_from:
        try:
            q = q.filter(EvtxEvent.time_created >= datetime.fromisoformat(time_from))
        except ValueError:
            pass

    if time_to:
        try:
            q = q.filter(EvtxEvent.time_created <= datetime.fromisoformat(time_to))
        except ValueError:
            pass

    if col_filters:
        q = _apply_col_filters(q, col_filters)

    if field_filters:
        q = _apply_field_filters(q, field_filters)

    total = q.count()

    if sort_dir == "desc":
        q = q.order_by(EvtxEvent.time_created.desc().nulls_last(), EvtxEvent.record_id.desc())
    else:
        q = q.order_by(EvtxEvent.time_created.asc().nulls_last(), EvtxEvent.record_id.asc())

    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return EventsPage(
        total     = total,
        page      = page,
        page_size = page_size,
        pages     = max(1, math.ceil(total / page_size)),
        items     = [EvtxEventOut.model_validate(e) for e in items],
    )


@router.post("/{case_id}/files/{file_id}/reparse", response_model=EvtxFileOut)
def reparse_file(
    case_id:          str,
    file_id:          str,
    background_tasks: BackgroundTasks,
    db:               Session = Depends(get_db),
    current_user:     User    = Depends(get_current_user),
):
    """Re-parse an already uploaded EVTX (e.g. after a parser fix)."""
    f = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)

    # Delete existing events
    db.query(EvtxEvent).filter(EvtxEvent.file_id == file_id).delete()
    f.status      = "pending"
    f.event_count = None
    f.parsed_at   = None
    f.error_msg   = None
    audit_log(db, user=current_user, action="evtx.reparse",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)

    background_tasks.add_task(_parse_evtx_background, file_id, f.file_path)
    return f


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=EvtxFileOut)
def add_to_evidence(
    case_id: str,
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = _get_file_or_404(file_id, case_id, db)
    case = _get_case_or_404(case_id, db)

    if f.added_to_evidence:
        raise HTTPException(400, "Already added to evidence")

    file_path = Path(f.file_path)
    try:
        size = file_path.stat().st_size
    except Exception:
        size = 0

    # Compute integrity hashes
    md5_hash = sha256_hash = ""
    try:
        md5    = hashlib.md5()
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk)
                sha256.update(chunk)
        md5_hash    = md5.hexdigest()
        sha256_hash = sha256.hexdigest()
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    chain_entry = (
        f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {current_user.username} "
        f"via EVTX import — MD5: {md5_hash or 'n/a'} | SHA256: {sha256_hash or 'n/a'}"
    )

    ev = Evidence(
        case_id            = case_id,
        name               = f.filename,
        description        = f"Windows Event Log — {f.event_count or '?'} events",
        file_path          = f.file_path,
        original_filename  = f.filename,
        file_size          = size,
        mime_type          = "application/octet-stream",
        md5_hash           = md5_hash,
        sha256_hash        = sha256_hash,
        evidence_type      = EvidenceType.log,
        acquisition_method = AcquisitionMethod.logical_copy,
        collected_by       = current_user.username,
        collected_at       = now,
        chain_of_custody   = chain_entry,
    )
    db.add(ev)

    f.added_to_evidence = True
    audit_log(db, user=current_user, action="evtx.add_evidence",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=f.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    db.commit()
    db.refresh(f)
    return f


# ── Pinned-event selection persistence ────────────────────────────────────────

@router.get("/{case_id}/selection", response_model=EvtxSelectionOut)
def get_selection(case_id: str, db: Session = Depends(get_db)):
    """Return the analyst's saved event selection for this case."""
    _get_case_or_404(case_id, db)
    sel = db.query(EvtxCaseSelection).filter(
        EvtxCaseSelection.case_id == case_id
    ).first()
    if not sel:
        return EvtxSelectionOut(events=[], sent_ids=[])
    return EvtxSelectionOut(events=sel.events or [], sent_ids=sel.sent_ids or [])


@router.put("/{case_id}/selection", response_model=EvtxSelectionOut)
def save_selection(
    case_id: str,
    payload: EvtxSelectionSave,
    db:      Session = Depends(get_db),
):
    """Upsert the analyst's event selection for this case."""
    _get_case_or_404(case_id, db)
    sel = db.query(EvtxCaseSelection).filter(
        EvtxCaseSelection.case_id == case_id
    ).first()
    if sel:
        sel.events   = payload.events
        sel.sent_ids = payload.sent_ids
        sel.updated_at = datetime.now(timezone.utc)
    else:
        sel = EvtxCaseSelection(
            case_id  = case_id,
            events   = payload.events,
            sent_ids = payload.sent_ids,
        )
        db.add(sel)
    db.commit()
    db.refresh(sel)
    return EvtxSelectionOut(events=sel.events or [], sent_ids=sel.sent_ids or [])


# ── Public helper for collection import ──────────────────────────────────────

def register_evtx_file(
    source_path:       Path,
    case_id:           str,
    original_filename: str,
    db:                Session,
) -> EvtxFile:
    """
    Register an existing .evtx file (e.g. from collection import) in the EVTX
    module and trigger background parsing.  The parse runs in a daemon thread so
    the caller returns immediately.
    """
    import shutil as _shutil
    import threading

    dest_dir  = _case_dir(case_id)
    file_id   = str(uuid.uuid4())
    safe_name = f"{file_id}_{Path(original_filename).name}"
    dest_path = dest_dir / safe_name

    _shutil.copy2(str(source_path), str(dest_path))

    db_file = EvtxFile(
        id        = file_id,
        case_id   = case_id,
        filename  = original_filename,
        file_path = str(dest_path),
        status    = "pending",
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    # Launch parse in a daemon thread — we're already inside a background task
    threading.Thread(
        target=_parse_evtx_background,
        args=(file_id, str(dest_path)),
        daemon=True,
    ).start()

    print(f"[evtx] register_evtx_file: {original_filename} → {file_id}", flush=True)
    return db_file
