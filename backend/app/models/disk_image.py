"""
A forensic image attached to a case.

Until this table existed, images were not scoped at all: the browser listed
everything found under the configured roots, and every case showed every image
on the volume. That is not a filter that was forgotten - there was nothing to
filter on. An analyst could not say which case an image belonged to, and the
chain of custody had a hole exactly where the largest piece of evidence sat.

Registering an image is deliberate and cheap: the row records that this case
works on these bytes, and browsing is only possible through a registration. The
bytes themselves are never copied, moved or deleted by this module - the image
lives on the mounted volume, and unregistering it only removes the case's claim
on it. See docs/INGESTION.md, section on what is *not* an artifact.

An image may be registered to more than one case. Two investigations for the
same client can legitimately examine one acquisition, and a global "belongs to
exactly one case" rule would force a copy of a 500 GB file to express it.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from ..database import Base


class DiskImage(Base):
    __tablename__ = "disk_images"

    id      = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id", ondelete="CASCADE"),
                     nullable=False, index=True)

    #: Absolute path, always inside a configured root. Validated on every use
    #: rather than trusted from the row - roots are configuration and can change
    #: between the registration and the next request.
    path         = Column(String,      nullable=False)
    name         = Column(String(255), nullable=False)
    size_bytes   = Column(BigInteger,  nullable=False, default=0)
    image_format = Column(String(16),  nullable=False, default="")

    registered_at = Column(DateTime,     nullable=False,
                           default=lambda: datetime.now(UTC))
    registered_by = Column(String(100), nullable=True)

    case = relationship("Case", back_populates="disk_images")

    __table_args__ = (
        UniqueConstraint("case_id", "path", name="uq_disk_image_case_path"),
    )
