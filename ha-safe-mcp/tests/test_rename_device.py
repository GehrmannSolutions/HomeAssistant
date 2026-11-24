"""Rename a device in one step: device name, its entity IDs and names, and the references in automations, scripts,
scenes and dashboards - each step journaled."""
import copy
import json

import httpx
import pytest
import respx

from ha_safe_mcp.changes import ChangeJournal
from ha_safe_mcp.management import HAWebSocket
from ha_safe_mcp.rename import replace_ids
from ha_safe_mcp.server import HAClient, create_server

URL = "http://ha:8123"
DEVICE = "0123456789abcdef0123456789abcdef"
AUTOMATION = {"id": "123", "alias": "Kaffee aus", "triggers": [{"trigger": "template", "value_template":
              "{{ states('sensor.kaffeemaschine_power') | float > 5 and states.switch.kaffeemaschine.state == 'on' }}"}],
              "actions": [{"action": "switch.turn_off", "target": {"entity_id": "switch.kaffeemaschine"}},
                          {"action": "notify.notify", "data": {"message": "sensor.kaffeemaschine_power_total bleibt"}}]}
DASHBOARD = {"views": [{"cards": [{"type": "entities", "entities": ["switch.kaffeemaschine",
                                                                    "sensor.shelly_plug_s_temperature"]}]}]}


def test_replace_ids_changes_whole_ids_in_strings_and_keys_only():
    mapping = {"switch.kaffeemaschine": "switch.espresso", "sensor.kaffeemaschine_power": "sensor.espresso_power"}
    value = {"a": "{{ states.switch.kaffeemaschine.state }}", "switch.kaffeemaschine": {"state": "on"},
             "b": ["sensor.kaffeemaschine_power", "sensor.kaffeemaschine_power_total", "myswitch.kaffeemaschine"]}
    new, count = replace_ids(value, mapping)
    assert new == {"a": "{{ states.switch.espresso.state }}", "switch.espresso": {"state": "on"},
                   "b": ["sensor.espresso_power", "sensor.kaffeemaschine_power_total", "myswitch.kaffeemaschine"]}
    assert count == 3


class World:
    def __init__(self):
        self.devices = [{"id": DEVICE, "name": "Shelly Plug S", "name_by_user": "Kaffeemaschine",
                         "manufacturer": "Shelly", "model": "Plug S", "area_id": "kuche", "disabled_by": None,
                         "labels": [], "config_entries": ["e1"]},
                        {"id": "f" * 32, "name": "Kaffeemühle", "name_by_user": None, "config_entries": ["e2"]}]
        self.entities = {e["entity_id"]: e for e in [
            {"entity_id": "switch.kaffeemaschine", "device_id": DEVICE, "name": None, "platform": "shelly"},
            {"entity_id": "sensor.kaffeemaschine_power", "device_id": DEVICE, "name": None, "platform": "shelly"},
            {"entity_id": "sensor.shelly_plug_s_temperature", "device_id": DEVICE, "name": None,
             "platform": "shelly"},
            {"entity_id": "button.kaffeemaschine_reboot", "device_id": DEVICE, "name": "Kaffeemaschine Neustart",
             "platform": "shelly"},
            {"entity_id": "update.firmware_7", "device_id": DEVICE, "name": None, "platform": "shelly"},
            {"entity_id": "sensor.kaffeemaschine_power_total", "device_id": None, "name": None,
             "platform": "template"}]}
        self.dashboard = copy.deepcopy(DASHBOARD)
        self.automation = copy.deepcopy(AUTOMATION)
        self.writes = []

    async def command(self, kind, payload=None, **_):
        payload = dict(payload or {})
        if kind == "config/device_registry/list":
            return copy.deepcopy(self.devices)
        if kind == "config/device_registry/update":
            self.writes.append(kind)
            device = next(d for d in self.devices if d["id"] == payload.pop("device_id"))
            device.update(payload)
            return device
        if kind == "config/entity_registry/list":
            return [dict(e) for e in self.entities.values()]
        if kind == "config/entity_registry/get":
            if payload["entity_id"] not in self.entities:
                raise RuntimeError("Home Assistant WebSocket error: not_found")
            return {**self.entities[payload["entity_id"]], "aliases": []}
        if kind == "config/entity_registry/update":
            self.writes.append(kind)
            entry = self.entities.pop(payload.pop("entity_id"))
            if "new_entity_id" in payload:
                entry["entity_id"] = payload.pop("new_entity_id")
            entry.update(payload)
            self.entities[entry["entity_id"]] = entry
            return {"entity_entry": entry}
        if kind == "lovelace/dashboards/list":
            return []
        if kind == "lovelace/config":
            return copy.deepcopy(self.dashboard)
        if kind == "lovelace/config/save":
            self.writes.append(kind)
            self.dashboard = payload["config"]
            return None
        if kind == "validate_config":
            return {key: {"valid": True, "error": None} for key in payload}
        raise AssertionError(kind)

    def states(self):
        return [{"entity_id": "automation.kaffee_aus", "state": "on", "attributes": {"id": "123",
                                                                                     "friendly_name": "Kaffee aus"}},
                *({"entity_id": e, "state": "on", "attributes": {}} for e in self.entities)]


