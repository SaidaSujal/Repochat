import os
import tempfile
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import BackgroundTasks

from backend.config import settings
from backend.models import Repository
from backend.services.github import GitHubService
from backend.services.parser import ParserService
from backend.services.vector_db import VectorDBService
from backend.services.gemini import GeminiService

class IngestionServiceError(Exception):
    pass

class IngestionService:
    _semaphore = None

    @classmethod
    def get_semaphore(cls) -> asyncio.Semaphore:
        if cls._semaphore is None:
            cls._semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_INGESTIONS)
        return cls._semaphore

    @staticmethod
    async def ingest_repository(github_url: str, db: AsyncSession, background_tasks: BackgroundTasks) -> Repository:
        # 1. Validate if URL is already in SQLite
        stmt = select(Repository).where(Repository.github_url == github_url)
        result = await db.execute(stmt)
        existing_repo = result.scalar_one_or_none()
        
        if existing_repo:
            # Check the state of the existing repository
            if existing_repo.status in ("PENDING", "PROCESSING"):
                return existing_repo
            elif existing_repo.status == "COMPLETED" and not existing_repo.is_expired():
                return existing_repo
            else:
                # Purge failed or expired repo data
                vector_db = VectorDBService()
                vector_db.delete_collection(existing_repo.id)
                await db.delete(existing_repo)
                await db.commit()
                
        # 2. Validate repository via GitHub API (fast API metadata check)
        repo_meta = await GitHubService.validate_repository(github_url)
        
        # 3. Calculate cache lifecycle datetimes
        now_utc = datetime.now(timezone.utc)
        created_at = now_utc.replace(tzinfo=None)
        expires_at = (now_utc + timedelta(hours=settings.CACHE_EXPIRATION_HOURS)).replace(tzinfo=None)
        
        # 4. Save initial PENDING metadata to DB to generate repo.id
        repo = Repository(
            github_url=github_url,
            owner=repo_meta["owner"],
            name=repo_meta["name"],
            star_count=repo_meta["star_count"],
            fork_count=repo_meta["fork_count"],
            language=repo_meta["language"],
            file_count=0,
            total_size_bytes=repo_meta["total_size_bytes"],
            summary=None,
            architecture_overview=None,
            commit_sha=None,
            status="PENDING",
            created_at=created_at,
            expires_at=expires_at
        )
        db.add(repo)
        await db.commit()
        await db.refresh(repo)
        
        # 5. Enqueue background ingestion worker task
        background_tasks.add_task(IngestionService.process_ingestion, repo.id)
        
        return repo

    @staticmethod
    async def process_ingestion(repo_id: int) -> None:
        """Background worker task executing status-aware ingestion pipeline stages."""
        from backend.database import AsyncSessionLocal
        
        async with IngestionService.get_semaphore():
            async with AsyncSessionLocal() as db:
                # Query the repository record to obtain state
                stmt = select(Repository).where(Repository.id == repo_id)
                result = await db.execute(stmt)
                repo = result.scalar_one_or_none()
                if not repo:
                    return

                # Acquire ingestion lock to prevent concurrent runs on same repo url
                acquired = await GitHubService.acquire_ingestion_lock(repo.github_url)
                if not acquired:
                    repo.status = "FAILED"
                    repo.error_message = "Ingestion lock already held for this repository."
                    await db.commit()
                    return

                # Transition state to PROCESSING
                repo.status = "PROCESSING"
                await db.commit()

                try:
                    # Clone repo to temp dir
                    temp_dir = tempfile.mkdtemp(prefix="repochat_")
                    try:
                        # Offload git clone to thread pool
                        await asyncio.to_thread(GitHubService.clone_repository, repo.github_url, temp_dir)
                        
                        # Offload git rev-parse HEAD to thread pool
                        commit_sha = await asyncio.to_thread(GitHubService.get_commit_sha, temp_dir)
                        
                        # Parse files to chunks (offload CPU-bound token counts/regex walks)
                        parser = ParserService()
                        chunks = await asyncio.to_thread(parser.parse_repository, temp_dir)
                        if not chunks:
                            raise IngestionServiceError("No indexable code files found in the repository.")
                        
                        # Extract chunk contents
                        chunk_contents = [chunk["content"] for chunk in chunks]
                        gemini = GeminiService()
                        
                        # Offload embedding API request and backoff loops to thread pool
                        embeddings = await asyncio.to_thread(gemini.get_embeddings, chunk_contents)
                        
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
                        
                        # Generate summary & architecture (Gemini request offloaded to threads)
                        repo_full_name = f"{repo.owner}/{repo.name}"
                        summary, arch_overview = await asyncio.to_thread(
                            gemini.generate_summary_and_architecture,
                            repo_name=repo_full_name,
                            file_paths=file_paths,
                            readme_content=readme_content
                        )
                        
                        # Save intermediate status and metadata
                        repo.commit_sha = commit_sha
                        repo.file_count = len(file_paths)
                        repo.summary = summary
                        repo.architecture_overview = arch_overview
                        repo.status = "COMPLETED"
                        await db.commit()
                        
                        # Add chunks to ChromaDB (offload to thread pool to prevent blocking on database IO locks)
                        vector_db = VectorDBService()
                        await asyncio.to_thread(vector_db.add_chunks, repo.id, chunks, embeddings)
                        
                        # Save final database state
                        await db.commit()
                        
                    finally:
                        # Cleanup clone directory (offload disk remove to thread pool)
                        await asyncio.to_thread(GitHubService.cleanup_directory, temp_dir)
                except Exception as e:
                    # Rollback operations and mark state as FAILED
                    await db.rollback()
                    repo.status = "FAILED"
                    repo.error_message = str(e)
                    await db.commit()
                finally:
                    # Release ingestion lock
                    await GitHubService.release_ingestion_lock(repo.github_url)
