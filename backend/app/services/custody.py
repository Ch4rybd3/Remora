"""
Promoting an artifact into the chain of custody.

One service, called from every page that lists artifacts, so "keep this" means
the same thing everywhere. Adding a new artifact page means adding one row to
`_SOURCES` below - not reimplementing promotion a fourth time, which is how the
Artifact Explorer, the Collection tab and the evidence uploader ended up with
three different answers.

**Promotion copies the bytes.** That is the whole point. Collections carry a
90-day expiry, and an evidence record that merely references a file inside one
is a record of something that will not be there - which is worse than no record
at all, because it reads as preserved. The copy lives in the evidence store,
which nothing expires.

See `docs/INGESTION.md` and the Evidence model.
"""
from __future__ import annotations

import hashlib
import shutil
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

from sqlalchemy.orm import Session

from ..config import settings
from ..models.evidence import AcquisitionMethod, Evidence, EvidenceType
from ..models.ingest import IngestedFile

#: Extension given to a contained sample, so the containment is visible in a
#: file listing without opening anything.
IOC_ARCHIVE_SUFFIX = ".ioc.zip"


def _resolve_stored(stored_path: str) -> Path | None:
    """
    Find a file from its recorded `stored_path`.

    Paths are recorded relative to one of two roots - the drop folder for
    anything the pipeline ingested, the case data directory for anything the
    backfill found - and absolute for rows written before that was settled.
    All three are tried rather than assumed, because guessing wrong here reads
    as "the evidence is gone".
    """
    candidate = Path(stored_path)
    if candidate.is_absolute():
        return candidate if candidate.exists() else None
    for root in (Path(settings.dropzone_path), settings.case_data_path):
        resolved = root / candidate
        if resolved.exists():
            return resolved
    return None


class PromotionError(Exception):
    """The source could not be promoted, with a reason meant for the analyst."""


@dataclass(frozen=True)
class SourceRef:
    """What a promotable artifact looks like, whatever page it came from."""
    path:           Path
    name:           str
    evidence_type:  EvidenceType
    description:    str = ""
    tags:           str = ""
    collected_at:   datetime | None = None
    #: Set on the source row once promoted, so the link survives and the UI can
    #: show "already in custody" rather than offering to add it twice.
    link_back:      Callable[[Session, str], None] | None = None


# ─── Source resolvers ─────────────────────────────────────────────────────────
# One entry per kind of thing a page can promote. A new artifact page registers
# itself here and gets the button, the containment option, the withdrawal flow
# and the audit trail for free.

def _resolve_ingested_file(db: Session, case_id: str, source_id: str) -> SourceRef:
    row = (
        db.query(IngestedFile)
        .filter(IngestedFile.id == source_id, IngestedFile.case_id == case_id)
        .first()
    )
    if not row:
        raise PromotionError("Ingested file not found")
    if not row.stored_path:
        raise PromotionError(
            "This file has no copy on disk any more, so there is nothing to "
            "preserve. Its ingestion record stays in the case."
        )

    path = _resolve_stored(str(row.stored_path))
    if path is None:
        raise PromotionError(
            f"The file recorded at '{row.stored_path}' is no longer on disk"
        )

    def link(session: Session, evidence_id: str) -> None:
        row.evidence_id = evidence_id
        session.add(row)

    return SourceRef(
        path=path,
        name=str(row.original_name),
        evidence_type=_EVIDENCE_TYPE_BY_KIND.get(
            str(row.detected_kind or ""), EvidenceType.artifact),
        description=f"Ingested artifact, identified as {row.magic_type or 'unknown'}.",
        tags=str(row.detected_kind or ""),
        collected_at=cast("datetime | None", row.created_at),
        link_back=link,
    )


def _resolve_artifact(db: Session, case_id: str, source_id: str) -> SourceRef:
    from ..models.csv_artifact import CsvArtifactFile

    row = (
        db.query(CsvArtifactFile)
        .filter(CsvArtifactFile.id == source_id, CsvArtifactFile.case_id == case_id)
        .first()
    )
    if not row:
        raise PromotionError("Artifact not found")
    path = Path(str(row.file_path or ""))
    if not row.file_path or not path.exists():
        raise PromotionError("The parsed file is no longer on disk")

    def link(session: Session, evidence_id: str) -> None:
        row.evidence_id = evidence_id
        session.add(row)

    return SourceRef(
        path=path,
        name=str(row.original_name),
        evidence_type=EvidenceType.log,
        description=f"Artifact from the Explorer, {row.row_count} rows.",
        tags=str(row.ez_category or ""),
        collected_at=cast("datetime | None", row.uploaded_at),
        link_back=link,
    )


