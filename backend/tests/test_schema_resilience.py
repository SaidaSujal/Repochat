import pytest
from backend.services.gemini import GeminiService, GeminiServiceError
from backend.schemas import ChatResponse, CodeSnippet, Citation

def test_normalize_valid_full_response():
    """Verify that a completely valid and full response is correctly returned unmodified."""
    service = GeminiService()
    raw_json = """
    {
        "short_answer": "This is short.",
        "detailed_explanation": "This is detailed.",
        "code_snippets": [
            {"file_path": "main.py", "lines": "1-5", "code_content": "print('hello')"}
        ],
        "citations": [
            {"file_path": "main.py", "start_line": 1, "end_line": 5}
        ],
        "follow_up_suggestions": ["Is this it?", "What else?"]
    }
    """
    normalized = service._normalize_response_json(raw_json)
    assert normalized["short_answer"] == "This is short."
    assert normalized["detailed_explanation"] == "This is detailed."
    assert len(normalized["code_snippets"]) == 1
    assert normalized["code_snippets"][0]["file_path"] == "main.py"
    assert len(normalized["citations"]) == 1
    assert normalized["citations"][0]["start_line"] == 1
    assert len(normalized["follow_up_suggestions"]) == 2

def test_normalize_only_short_answer():
    """Verify that when only short_answer is provided, optional list and string fields default cleanly."""
    service = GeminiService()
    raw_json = '{"short_answer": "Just a short answer."}'
    normalized = service._normalize_response_json(raw_json)
    
    assert normalized["short_answer"] == "Just a short answer."
    assert normalized["detailed_explanation"] == ""
    assert normalized["code_snippets"] == []
    assert normalized["citations"] == []
    assert normalized["follow_up_suggestions"] == []
    
    # Assert it validates successfully against ChatResponse model
    response_model = ChatResponse.model_validate(normalized)
    assert response_model.short_answer == "Just a short answer."

def test_normalize_empty_object():
    """Verify that an empty json object {} normalizes to a default valid ChatResponse dict."""
    service = GeminiService()
    raw_json = "{}"
    normalized = service._normalize_response_json(raw_json)
    
    assert normalized["short_answer"] == "Response generated successfully."
    assert normalized["detailed_explanation"] == ""
    assert normalized["code_snippets"] == []
    assert normalized["citations"] == []
    assert normalized["follow_up_suggestions"] == []
    
    response_model = ChatResponse.model_validate(normalized)
    assert response_model.short_answer == "Response generated successfully."

def test_normalize_null_fields():
    """Verify that null/None values are safely converted to default strings and empty lists."""
    service = GeminiService()
    raw_json = """
    {
        "short_answer": null,
        "detailed_explanation": null,
        "code_snippets": null,
        "citations": null,
        "follow_up_suggestions": null
    }
    """
    normalized = service._normalize_response_json(raw_json)
    
    assert normalized["short_answer"] == "Response generated successfully."
    assert normalized["detailed_explanation"] == ""
    assert normalized["code_snippets"] == []
    assert normalized["citations"] == []
    assert normalized["follow_up_suggestions"] == []
    
    # Ensure validation passes
    ChatResponse.model_validate(normalized)

def test_normalize_citations_wrong_type():
    """Verify that if citations is passed as a string or non-list, it degrades safely to an empty list."""
    service = GeminiService()
    raw_json = """
    {
        "short_answer": "Valid answer",
        "citations": "not-a-list-but-a-string"
    }
    """
    normalized = service._normalize_response_json(raw_json)
    assert normalized["citations"] == []
    
    ChatResponse.model_validate(normalized)

def test_normalize_malformed_citation_objects():
    """Verify that malformed citation entries are repaired (missing line counts) or dropped (missing file_path)."""
    service = GeminiService()
    raw_json = """
    {
        "short_answer": "Valid answer",
        "citations": [
            {"file_path": "main.py"}, 
            {"start_line": 5, "end_line": 10}, 
            {"file_path": "utils.py", "start_line": "ten", "end_line": null}
        ]
    }
    """
    normalized = service._normalize_response_json(raw_json)
    
    # Index 0 has file_path, should be repaired with default line numbers (1, 1)
    # Index 1 is missing file_path, should be dropped
    # Index 2 has invalid line format, should fall back to (1, 1)
    assert len(normalized["citations"]) == 2
    assert normalized["citations"][0]["file_path"] == "main.py"
    assert normalized["citations"][0]["start_line"] == 1
    assert normalized["citations"][1]["file_path"] == "utils.py"
    assert normalized["citations"][1]["start_line"] == 1
    
    ChatResponse.model_validate(normalized)

def test_normalize_malformed_code_snippet_objects():
    """Verify malformed code snippets are dropped (missing code_content or file_path) or repaired (missing lines range)."""
    service = GeminiService()
    raw_json = """
    {
        "short_answer": "Valid answer",
        "code_snippets": [
            {"file_path": "main.py", "code_content": "print()"},
            {"code_content": "missing_file_path()"},
            {"file_path": "utils.py", "lines": null, "code_content": "def run(): pass"}
        ]
    }
    """
    normalized = service._normalize_response_json(raw_json)
    
    # Index 0 should be repaired with lines="1-1"
    # Index 1 should be dropped
    # Index 2 should have lines="1-1"
    assert len(normalized["code_snippets"]) == 2
    assert normalized["code_snippets"][0]["file_path"] == "main.py"
    assert normalized["code_snippets"][0]["lines"] == "1-1"
    assert normalized["code_snippets"][1]["file_path"] == "utils.py"
    assert normalized["code_snippets"][1]["lines"] == "1-1"
    
    ChatResponse.model_validate(normalized)

def test_normalize_invalid_unparseable_json():
    """Verify that completely invalid or unparseable JSON raises GeminiServiceError and does not pass silently."""
    service = GeminiService()
    raw_json = '{"short_answer": "broken json string' # Missing quote and bracket
    
    with pytest.raises(GeminiServiceError) as exc_info:
        service._normalize_response_json(raw_json)
        
    assert "invalid JSON" in str(exc_info.value)
