import os
from typing import List, Dict, Any, Tuple
import tiktoken
from backend.config import settings

# Ignored directories
IGNORED_DIRS = {
    ".git", "node_modules", "venv", ".venv", "__pycache__", 
    "dist", "build", "out", ".next", "target", "bin", "obj",
    "eggs", ".eggs", "develop-eggs", "sdist", "wheels", ".idea", ".vscode"
}

# Blacklisted binary or media file extensions
IGNORED_EXTENSIONS = {
    # Images
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".bmp", ".tiff",
    # Audio/Video
    ".mp4", ".mov", ".mp3", ".wav", ".avi", ".mkv", ".flac", ".ogg",
    # Compiled/Executables
    ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar", ".war", ".pyc",
    # Fonts
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    # Archives
    ".zip", ".tar.gz", ".tar", ".gz", ".rar", ".7z",
    # Data/Documents (often non-code or too large)
    ".pdf", ".docx", ".xlsx", ".pptx", ".csv", ".tsv",
    # Minified files
    ".min.js", ".min.css"
}

class ParserService:
    def __init__(self, target_chunk_tokens: int = 400, overlap_tokens: int = 100):
        self.target_chunk_tokens = target_chunk_tokens
        self.overlap_tokens = overlap_tokens
        try:
            self.encoder = tiktoken.get_encoding("cl100k_base")
        except Exception:
            # Fallback encoder if offline/error
            self.encoder = None

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for a text snippet."""
        if self.encoder:
            try:
                return len(self.encoder.encode(text, disallowed_special=()))
            except Exception:
                pass
        # Simple character-based fallback (approx. 4 chars per token)
        return len(text) // 4

    def is_binary(self, file_path: str) -> bool:
        """Check if a file contains null bytes in its first 8KB (standard binary check)."""
        try:
            with open(file_path, "rb") as f:
                chunk = f.read(8192)
                return b"\x00" in chunk
        except Exception:
            return True

    def should_process_file(self, file_path: str, relative_path: str) -> bool:
        """Determine if a file should be processed based on path, size, and type."""
        # Check extensions
        _, ext = os.path.splitext(relative_path.lower())
        if ext in IGNORED_EXTENSIONS:
            return False
            
        # Check specific minified signatures
        if relative_path.endswith(".min.js") or relative_path.endswith(".min.css"):
            return False

        # Exclude common locked files
        if relative_path.endswith("package-lock.json") or relative_path.endswith("yarn.lock") or relative_path.endswith("pnpm-lock.yaml"):
            return False

        # Check path parts for ignored folders
        parts = relative_path.split(os.sep)
        for part in parts:
            if part in IGNORED_DIRS:
                return False

        # Check file size (e.g. skip files larger than 1MB to avoid memory blowup)
        try:
            if os.path.getsize(file_path) > 1 * 1024 * 1024:
                return False
        except Exception:
            return False

        # Finally, check binary contents
        if self.is_binary(file_path):
            return False

        return True

    def parse_repository(self, repo_dir: str) -> List[Dict[str, Any]]:
        """
        Walks the directory, filters files, counts them, and returns all chunks.
        Raises ValueError if file limit is exceeded.
        """
        all_chunks: List[Dict[str, Any]] = []
        file_count = 0
        repo_dir_abs = os.path.abspath(repo_dir)

        for root, dirs, files in os.walk(repo_dir_abs):
            # Prune directories in place to avoid walking ignored paths
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]

            for file in files:
                abs_file_path = os.path.join(root, file)
                rel_file_path = os.path.relpath(abs_file_path, repo_dir_abs)

                if self.should_process_file(abs_file_path, rel_file_path):
                    file_count += 1
                    if file_count > settings.MAX_REPO_FILES:
                        raise ValueError(
                            f"Repository contains too many indexable files (exceeds limit of {settings.MAX_REPO_FILES})."
                        )
                    
                    chunks = self.chunk_file(abs_file_path, rel_file_path)
                    all_chunks.extend(chunks)

        return all_chunks

    def chunk_file(self, abs_path: str, rel_path: str) -> List[Dict[str, Any]]:
        """
        Read a file, count tokens line-by-line, and build chunks with overlap.
        Preserves line-number boundaries.
        """
        chunks: List[Dict[str, Any]] = []
        try:
            with open(abs_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except Exception:
            return []

        if not lines:
            return []

        # List of tuples: (line_number_1_based, line_text, token_count)
        processed_lines: List[Tuple[int, str, int]] = []
        for idx, line in enumerate(lines, start=1):
            # Strip outer spaces for token check but keep indent in code snippet
            tok_cnt = self.estimate_tokens(line)
            processed_lines.append((idx, line, tok_cnt))

        current_lines: List[Tuple[int, str, int]] = []
        current_tokens = 0
        i = 0
        n = len(processed_lines)

        while i < n:
            line_no, text, tokens = processed_lines[i]
            
            # Guard against extremely long individual lines (e.g. data URLs or long strings)
            if tokens > self.target_chunk_tokens:
                # If we have a pending chunk, flush it first
                if current_lines:
                    chunks.append(self._create_chunk(rel_path, current_lines))
                    current_lines = []
                    current_tokens = 0
                
                # Treat this super long line as its own chunk, truncate text if unreasonably massive
                truncated_text = text if len(text) <= 5000 else text[:5000] + "\n... [Line Truncated] ...\n"
                chunks.append({
                    "file_path": rel_path,
                    "start_line": line_no,
                    "end_line": line_no,
                    "content": truncated_text,
                    "token_count": min(tokens, 1000)
                })
                i += 1
                continue

            # If adding this line exceeds target, finalize current chunk
            if current_tokens + tokens > self.target_chunk_tokens and current_lines:
                chunks.append(self._create_chunk(rel_path, current_lines))
                
                # Backtrack to build the overlap
                overlap_accum = 0
                backtrack_idx = len(current_lines) - 1
                overlap_lines = []
                
                while backtrack_idx >= 0:
                    line_tuple = current_lines[backtrack_idx]
                    _, _, line_toks = line_tuple
                    if overlap_accum + line_toks > self.overlap_tokens:
                        break
                    overlap_lines.insert(0, line_tuple)
                    overlap_accum += line_toks
                    backtrack_idx -= 1
                
                # Re-initialize current chunk with overlap lines
                current_lines = overlap_lines
                current_tokens = overlap_accum

            current_lines.append((line_no, text, tokens))
            current_tokens += tokens
            i += 1

        # Add any trailing lines
        if current_lines:
            chunks.append(self._create_chunk(rel_path, current_lines))

        return chunks

    def _create_chunk(self, rel_path: str, lines_list: List[Tuple[int, str, int]]) -> Dict[str, Any]:
        """Helper to format chunk dictionary."""
        start_line = lines_list[0][0]
        end_line = lines_list[-1][0]
        content = "".join([item[1] for item in lines_list])
        token_count = sum([item[2] for item in lines_list])
        
        return {
            "file_path": rel_path,
            "start_line": start_line,
            "end_line": end_line,
            "content": content,
            "token_count": token_count
        }
