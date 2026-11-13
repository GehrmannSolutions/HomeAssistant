"""Empty or failed answers name the next step (findings of the shared small-model eval, 2026-11-13).

qwen3-coder:30b against the demo house: it searched the TV as a media_player (it is a switch on a smart plug),
listed the kitchen's devices (none: the lamps have no device), saved an automation with the pre-2024.10 keys
trigger/action (rejected with a misleading message, retried four times) and switched an invented light.garage
(reported as "not confirmed" instead of "does not exist"). English words also found nothing in a German-named home.
"""
import json

import httpx
import pytest
import respx

from ha_safe_mcp import server as server_module
from ha_safe_mcp.domains import translations
from ha_safe_mcp.management import HAAdmin
from ha_safe_mcp.registry import HARegistry
from ha_safe_mcp.server import HAClient, create_server
from ha_safe_mcp.suggest import similar_entities

URL = "http://ha:8123"
STATES = [
    {"entity_id": "switch.h3d_wz_tv", "state": "off", "attributes": {"friendly_name": "Fernseher"}},
    {"entity_id": "switch.h3d_wk_waschmaschine", "state": "on", "attributes": {"friendly_name": "Waschmaschine"}},
    {"entity_id": "light.h3d_ba_licht", "state": "off", "attributes": {"friendly_name": "Bad"}},
    {"entity_id": "light.stehlampe", "state": "on", "attributes": {"friendly_name": "Stehlampe"}},
    {"entity_id": "light.garten", "state": "off", "attributes": {"friendly_name": "Garten"}},
    # live demo house 2026-11-13: "tv" inside "paketverlust", a TV helper and a meter came before the TV itself,
    # and "garage" matched shutters by their device class
    {"entity_id": "sensor.udm_paketverlust", "state": "0", "attributes": {"friendly_name": "UDM Paketverlust"}},
    {"entity_id": "input_boolean.h3d_wz_tv_state", "state": "off",
     "attributes": {"friendly_name": "Fernseher (Zustand)"}},
    {"entity_id": "input_number.demo_plug_tv_kwh", "state": "3.1", "attributes": {"friendly_name": "TV plug meter"}},
    {"entity_id": "cover.rl_kuche", "state": "open",
     "attributes": {"friendly_name": "Rollladen Küche", "device_class": "garage"}},
]


def parse(result):
    if isinstance(result, tuple):
        result = result[1] or result[0]
    if isinstance(result, dict):
        return result.get("result", result)
    return json.loads(result[0].text)


def state(entity_id, value):
    return httpx.Response(200, json={"entity_id": entity_id, "state": value, "attributes": {}})


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(server_module, "READ_BACK_DELAYS", (0, 0, 0))


def make_server(**domains):
    return create_server(HAClient(URL, "t", allow_write=True,
                                  allowed_domains=frozenset({"light", "switch", "media_player"})))


# ------------------------------------------------------------------ words and suggestions
def test_household_words_translate_between_english_and_german():
    assert "waschmaschine" in translations("Washing Machine")
    assert "tv" in translations("Fernseher") and "fernseher" in translations("TV")
    assert "bad" in translations("bathroom") and "wohnzimmer" in translations(" Living Room ")
    assert translations("quasselstrippe") == []


def test_similar_entities_catch_typos_guessed_ids_and_other_languages():
    assert [s["entity_id"] for s in similar_entities(STATES, "stelampe")] == ["light.stehlampe"]
    assert "light.garten" in [s["entity_id"] for s in similar_entities(STATES, "light.garage")]
    assert "light.h3d_ba_licht" in [s["entity_id"] for s in similar_entities(STATES, "light.bathroom_light")]
    assert similar_entities(STATES, "light.zeppelin") == []


