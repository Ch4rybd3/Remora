"""
The ingestion state machine.

What these tests hold in place is the design rule from `docs/INGESTION.md`
section 4: **no state discards the file.** Every path through `record()` ends
with a persisted row, including the paths for duplicates, for files nothing
could identify, and for files that could not be read at all.
"""
from __future__ import annotations

from pathlib import Path

from app.models.ingest import (
    DETECTED_BY_FORCED,
    DETECTED_BY_MAGIC,
    ORIGIN_DROPZONE,
    ORIGIN_UPLOAD,
    STATE_DUPLICATE,
    STATE_ROUTED,
    STATE_UNIDENTIFIED,
    STATE_UNSUPPORTED,
    IngestedFile,
)
from app.services.ingest import service
from app.services.ingest.routing import route_for

EVTX  = b"ElfFile\x00" + b"\x00" * 128
HIVE  = b"regf" + b"\x00" * 128
PCAP  = b"\xd4\xc3\xb2\xa1" + b"\x00" * 128


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


# ─── Hashing ──────────────────────────────────────────────────────────────────

def test_sha256_matches_hashlib(tmp_path: Path):
    import hashlib

    payload = b"x" * (3 * 1024 * 1024 + 17)   # spans several read chunks
    p = _write(tmp_path, "big.bin", payload)
    assert service.compute_sha256(p) == hashlib.sha256(payload).hexdigest()


# ─── The happy path ───────────────────────────────────────────────────────────

def test_a_recognised_artifact_is_routed(db_session, case_id, tmp_path: Path):
    row = service.record(
        db_session, case_id=case_id,
        path=_write(tmp_path, "Security.evtx", EVTX),
    )
    assert row.state == STATE_ROUTED
    assert row.detected_kind == "evtx"
    assert row.detection_source == DETECTED_BY_MAGIC
    assert row.routed_to == "logs"
    assert row.sha256 and len(row.sha256) == 64
    assert row.size_bytes == len(EVTX)


def test_the_row_survives_the_session(db_session, case_id, tmp_path: Path):
    row = service.record(db_session, case_id=case_id,
                         path=_write(tmp_path, "a.evtx", EVTX))
    found = db_session.query(IngestedFile).filter_by(id=row.id).one()
    assert found.detected_kind == "evtx"


def test_origin_is_the_only_difference_between_the_two_doors(
    db_session, case_id, tmp_path: Path
):
    """
    The contract from `docs/INGESTION.md` section 2, asserted rather than
    promised: an artifact uploaded from the Collection tab and the same
    artifact dropped by scp differ in `origin` and `origin_detail`, and in
    nothing else that governs how it is handled.
    """
    dropped  = service.record(db_session, case_id=case_id,
                              path=_write(tmp_path, "one.evtx", EVTX),
                              origin=ORIGIN_DROPZONE)
    uploaded = service.record(db_session, case_id=case_id,
                              path=_write(tmp_path, "two.evtx", EVTX + b"\x01"),
                              origin=ORIGIN_UPLOAD, origin_detail="admin")

    def routing_facts(row: IngestedFile) -> tuple:
        return (row.detected_kind, row.detection_source, row.routed_to,
                row.state, row.magic_type)

    assert routing_facts(dropped) == routing_facts(uploaded)
    assert dropped.origin != uploaded.origin


# ─── Deduplication ────────────────────────────────────────────────────────────

def test_the_same_file_twice_in_one_case_is_a_duplicate(
    db_session, case_id, tmp_path: Path
):
    first  = service.record(db_session, case_id=case_id,
                            path=_write(tmp_path, "Security.evtx", EVTX))
    second = service.record(db_session, case_id=case_id,
                            path=_write(tmp_path, "copy-of-Security.evtx", EVTX))

    assert first.state == STATE_ROUTED
    assert second.state == STATE_DUPLICATE
    # Recorded, not refused - the analyst needs to see that they dropped it twice.
    assert second.id is not None
    assert "Security.evtx" in (second.error or "")


def test_the_same_file_in_two_cases_is_not_a_duplicate(
    db_session, case_id, tmp_path: Path
):
    """
    Blocking globally would corrupt the second investigation.

    The same EVTX legitimately belongs to two cases, so deduplication is scoped
    to one - see `find_duplicate`.
    """
    import uuid

    from app.models.case import Case

    other = str(uuid.uuid4())
    db_session.add(Case(id=other, title="Second case"))
    db_session.commit()

    a = service.record(db_session, case_id=case_id,
                       path=_write(tmp_path, "shared.evtx", EVTX))
    b = service.record(db_session, case_id=other,
                       path=_write(tmp_path, "shared-again.evtx", EVTX))

    assert a.sha256 == b.sha256
    assert b.state == STATE_ROUTED


