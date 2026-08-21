"""
Disk image router — /api/v1/disk-images

FTK Imager-style read-only browsing of forensic images (E01, VMDK, VHDX, raw…)
sitting on a mounted volume. Every path the caller supplies is validated against
the configured roots before anything is opened.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..services import diskimage as di
from ..services.audit_service import audit_log

router = APIRouter(tags=["disk-images"])


def _resolve(path: str) -> Path:
    try:
        return di.resolve_image_path(path)
    except di.DiskImageError as e:
        raise HTTPException(400, str(e))


def _guard(fn, *args, **kwargs):
    """Run a service call, mapping its errors to a 400 with the real reason."""
    try:
        return fn(*args, **kwargs)
    except di.DiskImageError as e:
        raise HTTPException(400, str(e))
    except ImportError:
        raise HTTPException(
            503, "dissect.target n'est pas installé dans l'image backend")
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


# ─── Discovery ────────────────────────────────────────────────────────────────

@router.get("/disk-images/status")
def status(current_user=Depends(get_current_user)):
    """Whether image exploration is usable, for UI capability checks."""
    try:
        import dissect.target  # noqa: F401
        available = True
    except ImportError:
        available = False

    roots = di.allowed_roots()
    return {
        "available":      available,
        "roots":          [str(r) for r in roots],
        "configured":     bool(roots),
        "supported_exts": sorted(di.IMAGE_EXTS),
        "max_read_bytes": di.MAX_READ_BYTES,
        # Where the analyst should drop images from their own machine
        "host_path":      str(settings.disk_images_host_path or ""),
    }


@router.get("/disk-images")
def list_images(current_user=Depends(get_current_user)):
    """Images found under the configured roots."""
    return {"images": _guard(di.list_images)}


@router.get("/disk-images/partitions")
def get_partitions(
    path: str = Query(..., description="Absolute path to the image"),
    current_user=Depends(get_current_user),
):
    """Partition table — the left pane's top level."""
    image = _resolve(path)
    return {"path": str(image), "partitions": _guard(di.partitions, image)}


# ─── Browsing ─────────────────────────────────────────────────────────────────

@router.get("/disk-images/list")
def list_directory(
    path: str = Query(...),
    partition: int = Query(0),
    dir: str = Query("/", description="Directory inside the filesystem"),
    current_user=Depends(get_current_user),
):
    """One directory level — the top-right pane."""
    image = _resolve(path)
    return {
        "path":      str(image),
        "partition": partition,
        "dir":       dir,
        "entries":   _guard(di.list_dir, image, partition, dir),
    }


@router.get("/disk-images/preview")
def preview_file(
    path: str = Query(...),
    partition: int = Query(0),
    file: str = Query(...),
    offset: int = Query(0, ge=0),
    length: int = Query(4096, ge=1),
    current_user=Depends(get_current_user),
):
    """
    A slice of a file as hex — the bottom-right pane.

    Bytes are hex-encoded rather than decoded server-side: the viewer renders
    both the hex and the ASCII column, and a forensic preview must never
    silently mangle bytes that are not valid text.
    """
    image = _resolve(path)
    data, total = _guard(di.read_file, image, partition, file, offset, length)
    return {
        "file":   file,
        "offset": offset,
        "length": len(data),
        "total":  total,
        "hex":    data.hex(),
    }


@router.get("/disk-images/hash")
def hash_file(
    path: str = Query(...),
    partition: int = Query(0),
    file: str = Query(...),
    current_user=Depends(get_current_user),
):
    """MD5 + SHA-256 of a file inside the image."""
    image = _resolve(path)
    return _guard(di.hash_file, image, partition, file)


@router.get("/disk-images/download")
def download_file(
    path: str = Query(...),
    partition: int = Query(0),
    file: str = Query(...),
    current_user=Depends(get_current_user),
):
    """Stream a file out of the image, without ever buffering it whole."""
    image = _resolve(path)
    gen = _guard(di.stream_file, image, partition, file)
    name = Path(file).name or "extrait.bin"
    return StreamingResponse(
        gen,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ─── Extraction into a case ───────────────────────────────────────────────────

@router.post("/cases/{case_id}/disk-images/extract")
def extract_to_case(
    case_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Carve a file out of the image into the case's drop folder.

    Landing it in the drop folder means the existing ingestion pipeline treats
    it exactly like any other dropped artifact — a carved EVTX or CSV is parsed
    and routed automatically, with no separate code path.

    Body: {"path": "...", "partition": 0, "file": "/Windows/.../file.evtx"}
    """
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case introuvable")

    image = _resolve(body.get("path", ""))
    file_path = body.get("file") or ""
    if not file_path:
        raise HTTPException(400, "Champ 'file' manquant")
    partition = int(body.get("partition", 0))

    from ..services.dropzone import case_dropzone_dir
    dest_dir = case_dropzone_dir(case)

    result = _guard(di.extract_to, image, partition, file_path, dest_dir)

    audit_log(db, user=current_user, action="disk_image.extract",
              resource_type="disk_image", resource_id=str(image),
              resource_name=result["filename"],
              case_id=case_id, case_title=case.title,
              details={"source": file_path, "sha256": result["sha256"],
                       "partition": partition})
    db.commit()

    return {
        **result,
        "message": "Fichier extrait dans le drop folder du case — "
                   "il sera ingéré automatiquement s'il s'agit d'un artefact reconnu",
    }
