from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import asyncio

from backend.models import Repository
from backend.services.gemini import GeminiService
from backend.services.vector_db import VectorDBService
from backend.schemas import ChatResponse, HistoryMessage

class RAGServiceError(Exception):
    pass

class RAGService:
    def __init__(self):
        self.gemini_service = GeminiService()
        self.vector_db_service = VectorDBService()

    async def answer_query(self, repo_id: int, query: str, db: AsyncSession, history: Optional[List[HistoryMessage]] = None) -> ChatResponse:
        # Check if repository exists and is not expired
        stmt = select(Repository).where(Repository.id == repo_id)
        result = await db.execute(stmt)
        repo = result.scalar_one_or_none()
        if not repo:
            raise RAGServiceError("Repository not found in cached index. Please ingest it first.")
        if repo.is_expired():
            raise RAGServiceError("Repository cache has expired. Please re-ingest the repository.")

        # 1. Query Condensation: Generate standalone query using Gemini
        hist_list = history or []
        try:
            standalone_query = await asyncio.to_thread(
                self.gemini_service.generate_standalone_query,
                query,
                hist_list
            )
        except Exception as e:
            # Safe fallback: if condensation fails, use original query
            print(f"[RAG Warning] Condensation failed: {str(e)}. Falling back to original query.")
            standalone_query = query

        # 2. Embed condensed query
        try:
            query_embeddings = await asyncio.to_thread(self.gemini_service.get_embeddings, [standalone_query])
            if not query_embeddings:
                raise RAGServiceError("Failed to generate embedding for the query.")
            query_embedding = query_embeddings[0]
        except Exception as e:
            raise RAGServiceError(f"Embedding generation error: {str(e)}")

        # 3. Retrieve chunks from vector DB
        try:
            retrieved_chunks = await asyncio.to_thread(
                self.vector_db_service.query_chunks,
                repo_id,
                query_embedding,
                top_k=6
            )
        except Exception as e:
            raise RAGServiceError(f"Vector search error: {str(e)}")

        # 4. Generate RAG answer using retrieved chunks & chat history
        try:
            chat_response = await asyncio.to_thread(
                self.gemini_service.generate_rag_answer,
                query,
                retrieved_chunks,
                hist_list
            )
            return chat_response
        except Exception as e:
            raise RAGServiceError(f"Answer generation error: {str(e)}")

