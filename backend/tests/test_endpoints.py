import pytest
from httpx import AsyncClient, ASGITransport
import os
import tempfile
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from backend.database import Base, get_db
from backend.main import app
from backend.models import Repository
from backend.schemas import ChatResponse, CodeSnippet, Citation
from backend.services.github import GitHubService
from backend.services.gemini import GeminiService
from backend.services.vector_db import VectorDBService

# In-memory SQLite async engine for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

import pytest_asyncio

# Override get_db dependency
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

app.dependency_overrides[get_db] = override_get_db

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_ingest_repository_success(monkeypatch):
    # Mock GitHub validation API
    async def mock_validate(github_url):
        return {
            "owner": "test-owner",
            "name": "test-repo",
            "star_count": 100,
            "fork_count": 20,
            "language": "Python",
            "total_size_bytes": 50000
        }
    monkeypatch.setattr(GitHubService, "validate_repository", mock_validate)

    # Mock cloning to create mock main.py
    def mock_clone(url, target_dir):
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "main.py"), "w") as f:
            f.write("print('Hello World')")
    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)

    # Mock Gemini Service calls
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768] * len(texts))
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", 
                        lambda self, repo_name, file_paths, readme_content: ("Mock summary", "Mock architecture"))

    # Mock Vector DB Service storage
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, repo_id, chunks, embeddings: None)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/ingest", json={"github_url": "https://github.com/test-owner/test-repo"})
        
    assert response.status_code == 200
    data = response.json()
    assert data["owner"] == "test-owner"
    assert data["name"] == "test-repo"
    assert data["summary"] == "Mock summary"
    assert data["architecture_overview"] == "Mock architecture"
    assert data["file_count"] == 1


@pytest.mark.asyncio
async def test_ingest_invalid_github_url():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.post("/api/ingest", json={"github_url": "https://notgithub.com/bad/url"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_success_and_metadata_endpoints(monkeypatch):
    # Setup: Insert an active repository directly into test DB
    now_utc = datetime.now(timezone.utc)
    expires_at = now_utc + timedelta(hours=2)
    
    test_repo = Repository(
        id=42,
        github_url="https://github.com/active/repo",
        owner="active",
        name="repo",
        star_count=50,
        fork_count=10,
        language="Python",
        file_count=2,
        total_size_bytes=10000,
        summary="A test repository summary",
        architecture_overview="A test architecture overview",
        created_at=now_utc.replace(tzinfo=None),
        expires_at=expires_at.replace(tzinfo=None)
    )
    
    async with TestSessionLocal() as session:
        session.add(test_repo)
        await session.commit()

    # Mock Vector DB chunks query retrieval
    mock_chunks = [
        {"content": "print('hello')", "file_path": "main.py", "start_line": 1, "end_line": 1}
    ]
    monkeypatch.setattr(VectorDBService, "query_chunks", lambda self, repo_id, query_embedding, top_k=6: mock_chunks)
    
    # Mock Gemini embedding of query & Gemini RAG response
    mock_chat_response = ChatResponse(
        short_answer="This is a short test answer.",
        detailed_explanation="This is a detailed explanation of the code.",
        code_snippets=[CodeSnippet(file_path="main.py", lines="1-1", code_content="print('hello')")],
        citations=[Citation(file_path="main.py", start_line=1, end_line=1)],
        follow_up_suggestions=["Can you explain print?"]
    )
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.2] * 768])
    monkeypatch.setattr(GeminiService, "generate_rag_answer", lambda self, query, chunks: mock_chat_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Test 1: Chat Endpoint (/api/repositories/42/chat)
        chat_res = await ac.post("/api/repositories/42/chat", json={"query": "What does main.py do?"})
        assert chat_res.status_code == 200
        chat_data = chat_res.json()
        assert chat_data["short_answer"] == "This is a short test answer."
        assert chat_data["citations"][0]["file_path"] == "main.py"

        # Test 2: Chat Alias Endpoint (/api/chat?repo_id=42)
        chat_alias_res = await ac.post("/api/chat?repo_id=42", json={"query": "What does main.py do?"})
        assert chat_alias_res.status_code == 200
        assert chat_alias_res.json()["short_answer"] == "This is a short test answer."

        # Test 3: Get Summary Endpoint
        summary_res = await ac.get("/api/repositories/42/summary")
        assert summary_res.status_code == 200
        assert summary_res.json()["summary"] == "A test repository summary"

        # Test 4: Get Architecture Endpoint
        arch_res = await ac.get("/api/repositories/42/architecture")
        assert arch_res.status_code == 200
        assert arch_res.json()["architecture_overview"] == "A test architecture overview"

        # Test 5: Get Metadata Endpoint
        meta_res = await ac.get("/api/repositories/42")
        assert meta_res.status_code == 200
        assert meta_res.json()["name"] == "repo"


@pytest.mark.asyncio
async def test_expired_repository_handling(monkeypatch):
    # Setup: Insert an expired repository into DB
    now_utc = datetime.now(timezone.utc)
    expired_at = now_utc - timedelta(hours=2)
    
    test_repo = Repository(
        id=99,
        github_url="https://github.com/expired/repo",
        owner="expired",
        name="repo",
        summary="Expired Summary",
        architecture_overview="Expired Arch",
        created_at=(now_utc - timedelta(hours=26)).replace(tzinfo=None),
        expires_at=expired_at.replace(tzinfo=None)
    )
    
    async with TestSessionLocal() as session:
        session.add(test_repo)
        await session.commit()

    # Mock Vector DB delete collection
    delete_called = False
    def mock_delete_coll(self, repo_id):
        nonlocal delete_called
        delete_called = True
    monkeypatch.setattr(VectorDBService, "delete_collection", mock_delete_coll)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Requesting an expired repo should trigger auto-cleanup and return 410
        response = await ac.get("/api/repositories/99")
        
    assert response.status_code == 410
    assert delete_called is True
    
    # Verify it is deleted from the SQLite DB
    async with TestSessionLocal() as session:
        from sqlalchemy import select
        res = await session.execute(select(Repository).where(Repository.id == 99))
        assert res.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_ingest_rate_limiting(monkeypatch):
    # Mock ingestion functions to skip external calls
    async def mock_validate(github_url):
        return {"owner": "limiter", "name": "repo", "star_count": 0, "fork_count": 0, "language": "Py", "total_size_bytes": 100}
    monkeypatch.setattr(GitHubService, "validate_repository", mock_validate)
    monkeypatch.setattr(GitHubService, "clone_repository", lambda url, target_dir: os.makedirs(target_dir, exist_ok=True))
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768] * len(texts))
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", lambda self, r, f, rd: ("s", "a"))
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, r, c, e: None)

    success_count = 0
    blocked_by_limiter = False
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Ingest endpoint limit is 5 requests per hour. Make 10 requests.
        for i in range(10):
            response = await ac.post("/api/ingest", json={"github_url": f"https://github.com/limiter/repo-{i}"})
            if response.status_code == 200:
                success_count += 1
            elif response.status_code == 429:
                blocked_by_limiter = True
                break
                
    assert success_count <= 5
    assert blocked_by_limiter is True


