"""Remove devices and orphaned entities (HA components/config/device_registry.py, entity_registry.py)."""
import pytest

from ha_safe_mcp.removal import HARemoval
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
DEV = "d" * 32
HUB = "b" * 32
STUCK = "c" * 32
ENTRY = "E" * 26


class FakeWS:
    def __init__(self, *, new_command=True, integration_refuses=False, supports=True):
        self.devices = [
            {"id": DEV, "name": "Outlet 1", "name_by_user": None, "manufacturer": "Kitchen", "model": "O",
             "area_id": "flur", "config_entry_id": ENTRY, "via_device_id": HUB, "disabled_by": None},
            {"id": HUB, "name": "Hub", "name_by_user": None, "manufacturer": "Kitchen", "model": "H",
             "area_id": None, "config_entry_id": ENTRY, "via_device_id": None, "disabled_by": None},
            {"id": STUCK, "name": "Stats", "name_by_user": None, "manufacturer": None, "model": None,
             "area_id": None, "config_entry_id": ENTRY, "via_device_id": None, "disabled_by": None}]
        self.entities = [
            {"entity_id": "switch.outlet_1", "device_id": DEV, "platform": "kitchen_sink", "disabled_by": None,
             "name": None, "original_name": "Outlet 1", "config_entry_id": ENTRY},
            {"entity_id": "sensor.outlet_1_power", "device_id": DEV, "platform": "kitchen_sink",
             "disabled_by": None, "name": None, "original_name": "Power", "config_entry_id": ENTRY},
            {"entity_id": "sensor.old_plug_energy", "device_id": None, "platform": "shelly", "disabled_by": None,
             "name": "Old plug", "original_name": None, "config_entry_id": None},
            {"entity_id": "light.live", "device_id": None, "platform": "hue", "disabled_by": None, "name": None,
             "original_name": "Live", "config_entry_id": ENTRY}]
        self.new_command, self.refuses, self.supports = new_command, integration_refuses, supports
        self.calls = []

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "config/device_registry/list":
            return [dict(d) for d in self.devices]
        if kind == "config/entity_registry/list":
            return [dict(e) for e in self.entities]
        if kind == "config_entries/get_single":
            return {"config_entry": {"entry_id": ENTRY, "domain": "kitchen_sink", "title": "Kitchen Sink",
                                     "supports_remove_device": self.supports, "state": "loaded"}}
        if kind in ("config/device_registry/remove", "config/device_registry/remove_config_entry"):
            if kind == "config/device_registry/remove" and not self.new_command:
                raise RuntimeError("Home Assistant WebSocket error: unknown_command")
            if self.refuses or payload["device_id"] == STUCK:
                raise RuntimeError("Home Assistant WebSocket error: home_assistant_error")
            self.devices = [d for d in self.devices if d["id"] != payload["device_id"]]
            self.entities = [e for e in self.entities if e["device_id"] != payload["device_id"]]
            return None
        if kind == "config/entity_registry/remove":
            self.entities = [e for e in self.entities if e["entity_id"] != payload["entity_id"]]
            return None
        raise AssertionError(kind)


class FakeClient(HAClient):
    async def _request(self, method, path, **kwargs):
        assert path == "/api/states"
        return [{"entity_id": "switch.outlet_1", "state": "on", "attributes": {}},
                {"entity_id": "sensor.outlet_1_power", "state": "3", "attributes": {}},
                {"entity_id": "sensor.old_plug_energy", "state": "unavailable",
                 "attributes": {"restored": True, "friendly_name": "Old plug"}},
                {"entity_id": "light.live", "state": "on", "attributes": {}}]


class FakeOverview:
    async def find_usages(self, needle, kinds=None, limit=100):
        if needle == "switch.outlet_1":
            return {"matches": [{"kind": "automation", "id": "a1", "name": "Night"}]}
        return {"matches": []}


def make(ws, *, delete=True, write=True):
    return HARemoval(FakeClient(URL, "t", allow_write=write), ws, overview=FakeOverview(),
                     allow_admin_write=True, allow_delete=delete)