_SOURCES: dict[str, Callable[[Session, str, str], SourceRef]] = {
    "ingested_file": _resolve_ingested_file,
    "artifact":      _resolve_artifact,
}

#: A sensible evidence type per detected kind, so the analyst is not asked to
#: restate what identification already worked out.
_EVIDENCE_TYPE_BY_KIND: dict[str, EvidenceType] = {
    "evtx":          EvidenceType.log,
    "evt":           EvidenceType.log,
    "mft":           EvidenceType.artifact,
    "usnjrnl":       EvidenceType.artifact,
    "registry_hive": EvidenceType.artifact,
    "prefetch":      EvidenceType.artifact,
    "lnk":           EvidenceType.artifact,
    "memory_dump":   EvidenceType.memory_dump,
    "pagefile":      EvidenceType.memory_dump,
    "hiberfil":      EvidenceType.memory_dump,
    "ewf":           EvidenceType.disk_image,
    "vmdk":          EvidenceType.disk_image,
    "vhd":           EvidenceType.disk_image,
    "vhdx":          EvidenceType.disk_image,
    "qcow":          EvidenceType.disk_image,
    "disk_raw":      EvidenceType.disk_image,
    "pcap":          EvidenceType.network_capture,
    "pcapng":        EvidenceType.network_capture,
    "eml":           EvidenceType.document,
    "msg":           EvidenceType.document,
    "pst":           EvidenceType.document,
    "pdf":           EvidenceType.document,
    "pe":            EvidenceType.malware,
    "elf":           EvidenceType.malware,
    "macho":         EvidenceType.malware,
}

KNOWN_SOURCE_KINDS = frozenset(_SOURCES)


# ─── Hashing and containment ──────────────────────────────────────────────────

def _hashes(path: Path) -> tuple[str, str]:
    md5, sha256 = hashlib.md5(), hashlib.sha256()
    with open(path, "rb") as fh:
        while chunk := fh.read(1024 * 1024):
            md5.update(chunk)
            sha256.update(chunk)
    return md5.hexdigest(), sha256.hexdigest()


def contain(source: Path, destination: Path, password: str) -> None:
    """
    Write `source` into a password-protected AES-256 zip at `destination`.

    **This is containment, not confidentiality.** The password is published in
    the interface and in this file; anyone who has the archive can open it.
    What it buys is the two things that actually go wrong with a live sample:
    an analyst double-clicking it after a download, and endpoint protection
    silently quarantining or deleting it out of the evidence store - which
    destroys evidence.

    AES rather than the legacy ZipCrypto: ZipCrypto is broken badly enough that
    some tools transparently ignore it, which would defeat even the accident
    prevention this is for.
    """
    import pyzipper

    destination.parent.mkdir(parents=True, exist_ok=True)
    with pyzipper.AESZipFile(
        destination, "w",
        compression=pyzipper.ZIP_DEFLATED,
        encryption=pyzipper.WZ_AES,
    ) as archive:
        archive.setpassword(password.encode())
        archive.write(source, arcname=source.name)


# ─── Promotion ────────────────────────────────────────────────────────────────

def _coc_line(action: str, username: str, detail: str = "") -> str:
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{stamp}] {action} by {username}"
    return f"{line} - {detail}\n" if detail else f"{line}\n"


