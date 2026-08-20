"""
Disk image exploration — FTK Imager-style browsing of forensic images.

Images are opened read-only from configured root directories (a host bind
mount), never uploaded: a full E01 acquisition routinely runs to hundreds of
gigabytes, which an HTTP upload and a second copy inside the Docker volume
cannot reasonably handle.

Backed by dissect.target (Fox-IT), pure Python — no libtsk/libewf to compile.
Containers: E01/EWF, VMDK, VHD(X), QCOW2, VDI, raw and split images.
Filesystems: NTFS, exFAT, ExtFS, XFS, APFS, BTRFS and others.
"""
from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from ..config import settings

# Extensions offered when scanning the configured roots. `.001` covers split
# raw sets; dissect resolves the remaining segments on its own.
IMAGE_EXTS = {
    ".e01", ".ex01", ".s01",             # EWF / EnCase
    ".raw", ".dd", ".img", ".bin", ".001",
    ".vmdk", ".vhd", ".vhdx", ".vdi", ".qcow2", ".hdd",
}

# Preview/read ceiling — a single request must never try to page in a 4 GB file
MAX_READ_BYTES = 4 * 1024 * 1024
# Hashing walks the whole file; refuse silently-slow operations on huge ones
MAX_HASH_BYTES = 2 * 1024 * 1024 * 1024

_HASH_CHUNK = 1024 * 1024


class DiskImageError(RuntimeError):
    """Any failure to open or read an image, surfaced to the API layer."""


# ─── Allowed roots ────────────────────────────────────────────────────────────

def allowed_roots() -> list[Path]:
    """
    Directories images may be read from.

    Configured via DISK_IMAGE_PATHS (comma-separated). Everything outside these
    roots is refused, so the endpoint cannot be turned into an arbitrary
    file-read primitive against the container filesystem.
    """
    raw = str(settings.disk_image_paths or "").strip()
    roots: list[Path] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            p = Path(part).resolve()
        except OSError:
            continue
        if p.is_dir():
            roots.append(p)
    return roots


def resolve_image_path(raw_path: str) -> Path:
    """
    Validate a caller-supplied image path against the allowed roots.

    Resolves symlinks first: a link inside an allowed root pointing at /etc
    must not grant access to it.
    """
    if not raw_path:
        raise DiskImageError("Chemin d'image manquant")

    roots = allowed_roots()
    if not roots:
        raise DiskImageError(
            "Aucun répertoire d'images configuré — définissez DISK_IMAGE_PATHS "
            "et montez le volume correspondant"
        )

    try:
        candidate = Path(raw_path).resolve()
    except OSError as e:
        raise DiskImageError(f"Chemin invalide: {e}")

    for root in roots:
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if not candidate.is_file():
            raise DiskImageError("Image introuvable")
        return candidate

    raise DiskImageError("Chemin hors des répertoires autorisés")


def list_images() -> list[dict]:
    """Every candidate image found under the configured roots."""
    out: list[dict] = []
    for root in allowed_roots():
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            out.append({
                "path":     str(p),
                "name":     p.name,
                "root":     str(root),
                "rel_path": str(p.relative_to(root)),
                "size":     st.st_size,
                "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                "format":   p.suffix.lower().lstrip("."),
            })
    return out


# ─── Open image cache ─────────────────────────────────────────────────────────
# Opening an E01 parses its segment table and the filesystem metadata; doing
# that on every directory listing would make browsing unusable. Handles are
# kept open and reused, guarded by a lock since FastAPI serves requests from a
# thread pool.

@dataclass
class OpenImage:
    path:        Path
    container:   Any
    partitions:  list[dict] = field(default_factory=list)
    filesystems: dict[int, Any] = field(default_factory=dict)


_cache: dict[str, OpenImage] = {}
_cache_lock = threading.Lock()
_CACHE_MAX = 4


