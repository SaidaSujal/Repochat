import os
import shutil
import subprocess
import tempfile
import asyncio
from typing import Dict, Any, Tuple
import httpx
from backend.config import settings

class GitHubServiceError(Exception):
    pass

class GitHubService:
    _active_ingestions = set()
    _lock = asyncio.Lock()

    @classmethod
    async def acquire_ingestion_lock(cls, github_url: str) -> bool:
        """
        Attempts to acquire an ingestion lock for a specific repository URL.
        Returns True if acquired successfully, False if already being processed.
        """
        async with cls._lock:
            if github_url in cls._active_ingestions:
                return False
            cls._active_ingestions.add(github_url)
            return True
            
    @classmethod
    async def release_ingestion_lock(cls, github_url: str) -> None:
        """Releases the ingestion lock for a specific repository URL."""
        async with cls._lock:
            cls._active_ingestions.discard(github_url)

    @staticmethod
    def parse_url(github_url: str) -> Tuple[str, str]:
        """Extract owner and repo name from normalized GitHub URL."""
        # e.g., https://github.com/owner/repo
        url = github_url.strip().rstrip("/")
        if url.endswith(".git"):
            url = url[:-4]
            
        parts = url.split("/")
        if len(parts) < 5 or parts[-3].lower() != "github.com":
            raise GitHubServiceError("Invalid GitHub URL structure. URL must end with github.com/owner/repo")
            
        owner = parts[-2]
        repo = parts[-1]
        return owner, repo

    @classmethod
    async def validate_repository(cls, github_url: str) -> Dict[str, Any]:
        """
        Verify if the repository exists, is public, and is within the size limits.
        Returns repository metadata.
        """
        try:
            owner, repo = cls.parse_url(github_url)
        except Exception as e:
            raise GitHubServiceError(f"Could not parse GitHub URL: {str(e)}")

        headers = {}
        if settings.GITHUB_TOKEN:
            headers["Authorization"] = f"token {settings.GITHUB_TOKEN}"

        api_url = f"https://api.github.com/repos/{owner}/{repo}"
        
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            try:
                response = await client.get(api_url, headers=headers)
            except httpx.RequestError as e:
                raise GitHubServiceError(f"Network error trying to validate repository: {str(e)}")

            if response.status_code == 404:
                raise GitHubServiceError("Repository not found or is private. Only public repositories are supported.")
            elif response.status_code != 200:
                raise GitHubServiceError(f"GitHub API returned error code {response.status_code}: {response.text}")

            data = response.json()
            
            # Private repo check (safety fallback)
            if data.get("private", False):
                raise GitHubServiceError("The repository is private. Only public repositories are supported.")

            # Size check: GitHub API returns size in KB. 50MB = 51200 KB
            size_kb = data.get("size", 0)
            max_size_kb = settings.MAX_REPO_SIZE_MB * 1024
            if size_kb > max_size_kb:
                raise GitHubServiceError(
                    f"Repository is too large ({size_kb / 1024:.1f}MB). "
                    f"Maximum allowed size is {settings.MAX_REPO_SIZE_MB}MB."
                )

            actual_owner = data.get("owner", {}).get("login", owner)
            actual_repo = data.get("name", repo)

            return {
                "owner": actual_owner,
                "name": actual_repo,
                "star_count": data.get("stargazers_count", 0),
                "fork_count": data.get("forks_count", 0),
                "language": data.get("language", "Unknown"),
                "total_size_bytes": size_kb * 1024
            }

    @staticmethod
    def clone_repository(github_url: str, target_dir: str) -> None:
        """
        Perform a shallow clone of the repository to target_dir.
        """
        try:
            # Run git clone in a subprocess with the configured timeout limit
            result = subprocess.run(
                ["git", "clone", "--depth", "1", "--single-branch", github_url, target_dir],
                capture_output=True,
                text=True,
                check=False,
                timeout=settings.GIT_CLONE_TIMEOUT_SEC
            )
            if result.returncode != 0:
                raise GitHubServiceError(f"Git clone failed: {result.stderr.strip()}")
        except subprocess.TimeoutExpired:
            raise GitHubServiceError(f"Git clone operation timed out after {settings.GIT_CLONE_TIMEOUT_SEC} seconds.")
        except FileNotFoundError:
            raise GitHubServiceError("git command line tool is not installed on the system.")
        except Exception as e:
            raise GitHubServiceError(f"Failed to clone repository: {str(e)}")


    @staticmethod
    def get_commit_sha(target_dir: str) -> str:
        """
        Retrieve the current HEAD commit SHA of the cloned repository.
        """
        try:
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=target_dir,
                capture_output=True,
                text=True,
                check=True,
                timeout=settings.GIT_COMMAND_TIMEOUT_SEC
            )
            sha = result.stdout.strip()
            import re
            if len(sha) != 40 or not re.match(r"^[0-9a-f]{40}$", sha):
                raise GitHubServiceError(f"Cloned repository returned an invalid SHA: {sha}")
            return sha
        except subprocess.TimeoutExpired:
            raise GitHubServiceError("Retrieving commit SHA timed out.")
        except subprocess.CalledProcessError as e:
            raise GitHubServiceError(f"Failed to get commit SHA: {e.stderr.strip()}")
        except Exception as e:
            raise GitHubServiceError(f"Failed to get repository commit SHA: {str(e)}")

    @staticmethod
    def cleanup_directory(target_dir: str) -> None:
        """
        Securely remove a directory. Ensures directory is inside a temporary layout.
        """
        if not target_dir or not os.path.exists(target_dir):
            return
        
        # Security check: avoid deleting system/critical root paths
        resolved_path = os.path.abspath(target_dir)
        # Check if it contains 'tmp' or a subfolder of RepoChat workspace
        workspace_root = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
        
        # Ensure it is a temp folder or inside workspace temp folder
        is_temp = resolved_path.startswith(tempfile.gettempdir())
        is_workspace_subfolder = resolved_path.startswith(workspace_root) and (resolved_path != workspace_root)
        
        if not (is_temp or is_workspace_subfolder):
            raise GitHubServiceError(f"Security error: blocked attempt to delete non-temporary path {resolved_path}")
            
        try:
            shutil.rmtree(resolved_path, ignore_errors=True)
        except Exception as e:
            # Log warning, don't crash
            import warnings
            warnings.warn(f"Failed to cleanup directory {resolved_path}: {str(e)}")
