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

# Isolated database setup for concurrency test module
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
async def setup_concurrency_db(monkeypatch):
    import backend.database
    import backend.main
    monkeypatch.setattr(backend.database, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(backend.main, "AsyncSessionLocal", TestSessionLocal)
    
    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_get_db
    app.state.limiter.enabled = False
    # Reset semaphore
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
async def test_concurrent_ingestions_semaphore_flow(monkeypatch):
    """
    Fire 3 simultaneous ingestions directly. Verify that exactly 2 run in parallel (PROCESSING)
    while the 3rd remains PENDING, and then runs once a slot opens up.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # 1. Register 3 repositories in DB in PENDING state
    async with TestSessionLocal() as session:
        r1 = Repository(github_url="https://github.com/owner/repo1", owner="owner", name="repo1", status="PENDING", created_at=now, expires_at=now+timedelta(hours=1))
        r2 = Repository(github_url="https://github.com/owner/repo2", owner="owner", name="repo2", status="PENDING", created_at=now, expires_at=now+timedelta(hours=1))
        r3 = Repository(github_url="https://github.com/owner/repo3", owner="owner", name="repo3", status="PENDING", created_at=now, expires_at=now+timedelta(hours=1))
        session.add_all([r1, r2, r3])
        await session.commit()
        
        id1, id2, id3 = r1.id, r2.id, r3.id

    # 2. Mock process_ingestion logic to acquire semaphore and sleep asynchronously
    async def mock_process_ingestion(repo_id):
        from backend.database import AsyncSessionLocal as LocalSession
        async with IngestionService.get_semaphore():
            # Set to PROCESSING
            async with LocalSession() as db:
                stmt = select(Repository).where(Repository.id == repo_id)
                res = await db.execute(stmt)
                repo = res.scalar_one_or_none()
                if repo:
                    repo.status = "PROCESSING"
                    await db.commit()
            
            # Sleep to hold the semaphore slot
            await asyncio.sleep(0.3)
            
            # Set to COMPLETED
            async with LocalSession() as db:
                stmt = select(Repository).where(Repository.id == repo_id)
                res = await db.execute(stmt)
                repo = res.scalar_one_or_none()
                if repo:
                    repo.status = "COMPLETED"
                    await db.commit()

    monkeypatch.setattr(IngestionService, "process_ingestion", mock_process_ingestion)

    # 3. Fire the 3 tasks concurrently using asyncio.gather
    task1 = asyncio.create_task(IngestionService.process_ingestion(id1))
    task2 = asyncio.create_task(IngestionService.process_ingestion(id2))
    task3 = asyncio.create_task(IngestionService.process_ingestion(id3))

    # Wait a very short moment (0.1s) for tasks to start and acquire semaphore slots
    await asyncio.sleep(0.1)

    # 4. Check database states
    async with TestSessionLocal() as session:
        res = await session.execute(select(Repository.id, Repository.status).where(Repository.id.in_([id1, id2, id3])))
        statuses = {row[0]: row[1] for row in res.fetchall()}

    # Exactly 2 should be in PROCESSING, and 1 should remain PENDING
    status_values = list(statuses.values())
    assert status_values.count("PROCESSING") == 2
    assert status_values.count("PENDING") == 1

    # 5. Wait for the tasks to finish
    await asyncio.gather(task1, task2, task3)

    # 6. Check that all have completed successfully
    async with TestSessionLocal() as session:
        res = await session.execute(select(Repository.status).where(Repository.id.in_([id1, id2, id3])))
        final_statuses = [row[0] for row in res.fetchall()]
        
    assert all(status == "COMPLETED" for status in final_statuses)


@pytest.mark.asyncio
async def test_concurrent_chats_isolation(monkeypatch):
    """
    Verifies that multiple concurrent chat queries can be handled in parallel without database cross-leakage.
    """
    # 1. Seed two active repos in DB
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    repo1 = Repository(id=10, github_url="https://github.com/owner/r1", owner="owner", name="r1", status="COMPLETED", created_at=now, expires_at=now+timedelta(hours=1))
    repo2 = Repository(id=11, github_url="https://github.com/owner/r2", owner="owner", name="r2", status="COMPLETED", created_at=now, expires_at=now+timedelta(hours=1))
    
    async with TestSessionLocal() as session:
        session.add_all([repo1, repo2])
        await session.commit()

    # 2. Mock RAG Service
    monkeypatch.setattr(VectorDBService, "query_chunks", lambda self, repo_id, query_embedding, top_k=6: [
        {"content": f"code from repo {repo_id}", "file_path": "main.py", "start_line": 1, "end_line": 2}
    ])
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_standalone_query", lambda self, q, h: q)
    
    # Mock RAG answer to return the repo ID in the response for verification
    def mock_generate_rag(self, query, chunks, history=None):
        repo_label = chunks[0]["content"] # Extracts the "code from repo {repo_id}" string
        return ChatResponse(
            short_answer=f"Answer for {repo_label}",
            detailed_explanation="Detail",
            code_snippets=[],
            citations=[Citation(file_path="main.py", start_line=1, end_line=2)],
            follow_up_suggestions=[]
        )
    monkeypatch.setattr(GeminiService, "generate_rag_answer", mock_generate_rag)

    # 3. Fire 10 concurrent chat requests targeting both repos
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        tasks = []
        for i in range(10):
            target_repo = 10 if i % 2 == 0 else 11
            t = ac.post(f"/api/repositories/{target_repo}/chat", json={"query": f"query {i}"})
            tasks.append(t)
            
        responses = await asyncio.gather(*tasks)
        
        # Validate that each response maps correctly to the queried repository
        for idx, res in enumerate(responses):
            assert res.status_code == 200
            data = res.json()
            expected_repo = 10 if idx % 2 == 0 else 11
            assert f"code from repo {expected_repo}" in data["short_answer"]
