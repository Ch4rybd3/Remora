"""
Artifact storage and query.

`get_store()` is what the routers call. It returns the configured backend, and
the only one today is DuckDB - but the indirection is the point: swapping in a
different engine is a change here, not across the product.
"""
from .base import ArtifactStore, Group, Page, Query, Schema
from .duckdb_store import DuckDBArtifactStore, drop_cache, materialise, normalize_column

_store: ArtifactStore | None = None


def get_store() -> ArtifactStore:
    """The configured artifact backend."""
    global _store
    if _store is None:
        _store = DuckDBArtifactStore()
    return _store


__all__ = [
    "ArtifactStore",
    "DuckDBArtifactStore",
    "Group",
    "Page",
    "Query",
    "Schema",
    "drop_cache",
    "get_store",
    "materialise",
    "normalize_column",
]
