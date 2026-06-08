import pytest
import pytest_asyncio
import asyncio
import threading
import os
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from backend.database import Base
from backend.models import Repository
from backend.config import settings
from backend.services.ingestion import IngestionService
from backend.services.github import GitHubService
from backend.services.gemini import GeminiService
from backend.services.vector_db import VectorDBService

# Database setup for isolated integration test
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(autouse=True)
def configure_settings(monkeypatch):
    # Force max concurrent limit to 2 for deterministic testing
    monkeypatch.setattr(settings, "MAX_CONCURRENT_INGESTIONS", 2)
    # Ensure IngestionService's semaphore is reset
    IngestionService._semaphore = None


@pytest_asyncio.fixture
async def setup_db(monkeypatch):
    import backend.database
    monkeypatch.setattr(backend.database, "AsyncSessionLocal", TestSessionLocal)
    
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest.mark.asyncio
async def test_ingestion_queue_pressure_and_transitions(setup_db, monkeypatch):
    # Setup mocks
    clone_event = threading.Event()
    cloned_repos = []
    
    def mock_clone(url, target_dir):
        cloned_repos.append(url)
        # Block until released by the test
        clone_event.wait(timeout=10.0)
        os.makedirs(target_dir, exist_ok=True)
        with open(os.path.join(target_dir, "main.py"), "w") as f:
            f.write("print('hello')")
            
    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda target_dir: "a" * 40)
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", lambda self, *args, **kwargs: ("Summary", "Arch"))
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, *args, **kwargs: None)
    
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires = now + timedelta(hours=24)
    
    # 1. Insert 3 PENDING repository records into the DB
    async with TestSessionLocal() as session:
        r1 = Repository(github_url="https://github.com/owner/repo1", owner="owner", name="repo1", status="PENDING", created_at=now, expires_at=expires)
        r2 = Repository(github_url="https://github.com/owner/repo2", owner="owner", name="repo2", status="PENDING", created_at=now, expires_at=expires)
        r3 = Repository(github_url="https://github.com/owner/repo3", owner="owner", name="repo3", status="PENDING", created_at=now, expires_at=expires)
        session.add_all([r1, r2, r3])
        await session.commit()
        await session.refresh(r1)
        await session.refresh(r2)
        await session.refresh(r3)
        
        r1_id, r2_id, r3_id = r1.id, r2.id, r3.id

    # 2. Fire 3 process_ingestion background tasks simultaneously
    t1 = asyncio.create_task(IngestionService.process_ingestion(r1_id))
    t2 = asyncio.create_task(IngestionService.process_ingestion(r2_id))
    t3 = asyncio.create_task(IngestionService.process_ingestion(r3_id))
    
    # Wait a brief moment to allow tasks to run and block at the clone step
    await asyncio.sleep(0.2)
    
    # 3. Assert states under queue pressure:
    # - MAX_CONCURRENT_INGESTIONS is 2.
    # - So exactly 2 of the tasks should have entered the semaphore and transitioned to PROCESSING.
    # - The 3rd task must be waiting on the semaphore, and its database state MUST remain PENDING.
    async with TestSessionLocal() as session:
        db_r1 = await session.get(Repository, r1_id)
        db_r2 = await session.get(Repository, r2_id)
        db_r3 = await session.get(Repository, r3_id)
        
        statuses = [db_r1.status, db_r2.status, db_r3.status]
        assert statuses.count("PROCESSING") == 2
        assert statuses.count("PENDING") == 1
        
        # Determine which one is waiting
        waiting_id = None
        if db_r1.status == "PENDING":
            waiting_id = r1_id
        elif db_r2.status == "PENDING":
            waiting_id = r2_id
        else:
            waiting_id = r3_id
            
        processing_ids = [rid for rid in (r1_id, r2_id, r3_id) if rid != waiting_id]

    # 4. Release the first batch of clones
    clone_event.set()
    
    # Wait for all tasks to finish
    await asyncio.gather(t1, t2, t3)
    
    # 5. Assert final states:
    # - All 3 should be COMPLETED now.
    # - No deadlocks, all semaphore slots released successfully.
    async with TestSessionLocal() as session:
        db_r1 = await session.get(Repository, r1_id)
        db_r2 = await session.get(Repository, r2_id)
        db_r3 = await session.get(Repository, r3_id)
        
        assert db_r1.status == "COMPLETED"
        assert db_r2.status == "COMPLETED"
        assert db_r3.status == "COMPLETED"


