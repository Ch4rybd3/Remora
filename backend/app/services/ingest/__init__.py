"""
The single ingestion path (`docs/INGESTION.md`).

Everything entering a case goes through here, whichever door it used: the drop
folder on the host, the Collection tab's upload, an unpacked archive member, a
connector. Identification, deduplication and routing live in one place so they
can be tested in one place and cannot disagree between entry points.
"""
# `dispatch_file`, not `dispatch`: the submodule is called dispatch, and a
# function of the same name would shadow it for anyone writing
# `from app.services.ingest import dispatch`.
from .dispatch import ParseResult, dispatch_file, handled_kinds, has_handler, parse
from .identify import Identification, identify, identify_bytes
from .routing import (
    ARCHIVE_KINDS,
    KNOWN_KINDS,
    Route,
    destination_pages,
    is_archive_kind,
    route_for,
)
from .service import (
    case_summary,
    compute_sha256,
    find_duplicate,
    force_kind,
    record,
)

__all__ = [
    "ARCHIVE_KINDS",
    "KNOWN_KINDS",
    "Identification",
    "ParseResult",
    "Route",
    "case_summary",
    "compute_sha256",
    "destination_pages",
    "dispatch_file",
    "find_duplicate",
    "handled_kinds",
    "force_kind",
    "identify",
    "has_handler",
    "identify_bytes",
    "is_archive_kind",
    "parse",
    "record",
    "route_for",
]