def test_a_duplicate_of_a_duplicate_points_at_the_original(
    db_session, case_id, tmp_path: Path
):
    """
    Three copies must all reference the first, not form a chain.

    `find_duplicate` excludes rows already marked duplicate for exactly this
    reason: otherwise the third copy would cite the second, and tracing back to
    the file actually held on disk would mean walking a linked list.
    """
    first  = service.record(db_session, case_id=case_id,
                            path=_write(tmp_path, "a.evtx", EVTX))
    second = service.record(db_session, case_id=case_id,
                            path=_write(tmp_path, "b.evtx", EVTX))
    third  = service.record(db_session, case_id=case_id,
                            path=_write(tmp_path, "c.evtx", EVTX))

    assert second.parsed_artifact_id == first.id
    assert third.parsed_artifact_id == first.id


# ─── The recoverable states ───────────────────────────────────────────────────

def test_an_unidentified_file_is_kept_not_rejected(db_session, case_id, tmp_path: Path):
    row = service.record(db_session, case_id=case_id,
                         path=_write(tmp_path, "mystery", b"\xff\xfe\xab\xcd" + b"\x99" * 64))
    assert row.state == STATE_UNIDENTIFIED
    assert row.routed_to == "collection"
    assert row.sha256 is not None      # hashed before identification failed


def test_a_missing_file_produces_a_row_with_an_error(db_session, case_id, tmp_path: Path):
    """A file that vanished between discovery and hashing is still a fact."""
    row = service.record(db_session, case_id=case_id, path=tmp_path / "gone.evtx")
    assert row.state == STATE_UNIDENTIFIED
    assert row.error


def test_a_kind_whose_parser_has_not_shipped_is_unsupported(
    db_session, case_id, tmp_path: Path
):
    """
    The NTFS transaction log is recognised and nothing reads it yet.

    `unsupported` is the honest answer: the file is stored and listed, it is
    simply not queryable yet. Refusing it would be a lie about what Remora can
    hold.

    This used to be demonstrated with a registry hive. Hives are now browsable
    key by key, so they are no longer an example of a kind nothing handles -
    see `test_a_registry_hive_is_routed_to_the_browser`.
    """
    row = service.record(db_session, case_id=case_id,
                         path=_write(tmp_path, "$LogFile", b"\x00" * 128))
    assert row.detected_kind == "ntfs_logfile"
    assert row.state == STATE_UNSUPPORTED


def test_a_registry_hive_is_routed_to_the_browser(db_session, case_id, tmp_path: Path):
    """
    A hive is not a gap in the pipeline any more.

    Which keys matter is still an analyst's decision - Remora ships no list of
    them - but supplying the navigation is not the same as refusing the file,
    and the row should not read as one nothing could be done with.
    """
    row = service.record(db_session, case_id=case_id,
                         path=_write(tmp_path, "SOFTWARE", HIVE))
    assert row.detected_kind == "registry_hive"
    assert row.state != STATE_UNSUPPORTED
    assert "/artifacts/registry" in route_for("registry_hive").pages


def test_forcing_a_kind_reroutes_the_file(db_session, case_id, tmp_path: Path):
    row = service.record(db_session, case_id=case_id,
                         path=_write(tmp_path, "mystery", b"\xff\xfe" + b"\x99" * 64))
    assert row.state == STATE_UNIDENTIFIED

    service.force_kind(db_session, row, "pcap")
    assert row.detected_kind == "pcap"
    assert row.detection_source == DETECTED_BY_FORCED
    assert row.state == STATE_ROUTED
    assert row.routed_to == "pcap"
    assert row.error is None


# ─── Provenance ───────────────────────────────────────────────────────────────

def test_an_archive_member_points_back_at_its_container(
    db_session, case_id, tmp_path: Path
):
    container = service.record(db_session, case_id=case_id,
                               path=_write(tmp_path, "triage.zip", b"PK\x03\x04" + b"\x00" * 64))
    member = service.record(
        db_session, case_id=case_id,
        path=_write(tmp_path, "Security.evtx", EVTX),
        origin="archive", origin_detail="triage.zip", parent_id=container.id,
    )
    assert container.detected_kind == "archive_zip"
    assert container.routed_to == "unpack"
    assert member.parent_id == container.id


def test_case_summary_counts_states(db_session, case_id, tmp_path: Path):
    service.record(db_session, case_id=case_id, path=_write(tmp_path, "a.evtx", EVTX))
    service.record(db_session, case_id=case_id, path=_write(tmp_path, "b.evtx", EVTX))
    service.record(db_session, case_id=case_id, path=_write(tmp_path, "c.pcap", PCAP))

    summary = service.case_summary(db_session, case_id)
    assert summary[STATE_ROUTED] == 2       # one evtx + one pcap
    assert summary[STATE_DUPLICATE] == 1    # the second evtx