@pytest.mark.asyncio
async def test_ingestion_concurrency_exception_path(setup_db, monkeypatch):
    # Setup mocks
    clone_event = threading.Event()
    
    def mock_clone(url, target_dir):
        if "repo-fail" in url:
            # Throw exception immediately
            raise RuntimeError("Ingestion error mock")
        # Otherwise block
        clone_event.wait(timeout=5.0)
        os.makedirs(target_dir, exist_ok=True)
        
    monkeypatch.setattr(GitHubService, "clone_repository", mock_clone)
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda target_dir: "a" * 40)
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", lambda self, *args, **kwargs: ("Summary", "Arch"))
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, *args, **kwargs: None)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires = now + timedelta(hours=24)

    # 1. Insert 3 PENDING repository records, one of which will fail
    async with TestSessionLocal() as session:
        r_fail = Repository(github_url="https://github.com/owner/repo-fail", owner="owner", name="fail", status="PENDING", created_at=now, expires_at=expires)
        r_ok1 = Repository(github_url="https://github.com/owner/repo-ok1", owner="owner", name="ok1", status="PENDING", created_at=now, expires_at=expires)
        r_ok2 = Repository(github_url="https://github.com/owner/repo-ok2", owner="owner", name="ok2", status="PENDING", created_at=now, expires_at=expires)
        session.add_all([r_fail, r_ok1, r_ok2])
        await session.commit()
        await session.refresh(r_fail)
        await session.refresh(r_ok1)
        await session.refresh(r_ok2)
        
        fail_id, ok1_id, ok2_id = r_fail.id, r_ok1.id, r_ok2.id

    # Fire tasks
    t_fail = asyncio.create_task(IngestionService.process_ingestion(fail_id))
    t_ok1 = asyncio.create_task(IngestionService.process_ingestion(ok1_id))
    t_ok2 = asyncio.create_task(IngestionService.process_ingestion(ok2_id))
    
    # Wait a brief moment.
    # The fail task should execute and fail immediately, freeing a semaphore slot.
    # Therefore, both ok1 and ok2 can enter PROCESSING even though limit is 2!
    await asyncio.sleep(0.2)
    
    async with TestSessionLocal() as session:
        db_fail = await session.get(Repository, fail_id)
        db_ok1 = await session.get(Repository, ok1_id)
        db_ok2 = await session.get(Repository, ok2_id)
        
        assert db_fail.status == "FAILED"
        assert "Ingestion error mock" in db_fail.error_message
        assert db_ok1.status == "PROCESSING"
        assert db_ok2.status == "PROCESSING"

    # Cleanup
    clone_event.set()
    await asyncio.gather(t_fail, t_ok1, t_ok2)


@pytest.mark.asyncio
async def test_recovery_logic_concurrency(setup_db, monkeypatch):
    # Setup mocks to sleep to simulate processing
    clone_event = threading.Event()
    
    monkeypatch.setattr(GitHubService, "clone_repository", lambda url, target_dir: clone_event.wait(timeout=5.0))
    monkeypatch.setattr(GitHubService, "get_commit_sha", lambda target_dir: "a" * 40)
    monkeypatch.setattr(GeminiService, "get_embeddings", lambda self, texts: [[0.1] * 768])
    monkeypatch.setattr(GeminiService, "generate_summary_and_architecture", lambda self, *args, **kwargs: ("Summary", "Arch"))
    monkeypatch.setattr(VectorDBService, "add_chunks", lambda self, *args, **kwargs: None)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires = now + timedelta(hours=24)

    # 1. Seed the DB with a stuck PROCESSING repo and 3 stuck PENDING repos
    async with TestSessionLocal() as session:
        repo_stuck = Repository(github_url="https://github.com/owner/stuck", owner="owner", name="stuck", status="PROCESSING", created_at=now, expires_at=expires)
        repo_p1 = Repository(github_url="https://github.com/owner/p1", owner="owner", name="p1", status="PENDING", created_at=now, expires_at=expires)
        repo_p2 = Repository(github_url="https://github.com/owner/p2", owner="owner", name="p2", status="PENDING", created_at=now, expires_at=expires)
        repo_p3 = Repository(github_url="https://github.com/owner/p3", owner="owner", name="p3", status="PENDING", created_at=now, expires_at=expires)
        session.add_all([repo_stuck, repo_p1, repo_p2, repo_p3])
        await session.commit()
        
        stuck_id, p1_id, p2_id, p3_id = repo_stuck.id, repo_p1.id, repo_p2.id, repo_p3.id

    # 2. Run the recovery logic
    async with TestSessionLocal() as session:
        # 2.1 Update PROCESSING -> FAILED
        from sqlalchemy import update
        await session.execute(
            update(Repository)
            .where(Repository.status == "PROCESSING")
            .values(
                status="FAILED",
                error_message="Ingestion was interrupted by a server restart. Please click retry to re-index."
            )
        )
        await session.commit()
        
        # 2.2 Automatically re-queue PENDING records
        res_pending = await session.execute(
            select(Repository).where(Repository.status == "PENDING")
        )
        pending_repos = res_pending.scalars().all()
        tasks = []
        for repo in pending_repos:
            tasks.append(asyncio.create_task(IngestionService.process_ingestion(repo.id)))

    # Wait a brief moment for enqueued recovery tasks to execute
    await asyncio.sleep(0.2)

    # 3. Assert:
    # - Stuck repo is FAILED with restart message
    # - exactly 2 enqueued tasks are PROCESSING
    # - the 3rd enqueued task is PENDING (waiting on semaphore)
    async with TestSessionLocal() as session:
        db_stuck = await session.get(Repository, stuck_id)
        db_p1 = await session.get(Repository, p1_id)
        db_p2 = await session.get(Repository, p2_id)
        db_p3 = await session.get(Repository, p3_id)
        
        assert db_stuck.status == "FAILED"
        assert "interrupted by a server restart" in db_stuck.error_message
        
        statuses = [db_p1.status, db_p2.status, db_p3.status]
        assert statuses.count("PROCESSING") == 2
        assert statuses.count("PENDING") == 1

    # Cleanup
    clone_event.set()
    await asyncio.gather(*tasks)
