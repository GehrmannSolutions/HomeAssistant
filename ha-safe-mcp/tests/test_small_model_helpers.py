"""Small-model helpers: a plain automation list and a clear error for argument names a tool does not have."""
import json

import httpx
import pytest
import respx
from mcp.server.fastmcp.exceptions import ToolError

from ha_safe_mcp.server import HAClient, create_server

URL = "http://ha:8123"
STATES = [{"entity_id": "automation.licht_abends", "state": "on",
           "attributes": {"friendly_name": "Licht abends", "id": "1700000000001",
                          "last_triggered": "2026-11-24T05:30:00+00:00", "mode": "single"}},
          {"entity_id": "automation.alarm", "state": "off",
           "attributes": {"friendly_name": "Alarm", "id": "a2", "last_triggered": None}},
          {"entity_id": "light.flur", "state": "on", "attributes": {"friendly_name": "Flur"}}]


def parse(raw):
    return raw[1].get("result", raw[1]) if isinstance(raw, tuple) and isinstance(raw[1], dict) \
        else json.loads(raw[0].text)


async def test_list_automations_names_state_id_and_last_run_in_local_time():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        router.get("/api/config").mock(return_value=httpx.Response(200, json={"time_zone": "Europe/Berlin"}))
        result = parse(await create_server(HAClient(URL, "t")).call_tool("ha_list_automations", {}))
    assert result["automations"] == [
        {"entity_id": "automation.alarm", "name": "Alarm", "config_id": "a2", "enabled": False,
         "last_triggered": None},
        {"entity_id": "automation.licht_abends", "name": "Licht abends", "config_id": "1700000000001",
         "enabled": True, "last_triggered": "2026-11-24T06:30:00+01:00"}]
    assert result["count"] == 2 and "ha_get_automation" in result["hint"]


async def test_list_automations_filters_by_words_and_says_when_nothing_matches():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        router.get("/api/config").mock(return_value=httpx.Response(200, json={"time_zone": "Europe/Berlin"}))
        server = create_server(HAClient(URL, "t"))
        found = parse(await server.call_tool("ha_list_automations", {"query": "licht"}))
        none = parse(await server.call_tool("ha_list_automations", {"query": "garage"}))
    assert [a["name"] for a in found["automations"]] == ["Licht abends"]
    assert none["automations"] == [] and "2 automations" in none["hint"]


async def test_unknown_argument_names_are_refused_with_the_valid_ones():
    server = create_server(HAClient(URL, "t"))
    with pytest.raises(ToolError, match="unknown argument 'dashboard_id'") as error:
        await server.call_tool("ha_get_dashboard", {"dashboard_id": "my-dashboard"})
    assert "valid: url_path" in str(error.value)


def test_list_automations_is_a_read_tool_found_by_plain_questions():
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names, write_level
    assert write_level("ha_list_automations") is None
    for prompt in ("Welche Automationen gibt es?", "Which automations do I have?"):
        assert "ha_list_automations" in select_tool_names(prompt, set(READ_TOOLS), allow_write=False)


@pytest.mark.parametrize("prompt, expected", [
    ("Schick mir eine Testnachricht aufs Handy", {"ha_send_notification", "ha_list_notification_targets"}),
    ("Send a test notification to my phone", {"ha_send_notification", "ha_list_notification_targets"}),
    ("Benenne das Gerät Kaffeemaschine in Espresso um", {"ha_rename_device", "ha_list_devices"}),
    ("Rename the device Coffee machine to Espresso", {"ha_rename_device", "ha_list_devices"}),
    ("Lege einen Benutzer für das Wandtablet an", {"ha_create_user", "ha_list_users", "ha_list_credentials"}),
    ("Which users can log in?", {"ha_list_users"}),
    ("Deaktiviere den Benutzer Gast", {"ha_update_user", "ha_list_users"}),
    ("Kopple das neue Matter-Thermostat", {"ha_matter_commission", "ha_get_matter_info", "ha_list_credentials"}),
    ("Pair my new Matter plug", {"ha_matter_commission", "ha_get_matter_info"}),
])
def test_everyday_requests_offer_the_new_tools(prompt, expected):
    from ha_safe_mcp.ollama_client import READ_TOOLS, WRITE_TOOLS, select_tool_names
    assert expected <= select_tool_names(prompt, set(READ_TOOLS | WRITE_TOOLS), allow_write=True)


@pytest.mark.parametrize("tool, args", [
    ("ha_matter_commission", {"code": "34970112332"}),
    ("ha_create_user", {"name": "Tablet", "username": "tablet", "password": "geheim123"}),
])
async def test_a_secret_typed_as_text_gets_the_credential_hint_not_a_type_error(tool, args):
    server = create_server(HAClient(URL, "t", allow_write=True), allow_admin_write=True)
    with pytest.raises(ToolError) as error:
        await server.call_tool(tool, args)
    assert "credential reference" in str(error.value) and "geheim123" not in str(error.value)
    assert "valid dictionary" not in str(error.value)
