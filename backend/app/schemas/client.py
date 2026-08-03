from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


# ── Doc template slots ──────────────────────────────────────────────────────

class DocSlot(BaseModel):
    slug: str
    label: str
    description: str = ""


class ClientDocTemplateBase(BaseModel):
    name: str
    description: str = ""
    slots: List[DocSlot] = []


class ClientDocTemplateCreate(ClientDocTemplateBase):
    pass


class ClientDocTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    slots: Optional[List[DocSlot]] = None


class ClientDocTemplateRead(ClientDocTemplateBase):
    id: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Client ───────────────────────────────────────────────────────────────────

class ClientBase(BaseModel):
    name: str
    description: str = ""
    industry: str = ""
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    address: str = ""
    notes: str = ""
    doc_template_id: Optional[str] = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    doc_template_id: Optional[str] = None


class ClientSummary(BaseModel):
    id: str
    name: str
    is_default: bool
    industry: str = ""
    doc_template_id: Optional[str] = None
    case_count: int = 0
    document_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class ClientRead(ClientBase):
    id: str
    is_default: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Documents ────────────────────────────────────────────────────────────────

class ClientDocumentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    slot: Optional[str] = None


class ClientDocumentRead(BaseModel):
    id: str
    client_id: str
    slot: Optional[str] = None
    name: str
    description: str = ""
    file_name: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: Optional[str] = None

    model_config = {"from_attributes": True}
