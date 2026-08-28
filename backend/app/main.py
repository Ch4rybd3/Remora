import logging
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI

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

from .__version__ import __version__, build_info
from .config import settings
from .core.deps import get_current_user
from .database import Base, SessionLocal, engine
from .db_migrate import run_migrations
from .models import attack_graph as _ag_models  # ensure tables are registered
from .models import audit as _audit_models  # ensure tables are registered
from .models import binary as _binary_models  # ensure tables are registered
from .models import chainsaw as _chainsaw_models  # ensure tables are registered
from .models import client as _client_models  # ensure tables are registered
from .models import connector as _connector_models  # ensure tables are registered
from .models import csv_artifact as _csv_artifact_models  # ensure tables are registered
from .models import email_file as _email_file_models  # ensure tables are registered
from .models import evtx as _evtx_models  # ensure tables are registered
from .models import ez_artifacts as _ez_artifacts_models  # ensure EZ tables are registered
from .models import incident_log as _incident_log_models  # ensure table is registered
from .models import memory as _memory_models  # ensure tables are registered
from .models import mitre as _mitre_models  # ensure tables are registered
from .models import report_doc_template as _rdt_models  # ensure tables are registered
from .models import report_version as _rv_models  # ensure tables are registered
from .models import vault as _vault_models  # ensure table is registered
from .models.user import User, UserRole
from .routers import assets, auth, cases, evidences, iocs, reports, templates, timeline
from .routers import attack_graph as attack_graph_router
from .routers import audit as audit_router
from .routers import backup as backup_router
from .routers import binary as binary_router
from .routers import case_emails as case_emails_router
from .routers import chainsaw as chainsaw_router
from .routers import chainsaw_rules as chainsaw_rules_router
from .routers import clients as clients_router
from .routers import collection_import as collection_import_router
from .routers import connectors as connectors_router
from .routers import csv_artifacts as csv_artifacts_router
from .routers import cti as cti_router
from .routers import custody as custody_router
from .routers import dashboard as dashboard_router
from .routers import disk_images as disk_images_router
from .routers import dropzone as dropzone_router
from .routers import email_analysis as email_analysis_router
from .routers import evtx as evtx_router
from .routers import incident_log as incident_log_router
from .routers import ingest as ingest_router
from .routers import knowledge as knowledge_router
from .routers import memory as memory_router
from .routers import mitre as mitre_router
from .routers import pcap as pcap_router
from .routers import playbooks as playbooks_router
from .routers import report_doc_templates as report_doc_templates_router
from .routers import users as users_router
from .routers import vault as vault_router
from .services.auth_service import hash_password
from .services.chainsaw_setup import setup_chainsaw
from .services.cti_tools_setup import setup_cti_tools

settings.evidence_store_path.mkdir(parents=True, exist_ok=True)



def _setup_collection_imports() -> None:
    """Add session_id to imported_collections if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE imported_collections ADD COLUMN session_id TEXT"))
            conn.commit()
        except Exception:
            pass  # Column already exists




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




def _setup_playbooks() -> None:
    """Add layout_dir column to playbooks table if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE playbooks ADD COLUMN layout_dir VARCHAR(10) DEFAULT 'DOWN' NOT NULL"))
            conn.commit()
        except Exception:
            pass  # Column already exists




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




def _setup_binary() -> None:
    """Ensure binary_files storage directory is locked down."""
    import os
    import stat as _stat

    from .routers.binary import BINARY_DIR
    try:
        os.chmod(BINARY_DIR, _stat.S_IRWXU)
    except Exception:
        pass




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




def _setup_cti_tools() -> None:
    """Check CTI network tools (whois, dig, nslookup) are available."""
    setup_cti_tools()




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




def _setup_case_client_id() -> None:
    """Add client_id FK column to cases if it doesn't already exist."""
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE cases ADD COLUMN client_id TEXT"))
            conn.commit()
            print("[migration] cases.client_id added", flush=True)
        except Exception:
            pass  # Column already exists




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




def _seed_default_client_and_backfill():
    """Ensure a default Client exists, then point every case without a
    client_id at it — cases with a pre-existing client_name get their own
    Client record instead (matched/created by name) so no data is lost."""
    from .models.case import Case
    from .models.client import Client

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




# ─── Startup bootstrap ────────────────────────────────────────────────────────
# These used to run at import time, which meant that merely importing this
# module created a database, downloaded Chainsaw from GitHub and seeded rows.
# That made the application impossible to import in a test, and made a failed
# network call a hard import error. They now run once, at startup.

