from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from ..database import Base


class Playbook(Base):
    __tablename__ = "playbooks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    # React Flow graph stored as JSON strings
    nodes    = Column(Text, default="[]")
    edges    = Column(Text, default="[]")
    layout_dir = Column(String(10), default="DOWN")

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    case_playbooks = relationship("CasePlaybook", back_populates="playbook", cascade="all, delete-orphan")


class CasePlaybook(Base):
    """Associates a playbook with a case and tracks per-step completion state."""
    __tablename__ = "case_playbooks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id = Column(String, ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    playbook_id = Column(String, ForeignKey("playbooks.id", ondelete="CASCADE"), nullable=False)
    # JSON: { node_id: { done: bool, comment: str, done_at: str | null } }
    step_states = Column(Text, default="{}")
    added_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    playbook = relationship("Playbook", back_populates="case_playbooks")
