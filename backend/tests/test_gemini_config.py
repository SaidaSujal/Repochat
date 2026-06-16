import pytest
from pydantic import ValidationError
from backend.config import Settings
from backend.services.gemini import GeminiService


def test_gemini_models_default_behavior():
    # Verify default configuration values match production defaults
    settings_obj = Settings()
    assert settings_obj.GEMINI_EMBEDDING_MODEL == "models/gemini-embedding-001"
    assert settings_obj.GEMINI_EMBEDDING_FALLBACK_MODEL == "models/gemini-embedding-2"
    assert settings_obj.GEMINI_GENERATION_MODEL == "gemini-3.5-flash"
    assert settings_obj.GEMINI_GENERATION_FALLBACK_MODEL == "gemini-2.5-flash"

    # Verify GeminiService picks up defaults
    service = GeminiService()
    assert service.embedding_model == "models/gemini-embedding-001"
    assert service.embedding_fallback_model == "models/gemini-embedding-2"
    assert service.generation_model == "gemini-3.5-flash"
    assert service.generation_fallback_model == "gemini-2.5-flash"


def test_gemini_models_environment_override(monkeypatch):
    # Set environment variables overrides
    monkeypatch.setenv("GEMINI_EMBEDDING_MODEL", "custom-embedding-model")
    monkeypatch.setenv("GEMINI_EMBEDDING_FALLBACK_MODEL", "custom-embedding-fallback")
    monkeypatch.setenv("GEMINI_GENERATION_MODEL", "custom-generation-model")
    monkeypatch.setenv("GEMINI_GENERATION_FALLBACK_MODEL", "custom-generation-fallback")

    # Create new Settings object to load environment variables
    custom_settings = Settings()
    assert custom_settings.GEMINI_EMBEDDING_MODEL == "custom-embedding-model"
    assert custom_settings.GEMINI_EMBEDDING_FALLBACK_MODEL == "custom-embedding-fallback"
    assert custom_settings.GEMINI_GENERATION_MODEL == "custom-generation-model"
    assert custom_settings.GEMINI_GENERATION_FALLBACK_MODEL == "custom-generation-fallback"

    # Verify GeminiService uses overridden settings
    # Temporarily monkeypatch global settings inside gemini.py to point to custom settings
    import backend.services.gemini as gemini_module
    monkeypatch.setattr(gemini_module, "settings", custom_settings)

    service = GeminiService()
    assert service.embedding_model == "custom-embedding-model"
    assert service.embedding_fallback_model == "custom-embedding-fallback"
    assert service.generation_model == "custom-generation-model"
    assert service.generation_fallback_model == "custom-generation-fallback"


@pytest.mark.parametrize(
    "model_field",
    [
        "GEMINI_EMBEDDING_MODEL",
        "GEMINI_EMBEDDING_FALLBACK_MODEL",
        "GEMINI_GENERATION_MODEL",
        "GEMINI_GENERATION_FALLBACK_MODEL",
    ]
)
def test_gemini_models_invalid_configuration(monkeypatch, model_field):
    # Verify that setting empty name, whitespace or None raises ValidationError
    for invalid_val in ("", "   ", None):
        if invalid_val is None:
            # Pydantic Settings expect a string. Setting None triggers validation error.
            # We bypass monkeypatch.setenv since env vars are strings, and instantiate with dict
            with pytest.raises(ValidationError) as exc:
                Settings(**{model_field: None})
            assert "Input should be a valid string" in str(exc.value)
        else:
            monkeypatch.setenv(model_field, invalid_val)
            with pytest.raises(ValidationError) as exc:
                Settings()
            assert "Model name cannot be empty" in str(exc.value)
            monkeypatch.delenv(model_field, raising=False)


def test_gemini_timeout_and_retries_defaults():
    settings_obj = Settings()
    assert settings_obj.GEMINI_TIMEOUT_SEC == 30.0
    assert settings_obj.GEMINI_MAX_RETRIES == 4

    service = GeminiService()
    assert service.timeout == 30.0
    assert service.max_retries == 4


def test_gemini_timeout_and_retries_override(monkeypatch):
    monkeypatch.setenv("GEMINI_TIMEOUT_SEC", "15.5")
    monkeypatch.setenv("GEMINI_MAX_RETRIES", "6")

    custom_settings = Settings()
    assert custom_settings.GEMINI_TIMEOUT_SEC == 15.5
    assert custom_settings.GEMINI_MAX_RETRIES == 6

    # Verify GeminiService uses overridden settings
    import backend.services.gemini as gemini_module
    monkeypatch.setattr(gemini_module, "settings", custom_settings)

    service = GeminiService()
    assert service.timeout == 15.5
    assert service.max_retries == 6


def test_gemini_timeout_and_retries_invalid():
    # Negative/Zero timeout raises ValidationError
    with pytest.raises(ValidationError) as exc:
        Settings(GEMINI_TIMEOUT_SEC=0)
    assert "timeout must be a positive number" in str(exc.value)

    with pytest.raises(ValidationError) as exc:
        Settings(GEMINI_TIMEOUT_SEC=-1.5)
    assert "timeout must be a positive number" in str(exc.value)

    # Negative retries raises ValidationError
    with pytest.raises(ValidationError) as exc:
        Settings(GEMINI_MAX_RETRIES=-1)
    assert "Max retries value must be a non-negative integer" in str(exc.value)


def test_gemini_retry_caps_backoff(monkeypatch):
    import time
    sleep_calls = []
    monkeypatch.setattr(time, "sleep", lambda secs: sleep_calls.append(secs))

    service = GeminiService()
    service.max_retries = 3

    # Force a very large delay (e.g. 100 seconds) in the rate limit message
    attempts = 0
    def mock_function_large_delay():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise Exception("429 ResourceExhausted: Quota exceeded. Please retry in seconds: 100.")
        return "success"

    result = service._call_with_retry(mock_function_large_delay)
    assert result == "success"
    assert attempts == 3
    # Check that both sleeps were capped at 30.0s instead of being 101.0s
    assert len(sleep_calls) == 2
    assert sleep_calls[0] == 30.0
    assert sleep_calls[1] == 30.0


def test_credentials_sanitization(monkeypatch):
    # Set environment variables with leading/trailing spaces and newlines/carriage returns
    monkeypatch.setenv("GEMINI_API_KEY", "  \nAIzaSyMyKey\r\n  ")
    monkeypatch.setenv("GITHUB_TOKEN", " \rgithub_pat_123token\n ")
    
    # Create new Settings object to load environment variables
    custom_settings = Settings()
    
    # Verify that the keys are properly stripped of whitespace/newlines
    assert custom_settings.GEMINI_API_KEY == "AIzaSyMyKey"
    assert custom_settings.GITHUB_TOKEN == "github_pat_123token"


