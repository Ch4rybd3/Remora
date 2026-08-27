"""
Chainsaw integration — run Sigma-based hunts on uploaded EVTX files.

Requires:
  - chainsaw binary reachable at CHAINSAW_BIN (env var or config)
  - Sigma rules directory at CHAINSAW_RULES (env var or config)

Set them in .env:
  CHAINSAW_BIN=/opt/chainsaw/chainsaw
  CHAINSAW_RULES=/opt/chainsaw/rules/sigma/builtin
"""
from __future__ import annotations

import json
import logging
import math
import subprocess
import tempfile
import uuid

logger = logging.getLogger("remora.chainsaw")
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal, get_db
from ..models.case import Case
from ..models.chainsaw import ChainsawScan, ChainsawAlert, ChainsawCaseSelection
from ..models.evtx import EvtxFile
from ..models.timeline import TimelineEvent
from ..models.user import User
from ..schemas.chainsaw import (
    ChainsawScanOut, ChainsawAlertOut, AlertsPage,
    ChainsawSelectionOut, ChainsawSelectionSave,
)
from ..services.audit_service import audit_log
from ..core.deps import get_current_user

router = APIRouter(prefix="/chainsaw", tags=["chainsaw"])

# ── Config ────────────────────────────────────────────────────────────────────

def _chainsaw_bin() -> str:
    return getattr(settings, "chainsaw_bin_path", "chainsaw")

def _chainsaw_rules() -> str:
    return getattr(settings, "chainsaw_rules_path", "")

# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_case_or_404(case_id: str, db: Session) -> Case:
    c = db.query(Case).filter(Case.id == case_id).first()
    if not c:
        raise HTTPException(404, "Case not found")
    return c

def _get_file_or_404(file_id: str, case_id: str, db: Session) -> EvtxFile:
    f = db.query(EvtxFile).filter(
        EvtxFile.id == file_id, EvtxFile.case_id == case_id,
    ).first()
    if not f:
        raise HTTPException(404, "EVTX file not found")
    return f

def _get_scan_or_404(scan_id: str, case_id: str, db: Session) -> ChainsawScan:
    s = db.query(ChainsawScan).filter(
        ChainsawScan.id == scan_id, ChainsawScan.case_id == case_id,
    ).first()
    if not s:
        raise HTTPException(404, "Scan not found")
    return s

def _get_alert_or_404(alert_id: str, case_id: str, db: Session) -> ChainsawAlert:
    a = db.query(ChainsawAlert).filter(
        ChainsawAlert.id == alert_id, ChainsawAlert.case_id == case_id,
    ).first()
    if not a:
        raise HTTPException(404, "Alert not found")
    return a

# ── Chainsaw output parser ────────────────────────────────────────────────────

