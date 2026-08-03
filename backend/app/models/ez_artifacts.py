"""
SQLAlchemy models for EZ Tools artifact processing.

Covers: ImportedCollection, ImportedFile, Shimcache, Amcache,
        LNK, JumpLists, Shellbags, RecycleBin, WindowsTimeline,
        SRUM (app usage + network), RegistryBatch.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey,
    Integer, String, Text, BigInteger,
)
from sqlalchemy.orm import relationship

from ..database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


# ─────────────────────────────────────────────────────────────────────────────
# Collection import tracking
# ─────────────────────────────────────────────────────────────────────────────

class ImportedCollection(Base):
    """One ZIP upload associated with a case."""
    __tablename__ = "imported_collections"

    id          = Column(String, primary_key=True, default=_uuid)
    case_id     = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id  = Column(String, index=True)   # groups batched CSV uploads into one logical session
    filename    = Column(String, nullable=False)
    file_size   = Column(BigInteger, default=0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    status      = Column(String, default="pending")   # pending|processing|done|error
    total_files     = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    error_message   = Column(Text)

    files = relationship("ImportedFile", back_populates="collection",
                         cascade="all, delete-orphan")


class ImportedFile(Base):
    """One CSV file extracted from an ImportedCollection ZIP."""
    __tablename__ = "imported_files"

    id            = Column(String, primary_key=True, default=_uuid)
    collection_id = Column(String, ForeignKey("imported_collections.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    case_id       = Column(String, ForeignKey("cases.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    filename      = Column(String, nullable=False)   # original name inside ZIP
    file_size     = Column(BigInteger, default=0)

    # Detection result
    category       = Column(String)   # shimcache | amcache_files | lnk | ...
    category_label = Column(String)   # human-readable
    destination_page  = Column(String)   # frontend route, e.g. /cases/{id}/execution
    destination_label = Column(String)   # "Execution Artifacts"

    # Ingest status
    status        = Column(String, default="pending")  # pending|imported|error|unsupported
    row_count     = Column(Integer, default=0)
    error_message = Column(Text)
    imported_at   = Column(DateTime)

    # Link to Artifact Explorer record (set after CSV ingest)
    csv_artifact_id   = Column(String, nullable=True)  # FK to csv_artifact_files.id

    # Retention
    added_to_evidence = Column(Boolean, default=False)
    evidence_id       = Column(String)                 # FK to evidences.id if added
    expires_at        = Column(DateTime)               # +90 days unless in evidence

    collection = relationship("ImportedCollection", back_populates="files")


# ─────────────────────────────────────────────────────────────────────────────
# Shimcache (AppCompatCacheParser)
# ─────────────────────────────────────────────────────────────────────────────

class ShimcacheEntry(Base):
    __tablename__ = "shimcache_entries"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    control_set     = Column(Integer)
    cache_position  = Column(Integer)
    path            = Column(Text)
    last_modified   = Column(DateTime)
    executed        = Column(String)   # Yes | No | NA
    duplicate       = Column(Boolean, default=False)
    source_hive     = Column(Text)


# ─────────────────────────────────────────────────────────────────────────────
# Amcache (AmcacheParser)
# ─────────────────────────────────────────────────────────────────────────────

class AmcacheFileEntry(Base):
    """Covers both UnassociatedFileEntries and AssociatedFileEntries."""
    __tablename__ = "amcache_file_entries"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    case_id          = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id          = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_type       = Column(String)   # unassociated | associated
    application_name = Column(Text)
    program_id       = Column(String)
    file_key_last_write = Column(DateTime)
    sha1             = Column(String, index=True)
    is_os_component  = Column(Boolean)
    full_path        = Column(Text)
    name             = Column(Text)
    file_extension   = Column(String)
    link_date        = Column(DateTime)
    product_name     = Column(Text)
    size             = Column(BigInteger)
    version          = Column(String)
    is_pe_file       = Column(Boolean)
    language         = Column(String)
    description      = Column(Text)


class AmcacheProgramEntry(Base):
    __tablename__ = "amcache_program_entries"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    program_id      = Column(String)
    key_last_write  = Column(DateTime)
    name            = Column(Text)
    version         = Column(String)
    publisher       = Column(Text)
    install_date    = Column(DateTime)
    root_dir_path   = Column(Text)
    uninstall_string = Column(Text)
    source          = Column(String)


# ─────────────────────────────────────────────────────────────────────────────
# LNK files (LECmd)
# ─────────────────────────────────────────────────────────────────────────────

class LnkEntry(Base):
    __tablename__ = "lnk_entries"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    source_file     = Column(Text)
    source_created  = Column(DateTime)
    source_modified = Column(DateTime)
    source_accessed = Column(DateTime)
    target_created  = Column(DateTime)
    target_modified = Column(DateTime)
    target_accessed = Column(DateTime)
    file_size       = Column(BigInteger)
    local_path      = Column(Text)
    network_path    = Column(Text)
    common_path     = Column(Text)
    arguments       = Column(Text)
    target_path     = Column(Text)   # TargetIDAbsolutePath
    machine_id      = Column(String)
    mac_address     = Column(String)
    drive_type      = Column(String)
    volume_serial   = Column(String)
    volume_label    = Column(String)
    relative_path   = Column(Text)
    working_dir     = Column(Text)


# ─────────────────────────────────────────────────────────────────────────────
# Jump Lists (JLECmd)
# ─────────────────────────────────────────────────────────────────────────────

class JumpListEntry(Base):
    __tablename__ = "jumplist_entries"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    case_id          = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id          = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    jl_type          = Column(String)   # automatic | custom
    source_file      = Column(Text)
    app_id           = Column(String)
    app_description  = Column(Text)
    mru              = Column(Integer)
    entry_number     = Column(Integer)
    creation_time    = Column(DateTime)
    last_modified    = Column(DateTime)
    hostname         = Column(String)
    mac_address      = Column(String)
    path             = Column(Text)
    interaction_count = Column(Integer)
    pin_status       = Column(String)
    target_created   = Column(DateTime)
    target_modified  = Column(DateTime)
    local_path       = Column(Text)
    target_path      = Column(Text)
    file_size        = Column(BigInteger)
    drive_type       = Column(String)
    volume_serial    = Column(String)
    arguments        = Column(Text)


# ─────────────────────────────────────────────────────────────────────────────
# Shellbags (SBECmd)
# ─────────────────────────────────────────────────────────────────────────────

class ShellbagEntry(Base):
    __tablename__ = "shellbag_entries"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    bag_path        = Column(String)
    slot            = Column(Integer)
    mru_position    = Column(Integer)
    absolute_path   = Column(Text)
    shell_type      = Column(String)
    created_on      = Column(DateTime)
    modified_on     = Column(DateTime)
    accessed_on     = Column(DateTime)
    last_write_time = Column(DateTime)
    first_interacted = Column(DateTime)
    last_interacted  = Column(DateTime)
    has_explored    = Column(Boolean)
    hive_source     = Column(String)   # NTUSER | UsrClass


# ─────────────────────────────────────────────────────────────────────────────
# Recycle Bin (RBCmd)
# ─────────────────────────────────────────────────────────────────────────────

class RecycleBinEntry(Base):
    __tablename__ = "recycle_bin_entries"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    case_id     = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id     = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    source_name = Column(Text)    # $I file path (contains SID)
    file_type   = Column(String)  # $I or $R
    file_name   = Column(Text)    # original deleted path
    file_size   = Column(BigInteger)
    deleted_on  = Column(DateTime)
    sid         = Column(String, index=True)   # extracted from path


# ─────────────────────────────────────────────────────────────────────────────
# Windows Timeline (WxTCmd)
# ─────────────────────────────────────────────────────────────────────────────

class WindowsTimelineEntry(Base):
    __tablename__ = "windows_timeline_entries"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_type   = Column(String)
    executable      = Column(Text)
    display_text    = Column(Text)
    content_info    = Column(Text)
    start_time      = Column(DateTime)
    end_time        = Column(DateTime)
    duration        = Column(String)
    last_modified   = Column(DateTime)
    platform        = Column(String)


# ─────────────────────────────────────────────────────────────────────────────
# SRUM (SrumECmd)
# ─────────────────────────────────────────────────────────────────────────────

class SrumAppUsage(Base):
    __tablename__ = "srum_app_usage"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    case_id          = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id          = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp        = Column(DateTime, index=True)
    exe_info         = Column(Text)
    exe_description  = Column(Text)
    user_name        = Column(String)
    sid              = Column(String)
    bg_bytes_read    = Column(BigInteger)
    bg_bytes_written = Column(BigInteger)
    fg_bytes_read    = Column(BigInteger)
    fg_bytes_written = Column(BigInteger)
    face_time        = Column(BigInteger)


class SrumNetworkUsage(Base):
    __tablename__ = "srum_network_usage"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    case_id         = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id         = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp       = Column(DateTime, index=True)
    exe_info        = Column(Text)
    exe_description = Column(Text)
    user_name       = Column(String)
    sid             = Column(String)
    bytes_received  = Column(BigInteger)
    bytes_sent      = Column(BigInteger)
    profile_name    = Column(Text)
    interface_type  = Column(String)


# ─────────────────────────────────────────────────────────────────────────────
# Registry Batch output (RECmd)
# ─────────────────────────────────────────────────────────────────────────────

class RegistryBatchEntry(Base):
    __tablename__ = "registry_batch_entries"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    case_id             = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_id             = Column(String, ForeignKey("imported_files.id", ondelete="CASCADE"), nullable=False, index=True)
    hive_path           = Column(Text)
    hive_type           = Column(String)
    description         = Column(Text)
    category            = Column(String, index=True)
    key_path            = Column(Text)
    value_name          = Column(String)
    value_type          = Column(String)
    value_data          = Column(Text)
    value_data2         = Column(Text)
    value_data3         = Column(Text)
    comment             = Column(Text)
    last_write_timestamp = Column(DateTime)
    plugin_detail_file  = Column(String)
