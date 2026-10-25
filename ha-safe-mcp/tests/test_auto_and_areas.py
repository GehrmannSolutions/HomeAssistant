"""Auto mode per level ("enabled" = run without approval card), several entities per call, entities by area."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import Settings, SettingsStore, SetupError, merge_settings
from ha_safe_mcp.ollama_client import write_level
from ha_safe_mcp.registry import HARegistry
from ha_safe_mcp.server import HAClient

# these tests check the German messages (the UI language German); English is covered in test_i18n.py
pytestmark = pytest.mark.usefixtures("german")

TOKEN = "t" * 40
URL = "http://ha:8123"


def payload(**changes):
    return {"ha_url": "http://127.0.0.1:8123", "token": TOKEN, "ollama_url": "http://127.0.0.1:11434",
            "ollama_model": "qwen3-coder:30b", **changes}


# ---------------------------------------------------------------- settings
def test_auto_switches_need_the_matching_allow_switch():
    with pytest.raises(SetupError, match="Steuern"):
        merge_settings(Settings(), payload(auto_write=True))
    with pytest.raises(SetupError, match="Konfiguration"):
        merge_settings(Settings(), payload(allow_write=True, auto_admin_write=True))
    with pytest.raises(SetupError, match="Löschen"):
        merge_settings(Settings(), payload(allow_write=True, allow_admin_write=True, auto_delete=True))
    settings = merge_settings(Settings(), payload(allow_write=True, auto_write=True))
    assert settings.auto_levels() == {"control"}
    assert "HA_AUTO_WRITE" not in settings.mcp_env()


def test_auto_switches_are_saved_loaded_and_shown(tmp_path):
    store = SettingsStore(tmp_path / ".env")
    store.save(merge_settings(Settings(), payload(allow_write=True, allow_admin_write=True, auto_write=True)))
    loaded = store.load()
    assert (loaded.auto_write, loaded.auto_admin_write, loaded.auto_delete) == (True, False, False)
    assert "HA_AUTO_WRITE=true" in store.path.read_text()
    assert loaded.public()["auto_write"] is True


def test_turning_a_level_off_also_turns_its_auto_mode_off():
    on = merge_settings(Settings(), payload(allow_write=True, auto_write=True))
    off = merge_settings(on, payload(allow_write=False))
    assert off.auto_write is False


def test_capped_store_ignores_auto_above_the_cap(tmp_path):
    path = tmp_path / ".env"
    path.write_text(f"HA_URL=http://192.0.2.2:8123\nHA_TOKEN={TOKEN}\nHA_ALLOW_WRITE=true\nHA_AUTO_WRITE=true\n"
                    "HA_ALLOW_ADMIN_WRITE=true\nHA_AUTO_ADMIN_WRITE=true\n")
    assert SettingsStore(path, max_level="control").load().auto_levels() == {"control"}
    assert SettingsStore(path, max_level="read").load().auto_levels() == set()


# ---------------------------------------------------------------- levels and chat runs
def test_every_write_tool_has_a_level():
    from ha_safe_mcp.ollama_client import WRITE_TOOLS
    assert {write_level(name) for name in WRITE_TOOLS} <= {"control", "admin", "delete"}
    assert write_level("ha_call_service") == "control" and write_level("ha_activate_scene") == "control"
    assert write_level("ha_save_automation") == "admin" and write_level("ha_rest_write") == "admin"
    assert write_level("ha_delete_area") == "delete" and write_level("ha_rest_delete") == "delete"
    assert write_level("ha_get_state") is None


async def test_enabled_level_runs_without_card_and_is_still_shown():
    async def runner(settings, prompt, history, allow_write, approve, on_event):
        first = await approve("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.a"})
        return f"auto={first}"

    settings = Settings(ha_token=TOKEN, allow_write=True, auto_write=True)
    run = RunManager(runner).start(settings, "an", [], allow_write=True)
    await run.task
    kinds = [event["type"] for event in run.events]
    assert "approval_required" not in kinds and "auto_approved" in kinds
    auto = next(event for event in run.events if event["type"] == "auto_approved")
    assert auto["name"] == "ha_call_service" and auto["level"] == "control"
    assert run.events[-2]["content"] == "auto=True"


async def test_levels_without_auto_still_need_the_card_and_the_chat_checkbox_still_counts():
    import asyncio

    async def runner(settings, prompt, history, allow_write, approve, on_event):
        return str(await approve("ha_save_automation", {"automation_id": "x"}))

    settings = Settings(ha_token=TOKEN, allow_write=True, allow_admin_write=True, auto_write=True)
    manager = RunManager(runner, approval_timeout=0.05)
    run = manager.start(settings, "speichern", [], allow_write=True)
    await run.task
    assert "approval_required" in [event["type"] for event in run.events]
    assert run.events[-2]["content"] == "False"
    blocked = manager.start(Settings(ha_token=TOKEN, allow_write=True, auto_write=True), "an", [], allow_write=False)

    async def control(settings, prompt, history, allow_write, approve, on_event):
        return str(await approve("ha_call_service", {}))
    manager.runner = control
    await asyncio.sleep(0)
    await blocked.task
    third = manager.start(Settings(ha_token=TOKEN, allow_write=True, auto_write=True), "an", [], allow_write=False)
    await third.task
    assert third.events[-2]["content"] == "False"


# ---------------------------------------------------------------- several entities per call
async def test_one_call_can_switch_several_entities_of_the_same_domain():
    with respx.mock(base_url=URL) as router:
        route = router.post("/api/services/light/turn_on").mock(return_value=httpx.Response(200, json=[]))
        client = HAClient(URL, "secret", allow_write=True)
        await client.call_service("light", "turn_on", ["light.a", "light.b"], {"brightness": 100})
    assert json.loads(route.calls[0].request.content) == {"entity_id": ["light.a", "light.b"], "brightness": 100}


async def test_several_entities_are_checked_one_by_one_and_capped():
    with respx.mock(base_url=URL) as router:
        client = HAClient(URL, "secret", allow_write=True)
        with pytest.raises(ValueError, match="must match"):
            await client.call_service("light", "turn_on", ["light.a", "switch.b"])
        with pytest.raises(ValueError, match="at most"):
            await client.call_service("light", "turn_on", [f"light.l{i}" for i in range(21)])
        with pytest.raises(ValueError):
            await client.call_service("light", "turn_on", [])
    assert not router.calls


# ---------------------------------------------------------------- entities by area
class AreaWS:
    async def command(self, kind, payload=None):
        return {
            "config/area_registry/list": [{"area_id": "wohnzimmer", "name": "Wohnzimmer", "aliases": ["Stube"]},
                                          {"area_id": "kuche", "name": "Küche", "aliases": []}],
            "config/device_registry/list": [{"id": "d1", "area_id": "wohnzimmer"}, {"id": "d2", "area_id": "kuche"}],
            "config/entity_registry/list": [
                {"entity_id": "light.stehlampe_1", "device_id": "d1", "area_id": None},
                {"entity_id": "light.stehlampe_2", "device_id": "d1", "area_id": None},
                {"entity_id": "light.leinwand", "device_id": "d2", "area_id": "wohnzimmer"},
                {"entity_id": "light.kuche", "device_id": "d2", "area_id": None},
                {"entity_id": "sensor.temp", "device_id": "d1", "area_id": None},
                {"entity_id": "light.alt", "device_id": "d1", "area_id": None, "disabled_by": "user"}],
        }[kind]


STATES = [
    {"entity_id": "light.stehlampe_1", "state": "off", "attributes": {"friendly_name": "Stehlampe 1"}},
    {"entity_id": "light.stehlampe_2", "state": "on", "attributes": {"friendly_name": "Stehlampe 2"}},
    {"entity_id": "light.leinwand", "state": "unavailable", "attributes": {"friendly_name": "Leinwand"}},
    {"entity_id": "light.kuche", "state": "off", "attributes": {"friendly_name": "Küche"}},
    {"entity_id": "sensor.temp", "state": "21", "attributes": {"friendly_name": "Temperatur"}},
    {"entity_id": "light.wohnzimmer_alle", "state": "off",
     "attributes": {"friendly_name": "Wohnzimmer Alle", "entity_id": ["light.stehlampe_1", "light.stehlampe_2"]}},
]


async def test_area_entities_follow_device_areas_and_mark_unavailable():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = await HARegistry(HAClient(URL, "t"), AreaWS()).list_area_entities("wohnzimmer", "light")
    assert result["area_id"] == "wohnzimmer"
    assert [e["entity_id"] for e in result["entities"]] == ["light.leinwand", "light.stehlampe_1", "light.stehlampe_2"]
    assert result["available"] == ["light.stehlampe_1", "light.stehlampe_2"]
    assert result["unavailable"] == ["light.leinwand"]
    assert all("disabled" not in e["entity_id"] for e in result["entities"])


async def test_area_can_be_named_by_name_or_alias_and_unknown_areas_list_the_choices():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        registry = HARegistry(HAClient(URL, "t"), AreaWS())
        assert (await registry.list_area_entities("Stube", "light"))["area_id"] == "wohnzimmer"
        assert (await registry.list_area_entities("küche"))["area_id"] == "kuche"
        with pytest.raises(ValueError, match="Wohnzimmer"):
            await registry.list_area_entities("Dachboden")


async def test_groups_whose_members_are_in_the_area_are_reported_but_not_doubled():
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))
        result = await HARegistry(HAClient(URL, "t"), AreaWS()).list_area_entities("wohnzimmer", "light")
    assert result["groups"] == [{"entity_id": "light.wohnzimmer_alle", "name": "Wohnzimmer Alle",
                                 "members": ["light.stehlampe_1", "light.stehlampe_2"]}]
    assert "light.wohnzimmer_alle" not in result["available"]


async def test_restore_always_needs_the_card_and_the_card_carries_its_details():
    async def runner(settings, prompt, history, allow_write, approve, on_event):
        return str(await approve("ha_restore_backup", {"backup_id": "aaaa1111"},
                                 details={"backup": {"name": "Alt", "date": "2026-10-20T10:00:00+00:00"}}))

    settings = Settings(ha_token=TOKEN, allow_write=True, allow_admin_write=True, allow_delete=True,
                        auto_write=True, auto_admin_write=True, auto_delete=True)
    manager = RunManager(runner, approval_timeout=0.05)
    run = manager.start(settings, "restore", [], allow_write=True)
    await run.task
    kinds = [event["type"] for event in run.events]
    assert "auto_approved" not in kinds and "approval_required" in kinds
    card = next(event for event in run.events if event["type"] == "approval_required")
    assert card["details"]["backup"]["name"] == "Alt"
    assert run.events[-2]["content"] == "False"  # timed out = rejected