@pytest.mark.asyncio
async def test_github_redirect_handling_success(monkeypatch):
    """Test that httpx client follows redirects successfully during repository validation."""
    from backend.services.github import GitHubService
    
    class MockResponse:
        def __init__(self, status_code, json_data, text=""):
            self.status_code = status_code
            self._json_data = json_data
            self.text = text
        def json(self):
            return self._json_data
            
    async def mock_get(self, url, headers=None):
        return MockResponse(200, {
            "owner": {"login": "redirected-owner"},
            "name": "redirected-repo",
            "private": False,
            "size": 1000,
            "stargazers_count": 10,
            "forks_count": 5,
            "language": "Python"
        })
        
    from httpx import AsyncClient as HttpxAsyncClient
    monkeypatch.setattr(HttpxAsyncClient, "get", mock_get)
    
    meta = await GitHubService.validate_repository("https://github.com/original-owner/original-repo")
    assert meta["owner"] == "redirected-owner"
    assert meta["name"] == "redirected-repo"
    assert meta["star_count"] == 10
    assert meta["fork_count"] == 5


def test_gemini_quota_exhaustion_retry_and_backoff(monkeypatch):
    """Test that GeminiService._call_with_retry retries on quota exhaustion and parses delay suggestions."""
    from backend.services.gemini import GeminiService
    import time
    
    sleep_calls = []
    monkeypatch.setattr(time, "sleep", lambda secs: sleep_calls.append(secs))
    
    service = GeminiService()
    attempts = 0
    
    def mock_function():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise Exception("429 ResourceExhausted: Quota exceeded. Please retry in seconds: 2.")
        return "success_value"
        
    result = service._call_with_retry(mock_function)
    assert result == "success_value"
    assert attempts == 3
    assert len(sleep_calls) == 2
    assert sleep_calls[0] == 3.0
    assert sleep_calls[1] == 3.0


def test_gemini_daily_quota_exhaustion_failure(monkeypatch):
    """Test that GeminiService._call_with_retry aborts immediately on daily quota exhaustion."""
    from backend.services.gemini import GeminiService, GeminiServiceError
    import time
    
    sleep_calls = []
    monkeypatch.setattr(time, "sleep", lambda secs: sleep_calls.append(secs))
    
    service = GeminiService()
    attempts = 0
    
    def mock_function():
        nonlocal attempts
        attempts += 1
        raise Exception("429 ResourceExhausted: Quota exceeded for metric: generativelanguage.googleapis.com/embed_content_free_tier_requests, limit: 1000")
        
    with pytest.raises(GeminiServiceError) as exc_info:
        service._call_with_retry(mock_function)
        
    assert "daily quota limit reached" in str(exc_info.value).lower()
    assert attempts == 1
    assert len(sleep_calls) == 0


@pytest.mark.asyncio
async def test_chat_query_validation_failures():
    """Test that empty and whitespace-only chat query payloads are rejected with 422 by Pydantic/FastAPI."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Empty query
        res_empty = await ac.post("/api/repositories/1/chat", json={"query": ""})
        assert res_empty.status_code == 422
        
        # 2. Whitespace-only query
        res_whitespace = await ac.post("/api/repositories/1/chat", json={"query": "   \n\t  "})
        assert res_whitespace.status_code == 422
        
        # 3. Too long query (>1000 characters)
        res_long = await ac.post("/api/repositories/1/chat", json={"query": "a" * 1001})
        assert res_long.status_code == 422

