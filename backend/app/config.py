import secrets
from pydantic import field_validator
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "Remora"
    database_url: str = f"sqlite:///{BASE_DIR}/data/remora.db"
    evidence_store_path: Path = BASE_DIR / "data" / "evidences"
    templates_path: Path = BASE_DIR / "templates"
    max_upload_size_mb: int = 500

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


settings = Settings()
