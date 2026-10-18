import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, LargeBinary, String

from ..database import Base


class CollabDoc(Base):
    """Persisted Yjs Y.Doc binary state for a collaborative editing room.

    One row per room (step note or quick notes). The binary state is the full
    encoded update — applied on top of an empty Doc on load, it reconstructs
    the exact document as it was when last saved.

    room_id format:
      step notes  : "cp:{case_playbook_id}:step:{node_id}"
      quick notes : "case:{case_id}:quicknotes"
    """

    __tablename__ = "collab_docs"

    id         = Column(String,      primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id    = Column(String(255), unique=True, nullable=False, index=True)
    ydoc_state = Column(LargeBinary, nullable=False, default=b"")
    updated_at = Column(DateTime,    default=lambda: datetime.now(UTC),
                        onupdate=lambda: datetime.now(UTC))
