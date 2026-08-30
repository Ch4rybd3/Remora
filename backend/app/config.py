import secrets
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import (
    BaseSettings,
    DotEnvSettingsSource,
    EnvSettingsSource,
    PydanticBaseSettingsSource,
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent


# ── Custom env source ─────────────────────────────────────────────────────────
# pydantic-settings v2 tries json.loads() on list[str] fields before validators
# run, which crashes on plain comma-separated values like "http://a,http://b".
# This subclass handles cors_origins by splitting on commas instead of JSON.

class _CorsAwareMixin:
    """Decode cors_origins from a comma-separated string.

    Applied to both the environment and the dotenv source: a `.env` copied from
    `.env.example` carries `CORS_ORIGINS=http://localhost`, which the stock
    dotenv source hands to json.loads() and dies on. Patching only the env
    source left every from-checkout run broken while Docker deployments — which
    receive the value as a real environment variable — worked fine.
    """

    def decode_complex_value(
        self, field_name: str, field_type: Any, value: str
    ) -> Any:
        if field_name == "cors_origins":
            stripped = value.strip()
            if stripped.startswith("["):
                # Looks like a JSON array — try standard JSON path
                try:
                    return super().decode_complex_value(field_name, field_type, value)
                except Exception:
                    pass
            # Comma-separated (or single-origin) fallback
            return [
                o.strip().strip('"').strip("'")
                for o in stripped.split(",")
                if o.strip()
            ]
        return super().decode_complex_value(field_name, field_type, value)


class _CorsAwareEnvSource(_CorsAwareMixin, EnvSettingsSource):
    pass


class _CorsAwareDotEnvSource(_CorsAwareMixin, DotEnvSettingsSource):
    pass


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    app_name: str = "Remora"
    database_url: str = f"sqlite:///{BASE_DIR}/data/remora.db"
    evidence_store_path: Path = BASE_DIR / "data" / "evidences"
    # Root for per-case working data (collection imports and their extracted
    # files). Overridable so tests do not write into the source tree - running
    # the backend from `backend/` used to create a `backend/data/` holding real
    # evidence, one `git add -A` away from being committed.
    case_data_path: Path = Path("/app/data") if Path("/app/data").exists() else BASE_DIR / "data"
    templates_path: Path = BASE_DIR / "templates"
    max_upload_size_mb: int = 500

    # Skip provisioning of external tooling (Chainsaw download, CTI binary
    # checks) at startup. Set in CI and in tests, which have no reason to pull
    # a release from GitHub before running.
    skip_tool_setup: bool = False

    # ── Drop folder ───────────────────────────────────────────────────────────
    # Watched directory with one sub-folder per case. Bind-mount it from the
    # host (see docker-compose.yml) to drop artifacts without going through
    # the browser.
    dropzone_path: Path = BASE_DIR / "data" / "dropzone"
    # Poll the drop folder and ingest automatically. Turn off to require an
    # explicit "Scanner" click in the Collection tab.
    dropzone_auto_ingest: bool = True
    dropzone_poll_seconds: int = 30
    # A file is ingested only after being untouched for this long, so a copy
    # still in progress is never read half-written.
    dropzone_stable_seconds: int = 15

    # ── Parser sandbox ────────────────────────────────────────────────────────
    # Unprivileged account the Eric Zimmerman parsers run as. Created by the
    # backend image; override where the deployment differs. See
    # services/sandbox.py for what else is enforced.
    parser_sandbox_user: str = "remora-parser"
    #: Wall-clock ceiling per invocation. A parser that needs longer than this
    #: on one artifact has met input it cannot handle.
    parser_timeout_seconds: int = 300
    parser_memory_mb: int = 2048

    # ── Artifact store ────────────────────────────────────────────────────────
    # Materialise CSV artifacts as Parquet on first query. Every query used to
    # re-parse the whole CSV; Parquet is columnar and typed, so a filter on one
    # column touches one column. The cache is derived data - deleting it costs
    # one re-conversion. Set false to fall back to scanning the CSV directly.
    artifact_store_parquet: bool = True

    # ── Chain of custody ──────────────────────────────────────────────────────
    # Password on the archive an evidence item is wrapped in when it is flagged
    # as an IOC. Deliberately well-known and shown in the interface: this is
    # containment, not confidentiality. It stops an analyst double-clicking a
    # live sample after downloading it, and stops endpoint protection silently
    # quarantining one out of the evidence store - which destroys evidence.
    # Configurable so an organisation can align it with its own convention
    # ("infected" is the common one).
    ioc_archive_password: str = "Remora"

    # ── Disk images ───────────────────────────────────────────────────────────
    # Comma-separated directories the disk image explorer may read from,
    # normally a read-only host bind mount. Images are read in place: a full
    # E01 acquisition is far too large to upload and copy into the volume.
    # Anything outside these roots is refused.
    disk_image_paths: str = "/app/data/images"
    # Host-side path of the same directory. Never used to read anything — it
    # only lets the UI print a copy-pasteable rsync/sshfs command, since the
    # container-side path is meaningless to someone sitting at their own
    # machine.
    disk_images_host_path: str = ""

    # Accepts either a JSON array or a comma-separated string in .env:
    #   CORS_ORIGINS=http://localhost,https://myserver.com
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors(cls, v: object) -> object:
        if isinstance(v, str):
            # Strip brackets in case someone passes a JSON-like string
            stripped = v.strip().lstrip("[").rstrip("]")
            return [o.strip().strip('"').strip("'") for o in stripped.split(",") if o.strip()]
        return v

    secret_key: str = secrets.token_hex(32)  # override via SECRET_KEY in .env
    default_admin_password: str = "admin"    # override via DEFAULT_ADMIN_PASSWORD in .env

    # Chainsaw integration — set in .env
    chainsaw_bin_path: str   = "chainsaw"  # name or full path to chainsaw binary
    chainsaw_rules_path: str = ""          # path to Sigma rules dir (required for scanning)

    class Config:
        env_file = ".env"
        # `.env` is shared with docker-compose and carries variables the
        # backend does not own (PORT, BIND_HOST, DROPZONE_HOST_PATH, …).
        # Without this, loading the shipped .env.example fails outright.
        extra = "ignore"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Replace the default env source with our CORS-aware version
        return (
            init_settings,
            _CorsAwareEnvSource(settings_cls),
            _CorsAwareDotEnvSource(settings_cls),
            file_secret_settings,
        )


settings = Settings()
