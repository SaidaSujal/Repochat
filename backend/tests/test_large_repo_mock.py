import pytest
import pytest_asyncio
import asyncio
import os
import tempfile
import shutil
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from backend.database import Base, get_db
from backend.main import app
from backend.models import Repository
from backend.schemas import ChatResponse, CodeSnippet, Citation
from backend.services.github import GitHubService
from backend.services.gemini import GeminiService
from backend.services.vector_db import VectorDBService
from backend.services.ingestion import IngestionService

# In-memory database setup for isolation
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
test_engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

@pytest_asyncio.fixture(autouse=True)
async def setup_large_db(monkeypatch):
    import backend.database
    import backend.main
    monkeypatch.setattr(backend.database, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(backend.main, "AsyncSessionLocal", TestSessionLocal)
    
    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    app.state.limiter.enabled = False
    IngestionService._semaphore = None
    
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield
    finally:
        app.dependency_overrides = original_overrides
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await test_engine.dispose()

@pytest.mark.asyncio
async def test_large_repository_ingestion_scale_limits(monkeypatch):
    """
    Test scale validation and database flow under mock settings for a repository
    containing 450 files, close to the maximum allowed limit of 500 files.
    """
    # 1. Setup GitHub validation mock
    async def mock_validate(github_url):
        return {
            "owner": "large-owner",
            "name": "large-scale-repo",
            "star_count": 999,
            "fork_count": 222,
            "language": "Python",
            "total_size_bytes": 10 * 1024 * 1024  # 10MB
        }
    monkeypatch.setattr(GitHubService, "validate_repository", mock_validate)

    # 2. Mock clone_repository to generate 420 code files to simulate scale
    temp_dirs = []
    def mock_clone(url, target_dir):
        temp_dirs.append(target_dir)
        os.makedirs(target_dir, exist_ok=True)
        # Create 420 files to stress-test the ingestion parser
        for i in range(420):
            file_path = os.path.join(target_dir, f"file_{i}.py")
            with open(file_path, "w") as f:
                f.write(f"def func_{i}():\n    print('Scale test chunk {i}')\n")
    
    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda t: "d" * 40)
    
    # 3. Mock Gemini responses
    # Embedding mock: returns a dummy embedding for every text chunk
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.123] * 768] * len(texts))
    # Summary/Architecture mock
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture",
                        lambda self, *args, **kwargs: ("Mock Large Summary", "Mock Large Architecture"))
    
    # 4. Trigger Ingestion via API client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/ingest", json={"github_url": "https://github.com/large-owner/large-scale-repo"})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "PENDING"
        repo_id = data["id"]
        
        # 5. Let the ingestion background worker complete execution
        await asyncio.sleep(0.5)
        
        # 6. Retrieve repo metadata and check status transitions
        res_completed = await ac.get(f"/api/repositories/{repo_id}")
        assert res_completed.status_code == 200
        repo_data = res_completed.json()
        
        assert repo_data["status"] == "COMPLETED"
        assert repo_data["file_count"] == 420
        assert repo_data["commit_sha"] == "d" * 40
        assert repo_data["summary"] == "Mock Large Summary"
        assert repo_data["architecture_overview"] == "Mock Large Architecture"

        # 7. Check that the Vector Store has the matching collections and chunks count
        vdb = VectorDBService()
        coll = vdb.client.get_collection(name=vdb._get_collection_name(repo_id))
        assert coll.count() == 420  # 1 chunk per file for 420 files
        
        # Delete/Cleanup check: Verify vector DB collection can be deleted
        vdb.delete_collection(repo_id)
        with pytest.raises(Exception):
            vdb.client.get_collection(name=coll_name)

    # 8. Check that clone target directories were cleaned up successfully
    for td in temp_dirs:
        assert not os.path.exists(td), f"Temporary directory {td} was not cleaned up!"
