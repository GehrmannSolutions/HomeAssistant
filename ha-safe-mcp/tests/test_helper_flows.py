"""Helpers: storage collections (counter, timer, button, schedule) and config-flow helpers (template, group, ...)."""
import json

import httpx
import respx

from ha_safe_mcp.changes import ChangeJournal, Changes
from ha_safe_mcp.integrations import HAIntegrations
from ha_safe_mcp.management import HELPERS, HAAdmin
from ha_safe_mcp.server import HAClient, create_server

URL = "http://ha:8123"
FLOW = "01JABCDEFGHJKMNPQRSTVWXYZ0"
ENTRY = "01JENTRY0000000000000000AA"


class FakeWS:
    def __init__(self):
        self.calls, self.items = [], {}

    async def command(self, kind, payload=None, **_):
        self.calls.append((kind, payload))
        domain, action = kind.split("/", 1)
        items = self.items.setdefault(domain, [])
        if action == "create":
            item = {"id": payload["name"].lower(), **payload}
            items.append(item)
            return dict(item)
        if action == "list":
            return [dict(i) for i in items]
        raise AssertionError(kind)


def parse(result):
    if isinstance(result, tuple):
        result = result[1] or result[0]
    if isinstance(result, dict):
        return result.get("result", result)
    return json.loads(result[0].text)


def test_storage_helpers_include_counter_timer_button_and_schedule():
    assert {"counter", "timer", "input_button", "schedule"} <= HELPERS


async def test_counter_and_schedule_helpers_are_created_through_their_collections():
    ws = FakeWS()
    admin = HAAdmin(HAClient(URL, "t", allow_write=True), ws, allow_admin_write=True)
    created = await admin.helper_create("counter", {"name": "Kaffee", "step": 1, "maximum": 10})
    assert created["id"] == "kaffee" and ws.calls[0] == ("counter/create", {"name": "Kaffee", "step": 1, "maximum": 10})
    week = {"name": "Arbeit", "monday": [{"from": "07:00:00", "to": "16:00:00"}]}
    assert (await admin.helper_create("schedule", week))["monday"] == week["monday"]


async def test_helper_types_list_storage_and_config_flow_helpers_with_existing_entries():
    integrations = HAIntegrations(HAClient(URL, "t"), ws=None)
    with respx.mock(base_url=URL) as router:
        router.get("/api/config/config_entries/flow_handlers", params={"type": "helper"}).mock(
            return_value=httpx.Response(200, json=["template", "group", "derivative"]))
        router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=[
            {"entry_id": ENTRY, "domain": "template", "title": "Kaffee", "state": "loaded"},
            {"entry_id": "X" * 26, "domain": "shelly", "title": "Plug", "state": "loaded"}]))
        result = await integrations.list_helper_types()
    assert result["config_flow"] == ["derivative", "group", "template"]
    assert {"counter", "input_boolean", "schedule"} <= set(result["storage"])
    assert result["existing_config_flow_helpers"] == [{"entry_id": ENTRY, "domain": "template", "title": "Kaffee",
                                                       "state": "loaded"}]
    assert "next_step_id" in result["how_to"]


async def test_a_flow_that_creates_an_entry_is_journaled(tmp_path):
    journal = ChangeJournal(tmp_path / "changes")
    server = create_server(HAClient(URL, "t", allow_write=True), allow_admin_write=True, allow_delete=True,
                           journal=journal)
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json={
            "type": "create_entry", "flow_id": FLOW, "handler": "template", "title": "Kaffee",
            "result": {"entry_id": ENTRY, "domain": "template", "title": "Kaffee", "state": "loaded"}}))
        result = parse(await server.call_tool("ha_integration_setup_step",
                                              {"flow_id": FLOW, "data": {"name": "Kaffee", "state": "{{ 1 }}"}}))
    entry = journal.get(result["change_id"])
    assert (entry["kind"], entry["target"], entry["before"]) == ("integration", ENTRY, None)
    assert entry["tool"] == "ha_integration_setup_step"


async def test_a_menu_step_is_passed_through_and_not_journaled(tmp_path):
    journal = ChangeJournal(tmp_path / "changes")
    server = create_server(HAClient(URL, "t", allow_write=True), allow_admin_write=True, journal=journal)
    with respx.mock(base_url=URL) as router:
        route = router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json={
            "type": "form", "flow_id": FLOW, "handler": "template", "step_id": "sensor", "data_schema": []}))
        result = parse(await server.call_tool("ha_integration_setup_step",
                                              {"flow_id": FLOW, "data": {"next_step_id": "sensor"}}))
    assert json.loads(route.calls[0].request.content) == {"next_step_id": "sensor"}
    assert result["step_id"] == "sensor" and "change_id" not in result and journal.entries() == []


async def test_undo_of_a_created_entry_deletes_it(tmp_path):
    class FakeIntegrations:
        def __init__(self):
            self.deleted = []

        async def entry_view(self, entry_id):
            return {"entry_id": entry_id, "title": "Kaffee", "disabled_by": None}

        async def delete_entry(self, entry_id):
            self.deleted.append(entry_id)
            return {"require_restart": False}

    fake = FakeIntegrations()
    changes = Changes(ChangeJournal(tmp_path / "changes"), admin=None, scenes=None, registry=None, integrations=fake)
    change_id = changes.record_created("integration", ENTRY, "ha_integration_setup_step")
    result = await changes.undo(change_id)
    assert fake.deleted == [ENTRY] and result["target"] == ENTRY


def test_helper_tools_are_offered_for_helper_questions():
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names
    available = {"ha_list_helper_types", "ha_list_helpers", "ha_create_helper", "ha_start_integration_setup",
                 "ha_integration_setup_step"}
    assert "ha_list_helper_types" in READ_TOOLS
    picked = select_tool_names("Leg mir einen Template-Sensor an", available, allow_write=True)
    assert {"ha_list_helper_types", "ha_start_integration_setup", "ha_integration_setup_step"} <= picked
    assert "ha_create_helper" in select_tool_names("Ich brauche einen Zähler für Kaffee", available, allow_write=True)
