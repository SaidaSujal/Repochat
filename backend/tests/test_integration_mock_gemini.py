import pytest
import pytest_asyncio
import asyncio
import os
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
from backend.services.cleanup import cleanup_expired_repositories

# In-memory database setup for isolation
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
test_engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)


# Local get_db override to prevent database leakage from other test modules
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
async def setup_integration_db(monkeypatch):
    import backend.database
    import backend.main
    monkeypatch.setattr(backend.database, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(backend.main, "AsyncSessionLocal", TestSessionLocal)
    
    # Set FastAPI dependency override locally for the scope of this test module
    app.dependency_overrides[get_db] = override_get_db
    
    # Reset semaphores and limiters
    app.state.limiter.enabled = False
    IngestionService._semaphore = None
    
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest.mark.asyncio
async def test_e2e_ingestion_and_metadata_flow(monkeypatch):
    # Setup GitHub mocks
    async def mock_validate(github_url):
        return {
            "owner": "test-owner",
            "name": "test-repo",
            "star_count": 42,
            "fork_count": 7,
            "language": "Python",
            "total_size_bytes": 1024
        }
    monkeypatch.setattr(GitHubService, "validate_repository", mock_validate)

    def mock_clone(url, target_dir):
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "main.py"), "w") as f:
            f.write("print('Hello World')")

    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda target_dir: "c" * 40)
    
    # Mock Gemini Service summary & embedding calls
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768] * len(texts))
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", 
                        lambda self, *args, **kwargs: ("Mock Summary", "Mock Architecture"))
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, *args, **kwargs: None)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Trigger Ingestion
        res = await ac.post("/api/ingest", json={"github_url": "https://github.com/test-owner/test-repo"})
        assert res.status_code == 200
        data = res.json()
        repo_id = data["id"]
        assert data["status"] == "PENDING"
        assert data["commit_sha"] is None

        # Give it a moment to let the background tasks finish executing (run in-process)
        await asyncio.sleep(0.1)

        # Verify completed status and commit metadata is saved
        res_completed = await ac.get(f"/api/repositories/{repo_id}")
        assert res_completed.status_code == 200
        comp_data = res_completed.json()
        assert comp_data["status"] == "COMPLETED"
        assert comp_data["commit_sha"] == "c" * 40

        # Verify Summary and Architecture endpoints
        res_summary = await ac.get(f"/api/repositories/{repo_id}/summary")
        assert res_summary.status_code == 200
        assert res_summary.json()["summary"] == "Mock Summary"

        res_arch = await ac.get(f"/api/repositories/{repo_id}/architecture")
        assert res_arch.status_code == 200
        assert res_arch.json()["architecture_overview"] == "Mock Architecture"


@pytest.mark.asyncio
async def test_ingestion_failure_paths(monkeypatch):
    async def mock_validate(github_url):
        return {"owner": "owner", "name": "repo", "star_count": 0, "fork_count": 0, "language": "Py", "total_size_bytes": 100}
    monkeypatch.setattr(GitHubService, "validate_repository", mock_validate)
    
    def mock_clone(url, target_dir):
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "main.py"), "w") as f:
            f.write("print('Hello World')")
            
    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda t: "a" * 40)
    
    # 1. Simulate Gemini failure during embeddings
    def mock_embeddings_fail(self, texts):
        raise RuntimeError("Gemini Embedding API Overloaded")
    monkeypatch.setattr(GeminiService, "get_embeddings", mock_embeddings_fail)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/ingest", json={"github_url": "https://github.com/owner/repo-fail-embed"})
        repo_id = res.json()["id"]
        
        # Wait for task execution
        await asyncio.sleep(0.1)
        
        res_check = await ac.get(f"/api/repositories/{repo_id}")
        assert res_check.json()["status"] == "FAILED"
        assert "Gemini Embedding API Overloaded" in res_check.json()["error_message"]