# ------------------------------------------------------------------ search
async def test_a_domain_filtered_search_without_hits_names_matches_in_other_domains():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = parse(await make_server().call_tool("ha_search_entities", {"query": "TV",
                                                                             "domain": "media_player"}))
    assert result["results"] == []
    others = [e["entity_id"] for e in result["other_domains"]]
    assert others[0] == "switch.h3d_wz_tv"                  # switchable first, also found by "Fernseher"
    assert "sensor.udm_paketverlust" not in others         # whole words only
    assert "switch" in result["hint"]


async def test_the_other_domain_fallback_ignores_device_classes():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = parse(await make_server().call_tool("ha_search_entities", {"query": "garage", "domain": "light"}))
    assert result["results"] == [] and "other_domains" not in result
    assert "cover.rl_kuche" not in json.dumps(result)


async def test_english_words_find_german_names_and_back():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        server = make_server()
        washer = parse(await server.call_tool("ha_search_entities", {"query": "washing machine"}))
        bath = parse(await server.call_tool("ha_search_entities", {"query": "bathroom", "domain": "light"}))
    assert [e["entity_id"] for e in washer] == ["switch.h3d_wk_waschmaschine"]
    assert [e["entity_id"] for e in bath] == ["light.h3d_ba_licht"]


async def test_a_search_without_any_hit_suggests_names_and_how_to_browse():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        server = make_server()
        garage = parse(await server.call_tool("ha_search_entities", {"query": "garage", "domain": "light"}))
        typo = parse(await server.call_tool("ha_search_entities", {"query": "stelampe"}))
    assert garage["results"] == [] and "ha_list_area_entities" in garage["hint"]
    assert "only if" in garage["hint"]    # a similar name is no licence to switch it
    assert [s["entity_id"] for s in typo["similar"]] == ["light.stehlampe"]


async def test_a_normal_search_keeps_its_plain_list():
    with respx.mock(base_url=URL) as router:
        route = router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = parse(await make_server().call_tool("ha_search_entities", {"query": "stehlampe"}))
    assert result == [{"entity_id": "light.stehlampe", "state": "on", "friendly_name": "Stehlampe"}]
    assert route.call_count == 1


# ------------------------------------------------------------------ unknown entities in actions
async def test_an_unknown_entity_is_an_error_that_names_similar_ones():
    with respx.mock(base_url=URL) as router:
        router.post("/api/services/light/turn_on").mock(return_value=httpx.Response(200, json=[]))
        router.get("/api/states/light.garage").mock(return_value=httpx.Response(404, json={"message": "nope"}))
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        with pytest.raises(Exception, match="light.garage does not exist") as caught:
            await make_server().call_tool("ha_call_service", {"domain": "light", "service": "turn_on",
                                                              "entity_id": "light.garage"})
    assert "light.garten" in str(caught.value) and "nothing happened" in str(caught.value)


async def test_a_list_with_one_unknown_entity_reports_it_next_to_the_others():
    with respx.mock(base_url=URL) as router:
        router.post("/api/services/light/turn_off").mock(return_value=httpx.Response(200, json=[]))
        router.get("/api/states/light.stehlampe").mock(return_value=state("light.stehlampe", "off"))
        missing = router.get("/api/states/light.garage").mock(return_value=httpx.Response(404, json={}))
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = parse(await make_server().call_tool("ha_call_service", {
            "domain": "light", "service": "turn_off", "entity_id": ["light.stehlampe", "light.garage"]}))
    assert result["unknown_entities"] == ["light.garage"] and result["all_confirmed"] is False
    assert result["states_after"] == [
        {"entity_id": "light.stehlampe", "state": "off", "confirmed": True},
        {"entity_id": "light.garage", "exists": False, "confirmed": False}]
    assert "does not exist" in result["hint"]
    assert missing.call_count == 1        # a missing entity is not polled for 3 s


# ------------------------------------------------------------------ automations
class FakeAutomationWS:
    def __init__(self, reject=None):
        self.calls, self.reject = [], reject or {}

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "validate_config":
            return {key: {"valid": key not in self.reject, "error": self.reject.get(key)} for key in payload}
        raise AssertionError(kind)


