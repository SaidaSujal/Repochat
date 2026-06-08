import pytest
from backend.schemas import HistoryMessage
from backend.utils.history_normalization import normalize_history

def test_normalize_history_corrupted_arrays():
    # 1. Non-list inputs
    assert normalize_history(None) == []
    assert normalize_history("corrupted_string") == []
    assert normalize_history(42) == []
    assert normalize_history({"role": "user", "content": "hello"}) == []

    # 2. List with non-dict/non-object elements
    raw_history = [
        "not_a_dict",
        123,
        None,
        {"role": "user", "content": "valid message"},
        []
    ]
    res = normalize_history(raw_history)
    assert len(res) == 1
    assert res[0].role == "user"
    assert res[0].content == "valid message"

def test_normalize_history_invalid_roles():
    raw_history = [
        {"role": "system", "content": "I am a system message"},
        {"role": "admin", "content": "privileged"},
        {"role": "user", "content": "valid user"},
        {"role": "assistant", "content": "valid assistant"},
        {"role": "", "content": "empty role"},
        {"role": "hacker", "content": "malicious"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 2
    assert res[0].role == "user"
    assert res[1].role == "assistant"

def test_normalize_history_missing_fields():
    raw_history = [
        {"content": "missing role"},
        {"role": "user"},
        {"role": "user", "content": None},
        {"role": None, "content": "hello"},
        {"role": "user", "content": "valid message"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 1
    assert res[0].content == "valid message"

def test_normalize_history_empty_content():
    raw_history = [
        {"role": "user", "content": ""},
        {"role": "assistant", "content": "    "},
        {"role": "user", "content": "\n\t\r"},
        {"role": "user", "content": "valid non-empty"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 1
    assert res[0].content == "valid non-empty"

def test_normalize_history_oversized_histories():
    # Enforce limit of 6 messages
    raw_history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"}
        for i in range(10)
    ]
    res = normalize_history(raw_history)
    assert len(res) == 6
    # Should keep the last 6 messages (index 4 to 9)
    assert res[0].content == "msg 4"
    assert res[5].content == "msg 9"

def test_normalize_history_trimming_behavior():
    long_content = "a" * 1500
    raw_history = [
        {"role": "user", "content": long_content},
        {"role": "assistant", "content": "short message"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 2
    assert len(res[0].content) == 1000
    assert res[0].content == "a" * 1000
    assert res[1].content == "short message"

def test_normalize_history_pydantic_model_compatibility():
    model1 = HistoryMessage(role="user", content="hello model")
    model2 = HistoryMessage(role="assistant", content="hi model")
    res = normalize_history([model1, model2])
    assert len(res) == 2
    assert res[0].role == "user"
    assert res[0].content == "hello model"
    assert res[1].role == "assistant"
    assert res[1].content == "hi model"

def test_normalize_history_stress_large_payloads():
    # Histories containing hundreds of entries (e.g. 500 entries)
    # Mixture of valid and invalid messages
    raw_history = []
    for i in range(500):
        if i % 10 == 0:
            # Valid user message
            raw_history.append({"role": "user", "content": f"valid user message {i}"})
        elif i % 10 == 5:
            # Valid assistant message
            raw_history.append({"role": "assistant", "content": f"valid assistant message {i}"})
        elif i % 10 == 1:
            # Invalid role
            raw_history.append({"role": "system", "content": "system message"})
        elif i % 10 == 2:
            # Invalid/non-string content value
            raw_history.append({"role": "user", "content": 12345})
        elif i % 10 == 3:
            # Nested object content
            raw_history.append({"role": "user", "content": {"text": "hello"}})
        elif i % 10 == 4:
            # Empty content
            raw_history.append({"role": "user", "content": "   "})
        elif i % 10 == 6:
            # Duplicate malformed entries
            raw_history.append({"role": "bad_role", "content": "bad"})
            raw_history.append({"role": "bad_role", "content": "bad"})
        elif i % 10 == 7:
            # Array inside array
            raw_history.append([{"role": "user", "content": "nested raw list"}])
        elif i % 10 == 8:
            # Non-string role value
            raw_history.append({"role": True, "content": "bool role"})
        else:
            # Null/None values
            raw_history.append(None)
            
    res = normalize_history(raw_history)
    # Verify final output never exceeds 6 messages
    assert len(res) <= 6
    # Verify only valid user/assistant messages survive
    for msg in res:
        assert msg.role in ("user", "assistant")
        assert isinstance(msg.content, str)
        assert len(msg.content) <= 1000
        assert msg.content.strip() != ""

def test_normalize_history_exotic_structures():
    # Nested objects and arrays inside arrays
    raw_history = [
        {"role": "user", "content": "valid message"},
        [{"role": "user", "content": "nested array item"}],
        {"role": "assistant", "content": {"nested_dict": "as_content"}},
        {"role": {"nested_role": "user"}, "content": "nested role"},
        "plain string instead of dict",
        12345,
        {"role": "user", "content": "another valid message"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 2
    assert res[0].content == "valid message"
    assert res[1].content == "another valid message"

def test_normalize_history_non_string_types():
    # Test non-string roles and content
    raw_history = [
        {"role": 123, "content": "valid content"},
        {"role": "user", "content": 456},
        {"role": 1.23, "content": 4.56},
        {"role": True, "content": False},
        {"role": None, "content": None},
        {"role": "assistant", "content": "valid assistant message"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 1
    assert res[0].role == "assistant"
    assert res[0].content == "valid assistant message"

def test_normalize_history_extremely_long_content():
    # Extremely long histories and extremely long contents
    long_content = "a" * 100000 # 100k characters
    raw_history = [
        {"role": "user", "content": long_content},
        {"role": "assistant", "content": "short response"}
    ]
    res = normalize_history(raw_history)
    assert len(res) == 2
    assert len(res[0].content) == 1000
    assert res[0].content == "a" * 1000
    assert res[1].content == "short response"

def test_normalize_history_determinism():
    # Verify normalization remains deterministic
    raw_history = [
        {"role": "user", "content": "hello"},
        {"role": "system", "content": "dropped"},
        {"role": "assistant", "content": "hi"},
        None,
        {"role": "user", "content": "a" * 1200},
        [{"role": "user"}],
        {"role": "assistant", "content": "trimmed"}
    ]
    res1 = normalize_history(raw_history)
    res2 = normalize_history(raw_history)
    assert len(res1) == len(res2)
    for m1, m2 in zip(res1, res2):
        assert m1.role == m2.role
        assert m1.content == m2.content

def test_normalize_history_throwing_properties():
    # Objects that raise exceptions during attribute access or dict conversions
    class ThrowingRole:
        @property
        def role(self):
            raise RuntimeError("Dynamic role error")
        @property
        def content(self):
            return "some content"

    class ThrowingContent:
        @property
        def role(self):
            return "user"
        @property
        def content(self):
            raise ValueError("Dynamic content error")

    class ThrowingDict:
        def dict(self):
            raise NotImplementedError("Dynamic dict error")

    class ThrowingModelDump:
        def model_dump(self):
            raise TypeError("Dynamic model dump error")

    raw_history = [
        ThrowingRole(),
        ThrowingContent(),
        ThrowingDict(),
        ThrowingModelDump(),
        {"role": "user", "content": "valid message"}
    ]
    
    # Verify no exceptions are raised during normalization
    res = normalize_history(raw_history)
    assert len(res) == 1
    assert res[0].role == "user"
    assert res[0].content == "valid message"
