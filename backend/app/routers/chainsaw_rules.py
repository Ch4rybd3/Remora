"""
Chainsaw detection rules management.

Endpoints for listing built-in rules, managing custom rules,
and downloading SigmaHQ Windows rules.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile

from ..config import settings
from ..core.deps import get_current_user
from ..models.user import User

router = APIRouter(prefix="/chainsaw/rules", tags=["chainsaw-rules"])

# ── Directory helpers ─────────────────────────────────────────────────────────

def _install_dir() -> Path:
    return settings.evidence_store_path.parent / "chainsaw"


def _builtin_rules_dir() -> Path:
    return _install_dir() / "rules" / "evtx"


def _custom_rules_dir() -> Path:
    d = _install_dir() / "custom_rules"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _sigma_rules_dir() -> Path:
    return _install_dir() / "sigma_rules"


def _mapping_file() -> Path:
    return _install_dir() / "mappings" / "sigma-event-logs-all.yml"


# ── YAML rule parser ──────────────────────────────────────────────────────────

def _parse_rule_file(path: Path, base_dir: Path) -> dict[str, Any] | None:
    """Parse a YAML rule file and return a flat dict of metadata."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
        data = yaml.safe_load(text)
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    authors_raw = data.get("authors") or data.get("author") or []
    if isinstance(authors_raw, list):
        authors = ", ".join(str(a) for a in authors_raw)
    else:
        authors = str(authors_raw)

    try:
        rel = str(path.relative_to(base_dir))
    except ValueError:
        rel = path.name

    return {
        "filename":    path.name,
        "title":       str(data.get("title") or path.stem),
        "group":       str(data.get("group") or data.get("category") or ""),
        "level":       str(data.get("level") or "").lower(),
        "status":      str(data.get("status") or ""),
        "description": str(data.get("description") or ""),
        "authors":     authors,
        "kind":        str(data.get("kind") or ""),
        "path":        rel,
    }


def _scan_rules(directory: Path) -> list[dict[str, Any]]:
    """Scan a directory for .yml/.yaml rule files and parse each."""
    if not directory.is_dir():
        return []

    results: list[dict[str, Any]] = []
    for ext in ("*.yml", "*.yaml"):
        for p in directory.rglob(ext):
            parsed = _parse_rule_file(p, directory)
            if parsed:
                results.append(parsed)

    results.sort(key=lambda r: (r["group"].lower(), r["title"].lower()))
    return results


# ── Sigma background download ─────────────────────────────────────────────────

def _download_sigma_rules(sigma_dir: Path) -> None:
    """
    Download SigmaHQ Windows rules from GitHub and extract to sigma_dir.
    Runs in a background thread.
    """
    url = "https://github.com/SigmaHQ/sigma/archive/refs/heads/master.zip"
    print(f"[sigma] Starting download from {url}", flush=True)

    try:
        req  = Request(url, headers={"User-Agent": "remora-dfir/1.0", "Accept": "application/octet-stream"})
        with urlopen(req, timeout=300) as r:
            data = r.read()
    except (URLError, Exception) as exc:
        print(f"[sigma] Download failed: {exc}", flush=True)
        return

    print("[sigma] Download complete, extracting Windows rules…", flush=True)

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            # Prefix inside the zip: sigma-master/rules/windows/
            prefix = "sigma-master/rules/windows/"
            members = [m for m in zf.namelist() if m.startswith(prefix) and not m.endswith("/")]
            print(f"[sigma] Found {len(members)} rule files under {prefix}", flush=True)

            sigma_dir.mkdir(parents=True, exist_ok=True)

            for member in members:
                # Strip the prefix to get the relative path inside sigma_dir
                rel = member[len(prefix):]
                if not rel:
                    continue
                dest = sigma_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(member))

    except Exception as exc:
        print(f"[sigma] Extraction failed: {exc}", flush=True)
        return

    count = sum(1 for _ in sigma_dir.rglob("*.yml"))
    print(f"[sigma] Done — {count} rules installed to {sigma_dir}", flush=True)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/builtin")
def list_builtin_rules(
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """List all built-in Chainsaw native EVTX rules (read-only)."""
    return _scan_rules(_builtin_rules_dir())


@router.get("/custom")
def list_custom_rules(
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """List all user-uploaded custom rules."""
    custom_dir = _install_dir() / "custom_rules"
    if not custom_dir.is_dir():
        return []
    return _scan_rules(custom_dir)


@router.post("/custom/upload")
async def upload_custom_rules(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Upload one or more custom rule files (.yml / .yaml)."""
    custom_dir = _custom_rules_dir()
    saved: list[str] = []

    for upload in files:
        filename = upload.filename or ""
        if not filename.lower().endswith((".yml", ".yaml")):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type for '{filename}'. Only .yml and .yaml are accepted.",
            )
        dest = custom_dir / filename
        content = await upload.read()
        dest.write_bytes(content)
        saved.append(filename)

    return {"saved": saved}


@router.delete("/custom/{filename}")
def delete_custom_rule(
    filename: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Delete a custom rule file by filename."""
    custom_dir = _install_dir() / "custom_rules"
    target = custom_dir / filename

    # Prevent path traversal
    try:
        target.resolve().relative_to(custom_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"Rule file '{filename}' not found.")

    target.unlink()
    return {"deleted": filename}


@router.get("/sigma/status")
def sigma_status(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return SigmaHQ rules installation status."""
    sigma_dir = _sigma_rules_dir()
    installed = sigma_dir.is_dir() and any(sigma_dir.rglob("*.yml"))
    rule_count = sum(1 for _ in sigma_dir.rglob("*.yml")) if sigma_dir.is_dir() else 0
    return {
        "installed":   installed,
        "rule_count":  rule_count,
        "sigma_dir":   str(sigma_dir),
    }


@router.post("/sigma/download")
def sigma_download(
    bg: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Trigger a background download of SigmaHQ Windows rules from GitHub."""
    sigma_dir = _sigma_rules_dir()
    bg.add_task(_download_sigma_rules, sigma_dir)
    return {
        "status":  "download_started",
        "message": "SigmaHQ Windows rules download started in the background. Check back shortly.",
    }
