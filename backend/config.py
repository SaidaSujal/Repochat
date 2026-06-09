import os
from typing import Optional
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # API Credentials
    GEMINI_API_KEY: str = ""
    GITHUB_TOKEN: Optional[str] = None

    # Gemini Model Configuration
    GEMINI_EMBEDDING_MODEL: str = "models/gemini-embedding-001"
    GEMINI_EMBEDDING_FALLBACK_MODEL: str = "models/gemini-embedding-2"
    GEMINI_GENERATION_MODEL: str = "gemini-3.5-flash"
    GEMINI_GENERATION_FALLBACK_MODEL: str = "gemini-2.5-flash"
    
    # Gemini API Call and Retry Config
    GEMINI_TIMEOUT_SEC: float = 30.0
    GEMINI_MAX_RETRIES: int = 4

    @field_validator(
        "GEMINI_EMBEDDING_MODEL",
        "GEMINI_EMBEDDING_FALLBACK_MODEL",
        "GEMINI_GENERATION_MODEL",
        "GEMINI_GENERATION_FALLBACK_MODEL"
    )
    @classmethod
    def validate_model_name(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Model name cannot be empty or whitespace-only")
        return value

    @field_validator("GEMINI_TIMEOUT_SEC")
    @classmethod
    def validate_positive_timeout_gemini(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("Gemini timeout must be a positive number of seconds.")
        return value

    @field_validator("GEMINI_MAX_RETRIES")
    @classmethod
    def validate_non_negative_retries(cls, value: int) -> int:
        if value < 0:
            raise ValueError("Max retries value must be a non-negative integer.")
        return value

    # Git Configuration
    GIT_CLONE_TIMEOUT_SEC: float = 60.0
    GIT_COMMAND_TIMEOUT_SEC: float = 10.0

    @field_validator("GIT_CLONE_TIMEOUT_SEC", "GIT_COMMAND_TIMEOUT_SEC")
    @classmethod
    def validate_positive_timeout(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("Timeout value must be a positive number of seconds.")
        return value

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
    MAX_CONCURRENT_INGESTIONS: int = 2

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
