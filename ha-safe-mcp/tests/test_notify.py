"""Test notifications: a message to a person's phone (mobile app) or another notify service, resolved for the model."""
import asyncio
import json

import httpx
import pytest
import respx

from ha_safe_mcp.notify import HANotify, slug
from ha_safe_mcp.server import HAClient, create_server

URL = "http://ha:8123"
SERVICES = [{"domain": "notify", "services": {"mobile_app_alex_phone": {}, "mobile_app_iphone_von_jana": {},
                                              "persistent_notification": {}, "send_message": {}, "notify": {}}},
            {"domain": "light", "services": {"turn_on": {}}}]
STATES = [{"entity_id": "person.alex", "state": "home",
           "attributes": {"friendly_name": "Alex", "device_trackers": ["device_tracker.alex_phone"]}},
          {"entity_id": "person.jana", "state": "not_home",
           "attributes": {"friendly_name": "Jana", "device_trackers": ["device_tracker.iphone_von_jana",
                                                                       "device_tracker.router_jana"]}},
          {"entity_id": "person.gast", "state": "unknown", "attributes": {"friendly_name": "Gast",
                                                                          "device_trackers": []}},
          {"entity_id": "notify.signal_gruppe", "state": "unknown", "attributes": {"friendly_name": "Signal Gruppe"}}]


class FakeWS:
    async def command(self, kind, payload=None, **_):
        if kind == "config/entity_registry/list":
            return [{"entity_id": "device_tracker.alex_phone", "platform": "mobile_app", "device_id": "d1"},
                    {"entity_id": "device_tracker.iphone_von_jana", "platform": "mobile_app", "device_id": "d2"},
                    {"entity_id": "device_tracker.router_jana", "platform": "unifi", "device_id": "d3"}]
        if kind == "config/device_registry/list":
            return [{"id": "d1", "name": "Alex Phone", "name_by_user": "Alex Handy"},
                    {"id": "d2", "name": "iPhone von Jana", "name_by_user": None},
                    {"id": "d3", "name": "Router", "name_by_user": None}]
        raise AssertionError(kind)


def make(domains=("notify",), write=True):
    return HANotify(HAClient(URL, "secret-token", allow_write=write, allowed_domains=frozenset(domains)), FakeWS())


def routes(router):
    router.get("/api/services").mock(return_value=httpx.Response(200, json=SERVICES))
    router.get("/api/states").mock(return_value=httpx.Response(200, json=STATES))


def test_slug_matches_home_assistant_for_umlauts_and_spaces():
    assert slug("iPhone von Jänä") == "iphone_von_jana"
    assert slug("Straße 9 ") == "strasse_9"


async def test_targets_list_persons_with_their_phones_and_other_services():
    with respx.mock(base_url=URL) as router:
        routes(router)
        result = await make().targets()
    persons = {p["person"]: p["services"] for p in result["persons"]}
    assert persons == {"Alex": ["notify.mobile_app_alex_phone"], "Jana": ["notify.mobile_app_iphone_von_jana"],
                       "Gast": []}
    assert "notify.persistent_notification" in result["other_services"]
    assert "notify.send_message" not in result["other_services"] and "notify.notify" not in result["other_services"]
    assert result["notify_entities"] == ["notify.signal_gruppe"]


async def test_send_to_a_person_by_name_reaches_the_phone():
    with respx.mock(base_url=URL) as router:
        routes(router)
        sent = router.post("/api/services/notify/mobile_app_alex_phone").mock(return_value=httpx.Response(200, json=[]))
        result = await make().send("alex", "Test message", title="Test")
    assert json.loads(sent.calls[0].request.content) == {"message": "Test message", "title": "Test"}
    assert result["sent_to"] == ["notify.mobile_app_alex_phone"] and result["person"] == "Alex"
    assert "phone" in result["note"]


async def test_send_to_a_service_name_or_a_notify_entity():
    with respx.mock(base_url=URL) as router:
        routes(router)
        legacy = router.post("/api/services/notify/persistent_notification").mock(
            return_value=httpx.Response(200, json=[]))
        entity = router.post("/api/services/notify/send_message").mock(return_value=httpx.Response(200, json=[]))
        await make().send("notify.persistent_notification", "Hallo")
        await make().send("Signal Gruppe", "Hallo", title="T")
    assert legacy.called
    assert json.loads(entity.calls[0].request.content) == {"entity_id": "notify.signal_gruppe", "message": "Hallo",
                                                           "title": "T"}


async def test_a_person_without_phone_or_an_unknown_target_names_the_choices():
    with respx.mock(base_url=URL) as router:
        routes(router)
        with pytest.raises(ValueError, match="no phone with the Home Assistant app") as error:
            await make().send("Gast", "x")
        assert "Alex" in str(error.value)
        with pytest.raises(ValueError, match="ha_list_notification_targets"):
            await make().send("Oma", "x")


async def test_send_needs_writes_and_the_notify_domain_and_binds_the_target():
    with pytest.raises(ValueError, match="Writes are disabled"):
        await make(write=False).send("Alex", "x")
    with pytest.raises(ValueError, match="'notify'"):
        await make(domains=("light",)).send("Alex", "x")
    with pytest.raises(ValueError, match="message"):
        await make().send("Alex", "  ")
    with pytest.raises(ValueError, match="target"):
        await make().send("Alex", "x", data={"target": ["other"]})


async def test_home_assistant_errors_come_back_with_a_next_step():
    with respx.mock(base_url=URL) as router:
        routes(router)
        router.post("/api/services/notify/mobile_app_alex_phone").mock(
            return_value=httpx.Response(400, json={"message": "Device not connected to local push notifications"}))
        with pytest.raises(RuntimeError, match="local push notifications") as error:
            await make().send("Alex", "x")
    assert "notifications are allowed" in str(error.value)


def test_notification_tools_are_registered_with_their_levels():
    from ha_safe_mcp.ollama_client import write_level
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_send_notification", "ha_list_notification_targets"} <= names
    assert write_level("ha_send_notification") == "control"
    assert write_level("ha_list_notification_targets") is None
