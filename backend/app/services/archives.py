"""
Archive service — uniform listing / extraction for the archive formats an
analyst is likely to drop on Remora (KAPE triage output, EZ Tools batches,
client-supplied evidence bundles…).

Supported containers
  .zip .jar                              → zipfile (stdlib)
  .tar .tar.gz .tgz .tar.bz2 .tbz2 .tar.xz .txz .tar.zst  → tarfile (stdlib, zstd via CLI)
  .7z                                    → py7zr, fallback to the `7z` CLI
  .rar                                   → rarfile, fallback to `7z` / `unar` CLI
  .gz .bz2 .xz .zst  (single member)     → gzip / bz2 / lzma (stdlib)

Everything goes through `list_entries()` / `extract_all()`, so callers never
have to care which backend does the work. Both refuse absolute paths and
`..` traversal (zip-slip / tar-slip).
"""
from __future__ import annotations

import bz2
import gzip
import lzma
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path


class ArchiveError(Exception):
    """Raised when an archive is unreadable or its format has no backend."""


# ── Extension tables ─────────────────────────────────────────────────────────
# Ordered longest-first so ".tar.gz" wins over ".gz".

_MULTI_EXTS: list[tuple[str, str]] = [
    (".tar.gz",  "tar"),
    (".tar.bz2", "tar"),
    (".tar.xz",  "tar"),
    (".tar.zst", "tar"),
    (".tar.lz",  "tar"),
]

_SINGLE_EXTS: dict[str, str] = {
    ".zip":  "zip",
    ".jar":  "zip",
    ".7z":   "7z",
    ".rar":  "rar",
    ".tar":  "tar",
    ".tgz":  "tar",
    ".tbz":  "tar",
    ".tbz2": "tar",
    ".txz":  "tar",
    ".gz":   "gz",
    ".bz2":  "bz2",
    ".xz":   "xz",
    ".zst":  "zst",
    ".zstd": "zst",
}

#: Every accepted archive suffix — used by the upload endpoint for validation.
ARCHIVE_EXTS: set[str] = set(_SINGLE_EXTS) | {e for e, _ in _MULTI_EXTS}

#: Human-readable list for error messages / UI copy.
ARCHIVE_EXTS_LABEL = ", ".join(sorted(ARCHIVE_EXTS))


def archive_format(filename: str) -> str | None:
    """Return the backend key for `filename`, or None if it is not an archive."""
    low = filename.lower()
    for ext, fmt in _MULTI_EXTS:
        if low.endswith(ext):
            return fmt
    return _SINGLE_EXTS.get(Path(low).suffix)


def is_archive(filename: str) -> bool:
    return archive_format(filename) is not None


def archive_suffix(filename: str) -> str:
    """The full archive suffix of `filename` (".tar.gz", ".7z", …), "" if none."""
    low = filename.lower()
    for ext, _ in _MULTI_EXTS:
        if low.endswith(ext):
            return ext
    suf = Path(low).suffix
    return suf if suf in _SINGLE_EXTS else ""


def _decompressed_name(filename: str) -> str:
    """Name a single-member .gz/.bz2/.xz/.zst decompresses to."""
    stem = Path(filename).name
    suf  = Path(stem).suffix
    return stem[: -len(suf)] if suf else stem + ".out"


# ── Path safety ──────────────────────────────────────────────────────────────

def _is_safe(entry: str) -> bool:
    """Reject absolute paths, drive letters and any `..` component."""
    name = entry.replace("\\", "/")
    if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        return False
    return ".." not in [p for p in name.split("/") if p]


def _normalize(entry: str) -> str:
    """Slashes forward, no `./` prefix — tar members often carry one."""
    name = entry.replace("\\", "/")
    while name.startswith("./"):
        name = name[2:]
    return name


def _safe_entries(names: list[str]) -> list[str]:
    safe = []
    for n in names:
        if n.endswith("/") or n.endswith("\\"):
            continue
        if not _is_safe(n):
            print(f"[archives] skipping unsafe entry: {n}", flush=True)
            continue
        norm = _normalize(n)
        if norm:
            safe.append(norm)
    return safe


