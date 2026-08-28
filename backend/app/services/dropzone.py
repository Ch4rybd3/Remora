"""
Drop folder — SOF-ELK style artifact ingestion.

A watched directory on disk, one sub-folder per case. Anything dropped into a
case folder is ingested exactly like a Collection Import upload: same detection
(`ez_detection.detect`), same `ImportedCollection` / `ImportedFile` records,
same background registration. Nothing new appears in the Collection tab — the
files simply show up there as if they had been uploaded through the browser.

Layout:

    <dropzone>/
      ransomware-acme-4f3a9b21/      one folder per case (slug + short id)
        Amcache_ProgramEntries.csv   drop files here
        .processed/                  ingested files are moved here, never deleted
      _inbox/                        orphans — assigned to a case from the UI

A file is only picked up once it has stopped changing (same size and mtime
across two consecutive polls), so a large copy in progress is never ingested
half-written.
"""
from __future__ import annotations

import re
import shutil
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..models.case import Case
from ..models.ez_artifacts import ImportedCollection, ImportedFile
from ..models.ingest import ORIGIN_ARCHIVE, ORIGIN_DROPZONE, IngestedFile
from ..services.archives import ARCHIVE_EXTS, ArchiveError, extract_all, is_archive
from ..services.ez_detection import detect

# Folder holding files already ingested, inside each case folder
PROCESSED_DIRNAME = ".processed"
# Case-less drop folder
INBOX_DIRNAME = "_inbox"

# Same set the Collection Import upload endpoint accepts — flat artifacts plus
# every archive container the archives service can open.
FLAT_EXTS = {".csv", ".json", ".txt", ".log", ".evtx", ".eml",
             ".pcap", ".pcapng", ".cap"}
SUPPORTED_EXTS = FLAT_EXTS | ARCHIVE_EXTS

# Files matching these are never considered droppable artifacts
_IGNORED_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}
_IGNORED_PREFIXES = ("~$", ".~", ".goutputstream")


# ─── Paths ────────────────────────────────────────────────────────────────────

def mkdir_shared(p: Path) -> Path:
    """
    Create a drop folder writable by whoever is dropping files into it.

    The backend runs as root inside the container, so a default-mode mkdir
    produces root:root 0755 on the host side of the bind mount and the analyst
    cannot actually drop anything in. chmod is explicit because mkdir's mode is
    masked by umask.
    """
    p.mkdir(parents=True, exist_ok=True)
    try:
        p.chmod(0o777)
    except OSError:
        pass  # read-only mount or foreign ownership — nothing we can do
    return p


def dropzone_root() -> Path:
    """Root of the drop folder, created on first access."""
    return mkdir_shared(Path(settings.dropzone_path))


def inbox_dir() -> Path:
    return mkdir_shared(dropzone_root() / INBOX_DIRNAME)


def _slugify(text: str) -> str:
    """ASCII, lowercase, dash-separated — safe on every filesystem."""
    norm = unicodedata.normalize("NFKD", text or "")
    ascii_only = norm.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return slug[:40].strip("-")


def case_folder_name(case: Case) -> str:
    """
    Human-findable folder name: `<title-slug>-<short-id>`.

    The short id keeps two identically-named cases apart and lets the folder be
    resolved back to a case even if the title is later renamed.
    """
    slug = _slugify(case.title)
    short = case.id.replace("-", "")[:8]
    return f"{slug}-{short}" if slug else short


def case_dropzone_dir(case: Case, create: bool = True) -> Path:
    """
    Folder for this case. Existing folders whose id suffix matches are reused,
    so renaming a case never orphans files already dropped for it.
    """
    root = dropzone_root()
    short = case.id.replace("-", "")[:8]

    for child in root.iterdir() if root.exists() else []:
        if child.name == INBOX_DIRNAME or not child.is_dir():
            continue
        # `name == short` covers titles that slugify to nothing (e.g. "!!!"),
        # whose folder is the bare id with no dash prefix.
        if child.name.endswith(f"-{short}") or child.name == short:
            if create:
                # Re-apply on every lookup so folders created before the
                # permission fix (or with a stricter umask) become droppable.
                mkdir_shared(child)
                mkdir_shared(child / PROCESSED_DIRNAME)
            return child

    p = root / case_folder_name(case)
    if create:
        mkdir_shared(p)
        mkdir_shared(p / PROCESSED_DIRNAME)
    return p


