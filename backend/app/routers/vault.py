"""
Vault management — upload, list, update metadata, download and delete vault files.
A "vault" is any file (ZIP, PDF, DOCX, CSV, …) stored as a named artefact with
a description and optional tags for cross-case reference material.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.vault import Vault
from ..models.user import User
from ..core.deps import get_current_user
from ..config import settings

router = APIRouter(prefix="/vaults", tags=["vaults"])

# ── Storage ────────────────────────────────────────────────────────────────────

VAULT_DIR: Path = settings.evidence_store_path.parent / "vaults"
VAULT_DIR.mkdir(parents=True, exist_ok=True)

# ── Schemas ────────────────────────────────────────────────────────────────────

class VaultOut(BaseModel):
    id:          int
    name:        str
    description: str
    tags:        str
    file_name:   str
    file_size:   int
    mime_type:   str
    created_at:  datetime
    created_by:  Optional[str]

    model_config = {"from_attributes": True}


class VaultPatch(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    tags:        Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_name(filename: str) -> str:
    return re.sub(r"[^\w\-.]", "_", filename)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[VaultOut])
def list_vaults(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    return db.query(Vault).order_by(Vault.created_at.desc()).all()


@router.post("/upload", response_model=VaultOut)
async def upload_vault(
    name:         str        = Form(...),
    description:  str        = Form(""),
    tags:         str        = Form(""),
    file:         UploadFile = File(...),
    db:           Session    = Depends(get_db),
    current_user: User       = Depends(get_current_user),
):
    if not file.filename:
        raise HTTPException(400, "Filename is required")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "Uploaded file is empty")

    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe = _safe_name(file.filename)
    dest = VAULT_DIR / f"{ts}_{safe}"
    dest.write_bytes(file_bytes)

    vault = Vault(
        name=name.strip(),
        description=description.strip(),
        tags=tags.strip(),
        file_path=str(dest),
        file_name=file.filename,
        file_size=len(file_bytes),
        mime_type=file.content_type or "",
        created_by=current_user.username,
    )
    db.add(vault)
    db.commit()
    db.refresh(vault)
    print(f"[vault] Uploaded '{vault.name}' ({vault.file_size} bytes) by {current_user.username}", flush=True)
    return vault


@router.patch("/{vault_id}", response_model=VaultOut)
def update_vault(
    vault_id:     int,
    patch:        VaultPatch,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    vault = db.query(Vault).filter(Vault.id == vault_id).first()
    if not vault:
        raise HTTPException(404, "Vault not found")
    if patch.name is not None:
        vault.name = patch.name.strip()
    if patch.description is not None:
        vault.description = patch.description.strip()
    if patch.tags is not None:
        vault.tags = patch.tags.strip()
    db.commit()
    db.refresh(vault)
    return vault


@router.get("/{vault_id}/download")
def download_vault(
    vault_id:     int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """Download vault file with Content-Disposition: attachment."""
    vault = db.query(Vault).filter(Vault.id == vault_id).first()
    if not vault:
        raise HTTPException(404, "Vault not found")
    path = Path(vault.file_path)
    if not path.exists():
        raise HTTPException(410, "Vault file missing on disk")
    return FileResponse(
        path=str(path),
        filename=vault.file_name,
        media_type=vault.mime_type or "application/octet-stream",
    )


@router.get("/{vault_id}/view")
def view_vault(
    vault_id:     int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    """
    Serve vault file inline — no Content-Disposition: attachment.
    Used to embed PDFs in <iframe> and images in <img> within the Vault Browser.
    """
    from fastapi.responses import Response
    vault = db.query(Vault).filter(Vault.id == vault_id).first()
    if not vault:
        raise HTTPException(404, "Vault not found")
    path = Path(vault.file_path)
    if not path.exists():
        raise HTTPException(410, "Vault file missing on disk")
    media = vault.mime_type or "application/octet-stream"
    return Response(content=path.read_bytes(), media_type=media)


@router.delete("/{vault_id}")
def delete_vault(
    vault_id:     int,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    vault = db.query(Vault).filter(Vault.id == vault_id).first()
    if not vault:
        raise HTTPException(404, "Vault not found")
    try:
        Path(vault.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(vault)
    db.commit()
    print(f"[vault] Deleted vault {vault_id} by {current_user.username}", flush=True)
    return {"deleted": vault_id}