def _open_uncached(path: Path) -> OpenImage:
    from dissect.target import container, filesystem, volume

    try:
        disk = container.open(str(path))
    except Exception as e:
        raise DiskImageError(f"Format d'image non reconnu: {e}")

    img = OpenImage(path=path, container=disk)

    # A forensic acquisition normally carries a partition table; a raw dump of
    # a single volume does not, in which case the whole image is one filesystem.
    volumes: list[tuple[int, Any, int, int, Any]] = []
    try:
        vs = volume.open(disk)
        for v in vs.volumes:
            volumes.append((int(v.number), v, int(v.offset or 0), int(v.size or 0), v.type))
    except Exception:
        volumes.append((0, disk, 0, int(getattr(disk, "size", 0) or 0), None))

    for number, vol, offset, size, ptype in volumes:
        fs_type: str | None = None
        label: str | None = None
        try:
            fs = filesystem.open(vol)
            fs_type = getattr(fs, "__type__", None) or type(fs).__name__
            img.filesystems[number] = fs
            label = _fs_label(fs)
        except Exception:
            # Unallocated space or an unsupported filesystem: the partition is
            # still listed, it just cannot be browsed.
            pass

        img.partitions.append({
            "number":  number,
            "offset":  offset,
            "size":    size,
            "type":    str(ptype) if ptype is not None else None,
            "fs_type": fs_type,
            "label":   label,
            "browsable": fs_type is not None,
        })

    return img


def _fs_label(fs: Any) -> str | None:
    for attr in ("volume_label", "label", "name"):
        try:
            val = getattr(fs, attr, None)
            if isinstance(val, str) and val.strip():
                return val.strip()
        except Exception:
            continue
    return None


def open_image(path: Path) -> OpenImage:
    key = str(path)
    with _cache_lock:
        cached = _cache.get(key)
        if cached:
            return cached

    # Opened outside the lock: parsing a large image is slow and must not block
    # listings of other images.
    img = _open_uncached(path)

    with _cache_lock:
        existing = _cache.get(key)
        if existing:
            return existing          # another thread won the race
        if len(_cache) >= _CACHE_MAX:
            _cache.pop(next(iter(_cache)))
        _cache[key] = img
    print(f"[diskimage] ouvert {path.name} — {len(img.partitions)} partition(s)", flush=True)
    return img


def close_all() -> None:
    with _cache_lock:
        _cache.clear()


def _get_fs(path: Path, partition: int):
    img = open_image(path)
    fs = img.filesystems.get(partition)
    if fs is None:
        raise DiskImageError(
            f"Partition {partition} non exploitable "
            f"(système de fichiers non reconnu ou espace non alloué)"
        )
    return fs


def partitions(path: Path) -> list[dict]:
    return open_image(path).partitions


# ─── Browsing ─────────────────────────────────────────────────────────────────

def _entry_times(entry: Any) -> dict:
    """MAC times, best effort — drivers vary in what they expose."""
    out: dict[str, str | None] = {"mtime": None, "atime": None, "ctime": None, "btime": None}
    try:
        st = entry.stat()
    except Exception:
        return out
    for key, attr in (("mtime", "st_mtime"), ("atime", "st_atime"),
                      ("ctime", "st_ctime"), ("btime", "st_birthtime")):
        try:
            val = getattr(st, attr, None)
            if val:
                out[key] = datetime.fromtimestamp(float(val), tz=timezone.utc).isoformat()
        except Exception:
            pass
    return out


def list_dir(path: Path, partition: int, dir_path: str = "/") -> list[dict]:
    """
    One directory level — the top-right pane of the FTK Imager layout.

    A single unreadable entry (corrupted MFT record, exotic reparse point) is
    reported in place rather than failing the whole listing, which is normal on
    a damaged acquisition.
    """
    fs = _get_fs(path, partition)
    dir_path = dir_path or "/"

    try:
        target = fs.get(dir_path)
    except Exception as e:
        raise DiskImageError(f"Répertoire introuvable: {e}")

    entries: list[dict] = []
    try:
        listing = list(target.scandir())
    except Exception as e:
        raise DiskImageError(f"Lecture du répertoire impossible: {e}")

    for entry in listing:
        if entry.name in (".", ".."):
            continue
        try:
            is_dir = entry.is_dir()
        except Exception:
            is_dir = False

        row: dict = {
            "name":     entry.name,
            "path":     (dir_path.rstrip("/") + "/" + entry.name) or "/",
            "is_dir":   is_dir,
            "size":     None,
            "error":    None,
            **{"mtime": None, "atime": None, "ctime": None, "btime": None},
        }
        try:
            if not is_dir:
                row["size"] = int(entry.stat().st_size)
            row.update(_entry_times(entry))
        except Exception as e:
            row["error"] = f"{type(e).__name__}"
        entries.append(row)

    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries


