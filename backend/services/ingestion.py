import os
import tempfile
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.config import settings
from backend.models import Repository
from backend.services.github import GitHubService
from backend.services.parser import ParserService
from backend.services.vector_db import VectorDBService
from backend.services.gemini import GeminiService

class IngestionServiceError(Exception):
    pass

class IngestionService:
    @staticmethod
    async def ingest_repository(github_url: str, db: AsyncSession) -> Repository:
        # 1. Validate if URL is already in SQLite and not expired
        stmt = select(Repository).where(Repository.github_url == github_url)
        result = await db.execute(stmt)
        existing_repo = result.scalar_one_or_none()
        
        if existing_repo:
            if not existing_repo.is_expired():
                return existing_repo
            else:
                # Purge expired repo data
                vector_db = VectorDBService()
                vector_db.delete_collection(existing_repo.id)
                await db.delete(existing_repo)
                await db.commit()
                
        # 2. Acquire lock
        acquired = await GitHubService.acquire_ingestion_lock(github_url)
        if not acquired:
            raise IngestionServiceError("Repository ingestion is already in progress.")
            
        try:
            # 3. Validate repository via GitHub API
            repo_meta = await GitHubService.validate_repository(github_url)
            
            # 4. Clone repo to temp dir
            temp_dir = tempfile.mkdtemp(prefix="repochat_")
            try:
                GitHubService.clone_repository(github_url, temp_dir)
                
                # 5. Parse files to chunks
                parser = ParserService()
                chunks = parser.parse_repository(temp_dir)
                if not chunks:
                    raise IngestionServiceError("No indexable code files found in the repository.")
                
                # Extract chunk texts and get embeddings
                chunk_contents = [chunk["content"] for chunk in chunks]
                gemini = GeminiService()
                embeddings = gemini.get_embeddings(chunk_contents)
                
                if len(embeddings) != len(chunks):
                    raise IngestionServiceError("Failed to generate embeddings for all code chunks.")
                
                # Retrieve README content if exists
                readme_content = ""
                for filename in os.listdir(temp_dir):
                    if filename.lower().startswith("readme"):
                        readme_path = os.path.join(temp_dir, filename)
                        if os.path.isfile(readme_path):
                            try:
                                with open(readme_path, "r", encoding="utf-8", errors="ignore") as f:
                                    readme_content = f.read()
                                break
                            except Exception:
                                pass
                
                # Extract all file paths
                file_paths = list(set([chunk["file_path"] for chunk in chunks]))
                
                # Generate summary & architecture
                repo_full_name = f"{repo_meta['owner']}/{repo_meta['name']}"
                summary, arch_overview = gemini.generate_summary_and_architecture(
                    repo_name=repo_full_name,
                    file_paths=file_paths,
                    readme_content=readme_content
                )
                
                # SQLite datetimes: naive UTC
                now_utc = datetime.now(timezone.utc)
                created_at = now_utc.replace(tzinfo=None)
                expires_at = (now_utc + timedelta(hours=settings.CACHE_EXPIRATION_HOURS)).replace(tzinfo=None)
                
                # 6. Save metadata to DB to generate repo.id
                repo = Repository(
                    github_url=github_url,
                    owner=repo_meta["owner"],
                    name=repo_meta["name"],
                    star_count=repo_meta["star_count"],
                    fork_count=repo_meta["fork_count"],
                    language=repo_meta["language"],
                    file_count=len(file_paths),
                    total_size_bytes=repo_meta["total_size_bytes"],
                    summary=summary,
                    architecture_overview=arch_overview,
                    created_at=created_at,
                    expires_at=expires_at
                )
                db.add(repo)
                await db.flush() # populate repo.id
                
                # 7. Add chunks to ChromaDB
                vector_db = VectorDBService()
                vector_db.add_chunks(repo.id, chunks, embeddings)
                
                await db.commit()
                return repo
                
            finally:
                # Cleanup clone directory
                GitHubService.cleanup_directory(temp_dir)
        except Exception as e:
            # rollback DB operations in case of error
            await db.rollback()
            raise IngestionServiceError(str(e)) from e
        finally:
            # Release ingestion lock
            await GitHubService.release_ingestion_lock(github_url)
