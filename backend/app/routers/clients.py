from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.client import Client, ClientDocTemplate, ClientDocument
from ..models.user import User
from ..schemas.client import (
    ClientCreate,
    ClientDocTemplateCreate,
    ClientDocTemplateRead,
    ClientDocTemplateUpdate,
    ClientDocumentRead,
    ClientDocumentUpdate,
    ClientRead,
    ClientSummary,
    ClientUpdate,
)
from ..services.audit_service import audit_log

router = APIRouter(prefix="/clients", tags=["clients"])

CLIENTS_DIR: Path = settings.evidence_store_path.parent / "clients"
CLIENTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_name(filename: str) -> str:
    return re.sub(r"[^\w\-.]", "_", filename)


def _tpl_to_read(tpl: ClientDocTemplate) -> ClientDocTemplateRead:
    return ClientDocTemplateRead(
        id=tpl.id, name=tpl.name, description=tpl.description,
        slots=json.loads(tpl.slots or "[]"), created_at=tpl.created_at,
    )


# ── Doc templates ────────────────────────────────────────────────────────────
# NOTE: declared before /{client_id} routes so "doc-templates" isn't captured as an id.

@router.get("/doc-templates", response_model=list[ClientDocTemplateRead])
def list_doc_templates(db: Session = Depends(get_db)):
    tpls = db.query(ClientDocTemplate).order_by(ClientDocTemplate.name).all()
    return [_tpl_to_read(t) for t in tpls]


@router.post("/doc-templates", response_model=ClientDocTemplateRead, status_code=status.HTTP_201_CREATED)
def create_doc_template(
    payload: ClientDocTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tpl = ClientDocTemplate(
        name=payload.name, description=payload.description,
        slots=json.dumps([s.model_dump() for s in payload.slots]),
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _tpl_to_read(tpl)


@router.patch("/doc-templates/{template_id}", response_model=ClientDocTemplateRead)
def update_doc_template(
    template_id: str,
    payload: ClientDocTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tpl = db.query(ClientDocTemplate).filter(ClientDocTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template not found")
    if payload.name is not None:
        tpl.name = payload.name
    if payload.description is not None:
        tpl.description = payload.description
    if payload.slots is not None:
        tpl.slots = json.dumps([s.model_dump() for s in payload.slots])
    db.commit()
    db.refresh(tpl)
    return _tpl_to_read(tpl)


@router.delete("/doc-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doc_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tpl = db.query(ClientDocTemplate).filter(ClientDocTemplate.id == template_id).first()
    if not tpl:
        raise HTTPException(404, "Template not found")
    # Detach any clients using this template rather than blocking deletion
    db.query(Client).filter(Client.doc_template_id == template_id).update({"doc_template_id": None})
    db.delete(tpl)
    db.commit()


# ── Clients ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ClientSummary])
def list_clients(db: Session = Depends(get_db)):
    clients = db.query(Client).order_by(Client.is_default.desc(), Client.name).all()
    return [
        ClientSummary(
            id=c.id, name=c.name, is_default=c.is_default, industry=c.industry,
            doc_template_id=c.doc_template_id,
            case_count=len(c.cases), document_count=len(c.documents),
            created_at=c.created_at,
        )
        for c in clients
    ]


@router.post("/", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create_client(
    payload: ClientCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = Client(**payload.model_dump())
    db.add(client)
    db.flush()
    audit_log(db, user=current_user, action="client.create",
              resource_type="client", resource_id=client.id, resource_name=client.name)
    db.commit()
    db.refresh(client)
    return client


@router.get("/{client_id}", response_model=ClientRead)
def get_client(client_id: str, db: Session = Depends(get_db)):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    return client


@router.patch("/{client_id}", response_model=ClientRead)
def update_client(
    client_id: str,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(client, key, value)

    # Keep denormalized Case.client_name in sync with the display name
    if "name" in updates:
        db.query(Case).filter(Case.client_id == client_id).update({"client_name": client.name})

    audit_log(db, user=current_user, action="client.update",
              resource_type="client", resource_id=client_id, resource_name=client.name,
              details={"fields": list(updates.keys())})
    db.commit()
    db.refresh(client)
    return client


@router.delete("/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client(
    client_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")
    if client.is_default:
        raise HTTPException(400, "The default client cannot be deleted")
    if len(client.cases) > 0:
        raise HTTPException(400, "Reassign this client's cases before deleting it")

    for doc in client.documents:
        Path(doc.file_path).unlink(missing_ok=True)

    audit_log(db, user=current_user, action="client.delete",
              resource_type="client", resource_id=client_id, resource_name=client.name)
    db.delete(client)
    db.commit()


# ── Documents ────────────────────────────────────────────────────────────────

@router.get("/{client_id}/documents", response_model=list[ClientDocumentRead])
def list_documents(client_id: str, db: Session = Depends(get_db)):
    if not db.query(Client).filter(Client.id == client_id).first():
        raise HTTPException(404, "Client not found")
    return (db.query(ClientDocument)
            .filter(ClientDocument.client_id == client_id)
            .order_by(ClientDocument.uploaded_at.desc())
            .all())


@router.post("/{client_id}/documents/upload", response_model=ClientDocumentRead, status_code=status.HTTP_201_CREATED)
async def upload_document(
    client_id: str,
    file: UploadFile = File(...),
    slot: str | None = Form(None),
    name: str | None = Form(None),
    description: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(404, "Client not found")

    client_dir = CLIENTS_DIR / client_id
    client_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}_{_safe_name(file.filename or 'document')}"
    dest = client_dir / stored_name

    content = await file.read()
    dest.write_bytes(content)

    doc = ClientDocument(
        client_id=client_id,
        slot=slot or None,
        name=(name or file.filename or "document").strip(),
        description=description,
        file_path=str(dest),
        file_name=file.filename or stored_name,
        file_size=len(content),
        mime_type=file.content_type or "",
        uploaded_by=current_user.username,
    )
    db.add(doc)
    audit_log(db, user=current_user, action="client.document.upload",
              resource_type="client_document", resource_id=doc.id,
              resource_name=doc.name, details={"client_id": client_id, "slot": slot})
    db.commit()
    db.refresh(doc)
    return doc


@router.patch("/{client_id}/documents/{doc_id}", response_model=ClientDocumentRead)
def update_document(
    client_id: str,
    doc_id: str,
    payload: ClientDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(ClientDocument).filter(
        ClientDocument.id == doc_id, ClientDocument.client_id == client_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(doc, key, value)
    db.commit()
    db.refresh(doc)
    return doc


@router.get("/{client_id}/documents/{doc_id}/content")
def get_document_content(
    client_id: str,
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Raw file bytes for the given document — fetched client-side as a blob
    (auth header attaches via axios) then rendered inline (PDF/image/CSV/XLSX
    preview) or saved to disk, depending on what the frontend does with it."""
    doc = db.query(ClientDocument).filter(
        ClientDocument.id == doc_id, ClientDocument.client_id == client_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    path = Path(doc.file_path)
    if not path.exists():
        raise HTTPException(410, "File missing on disk")
    return FileResponse(path=str(path), filename=doc.file_name,
                        media_type=doc.mime_type or "application/octet-stream")


@router.delete("/{client_id}/documents/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    client_id: str,
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(ClientDocument).filter(
        ClientDocument.id == doc_id, ClientDocument.client_id == client_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    Path(doc.file_path).unlink(missing_ok=True)
    audit_log(db, user=current_user, action="client.document.delete",
              resource_type="client_document", resource_id=doc_id, resource_name=doc.name,
              details={"client_id": client_id})
    db.delete(doc)
    db.commit()
