"""
MITRE ATT&CK integration.

* Downloads the official Enterprise ATT&CK STIX bundle once and caches a
  compact technique-tree JSON (~200 KB) locally.
* Exposes per-case TTP CRUD so analysts can highlight techniques.
* Exports / imports ATT&CK Navigator layer files.
"""
from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user, get_db
from ..models.mitre import CaseTTP
from ..models.user import User

router = APIRouter(tags=["mitre"])

# ── Tactic ordering & metadata (Enterprise ATT&CK) ───────────────────────────

TACTIC_ORDER = [
    "reconnaissance", "resource-development", "initial-access",
    "execution", "persistence", "privilege-escalation",
    # ATT&CK v19: Defense Evasion (TA0005) was split into two tactics:
    #   - Stealth       (TA0005) — camouflage / living-off-the-land / obfuscation
    #   - Defense Impairment (TA0112) — disabling security tools / logging / EDRs
    "stealth", "defense-impairment",
    "credential-access", "discovery",
    "lateral-movement", "collection", "command-and-control",
    "exfiltration", "impact",
]

TACTIC_META: dict[str, dict[str, str]] = {
    "reconnaissance":       {"id": "TA0043", "name": "Reconnaissance"},
    "resource-development": {"id": "TA0042", "name": "Resource Development"},
    "initial-access":       {"id": "TA0001", "name": "Initial Access"},
    "execution":            {"id": "TA0002", "name": "Execution"},
    "persistence":          {"id": "TA0003", "name": "Persistence"},
    "privilege-escalation": {"id": "TA0004", "name": "Privilege Escalation"},
    # ATT&CK v19 — formerly "Defense Evasion" (TA0005)
    "stealth":              {"id": "TA0005", "name": "Stealth"},
    "defense-impairment":   {"id": "TA0112", "name": "Defense Impairment"},
    "credential-access":    {"id": "TA0006", "name": "Credential Access"},
    "discovery":            {"id": "TA0007", "name": "Discovery"},
    "lateral-movement":     {"id": "TA0008", "name": "Lateral Movement"},
    "collection":           {"id": "TA0009", "name": "Collection"},
    "command-and-control":  {"id": "TA0011", "name": "Command and Control"},
    "exfiltration":         {"id": "TA0010", "name": "Exfiltration"},
    "impact":               {"id": "TA0040", "name": "Impact"},
}

STIX_URL = (
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/"
    "master/enterprise-attack/enterprise-attack.json"
)

# ── Local cache paths ─────────────────────────────────────────────────────────

def _mitre_dir() -> Path:
    d = settings.evidence_store_path.parent / "mitre"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _compact_path() -> Path:
    return _mitre_dir() / "attack_enterprise_compact.json"


def _status_path() -> Path:
    return _mitre_dir() / "download_status.json"


# ── Atomic status writer ──────────────────────────────────────────────────────

def _write_status(data: dict) -> None:
    """Write status JSON atomically (write-then-rename) to avoid race conditions."""
    path = _status_path()
    try:
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception:
            os.unlink(tmp)
            raise
        os.replace(tmp, path)
    except Exception:
        # Fallback: direct write (still better than nothing)
        path.write_text(json.dumps(data), encoding="utf-8")


# ── STIX → compact tree ───────────────────────────────────────────────────────

