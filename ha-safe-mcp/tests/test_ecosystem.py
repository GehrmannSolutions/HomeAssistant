"""Read-only views of the HA ecosystem: add-ons and system info (Supervisor), HACS, Zigbee (ZHA), Thread."""
import pytest

from ha_safe_mcp.ecosystem import HAEcosystem
from ha_safe_mcp.management import HAWebSocket
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"


class FakeWS:
    def __init__(self, *, supervisor=True, hacs=True):
        self.supervisor, self.hacs = supervisor, hacs
        self.calls = []

    async def command(self, kind, payload=None, **_):
        self.calls.append((kind, payload))
        if kind == "supervisor/api":
            if not self.supervisor:
                raise RuntimeError("Home Assistant WebSocket error: unknown_command")
            return {
                "/addons": {"addons": [
                    {"slug": "core_mosquitto", "name": "Mosquitto broker", "state": "started", "version": "6.4",
                     "version_latest": "6.5", "update_available": True, "repository": "core", "url": "x"},
                    {"slug": "a0d7b954_vscode", "name": "Studio Code Server", "state": "stopped", "version": "5",
                     "version_latest": "5", "update_available": False, "repository": "a0d7b954"}]},
                "/core/info": {"version": "2026.10.2", "version_latest": "2026.10.2", "update_available": False,
                               "machine": "green", "arch": "aarch64", "ip_address": "172.30.32.1", "port": 8123},
                "/supervisor/info": {"version": "2026.10.0", "version_latest": "2026.10.0", "update_available": False,
                                     "channel": "stable", "healthy": True, "supported": True, "ip_address": "x",
                                     "country": "DE"},
                "/os/info": {"version": "16.2", "version_latest": "16.2", "update_available": False, "board": "green",
                             "boot_slots": {}},
                "/host/info": {"operating_system": "Home Assistant OS 16.2", "kernel": "6.12", "disk_total": 28.0,
                               "disk_used": 9.5, "disk_free": 18.5, "hostname": "homeassistant", "chassis": "embedded"},
            }[payload["endpoint"]]
        if kind == "hacs/repositories/list":
            if not self.hacs:
                raise RuntimeError("Home Assistant WebSocket error: unknown_command")
            return [{"full_name": "kalkih/mini-graph-card", "name": "mini-graph-card", "category": "plugin",
                     "installed": True, "installed_version": "v0.12.0", "available_version": "v0.13.0",
                     "pending_upgrade": True, "stars": 3000},
                    {"full_name": "x/y", "name": "y", "category": "integration", "installed": False}]
        if kind == "zha/devices":
            return [
                {"ieee": "00:11:22:33:44:55:66:77", "nwk": 1, "name": "IKEA E1743", "user_given_name": "Taster Flur",
                 "model": "E1743", "manufacturer": "IKEA", "device_type": "EndDevice", "power_source": "Battery",
                 "available": False, "lqi": 40, "rssi": -80, "last_seen": "2026-10-20T08:00:00", "area_id": "flur"},
                {"ieee": "aa", "nwk": 2, "name": "Plug", "user_given_name": None, "model": "P1", "manufacturer": "X",
                 "device_type": "Router", "power_source": "Mains", "available": True, "lqi": 200, "rssi": -50,
                 "last_seen": "2026-10-25T00:59:00", "area_id": None},
                {"ieee": "bb", "nwk": 0, "name": "SkyConnect", "device_type": "Coordinator", "available": True,
                 "lqi": None, "rssi": None, "power_source": "Mains", "model": "SkyConnect", "manufacturer": "Nabu"}]
        if kind == "thread/list_datasets":
            return {"datasets": [{"network_name": "ha-thread-1", "channel": 15, "preferred": True,
                                  "source": "SkyConnect", "pan_id": "1234", "extended_pan_id": "abcd",
                                  "created": "2026-01-01T00:00:00+00:00", "dataset_id": "x"}]}
        raise AssertionError(kind)


def make(**options):
    return HAEcosystem(HAClient(URL, "t"), FakeWS(**options))


async def test_addons_and_system_info_without_network_details():
    eco = make()
    addons = await eco.list_addons()
    assert addons[0] == {"slug": "core_mosquitto", "name": "Mosquitto broker", "state": "started", "version": "6.4",
                         "version_latest": "6.5", "update_available": True, "repository": "core"}
    info = await eco.system_info()
    assert info["core"]["version"] == "2026.10.2" and "ip_address" not in info["core"]
    assert info["supervisor"]["healthy"] is True and "country" not in info["supervisor"]
    assert info["host"]["disk_free"] == 18.5 and "hostname" not in info["host"]


async def test_without_supervisor_or_hacs_the_answer_says_so():
    eco = make(supervisor=False, hacs=False)
    assert await eco.list_addons() == []
    assert (await eco.system_info())["supervisor_available"] is False
    assert (await eco.list_hacs())["hacs_installed"] is False


async def test_hacs_lists_installed_repositories_with_pending_updates_first():
    result = await make().list_hacs()
    assert result["repositories"] == [{"full_name": "kalkih/mini-graph-card", "name": "mini-graph-card",
                                       "category": "plugin", "installed_version": "v0.12.0",
                                       "available_version": "v0.13.0", "pending_upgrade": True}]
    assert result["known_repositories"] == 2


async def test_zigbee_devices_show_health_without_addresses():
    result = await make().zigbee_devices()
    assert result["total"] == 3 and result["unavailable"] == 1 and result["weak_signal"] == 1
    first = result["devices"][0]
    assert first["name"] == "Taster Flur" and first["available"] is False and "ieee" not in first and "nwk" not in first
    assert [d["name"] for d in (await make().zigbee_devices(problems_only=True))["devices"]] == ["Taster Flur"]


async def test_thread_networks_without_ids():
    assert await make().thread_networks() == [{"network_name": "ha-thread-1", "channel": 15, "preferred": True,
                                               "source": "SkyConnect", "created": "2026-01-01T00:00:00+00:00"}]


async def test_the_supervisor_proxy_only_allows_fixed_get_endpoints():
    ws = HAWebSocket(HAClient(URL, "t"))
    for payload in ({"endpoint": "/addons/core_mosquitto/stop", "method": "post"},
                    {"endpoint": "/host/reboot", "method": "get"}, {"endpoint": "/addons", "method": "post"}):
        with pytest.raises(ValueError, match="supervisor"):
            await ws.command("supervisor/api", payload)


def test_tools_are_read_only_and_offered():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    tools = {"ha_list_addons", "ha_get_system_info", "ha_list_hacs_repositories", "ha_list_zigbee_devices",
             "ha_list_thread_networks"}
    assert tools <= names & READ_TOOLS
    assert "ha_list_zigbee_devices" in select_tool_names("Welche Zigbee-Geräte haben schlechten Empfang?", names,
                                                         allow_write=False)
    assert "ha_list_addons" in select_tool_names("Welche Add-ons laufen?", names, allow_write=False)
