import os
import tempfile
import pytest
from backend.services.parser import ParserService
from backend.services.github import GitHubService, GitHubServiceError

def test_github_url_parsing():
    url = "https://github.com/octocat/Spoon-Knife"
    owner, repo = GitHubService.parse_url(url)
    assert owner == "octocat"
    assert repo == "Spoon-Knife"
    
    with pytest.raises(GitHubServiceError):
        GitHubService.parse_url("https://github.com/invalid")

def test_parser_should_process_file(monkeypatch):
    parser = ParserService()
    
    # Mock filesystem checks to test path filter logic without needing real files
    monkeypatch.setattr(parser, "is_binary", lambda path: False)
    monkeypatch.setattr(os.path, "getsize", lambda path: 500)
    
    # Should ignore binaries and blacklisted dirs/extensions
    assert not parser.should_process_file("dummy/image.png", "dummy/image.png")
    assert not parser.should_process_file("dummy/node_modules/index.js", "dummy/node_modules/index.js")
    assert not parser.should_process_file("dummy/.git/config", "dummy/.git/config")
    assert not parser.should_process_file("dummy/package-lock.json", "dummy/package-lock.json")
    
    # Should accept standard text files
    assert parser.should_process_file("dummy/main.py", "dummy/main.py")
    assert parser.should_process_file("dummy/App.tsx", "dummy/App.tsx")

def test_parser_chunk_file():
    parser = ParserService(target_chunk_tokens=50, overlap_tokens=15)
    
    # Write a mock python file with multiple lines
    with tempfile.NamedTemporaryFile(mode="w+", suffix=".py", delete=False) as f:
        f.write("\n".join([f"def func_{i}():\n    print('This is line {i}')" for i in range(10)]))
        temp_file_path = f.name

    try:
        chunks = parser.chunk_file(temp_file_path, "mock_file.py")
        
        # Verify chunk parameters
        assert len(chunks) > 0
        for chunk in chunks:
            assert chunk["file_path"] == "mock_file.py"
            assert chunk["start_line"] <= chunk["end_line"]
            assert len(chunk["content"]) > 0
            assert chunk["token_count"] > 0
            
        # Verify line order and coverage
        assert chunks[0]["start_line"] == 1
        assert chunks[-1]["end_line"] == 20  # 10 functions, 2 lines each = 20 lines
        
    finally:
        os.remove(temp_file_path)
