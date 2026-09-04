"""
Removing a collection and everything it produced.

Deleting a collection used to delete a directory and some rows. Every record
the ingest had created in another module stayed - the tables in the Artifact
Explorer, the files in the Logs module, the captures in PCAP - each still
listed, each pointing at bytes that were no longer on disk. An analyst who
deleted a bad import was left with its wreckage in five other pages and no way
to find it.

So deletion follows what the ingest recorded. `collection_outputs` names every
record a collection created; this walks it, removes each one from its module,
and only then removes the directory.

**Except what is preserved.** An artifact promoted to the chain of custody
outlives the collection it came from - that is the entire point of promoting
it. Those files are moved out of the collection directory first, into the
case's `preserved/`, and their records are left alone. The evidence store
already holds its own copy; this keeps the *working* copy queryable, so
narrowing a case down to the artifacts that matter is a deletion rather than a
re-import.

See `docs/INGESTION.md` section 15.
"""
from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from sqlalchemy.orm import Session

from ..config import settings
from ..models.collection_output import (
    OUTPUT_CSV_ARTIFACT,
    OUTPUT_EMAIL_FILE,
    OUTPUT_EVTX_FILE,
    OUTPUT_MEMORY_DUMP,
    CollectionOutput,
)
from ..models.csv_artifact import CsvArtifactFile
from ..models.email_file import EmailFile
from ..models.evtx import EvtxEvent, EvtxFile
from ..models.ez_artifacts import ImportedCollection, ImportedFile
from ..models.ingest import IngestedFile
from ..models.memory import MemoryDump

logger = logging.getLogger("remora.collections")


def collection_dir(case_id: str, collection_id: str) -> Path:
    """Where a collection's bytes live. `data/cases/<case>/collections/<id>/`."""
    return settings.case_data_path / "cases" / case_id / "collections" / collection_id


def preserved_dir(case_id: str) -> Path:
    """
    Where a preserved artifact's working copy is moved to.

    Outside `collections/` on purpose: everything under that path is removable
    by definition, and a file that survives collection deletion has no business
    living somewhere named after the thing that was deleted.
    """
    return settings.case_data_path / "cases" / case_id / "preserved"


# ─── What deletion will do ────────────────────────────────────────────────────

@dataclass
class Plan:
    """
    What removing a collection would remove, per module.

    Shown to the analyst before they confirm. Deleting a collection is not
    reversible and its effects reach five pages away from the one the button is
    on; a confirmation that does not say what it will take is not a
    confirmation.
    """
    tables:       int = 0   # Artifact Explorer
    event_logs:   int = 0   # Logs
    emails:       int = 0   # Email Analysis
    memory_dumps: int = 0   # Memory
    files:        int = 0   # ingest rows
    preserved:    int = 0   # kept: in the chain of custody
    bytes_on_disk: int = 0
    #: Names of what is being kept, so the analyst can see it is the right list.
    preserved_names: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "tables":          self.tables,
            "event_logs":      self.event_logs,
            "emails":          self.emails,
            "memory_dumps":    self.memory_dumps,
            "files":           self.files,
            "preserved":       self.preserved,
            "bytes_on_disk":   self.bytes_on_disk,
            "preserved_names": self.preserved_names[:50],
        }


# ─── Finding what a collection produced ───────────────────────────────────────

def _preserved_source_ids(db: Session, collection_id: str) -> set[str]:
    """
    Ingest rows for this collection that are in the chain of custody.

    Both tables are consulted. `imported_files` is the legacy Collection Import
    record and `ingested_files` the pipeline's; a collection has rows in one or
    the other depending on when and how it arrived, and reading only one of
    them would quietly destroy preserved evidence from the other.
    """
    preserved: set[str] = set()

    for row in db.query(ImportedFile).filter(
            ImportedFile.collection_id == collection_id).all():
        if row.added_to_evidence or row.evidence_id:
            preserved.add(str(row.id))

    for ingested in db.query(IngestedFile).filter(
            IngestedFile.collection_id == collection_id).all():
        if ingested.evidence_id:
            preserved.add(str(ingested.id))

    return preserved


