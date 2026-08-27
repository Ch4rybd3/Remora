import hashlib
import io
import re
import shutil
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..services.audit_service import audit_log
from ..core.deps import get_current_user
from ..config import settings

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

KNOWLEDGE_DIR: Path = settings.evidence_store_path.parent / "knowledge"
KNOWLEDGE_ASSETS_DIR: Path = KNOWLEDGE_DIR / "_assets"

KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)

IGNORED = {".obsidian", ".trash", "_assets", ".git"}

# ── Schemas ────────────────────────────────────────────────────────────────

class FileNode(BaseModel):
    name: str
    path: str           # relative to KNOWLEDGE_DIR, forward-slash
    is_dir: bool
    children: list["FileNode"] = []


class FileContent(BaseModel):
    path: str
    content: str


class RenamePayload(BaseModel):
    old_path: str
    new_path: str


class GraphNode(BaseModel):
    id: str
    label: str
    path: str
    link_count: int = 0


class GraphEdge(BaseModel):
    source: str
    target: str


class KnowledgeGraph(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# ── Helpers ────────────────────────────────────────────────────────────────

def _rel(p: Path) -> str:
    return str(p.relative_to(KNOWLEDGE_DIR)).replace("\\", "/")


def _safe(path: str) -> Path:
    """Resolve and verify path stays inside KNOWLEDGE_DIR."""
    full = (KNOWLEDGE_DIR / path).resolve()
    if not str(full).startswith(str(KNOWLEDGE_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    return full


def _build_tree(directory: Path) -> list[FileNode]:
    nodes: list[FileNode] = []
    try:
        entries = sorted(
            directory.iterdir(),
            key=lambda x: (not x.is_dir(), x.name.lower()),
        )
    except PermissionError:
        return []

    for entry in entries:
        if entry.name in IGNORED or entry.name.startswith("."):
            continue
        rel = _rel(entry)
        if entry.is_dir():
            nodes.append(FileNode(
                name=entry.name, path=rel, is_dir=True,
                children=_build_tree(entry),
            ))
        elif entry.suffix.lower() in (".md", ".txt", ".markdown"):
            nodes.append(FileNode(name=entry.name, path=rel, is_dir=False))
    return nodes


def _all_md_files() -> dict[str, Path]:
    """stem (lowercase) → Path for all markdown files, excluding IGNORED dirs."""
    result: dict[str, Path] = {}
    for p in KNOWLEDGE_DIR.rglob("*.md"):
        if any(part in IGNORED or part.startswith(".") for part in p.relative_to(KNOWLEDGE_DIR).parts):
            continue
        result[p.stem.lower()] = p
    return result


def _parse_wikilinks(content: str) -> list[str]:
    """Extract note names from [[Note]] / [[Note|alias]] / [[Note#section]]."""
    return re.findall(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]", content)


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/tree", response_model=list[FileNode])
def get_tree():
    return _build_tree(KNOWLEDGE_DIR)


@router.get("/file")
def get_file(path: str = Query(...)):
    full = _safe(path)
    if not full.exists():
        raise HTTPException(404, "File not found")
    return {"path": path, "content": full.read_text(encoding="utf-8", errors="replace")}


@router.put("/file")
def save_file(payload: FileContent):
    full = _safe(payload.path)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(payload.content, encoding="utf-8")
    return {"ok": True}


@router.post("/file", status_code=201)
def create_file(
    payload: FileContent,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    full = _safe(payload.path)
    if full.exists():
        raise HTTPException(409, "File already exists")
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(payload.content, encoding="utf-8")
    audit_log(db, user=current_user, action="knowledge.file_create",
              resource_type="knowledge_file", resource_name=payload.path)
    db.commit()
    return {"path": payload.path}


@router.delete("/file")
def delete_file(
    path: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    full = _safe(path)
    if not full.exists():
        raise HTTPException(404, "Not found")
    audit_log(db, user=current_user, action="knowledge.file_delete",
              resource_type="knowledge_file", resource_name=path)
    if full.is_dir():
        shutil.rmtree(full)
    else:
        full.unlink()
    db.commit()
    return {"ok": True}


@router.post("/folder", status_code=201)
def create_folder(
    payload: FileContent,  # reuse payload, only path matters
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    full = _safe(payload.path)
    if full.exists():
        raise HTTPException(409, "Already exists")
    full.mkdir(parents=True)
    audit_log(db, user=current_user, action="knowledge.folder_create",
              resource_type="knowledge_folder", resource_name=payload.path)
    db.commit()
    return {"path": payload.path}


@router.post("/rename")
def rename(
    payload: RenamePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    src = _safe(payload.old_path)
    dst = _safe(payload.new_path)
    if not src.exists():
        raise HTTPException(404, "Source not found")
    if dst.exists():
        raise HTTPException(409, "Destination already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    audit_log(db, user=current_user, action="knowledge.rename",
              resource_type="knowledge_file", resource_name=payload.new_path,
              details={"old_path": payload.old_path, "new_path": payload.new_path})
    db.commit()
    return {"ok": True}


@router.post("/import")
async def import_vault(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Accept a ZIP of an Obsidian vault and extract it into KNOWLEDGE_DIR."""
    raw = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Invalid ZIP file")

    # Detect and strip common top-level prefix (e.g. vault/ in vault/Note.md)
    names = [n for n in zf.namelist() if not n.endswith("/")]
    prefix = ""
    if names:
        first_parts = names[0].split("/")
        if len(first_parts) > 1:
            candidate = first_parts[0] + "/"
            if all(n.startswith(candidate) for n in names):
                prefix = candidate

    imported = 0
    for member in zf.infolist():
        rel = member.filename[len(prefix):]
        if not rel:
            continue
        parts = Path(rel).parts
        if any(p in IGNORED or p.startswith(".") for p in parts):
            continue
        dest = (KNOWLEDGE_DIR / rel).resolve()
        if not str(dest).startswith(str(KNOWLEDGE_DIR.resolve())):
            continue
        if member.filename.endswith("/"):
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(member.filename))
            if dest.suffix.lower() in (".md", ".markdown"):
                imported += 1

    audit_log(db, user=current_user, action="knowledge.vault_import",
              resource_type="knowledge_vault",
              resource_name=file.filename or "vault.zip",
              details={"imported_notes": imported})
    db.commit()
    return {"imported": imported}


@router.post("/images")
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "image.png").suffix or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = KNOWLEDGE_ASSETS_DIR / filename
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"url": f"/knowledge-assets/{filename}"}


@router.get("/graph", response_model=KnowledgeGraph)
def get_graph():
    all_files = _all_md_files()

    # node_id: stable MD5 of stem so positions can be cached client-side
    node_map: dict[str, str] = {}  # stem_lower → id
    nodes: list[GraphNode] = []

    for stem, path in all_files.items():
        nid = hashlib.md5(stem.encode()).hexdigest()[:12]
        node_map[stem] = nid
        nodes.append(GraphNode(id=nid, label=path.stem, path=_rel(path)))

    edges: list[GraphEdge] = []
    link_count: dict[str, int] = {n.id: 0 for n in nodes}
    seen_edges: set[frozenset[str]] = set()

    for stem, path in all_files.items():
        try:
            content = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        source_id = node_map[stem]
        for link in _parse_wikilinks(content):
            target_stem = link.strip().lower()
            if target_stem not in node_map:
                continue
            target_id = node_map[target_stem]
            if source_id == target_id:
                continue
            key = frozenset([source_id, target_id])
            if key in seen_edges:
                continue
            seen_edges.add(key)
            edges.append(GraphEdge(source=source_id, target=target_id))
            link_count[source_id] = link_count.get(source_id, 0) + 1
            link_count[target_id] = link_count.get(target_id, 0) + 1

    for node in nodes:
        node.link_count = link_count.get(node.id, 0)

    return KnowledgeGraph(nodes=nodes, edges=edges)
