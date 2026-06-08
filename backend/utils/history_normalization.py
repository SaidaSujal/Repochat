from typing import List, Any
from backend.schemas import HistoryMessage

def normalize_history(raw_history: Any) -> List[HistoryMessage]:
    """
    Defensively normalizes and sanitizes chat history, dropping invalid entries.
    Treats all incoming history as untrusted.
    
    Rules:
    - Drops non-list incoming structures.
    - Drops non-object entries, null values, or missing fields.
    - Allows only roles 'user' and 'assistant'.
    - Drops empty or whitespace-only message contents.
    - Trims message content to a maximum of 1000 characters if exceeded.
    - Limits history length to the last 6 messages.
    """
    normalized: List[HistoryMessage] = []
    
    if not isinstance(raw_history, list):
        return []
        
    for item in raw_history:
        try:
            role = None
            content = None
            
            if isinstance(item, dict):
                role = item.get("role")
                content = item.get("content")
            elif hasattr(item, "model_dump") and callable(getattr(item, "model_dump", None)):
                try:
                    d = item.model_dump()
                    if isinstance(d, dict):
                        role = d.get("role")
                        content = d.get("content")
                except Exception:
                    pass
            elif hasattr(item, "dict") and callable(getattr(item, "dict", None)):
                try:
                    d = item.dict()
                    if isinstance(d, dict):
                        role = d.get("role")
                        content = d.get("content")
                except Exception:
                    pass
            elif hasattr(item, "role") and hasattr(item, "content"):
                try:
                    role = getattr(item, "role")
                    content = getattr(item, "content")
                except Exception:
                    pass
            else:
                continue
                
            # Verify type compliance
            if not isinstance(role, str) or not isinstance(content, str):
                continue
                
            # Validate role values
            if role not in ("user", "assistant"):
                continue
                
            # Validate content compliance (no empty or whitespace-only)
            if not content.strip():
                continue
                
            # Trim content to maximum limit of 1000 characters
            if len(content) > 1000:
                content = content[:1000]
                
            normalized.append(HistoryMessage(role=role, content=content))
        except Exception:
            # Drop any parsing/property failures safely
            continue
            
    # Enforce maximum history length = 6 messages (keeps the last 6)
    if len(normalized) > 6:
        normalized = normalized[-6:]
        
    return normalized