def read_file(path: Path, partition: int, file_path: str,
              offset: int = 0, length: int = 65536) -> tuple[bytes, int]:
    """Read a slice of a file. Returns (data, total_size)."""
    fs = _get_fs(path, partition)
    try:
        entry = fs.get(file_path)
    except Exception as e:
        raise DiskImageError(f"Fichier introuvable: {e}")
    if entry.is_dir():
        raise DiskImageError("Ce chemin est un répertoire")

    try:
        total = int(entry.stat().st_size)
    except Exception:
        total = 0

    length = max(0, min(int(length), MAX_READ_BYTES))
    try:
        with entry.open() as fh:
            fh.seek(max(0, int(offset)))
            return fh.read(length), total
    except Exception as e:
        raise DiskImageError(f"Lecture impossible: {e}")


def stream_file(path: Path, partition: int, file_path: str) -> Iterator[bytes]:
    """Chunked reader for downloads — never materialises the file in memory."""
    fs = _get_fs(path, partition)
    try:
        entry = fs.get(file_path)
        fh = entry.open()
    except Exception as e:
        raise DiskImageError(f"Lecture impossible: {e}")

    def _gen() -> Iterator[bytes]:
        try:
            while True:
                chunk = fh.read(_HASH_CHUNK)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                fh.close()
            except Exception:
                pass

    return _gen()


def hash_file(path: Path, partition: int, file_path: str) -> dict:
    """MD5 + SHA-256, computed streaming — the chain-of-custody values."""
    fs = _get_fs(path, partition)
    try:
        entry = fs.get(file_path)
        size = int(entry.stat().st_size)
    except Exception as e:
        raise DiskImageError(f"Fichier introuvable: {e}")

    if size > MAX_HASH_BYTES:
        raise DiskImageError(
            f"Fichier trop volumineux pour un hachage synchrone "
            f"({size / 1024 ** 3:.1f} Go, limite {MAX_HASH_BYTES / 1024 ** 3:.0f} Go)"
        )

    md5, sha256 = hashlib.md5(), hashlib.sha256()
    try:
        with entry.open() as fh:
            while True:
                chunk = fh.read(_HASH_CHUNK)
                if not chunk:
                    break
                md5.update(chunk)
                sha256.update(chunk)
    except Exception as e:
        raise DiskImageError(f"Lecture impossible: {e}")

    return {"size": size, "md5": md5.hexdigest(), "sha256": sha256.hexdigest()}


def extract_to(path: Path, partition: int, file_path: str, dest_dir: Path) -> dict:
    """
    Carve one file out of the image onto disk.

    Used to drop a file into a case's drop folder, where the existing ingestion
    pipeline picks it up like any other dropped artifact.
    """
    fs = _get_fs(path, partition)
    try:
        entry = fs.get(file_path)
    except Exception as e:
        raise DiskImageError(f"Fichier introuvable: {e}")
    if entry.is_dir():
        raise DiskImageError("Impossible d'extraire un répertoire")

    dest_dir.mkdir(parents=True, exist_ok=True)
    name = Path(file_path).name or "extrait.bin"
    dest = dest_dir / name
    if dest.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        dest = dest_dir / f"{Path(name).stem}_{stamp}{Path(name).suffix}"

    md5, sha256 = hashlib.md5(), hashlib.sha256()
    written = 0
    try:
        with entry.open() as src, dest.open("wb") as out:
            while True:
                chunk = src.read(_HASH_CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                md5.update(chunk)
                sha256.update(chunk)
                written += len(chunk)
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise DiskImageError(f"Extraction impossible: {e}")

    print(f"[diskimage] extrait {file_path} → {dest} ({written} o)", flush=True)
    return {
        "filename": dest.name,
        "dest_path": str(dest),
        "size": written,
        "md5": md5.hexdigest(),
        "sha256": sha256.hexdigest(),
    }
