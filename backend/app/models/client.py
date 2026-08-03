from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid

from ..database import Base


class ClientDocTemplate(Base):
    """Defines a set of expected document 'slots' (network diagram, RACI,
    machine inventory, country contacts, …) that a client's knowledge base
    can be pre-organized around."""
    __tablename__ = "client_doc_templates"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    slots = Column(Text, default="[]")  # JSON list of {slug, label, description}
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Client(Base):
    __tablename__ = "clients"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)

    description = Column(Text, default="")
    industry = Column(String(255), default="")
    contact_name = Column(String(255), default="")
    contact_email = Column(String(255), default="")
    contact_phone = Column(String(100), default="")
    address = Column(Text, default="")
    notes = Column(Text, default="")

    doc_template_id = Column(String, ForeignKey("client_doc_templates.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    doc_template = relationship("ClientDocTemplate")
    documents = relationship("ClientDocument", back_populates="client",
                             cascade="all, delete-orphan", order_by="ClientDocument.uploaded_at.desc()")
    cases = relationship("Case", back_populates="client")


class ClientDocument(Base):
    __tablename__ = "client_documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    client_id = Column(String, ForeignKey("clients.id", ondelete="CASCADE"), nullable=False)

    slot = Column(String(100), nullable=True)  # matches a ClientDocTemplate slot slug, or null = freeform
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")

    file_path = Column(String, nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, default=0)
    mime_type = Column(String(120), default="")

    uploaded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    uploaded_by = Column(String(100), nullable=True)

    client = relationship("Client", back_populates="documents")
