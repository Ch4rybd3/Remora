"""
Where does an identified file go?

A table, not a chain of `if` statements. Adding support for a new artifact is
one row here plus one parser — not an edit inside a router, which is how the
current logic ended up duplicated across fourteen of them with no two agreeing.

The rule the table encodes (`docs/INGESTION.md` section 6): **two destinations
are the norm.** A raw EVTX belongs in the Logs module *and*, once parsed, in
the Artifact Explorer. The analyst chasing Sigma detections goes to Logs; the
one pivoting on a field goes to the Explorer. Producing only one of the two is
exactly what forces the manual re-import that exists today.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ─── Destination modules ──────────────────────────────────────────────────────

DEST_EXPLORER   = "artifact_explorer"
DEST_LOGS       = "logs"
DEST_DISK       = "disk_images"
DEST_MEMORY     = "memory"
DEST_MAIL       = "email_analysis"
DEST_PCAP       = "pcap"
DEST_BINARY     = "binary_analysis"
DEST_COLLECTION = "collection"      # held for an analyst decision
DEST_UNPACK     = "unpack"          # not a destination: re-enters the pipeline


@dataclass(frozen=True)
class Route:
    #: Module that owns the raw file. `None` means the Explorer is the only home.
    primary: str | None
    #: Parser producing the tabular form the Explorer indexes. `None` means the
    #: file is already tabular, or that no parser exists yet.
    parser: str | None = None
    #: False for kinds that are stored and listed but never parsed.
    to_explorer: bool = True
    #: Set when the parser is specified but not yet shipped. The file is kept
    #: and listed as `unsupported` rather than being refused - a pipeline that
    #: rejects files becomes a prison, and analysts route around prisons.
    pending: bool = False
    #: Frontend routes offered as "open in" links from the Collection tab.
    pages: tuple[str, ...] = field(default_factory=tuple)


#: `{case_id}` is substituted at read time by `destination_pages()`.
_ROUTES: dict[str, Route] = {
    # ── Already tabular: straight into the Explorer ──────────────────────────
    "csv":    Route(None, pages=("/artifacts/explorer",)),
    "json":   Route(None, pages=("/artifacts/explorer",)),
    "jsonl":  Route(None, pages=("/artifacts/explorer",)),
    "text":   Route(None, pages=("/artifacts/explorer",)),
    "log":    Route(None, pages=("/artifacts/explorer",)),
    "xml":    Route(None, pages=("/artifacts/explorer",)),

    # ── Windows event logs ──────────────────────────────────────────────────
    "evtx":   Route(DEST_LOGS, parser="evtxecmd",
                    pages=("/cases/{case_id}/evtx", "/artifacts/explorer")),
    "evt":    Route(DEST_LOGS, parser="evtxecmd", pending=True,
                    pages=("/cases/{case_id}/evtx",)),

    # ── NTFS metadata ───────────────────────────────────────────────────────
    "mft":            Route(DEST_LOGS, parser="mftecmd",
                            pages=("/cases/{case_id}/mft", "/artifacts/explorer")),
    "usnjrnl":        Route(DEST_LOGS, parser="mftecmd",
                            pages=("/cases/{case_id}/usn", "/artifacts/explorer")),
    "ntfs_logfile":   Route(None, parser="logfile", pending=True),
    "ntfs_secure":    Route(None, parser=None, to_explorer=False),

    # ── Registry and execution artifacts (S16 parsers) ──────────────────────
    # Two destinations, like an EVTX. Amcache, SYSTEM and the user hives produce
    # tables; every hive, those included, is browsable key by key.
    "registry_hive":  Route(None, parser=None,
                            pages=("/artifacts/registry", "/artifacts/explorer")),
    "registry_log":   Route(None, parser=None, to_explorer=False),
    "prefetch":       Route(None, parser="pecmd",   pending=True),
    "lnk":            Route(None, parser="lecmd",   pending=True),
    "jumplist_auto":  Route(None, parser="jlecmd",  pending=True),
    "jumplist_custom": Route(None, parser="jlecmd", pending=True),
    # Read here rather than by SrumECmd, which is Windows-only. One table per
    # provider: `network_data` is bytes on the wire per application per user,
    # which is the artifact for "what left this machine".
    "srum":           Route(None, parser="srum", pages=("/artifacts/explorer",)),
    # 538 of the 2,058 files in the reference triage - the largest single group
    # in it, and the record of what was deleted, from where, and when.
    "recycle_bin":    Route(None, parser="rbcmd", pages=("/artifacts/explorer",)),
    # 272 in the same triage, all previously unidentified. Persistence lives
    # here, which makes them the artifacts it was worst to be missing.
    "scheduled_task": Route(None, parser="scheduled_tasks",
                            pages=("/artifacts/explorer",)),
    "windows_timeline": Route(None, parser="wxtcmd", pending=True),
    # Dumped table by table. Neither has a reader that understands what the
    # tables mean - NTDS needs the SYSTEM hive's boot key before anything in it
    # decrypts - but the rows are there and queryable, which beats being listed
    # as unsupported indefinitely.
    "ntds":           Route(None, parser="ese_tables", pages=("/artifacts/explorer",)),
    "search_index":   Route(None, parser="ese_tables", pages=("/artifacts/explorer",)),

    # ── Browser ─────────────────────────────────────────────────────────────
    "browser_history": Route(None, parser="browser", pending=True),
    "browser_cookies": Route(None, parser="browser", pending=True),
    # An ESE database, not SQLite - which is why the browser parser cannot read
    # it and this has its own.
    "browser_cache":   Route(None, parser="webcache", pages=("/artifacts/explorer",)),

    # ── Disk images ─────────────────────────────────────────────────────────
    "ewf":      Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),
    "vmdk":     Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),
    "vhd":      Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),
    "vhdx":     Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),
    "qcow":     Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),
    "ad1":      Route(DEST_DISK, parser="filesystem_listing", pending=True,
                      pages=("/cases/{case_id}/disk-images",)),
    "disk_raw": Route(DEST_DISK, parser="filesystem_listing",
                      pages=("/cases/{case_id}/disk-images",)),

    # ── Memory ──────────────────────────────────────────────────────────────
    # Raw dumps carry no signature saying which OS they came from, so they
    # cannot be parsed without an analyst choosing one. The two below can.
    "memory_dump": Route(DEST_MEMORY, parser="volatility",
                         pages=("/cases/{case_id}/memory", "/artifacts/explorer")),
    "memory_dump_windows": Route(DEST_MEMORY, parser="volatility",
                                 pages=("/cases/{case_id}/memory", "/artifacts/explorer")),
    "memory_dump_linux":   Route(DEST_MEMORY, parser="volatility",
                                 pages=("/cases/{case_id}/memory", "/artifacts/explorer")),
    # A page file holds memory but no Volatility profile reads it directly.
    # Kept and listed so it can be carved later; not parsed.
    "pagefile":  Route(DEST_MEMORY, parser=None, to_explorer=False,
                       pages=("/cases/{case_id}/memory",)),
    "hiberfil":  Route(DEST_MEMORY, parser="hibernation", pending=True,
                       pages=("/cases/{case_id}/memory",)),

    # ── Mail ────────────────────────────────────────────────────────────────
    "eml":   Route(DEST_MAIL, parser="mail",
                   pages=("/cases/{case_id}/emails", "/artifacts/explorer")),
    "msg":   Route(DEST_MAIL, parser="mail",
                   pages=("/cases/{case_id}/emails", "/artifacts/explorer")),
    "mbox":  Route(DEST_MAIL, parser="mail", pending=True,
                   pages=("/cases/{case_id}/emails",)),
    "pst":   Route(DEST_MAIL, parser="mail", pending=True,
                   pages=("/cases/{case_id}/emails",)),

    # ── Network ─────────────────────────────────────────────────────────────
    "pcap":   Route(DEST_PCAP, parser="pcap",
                    pages=("/cases/{case_id}/pcap", "/artifacts/explorer")),
    "pcapng": Route(DEST_PCAP, parser="pcap",
                    pages=("/cases/{case_id}/pcap", "/artifacts/explorer")),

    # ── Executables ─────────────────────────────────────────────────────────
    "pe":    Route(DEST_BINARY, parser="binary",
                   pages=("/cases/{case_id}/binary", "/artifacts/explorer")),
    "elf":   Route(DEST_BINARY, parser="binary",
                   pages=("/cases/{case_id}/binary", "/artifacts/explorer")),
    "macho": Route(DEST_BINARY, parser="binary",
                   pages=("/cases/{case_id}/binary", "/artifacts/explorer")),

    # ── Containers: unpacked, then every member re-enters the pipeline ──────
    "archive_zip":   Route(DEST_UNPACK, to_explorer=False),
    "archive_7z":    Route(DEST_UNPACK, to_explorer=False),
    "archive_rar":   Route(DEST_UNPACK, to_explorer=False),
    "archive_tar":   Route(DEST_UNPACK, to_explorer=False),
    "archive_gzip":  Route(DEST_UNPACK, to_explorer=False),
    "archive_bzip2": Route(DEST_UNPACK, to_explorer=False),
    "archive_xz":    Route(DEST_UNPACK, to_explorer=False),

    # ── Held for a decision ─────────────────────────────────────────────────
    "sqlite":       Route(DEST_COLLECTION, to_explorer=False),
    # No longer held: an ESE database whose artifact nobody has written a
    # reader for is dumped table by table. Not a good answer, a true one.
    "ese":          Route(None, parser="ese_tables", pages=("/artifacts/explorer",)),
    "olecf":        Route(DEST_COLLECTION, to_explorer=False),
    "binary_blob":  Route(DEST_COLLECTION, to_explorer=False),
    "pdf":          Route(DEST_COLLECTION, to_explorer=False),
    "empty":        Route(DEST_COLLECTION, to_explorer=False),
    "unknown":      Route(DEST_COLLECTION, to_explorer=False),
}

#: Kinds whose members are unpacked and fed back through identification.
ARCHIVE_KINDS = frozenset(k for k, r in _ROUTES.items() if r.primary == DEST_UNPACK)

#: Every kind the routing table knows. Used by the tests that assert the
#: identification table and the routing table have not drifted apart.
KNOWN_KINDS = frozenset(_ROUTES)


def route_for(kind: str) -> Route:
    """
    The route for a detected kind.

    An unmapped kind is not an error: it falls back to the Collection tab,
    where the file is listed and an analyst can force a type. That is the
    difference between a pipeline and a gate.
    """
    return _ROUTES.get(kind, _ROUTES["unknown"])


def destination_pages(kind: str, case_id: str) -> list[str]:
    """Frontend routes for this kind, with the case id substituted in."""
    return [p.replace("{case_id}", case_id) for p in route_for(kind).pages]


def is_archive_kind(kind: str) -> bool:
    return kind in ARCHIVE_KINDS
