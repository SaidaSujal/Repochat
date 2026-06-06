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


def test_github_service_get_commit_sha(monkeypatch):
    from backend.services.github import GitHubService, GitHubServiceError
    import subprocess

    class MockCompletedProcess:
        def __init__(self, stdout, returncode=0, stderr=""):
            self.stdout = stdout
            self.returncode = returncode
            self.stderr = stderr

    # 1. Test success case with a valid 40-character hex SHA
    valid_sha = "a" * 40
    def mock_run_success(*args, **kwargs):
        return MockCompletedProcess(stdout=valid_sha)
    monkeypatch.setattr(subprocess, "run", mock_run_success)
    
    sha = GitHubService.get_commit_sha("/dummy/path")
    assert sha == valid_sha

    # 2. Test failure case with a malformed SHA (too short)
    short_sha = "abc123"
    def mock_run_short(*args, **kwargs):
        return MockCompletedProcess(stdout=short_sha)
    monkeypatch.setattr(subprocess, "run", mock_run_short)
    
    with pytest.raises(GitHubServiceError) as exc:
        GitHubService.get_commit_sha("/dummy/path")
    assert "invalid SHA" in str(exc.value)

    # 3. Test failure case with a malformed SHA (invalid chars)
    invalid_char_sha = "g" * 40
    def mock_run_invalid_chars(*args, **kwargs):
        return MockCompletedProcess(stdout=invalid_char_sha)
    monkeypatch.setattr(subprocess, "run", mock_run_invalid_chars)
    
    with pytest.raises(GitHubServiceError) as exc:
        GitHubService.get_commit_sha("/dummy/path")
    assert "invalid SHA" in str(exc.value)

    # 4. Test git command failing (subprocess error)
    def mock_run_error(*args, **kwargs):
        raise subprocess.CalledProcessError(returncode=1, cmd="git rev-parse HEAD", stderr="fatal: not a git repository")
    monkeypatch.setattr(subprocess, "run", mock_run_error)

    with pytest.raises(GitHubServiceError) as exc:
        GitHubService.get_commit_sha("/dummy/path")
    assert "Failed to get commit SHA" in str(exc.value)


def test_commit_sha_validation_on_repository():
    # 1. Valid SHA
    repo = Repository(
        github_url="https://github.com/test/val1",
        owner="test",
        name="val1",
        commit_sha="a" * 40
    )
    assert repo.commit_sha == "a" * 40

    # 2. None value (backward compatibility)
    repo_none = Repository(
        github_url="https://github.com/test/val2",
        owner="test",
        name="val2",
        commit_sha=None
    )
    assert repo_none.commit_sha is None

    # 3. Invalid SHA format raises ValueError
    with pytest.raises(ValueError) as exc:
        Repository(
            github_url="https://github.com/test/val3",
            owner="test",
            name="val3",
            commit_sha="g" * 40
        )
    assert "Invalid commit SHA" in str(exc.value)