def _safe_int(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None

def _extract_nested(obj: Any, *keys: Any) -> Any:
    """Walk nested dicts/lists by key sequence, return None if missing."""
    cur = obj
    for k in keys:
        if isinstance(cur, dict):
            cur = cur.get(k)
        elif isinstance(cur, list) and isinstance(k, int):
            cur = cur[k] if k < len(cur) else None
        else:
            return None
        if cur is None:
            return None
    return cur

def _parse_ts(raw: Any) -> Optional[datetime]:
    """Parse the various timestamp formats Chainsaw emits."""
    if not raw:
        return None
    s = str(raw).strip()
    # "2024-01-15 10:23:45.123456 UTC"
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f UTC",
        "%Y-%m-%d %H:%M:%S UTC",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None

def _flatten_event_data(ed: Any) -> dict[str, str]:
    """Flatten an EventData/UserData dict (values may be nested dicts)."""
    if not isinstance(ed, dict):
        return {}
    result: dict[str, str] = {}
    for k, v in ed.items():
        if isinstance(v, dict):
            # e.g. {"#text": "value"} or {"#attributes": {...}}
            inner = v.get("#text") or v.get("value") or str(v)
            result[k] = str(inner)
        elif v is None:
            result[k] = ""
        else:
            result[k] = str(v)
    return result

def _parse_system_block(system: dict, top_ts: Optional[datetime]) -> tuple:
    """
    Extract common fields from a Chainsaw System block.
    Handles both native (Provider_attributes / TimeCreated_attributes)
    and sigma (#attributes) field naming conventions.
    Returns (event_id, channel, computer, provider, timestamp).
    """
    # EventID — plain int (native) or {"#text": "4624"} (sigma)
    eid_raw  = system.get("EventID")
    event_id = _safe_int(
        _extract_nested(eid_raw, "#text") if isinstance(eid_raw, dict) else eid_raw
    )

    channel  = system.get("Channel") or ""
    computer = system.get("Computer") or ""

    # Provider — native uses Provider_attributes, sigma uses Provider/#attributes
    provider = (
        _extract_nested(system, "Provider_attributes", "Name")
        or _extract_nested(system, "Provider", "#attributes", "Name")
        or _extract_nested(system, "Provider", "Name")
        or (system.get("Provider") if isinstance(system.get("Provider"), str) else "")
    )

    # Timestamp — native uses TimeCreated_attributes, sigma uses TimeCreated/#attributes
    tc_raw = (
        _extract_nested(system, "TimeCreated_attributes", "SystemTime")
        or _extract_nested(system, "TimeCreated", "#attributes", "SystemTime")
        or _extract_nested(system, "TimeCreated")
    )
    ts = _parse_ts(tc_raw) or top_ts

    return event_id, channel, computer, provider or "", ts


def _extract_alert_from_doc(doc: dict, rule_name: str, level: str,
                            sigma_status: str, group_name: str,
                            tags: str, authors: str, top_ts: Optional[datetime]) -> Optional[dict]:
    """Extract one alert dict from a Chainsaw document block."""
    if not isinstance(doc, dict):
        return None
    event  = (doc.get("data") or {}).get("Event") or {}
    system = event.get("System") or {}
    event_id, channel, computer, provider, ts = _parse_system_block(system, top_ts)
    ed = event.get("EventData") or event.get("UserData") or {}
    return {
        "rule_name":    rule_name,
        "level":        level or "informational",
        "sigma_status": sigma_status,
        "group_name":   group_name,
        "tags":         tags,
        "authors":      authors,
        "timestamp":    ts,
        "event_id":     event_id,
        "channel":      channel,
        "computer":     computer,
        "provider":     provider,
        "event_data":   _flatten_event_data(ed),
    }


def _parse_chainsaw_output(raw_json: str) -> list[dict]:
    """
    Parse chainsaw JSON output into a flat list of alert dicts.

    Three formats are handled automatically:

    1. Native --rule (stdout):
       [{group, kind:"aggregate", documents:[{kind,path,data:{Event}}]}]

    2. Sigma --sigma --output file (individual matches, one per item):
       [{group:"Sigma", kind:"individual", document:{kind,path,data:{Event}},
         name, level, status, tags, authors, timestamp}]

    3. Sigma --sigma stdout (grouped by rule):
       [{name, level, status, group, tags, authors, timestamp, data:[{Event}]}]
    """
    try:
        items = json.loads(raw_json)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(items, list) or not items:
        return []

    alerts: list[dict] = []
    first = items[0] if isinstance(items[0], dict) else {}

    # Detect format
    if "documents" in first:
        fmt = "native"          # --rule stdout: grouped, plural documents
    elif "document" in first:
        fmt = "sigma_individual" # --sigma --output: one item per match, singular document
    else:
        fmt = "sigma_grouped"   # --sigma stdout: grouped by rule, data[] list

    for item in items:
        if not isinstance(item, dict):
            continue

        if fmt == "native":
            # {group, kind:"aggregate", documents:[{kind, path, data:{Event}}]}
            group_name = item.get("group") or "Unknown"
            docs = item.get("documents") or []
            if not isinstance(docs, list):
                docs = [docs]
            for doc in docs:
                a = _extract_alert_from_doc(doc, group_name, "informational",
                                            "stable", group_name, "", "", None)
                if a:
                    alerts.append(a)

        elif fmt == "sigma_individual":
            # {group:"Sigma", kind:"individual", document:{…}, name, level, …, timestamp}
            rule_name    = item.get("name") or "Unknown Rule"
            level        = (item.get("level") or "").lower()
            sigma_status = item.get("status") or ""
            group_name   = item.get("group") or "Sigma"
            tags_raw     = item.get("tags") or []
            authors_raw  = item.get("authors") or []
            tags    = ",".join(tags_raw)    if isinstance(tags_raw,    list) else str(tags_raw)
            authors = ",".join(authors_raw) if isinstance(authors_raw, list) else str(authors_raw)
            top_ts  = _parse_ts(item.get("timestamp"))
            doc     = item.get("document") or {}
            a = _extract_alert_from_doc(doc, rule_name, level, sigma_status,
                                        group_name, tags, authors, top_ts)
            if a:
                alerts.append(a)

        else:
            # {name, level, status, group, tags, authors, timestamp, data:[{Event}]}
            rule_name    = item.get("name") or "Unknown Rule"
            level        = (item.get("level") or "").lower()
            sigma_status = item.get("status") or ""
            group_name   = item.get("group") or ""
            tags_raw     = item.get("tags") or []
            authors_raw  = item.get("authors") or []
            tags    = ",".join(tags_raw)    if isinstance(tags_raw,    list) else str(tags_raw)
            authors = ",".join(authors_raw) if isinstance(authors_raw, list) else str(authors_raw)
            top_ts  = _parse_ts(item.get("timestamp"))
            data_entries = item.get("data") or []
            if not isinstance(data_entries, list):
                data_entries = [data_entries]
            for entry in data_entries:
                a = _extract_alert_from_doc(entry, rule_name, level, sigma_status,
                                            group_name, tags, authors, top_ts)
                if a:
                    alerts.append(a)

    return alerts

# ── Mapping file helper ───────────────────────────────────────────────────────

def _find_mapping(bin_path: str, rules_path: str) -> str:
    """
    Try to locate a Chainsaw sigma-event-logs mapping file.
    Looks next to the binary and next to the rules directory.
    Returns the path string if found, empty string otherwise.
    """
    candidates = [
        # Standard location in Chainsaw release package
        Path(bin_path).parent / "mappings" / "sigma-event-logs-all.yml",
        # Sometimes named differently
        Path(bin_path).parent / "mappings" / "sigma-event-logs.yml",
        # Next to rules dir
        Path(rules_path).parent.parent.parent / "mappings" / "sigma-event-logs-all.yml",
        Path(rules_path).parent.parent / "mappings" / "sigma-event-logs-all.yml",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return ""


# ── Background scan ───────────────────────────────────────────────────────────

def _scan_background(scan_id: str, file_path: str) -> None:
    """Run chainsaw in a subprocess and persist results. Runs in a thread pool."""
    db = SessionLocal()
    try:
        scan = db.query(ChainsawScan).filter(ChainsawScan.id == scan_id).first()
        if not scan:
            return

        scan.status = "scanning"
        db.commit()

        bin_path   = _chainsaw_bin()
        rules_path = _chainsaw_rules()

        # Validate config before shelling out
        if not rules_path:
            scan.status    = "error"
            scan.error_msg = (
                "Chainsaw rules path not configured. "
                "Set CHAINSAW_RULES_PATH in .env "
                "(e.g. CHAINSAW_RULES_PATH=/opt/chainsaw/rules/sigma/builtin)."
            )
            db.commit()
            return

        # Resolve install_dir paths for custom and sigma rules
        install_dir       = settings.evidence_store_path.parent / "chainsaw"
        custom_rules_dir  = install_dir / "custom_rules"
        sigma_rules_dir   = install_dir / "sigma_rules"
        mapping_file      = install_dir / "mappings" / "sigma-event-logs-all.yml"

        # Add mapping file if present (needed for Sigma field aliasing)
        mapping = _find_mapping(bin_path, rules_path)

        # Determine the correct flag:
        #   --sigma  → standard SigmaHQ YAML rules (rules/sigma/…)
        #             requires a --mapping file for field aliasing
        #   --rule   → Chainsaw native EVTX rule format (rules/evtx/…)
        #             outputs JSON array to stdout; --output is not used
        rules_flag  = "--sigma" if "sigma" in Path(rules_path).parts else "--rule"
        use_mapping = rules_flag == "--sigma"
        use_output  = rules_flag == "--sigma"   # --output dir only works reliably with --sigma

        # Check whether custom rules directory has any rules
        custom_rule_files = list(custom_rules_dir.rglob("*.yml")) + list(custom_rules_dir.rglob("*.yaml")) \
            if custom_rules_dir.is_dir() else []

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir) / "out"
            if use_output:
                out_dir.mkdir()

            cmd = [
                bin_path, "hunt", file_path,
                rules_flag, rules_path,
                "--json",
            ]
            if use_output:
                cmd += ["--output", str(out_dir)]
            if use_mapping and mapping:
                cmd += ["--mapping", mapping]

            # Include custom rules directory if it has rule files
            if custom_rule_files:
                cmd += ["--rule", str(custom_rules_dir)]
                print(f"[chainsaw] Including {len(custom_rule_files)} custom rule(s) from {custom_rules_dir}", flush=True)

            print(f"[chainsaw] CMD: {' '.join(cmd)}", flush=True)

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
            except FileNotFoundError:
                scan.status    = "error"
                scan.error_msg = (
                    f"Chainsaw binary not found at '{bin_path}'. "
                    "Set CHAINSAW_BIN_PATH in .env or ensure 'chainsaw' is in PATH."
                )
                db.commit()
                return
            except subprocess.TimeoutExpired:
                scan.status    = "error"
                scan.error_msg = "Chainsaw scan timed out after 10 minutes."
                db.commit()
                return

            print(f"[chainsaw] exit={result.returncode}", flush=True)
            print(f"[chainsaw] STDERR: {(result.stderr or '')[:1000]}", flush=True)
            print(f"[chainsaw] STDOUT: {(result.stdout or '')[:2000]}", flush=True)

            # Hard error: exit code > 1
            if result.returncode > 1:
                scan.status    = "error"
                scan.error_msg = (
                    result.stderr or result.stdout or
                    f"Chainsaw exited with code {result.returncode}"
                ).strip()[:2000]
                db.commit()
                return

            # ── Collect results ──────────────────────────────────────────
            raw_alerts: list[dict] = []

            if use_output:
                # --sigma mode: results are written as JSON files under out_dir
                json_files = sorted(out_dir.rglob("*.json"))
                print(f"[chainsaw] output files: {[str(f) for f in json_files]}", flush=True)
                for jf in json_files:
                    content = jf.read_text(encoding="utf-8")
                    print(f"[chainsaw] file {jf.name} ({len(content)} bytes): {content[:500]}", flush=True)
                    raw_alerts.extend(_parse_chainsaw_output(content))
            else:
                # --rule mode: results come as a JSON array on stdout
                stdout = result.stdout or ""
                print(f"[chainsaw] stdout ({len(stdout)} bytes): {stdout[:2000]}", flush=True)
                raw_alerts = _parse_chainsaw_output(stdout)

            # ── Second pass: Sigma rules scan ────────────────────────────
            sigma_yml_files = list(sigma_rules_dir.rglob("*.yml")) if sigma_rules_dir.is_dir() else []
            if sigma_yml_files and mapping_file.is_file():
                # --output with --sigma expects a FILE path, not a directory
                sigma_out_file = Path(tmpdir) / "sigma_results.json"

                sigma_cmd = [
                    bin_path, "hunt", file_path,
                    "--sigma", str(sigma_rules_dir),
                    "--mapping", str(mapping_file),
                    "--json",
                    "--output", str(sigma_out_file),
                ]
                print(f"[chainsaw] Sigma CMD: {' '.join(sigma_cmd)}", flush=True)

                try:
                    sigma_result = subprocess.run(
                        sigma_cmd,
                        capture_output=True,
                        text=True,
                        timeout=600,
                    )
                    print(f"[chainsaw] Sigma exit={sigma_result.returncode}", flush=True)
                    print(f"[chainsaw] Sigma STDERR: {(sigma_result.stderr or '')[:500]}", flush=True)

                    if sigma_result.returncode <= 1:
                        sigma_json_files = [sigma_out_file] if sigma_out_file.is_file() else []
                        print(f"[chainsaw] Sigma output files: {[str(f) for f in sigma_json_files]}", flush=True)
                        for jf in sigma_json_files:
                            content = jf.read_text(encoding="utf-8")
                            print(f"[chainsaw] Sigma file content ({len(content)} bytes): {content[:1000]}", flush=True)
                            parsed = _parse_chainsaw_output(content)
                            print(f"[chainsaw] Sigma parsed {len(parsed)} alerts from file", flush=True)
                            raw_alerts.extend(parsed)
                    else:
                        print("[chainsaw] Sigma scan non-fatal error, skipping sigma results.", flush=True)
                except subprocess.TimeoutExpired:
                    print("[chainsaw] Sigma scan timed out, skipping sigma results.", flush=True)
                except Exception as exc:
                    print(f"[chainsaw] Sigma scan exception: {exc}", flush=True)
            else:
                if sigma_yml_files and not mapping_file.is_file():
                    print(f"[chainsaw] Sigma rules found but mapping file missing at {mapping_file}, skipping.", flush=True)
                elif not sigma_yml_files:
                    print("[chainsaw] No SigmaHQ rules installed, skipping sigma pass.", flush=True)

        print(f"[chainsaw] parsed {len(raw_alerts)} alerts", flush=True)

        # Bulk-insert alerts
        CHUNK = 500
        total = 0
        for i in range(0, max(len(raw_alerts), 1), CHUNK):
            chunk = raw_alerts[i : i + CHUNK]
            db.bulk_insert_mappings(ChainsawAlert, [
                {
                    "id":           str(uuid.uuid4()),
                    "scan_id":      scan_id,
                    "file_id":      scan.file_id,
                    "case_id":      scan.case_id,
                    **a,
                }
                for a in chunk
            ])
            db.flush()
            total += len(chunk)

        scan.status      = "ready"
        scan.alert_count = len(raw_alerts)
        scan.scanned_at  = datetime.now(timezone.utc)
        db.commit()

    except Exception as exc:
        db.rollback()
        try:
            scan = db.query(ChainsawScan).filter(ChainsawScan.id == scan_id).first()
            if scan:
                scan.status    = "error"
                scan.error_msg = str(exc)[:2000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/files/{file_id}/scan", response_model=ChainsawScanOut)
def start_scan(
    case_id: str,
    file_id: str,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Launch a Chainsaw Sigma hunt against an EVTX file (async)."""
    _get_case_or_404(case_id, db)
    evtx = _get_file_or_404(file_id, case_id, db)

    if evtx.status != "ready":
        raise HTTPException(400, "EVTX file must be fully parsed before scanning.")

    # Delete previous scans + their alerts for this file (rescan replaces)
    # Must delete alerts first — SQLite doesn't enforce FK cascades by default
    old_scan_ids = [
        row[0] for row in
        db.query(ChainsawScan.id).filter(
            ChainsawScan.file_id == file_id,
            ChainsawScan.case_id == case_id,
        ).all()
    ]
    if old_scan_ids:
        db.query(ChainsawAlert).filter(
            ChainsawAlert.scan_id.in_(old_scan_ids)
        ).delete(synchronize_session=False)
        db.query(ChainsawScan).filter(
            ChainsawScan.id.in_(old_scan_ids)
        ).delete(synchronize_session=False)

    scan = ChainsawScan(
        file_id=file_id,
        case_id=case_id,
        status="pending",
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    bg.add_task(_scan_background, scan.id, evtx.file_path)

    audit_log(db, user=current_user, action="chainsaw.scan",
              resource_type="evtx_file", resource_id=file_id,
              resource_name=evtx.filename, case_id=case_id)
    db.commit()

    return scan


@router.get("/{case_id}/scans", response_model=list[ChainsawScanOut])
def list_scans(
    case_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return all Chainsaw scans for a case, newest first."""
    _get_case_or_404(case_id, db)
    return (
        db.query(ChainsawScan)
        .filter(ChainsawScan.case_id == case_id)
        .order_by(ChainsawScan.created_at.desc())
        .all()
    )


@router.delete("/{case_id}/scans/{scan_id}", status_code=204)
def delete_scan(
    case_id: str,
    scan_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a scan and all its alerts."""
    scan = _get_scan_or_404(scan_id, case_id, db)
    db.delete(scan)
    audit_log(db, user=current_user, action="chainsaw.delete_scan",
              resource_type="chainsaw_scan", resource_id=scan_id, case_id=case_id)
    db.commit()


@router.get("/{case_id}/alerts", response_model=AlertsPage)
def list_alerts(
    case_id: str,
    file_id:    Optional[str] = Query(None, description="Filter by EVTX file"),
    levels:     Optional[str] = Query(None, description="Comma-separated levels"),
    search:     Optional[str] = Query(None, description="Search in rule name / channel / computer"),
    sort_dir:   str           = Query("desc", pattern="^(asc|desc)$"),
    page:       int           = Query(1, ge=1),
    page_size:  int           = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Paginated, filtered list of Chainsaw alerts for a case."""
    _get_case_or_404(case_id, db)
    q = db.query(ChainsawAlert).filter(ChainsawAlert.case_id == case_id)

    if file_id:
        q = q.filter(ChainsawAlert.file_id == file_id)

    if levels:
        lvl_list = [l.strip().lower() for l in levels.split(",") if l.strip()]
        q = q.filter(ChainsawAlert.level.in_(lvl_list))

    if search:
        term = f"%{search}%"
        q = q.filter(
            ChainsawAlert.rule_name.ilike(term)
            | ChainsawAlert.channel.ilike(term)
            | ChainsawAlert.computer.ilike(term)
            | ChainsawAlert.tags.ilike(term)
        )

    total = q.count()
    pages = max(1, math.ceil(total / page_size))

    col = ChainsawAlert.timestamp
    q = q.order_by(col.asc() if sort_dir == "asc" else col.desc())
    items = q.offset((page - 1) * page_size).limit(page_size).all()

    return AlertsPage(total=total, page=page, page_size=page_size, pages=pages, items=items)


@router.post("/{case_id}/alerts/{alert_id}/timeline", response_model=ChainsawAlertOut)
def alert_to_timeline(
    case_id:  str,
    alert_id: str,
    db:       Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a Chainsaw alert to the case timeline."""
    alert = _get_alert_or_404(alert_id, case_id, db)

    # Build a descriptive timeline entry
    level_upper = (alert.level or "").upper()
    title = f"[{level_upper}] {alert.rule_name}"

    parts = []
    if alert.channel:
        parts.append(f"Channel: {alert.channel}")
    if alert.computer:
        parts.append(f"Computer: {alert.computer}")
    if alert.provider:
        parts.append(f"Provider: {alert.provider}")
    if alert.tags:
        parts.append(f"Tags: {alert.tags}")
    if alert.event_data:
        sample = list(alert.event_data.items())[:6]
        parts.append("Event data: " + " | ".join(f"{k}={v}" for k, v in sample))

    description = "\n".join(parts)

    tags_list = ["chainsaw", f"sigma-{alert.level or 'info'}"]
    if alert.tags:
        tags_list += [t.strip() for t in alert.tags.split(",") if t.strip()][:4]

    ev = TimelineEvent(
        case_id=case_id,
        event_ts=alert.timestamp or datetime.now(timezone.utc),
        title=title,
        description=description,
        actor=alert.computer or "",
        source=f"Chainsaw / {alert.rule_name}",
        tags=",".join(tags_list),
    )
    db.add(ev)

    alert.added_to_timeline = True
    audit_log(db, user=current_user, action="chainsaw.to_timeline",
              resource_type="chainsaw_alert", resource_id=alert_id,
              resource_name=alert.rule_name, case_id=case_id)
    db.commit()
    db.refresh(alert)
    return alert


# ── Selection persistence ─────────────────────────────────────────────────────

@router.get("/{case_id}/selection", response_model=ChainsawSelectionOut)
def get_selection(
    case_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sel = db.query(ChainsawCaseSelection).filter(
        ChainsawCaseSelection.case_id == case_id,
    ).first()
    if not sel:
        return ChainsawSelectionOut(alert_ids=[], sent_ids=[])
    return sel


@router.put("/{case_id}/selection", response_model=ChainsawSelectionOut)
def save_selection(
    case_id: str,
    body:    ChainsawSelectionSave,
    db:      Session = Depends(get_db),
    _:       User = Depends(get_current_user),
):
    sel = db.query(ChainsawCaseSelection).filter(
        ChainsawCaseSelection.case_id == case_id,
    ).first()
    if sel:
        sel.alert_ids  = body.alert_ids
        sel.sent_ids   = body.sent_ids
        sel.updated_at = datetime.now(timezone.utc)
    else:
        sel = ChainsawCaseSelection(
            case_id=case_id,
            alert_ids=body.alert_ids,
            sent_ids=body.sent_ids,
        )
        db.add(sel)
    db.commit()
    db.refresh(sel)
    return sel