def _bootstrap_schema() -> None:
    """Bring the database to head, then run the legacy idempotent fixups."""
    run_migrations()

    # DEPRECATED — superseded by Alembic and scheduled for removal once
    # deployed installations are confirmed to be on migrations. They are
    # no-ops against a schema at head; kept for one release because silently
    # dropping a fixup is exactly how an upgrade loses data.
    for legacy in (
        _setup_collection_imports,
        _setup_case_text_fields,
        _setup_playbooks,
        _setup_report_sections,
        _setup_csv_artifact_evidence,
        _setup_case_type,
        _setup_artifact_timezone,
        _setup_case_client_id,
        _setup_timeline_provenance,
    ):
        legacy()


def _bootstrap_seeds() -> None:
    _seed_admin()
    _seed_default_client_and_backfill()
    _seed_playbooks()


def _bootstrap_tools() -> None:
    """
    Provision external tooling. Downloads from the network on first run, so it
    is skippable: CI and tests have no reason to pull a Chainsaw release.
    """
    if settings.skip_tool_setup:
        print("[remora] tool setup skipped (SKIP_TOOL_SETUP)", flush=True)
        return
    _setup_binary()
    _setup_chainsaw()
    _setup_cti_tools()


def _bootstrap_drop_folder() -> None:
    """
    Clear upload staging left behind by interrupted requests.

    A file under `.incoming/` is the remains of a request that never finished.
    It is incomplete by definition, was never announced to anyone, and cannot
    be resumed - so the only correct thing to do with it is delete it.
    """
    from .models.case import Case
    from .services.ingest.dropfolder import sweep_incoming

    db = SessionLocal()
    try:
        removed = sum(sweep_incoming(case) for case in db.query(Case).all())
        if removed:
            print(f"[remora] cleared {removed} interrupted upload(s) from staging", flush=True)
    except Exception as e:
        # Never let housekeeping stop the application from starting.
        print(f"[remora] drop folder staging sweep failed: {e}", flush=True)
    finally:
        db.close()


def bootstrap() -> None:
    _bootstrap_schema()
    _bootstrap_seeds()
    _bootstrap_drop_folder()
    _bootstrap_tools()


app = FastAPI(
    title="Remora API",
    description="DFIR Case Management Platform",
    version=__version__,
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
# Annotated as Any because mypy cannot match a narrowly-inferred dict against
# include_router's heterogeneous keyword signature when expanded with **.
_auth: dict[str, Any] = {"dependencies": [Depends(get_current_user)]}

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
app.include_router(ingest_router.router,               prefix="/api/v1", **_auth)
app.include_router(custody_router.router,              prefix="/api/v1", **_auth)
app.include_router(pcap_router.router,                 prefix="/api/v1", **_auth)
app.include_router(disk_images_router.router,          prefix="/api/v1", **_auth)
app.include_router(backup_router.router,               prefix="/api/v1", **_auth)


def _start_provenance_backfill() -> None:
    """
    Give pre-pipeline imports their `ingested_files` rows, in the background.

    Off the startup path on purpose: the pass hashes every artifact still on
    disk, which on a large installation is minutes of IO. Blocking boot on it
    would mean an upgrade looks like a hang. It is idempotent, so an interrupted
    run simply resumes on the next start.
    """
    def _run() -> None:
        from .services.ingest.backfill import backfill_all

        db = SessionLocal()
        try:
            written = backfill_all(db)
            if written:
                print(f"[ingest] backfilled provenance for {written} file(s)", flush=True)
        except Exception as e:
            print(f"[ingest] provenance backfill failed: {e}", flush=True)
        finally:
            db.close()

    threading.Thread(target=_run, name="ingest-backfill", daemon=True).start()


@app.on_event("startup")
def _on_startup() -> None:
    bootstrap()
    # Watch the drop folder for artifacts dropped outside the browser.
    dropzone_router.start_poller()
    _start_provenance_backfill()


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "app": settings.app_name}


@app.get("/api/v1/version")
def version():
    """Version, commit and build date. Displayed in the sidebar footer."""
    return build_info()

# Static files — no auth (UUID-based obscurity)
app.mount("/note-images", StaticFiles(directory=str(NOTE_IMAGES_DIR)), name="note-images")

KNOWLEDGE_ASSETS_DIR = settings.evidence_store_path.parent / "knowledge" / "_assets"
KNOWLEDGE_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/knowledge-assets", StaticFiles(directory=str(KNOWLEDGE_ASSETS_DIR)), name="knowledge-assets")
