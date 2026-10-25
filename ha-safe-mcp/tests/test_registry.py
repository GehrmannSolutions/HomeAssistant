"""Areas, floors and devices through HA's registries: gated writes, read-back, no device identifiers leak."""
import json

import pytest

from ha_safe_mcp.registry import HARegistry
from ha_safe_mcp.server import HAClient

DEVICE = {"id": "00000000000000000000000000000001", "name": "Shelly Plug", "name_by_user": None,
          "manufacturer": "Shelly", "model": "Plug S", "area_id": None, "disabled_by": None, "entry_type": None,
          "config_entries": ["00000000000000000000000000"], "via_device_id": None, "labels": [],
          "serial_number": "SER-123456", "connections": [["mac", "example-mac-not-real"]],
          "identifiers": [["shelly", "aabbccddeeff"]], "configuration_url": "http://192.0.2.10"}


class FakeWS:
    """Tiny in-memory area/floor/device registry with HA's command names."""

    def __init__(self):
        self.calls = []
        self.areas = [{"area_id": "wohnzimmer", "name": "Wohnzimmer", "floor_id": None, "icon": "mdi:sofa",
                       "aliases": [], "labels": [], "picture": None}]
        self.floors = []
        self.devices = [dict(DEVICE)]

    async def command(self, kind, payload=None):
        payload = dict(payload or {})
        self.calls.append((kind, payload))
        if kind == "config/area_registry/list":
            return [dict(a) for a in self.areas]
        if kind == "config/floor_registry/list":
            return [dict(f) for f in self.floors]
        if kind == "config/device_registry/list":
            return [dict(d) for d in self.devices]
        if kind == "config/area_registry/create":
            area = {"area_id": payload["name"].lower().replace(" ", "_"), "floor_id": None, "icon": None,
                    "aliases": [], "labels": [], **payload}
            self.areas.append(area)
            return area
        if kind == "config/area_registry/update":
            area = next(a for a in self.areas if a["area_id"] == payload["area_id"])
            area.update(payload)
            return area
        if kind == "config/area_registry/delete":
            self.areas = [a for a in self.areas if a["area_id"] != payload["area_id"]]
            return "success"
        if kind == "config/floor_registry/create":
            floor = {"floor_id": payload["name"].lower(), "icon": None, "level": None, "aliases": [], **payload}
            self.floors.append(floor)
            return floor
        if kind == "config/floor_registry/delete":
            self.floors = [f for f in self.floors if f["floor_id"] != payload["floor_id"]]
            return "success"
        if kind == "config/device_registry/update":
            device = next(d for d in self.devices if d["id"] == payload["device_id"])
            device.update({k: v for k, v in payload.items() if k != "device_id"})
            return device
        raise AssertionError(f"unexpected ws command {kind}")


def make(*, write=True, admin=True, delete=False, ws=None):
    ws = ws or FakeWS()
    return HARegistry(HAClient("http://ha:8123", "token", allow_write=write), ws,
                      allow_admin_write=admin, allow_delete=delete), ws


async def test_areas_and_floors_are_listed_with_small_field_sets():
    registry, _ = make()
    assert await registry.list_areas() == [{"area_id": "wohnzimmer", "name": "Wohnzimmer", "floor_id": None,
                                            "icon": "mdi:sofa", "aliases": [], "labels": []}]
    assert await registry.list_floors() == []


async def test_device_list_never_returns_serials_macs_or_urls():
    registry, _ = make()
    [device] = await registry.list_devices()
    assert device == {"device_id": DEVICE["id"], "name": "Shelly Plug", "name_by_user": None, "manufacturer": "Shelly",
                      "model": "Plug S", "area_id": None, "disabled_by": None, "entry_type": None, "labels": []}
    text = json.dumps(device)
    assert "SER-123456" not in text and "example-mac-not-real" not in text and "192.0.2.10" not in text


