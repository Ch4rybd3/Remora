from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, LargeBinary, String

from app.database import Base


class AttackGraph(Base):
    """One attack graph per case — case_id is the PK."""
    __tablename__ = "attack_graphs"

    case_id    = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True)
    nodes      = Column(JSON, nullable=False, default=list)
    edges      = Column(JSON, nullable=False, default=list)
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )

    # A PNG of the canvas, rasterised by the browser that drew it.
    #
    # The server can render this graph from the coordinates above, and does when
    # no snapshot exists — but that is a redrawing, and a redrawing never quite
    # matches the screen. Storing what the analyst actually saw means the report
    # embeds the picture they arranged, not an approximation of it.
    snapshot_png = Column(LargeBinary, nullable=True)
    snapshot_at  = Column(DateTime, nullable=True)
