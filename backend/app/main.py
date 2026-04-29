from pathlib import Path
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

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
from .routers import memory as memory_router
from .routers import mft as mft_router
from .routers import usn as usn_router
from .routers import browser as browser_router
from .routers import binary as binary_router
from .routers import registry as registry_router
from .models import evtx as _evtx_models          # ensure tables are registered
from .models import audit as _audit_models         # ensure tables are registered
from .models import attack_graph as _ag_models     # ensure tables are registered
from .models import memory as _memory_models       # ensure tables are registered
from .models import report_version as _rv_models  # ensure tables are registered
from .models import mft as _mft_models            # ensure tables are registered
from .models import usn as _usn_models            # ensure tables are registered
from .models import browser as _browser_models    # ensure tables are registered
from .models import binary as _binary_models      # ensure tables are registered
from .models import registry as _registry_models  # ensure tables are registered

Base.metadata.create_all(bind=engine)
settings.evidence_store_path.mkdir(parents=True, exist_ok=True)


def _setup_mft() -> None:
    """Add new columns to mft_files if they don't already exist."""
    with engine.connect() as conn:
        for col_ddl in [
            "ALTER TABLE mft_files ADD COLUMN duckdb_path TEXT",
            "ALTER TABLE mft_files ADD COLUMN parse_progress INTEGER DEFAULT 0 NOT NULL",
            "ALTER TABLE mft_files ADD COLUMN parse_duration_seconds INTEGER",
        ]:
            try:
                conn.execute(text(col_ddl))
                conn.commit()
            except Exception:
                pass  # Column already exists


_setup_mft()


def _setup_browser() -> None:
    """Add columns_json to browser_files if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE browser_files ADD COLUMN columns_json TEXT"))
            conn.commit()
        except Exception:
            pass  # Column already exists


_setup_browser()


def _setup_binary() -> None:
    """Ensure binary_files storage directory is locked down."""
    from .routers.binary import BINARY_DIR
    import os, stat as _stat
    try:
        os.chmod(BINARY_DIR, _stat.S_IRWXU)
    except Exception:
        pass


_setup_binary()

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

app.add_middleware(GZipMiddleware, minimum_size=1000)
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
app.include_router(memory_router.router, prefix="/api/v1", **_auth)
app.include_router(mft_router.router,     prefix="/api/v1", **_auth)
app.include_router(usn_router.router,     prefix="/api/v1", **_auth)
app.include_router(browser_router.router, prefix="/api/v1", **_auth)
app.include_router(binary_router.router,   prefix="/api/v1", **_auth)
app.include_router(registry_router.router, prefix="/api/v1", **_auth)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
