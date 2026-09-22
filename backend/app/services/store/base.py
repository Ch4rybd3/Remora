"""
The artifact query interface.

Every question the Artifact Explorer asks goes through here: what columns does
this artifact have, give me a filtered page of it, group it, search it. Four
operations, and the router knows nothing else.

**Why an interface at all.** DuckDB is the right engine for this product today -
it is embedded, it reads files in place, and it costs nothing when idle, which
matters for a tool meant to run on an analyst's laptop. But "should Remora move
to Elasticsearch?" is a question that will be asked again, and the honest answer
depends on scale nobody has yet. This boundary is what makes that a decision
about one module rather than a rewrite: an Elasticsearch backend implements
these four methods and the rest of the product does not notice.

The roadmap named `get_by_id` as a fifth. It is not here because a CSV row has
no identity - there is no id to fetch by, and inventing a row number would be an
identifier that changes when the file is re-sorted. The Explorer opens rows from
the page it already has.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class SourceMissing(Exception):
    """
    The artifact's file is not where its record says.

    Its own exception because the Explorer has to say something different about
    it. Every other failure is a query problem the analyst can adjust; this one
    means the bytes are gone, and reporting it as an empty result was how a
    table could list a thousand rows and open with none - the count had been
    read while the file still existed.
    """


@dataclass(frozen=True)
class Source:
    """
    Which artifact to read, and how to read its timestamps.

    `ref` stays opaque - a file path for the DuckDB implementation, an index
    name for a future one. The other two are what a *source* knows about
    itself and a query cannot: a collection taken from a machine in Paris
    records `10:00` for an event that happened at `09:00Z`, and the only
    honest way to compare it with a collection from New York is to say so at
    the point the file is read.

    Storing the zone without applying it - which is what the product did until
    this existed - is worse than not asking for it. The Collection tab showed
    the analyst a setting that changed nothing.
    """
    ref:         str
    #: The column holding the event time. Only this column is normalised;
    #: a timestamp buried in a free-text field is not ours to reinterpret.
    date_column: str | None = None
    #: IANA name the artifact's timestamps were recorded in. `None` and `UTC`
    #: both mean "already UTC", and neither costs a conversion.
    timezone:    str | None = None

    @property
    def needs_normalising(self) -> bool:
        return bool(self.date_column and self.timezone and self.timezone != "UTC")


def as_source(value: str | Source) -> Source:
    """Accept a bare path where no normalisation is wanted."""
    return value if isinstance(value, Source) else Source(ref=value)


@dataclass(frozen=True)
class Query:
    """What to keep. All three narrow together, as AND."""
    text:           str | None = None    # free text across every column
    column_filters: dict | None = None   # per-column substring match
    rql:            str | None = None    # the RQL expression, compiled to SQL

    @property
    def is_empty(self) -> bool:
        return not (self.text or self.column_filters or self.rql)


@dataclass(frozen=True)
class Schema:
    columns:   list[str] = field(default_factory=list)
    row_count: int = 0


@dataclass(frozen=True)
class Page:
    total: int
    pages: int
    rows:  list[dict]


@dataclass(frozen=True)
class Group:
    values: dict[str, str]
    count:  int


class ArtifactStore(Protocol):
    """
    A backend that can answer questions about one artifact.

    `source` is either a bare reference - a file path for the DuckDB
    implementation, an index name for a future one - or a `Source` carrying
    the reference plus what the artifact knows about its own timestamps.
    Callers treat the reference itself as opaque.
    """

    def schema(self, source: str | Source) -> Schema:
        """Columns and row count. Called once when an artifact is registered."""
        ...

    def search(
        self, source: str | Source, columns: list[str], query: Query, *,
        sort_col: str | None = None, sort_dir: str = "asc",
        page: int = 1, page_size: int = 100,
    ) -> Page:
        """One page of matching rows, with the total behind it."""
        ...

    def aggregate(
        self, source: str | Source, columns: list[str], query: Query, group_by: list[str],
    ) -> list[Group]:
        """Counts per distinct combination of `group_by`. No row limit."""
        ...

    def find(
        self, source: str | Source, columns: list[str], text: str, *,
        limit: int = 50, regex: bool = False,
    ) -> tuple[int, list[dict]]:
        """
        Free-text or regex search across every column.

        Returns the hit count and the first `limit` rows - the count is what
        the cross-artifact search ranks by, and it must not be capped by the
        number of rows actually returned.
        """
        ...