# ── External CLI helpers ─────────────────────────────────────────────────────

def _cli(*names: str) -> str | None:
    for n in names:
        found = shutil.which(n)
        if found:
            return found
    return None


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=3600)


def _7z_bin() -> str | None:
    return _cli("7z", "7za", "7zz", "7zr")


def _7z_list(path: Path) -> list[str]:
    """Parse `7z l -ba -slt` output into entry names (files only)."""
    exe = _7z_bin()
    if not exe:
        raise ArchiveError("7z CLI unavailable")
    proc = _run([exe, "l", "-ba", "-slt", str(path)])
    if proc.returncode != 0:
        raise ArchiveError(proc.stderr.strip()[:300] or "7z listing failed")
    names, cur, is_dir = [], None, False
    for line in proc.stdout.splitlines():
        if line.startswith("Path = "):
            if cur and not is_dir:
                names.append(cur)
            cur, is_dir = line[7:].strip(), False
        elif line.startswith("Attributes = "):
            attrs = line[len("Attributes = "):].strip()
            is_dir = is_dir or attrs.startswith("D")
        elif line.startswith("Folder = "):
            is_dir = is_dir or line[len("Folder = "):].strip() == "+"
    if cur and not is_dir:
        names.append(cur)
    return names


def _7z_extract(path: Path, dest: Path) -> None:
    exe = _7z_bin()
    if not exe:
        raise ArchiveError("7z CLI unavailable")
    proc = _run([exe, "x", "-y", f"-o{dest}", str(path)])
    if proc.returncode != 0:
        raise ArchiveError(proc.stderr.strip()[:300] or "7z extraction failed")


# ── Per-format backends ──────────────────────────────────────────────────────

def _zip_list(path: Path) -> list[str]:
    try:
        with zipfile.ZipFile(path) as zf:
            return _safe_entries([i.filename for i in zf.infolist() if not i.is_dir()])
    except zipfile.BadZipFile as e:
        raise ArchiveError(f"Archive ZIP invalide: {e}") from e


def _zip_extract(path: Path, dest: Path) -> None:
    with zipfile.ZipFile(path) as zf:
        for name in _safe_entries(zf.namelist()):
            zf.extract(name, dest)


def _tar_list(path: Path) -> list[str]:
    try:
        with tarfile.open(path) as tf:
            return _safe_entries([m.name for m in tf.getmembers() if m.isfile()])
    except tarfile.TarError as e:
        # zstd-compressed tars need the CLI — stdlib tarfile has no zstd support
        if archive_suffix(path.name) in (".tar.zst", ".tar.lz") and _7z_bin():
            return _safe_entries(_7z_list(path))
        raise ArchiveError(f"Archive TAR invalide: {e}") from e


def _tar_extract(path: Path, dest: Path) -> None:
    try:
        with tarfile.open(path) as tf:
            members = [m for m in tf.getmembers() if m.isfile() and _is_safe(m.name)]
            # filter="data" (3.12+) also strips links/devices and unsafe paths
            try:
                tf.extractall(dest, members=members, filter="data")
            except TypeError:
                tf.extractall(dest, members=members)
    except tarfile.TarError as e:
        if _7z_bin():
            _7z_extract(path, dest)
            return
        raise ArchiveError(f"Archive TAR invalide: {e}") from e


def _sevenz_list(path: Path) -> list[str]:
    try:
        import py7zr
    except ImportError:
        return _safe_entries(_7z_list(path))
    try:
        with py7zr.SevenZipFile(path, mode="r") as z:
            if z.needs_password():
                raise ArchiveError("Archive 7z protégée par mot de passe — non supporté")
            return _safe_entries([f.filename for f in z.list() if not f.is_directory])
    except ArchiveError:
        raise
    except Exception as e:
        raise ArchiveError(f"Archive 7z illisible: {e}") from e