def ensure_case_folder(case: Case) -> Path:
    """Called at case creation so the folder exists before anyone looks for it."""
    p = case_dropzone_dir(case, create=True)
    print(f"[dropzone] case folder ready: {p}", flush=True)
    return p


def resolve_case_for_folder(folder_name: str, db: Session) -> Case | None:
    """Map a drop folder name back to its Case via the trailing short id."""
    m = re.search(r"([0-9a-f]{8})$", folder_name)
    if not m:
        return None
    short = m.group(1)
    for case in db.query(Case).all():
        if case.id.replace("-", "")[:8] == short:
            return case
    return None


# ─── Scanning ─────────────────────────────────────────────────────────────────

@dataclass
class DroppedFile:
    path:     Path
    name:     str
    size:     int
    mtime:    float
    detected: str | None      # human-readable category label, None if unknown

    @property
    def supported(self) -> bool:
        # is_archive() handles two-part suffixes like .tar.gz that Path.suffix misses
        return self.path.suffix.lower() in FLAT_EXTS or is_archive(self.name)


def _is_ignorable(p: Path) -> bool:
    name = p.name.lower()
    if name in _IGNORED_NAMES or name.startswith(_IGNORED_PREFIXES):
        return True
    # Partial-download markers from browsers and sync clients
    return p.suffix.lower() in {".part", ".crdownload", ".tmp", ".filepart"}


def list_dropped(folder: Path) -> list[DroppedFile]:
    """Droppable files sitting directly in `folder` (excluding .processed/)."""
    if not folder.exists():
        return []

    out: list[DroppedFile] = []
    for p in sorted(folder.iterdir()):
        if p.is_dir() or _is_ignorable(p):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        result = detect(p.name)
        out.append(DroppedFile(
            path=p, name=p.name, size=st.st_size, mtime=st.st_mtime,
            detected=result.category_label if result else None,
        ))
    return out


def is_stable(f: DroppedFile, now: float) -> bool:
    """
    True once the file has been untouched long enough to be safe to read.

    Avoids ingesting a multi-gigabyte copy that is still in flight; a simple
    mtime check works on bind mounts where inotify is unreliable.
    """
    return (now - f.mtime) >= settings.dropzone_stable_seconds


# ─── Ingestion ────────────────────────────────────────────────────────────────