def _build_compact_tree(stix_data: dict) -> dict[str, Any]:
    objects = stix_data.get("objects", [])

    # ── ATT&CK version ────────────────────────────────────────────────────────
    version = "unknown"
    for o in objects:
        if o.get("type") == "x-mitre-collection":
            version = o.get("x_mitre_version", "unknown")
            break
    # Fallback: try identity objects
    if version == "unknown":
        for o in objects:
            ver = o.get("x_mitre_version")
            if ver:
                version = ver
                break

    # ── Collect all live attack-patterns ─────────────────────────────────────
    # Key: ATT&CK ID (e.g. "T1566", "T1566.001")
    raw: dict[str, dict[str, Any]] = {}
    for o in objects:
        if o.get("type") != "attack-pattern":
            continue
        if o.get("x_mitre_deprecated") or o.get("revoked"):
            continue
        ext = next(
            (r for r in o.get("external_references", [])
             if r.get("source_name") == "mitre-attack"),
            None,
        )
        if not ext:
            continue
        tid = ext.get("external_id", "")
        if not tid.startswith("T"):
            continue  # skip non-technique IDs (e.g. G-group, S-software)

        tactics = [
            p["phase_name"]
            for p in o.get("kill_chain_phases", [])
            if p.get("kill_chain_name") == "mitre-attack"
        ]
        url = ext.get("url") or f"https://attack.mitre.org/techniques/{tid.replace('.', '/')}/"

        # Sub-technique detection: reliable via ID format (T1234.001 has a dot)
        is_sub = "." in tid

        raw[tid] = {
            "id":     tid,
            "name":   o.get("name", tid),
            "url":    url,
            "tactics": tactics,
            "is_sub":  is_sub,
        }

    print(
        f"[mitre] Parsed {len(raw)} live techniques "
        f"({sum(1 for t in raw.values() if not t['is_sub'])} parents, "
        f"{sum(1 for t in raw.values() if t['is_sub'])} sub-techniques)",
        flush=True,
    )

    # ── Build tactic columns — parents first ──────────────────────────────────
    tactic_map: dict[str, list[dict[str, Any]]] = {t: [] for t in TACTIC_ORDER}
    # A technique can appear in multiple tactic columns (e.g. T1078 → 4 tactics).
    # Keep a list per parent ID so sub-techniques are attached to each occurrence.
    parent_entries: dict[str, list[dict[str, Any]]] = {}

    for tid in sorted(raw):
        tech = raw[tid]
        if tech["is_sub"]:
            continue
        for tactic in tech["tactics"]:
            if tactic not in tactic_map:
                continue
            entry: dict[str, Any] = {
                "id":             tech["id"],
                "name":           tech["name"],
                "url":            tech["url"],
                "sub_techniques": [],
            }
            tactic_map[tactic].append(entry)
            parent_entries.setdefault(tech["id"], []).append(entry)

    # ── Attach sub-techniques to every column their parent appears in ─────────
    for tid in sorted(raw):
        tech = raw[tid]
        if not tech["is_sub"]:
            continue
        parent_id = tid.rsplit(".", 1)[0]
        for parent_entry in parent_entries.get(parent_id, []):
            parent_entry["sub_techniques"].append({
                "id":   tech["id"],
                "name": tech["name"],
                "url":  tech["url"],
            })

    # Sort sub-techniques by ID within each parent
    for lst in tactic_map.values():
        for entry in lst:
            entry["sub_techniques"].sort(key=lambda x: x["id"])

    # ── Debug summary ─────────────────────────────────────────────────────────
    total_parents  = sum(len(lst) for lst in tactic_map.values())
    total_subs     = sum(len(e["sub_techniques"]) for lst in tactic_map.values() for e in lst)
    print(f"[mitre] Tree built: {total_parents} parent slots, {total_subs} sub-technique slots", flush=True)

    return {
        "version": f"ATT&CK v{version}",
        "tactics": [
            {
                "id":         TACTIC_META[t]["id"],
                "name":       TACTIC_META[t]["name"],
                "short_name": t,
                "techniques": tactic_map[t],
            }
            for t in TACTIC_ORDER
            if t in TACTIC_META
        ],
    }


