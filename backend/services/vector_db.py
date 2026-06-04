import os
from typing import List, Dict, Any
import chromadb
from backend.config import settings

class VectorDBService:
    def __init__(self):
        # Create storage dir if it doesn't exist
        os.makedirs(settings.CHROMA_DB_PATH, exist_ok=True)
        self.client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)

    def _get_collection_name(self, repo_id: int) -> str:
        """Construct a safe collection name for ChromaDB."""
        return f"repo_{repo_id}"

    def add_chunks(self, repo_id: int, chunks: List[Dict[str, Any]], embeddings: List[List[float]]) -> None:
        """
        Store code chunks and their pre-computed embeddings in a repository-specific collection.
        """
        if not chunks or not embeddings:
            return

        collection_name = self._get_collection_name(repo_id)
        
        # Get or create collection. If exists, delete first to clear state
        try:
            self.client.delete_collection(name=collection_name)
        except Exception:
            pass  # Collection didn't exist

        collection = self.client.create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"}  # Use cosine similarity
        )

        ids = [f"chunk_{repo_id}_{idx}" for idx in range(len(chunks))]
        documents = [chunk["content"] for chunk in chunks]
        metadatas = [
            {
                "file_path": chunk["file_path"],
                "start_line": chunk["start_line"],
                "end_line": chunk["end_line"]
            }
            for chunk in chunks
        ]

        # Add to collection in batches if very large
        batch_size = 200
        for i in range(0, len(ids), batch_size):
            collection.add(
                ids=ids[i:i + batch_size],
                embeddings=embeddings[i:i + batch_size],
                metadatas=metadatas[i:i + batch_size],
                documents=documents[i:i + batch_size]
            )

    def query_chunks(self, repo_id: int, query_embedding: List[float], top_k: int = 6) -> List[Dict[str, Any]]:
        """
        Perform semantic search to find top-k matching code chunks.
        """
        collection_name = self._get_collection_name(repo_id)
        try:
            collection = self.client.get_collection(name=collection_name)
        except Exception:
            # Collection not found
            return []

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k
        )

        chunks = []
        if results and "documents" in results and results["documents"]:
            # Retrieve queried results
            docs = results["documents"][0]
            metas = results["metadatas"][0]
            
            for doc, meta in zip(docs, metas):
                chunks.append({
                    "content": doc,
                    "file_path": meta.get("file_path", ""),
                    "start_line": meta.get("start_line", 0),
                    "end_line": meta.get("end_line", 0)
                })
                
        return chunks

    def delete_collection(self, repo_id: int) -> None:
        """
        Delete a repository's collection. Useful for cache expiration.
        """
        collection_name = self._get_collection_name(repo_id)
        try:
            self.client.delete_collection(name=collection_name)
        except Exception:
            pass  # Collection did not exist, ignore
