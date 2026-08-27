"""
Memory dump upload and Volatility3 analysis API.

Flow:
  POST /memory/{case_id}/upload  → saves dump, queues default plugins in background
  GET  /memory/{case_id}/dumps   → list dumps for a case
  GET  /memory/{case_id}/dumps/{dump_id}/plugins → list plugin results
  POST /memory/{case_id}/dumps/{dump_id}/run     → run a custom plugin
  POST /memory/{case_id}/dumps/{dump_id}/plugins/{plugin_id}/rerun → re-run a plugin

Volatility3 binary detection priority: vol → vol3 → python3 -m volatility3
Output is capped at 500 KB with a truncation notice appended.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.memory import MemoryDump, MemoryPluginResult
from ..models.user import User
from ..schemas.memory import MemoryDumpOut, MemoryPluginResultOut, RunPluginPayload
from ..services.audit_service import audit_log

router = APIRouter(prefix="/memory", tags=["memory"])

# ── Storage ───────────────────────────────────────────────────────────────────

MEMORY_DIR = settings.evidence_store_path.parent / "memory"
OUTPUT_CAP = 500 * 1024   # 500 KB

# ── Default plugins per OS ────────────────────────────────────────────────────

DEFAULT_PLUGINS: dict[str, list[str]] = {
    "windows": [
        "windows.info",
        "windows.pslist",
        "windows.pstree",
        "windows.psscan",
        "windows.cmdline",
        "windows.netscan",
        "windows.netstat",
        "windows.dlllist",
        "windows.malfind",
        "windows.handles",
        "windows.filescan",
        "windows.registry.hivelist",
    ],
    "linux": [
        "linux.bash",
        "linux.pslist",
        "linux.pstree",
        "linux.psscan",
        "linux.sockstat",
        "linux.lsof",
        "linux.proc_maps",
        "linux.check_modules",
    ],
}

# ── Volatility3 binary resolution ─────────────────────────────────────────────

def _find_vol() -> list[str] | None:
    """Return the Volatility3 invocation prefix, or None if not found.

    Priority:
      1. vol / vol3 binaries on PATH (standalone installs)
      2. sys.executable -m volatility3  ← same venv as FastAPI → guaranteed access
      3. python3 / python on PATH as last resort
    """
    for candidate in ("vol", "vol3"):
        if shutil.which(candidate):
            return [candidate]
    # Use the *same* interpreter that is running FastAPI so venv packages are available
    try:
        subprocess.run(
            [sys.executable, "-m", "volatility3", "--help"],
            capture_output=True, timeout=10,
        )
        return [sys.executable, "-m", "volatility3"]
    except Exception:
        pass
    # Last resort: system python (may not have volatility3)
    for py in ("python3", "python"):
        if shutil.which(py):
            return [py, "-m", "volatility3"]
    return None


def _vol_cmd(vol: list[str], dump_path: str, symbols_path: str | None,
             plugin: str, args: dict[str, Any] | None) -> list[str]:
    """Build the full Volatility3 command list."""
    cmd = vol + ["-f", dump_path]
    if symbols_path:
        cmd += ["--symbol-dirs", symbols_path]
    cmd.append(plugin)
    if args:
        for k, v in args.items():
            if v is not None and v != "":
                cmd += [f"--{k}", str(v)]
    return cmd


# ── DB helpers ────────────────────────────────────────────────────────────────

def _dump_dir(case_id: str) -> Path:
    d = MEMORY_DIR / case_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _get_dump_or_404(dump_id: str, case_id: str, db: Session) -> MemoryDump:
    dump = db.query(MemoryDump).filter(
        MemoryDump.id == dump_id,
        MemoryDump.case_id == case_id,
    ).first()
    if not dump:
        raise HTTPException(404, "Memory dump not found")
    return dump


def _get_plugin_or_404(plugin_id: int, dump_id: str, db: Session) -> MemoryPluginResult:
    p = db.query(MemoryPluginResult).filter(
        MemoryPluginResult.id == plugin_id,
        MemoryPluginResult.dump_id == dump_id,
    ).first()
    if not p:
        raise HTTPException(404, "Plugin result not found")
    return p


# ── Background runner ─────────────────────────────────────────────────────────

def _run_plugins_background(dump_id: str, plugin_ids: list[int]) -> None:
    """
    Run a list of queued plugin results sequentially.
    Each plugin result row must already exist in DB with status='pending'.
    """
    from ..database import SessionLocal

    db = SessionLocal()
    try:
        dump = db.query(MemoryDump).filter(MemoryDump.id == dump_id).first()
        if not dump:
            return

        dump.status = "analyzing"
        db.commit()

        vol = _find_vol()

        for pid in plugin_ids:
            pr = db.query(MemoryPluginResult).filter(MemoryPluginResult.id == pid).first()
            if not pr:
                continue

            pr.status     = "running"
            pr.started_at = datetime.now(UTC)
            db.commit()

            if vol is None:
                pr.status = "error"
                pr.error  = (
                    "Volatility3 not found. Install it with:\n"
                    "  pip install volatility3\n"
                    "or ensure 'vol' / 'vol3' is on PATH."
                )
                pr.completed_at = datetime.now(UTC)
                db.commit()
                continue

            cmd = _vol_cmd(vol, dump.file_path, dump.symbols_path,
                           pr.plugin_name, pr.plugin_args)
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=300
                )
                raw_out = result.stdout or ""
                raw_err = result.stderr or ""

                # Cap output at 500 KB
                if len(raw_out.encode()) > OUTPUT_CAP:
                    raw_out = raw_out.encode()[:OUTPUT_CAP].decode(errors="replace")
                    raw_out += "\n\n[OUTPUT TRUNCATED — exceeded 500 KB]"

                if result.returncode == 0 or raw_out.strip():
                    pr.status = "done"
                    pr.output = raw_out or "(no output)"
                    pr.error  = raw_err if raw_err.strip() else None
                else:
                    pr.status = "error"
                    pr.error  = raw_err or f"Process exited with code {result.returncode}"
                    pr.output = raw_out if raw_out.strip() else None

            except subprocess.TimeoutExpired:
                pr.status = "error"
                pr.error  = "Plugin timed out after 300 seconds."
            except Exception as exc:
                pr.status = "error"
                pr.error  = str(exc)

            pr.completed_at = datetime.now(UTC)
            db.commit()

        # Update dump status
        results = (
            db.query(MemoryPluginResult)
            .filter(MemoryPluginResult.dump_id == dump_id,
                    MemoryPluginResult.is_custom == False)  # noqa: E712
            .all()
        )
        if all(r.status in ("done", "error") for r in results):
            dump.status = "done"
            db.commit()

    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=MemoryDumpOut)
async def upload_dump(
    case_id:          str,
    background_tasks: BackgroundTasks,
    file:             UploadFile = File(...),
    os_type:          str        = Form(...),      # "windows" | "linux"
    symbols_file:     UploadFile | None = File(None),
    db:               Session    = Depends(get_db),
    current_user:     User       = Depends(get_current_user),
):
    """Upload a memory dump and auto-queue default plugins."""
    case = _get_case_or_404(case_id, db)

    if os_type not in ("windows", "linux"):
        raise HTTPException(400, "os_type must be 'windows' or 'linux'")
    if not file.filename:
        raise HTTPException(400, "No filename provided")

    dest_dir  = _dump_dir(case_id)
    dump_id   = str(uuid.uuid4())
    safe_name = f"{dump_id}_{Path(file.filename).name}"
    dest_path = dest_dir / safe_name

    contents = await file.read()
    dest_path.write_bytes(contents)

    # Optional symbols file
    symbols_path: str | None = None
    if symbols_file and symbols_file.filename:
        sym_safe = f"{dump_id}_symbols_{Path(symbols_file.filename).name}"
        sym_path = dest_dir / sym_safe
        sym_contents = await symbols_file.read()
        sym_path.write_bytes(sym_contents)
        symbols_path = str(sym_path)

    dump = MemoryDump(
        id           = dump_id,
        case_id      = case_id,
        filename     = file.filename,
        file_path    = str(dest_path),
        os_type      = os_type,
        symbols_path = symbols_path,
        file_size    = len(contents),
        status       = "uploaded",
    )
    db.add(dump)
    db.flush()   # get dump.id

    # Create pending plugin rows for default plugins
    plugin_ids: list[int] = []
    for plugin_name in DEFAULT_PLUGINS.get(os_type, []):
        pr = MemoryPluginResult(
            dump_id     = dump_id,
            plugin_name = plugin_name,
            status      = "pending",
            is_custom   = False,
        )
        db.add(pr)
        db.flush()
        plugin_ids.append(pr.id)

    audit_log(db, user=current_user, action="memory.upload",
              resource_type="memory_dump", resource_id=dump_id,
              resource_name=file.filename, case_id=case_id,
              case_title=getattr(case, "title", None),
              details={"os_type": os_type, "size": len(contents)})
    db.commit()
    db.refresh(dump)

    background_tasks.add_task(_run_plugins_background, dump_id, plugin_ids)
    return dump


@router.get("/{case_id}/dumps", response_model=list[MemoryDumpOut])
def list_dumps(case_id: str, db: Session = Depends(get_db)):
    _get_case_or_404(case_id, db)
    return (
        db.query(MemoryDump)
        .filter(MemoryDump.case_id == case_id)
        .order_by(MemoryDump.uploaded_at.desc())
        .all()
    )


@router.get("/{case_id}/dumps/{dump_id}", response_model=MemoryDumpOut)
def get_dump(case_id: str, dump_id: str, db: Session = Depends(get_db)):
    return _get_dump_or_404(dump_id, case_id, db)


@router.delete("/{case_id}/dumps/{dump_id}", status_code=204)
def delete_dump(
    case_id:      str,
    dump_id:      str,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    dump = _get_dump_or_404(dump_id, case_id, db)
    case = _get_case_or_404(case_id, db)
    audit_log(db, user=current_user, action="memory.delete",
              resource_type="memory_dump", resource_id=dump_id,
              resource_name=dump.filename, case_id=case_id,
              case_title=getattr(case, "title", None))
    try:
        Path(dump.file_path).unlink(missing_ok=True)
        if dump.symbols_path:
            Path(dump.symbols_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(dump)
    db.commit()


@router.get("/{case_id}/dumps/{dump_id}/plugins",
            response_model=list[MemoryPluginResultOut])
def list_plugins(case_id: str, dump_id: str, db: Session = Depends(get_db)):
    _get_dump_or_404(dump_id, case_id, db)
    return (
        db.query(MemoryPluginResult)
        .filter(MemoryPluginResult.dump_id == dump_id)
        .order_by(MemoryPluginResult.id)
        .all()
    )


@router.post("/{case_id}/dumps/{dump_id}/run",
             response_model=MemoryPluginResultOut)
def run_custom_plugin(
    case_id:          str,
    dump_id:          str,
    payload:          RunPluginPayload,
    background_tasks: BackgroundTasks,
    db:               Session = Depends(get_db),
    current_user:     User    = Depends(get_current_user),
):
    """Queue a custom plugin run against an existing dump."""
    dump = _get_dump_or_404(dump_id, case_id, db)
    case = _get_case_or_404(case_id, db)

    pr = MemoryPluginResult(
        dump_id     = dump_id,
        plugin_name = payload.plugin_name,
        plugin_args = payload.plugin_args,
        status      = "pending",
        is_custom   = True,
    )
    db.add(pr)
    db.flush()

    audit_log(db, user=current_user, action="memory.run_plugin",
              resource_type="memory_dump", resource_id=dump_id,
              resource_name=dump.filename, case_id=case_id,
              case_title=getattr(case, "title", None),
              details={"plugin": payload.plugin_name, "args": payload.plugin_args})
    db.commit()
    db.refresh(pr)

    background_tasks.add_task(_run_plugins_background, dump_id, [pr.id])
    return pr


@router.post("/{case_id}/dumps/{dump_id}/plugins/{plugin_id}/rerun",
             response_model=MemoryPluginResultOut)
def rerun_plugin(
    case_id:          str,
    dump_id:          str,
    plugin_id:        int,
    background_tasks: BackgroundTasks,
    db:               Session = Depends(get_db),
    current_user:     User    = Depends(get_current_user),
):
    """Re-run a specific plugin (reset its result)."""
    _get_dump_or_404(dump_id, case_id, db)
    pr = _get_plugin_or_404(plugin_id, dump_id, db)

    pr.status       = "pending"
    pr.output       = None
    pr.error        = None
    pr.started_at   = None
    pr.completed_at = None
    db.commit()
    db.refresh(pr)

    background_tasks.add_task(_run_plugins_background, dump_id, [pr.id])
    return pr
