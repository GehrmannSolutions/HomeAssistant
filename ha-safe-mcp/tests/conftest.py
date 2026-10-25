"""Keep every test away from the real per-user state directories."""
import pytest


@pytest.fixture(autouse=True)
def _private_state(tmp_path_factory, monkeypatch):
    base = tmp_path_factory.mktemp("state")
    monkeypatch.setenv("HA_CHANGES_DIR", str(base / "changes"))
    monkeypatch.setenv("XDG_STATE_HOME", str(base / "xdg"))


@pytest.fixture
def german():
    """Messages in German, as the web UI sends X-UI-Language: de (English is the default)."""
    from ha_safe_mcp.i18n import ui_language
    token = ui_language.set("de")
    yield
    ui_language.reset(token)
