"""Updates, reload, config check and restart: read freely, reload at admin level, install/restart at delete level."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.server import HAClient
from ha_safe_mcp.system import HASystem

URL = "http://ha:8123"
STATES = [
    {"entity_id": "update.shelly_plug", "state": "on", "attributes": {
        "friendly_name": "Plug Firmware", "installed_version": "1.4.2", "latest_version": "1.5.0",
        "skipped_version": None, "in_progress": False, "auto_update": False, "release_url": "https://example.invalid/r",
        "release_summary": "Fixes", "title": "Shelly"}},
    {"entity_id": "update.router", "state": "off", "attributes": {
        "friendly_name": "Router", "installed_version": "7.1", "latest_version": "7.1"}},
    {"entity_id": "light.flur", "state": "on", "attributes": {}},
]
SERVICES = [{"domain": "automation", "services": {"reload": {}, "trigger": {}}},
            {"domain": "homeassistant", "services": {"reload_all": {}, "reload_core_config": {}, "restart": {}}},
            {"domain": "light", "services": {"turn_on": {}}}]


class FakeWS:
    def __init__(self):
        self.calls = []

    async def command(self, kind, payload=None, **_):
        self.calls.append((kind, payload))
        assert kind == "update/release_notes"
        return "# 1.5.0\n" + "x" * 9000


def make(*, write=True, admin=True, delete=True):
    client = HAClient(URL, "t", allow_write=write)
    return HASystem(client, FakeWS(), allow_admin_write=admin, allow_delete=delete)


async def test_updates_are_listed_pending_first_with_versions():
    system = make(write=False)
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        pending = await system.list_updates()
        everything = await system.list_updates(pending_only=False)
    assert pending == [{"entity_id": "update.shelly_plug", "name": "Plug Firmware", "update_available": True,
                        "installed_version": "1.4.2", "latest_version": "1.5.0", "release_summary": "Fixes",
                        "release_url": "https://example.invalid/r"}]
    assert [u["entity_id"] for u in everything] == ["update.shelly_plug", "update.router"]


async def test_release_notes_are_capped():
    system = make(write=False)
    notes = await system.release_notes("update.shelly_plug")
    assert notes["notes"].startswith("# 1.5.0") and len(notes["notes"]) <= 4000 and notes["truncated"] is True
    with pytest.raises(ValueError):
        await system.release_notes("light.flur")


async def test_config_check_and_reload():
    system = make()
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/core/check_config").mock(return_value=httpx.Response(200, json={
            "result": "valid", "errors": None, "warnings": None}))
        router.get("/api/services").mock(return_value=httpx.Response(200, json=SERVICES))
        automation = router.post("/api/services/automation/reload").mock(return_value=httpx.Response(200, json=[]))
        everything = router.post("/api/services/homeassistant/reload_all").mock(return_value=httpx.Response(200, json=[]))
        assert (await system.check_config())["result"] == "valid"
        assert await system.reload("automation") == {"reloaded": "automation"}
        assert await system.reload("all") == {"reloaded": "all"}
        with pytest.raises(ValueError, match="no reload"):
            await system.reload("light")
    assert automation.called and everything.called
    with pytest.raises(ValueError, match="admin write disabled"):
        await make(admin=False).reload("automation")


async def test_restart_checks_the_config_first_and_needs_the_delete_level():
    system = make()
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.post("/api/config/core/check_config").mock(return_value=httpx.Response(200, json={
            "result": "invalid", "errors": "Integration error: foo", "warnings": None}))
        restart = router.post("/api/services/homeassistant/restart").mock(return_value=httpx.Response(200, json=[]))
        with pytest.raises(ValueError, match="configuration is invalid"):
            await system.restart()
    assert not restart.called
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/core/check_config").mock(return_value=httpx.Response(200, json={
            "result": "valid", "errors": None, "warnings": None}))
        router.post("/api/services/homeassistant/restart").mock(side_effect=httpx.RemoteProtocolError("closed"))
        result = await system.restart()
    assert result["restarting"] is True
    with pytest.raises(ValueError, match="delete level"):
        await make(delete=False).restart()


async def test_install_and_skip_updates():
    system = make()
    with respx.mock(base_url=URL) as router:
        router.get("/api/states/update.shelly_plug").mock(return_value=httpx.Response(200, json=STATES[0]))
        router.get("/api/states/update.router").mock(return_value=httpx.Response(200, json=STATES[1]))
        install = router.post("/api/services/update/install").mock(return_value=httpx.Response(200, json=[]))
        skip = router.post("/api/services/update/skip").mock(return_value=httpx.Response(200, json=[]))
        assert (await system.install_update("update.shelly_plug", backup=True))["installed"] == "1.5.0"
        with pytest.raises(ValueError, match="no update available"):
            await system.install_update("update.router")
        await system.skip_update("update.shelly_plug")
    assert json.loads(install.calls[0].request.content) == {"entity_id": "update.shelly_plug", "backup": True}
    assert json.loads(skip.calls[0].request.content) == {"entity_id": "update.shelly_plug"}
    with pytest.raises(ValueError, match="delete level"):
        await make(delete=False).install_update("update.shelly_plug")


async def test_a_long_install_is_reported_as_started():
    system = make()
    with respx.mock(base_url=URL) as router:
        router.get("/api/states/update.shelly_plug").mock(return_value=httpx.Response(200, json=STATES[0]))
        router.post("/api/services/update/install").mock(side_effect=httpx.ReadTimeout("slow"))
        result = await system.install_update("update.shelly_plug")
    assert result["started"] is True and "in_progress" in result["hint"]


def test_tools_have_the_right_levels():
    import asyncio
    from ha_safe_mcp.ollama_client import DELETE_TOOLS, READ_TOOLS, WRITE_TOOLS, select_tool_names
    from ha_safe_mcp.remote import tool_level
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    read = {"ha_list_updates", "ha_get_release_notes", "ha_check_config"}
    admin = {"ha_reload", "ha_skip_update"}
    delete = {"ha_install_update", "ha_restart"}
    assert read | admin | delete <= names and read <= READ_TOOLS and admin | delete <= WRITE_TOOLS
    assert delete <= DELETE_TOOLS
    assert {tool_level(n) for n in admin} == {"admin"} and {tool_level(n) for n in delete} == {"delete"}
    assert "ha_list_updates" in select_tool_names("Gibt es Updates?", names, allow_write=False)
    assert "ha_restart" in select_tool_names("Starte Home Assistant neu", names, allow_write=True)
