"""English is the default UI language; German on request (X-UI-Language: de)."""
import pytest

from ha_safe_mcp.chat_runs import friendly_error
from ha_safe_mcp.config_store import Settings, SetupError, merge_settings
from ha_safe_mcp.domains import summarize
from ha_safe_mcp.i18n import L, pick, ui_language
from ha_safe_mcp.ollama_client import language_hint, no_tool_answer
from test_web import HEADERS, TOKEN, client, make_app

ENGLISH = {key: value for key, value in HEADERS.items() if key != "X-UI-Language"}


def test_english_is_the_default_and_only_known_languages_are_picked():
    assert L("Save", "Speichern") == "Save"
    assert pick("de") == "de" and pick("fr") == "en" and pick(None) == "en"
    token = ui_language.set("de")
    try:
        assert L("Save", "Speichern") == "Speichern"
    finally:
        ui_language.reset(token)


def test_messages_default_to_english():
    with pytest.raises(SetupError, match="address must be a plain http"):
        merge_settings(Settings(), {"ha_url": "ftp://x", "token": TOKEN})
    assert "not approved" in friendly_error(PermissionError("x"))
    assert "Answer in English" in language_hint() and "tool" in no_tool_answer()
    light = next(i for i in summarize([{"entity_id": "light.a"}], [{"domain": "light"}], []) if i["domain"] == "light")
    assert light["label"] == "Lights"


@pytest.mark.usefixtures("german")
def test_the_german_versions_exist():
    assert "Answer in German" in language_hint()  # instruction stays English
    light = next(i for i in summarize([{"entity_id": "light.a"}], [{"domain": "light"}], []) if i["domain"] == "light")
    assert light["label"] == "Licht"


async def test_the_web_ui_answers_in_the_language_of_the_header(tmp_path):
    app, _, _ = make_app(tmp_path)
    body = {"ha_url": "ftp://x", "token": TOKEN}
    async with client(app) as http:
        english = await http.post("/api/setup", headers=ENGLISH, json=body)
        german = await http.post("/api/setup", headers={**ENGLISH, "X-UI-Language": "de"}, json=body)
        unknown = await http.post("/api/setup", headers={**ENGLISH, "X-UI-Language": "xx"}, json=body)
    assert "address" in english.json()["error"] and "Adresse" in german.json()["error"]
    assert unknown.json()["error"] == english.json()["error"]
