import asyncio
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.config import settings, validate_settings
from backend.database import get_db, engine, AsyncSessionLocal, Base
from backend.models import Repository
from backend.schemas import (
    RepositoryIngestRequest,
    RepositoryResponse,
    ChatRequest,
    ChatResponse
)
from backend.services.ingestion import IngestionService, IngestionServiceError
from backend.services.rag import RAGService, RAGServiceError
from backend.services.cleanup import cleanup_expired_repositories

# Initialize SlowAPI Rate Limiter
limiter = Limiter(key_func=get_remote_address)

async def cache_cleanup_loop():
    """Background task to periodically clean up expired repository caches."""
    while True:
        try:
            # Check every 10 minutes
            await asyncio.sleep(600)
            async with AsyncSessionLocal() as session:
                deleted = await cleanup_expired_repositories(session)
                if deleted > 0:
                    print(f"[Cleanup] Automatically cleaned up {deleted} expired repositories.")
        except asyncio.CancelledError:
            break
        except Exception as e:
            # Safe logging: do not raise, just print warnings to avoid stopping the loop
            print(f"[Cleanup Error] Background cache cleanup failed: {str(e)}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate critical variables on startup
    validate_settings()
    
    # Auto-initialize database tables if not present
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migration check: verify if commit_sha column exists
        res = await conn.execute(text("PRAGMA table_info(repositories)"))
        columns = [row[1] for row in res.fetchall()]
        if "commit_sha" not in columns:
            await conn.execute(text("ALTER TABLE repositories ADD COLUMN commit_sha VARCHAR(40)"))
        
    # Start cache expiration background task
    cleanup_task = asyncio.create_task(cache_cleanup_loop())
    
    yield
    
    # Shutdown lifespan
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass

# Instantiate FastAPI application
app = FastAPI(
    title="RepoChat API",
    description="API for indexing and chatting with public GitHub repositories.",
    version="1.0.0",
    lifespan=lifespan
)

# Attach slowapi rate limiter state & exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Helper to fetch active repository metadata
async def get_active_repository(repo_id: int, db: AsyncSession) -> Repository:
    stmt = select(Repository).where(Repository.id == repo_id)
    result = await db.execute(stmt)
    repo = result.scalar_one_or_none()
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Repository not found in cache. Please ingest it first."
        )
    if repo.is_expired():
        # Perform inline cleanup to keep cache state consistent
        from backend.services.vector_db import VectorDBService
        vector_db = VectorDBService()
        vector_db.delete_collection(repo.id)
        await db.delete(repo)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Repository cache has expired. Please re-ingest the repository."
        )
    return repo

# --- Endpoints ---

@app.post(
    "/api/ingest",
    response_model=RepositoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Ingest public GitHub repository",
    description="Clones, parses, indexes code chunks, and computes summary/architecture."
)
@limiter.limit("5/hour")
async def ingest_repository(
    request: Request,
    payload: RepositoryIngestRequest,
    db: AsyncSession = Depends(get_db)
):
    try:
        repo = await IngestionService.ingest_repository(payload.github_url, db)
        return repo
    except IngestionServiceError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        # Avoid exposing internal stack traces/details
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during ingestion."
        )

@app.post(
    "/api/repositories/{repo_id}/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Chat about repository code content",
    description="Answers query using semantic search chunks from ChromaDB and Gemini RAG."
)
@limiter.limit("60/hour")
async def chat_about_repository(
    request: Request,
    repo_id: int,
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    # Verify repository is active and exists
    await get_active_repository(repo_id, db)
    
    try:
        rag_service = RAGService()
        answer = await rag_service.answer_query(repo_id, payload.query, db)
        return answer
    except RAGServiceError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during processing."
        )

@app.post(
    "/api/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Chat about repository code content (query parameter alias)",
    description="Provides chat capabilities specifying repo_id via query parameter."
)
@limiter.limit("60/hour")
async def chat_about_repository_alias(
    request: Request,
    repo_id: int,
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    return await chat_about_repository(request, repo_id, payload, db)

@app.get(
    "/api/repositories/{repo_id}/summary",
    response_model=Dict[str, str],
    status_code=status.HTTP_200_OK,
    summary="Get repository summary",
    description="Retrieves the generated high-level summary of the codebase."
)
async def get_repository_summary(
    repo_id: int,
    db: AsyncSession = Depends(get_db)
):
    repo = await get_active_repository(repo_id, db)
    return {"summary": repo.summary or "Summary not available."}

@app.get(
    "/api/repositories/{repo_id}/architecture",
    response_model=Dict[str, str],
    status_code=status.HTTP_200_OK,
    summary="Get repository architecture overview",
    description="Retrieves the generated architectural overview of the codebase."
)
async def get_repository_architecture(
    repo_id: int,
    db: AsyncSession = Depends(get_db)
):
    repo = await get_active_repository(repo_id, db)
    return {"architecture_overview": repo.architecture_overview or "Architecture overview not available."}

@app.get(
    "/api/repositories/{repo_id}",
    response_model=RepositoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get repository metadata",
    description="Retrieves cached metadata for the ingested repository."
)
async def get_repository_metadata(
    repo_id: int,
    db: AsyncSession = Depends(get_db)
):
    repo = await get_active_repository(repo_id, db)
    return repo