@pytest.fixture
def world(monkeypatch):
    w = World()

    async def command(self, kind, payload=None, **options):
        return await w.command(kind, payload, **options)

    monkeypatch.setattr(HAWebSocket, "command", command)
    return w


def routes(router, world):
    router.get("/api/states").mock(side_effect=lambda r: httpx.Response(200, json=world.states()))
    router.get("/api/config/automation/config/123").mock(
        side_effect=lambda r: httpx.Response(200, json=world.automation))

    def save(request):
        world.writes.append("automation")
        world.automation = {"id": "123", **json.loads(request.content)}
        return httpx.Response(200, json={"result": "ok"})
    router.post("/api/config/automation/config/123").mock(side_effect=save)


async def call(server, args):
    raw = await server.call_tool("ha_rename_device", args)
    return raw[1] if isinstance(raw, tuple) and isinstance(raw[1], dict) else json.loads(raw[0].text)


def make(tmp_path, write=True):
    journal = ChangeJournal(tmp_path / "changes")
    return create_server(HAClient(URL, "t", allow_write=write), allow_admin_write=write, journal=journal), journal


async def test_dry_run_shows_the_whole_plan_and_writes_nothing(world, tmp_path):
    server, _ = make(tmp_path)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        plan = await call(server, {"device": "kaffeemaschine", "new_name": "Espresso", "dry_run": True})
    assert world.writes == []
    assert plan["device"] == {"device_id": DEVICE, "old_name": "Kaffeemaschine", "new_name": "Espresso"}
    assert plan["entity_ids"] == {"switch.kaffeemaschine": "switch.espresso",
                                  "sensor.kaffeemaschine_power": "sensor.espresso_power",
                                  "sensor.shelly_plug_s_temperature": "sensor.espresso_temperature",
                                  "button.kaffeemaschine_reboot": "button.espresso_reboot"}
    assert plan["kept_entity_ids"] == ["update.firmware_7"]
    assert plan["entity_names"] == {"button.espresso_reboot": "Espresso Neustart"}
    assert {(r["kind"], r["id"]) for r in plan["references"]} == {("automation", "123"), ("dashboard", "default")}
    assert "dry_run=false" in plan["next"]


async def test_rename_runs_every_step_journaled_and_keeps_foreign_ids(world, tmp_path):
    server, journal = make(tmp_path)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        result = await call(server, {"device": DEVICE, "new_name": "Espresso"})
    assert world.devices[0]["name_by_user"] == "Espresso"
    assert set(world.entities) == {"switch.espresso", "sensor.espresso_power", "sensor.espresso_temperature",
                                   "button.espresso_reboot", "update.firmware_7", "sensor.kaffeemaschine_power_total"}
    assert world.entities["button.espresso_reboot"]["name"] == "Espresso Neustart"
    text = json.dumps(world.automation)
    assert "switch.espresso" in text and "states.switch.espresso.state" in text
    assert "sensor.espresso_power'" in text and "sensor.kaffeemaschine_power_total" in text
    assert world.dashboard["views"][0]["cards"][0]["entities"] == ["switch.espresso", "sensor.espresso_temperature"]
    assert result["done"] is True and result["failed"] == []
    assert len(result["change_ids"]) == 1 + 4 + 1 + 2
    assert all(journal.get(c)["tool"] == "ha_rename_device" for c in result["change_ids"])
    assert "newest first" in result["undo"]


async def test_a_taken_new_entity_id_stops_before_any_write(world, tmp_path):
    world.entities["sensor.espresso_power"] = {"entity_id": "sensor.espresso_power", "device_id": "x", "name": None}
    server, _ = make(tmp_path)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        with pytest.raises(Exception, match="sensor.espresso_power already exists"):
            await call(server, {"device": DEVICE, "new_name": "Espresso"})
    assert world.writes == []


async def test_only_the_device_name_when_ids_and_references_stay(world, tmp_path):
    server, _ = make(tmp_path)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        result = await call(server, {"device": DEVICE, "new_name": "Espresso", "rename_entity_ids": False,
                                     "update_references": False})
    assert world.writes == ["config/device_registry/update", "config/entity_registry/update"]  # + the button name
    assert "switch.kaffeemaschine" in world.entities and result["entity_ids"] == {}


async def test_an_ambiguous_or_unknown_device_lists_the_candidates(world, tmp_path):
    server, _ = make(tmp_path)
    world.devices[1]["name_by_user"] = "Kaffeemaschine"
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        with pytest.raises(Exception, match="2 devices") as error:
            await call(server, {"device": "Kaffeemaschine", "new_name": "Espresso"})
        assert DEVICE in str(error.value)
        with pytest.raises(Exception, match="ha_list_devices"):
            await call(server, {"device": "Toaster", "new_name": "Espresso"})


async def test_rename_needs_admin_write(world, tmp_path):
    server, _ = make(tmp_path, write=False)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, world)
        with pytest.raises(Exception, match="admin write"):
            await call(server, {"device": DEVICE, "new_name": "Espresso"})


def test_rename_device_is_an_admin_tool():
    from ha_safe_mcp.ollama_client import write_level
    assert write_level("ha_rename_device") == "admin"