def _outputs(db: Session, case_id: str, collection_id: str) -> list[CollectionOutput]:
    """
    Every record this collection created, recorded and inferred.

    The recorded half comes from `collection_outputs`. The inferred half exists
    because that table shipped after the collections already in the database:
    any record whose file lives inside the collection directory came from it,
    whatever was or was not written down at the time. Without this, upgrading
    leaves every existing collection undeletable in the way that matters.
    """
    rows = list(
        db.query(CollectionOutput)
        .filter(CollectionOutput.collection_id == collection_id)
        .all()
    )
    known = {(r.kind, str(r.record_id)) for r in rows}

    root = str(collection_dir(case_id, collection_id).resolve())

    def _inside(path: object) -> bool:
        text = str(path or "")
        return bool(text) and text.startswith(root)

    inferred: list[tuple[str, object, object]] = []
    for record in db.query(CsvArtifactFile).filter(
            CsvArtifactFile.case_id == case_id).all():
        if _inside(record.file_path):
            inferred.append((OUTPUT_CSV_ARTIFACT, record.id, record.file_path))
    for evtx in db.query(EvtxFile).filter(EvtxFile.case_id == case_id).all():
        if _inside(evtx.file_path):
            inferred.append((OUTPUT_EVTX_FILE, evtx.id, evtx.file_path))
    for dump in db.query(MemoryDump).filter(MemoryDump.case_id == case_id).all():
        if _inside(dump.file_path):
            inferred.append((OUTPUT_MEMORY_DUMP, dump.id, dump.file_path))

    for kind, record_id, path in inferred:
        if (kind, str(record_id)) in known:
            continue
        rows.append(CollectionOutput(
            case_id=case_id, collection_id=collection_id, kind=kind,
            record_id=str(record_id), file_path=str(path)))
        known.add((kind, str(record_id)))

    return rows


def _is_preserved(db: Session, output: CollectionOutput,
                  preserved_sources: set[str]) -> bool:
    """Whether this record must survive the collection."""
    if output.source_file_id and str(output.source_file_id) in preserved_sources:
        return True
    if output.kind == OUTPUT_CSV_ARTIFACT:
        record = db.get(CsvArtifactFile, str(output.record_id))
        return bool(record and record.evidence_id)
    return False


def _directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for child in path.rglob("*"):
        try:
            if child.is_file():
                total += child.stat().st_size
        except OSError:
            pass
    return total


def plan(db: Session, col: ImportedCollection) -> Plan:
    """What deleting this collection would remove. Reads only."""
    case_id = str(col.case_id)
    collection_id = str(col.id)

    preserved_sources = _preserved_source_ids(db, collection_id)
    result = Plan()
    result.files = db.query(ImportedFile).filter(
        ImportedFile.collection_id == collection_id).count()
    result.bytes_on_disk = _directory_size(collection_dir(case_id, collection_id))

    counters = {
        OUTPUT_CSV_ARTIFACT: "tables",
        OUTPUT_EVTX_FILE:    "event_logs",
        OUTPUT_EMAIL_FILE:   "emails",
        OUTPUT_MEMORY_DUMP:  "memory_dumps",
    }

    for output in _outputs(db, case_id, collection_id):
        if _is_preserved(db, output, preserved_sources):
            result.preserved += 1
            result.preserved_names.append(Path(str(output.file_path or "")).name
                                          or str(output.record_id))
            continue
        attribute = counters.get(str(output.kind))
        if attribute:
            setattr(result, attribute, getattr(result, attribute) + 1)

    return result


# ─── Doing it ─────────────────────────────────────────────────────────────────

def _unlink(path: object) -> None:
    """
    Remove one file, if it is still there.

    Called for every deleted output, including the ones inside the collection
    directory that `shutil.rmtree` would have taken anyway. The ones that
    matter are outside it: the Logs module and the Memory module each keep
    their own copy under the case directory, and nothing else would remove it.
    """
    text = str(path or "")
    if not text:
        return
    try:
        Path(text).unlink(missing_ok=True)
    except OSError as e:
        logger.warning("could not remove %s: %s", text, e)