@pytest.mark.asyncio
async def test_e2e_conversational_rag_and_citation_flow(monkeypatch):
    # 1. Seed completed repository in SQLite
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires = now + timedelta(hours=2)
    test_repo = Repository(
        id=500,
        github_url="https://github.com/owner/citerepo",
        owner="owner",
        name="citerepo",
        status="COMPLETED",
        commit_sha="f" * 40,  # Commit anchoring metadata
        created_at=now,
        expires_at=expires
    )
    async with TestSessionLocal() as session:
        session.add(test_repo)
        await session.commit()

    # 2. Mock retrieval chunk results
    mock_chunks = [
        {
            "content": "def run():\n    return 'grounded'",
            "file_path": "runner.py",
            "start_line": 10,
            "end_line": 12
        }
    ]
    monkeypatch.setattr(VectorDBService, "query_chunks", lambda self, repo_id, query_embedding, top_k=6: mock_chunks)
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_standalone_query", lambda self, q, h: q)

    # Mock RAG response conforming strictly to ChatResponse
    mock_rag_response = ChatResponse(
        short_answer="Answer here.",
        detailed_explanation="Explanation grounded in runner.py.",
        code_snippets=[CodeSnippet(file_path="runner.py", lines="10-12", code_content="def run():\n    return 'grounded'")],
        citations=[Citation(file_path="runner.py", start_line=10, end_line=12)],
        follow_up_suggestions=["Next step?"]
    )
    monkeypatch.setattr(GeminiService, "generate_rag_answer", lambda self, q, chunks, history=None: mock_rag_response)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # A. Verify commit metadata can be retrieved
        res_repo = await ac.get("/api/repositories/500")
        assert res_repo.status_code == 200
        repo_data = res_repo.json()
        assert repo_data["commit_sha"] == "f" * 40  # Anchor verification

        # B. Call RAG chat
        res_chat = await ac.post("/api/repositories/500/chat", json={
            "query": "Is it grounded?",
            "history": [{"role": "user", "content": "Hello"}]
        })
        assert res_chat.status_code == 200
        chat_data = res_chat.json()
        
        # Verify schema mapping and contents
        assert chat_data["short_answer"] == "Answer here."
        assert chat_data["citations"][0]["file_path"] == "runner.py"
        assert chat_data["citations"][0]["start_line"] == 10
        assert chat_data["citations"][0]["end_line"] == 12

        # Verify client can construct commit-anchored citation links
        commit_revision = repo_data["commit_sha"]
        citation_file = chat_data["citations"][0]["file_path"]
        citation_start = chat_data["citations"][0]["start_line"]
        citation_end = chat_data["citations"][0]["end_line"]
        
        # Assert url formatting matches expected commit stability guidelines
        citation_url = f"{repo_data['github_url']}/blob/{commit_revision}/{citation_file}#L{citation_start}-L{citation_end}"
        assert citation_url == "https://github.com/owner/citerepo/blob/ffffffffffffffffffffffffffffffffffffffff/runner.py#L10-L12"


@pytest.mark.asyncio
async def test_rag_pipeline_gemini_failures(monkeypatch):
    # Seed repo
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    test_repo = Repository(
        id=501,
        github_url="https://github.com/owner/failrepo",
        owner="owner",
        name="failrepo",
        status="COMPLETED",
        created_at=now,
        expires_at=now + timedelta(hours=2)
    )
    async with TestSessionLocal() as session:
        session.add(test_repo)
        await session.commit()

    monkeypatch.setattr(VectorDBService, "query_chunks", lambda self, *args, **kwargs: [])
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_standalone_query", lambda self, q, h: q)
    
    # Mock RAG answer failure (e.g. rate limit exhausted)
    def mock_rag_fail(self, query, chunks, history=None):
        raise RuntimeError("Gemini API Daily Limit Exhausted")
    monkeypatch.setattr(GeminiService, "generate_rag_answer", mock_rag_fail)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/repositories/501/chat", json={"query": "Why fail?"})
        # Check endpoint handles gracefully and returns HTTP 400 Bad Request
        assert res.status_code == 400
        assert "Daily Limit Exhausted" in res.json()["detail"]


@pytest.mark.asyncio
async def test_cleanup_pipeline_execution(monkeypatch):
    # Setup: Insert one active and one expired repository in SQLite
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    repo_expired = Repository(
        id=601,
        github_url="https://github.com/owner/expired-repo",
        owner="owner",
        name="expired-repo",
        status="COMPLETED",
        created_at=now - timedelta(hours=30),
        expires_at=now - timedelta(hours=6)
    )
    repo_active = Repository(
        id=602,
        github_url="https://github.com/owner/active-repo",
        owner="owner",
        name="active-repo",
        status="COMPLETED",
        created_at=now,
        expires_at=now + timedelta(hours=18)
    )
    
    async with TestSessionLocal() as session:
        session.add_all([repo_expired, repo_active])
        await session.commit()

    # Track vector DB deletion
    deleted_collections = []
    def mock_delete_collection(self, repo_id):
        deleted_collections.append(repo_id)

    monkeypatch.setattr(VectorDBService, "delete_collection", mock_delete_collection)

    # Run the cleanup logic
    async with TestSessionLocal() as session:
        cleaned_count = await cleanup_expired_repositories(session)
        assert cleaned_count == 1

    # Verify database state
    async with TestSessionLocal() as session:
        res_expired = await session.get(Repository, 601)
        res_active = await session.get(Repository, 602)
        assert res_expired is None
        assert res_active is not None

    # Verify vector db cleanup was called
    assert 601 in deleted_collections
    assert 602 not in deleted_collections
