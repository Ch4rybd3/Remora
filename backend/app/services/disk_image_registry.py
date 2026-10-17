"""
Which images a case works on.

`diskimage.py` knows how to open bytes; this module knows whose bytes they are.
The split matters because the two answer to different things: the first to what
`dissect.target` can parse, the second to the chain of custody.

Registration is a claim, never a copy. Nothing here writes, moves or deletes an
image - the file stays on the mounted volume, owned by whoever put it there.
Unregistering removes the case's claim and leaves the bytes untouched, which is
why it needs no confirmation of the kind deleting evidence does.
"""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ..models.disk_image import DiskImage
from . import diskimage as di


class RegistrationError(Exception):
    """A registration that cannot be honoured, with the reason for the analyst."""


def _stat(path: Path) -> tuple[int, str]:
    try:
        return path.stat().st_size, path.suffix.lower().lstrip(".")
    except OSError:
        return 0, path.suffix.lower().lstrip(".")


def to_dict(image: DiskImage) -> dict:
    """
    An image row for the API, with liveness resolved at read time.

    `available` is computed rather than stored for the same reason the artifact
    list computes it: a volume can be unmounted between two requests, and a
    cached "yes" would send the analyst into a browser that cannot open
    anything. The registration survives the volume going away - remounting it
    makes the image usable again without re-registering.
    """
    path = Path(image.path)
    return {
        "id":            image.id,
        "case_id":       image.case_id,
        "path":          image.path,
        "name":          image.name,
        "size":          image.size_bytes,
        "format":        image.image_format,
        "registered_at": image.registered_at.isoformat() if image.registered_at else None,
        "registered_by": image.registered_by,
        "available":     path.is_file(),
    }


def list_for_case(db: Session, case_id: str) -> list[dict]:
    rows = (
        db.query(DiskImage)
        .filter(DiskImage.case_id == case_id)
        .order_by(DiskImage.name)
        .all()
    )
    return [to_dict(r) for r in rows]


def available_for_case(db: Session, case_id: str) -> list[dict]:
    """
    Images on the volume this case has not claimed yet - the picker's contents.

    Filtered by what *this* case holds, not by what any case holds: the same
    acquisition can legitimately be registered to two investigations, and
    hiding an image because a different case already uses it would look like
    the file had disappeared.
    """
    claimed = {
        p for (p,) in db.query(DiskImage.path).filter(DiskImage.case_id == case_id)
    }
    return [img for img in di.list_images() if img["path"] not in claimed]


def register(db: Session, *, case_id: str, raw_path: str, username: str | None) -> DiskImage:
    """
    Attach an image found under a configured root to a case.

    The path is resolved through `diskimage.resolve_image_path`, so a caller
    cannot register something outside the roots and then browse it through the
    registration.
    """
    try:
        path = di.resolve_image_path(raw_path)
    except di.DiskImageError as exc:
        raise RegistrationError(str(exc)) from exc

    if not path.is_file():
        raise RegistrationError(f"'{path.name}' is not a file on the configured roots")

    existing = (
        db.query(DiskImage)
        .filter(DiskImage.case_id == case_id, DiskImage.path == str(path))
        .first()
    )
    if existing:
        raise RegistrationError(f"'{path.name}' is already registered on this case")

    size, fmt = _stat(path)
    image = DiskImage(
        case_id       = case_id,
        path          = str(path),
        name          = path.name,
        size_bytes    = size,
        image_format  = fmt,
        registered_at = datetime.now(UTC),
        registered_by = username,
    )
    db.add(image)
    db.flush()
    return image


def resolve(db: Session, *, case_id: str, image_id: str) -> tuple[DiskImage, Path]:
    """
    The registration and the path to open, or a `RegistrationError`.

    Every browse request goes through here. Re-validating the stored path
    against the roots on each call is deliberate: roots are configuration, an
    operator can narrow them, and a row written under the old configuration
    must not keep granting access after that.
    """
    image = (
        db.query(DiskImage)
        .filter(DiskImage.id == image_id, DiskImage.case_id == case_id)
        .first()
    )
    if not image:
        raise RegistrationError("This image is not registered on this case")

    # Checked before the roots are consulted, purely so the analyst gets the
    # actionable message. `resolve_image_path` collapses "outside the roots"
    # and "not on disk" into one generic refusal, and those are very different
    # problems: one is a configuration change, the other an unmounted volume.
    # Root validation still runs below - nothing is opened on the strength of
    # this branch.
    stored = str(image.path)
    if not Path(stored).is_file():
        raise RegistrationError(
            f"'{image.name}' is registered but its file is no longer on the volume. "
            f"Remount it, or remove the image from this case.")

    try:
        return image, di.resolve_image_path(stored)
    except di.DiskImageError as exc:
        raise RegistrationError(
            f"'{image.name}' is registered but is no longer reachable: {exc}") from exc