def _delete_record(db: Session, output: CollectionOutput) -> bool:
    """Remove one record from its module. A record already gone counts as done."""
    kind = str(output.kind)
    record_id = str(output.record_id)

    if kind == OUTPUT_CSV_ARTIFACT:
        from .store import drop_cache

        table = db.get(CsvArtifactFile, record_id)
        if table is None:
            return False
        drop_cache(Path(str(table.file_path)))
        db.delete(table)
        return True

    if kind == OUTPUT_EVTX_FILE:
        evtx = db.get(EvtxFile, record_id)
        if evtx is None:
            return False
        # The events carry no cascade of their own, so they are removed here.
        # Left behind they are unreachable rows that still answer a count.
        db.query(EvtxEvent).filter(EvtxEvent.file_id == record_id).delete(
            synchronize_session=False)
        db.delete(evtx)
        return True

    if kind == OUTPUT_EMAIL_FILE:
        message = db.get(EmailFile, record_id)
        if message is None:
            return False
        db.delete(message)
        return True

    if kind == OUTPUT_MEMORY_DUMP:
        dump = db.get(MemoryDump, record_id)
        if dump is None:
            return False
        db.delete(dump)
        return True

    logger.warning("no resolver for output kind %r; record %s left in place",
                   kind, record_id)
    return False


def _repoint(record: object, path: Path) -> None:
    """
    Point a record at a file that has moved.

    Cast because the destination models declare bare `Column()`, so a type
    checker sees the descriptor rather than the string the instance holds.
    Annotating them properly is a change to three shipped models for the sake
    of one assignment here, and this file is not where that should happen.
    """
    cast(Any, record).file_path = str(path)


def _rescue(db: Session, output: CollectionOutput, case_id: str) -> None:
    """
    Move a preserved artifact's working copy out of the collection.

    The chain of custody already holds a copy in the evidence store; this is
    the one the Explorer reads. Leaving it where it is would mean the table
    survives the deletion and opens empty, which is the failure this whole
    change exists to remove.
    """
    from .store import drop_cache

    source = Path(str(output.file_path or ""))
    if not output.file_path or not source.exists():
        return

    target_dir = preserved_dir(case_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    n = 1
    while target.exists():
        target = target_dir / f"{source.stem}_{n}{source.suffix}"
        n += 1

    try:
        shutil.move(str(source), str(target))
    except OSError as e:
        logger.warning("could not preserve %s: %s", source, e)
        return

    if str(output.kind) == OUTPUT_CSV_ARTIFACT:
        table = db.get(CsvArtifactFile, str(output.record_id))
        if table is not None:
            drop_cache(Path(str(table.file_path)))
            _repoint(table, target)
    elif str(output.kind) == OUTPUT_EVTX_FILE:
        evtx = db.get(EvtxFile, str(output.record_id))
        if evtx is not None:
            _repoint(evtx, target)
    elif str(output.kind) == OUTPUT_MEMORY_DUMP:
        dump = db.get(MemoryDump, str(output.record_id))
        if dump is not None:
            _repoint(dump, target)


def delete(db: Session, col: ImportedCollection) -> Plan:
    """
    Remove the collection, everything it produced, and its bytes.

    Returns what was removed, in the same shape `plan()` reports - so the
    confirmation the analyst saw and the result they are told about are the
    same numbers.

    Order matters. Preserved files are moved out **before** the directory goes,
    because afterwards there is nothing to move.
    """
    case_id = str(col.case_id)
    collection_id = str(col.id)

    preserved_sources = _preserved_source_ids(db, collection_id)
    outputs = _outputs(db, case_id, collection_id)
    result = Plan()
    result.files = db.query(ImportedFile).filter(
        ImportedFile.collection_id == collection_id).count()
    result.bytes_on_disk = _directory_size(collection_dir(case_id, collection_id))

    counters = {
        OUTPUT_CSV_ARTIFACT: "tables",
        OUTPUT_EVTX_FILE:    "event_logs",
        OUTPUT_EMAIL_FILE:   "emails",
        OUTPUT_MEMORY_DUMP:  "memory_dumps",
    }

    for output in outputs:
        if _is_preserved(db, output, preserved_sources):
            _rescue(db, output, case_id)
            result.preserved += 1
            result.preserved_names.append(Path(str(output.file_path or "")).name
                                          or str(output.record_id))
            continue
        if _delete_record(db, output):
            _unlink(output.file_path)
            attribute = counters.get(str(output.kind))
            if attribute:
                setattr(result, attribute, getattr(result, attribute) + 1)

    db.flush()

    directory = collection_dir(case_id, collection_id)
    if directory.exists():
        shutil.rmtree(directory, ignore_errors=True)

    # Last: the collection row cascades its ingest records and its output rows.
    db.delete(col)
    db.commit()
    return result
