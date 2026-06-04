from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.models import Repository
from backend.services.vector_db import VectorDBService

async def cleanup_expired_repositories(db: AsyncSession) -> int:
    """
    Scans the SQLite database for repositories past their expiration time (24h limit),
    purges their ChromaDB collections, deletes their metadata entries, and saves changes.
    Returns the count of successfully deleted repositories.
    """
    # SQLite datetimes are timezone-naive but written in UTC. Compare to naive UTC datetime.
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Select repositories where the expiration timestamp has passed
    query = select(Repository).where(Repository.expires_at < now)
    result = await db.execute(query)
    expired_repos = result.scalars().all()
    
    if not expired_repos:
        return 0
        
    vector_service = VectorDBService()
    deleted_count = 0
    
    for repo in expired_repos:
        try:
            # 1. Delete the corresponding collection from ChromaDB
            vector_service.delete_collection(repo.id)
            
            # 2. Remove the metadata record from SQLite
            await db.delete(repo)
            deleted_count += 1
        except Exception as e:
            # Generate a warning and proceed so one failure doesn't stall others
            import warnings
            warnings.warn(f"Failed to clean up expired repository {repo.id} ({repo.github_url}): {str(e)}")
            
    if deleted_count > 0:
        await db.commit()
        
    return deleted_count
