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
from .routers import backup as backup_router
from .routers import auth, users as users_router, playbooks as playbooks_router
from .routers import email_analysis as email_analysis_router
from .routers import knowledge as knowledge_router
from .routers import evtx as evtx_router
from .routers import audit as audit_router
from .routers import attack_graph as attack_graph_router
from .routers import memory as memory_router
from .routers import binary as binary_router
from .routers import report_doc_templates as report_doc_templates_router
from .routers import connectors as connectors_router
from .routers import cti as cti_router
from .routers import collection_import as collection_import_router
from .models import ez_artifacts as _ez_artifacts_models   # ensure EZ tables are registered
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
from .services.cti_tools_setup import setup_cti_tools
from .models import audit as _audit_models         # ensure tables are registered
from .models import attack_graph as _ag_models     # ensure tables are registered
from .models import memory as _memory_models       # ensure tables are registered
from .models import report_version as _rv_models  # ensure tables are registered
from .models import binary as _binary_models      # ensure tables are registered
from .models import report_doc_template as _rdt_models    # ensure tables are registered
from .models import connector as _connector_models        # ensure tables are registered
from .models import email_file as _email_file_models      # ensure tables are registered
from .models import csv_artifact as _csv_artifact_models  # ensure tables are registered
from .routers import case_emails as case_emails_router
from .routers import csv_artifacts as csv_artifacts_router

Base.metadata.create_all(bind=engine)
settings.evidence_store_path.mkdir(parents=True, exist_ok=True)



def _setup_collection_imports() -> None:
    """Add session_id to imported_collections if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE imported_collections ADD COLUMN session_id TEXT"))
            conn.commit()
        except Exception:
            pass  # Column already exists


_setup_collection_imports()



def _setup_playbooks() -> None:
    """Add layout_dir column to playbooks table if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE playbooks ADD COLUMN layout_dir VARCHAR(10) DEFAULT 'DOWN' NOT NULL"))
            conn.commit()
        except Exception:
            pass  # Column already exists


_setup_playbooks()


def _setup_report_sections() -> None:
    """Add report_analysis / report_remediation / report_conclusion columns to cases."""
    with engine.connect() as conn:
        for col in ("report_analysis", "report_remediation", "report_conclusion"):
            try:
                conn.execute(text(f"ALTER TABLE cases ADD COLUMN {col} TEXT DEFAULT ''"))
                conn.commit()
                print(f"[migration] cases.{col} added", flush=True)
            except Exception:
                pass  # Column already exists


_setup_report_sections()


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


def _setup_cti_tools() -> None:
    """Check CTI network tools (whois, dig, nslookup) are available."""
    setup_cti_tools()


_setup_cti_tools()


def _setup_csv_artifact_evidence() -> None:
    """Add evidence_id FK column to csv_artifact_files if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "ALTER TABLE csv_artifact_files ADD COLUMN evidence_id TEXT "
                "REFERENCES evidences(id) ON DELETE SET NULL"
            ))
            conn.commit()
            print("[migration] csv_artifact_files.evidence_id added", flush=True)
        except Exception:
            pass  # Column already exists


_setup_csv_artifact_evidence()


def _setup_case_type() -> None:
    """Add case_type and client_name columns to cases if they don't exist."""
    with engine.connect() as conn:
        for stmt, msg in [
            ("ALTER TABLE cases ADD COLUMN case_type TEXT NOT NULL DEFAULT 'ir'",
             "[migration] cases.case_type added"),
            ("ALTER TABLE cases ADD COLUMN client_name TEXT NOT NULL DEFAULT ''",
             "[migration] cases.client_name added"),
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
                print(msg, flush=True)
            except Exception:
                pass  # Column already exists


_setup_case_type()

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
app.include_router(case_emails_router.router,    prefix="/api/v1", **_auth)
app.include_router(csv_artifacts_router.router,  prefix="/api/v1", **_auth)
app.include_router(knowledge_router.router, prefix="/api/v1", **_auth)
app.include_router(evtx_router.router, prefix="/api/v1", **_auth)
app.include_router(audit_router.router, prefix="/api/v1", **_auth)
app.include_router(attack_graph_router.router, prefix="/api/v1", **_auth)
app.include_router(memory_router.router, prefix="/api/v1", **_auth)
app.include_router(binary_router.router,               prefix="/api/v1", **_auth)
app.include_router(report_doc_templates_router.router, prefix="/api/v1", **_auth)
app.include_router(chainsaw_router.router,             prefix="/api/v1", **_auth)
app.include_router(chainsaw_rules_router.router,       prefix="/api/v1", **_auth)
app.include_router(mitre_router.router,                prefix="/api/v1", **_auth)
app.include_router(dashboard_router.router,            prefix="/api/v1", **_auth)
app.include_router(vault_router.router,                prefix="/api/v1", **_auth)
app.include_router(connectors_router.router,           prefix="/api/v1", **_auth)
app.include_router(cti_router.router,                  prefix="/api/v1", **_auth)
app.include_router(collection_import_router.router,    prefix="/api/v1", **_auth)
app.include_router(backup_router.router,               prefix="/api/v1", **_auth)


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
