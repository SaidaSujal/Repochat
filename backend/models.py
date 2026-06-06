from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime
from backend.database import Base

from sqlalchemy.orm import validates
import re

COMMIT_SHA_REGEX = re.compile(r"^[0-9a-f]{40}$")

class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    github_url = Column(String, unique=True, index=True, nullable=False)
    owner = Column(String, nullable=False)
    name = Column(String, nullable=False)
    commit_sha = Column(String(40), nullable=True)
    status = Column(String(20), default="PENDING", nullable=False)
    error_message = Column(Text, nullable=True)

    @validates("commit_sha")
    def validate_commit_sha(self, key, value):
        if value is not None:
            # Strip whitespace just in case
            val_str = str(value).strip()
            if len(val_str) != 40 or not COMMIT_SHA_REGEX.match(val_str):
                raise ValueError(f"Invalid commit SHA: {value}. Must be a 40-character hexadecimal string.")
            return val_str
        return value
    
    # Repo stats
    star_count = Column(Integer, default=0)
    fork_count = Column(Integer, default=0)
    language = Column(String, nullable=True)
    file_count = Column(Integer, default=0)
    total_size_bytes = Column(Integer, default=0)
    
    # Generated content
    summary = Column(Text, nullable=True)
    architecture_overview = Column(Text, nullable=True)
    
    # Ingestion & Cache lifecycle
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False)

    def is_expired(self) -> bool:
        """Check if the cache has expired."""
        now = datetime.now(timezone.utc)
        # Ensure timezone comparison compatibility by making self.expires_at timezone-aware or comparing appropriately
        expires_at_aware = self.expires_at.replace(tzinfo=timezone.utc) if self.expires_at.tzinfo is None else self.expires_at
        return now > expires_at_aware
