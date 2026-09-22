"""
Disk image router — /api/v1/cases/{case_id}/disk-images

FTK Imager-style read-only browsing of forensic images (E01, VMDK, VHDX, raw…)
sitting on a mounted volume.

Everything here is scoped to a case. An image is browsed through a registration
that says this case works on these bytes, so the caller names an image the case
has claimed rather than a filesystem path - which is both the chain-of-custody
record that was missing and one fewer analyst-supplied path reaching the
filesystem. `resolve` re-validates the stored path against the configured roots
on every request, so narrowing the roots takes effect immediately.

The only case-free endpoint left is `/disk-images/status`, which reports
whether image exploration is usable at all.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..services import disk_image_registry as registry
from ..services import diskimage as di
from ..services.audit_service import audit_log

router = APIRouter(tags=["disk-images"])


def _guard(fn, *args, **kwargs):
    """Run a service call, mapping its errors to a 400 with the real reason."""
    try:
        return fn(*args, **kwargs)
    except di.DiskImageError as e:
        raise HTTPException(400, str(e))
    except ImportError:
        raise HTTPException(
            503, "dissect.target is not installed in the backend image")
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


def _get_case_or_404(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return case


def _open(case_id: str, image_id: str, db: Session) -> tuple[str, Path]:
    """The registered image's name and path, or a 404 naming what is wrong."""
    case = _get_case_or_404(case_id, db)
    try:
        image, path = registry.resolve(db, case_id=case.id, image_id=image_id)
    except registry.RegistrationError as e:
        # 404, not 403: an image the case never claimed and an image whose
        # volume was unmounted are both "not here", and the message says which.
        raise HTTPException(404, str(e))
    return image.name, path


# ─── Capability ───────────────────────────────────────────────────────────────

@router.get("/disk-images/status")
def image_status(current_user=Depends(get_current_user)):
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


# ─── Registration ─────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/disk-images/available")
def list_available(
    case_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Images on the volume this case has not registered yet - the picker."""
    _get_case_or_404(case_id, db)
    return {"images": _guard(registry.available_for_case, db, case_id)}


@router.get("/cases/{case_id}/disk-images")
def list_images(
    case_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Images registered on this case."""
    _get_case_or_404(case_id, db)
    return {"images": registry.list_for_case(db, case_id)}


@router.post("/cases/{case_id}/disk-images", status_code=status.HTTP_201_CREATED)
def register_image(
    case_id: str,
    path: str = Body(..., embed=True, description="Absolute path under a configured root"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Attach an image to this case. Copies nothing - it records a claim."""
    case = _get_case_or_404(case_id, db)
    try:
        image = registry.register(
            db, case_id=case.id, raw_path=path,
            username=getattr(current_user, "username", None))
    except registry.RegistrationError as e:
        raise HTTPException(400, str(e))

    audit_log(db, user=current_user, action="disk_image.register",
              resource_type="disk_image", resource_id=image.id,
              resource_name=image.name,
              case_id=case.id, case_title=case.title,
              details={"path": image.path, "size": image.size_bytes})
    db.commit()
    return registry.to_dict(image)


@router.delete("/cases/{case_id}/disk-images/{image_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def unregister_image(
    case_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Remove this case's claim on an image.

    The file is left exactly where it is. This endpoint never deletes evidence,
    which is why it does not ask for the confirmation that deleting one does.
    """
    case  = _get_case_or_404(case_id, db)
    image = next((i for i in case.disk_images if i.id == image_id), None)
    if not image:
        raise HTTPException(404, "This image is not registered on this case")

    audit_log(db, user=current_user, action="disk_image.unregister",
              resource_type="disk_image", resource_id=image.id,
              resource_name=image.name,
              case_id=case.id, case_title=case.title,
              details={"path": image.path})
    db.delete(image)
    db.commit()


# ─── Browsing ─────────────────────────────────────────────────────────────────

@router.get("/cases/{case_id}/disk-images/{image_id}/partitions")
def get_partitions(
    case_id: str,
    image_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Partition table — the left pane's top level."""
    _, image = _open(case_id, image_id, db)
    return {"image_id": image_id, "partitions": _guard(di.partitions, image)}


@router.get("/cases/{case_id}/disk-images/{image_id}/list")
def list_directory(
    case_id: str,
    image_id: str,
    partition: int = Query(0),
    dir: str = Query("/", description="Directory inside the filesystem"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """One directory level — the top-right pane."""
    _, image = _open(case_id, image_id, db)
    return {
        "image_id":  image_id,
        "partition": partition,
        "dir":       dir,
        "entries":   _guard(di.list_dir, image, partition, dir),
    }


@router.get("/cases/{case_id}/disk-images/{image_id}/preview")
def preview_file(
    case_id: str,
    image_id: str,
    partition: int = Query(0),
    file: str = Query(...),
    offset: int = Query(0, ge=0),
    length: int = Query(4096, ge=1),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    A slice of a file as hex — the bottom-right pane.

    Bytes are hex-encoded rather than decoded server-side: the viewer renders
    both the hex and the ASCII column, and a forensic preview must never
    silently mangle bytes that are not valid text.
    """
    _, image = _open(case_id, image_id, db)
    data, total = _guard(di.read_file, image, partition, file, offset, length)
    return {
        "file":   file,
        "offset": offset,
        "length": len(data),
        "total":  total,
        "hex":    data.hex(),
    }


@router.get("/cases/{case_id}/disk-images/{image_id}/hash")
def hash_file(
    case_id: str,
    image_id: str,
    partition: int = Query(0),
    file: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """MD5 + SHA-256 of a file inside the image."""
    _, image = _open(case_id, image_id, db)
    return _guard(di.hash_file, image, partition, file)


@router.get("/cases/{case_id}/disk-images/{image_id}/download")
def download_file(
    case_id: str,
    image_id: str,
    partition: int = Query(0),
    file: str = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Stream a file out of the image, without ever buffering it whole."""
    _, image = _open(case_id, image_id, db)
    gen = _guard(di.stream_file, image, partition, file)
    name = Path(file).name or "extracted.bin"
    return StreamingResponse(
        gen,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


# ─── Extraction into a case ───────────────────────────────────────────────────

@router.post("/cases/{case_id}/disk-images/{image_id}/extract")
def extract_to_case(
    case_id: str,
    image_id: str,
    partition: int = Body(0, embed=True),
    file: str = Body(..., embed=True, description="Path inside the image"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Carve a file out of the image into the case's drop folder.

    Landing it in the drop folder means the existing ingestion pipeline treats
    it exactly like any other dropped artifact — a carved EVTX or CSV is parsed
    and routed automatically, with no separate code path.
    """
    case = _get_case_or_404(case_id, db)
    name, image = _open(case_id, image_id, db)

    from ..services.dropzone import case_dropzone_dir
    result = _guard(di.extract_to, image, partition, file, case_dropzone_dir(case))

    audit_log(db, user=current_user, action="disk_image.extract",
              resource_type="disk_image", resource_id=image_id,
              resource_name=result["filename"],
              case_id=case.id, case_title=case.title,
              details={"image": name, "source": file,
                       "sha256": result["sha256"], "partition": partition})
    db.commit()

    return {
        **result,
        "message": "File extracted into the case drop folder - it will be "
                   "ingested automatically if it is a recognised artifact",
    }
