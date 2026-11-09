import pytest

from collector import redact


@pytest.fixture(autouse=True)
def _isolated_redaction(monkeypatch):
    """Each test starts without registered values, record factory, excepthook or wrapped
    streams, and outside GitHub Actions (the same behaviour locally and in CI)."""
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    redact.reset()
    yield
    redact.uninstall()
    redact.reset()