async def test_preview_shows_what_goes_with_the_device():
    result = await make(FakeWS()).device_removal(DEV)
    assert result["device"]["name"] == "Outlet 1"
    assert result["integration"] == {"domain": "kitchen_sink", "title": "Kitchen Sink", "entry_id": ENTRY}
    assert result["can_remove"] is True
    assert sorted(result["entities"]) == ["sensor.outlet_1_power", "switch.outlet_1"]
    assert result["used_in"] == [{"entity_id": "switch.outlet_1", "kind": "automation", "id": "a1",
                                  "name": "Night"}]
    assert "cannot be undone" in result["warning"]
    hub = await make(FakeWS()).device_removal(HUB)
    assert hub["connected_devices"] == [{"device_id": DEV, "name": "Outlet 1"}]


async def test_preview_says_when_the_integration_cannot_remove_devices():
    result = await make(FakeWS(supports=False)).device_removal(DEV)
    assert result["can_remove"] is False and "does not support" in result["reason"]


async def test_remove_device_needs_delete_and_a_real_device_id():
    with pytest.raises(ValueError, match="delete"):
        await make(FakeWS(), delete=False).remove_device(DEV)
    with pytest.raises(ValueError, match="device_id"):
        await make(FakeWS()).remove_device("Outlet 1")
    with pytest.raises(ValueError, match="unknown device"):
        await make(FakeWS()).remove_device("a" * 32)


async def test_remove_device_removes_it_with_its_entities():
    ws = FakeWS()
    result = await make(ws).remove_device(DEV)
    assert result["removed"] is True and sorted(result["entities_removed"]) == ["sensor.outlet_1_power",
                                                                               "switch.outlet_1"]
    assert ("config/device_registry/remove", {"device_id": DEV}) in ws.calls
    assert all(d["id"] != DEV for d in ws.devices)


async def test_older_home_assistant_uses_the_previous_command():
    ws = FakeWS(new_command=False)
    await make(ws).remove_device(DEV)
    assert ("config/device_registry/remove_config_entry", {"device_id": DEV, "config_entry_id": ENTRY}) in ws.calls


async def test_refusals_are_explained_and_nothing_is_sent_when_unsupported():
    with pytest.raises(ValueError, match="refused"):
        await make(FakeWS()).remove_device(STUCK)
    ws = FakeWS(supports=False)
    with pytest.raises(ValueError, match="does not support"):
        await make(ws).remove_device(DEV)
    assert not any("remove" in kind for kind, _ in ws.calls)


async def test_orphaned_entities_are_the_ones_no_integration_provides():
    result = await make(FakeWS()).orphaned_entities()
    assert [e["entity_id"] for e in result["entities"]] == ["sensor.old_plug_energy"]
    assert result["entities"][0]["platform"] == "shelly"


async def test_remove_entity_only_for_orphans():
    ws = FakeWS()
    with pytest.raises(ValueError, match="still provided"):
        await make(ws).remove_entity("light.live")
    with pytest.raises(ValueError, match="delete"):
        await make(ws, delete=False).remove_entity("sensor.old_plug_energy")
    result = await make(ws).remove_entity("sensor.old_plug_energy")
    assert result == {"removed": "sensor.old_plug_energy", "name": "Old plug", "platform": "shelly"}
    assert ("config/entity_registry/remove", {"entity_id": "sensor.old_plug_energy"}) in ws.calls
    with pytest.raises(ValueError, match="not in the entity registry"):
        await make(ws).remove_entity("sensor.old_plug_energy")


def test_removal_tools_are_delete_level_and_device_removal_always_asks():
    from ha_safe_mcp.ollama_client import ALWAYS_ASK, CARD_DETAILS, write_level
    assert write_level("ha_remove_device") == "delete" and write_level("ha_remove_entity") == "delete"
    assert write_level("ha_get_device_removal") is None and write_level("ha_list_orphaned_entities") is None
    assert "ha_remove_device" in ALWAYS_ASK
    assert CARD_DETAILS["ha_remove_device"][0] == "ha_get_device_removal"