async def test_device_list_filters_by_area_and_text():
    registry, ws = make()
    ws.devices.append({**DEVICE, "id": "0" * 32, "name": "Küchenlicht", "model": "Bulb", "area_id": "kuche"})
    assert [d["name"] for d in await registry.list_devices(area_id="kuche")] == ["Küchenlicht"]
    assert [d["name"] for d in await registry.list_devices(query="plug")] == ["Shelly Plug"]
    assert [d["name"] for d in await registry.list_devices(area_id="none")] == ["Shelly Plug"]


async def test_writes_need_admin_write():
    registry, ws = make(admin=False)
    for call in (registry.create_area("Flur"), registry.update_device(DEVICE["id"], {"area_id": "wohnzimmer"}),
                 registry.create_floor("Erdgeschoss")):
        with pytest.raises(ValueError, match="admin write"):
            await call
    assert ws.calls == []


async def test_create_area_reads_back_and_rejects_reserved_fields():
    registry, ws = make()
    created = await registry.create_area("Flur", icon="mdi:door")
    assert created["area_id"] == "flur" and created["icon"] == "mdi:door"
    assert ("config/area_registry/create", {"name": "Flur", "icon": "mdi:door"}) in ws.calls
    with pytest.raises(ValueError):
        await registry.create_area("")


async def test_update_area_allows_only_metadata_and_checks_the_floor():
    registry, ws = make()
    await registry.create_floor("EG")
    updated = await registry.update_area("wohnzimmer", {"name": "Wohnen", "floor_id": "eg"})
    assert updated["name"] == "Wohnen" and updated["floor_id"] == "eg"
    with pytest.raises(ValueError, match="fields"):
        await registry.update_area("wohnzimmer", {"picture": "http://evil"})
    with pytest.raises(ValueError, match="floor_id"):
        await registry.update_area("wohnzimmer", {"floor_id": "keller"})


async def test_assign_device_to_area_verifies_the_area_and_reads_back():
    registry, ws = make()
    result = await registry.update_device(DEVICE["id"], {"area_id": "wohnzimmer", "name_by_user": "Stehlampe"})
    assert result["area_id"] == "wohnzimmer" and result["name_by_user"] == "Stehlampe"
    with pytest.raises(ValueError, match="area_id"):
        await registry.update_device(DEVICE["id"], {"area_id": "gibtsnicht"})
    with pytest.raises(ValueError, match="fields"):
        await registry.update_device(DEVICE["id"], {"config_entries": []})
    with pytest.raises(ValueError, match="disabled_by"):
        await registry.update_device(DEVICE["id"], {"disabled_by": "integration"})
    with pytest.raises(ValueError, match="device_id"):
        await registry.update_device("Shelly Plug", {"area_id": None})


async def test_area_unassign_with_null_is_allowed():
    registry, ws = make()
    await registry.update_device(DEVICE["id"], {"area_id": "wohnzimmer"})
    assert (await registry.update_device(DEVICE["id"], {"area_id": None}))["area_id"] is None


async def test_deletes_need_the_delete_switch_and_read_back():
    registry, ws = make()
    with pytest.raises(ValueError, match="delete"):
        await registry.delete_area("wohnzimmer")
    registry, ws = make(delete=True)
    assert await registry.delete_area("wohnzimmer") == {"deleted": True}
    assert await registry.list_areas() == []
    await registry.create_floor("EG")
    assert await registry.delete_floor("eg") == {"deleted": True}


def test_registry_tools_are_registered_and_device_removal_is_delete_level():
    import asyncio
    from ha_safe_mcp.server import create_server
    tools = {tool.name: tool for tool in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    assert {"ha_list_areas", "ha_list_floors", "ha_list_devices", "ha_create_area", "ha_update_area",
            "ha_delete_area", "ha_create_floor", "ha_update_floor", "ha_delete_floor", "ha_update_device"} <= tools.keys()
    # removing devices is wanted since 2026-10-25 (delete level, always with an approval card in the chat)
    from ha_safe_mcp.ollama_client import write_level
    assert "ha_delete_device" not in tools and write_level("ha_remove_device") == "delete"
    assert "ha_list_devices" in tools["ha_update_device"].inputSchema["properties"]["device_id"]["description"]
