import pytest
from pydantic import ValidationError
from backend.config import Settings
from backend.services.github import GitHubService
import subprocess


def test_git_timeouts_default_behavior():
    # Verify default configuration values match production defaults
    settings_obj = Settings()
    assert settings_obj.GIT_CLONE_TIMEOUT_SEC == 60.0
    assert settings_obj.GIT_COMMAND_TIMEOUT_SEC == 10.0


def test_git_timeouts_environment_override(monkeypatch):
    # Set environment variables overrides
    monkeypatch.setenv("GIT_CLONE_TIMEOUT_SEC", "120.5")
    monkeypatch.setenv("GIT_COMMAND_TIMEOUT_SEC", "30.0")

    # Create new Settings object to load environment variables
    custom_settings = Settings()
    assert custom_settings.GIT_CLONE_TIMEOUT_SEC == 120.5
    assert custom_settings.GIT_COMMAND_TIMEOUT_SEC == 30.0

    # Inject settings override into github service module
    import backend.services.github as github_module
    monkeypatch.setattr(github_module, "settings", custom_settings)

    # We mock subprocess.run to raise TimeoutExpired to verify the timeout value passed in clone_repository
    def mock_run_clone(*args, **kwargs):
        # We assert the timeout passed matches the override settings
        assert kwargs.get("timeout") == 120.5
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout"))

    monkeypatch.setattr(subprocess, "run", mock_run_clone)

    with pytest.raises(Exception) as exc:
        GitHubService.clone_repository("https://github.com/owner/repo", "/dummy/path")
    assert "timed out after 120.5 seconds" in str(exc.value)

    # Inject mock for get_commit_sha
    def mock_run_cmd(*args, **kwargs):
        assert kwargs.get("timeout") == 30.0
        raise subprocess.TimeoutExpired(cmd=args[0], timeout=kwargs.get("timeout"))

    monkeypatch.setattr(subprocess, "run", mock_run_cmd)
    with pytest.raises(Exception) as exc:
        GitHubService.get_commit_sha("/dummy/path")
    assert "timed out" in str(exc.value)


@pytest.mark.parametrize(
    "timeout_field",
    [
        "GIT_CLONE_TIMEOUT_SEC",
        "GIT_COMMAND_TIMEOUT_SEC",
    ]
)
def test_git_timeouts_invalid_configuration(monkeypatch, timeout_field):
    # Verify that setting negative values or zero raises ValidationError
    for invalid_val in ("-10", "0", "-0.5", "invalid-str"):
        monkeypatch.setenv(timeout_field, invalid_val)
        with pytest.raises(ValidationError) as exc:
            Settings()
        # Verify it raises value error
        assert "validation error" in str(exc.value).lower()
        monkeypatch.delenv(timeout_field, raising=False)
