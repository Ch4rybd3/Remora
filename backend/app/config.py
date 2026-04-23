import secrets
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "Remora"
    database_url: str = f"sqlite:///{BASE_DIR}/data/remora.db"
    evidence_store_path: Path = BASE_DIR / "data" / "evidences"
    templates_path: Path = BASE_DIR / "templates"
    max_upload_size_mb: int = 500
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    secret_key: str = secrets.token_hex(32)  # override via SECRET_KEY in .env
    default_admin_password: str = "admin"    # override via DEFAULT_ADMIN_PASSWORD in .env

    class Config:
        env_file = ".env"


settings = Settings()
