"""Custom events (admin level, no faked system events) and service responses."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp import server as server_module
from ha_safe_mcp.server import HAClient, create_server
from ha_safe_mcp.system import HASystem

URL = "http://ha:8123"


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(server_module, "READ_BACK_DELAYS", (0, 0, 0))


def parse(result):
    if isinstance(result, tuple):
        result = result[1] or result[0]
    if isinstance(result, dict):
        return result.get("result", result)
    return json.loads(result[0].text)


async def test_custom_events_are_fired_with_data():
    system = HASystem(HAClient(URL, "t", allow_write=True), None, allow_admin_write=True)
    with respx.mock(base_url=URL) as router:
        fired = router.post("/api/events/doorbell_pressed").mock(return_value=httpx.Response(200, json={
            "message": "Event doorbell_pressed fired."}))
        assert await system.fire_event("doorbell_pressed", {"door": "front"}) == {"fired": "doorbell_pressed"}
    assert json.loads(fired.calls[0].request.content) == {"door": "front"}


async def test_system_events_bad_names_big_data_and_gates_are_refused():
    system = HASystem(HAClient(URL, "t", allow_write=True), None, allow_admin_write=True)
    for name in ("state_changed", "homeassistant_start", "call_service", "Bad-Name", "", "x" * 70):
        with pytest.raises(ValueError):
            await system.fire_event(name)
    with pytest.raises(ValueError, match="data"):
        await system.fire_event("my_event", {"blob": "x" * 5000})
    with pytest.raises(ValueError, match="admin write disabled"):
        await HASystem(HAClient(URL, "t", allow_write=True), None).fire_event("my_event")


async def test_service_response_is_returned_with_the_read_back():
    server = create_server(HAClient(URL, "t", allow_write=True, allowed_domains=frozenset({"todo"})))
    with respx.mock(base_url=URL) as router:
        call = router.post("/api/services/todo/get_items").mock(return_value=httpx.Response(200, json={
            "changed_states": [], "service_response": {"todo.einkauf": {"items": [{"summary": "Milch"}]}}}))
        router.get("/api/states/todo.einkauf").mock(return_value=httpx.Response(200, json={
            "entity_id": "todo.einkauf", "state": "1", "attributes": {}}))
        result = parse(await server.call_tool("ha_call_service", {
            "domain": "todo", "service": "get_items", "entity_id": "todo.einkauf", "return_response": True}))
    assert dict(call.calls[0].request.url.params) == {"return_response": ""}
    assert result["service_response"] == {"todo.einkauf": {"items": [{"summary": "Milch"}]}}
    assert result["states_after"][0]["state"] == "1"


def test_fire_event_level_and_topic():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS, WRITE_TOOLS, select_tool_names
    from ha_safe_mcp.remote import tool_level
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert "ha_fire_event" in names & WRITE_TOOLS and "ha_fire_event" not in READ_TOOLS
    assert tool_level("ha_fire_event") == "admin"
    assert "ha_fire_event" in select_tool_names("Feuere das Event klingel_gedrueckt", names, allow_write=True)