async def test_an_automation_with_the_old_singular_keys_is_saved_in_the_current_format():
    trigger = [{"platform": "time", "at": "22:00:00"}]
    action = [{"service": "switch.turn_off", "target": {"entity_id": "switch.h3d_wz_tv"}}]
    config = {"alias": "TV aus", "trigger": trigger, "mode": "single", "action": action}
    saved = {"alias": "TV aus", "triggers": trigger, "mode": "single", "actions": action}
    ws = FakeAutomationWS()
    with respx.mock(base_url=URL) as router:
        post = router.post("/api/config/automation/config/eval_tv_aus").mock(
            return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/config/automation/config/eval_tv_aus").mock(
            return_value=httpx.Response(200, json={"id": "eval_tv_aus", **saved}))
        admin = HAAdmin(HAClient(URL, "t", allow_write=True), ws, allow_admin_write=True)
        result = await admin.automation_save("eval_tv_aus", config)
    assert result["id"] == "eval_tv_aus"
    assert ws.calls == [("validate_config", {"triggers": trigger, "actions": action})]
    assert json.loads(post.calls[0].request.content) == saved
    assert list(json.loads(post.calls[0].request.content)) == ["alias", "triggers", "mode", "actions"]


async def test_old_and_new_key_together_are_refused():
    admin = HAAdmin(HAClient(URL, "t", allow_write=True), FakeAutomationWS(), allow_admin_write=True)
    with pytest.raises(ValueError, match="either 'triggers' or 'trigger'"):
        await admin.automation_validate({"trigger": [], "triggers": [], "actions": []})


async def test_a_rejected_automation_says_why_and_an_empty_one_shows_the_format():
    ws = FakeAutomationWS(reject={"triggers": "Invalid trigger 'zeit' specified"})
    admin = HAAdmin(HAClient(URL, "t", allow_write=True), ws, allow_admin_write=True)
    with pytest.raises(ValueError, match="Invalid trigger 'zeit' specified"):
        await admin.automation_save("x", {"alias": "x", "triggers": [{"trigger": "zeit"}], "actions": []})
    with pytest.raises(ValueError, match="triggers.*actions") as caught:
        await admin.automation_validate({"alias": "x"})
    assert '"trigger": "time"' in str(caught.value)    # an example of the current format


# ------------------------------------------------------------------ rooms
class FakeRegistryWS:
    def __init__(self, devices=()):
        self.areas = [{"area_id": "kuche", "name": "Küche", "floor_id": None, "aliases": []},
                      {"area_id": "wohnzimmer", "name": "Wohnzimmer", "floor_id": None, "aliases": []}]
        self.devices = list(devices)

    async def command(self, kind, payload=None):
        return {"config/area_registry/list": self.areas, "config/floor_registry/list": [],
                "config/device_registry/list": self.devices, "config/entity_registry/list": []}[kind]


async def test_devices_of_a_room_by_name_or_english_word_and_a_hint_when_it_has_none():
    registry = HARegistry(HAClient(URL, "t"), FakeRegistryWS())
    for area in ("Küche", "kitchen", "kuche"):
        result = await registry.find_devices(area)
        assert result["devices"] == [] and result["area_id"] == "kuche"
        assert "ha_list_area_entities" in result["hint"]
    with pytest.raises(ValueError, match="unknown area 'Garage'"):
        await registry.find_devices("Garage")
    plug = {"id": "d1", "name": "Plug", "area_id": "kuche"}
    found = await HARegistry(HAClient(URL, "t"), FakeRegistryWS([plug])).find_devices("Küche")
    assert [d["device_id"] for d in found] == ["d1"]
    assert await registry.find_devices("none") == []


async def test_a_room_can_be_named_in_english():
    registry = HARegistry(HAClient(URL, "t"), FakeRegistryWS())
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[]))
        result = await registry.list_area_entities("living room")
    assert result["area_id"] == "wohnzimmer"
