"""Keep every test away from the real per-user state directories."""
import pytest


@pytest.fixture(autouse=True)
def _private_state(tmp_path_factory, monkeypatch):
    base = tmp_path_factory.mktemp("state")
    monkeypatch.setenv("HA_CHANGES_DIR", str(base / "changes"))
    monkeypatch.setenv("XDG_STATE_HOME", str(base / "xdg"))