def _sevenz_extract(path: Path, dest: Path) -> None:
    try:
        import py7zr
    except ImportError:
        _7z_extract(path, dest)
        return
    try:
        with py7zr.SevenZipFile(path, mode="r") as z:
            z.extractall(path=dest)
    except Exception as e:
        if _7z_bin():
            _7z_extract(path, dest)
            return
        raise ArchiveError(f"Extraction 7z échouée: {e}") from e


def _rar_list(path: Path) -> list[str]:
    try:
        import rarfile
        with rarfile.RarFile(path) as rf:
            return _safe_entries([i.filename for i in rf.infolist() if not i.is_dir()])
    except ImportError:
        pass
    except Exception as e:
        if not _7z_bin():
            raise ArchiveError(f"Archive RAR illisible: {e}") from e
    if _7z_bin():
        return _safe_entries(_7z_list(path))
    raise ArchiveError("Aucun backend RAR disponible (installez unar ou p7zip-full)")


def _rar_extract(path: Path, dest: Path) -> None:
    try:
        import rarfile
        with rarfile.RarFile(path) as rf:
            rf.extractall(dest)
            return
    except ImportError:
        pass
    except Exception as e:
        if not _7z_bin():
            raise ArchiveError(f"Extraction RAR échouée: {e}") from e
    if _7z_bin():
        _7z_extract(path, dest)
        return
    unar = _cli("unar")
    if unar:
        proc = _run([unar, "-q", "-f", "-o", str(dest), str(path)])
        if proc.returncode != 0:
            raise ArchiveError(proc.stderr.strip()[:300] or "unar extraction failed")
        return
    raise ArchiveError("Aucun backend RAR disponible (installez unar ou p7zip-full)")


_STREAM_OPENERS = {"gz": gzip.open, "bz2": bz2.open, "xz": lzma.open}


def _stream_list(path: Path, fmt: str) -> list[str]:
    """A bare .gz/.bz2/.xz/.zst holds exactly one member, named after the file."""
    return [_decompressed_name(path.name)]


def _stream_extract(path: Path, dest: Path, fmt: str) -> None:
    out = dest / _decompressed_name(path.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    opener = _STREAM_OPENERS.get(fmt)
    if opener is None:                      # zstd — no stdlib support before 3.14
        if not _7z_bin():
            raise ArchiveError("Décompression zstd indisponible (installez p7zip-full)")
        _7z_extract(path, dest)
        return
    try:
        with opener(path, "rb") as src, out.open("wb") as dst:
            shutil.copyfileobj(src, dst)
    except OSError as e:
        raise ArchiveError(f"Décompression {fmt} échouée: {e}") from e


# ── Public API ───────────────────────────────────────────────────────────────

def list_entries(path: Path, filename: str | None = None) -> list[str]:
    """
    File entries inside the archive, as relative paths. Directories, unsafe
    paths and symlinks are filtered out.
    """
    fmt = archive_format(filename or path.name)
    if fmt is None:
        raise ArchiveError(f"Format d'archive non reconnu: {filename or path.name}")
    if fmt == "zip":
        return _zip_list(path)
    if fmt == "tar":
        return _tar_list(path)
    if fmt == "7z":
        return _sevenz_list(path)
    if fmt == "rar":
        return _rar_list(path)
    return _stream_list(path, fmt)


def extract_all(path: Path, dest: Path, filename: str | None = None) -> None:
    """Extract every safe entry of the archive into `dest`."""
    fmt = archive_format(filename or path.name)
    if fmt is None:
        raise ArchiveError(f"Format d'archive non reconnu: {filename or path.name}")
    dest.mkdir(parents=True, exist_ok=True)
    if fmt == "zip":
        _zip_extract(path, dest)
    elif fmt == "tar":
        _tar_extract(path, dest)
    elif fmt == "7z":
        _sevenz_extract(path, dest)
    elif fmt == "rar":
        _rar_extract(path, dest)
    else:
        _stream_extract(path, dest, fmt)
