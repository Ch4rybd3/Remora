import logging
import sys
from pathlib import Path
from fastapi import FastAPI, Depends

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)
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
from .routers import report_doc_templates as report_doc_templates_router
from .routers import prefetch as prefetch_router
from .routers import connectors as connectors_router
from .routers import cti as cti_router
from .routers import chainsaw as chainsaw_router
from .routers import chainsaw_rules as chainsaw_rules_router
from .routers import mitre as mitre_router
from .routers import dashboard as dashboard_router
from .routers import vault as vault_router
from .models import vault as _vault_models             # ensure table is registered
from .models import evtx as _evtx_models          # ensure tables are registered
from .models import chainsaw as _chainsaw_models   # ensure tables are registered
from .models import mitre as _mitre_models         # ensure tables are registered
from .services.chainsaw_setup import setup_chainsaw
from .models import audit as _audit_models         # ensure tables are registered
from .models import attack_graph as _ag_models     # ensure tables are registered
from .models import memory as _memory_models       # ensure tables are registered
from .models import report_version as _rv_models  # ensure tables are registered
from .models import mft as _mft_models            # ensure tables are registered
from .models import usn as _usn_models            # ensure tables are registered
from .models import browser as _browser_models    # ensure tables are registered
from .models import binary as _binary_models      # ensure tables are registered
from .models import registry as _registry_models           # ensure tables are registered
from .models import report_doc_template as _rdt_models    # ensure tables are registered
from .models import prefetch as _prefetch_models          # ensure tables are registered
from .models import connector as _connector_models        # ensure tables are registered

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


def _setup_chainsaw() -> None:
    """
    Ensure Chainsaw binary + Sigma rules are available.
    Downloads the latest release from GitHub if not already present.
    Patches settings in-place so all subsequent code uses the correct paths.
    """
    install_dir = settings.evidence_store_path.parent / "chainsaw"
    bin_path, rules_path = setup_chainsaw(
        install_dir=install_dir,
        current_bin=settings.chainsaw_bin_path,
        current_rules=settings.chainsaw_rules_path,
    )
    # Patch settings so the router picks up auto-downloaded paths
    settings.chainsaw_bin_path   = bin_path
    settings.chainsaw_rules_path = rules_path


_setup_chainsaw()

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
                role=UserRole.owner,
            )
            db.add(admin)
            db.commit()
            print(f"[remora] Default admin created — username: admin / password: {settings.default_admin_password}", flush=True)
    finally:
        db.close()


_seed_admin()


def _seed_playbooks():
    """Import sample playbooks from samples/playbooks/ on first startup."""
    import json
    from .models.playbook import Playbook

    samples_dir = Path(__file__).parent.parent.parent / "samples" / "playbooks"
    if not samples_dir.is_dir():
        return

    db = SessionLocal()
    try:
        if db.query(Playbook).count() > 0:
            return  # Already seeded

        for path in sorted(samples_dir.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                pb = Playbook(
                    name=data.get("name", path.stem),
                    description=data.get("description", ""),
                    nodes=json.dumps(data.get("nodes", [])),
                    edges=json.dumps(data.get("edges", [])),
                )
                db.add(pb)
                print(f"[remora] Seeded playbook: {pb.name}", flush=True)
            except Exception as exc:
                print(f"[remora] Failed to seed {path.name}: {exc}", flush=True)

        db.commit()
    finally:
        db.close()


_seed_playbooks()

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
app.include_router(registry_router.router,            prefix="/api/v1", **_auth)
app.include_router(report_doc_templates_router.router, prefix="/api/v1", **_auth)
app.include_router(chainsaw_router.router,             prefix="/api/v1", **_auth)
app.include_router(chainsaw_rules_router.router,       prefix="/api/v1", **_auth)
app.include_router(mitre_router.router,                prefix="/api/v1", **_auth)
app.include_router(dashboard_router.router,            prefix="/api/v1", **_auth)
app.include_router(vault_router.router,                prefix="/api/v1", **_auth)
app.include_router(prefetch_router.router,             prefix="/api/v1", **_auth)
app.include_router(connectors_router.router,           prefix="/api/v1", **_auth)
app.include_router(cti_router.router,                  prefix="/api/v1", **_auth)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
