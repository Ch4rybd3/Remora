import secrets
from typing import Any, Tuple, Type
from pydantic import field_validator
from pydantic_settings import BaseSettings, EnvSettingsSource, PydanticBaseSettingsSource
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


# ── Custom env source ─────────────────────────────────────────────────────────
# pydantic-settings v2 tries json.loads() on list[str] fields before validators
# run, which crashes on plain comma-separated values like "http://a,http://b".
# This subclass handles cors_origins by splitting on commas instead of JSON.

class _CorsAwareEnvSource(EnvSettingsSource):
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


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    app_name: str = "Remora"
    database_url: str = f"sqlite:///{BASE_DIR}/data/remora.db"
    evidence_store_path: Path = BASE_DIR / "data" / "evidences"
    templates_path: Path = BASE_DIR / "templates"
    max_upload_size_mb: int = 500

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

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        # Replace the default env source with our CORS-aware version
        return (
            init_settings,
            _CorsAwareEnvSource(settings_cls),
            dotenv_settings,
            file_secret_settings,
        )


settings = Settings()