def promote(
    db: Session,
    *,
    case_id: str,
    case_title: str,
    kind: str,
    source_id: str,
    username: str,
    as_ioc: bool = False,
    name: str | None = None,
    description: str | None = None,
    tags: str | None = None,
    commit: bool = True,
) -> Evidence:
    """
    Copy an artifact into the evidence store and open its chain of custody.

    The hashes recorded are of the **original file**, never of the container an
    IOC is wrapped in. A chain of custody that identifies our own zip rather
    than the artifact would be worthless the moment anyone tried to corroborate
    it against another tool's output.
    """
    resolver = _SOURCES.get(kind)
    if resolver is None:
        raise PromotionError(f"Nothing knows how to promote a '{kind}'")

    ref = resolver(db, case_id, source_id)
    md5, sha256 = _hashes(ref.path)

    evidence_id = str(uuid.uuid4())
    case_dir = settings.evidence_store_path / case_id
    case_dir.mkdir(parents=True, exist_ok=True)

    if as_ioc:
        stored = case_dir / f"{evidence_id}_{ref.name}{IOC_ARCHIVE_SUFFIX}"
        contain(ref.path, stored, settings.ioc_archive_password)
        containment = (
            f"Contained as a password-protected archive "
            f"(AES-256, password '{settings.ioc_archive_password}'). "
            f"Original SHA-256: {sha256}"
        )
    else:
        stored = case_dir / f"{evidence_id}_{ref.name}"
        shutil.copy2(ref.path, stored)
        containment = ""

    evidence = Evidence(
        id=evidence_id,
        case_id=case_id,
        name=name or ref.name,
        description=description if description is not None else ref.description,
        evidence_type=EvidenceType.malware if as_ioc else ref.evidence_type,
        acquisition_method=AcquisitionMethod.logical_copy,
        file_path=str(stored.relative_to(settings.evidence_store_path)),
        original_filename=ref.name,
        file_size=ref.path.stat().st_size,
        md5_hash=md5,
        sha256_hash=sha256,
        collected_at=ref.collected_at,
        collected_by=username,
        tags=tags if tags is not None else ref.tags,
        chain_of_custody=(
            _coc_line("Preserved in the chain of custody", username,
                      f"copied from {ref.path.name} - MD5: {md5} | SHA256: {sha256}")
            + (_coc_line("Contained", username, containment) if containment else "")
        ),
    )
    db.add(evidence)
    db.flush()

    if ref.link_back:
        ref.link_back(db, evidence_id)
    _set_retention(db, case_id, evidence_id, ref, preserved=True)

    if commit:
        db.commit()
        db.refresh(evidence)
    _ = case_title  # carried for the audit trail written by the router
    return evidence


def _set_retention(db: Session, case_id: str, evidence_id: str | None,
                   ref: SourceRef | None, *, preserved: bool) -> None:
    """
    Keep the legacy 90-day expiry in step with the chain of custody.

    `ImportedFile.expires_at` is the flag the Collection tab reads to say when a
    file will be cleaned up. Preserving an artifact has to clear it, or the tab
    would keep counting down towards an expiry on something the chain of
    custody says is kept - two parts of the same screen contradicting each
    other about whether evidence still exists.

    Matching is by name within the case: `ImportedFile` predates the ingestion
    pipeline and carries no link to it, and inventing one now would mean a
    migration guessing at rows it cannot verify.
    """
    from ..models.ez_artifacts import ImportedFile

    if ref is None:
        return

    rows = db.query(ImportedFile).filter(ImportedFile.case_id == case_id).all()
    for row in rows:
        if Path(str(row.filename)).name != ref.name:
            continue
        row.added_to_evidence = preserved
        row.evidence_id = evidence_id
        row.expires_at = None if preserved else datetime.now(UTC) + timedelta(days=90)
        db.add(row)


def withdraw(db: Session, evidence: Evidence, username: str, reason: str,
             commit: bool = True) -> None:
    """
    Remove an item from the chain of custody, and delete its preserved copy.

    Destructive on purpose and by request: leaving the bytes behind after the
    record says they were withdrawn would make the store disagree with the
    chain of custody, and the chain is the part that has to be trustworthy.
    The reason is mandatory - a withdrawal with no stated reason is exactly the
    gap a chain of custody exists to close.
    """
    if not reason.strip():
        raise PromotionError("A reason is required to withdraw an item from custody")

    if evidence.file_path:
        stored = settings.evidence_store_path / evidence.file_path
        try:
            stored.unlink(missing_ok=True)
        except OSError as e:
            raise PromotionError(f"The preserved copy could not be deleted: {e}") from e

    # Unlink whatever pointed at it, so the source stops claiming it is kept -
    # and put the expiry back, since the reason it was suspended is gone.
    name = str(evidence.original_filename or evidence.name)
    _set_retention(db, str(evidence.case_id), None,
                   SourceRef(path=Path(name), name=name,
                             evidence_type=EvidenceType.other),
                   preserved=False)

    for row in db.query(IngestedFile).filter(IngestedFile.evidence_id == evidence.id).all():
        row.evidence_id = None

    from ..models.csv_artifact import CsvArtifactFile
    for artifact in db.query(CsvArtifactFile).filter(
            CsvArtifactFile.evidence_id == evidence.id).all():
        artifact.evidence_id = None

    db.delete(evidence)
    if commit:
        db.commit()


def custody_status(db: Session, case_id: str) -> dict[str, int]:
    """How much of this case is preserved - the Collection tab header."""
    total = db.query(Evidence).filter(Evidence.case_id == case_id).count()
    contained = (
        db.query(Evidence)
        .filter(Evidence.case_id == case_id,
                Evidence.evidence_type == EvidenceType.malware)
        .count()
    )
    return {"preserved": total, "contained": contained}
