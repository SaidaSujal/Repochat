from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, HttpUrl, field_validator
import re

# Strict github URL match regex
GITHUB_URL_REGEX = re.compile(r"^https://github\.com/([a-zA-Z0-9-_.]+)/([a-zA-Z0-9-_.]+)$")

class RepositoryIngestRequest(BaseModel):
    github_url: str = Field(..., description="The URL of the public GitHub repository")

    @field_validator("github_url")
    @classmethod
    def validate_github_url(cls, value: str) -> str:
        # Normalize: strip trailing slash, whitespace, and .git extension
        url = value.strip().rstrip("/")
        if url.endswith(".git"):
            url = url[:-4]
            
        match = GITHUB_URL_REGEX.match(url)
        if not match:
            raise ValueError("URL must be a valid public GitHub repository URL, e.g. https://github.com/owner/repo")
        
        return url

class RepositoryResponse(BaseModel):
    id: int
    github_url: str
    owner: str
    name: str
    star_count: int
    fork_count: int
    language: Optional[str]
    file_count: int
    total_size_bytes: int
    summary: Optional[str]
    architecture_overview: Optional[str]
    commit_sha: Optional[str] = None
    created_at: datetime
    expires_at: datetime

    class Config:
        from_attributes = True

# --- Chat Interface Schemas ---

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000, description="The user question about the codebase")

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Query must not be empty or whitespace-only")
        return value

class CodeSnippet(BaseModel):
    file_path: str = Field(..., description="Path to the file where the code is located")
    lines: str = Field(..., description="Line range format, e.g. '10-25'")
    code_content: str = Field(..., description="The relevant code text snippet")

class Citation(BaseModel):
    file_path: str = Field(..., description="Path to the referenced file")
    start_line: int = Field(..., description="Starting line number")
    end_line: int = Field(..., description="Ending line number")

class ChatResponse(BaseModel):
    short_answer: str = Field(..., description="A direct, concise answer to the question")
    detailed_explanation: str = Field(..., description="A detailed explanation answering the query")
    code_snippets: List[CodeSnippet] = Field(..., description="Code snippets referenced in the answer")
    citations: List[Citation] = Field(..., description="Source files and line number citations")
    follow_up_suggestions: List[str] = Field(..., description="Suggested follow-up questions")
