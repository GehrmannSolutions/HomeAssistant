"""Deep search (where is something used) and a compact system overview."""
import pytest

from ha_safe_mcp.overview import HAOverview

STATES = [
    {"entity_id": "automation.morgens", "state": "on", "attributes": {"id": "a1", "friendly_name": "Morgens"}},
    {"entity_id": "automation.yaml_ohne_id", "state": "off", "attributes": {"friendly_name": "YAML"}},
    {"entity_id": "script.gute_nacht", "state": "off", "attributes": {"friendly_name": "Gute Nacht"}},
    {"entity_id": "scene.abend", "state": "unknown", "attributes": {"id": "s1", "friendly_name": "Abend",
                                                                     "entity_id": ["light.flur"]}},
    {"entity_id": "group.unten", "state": "on", "attributes": {"entity_id": ["light.flur", "light.kueche"],
                                                               "friendly_name": "Unten"}},
    {"entity_id": "light.flur", "state": "on", "attributes": {"friendly_name": "Flur"}},
    {"entity_id": "light.kueche", "state": "unavailable", "attributes": {"friendly_name": "Küche"}},
    {"entity_id": "sensor.t", "state": "21", "attributes": {}},
    {"entity_id": "sensor.alt", "state": "unknown", "attributes": {}},
]


class FakeClient:
    async def _request(self, method, path, **kwargs):
        if path == "/api/states":
            return STATES
        if path == "/api/config":
            return {"version": "2026.10.3", "location_name": "Zuhause", "time_zone": "Europe/Berlin",
                    "unit_system": {"temperature": "°C"}, "state": "RUNNING", "safe_mode": False,
                    "recovery_mode": False, "components": ["light", "unifi"] * 3}
        raise AssertionError(path)


class FakeAdmin:
    async def automation_get(self, config_id):
        assert config_id == "a1"
        return {"id": "a1", "alias": "Morgens", "triggers": [{"trigger": "time", "at": "07:00"}],
                "actions": [{"action": "light.turn_on", "target": {"entity_id": ["light.flur"]}}]}

    async def dashboard_list(self):
        return [{"id": "test", "url_path": "test-views", "title": "Test", "mode": "storage"},
                {"id": "yaml", "url_path": "yaml-views", "title": "YAML", "mode": "yaml"}]

    async def dashboard_get(self, url_path=None):
        if url_path is None:
            raise RuntimeError("Home Assistant WebSocket error: config_not_found")
        return {"views": [{"title": "Unten", "cards": [{"type": "entities", "entities": ["light.flur"]}]}]}


class FakeScenes:
    async def get_script(self, script_id):
        return {"alias": "Gute Nacht", "sequence": [{"action": "light.turn_off", "target": {"entity_id": "light.kueche"}}]}

    async def get_scene(self, scene_id):
        return {"id": "s1", "name": "Abend", "entities": {"light.flur": {"state": "on"}}}


class FakeWS:
    async def command(self, kind, payload=None, **kwargs):
        return {"config/area_registry/list": [{"area_id": "a"}, {"area_id": "b"}],
                "config/floor_registry/list": [{"floor_id": "eg"}],
                "config/device_registry/list": [{"id": "d1"}, {"id": "d2"}, {"id": "d3"}],
                "config/entity_registry/list": [{"entity_id": "x", "disabled_by": "user"},
                                                {"entity_id": "y", "disabled_by": None}]}[kind]


class FakeIntegrations:
    async def list_entries(self, domain=""):
        return [{"domain": "unifi", "title": "Default", "state": "setup_error"},
                {"domain": "met", "title": "Home", "state": "loaded"},
                {"domain": "cast", "title": "Cast", "state": "loaded", "disabled_by": "user"}]


def make():
    return HAOverview(FakeClient(), FakeWS(), admin=FakeAdmin(), scenes=FakeScenes(), integrations=FakeIntegrations())


async def test_usages_are_found_in_automations_scenes_groups_and_dashboards():
    result = await make().find_usages("light.flur")
    found = {(m["kind"], m["id"]) for m in result["matches"]}
    assert found == {("automation", "a1"), ("scene", "s1"), ("group", "group.unten"), ("dashboard", "test-views"),
                     ("dashboard", "yaml-views")}
    automation = next(m for m in result["matches"] if m["kind"] == "automation")
    assert automation["name"] == "Morgens" and automation["paths"] == ["actions[0].target.entity_id[0]"]
    scene = next(m for m in result["matches"] if m["kind"] == "scene")
    assert scene["paths"] == ["entities.light.flur (key)"]
    assert result["searched"]["automations"] == 1 and result["skipped"] == ["automation.yaml_ohne_id (no id)"]


async def test_usage_search_can_be_limited_to_kinds_and_rejects_tiny_needles():
    result = await make().find_usages("light.kueche", kinds=["script"])
    assert [(m["kind"], m["id"]) for m in result["matches"]] == [("script", "gute_nacht")]
    with pytest.raises(ValueError):
        await make().find_usages("x")
    with pytest.raises(ValueError):
        await make().find_usages("light.flur", kinds=["files"])


async def test_overview_counts_the_essentials():
    view = await make().overview()
    assert view["version"] == "2026.10.3" and view["time_zone"] == "Europe/Berlin"
    assert view["entities"]["total"] == 9 and view["entities"]["unavailable"] == 1 and view["entities"]["unknown"] == 2
    assert view["entities"]["by_domain"]["light"] == {"total": 2, "unavailable": 1, "on": 1}
    assert view["registry"] == {"areas": 2, "floors": 1, "devices": 3, "entities_disabled": 1}
    assert view["automations"] == {"total": 2, "on": 1} and view["scripts"] == 1 and view["scenes"] == 1
    assert view["integrations"]["total"] == 3 and view["integrations"]["failing"] == [
        {"domain": "unifi", "title": "Default", "state": "setup_error"}]
    assert view["integrations"]["disabled"] == 1 and view["dashboards"] == 2


def test_tools_are_registered_and_read_only():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names
    from ha_safe_mcp.server import HAClient, create_server
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    assert {"ha_find_usages", "ha_get_overview"} <= names & READ_TOOLS
    assert "ha_find_usages" in select_tool_names("Wo wird light.flur überall verwendet?", names, allow_write=False)
    assert "ha_get_overview" in select_tool_names("Gib mir einen Überblick über mein System", names,
                                                  allow_write=False)
