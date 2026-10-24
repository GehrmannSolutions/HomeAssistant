"""Scenes and scripts through HA's config API (/api/config/scene|script/config/{id}): gated, validated, read back."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.scenes import HAScenes
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
STATES = [
    {"entity_id": "scene.abendlicht", "state": "2026-10-24T10:00:00+00:00",
     "attributes": {"friendly_name": "Abendlicht", "id": "1729760000000", "entity_id": ["light.flur"]}},
    {"entity_id": "scene.yaml_scene", "state": "unknown", "attributes": {"friendly_name": "YAML", "entity_id": []}},
    {"entity_id": "script.gute_nacht", "state": "off",
     "attributes": {"friendly_name": "Gute Nacht", "last_triggered": None, "mode": "single"}},
    {"entity_id": "light.flur", "state": "off", "attributes": {"friendly_name": "Flur"}},
]
SCENE = {"name": "Abendlicht", "entities": {"light.flur": {"state": "on", "brightness": 120}}}
SCRIPT = {"alias": "Gute Nacht", "sequence": [{"action": "light.turn_off", "target": {"entity_id": "light.flur"}}]}


class FakeWS:
    def __init__(self, valid=True):
        self.calls, self.valid = [], valid

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        assert kind == "validate_config"
        return {key: {"valid": self.valid, "error": None if self.valid else "bad action"} for key in payload}


def make(*, write=True, admin=True, delete=False, ws=None, domains=frozenset({"light"})):
    client = HAClient(URL, "token", allow_write=write, allowed_domains=domains)
    return HAScenes(client, ws or FakeWS(), allow_admin_write=admin, allow_delete=delete, settle_seconds=0)


async def test_lists_scenes_and_scripts_with_their_config_ids():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        scenes = await make().list_scenes()
        scripts = await make().list_scripts()
    assert scenes == [
        {"entity_id": "scene.abendlicht", "name": "Abendlicht", "scene_id": "1729760000000", "editable": True,
         "entities": ["light.flur"]},
        {"entity_id": "scene.yaml_scene", "name": "YAML", "scene_id": None, "editable": False, "entities": []}]
    assert scripts == [{"entity_id": "script.gute_nacht", "name": "Gute Nacht", "script_id": "gute_nacht",
                        "running": False, "last_triggered": None, "mode": "single"}]


async def test_get_reads_the_stored_config():
    with respx.mock(base_url=URL) as router:
        router.get("/api/config/scene/config/abendlicht").mock(return_value=httpx.Response(200, json={"id": "abendlicht", **SCENE}))
        router.get("/api/config/script/config/gute_nacht").mock(return_value=httpx.Response(200, json=SCRIPT))
        assert (await make().get_scene("abendlicht"))["entities"]["light.flur"]["brightness"] == 120
        assert (await make().get_script("gute_nacht"))["alias"] == "Gute Nacht"


@pytest.mark.parametrize("bad", ["../x", "a b", "", "x" * 65])
async def test_ids_are_validated_before_any_request(bad):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        route = router.route()
        with pytest.raises(ValueError):
            await make().get_scene(bad)
        with pytest.raises(ValueError):
            await make().get_script(bad)
    assert not route.called


async def test_save_scene_needs_admin_write_and_reads_back_with_previous():
    with respx.mock(base_url=URL) as router:
        router.get("/api/config/scene/config/abendlicht").mock(side_effect=[
            httpx.Response(404, json={"message": "Resource not found"}),
            httpx.Response(200, json={"id": "abendlicht", **SCENE})])
        post = router.post("/api/config/scene/config/abendlicht").mock(return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "scene.abendlicht", "state": "unknown", "attributes": {"id": "abendlicht"}},
            {"entity_id": "light.flur", "state": "off", "attributes": {}}]))
        with pytest.raises(ValueError, match="admin write"):
            await make(admin=False).save_scene("abendlicht", SCENE)
        result = await make().save_scene("abendlicht", SCENE)
    assert json.loads(post.calls[0].request.content) == SCENE
    assert result == {"previous": None, "config": {"id": "abendlicht", **SCENE}, "entity_id": "scene.abendlicht"}


@pytest.mark.parametrize("config", [
    {"entities": {"light.flur": {"state": "on"}}},
    {"name": "x", "entities": {}},
    {"name": "x", "entities": {"Flur Licht": {"state": "on"}}},
    {"name": "x", "entities": {"light.flur": ["on"]}},
    {"name": "x", "id": "other", "entities": {"light.flur": "on"}},
])
async def test_invalid_scene_configs_are_rejected_before_writing(config):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        route = router.route()
        with pytest.raises(ValueError):
            await make().save_scene("abendlicht", config)
    assert not route.called


async def test_save_script_validates_the_sequence_in_home_assistant_first():
    ws = FakeWS(valid=False)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/services").mock(return_value=httpx.Response(200, json=SERVICES))
        post = router.post("/api/config/script/config/gute_nacht")
        with pytest.raises(ValueError, match="rejected"):
            await make(ws=ws).save_script("gute_nacht", SCRIPT)
    assert not post.called
    assert ws.calls == [("validate_config", {"actions": SCRIPT["sequence"]})]


async def test_save_script_writes_and_reads_back():
    with respx.mock(base_url=URL) as router:
        router.get("/api/services").mock(return_value=httpx.Response(200, json=SERVICES))
        router.get("/api/config/script/config/gute_nacht").mock(side_effect=[
            httpx.Response(200, json={"alias": "Alt", "sequence": []}), httpx.Response(200, json=SCRIPT)])
        router.post("/api/config/script/config/gute_nacht").mock(return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = await make().save_script("gute_nacht", SCRIPT)
    assert result["previous"]["alias"] == "Alt" and result["config"] == SCRIPT and result["entity_id"] == "script.gute_nacht"


@pytest.mark.parametrize("config", [{"sequence": []}, {"alias": "x"}, {"alias": "x", "sequence": "light.turn_on"},
                                    {"alias": "x", "sequence": [], "id": "y"}])
async def test_invalid_script_configs_are_rejected(config):
    with pytest.raises(ValueError):
        await make().save_script("gute_nacht", config)


async def test_script_ids_must_be_slugs():
    with pytest.raises(ValueError):
        await make().save_script("Gute-Nacht", SCRIPT)


async def test_delete_needs_the_delete_switch_and_confirms_absence():
    with respx.mock(base_url=URL) as router:
        router.delete("/api/config/scene/config/abendlicht").mock(return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/config/scene/config/abendlicht").mock(return_value=httpx.Response(404))
        router.delete("/api/config/script/config/gute_nacht").mock(return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/config/script/config/gute_nacht").mock(return_value=httpx.Response(404))
        with pytest.raises(ValueError, match="delete"):
            await make().delete_scene("abendlicht")
        assert await make(delete=True).delete_scene("abendlicht") == {"deleted": True}
        assert await make(delete=True).delete_script("gute_nacht") == {"deleted": True}


async def test_activating_and_running_respect_the_domain_allowlist():
    with respx.mock(base_url=URL) as router:
        scene = router.post("/api/services/scene/turn_on").mock(return_value=httpx.Response(200, json=[]))
        script = router.post("/api/services/script/turn_on").mock(return_value=httpx.Response(200, json=[]))
        with pytest.raises(ValueError, match="scene"):
            await make().activate_scene("scene.abendlicht")
        allowed = make(domains=frozenset({"scene", "script"}))
        await allowed.activate_scene("scene.abendlicht")
        await allowed.run_script("script.gute_nacht")
        with pytest.raises(ValueError):
            await allowed.activate_scene("light.flur")
        with pytest.raises(ValueError):
            await make(write=False, domains=frozenset({"scene"})).activate_scene("scene.abendlicht")
    assert json.loads(scene.calls[0].request.content) == {"entity_id": "scene.abendlicht"}
    assert script.called


def test_scene_and_script_tools_are_registered():
    import asyncio
    from ha_safe_mcp.server import create_server
    names = {tool.name for tool in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_list_scenes", "ha_get_scene", "ha_save_scene", "ha_delete_scene", "ha_activate_scene",
            "ha_list_scripts", "ha_get_script", "ha_save_script", "ha_delete_script", "ha_run_script"} <= names


SERVICES = [{"domain": "light", "services": {"turn_on": {}, "turn_off": {}}},
            {"domain": "notify", "services": {"notify": {}}}]


async def test_scripts_with_unknown_actions_are_rejected_even_when_nested():
    """HA's validate_config accepted 'gibtsnicht.kaputt' on the dev HA; unknown services only fail at run time."""
    nested = {"alias": "x", "sequence": [{"choose": [{"conditions": [], "sequence": [
        {"action": "light.turn_on", "target": {"entity_id": "light.flur"}},
        {"service": "gibtsnicht.kaputt"}]}], "default": [{"action": "notify.notify", "data": {"message": "hi"}}]}]}
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/services").mock(return_value=httpx.Response(200, json=SERVICES))
        post = router.post("/api/config/script/config/gute_nacht")
        with pytest.raises(ValueError, match="gibtsnicht.kaputt"):
            await make().save_script("gute_nacht", nested)
    assert not post.called


def test_action_names_are_collected_from_nested_sequences():
    from ha_safe_mcp.scenes import action_names
    sequence = [{"action": "light.turn_on"}, {"if": [], "then": [{"service": "notify.notify"}],
                                               "else": [{"parallel": [{"action": "script.turn_on"}]}]},
                {"delay": "00:00:05"}, {"action": "{{ dynamic }}"}]
    assert action_names(sequence) == {"light.turn_on", "notify.notify", "script.turn_on"}


async def test_scenes_with_unknown_entities_are_rejected_before_writing():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        post = router.post("/api/config/scene/config/abendlicht")
        with pytest.raises(ValueError, match="light.erfunden"):
            await make().save_scene("abendlicht", {"name": "x", "entities": {"light.erfunden": "on"}})
    assert not post.called
