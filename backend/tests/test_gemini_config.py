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
