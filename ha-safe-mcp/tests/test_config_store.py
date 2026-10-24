"""Settings persistence for the web UI: validation, token handling, atomic 0600 writes."""
import stat

import pytest

from ha_safe_mcp.config_store import Settings, SettingsStore, SetupError, merge_settings, resolve_token

TOKEN = "eyJhbGciOiJIUzI1NiJ9.test-token-value.signature_part"


def payload(**overrides):
    base = {"ha_url": "http://127.0.0.1:8123", "token": TOKEN, "ollama_url": "http://127.0.0.1:11434",
            "ollama_model": "qwen2.5-coder:7b", "allow_write": False, "allow_admin_write": False,
            "allow_delete": False, "allowed_domains": ["light", "switch"]}
    base.update(overrides)
    return base


def test_missing_file_gives_unconfigured_defaults(tmp_path):
    settings = SettingsStore(tmp_path / ".env").load()
    assert not settings.configured
    assert settings.ha_url == "http://127.0.0.1:8123"
    assert settings.allow_write is False and settings.allow_delete is False


def test_example_placeholder_token_counts_as_unset(tmp_path):
    env = tmp_path / ".env"
    env.write_text("HA_TOKEN=YOUR_HOME_ASSISTANT_LONG_LIVED_ACCESS_TOKEN\n")
    assert not SettingsStore(env).load().configured


def test_public_view_never_contains_the_token(tmp_path):
    settings = merge_settings(Settings(), payload())
    public = settings.public()
    assert public["token_set"] is True
    assert TOKEN not in repr(public) and TOKEN not in repr(settings)


def test_save_writes_mode_0600_and_keeps_unrelated_lines(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# eigene Notiz\nHA_URL=http://old:8123\nCUSTOM_FLAG=1\nHA_URL=http://dupe:8123\n")
    env.chmod(0o644)
    store = SettingsStore(env)
    saved = store.save(merge_settings(Settings(), payload()))
    text = env.read_text()
    assert stat.S_IMODE(env.stat().st_mode) == 0o600
    assert "# eigene Notiz" in text and "CUSTOM_FLAG=1" in text
    assert text.count("HA_URL=") == 1 and "HA_URL=http://127.0.0.1:8123" in text
    assert saved.configured and saved.allowed_domains == ("light", "switch")
    assert not list(tmp_path.glob(".env.*.tmp"))


def test_blank_token_keeps_stored_token_for_same_url():
    current = merge_settings(Settings(), payload())
    updated = merge_settings(current, payload(token="", allow_write=True))
    assert updated.ha_token == TOKEN and updated.allow_write


def test_changed_url_requires_token_again():
    current = merge_settings(Settings(), payload())
    with pytest.raises(SetupError, match="erneut"):
        merge_settings(current, payload(ha_url="http://192.168.1.20:8123", token=""))
    with pytest.raises(SetupError, match="erneut"):
        resolve_token(current, "http://192.168.1.20:8123", "")


def test_stored_token_resolves_only_for_the_stored_url():
    current = merge_settings(Settings(), payload())
    assert resolve_token(current, "http://127.0.0.1:8123/", "") == TOKEN


@pytest.mark.parametrize("changes, message", [
    ({"ha_url": "ftp://ha:21"}, "Adresse"),
    ({"ha_url": "http://user:pw@ha:8123"}, "Adresse"),
    ({"ha_url": "http://ha:8123/api"}, "Adresse"),
    ({"token": "short"}, "Token"),
    ({"token": TOKEN + "\nHA_ALLOW_DELETE=true"}, "Token"),
    ({"ollama_model": "bad model;rm"}, "Modell"),
    ({"allowed_domains": ["light", "Lock!"]}, "Domain"),
    ({"allow_write": "true"}, "Schalter"),
    ({"allow_admin_write": True}, "Steuern"),
    ({"allow_write": True, "allow_delete": True}, "Konfiguration"),
])
def test_invalid_input_is_rejected_with_safe_german_message(changes, message):
    with pytest.raises(SetupError, match=message) as error:
        merge_settings(Settings(), payload(**changes))
    assert TOKEN not in str(error.value)


def test_mcp_env_carries_exactly_the_server_settings():
    settings = merge_settings(Settings(), payload(allow_write=True))
    env = settings.mcp_env()
    assert env == {"HA_URL": "http://127.0.0.1:8123", "HA_TOKEN": TOKEN, "HA_ALLOW_WRITE": "true",
                   "HA_ALLOW_ADMIN_WRITE": "false", "HA_ALLOW_DELETE": "false",
                   "HA_ALLOWED_DOMAINS": "light,switch"}
