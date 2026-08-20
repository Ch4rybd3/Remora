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
from .routers import incident_log as incident_log_router
from .models import incident_log as _incident_log_models  # ensure table is registered
from .routers import clients as clients_router
from .models import client as _client_models  # ensure tables are registered
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
from .routers import dropzone as dropzone_router
from .routers import pcap as pcap_router
from .routers import disk_images as disk_images_router
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


def _setup_case_text_fields() -> None:
    """Add quick_notes and executive_summary to cases if they don't exist."""
    with engine.connect() as conn:
        for col in ("quick_notes", "executive_summary"):
            try:
                conn.execute(text(f"ALTER TABLE cases ADD COLUMN {col} TEXT DEFAULT ''"))
                conn.commit()
                print(f"[migration] cases.{col} added", flush=True)
            except Exception:
                pass  # Column already exists


_setup_case_text_fields()


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
        for col in ("report_analysis", "report_remediation", "report_conclusion", "report_sections_data"):
            try:
                default = "'{}'" if col == "report_sections_data" else "''"
                conn.execute(text(f"ALTER TABLE cases ADD COLUMN {col} TEXT DEFAULT {default}"))
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


def _setup_artifact_timezone() -> None:
    """Add source_timezone to csv_artifact_files and csv_artifact_id to imported_files."""
    with engine.connect() as conn:
        for stmt, msg in [
            ("ALTER TABLE csv_artifact_files ADD COLUMN source_timezone TEXT",
             "[migration] csv_artifact_files.source_timezone added"),
            ("ALTER TABLE imported_files ADD COLUMN csv_artifact_id TEXT",
             "[migration] imported_files.csv_artifact_id added"),
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
                print(msg, flush=True)
            except Exception:
                pass  # Column already exists


_setup_artifact_timezone()


def _setup_case_client_id() -> None:
    """Add client_id FK column to cases if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE cases ADD COLUMN client_id TEXT"))
            conn.commit()
            print("[migration] cases.client_id added", flush=True)
        except Exception:
            pass  # Column already exists


_setup_case_client_id()


def _setup_timeline_provenance() -> None:
    """Add origin / raw_payload / raw_source columns to timeline_events."""
    with engine.connect() as conn:
        for stmt, msg in [
            ("ALTER TABLE timeline_events ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'",
             "[migration] timeline_events.origin added"),
            ("ALTER TABLE timeline_events ADD COLUMN raw_payload TEXT",
             "[migration] timeline_events.raw_payload added"),
            ("ALTER TABLE timeline_events ADD COLUMN raw_source TEXT DEFAULT ''",
             "[migration] timeline_events.raw_source added"),
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
                print(msg, flush=True)
            except Exception:
                pass  # Column already exists

    # Backfill: events dual-written by the incident log predate the origin
    # column and would otherwise all read as 'manual'.
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "UPDATE timeline_events SET origin = 'incident_log' "
                "WHERE origin = 'manual' AND id IN "
                "(SELECT timeline_event_id FROM incident_log_entries "
                " WHERE timeline_event_id IS NOT NULL)"
            ))
            conn.commit()
        except Exception:
            pass  # incident_log_entries may not exist yet


_setup_timeline_provenance()

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


def _seed_default_client_and_backfill():
    """Ensure a default Client exists, then point every case without a
    client_id at it — cases with a pre-existing client_name get their own
    Client record instead (matched/created by name) so no data is lost."""
    from .models.client import Client
    from .models.case import Case

    db = SessionLocal()
    try:
        default_client = db.query(Client).filter(Client.is_default == True).first()  # noqa: E712
        if not default_client:
            default_client = Client(name="Default Client", is_default=True)
            db.add(default_client)
            db.flush()
            print("[remora] Default client created", flush=True)

        orphan_cases = db.query(Case).filter(Case.client_id.is_(None)).all()
        if orphan_cases:
            named_clients: dict[str, Client] = {
                c.name: c for c in db.query(Client).filter(Client.is_default == False).all()  # noqa: E712
            }
            for case in orphan_cases:
                name = (case.client_name or "").strip()
                if not name:
                    case.client_id = default_client.id
                    continue
                client = named_clients.get(name)
                if not client:
                    client = Client(name=name)
                    db.add(client)
                    db.flush()
                    named_clients[name] = client
                case.client_id = client.id
            print(f"[migration] Backfilled client_id on {len(orphan_cases)} case(s)", flush=True)

        db.commit()
    finally:
        db.close()


_seed_default_client_and_backfill()


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
app.include_router(incident_log_router.router, prefix="/api/v1", **_auth)
app.include_router(clients_router.router, prefix="/api/v1", **_auth)
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
app.include_router(dropzone_router.router,             prefix="/api/v1", **_auth)
app.include_router(pcap_router.router,                 prefix="/api/v1", **_auth)
app.include_router(disk_images_router.router,          prefix="/api/v1", **_auth)
app.include_router(backup_router.router,               prefix="/api/v1", **_auth)


@app.on_event("startup")
def _start_dropzone_poller() -> None:
    """Watch the drop folder for artifacts dropped outside the browser."""
    dropzone_router.start_poller()


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
