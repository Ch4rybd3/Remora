from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, engine, SessionLocal
from .models.user import User, UserRole
from .services.auth_service import hash_password
from .core.deps import get_current_user
from .routers import cases, iocs, assets, evidences, timeline, templates, reports
from .routers import auth, users as users_router, playbooks as playbooks_router
from .routers import email_analysis as email_analysis_router
from .routers import knowledge as knowledge_router
from .routers import evtx as evtx_router
from .routers import audit as audit_router
from .routers import attack_graph as attack_graph_router
from .models import evtx as _evtx_models          # ensure tables are registered
from .models import audit as _audit_models         # ensure tables are registered
from .models import attack_graph as _ag_models     # ensure tables are registered

Base.metadata.create_all(bind=engine)
settings.evidence_store_path.mkdir(parents=True, exist_ok=True)

NOTE_IMAGES_DIR = settings.evidence_store_path.parent / "note_images"
NOTE_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def _seed_admin():
    """Create default admin on first startup if no users exist."""
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin = User(
                username="admin",
                hashed_password=hash_password(settings.default_admin_password),
                role=UserRole.admin,
            )
            db.add(admin)
            db.commit()
            print(f"[remora] Default admin created — username: admin / password: {settings.default_admin_password}")
    finally:
        db.close()


_seed_admin()

app = FastAPI(
    title="Remora API",
    description="DFIR Case Management Platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public
app.include_router(auth.router, prefix="/api/v1")

# Protected — all routes below require a valid JWT
_auth = {"dependencies": [Depends(get_current_user)]}

app.include_router(cases.router, prefix="/api/v1", **_auth)
app.include_router(iocs.router, prefix="/api/v1", **_auth)
app.include_router(assets.router, prefix="/api/v1", **_auth)
app.include_router(evidences.router, prefix="/api/v1", **_auth)
app.include_router(timeline.router, prefix="/api/v1", **_auth)
app.include_router(templates.router, prefix="/api/v1", **_auth)
app.include_router(reports.router, prefix="/api/v1", **_auth)
app.include_router(users_router.router, prefix="/api/v1")  # users router has its own deps
app.include_router(playbooks_router.router, prefix="/api/v1", **_auth)
app.include_router(email_analysis_router.router, prefix="/api/v1", **_auth)
app.include_router(knowledge_router.router, prefix="/api/v1", **_auth)
app.include_router(evtx_router.router, prefix="/api/v1", **_auth)
app.include_router(audit_router.router, prefix="/api/v1", **_auth)
app.include_router(attack_graph_router.router, prefix="/api/v1", **_auth)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
