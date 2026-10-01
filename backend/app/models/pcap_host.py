"""
What the analyst decided about a host on the conversation map.

The map itself is computed from the capture every time it is asked for, so it
holds nothing. This holds the part the packets cannot say: that 10.0.0.5 is the
domain controller, that 185.199.108.153 is the attacker's staging host, and
where on the canvas they should sit so the picture reads.

**Keyed on the case and the address, not on the capture.** An analyst who names
10.0.0.5 while reading the first capture has named it for the second one too.
Scoping this per artifact would make them do it again for every file in an
investigation, which is how an annotation feature goes unused.
"""
import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, UniqueConstraint

from ..database import Base


class PcapHost(Base):
    __tablename__ = "pcap_hosts"
    __table_args__ = (
        UniqueConstraint("case_id", "address", name="uq_pcap_host_case_address"),
    )

    id      = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    #: The IP address, which is what identifies a host on the map.
    address = Column(String(64), nullable=False)

    #: What to show instead of the address. Empty means show the address.
    label   = Column(String(255), default="")
    #: An `AssetType` value, so a host adopted as an asset keeps the same word.
    #: Empty means the map uses its own suggestion.
    kind    = Column(String(64), default="")
    #: Where the analyst dragged it. Null means let the layout decide.
    x       = Column(Float, nullable=True)
    y       = Column(Float, nullable=True)

    #: Set when the analyst pushed this host into the case's assets, so the map
    #: can show the link rather than offering to create a second one.
    asset_id = Column(String, ForeignKey("assets.id", ondelete="SET NULL"),
                      nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC), nullable=False)
