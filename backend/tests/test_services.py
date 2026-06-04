import pytest
from datetime import datetime, timedelta, timezone
from backend.models import Repository
from backend.services.vector_db import VectorDBService

def test_repository_expiration():
    now = datetime.now(timezone.utc)
    
    # Not expired repo
    repo_ok = Repository(
        github_url="https://github.com/owner/repo1",
        owner="owner",
        name="repo1",
        created_at=now,
        expires_at=now + timedelta(hours=24)
    )
    assert not repo_ok.is_expired()
    
    # Expired repo
    repo_expired = Repository(
        github_url="https://github.com/owner/repo2",
        owner="owner",
        name="repo2",
        created_at=now - timedelta(hours=25),
        expires_at=now - timedelta(hours=1)
    )
    assert repo_expired.is_expired()

@pytest.mark.asyncio
async def test_chroma_db_operations(monkeypatch):
    # Instantiate VectorDBService
    vector_service = VectorDBService()
    
    repo_id = 9999
    chunks = [
        {"content": "def main():\n    pass", "file_path": "main.py", "start_line": 1, "end_line": 2},
        {"content": "def helper():\n    return 42", "file_path": "utils.py", "start_line": 1, "end_line": 2}
    ]
    # Simple mocked 2D embeddings of dimension 1536 (or any)
    embeddings = [[0.1] * 1536, [0.2] * 1536]
    
    # Test adding chunks
    vector_service.add_chunks(repo_id, chunks, embeddings)
    
    # Test querying chunks
    query_embedding = [0.12] * 1536
    results = vector_service.query_chunks(repo_id, query_embedding, top_k=1)
    
    assert len(results) > 0
    assert results[0]["file_path"] in ["main.py", "utils.py"]
    
    # Test deleting collection
    vector_service.delete_collection(repo_id)
    # Check that querying deleted collection returns empty list
    assert len(vector_service.query_chunks(repo_id, query_embedding)) == 0

@pytest.mark.asyncio
async def test_github_service_lock():
    from backend.services.github import GitHubService
    
    test_url = "https://github.com/test/lock-repo"
    
    # Clean state
    await GitHubService.release_ingestion_lock(test_url)
    
    # First acquire should succeed
    acq1 = await GitHubService.acquire_ingestion_lock(test_url)
    assert acq1 is True
    
    # Second concurrent acquire should fail
    acq2 = await GitHubService.acquire_ingestion_lock(test_url)
    assert acq2 is False
    
    # Release lock
    await GitHubService.release_ingestion_lock(test_url)
    
    # Third acquire should succeed again
    acq3 = await GitHubService.acquire_ingestion_lock(test_url)
    assert acq3 is True
    
    # Cleanup
    await GitHubService.release_ingestion_lock(test_url)


@pytest.mark.asyncio
async def test_cleanup_expired_repositories():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from backend.database import Base
    from backend.services.cleanup import cleanup_expired_repositories
    from backend.models import Repository
    from datetime import datetime, timezone, timedelta
    
    # Setup a clean in-memory async SQLite database
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    AsyncSessionTest = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Add an expired repo and a valid repo
    repo_expired = Repository(
        github_url="https://github.com/test/expired",
        owner="test",
        name="expired",
        created_at=now - timedelta(hours=25),
        expires_at=now - timedelta(hours=1)
    )
    repo_valid = Repository(
        github_url="https://github.com/test/valid",
        owner="test",
        name="valid",
        created_at=now,
        expires_at=now + timedelta(hours=23)
    )
    
    async with AsyncSessionTest() as session:
        session.add_all([repo_expired, repo_valid])
        await session.commit()
        
        # Trigger the cleanup pipeline
        count = await cleanup_expired_repositories(session)
        assert count == 1
        
        # Verify only the valid repository remains
        from sqlalchemy import select
        result = await session.execute(select(Repository))
        repos = result.scalars().all()
        assert len(repos) == 1
        assert repos[0].name == "valid"
        
    await engine.dispose()


