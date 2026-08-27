from datetime import datetime

from pydantic import BaseModel

# ── Doc template slots ──────────────────────────────────────────────────────

class DocSlot(BaseModel):
    slug: str
    label: str
    description: str = ""


class ClientDocTemplateBase(BaseModel):
    name: str
    description: str = ""
    slots: list[DocSlot] = []


class ClientDocTemplateCreate(ClientDocTemplateBase):
    pass


class ClientDocTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    slots: list[DocSlot] | None = None


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
    doc_template_id: str | None = None


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    industry: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    notes: str | None = None
    doc_template_id: str | None = None


class ClientSummary(BaseModel):
    id: str
    name: str
    is_default: bool
    industry: str = ""
    doc_template_id: str | None = None
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
    name: str | None = None
    description: str | None = None
    slot: str | None = None


class ClientDocumentRead(BaseModel):
    id: str
    client_id: str
    slot: str | None = None
    name: str
    description: str = ""
    file_name: str
    file_size: int
    mime_type: str
    uploaded_at: datetime
    uploaded_by: str | None = None

    model_config = {"from_attributes": True}