def ingest_files(
    case: Case,
    files: list[Path],
    db: Session,
    source_label: str = "drop folder",
    origin: str = ORIGIN_DROPZONE,
    origin_detail: str | None = None,
) -> tuple[str, list[ImportedFile]]:
    """
    Register dropped files as a Collection Import and hand them to the shared
    background ingest. Files are copied into the collection directory and the
    originals moved to `.processed/`, so a re-scan never ingests them twice.

    Returns (collection_id, imported_file_rows). Caller schedules the ingest.
    """
    from ..routers.collection_import import _collection_dir

    collection_id = str(uuid.uuid4())
    dest_dir = _collection_dir(case.id, collection_id)
    extracted_dir = dest_dir / "extracted"
    extracted_dir.mkdir(parents=True, exist_ok=True)

    expires = datetime.utcnow() + timedelta(days=90)
    rows: list[ImportedFile] = []
    total_size = 0
    seen: dict[str, int] = {}
    # Members unpacked from each archive, so the provenance pass below can link
    # them to the container the analyst actually dropped.
    archive_members: dict[Path, list[Path]] = {}

    def _row(rel_name: str, size: int | None) -> ImportedFile:
        """Build an ImportedFile row for a file sitting at `extracted/<rel_name>`."""
        ext = Path(rel_name).suffix.lower()
        result = detect(rel_name)
        if ext == ".evtx":
            dest_page, dest_label = f"/cases/{case.id}/evtx", "EVTX Module"
        elif ext == ".eml":
            dest_page, dest_label = f"/cases/{case.id}/emails", "Email Analysis"
        elif ext in (".pcap", ".pcapng", ".cap"):
            dest_page, dest_label = "/artifacts/explorer", "Network Capture"
        elif result:
            dest_page = result.destination_page.replace("{case_id}", case.id)
            dest_label = result.destination_label
        else:
            dest_page, dest_label = None, "Artifact Explorer"

        return ImportedFile(
            id=str(uuid.uuid4()),
            collection_id=collection_id,
            case_id=case.id,
            filename=rel_name,
            file_size=size,
            status="pending",
            category=result.category if result else (ext.lstrip(".") or None),
            category_label=result.category_label if result else (ext.lstrip(".").upper() or None),
            destination_page=dest_page,
            destination_label=dest_label,
            expires_at=expires,
        )

    for src in files:
        if not src.exists():
            continue

        # Deduplicate basenames within this batch
        if src.name in seen:
            seen[src.name] += 1
            stem = src.stem
            safe_name = f"{stem}_{seen[src.name]}{src.suffix}"
        else:
            seen[src.name] = 0
            safe_name = src.name

        size = src.stat().st_size
        total_size += size

        # ── Archives: unpack into extracted/<archive stem>/ and register the
        #    entries individually, exactly like the Collection Import upload.
        if is_archive(src.name):
            sub = extracted_dir / (_slugify(Path(safe_name).stem) or f"archive-{len(rows)}")
            try:
                extract_all(src, sub, src.name)
            except ArchiveError as e:
                print(f"[dropzone] archive {src.name} could not be read: {e}", flush=True)
                continue
            # Walk what actually landed on disk rather than re-reading the
            # archive index — unsafe entries were dropped during extraction.
            members = sorted(p for p in sub.rglob("*") if p.is_file())
            archive_members[src] = members
            for entry in members:
                rows.append(_row(
                    str(entry.relative_to(extracted_dir)),
                    entry.stat().st_size,
                ))
            continue

        shutil.copy2(src, extracted_dir / safe_name)
        rows.append(_row(safe_name, size))

    if not rows:
        return collection_id, []

    col = ImportedCollection(
        id=collection_id,
        case_id=case.id,
        filename=(files[0].name if len(files) == 1 else f"{len(rows)} files ({source_label})"),
        file_size=total_size,
        uploaded_at=datetime.utcnow(),
        status="processing",
        total_files=len(rows),
        processed_files=0,
    )
    db.add(col)
    for r in rows:
        db.add(r)
    db.commit()

    # ── Provenance ───────────────────────────────────────────────────────────
    # One `ingested_files` row per file the analyst actually dropped, plus one
    # per archive member, linked back to its container. Written after the
    # collection is committed so `collection_id` points at a row that exists,
    # and before the originals move so each file is hashed where it was found.
    #
    # Imported here rather than at module scope: `services.ingest.dropfolder`
    # imports this module for the folder layout, and a top-level import would
    # close the cycle.
    from .ingest import service as ingest_service

    provenance: dict[Path, str] = {}
    for src in files:
        if not src.exists():
            continue
        try:
            ing = ingest_service.record(
                db, case_id=case.id, path=src,
                collection_id=collection_id,
                origin=origin, origin_detail=origin_detail,
            )
            provenance[src] = ing.id
        except Exception as e:   # provenance must never block an ingest
            print(f"[dropzone] could not record provenance for {src.name}: {e}", flush=True)
            continue

        for member in archive_members.get(src, []):
            try:
                ingest_service.record(
                    db, case_id=case.id, path=member, original_name=member.name,
                    collection_id=collection_id, parent_id=ing.id,
                    origin=ORIGIN_ARCHIVE, origin_detail=src.name,
                )
            except Exception as e:
                print(f"[dropzone] could not record member {member.name}: {e}", flush=True)

    # Move originals out of the watched folder only after the DB is committed,
    # so a crash mid-scan leaves the file in place to be retried.
    case_dir = case_dropzone_dir(case)
    processed = case_dir / PROCESSED_DIRNAME
    mkdir_shared(processed)
    for src in files:
        if not src.exists():
            continue
        target = processed / src.name
        if target.exists():
            stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
            target = processed / f"{src.stem}_{stamp}{src.suffix}"
        try:
            shutil.move(str(src), str(target))
            ingested_id = provenance.get(src)
            if ingested_id:
                row = db.get(IngestedFile, ingested_id)
                if row:
                    row.stored_path = str(target.relative_to(dropzone_root()))
        except OSError as e:
            print(f"[dropzone] could not archive {src.name}: {e}", flush=True)
    db.commit()

    print(f"[dropzone] case {case.id}: queued {len(rows)} file(s) from {source_label}", flush=True)
    return collection_id, rows
