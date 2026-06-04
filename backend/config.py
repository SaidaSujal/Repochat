import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # API Credentials
    GEMINI_API_KEY: str = ""
    GITHUB_TOKEN: Optional[str] = None

    # Server Configuration
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3000"

    # Database Settings
    DATABASE_URL: str = "sqlite+aiosqlite:///../db.sqlite3"
    CHROMA_DB_PATH: str = "../chroma_db"

    # Ingestion Configuration
    MAX_REPO_SIZE_MB: int = 50
    MAX_REPO_FILES: int = 500

    # Cache Configuration
    CACHE_EXPIRATION_HOURS: int = 24

    # Load from .env file at backend/ or workspace root
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

# Instantiate settings
settings = Settings()

# Validate crucial settings on startup
def validate_settings():
    if not settings.GEMINI_API_KEY:
        import warnings
        warnings.warn("GEMINI_API_KEY is not set. LLM features will fail until it is provided in environment.")
