from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime
from backend.database import Base

class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    github_url = Column(String, unique=True, index=True, nullable=False)
    owner = Column(String, nullable=False)
    name = Column(String, nullable=False)
    
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