def _download_and_cache() -> None:

    compact_path = _compact_path()

    _write_status({"state": "downloading"})
    print(f"[mitre] Downloading ATT&CK STIX data from {STIX_URL}", flush=True)

    try:
        req = Request(STIX_URL, headers={"User-Agent": "remora-dfir/1.0"})
        with urlopen(req, timeout=300) as r:
            raw_bytes = r.read()
    except (URLError, Exception) as exc:
        print(f"[mitre] Download failed: {exc}", flush=True)
        _write_status({"state": "error", "error": str(exc)})
        return

    print(f"[mitre] Downloaded {len(raw_bytes) // 1024} KB — parsing STIX…", flush=True)
    try:
        stix_data = json.loads(raw_bytes)
        tree = _build_compact_tree(stix_data)
        # Write compact cache atomically too
        fd, tmp = tempfile.mkstemp(dir=compact_path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(tree, f, separators=(",", ":"))
        except Exception:
            os.unlink(tmp)
            raise
        os.replace(tmp, compact_path)
    except Exception as exc:
        print(f"[mitre] Parse failed: {exc}", flush=True)
        _write_status({"state": "error", "error": str(exc)})
        return

    total = sum(len(t["techniques"]) for t in tree["tactics"])
    size_kb = compact_path.stat().st_size // 1024
    print(f"[mitre] Done — {total} techniques, {size_kb} KB compact cache", flush=True)
    _write_status({"state": "ready"})


# ── MITRE data endpoints ──────────────────────────────────────────────────────

@router.get("/mitre/status")
def mitre_status(current_user: User = Depends(get_current_user)) -> dict:
    compact = _compact_path()
    status_p = _status_path()

    # Check ongoing download — guard against transient empty file during atomic write
    if status_p.is_file():
        try:
            raw = status_p.read_text(encoding="utf-8").strip()
            status = json.loads(raw) if raw else {}
        except (json.JSONDecodeError, OSError):
            status = {}
        if status.get("state") == "downloading":
            return {"available": False, "state": "downloading", "version": None, "technique_count": 0}
        if status.get("state") == "error":
            return {"available": False, "state": "error", "error": status.get("error"), "technique_count": 0}

    if not compact.is_file():
        return {"available": False, "state": "not_downloaded", "version": None, "technique_count": 0}

    tree = json.loads(compact.read_text())
    total = sum(len(t["techniques"]) for t in tree["tactics"])
    return {
        "available":       True,
        "state":           "ready",
        "version":         tree.get("version"),
        "technique_count": total,
    }


@router.post("/mitre/download")
def mitre_download(
    bg: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger a background download / re-download of the ATT&CK Enterprise STIX bundle.

    Safe to call even when data is already available — rewrites the compact cache.
    """
    # Mark as downloading immediately (atomic) so callers see the state change right away
    _write_status({"state": "downloading"})
    bg.add_task(_download_and_cache)
    return {"status": "download_started"}


@router.delete("/mitre/cache")
def mitre_reset_cache(current_user: User = Depends(get_current_user)) -> dict:
    """Delete the local ATT&CK cache files so a fresh download can start.

    Useful when the download state is stuck (e.g. the server was killed
    mid-download and the status file still shows 'downloading').
    """
    compact  = _compact_path()
    status_p = _status_path()
    removed: list[str] = []
    if compact.is_file():
        compact.unlink()
        removed.append("compact")
    if status_p.is_file():
        status_p.unlink()
        removed.append("status")
    print(f"[mitre] Cache reset — removed: {removed}", flush=True)
    return {"reset": True, "removed": removed}


@router.get("/mitre/techniques")
def mitre_techniques(current_user: User = Depends(get_current_user)) -> dict:
    """Return the compact technique tree (cached locally after first download)."""
    compact = _compact_path()
    if not compact.is_file():
        raise HTTPException(status_code=404, detail="MITRE ATT&CK data not yet downloaded.")
    return json.loads(compact.read_text())


# ── Case TTP schemas ──────────────────────────────────────────────────────────

class TTPIn(BaseModel):
    technique_id:   str
    technique_name: str | None = None
    tactic:         str | None = None
    tactic_name:    str | None = None
    color:          str | None = None
    score:          int | None = None
    comment:        str | None = None


class TTPUpdate(BaseModel):
    color:   str | None = None
    score:   int | None = None
    comment: str | None = None


# ── Case TTP endpoints ────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/ttp")
def list_ttps(
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    rows = db.query(CaseTTP).filter(CaseTTP.case_id == case_id).all()
    return [
        {
            "id":             r.id,
            "technique_id":   r.technique_id,
            "technique_name": r.technique_name,
            "tactic":         r.tactic,
            "tactic_name":    r.tactic_name,
            "color":          r.color,
            "score":          r.score,
            "comment":        r.comment,
            "created_at":     r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/cases/{case_id}/ttp", status_code=201)
def add_ttp(
    case_id: str,
    body: TTPIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Check for duplicate (case_id, technique_id, tactic)
    existing = (
        db.query(CaseTTP)
        .filter(
            CaseTTP.case_id      == case_id,
            CaseTTP.technique_id == body.technique_id,
            CaseTTP.tactic       == (body.tactic or ""),
        )
        .first()
    )
    if existing:
        return {"id": existing.id, "technique_id": existing.technique_id, "already_exists": True}

    ttp = CaseTTP(
        id             = str(uuid.uuid4()),
        case_id        = case_id,
        technique_id   = body.technique_id,
        technique_name = body.technique_name,
        tactic         = body.tactic or "",
        tactic_name    = body.tactic_name,
        color          = body.color,
        score          = body.score,
        comment        = body.comment,
    )
    db.add(ttp)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(CaseTTP)
            .filter(
                CaseTTP.case_id      == case_id,
                CaseTTP.technique_id == body.technique_id,
                CaseTTP.tactic       == (body.tactic or ""),
            )
            .first()
        )
        return {"id": existing.id if existing else "", "technique_id": body.technique_id, "already_exists": True}

    db.refresh(ttp)
    return {"id": ttp.id, "technique_id": ttp.technique_id}


@router.put("/cases/{case_id}/ttp/{ttp_id}")
def update_ttp(
    case_id: str,
    ttp_id:  str,
    body:    TTPUpdate,
    db:      Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    ttp = db.query(CaseTTP).filter(CaseTTP.id == ttp_id, CaseTTP.case_id == case_id).first()
    if not ttp:
        raise HTTPException(status_code=404, detail="TTP not found")
    if body.color   is not None: ttp.color   = body.color
    if body.score   is not None: ttp.score   = body.score
    if body.comment is not None: ttp.comment = body.comment
    db.commit()
    return {"id": ttp.id, "technique_id": ttp.technique_id}


# NOTE: static-segment routes ("by-tech", "layer") MUST be declared before
# path-param routes ("/{ttp_id}") so FastAPI matches them first.

@router.delete("/cases/{case_id}/ttp/by-tech/{technique_id}")
def delete_ttp_by_tech(
    case_id:      str,
    technique_id: str,
    tactic:       str = "",
    db:           Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    """Remove a TTP by technique_id (+ optional tactic), used by the toggle UX."""
    q = db.query(CaseTTP).filter(
        CaseTTP.case_id      == case_id,
        CaseTTP.technique_id == technique_id,
    )
    if tactic:
        q = q.filter(CaseTTP.tactic == tactic)
    q.delete(synchronize_session=False)
    db.commit()
    return Response(status_code=204)


@router.delete("/cases/{case_id}/ttp/{ttp_id}")
def delete_ttp(
    case_id: str,
    ttp_id:  str,
    db:      Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    ttp = db.query(CaseTTP).filter(CaseTTP.id == ttp_id, CaseTTP.case_id == case_id).first()
    if not ttp:
        raise HTTPException(status_code=404, detail="TTP not found")
    db.delete(ttp)
    db.commit()
    return Response(status_code=204)


# ── Navigator layer export / import ──────────────────────────────────────────

@router.get("/cases/{case_id}/ttp/layer")
def export_layer(
    case_id: str,
    db:      Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Export case TTPs as an ATT&CK Navigator v4 layer JSON."""
    ttps = db.query(CaseTTP).filter(CaseTTP.case_id == case_id).all()

    techniques = []
    seen: set[str] = set()
    for t in ttps:
        key = f"{t.technique_id}|{t.tactic}"
        if key in seen:
            continue
        seen.add(key)
        entry: dict[str, Any] = {
            "techniqueID": t.technique_id,
            "tactic":      t.tactic or "",
            "enabled":     True,
            "showSubtechniques": False,
        }
        if t.color:   entry["color"]   = t.color
        if t.score is not None: entry["score"] = t.score
        if t.comment: entry["comment"] = t.comment
        techniques.append(entry)

    return {
        "name": f"Remora — Case {case_id[:8]}",
        "versions": {"attack": "16", "navigator": "4.10", "layer": "4.5"},
        "domain": "enterprise-attack",
        "description": f"TTPs extracted from Remora case {case_id}",
        "filters": {"platforms": ["Windows", "Linux", "macOS"]},
        "sorting": 0,
        "layout": {"layout": "side", "showID": True, "showName": True, "showAggregateScores": False, "countUnscored": False, "aggregateFunction": "average"},
        "hideDisabled": False,
        "techniques": techniques,
        "gradient": {
            "colors": ["#ffffff00", "#4ade80ff"],
            "minValue": 0,
            "maxValue": 100,
        },
        "legendItems": [],
        "metadata": [],
        "links": [],
        "showTacticRowBackground": True,
        "tacticRowBackground": "#0d1117",
        "selectTechniquesAcrossTactics": True,
        "selectSubtechniquesWithParent": False,
    }


class LayerImport(BaseModel):
    layer: dict


@router.post("/cases/{case_id}/ttp/import-layer", status_code=201)
def import_layer(
    case_id: str,
    body:    LayerImport,
    db:      Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Import techniques from an ATT&CK Navigator layer JSON."""
    techniques = body.layer.get("techniques", [])
    added = 0
    for t in techniques:
        tid   = t.get("techniqueID", "")
        tactic = t.get("tactic", "")
        if not tid:
            continue
        existing = db.query(CaseTTP).filter(
            CaseTTP.case_id      == case_id,
            CaseTTP.technique_id == tid,
            CaseTTP.tactic       == tactic,
        ).first()
        if existing:
            continue
        ttp = CaseTTP(
            id           = str(uuid.uuid4()),
            case_id      = case_id,
            technique_id = tid,
            tactic       = tactic,
            color        = t.get("color"),
            score        = t.get("score"),
            comment      = t.get("comment"),
        )
        db.add(ttp)
        added += 1

    db.commit()
    return {"added": added}
