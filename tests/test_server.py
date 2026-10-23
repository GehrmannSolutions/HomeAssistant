import httpx
import pytest
import respx

from ha_safe_mcp.server import HAClient, create_server


@pytest.mark.asyncio
async def test_search_and_read_state():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "light.desk", "state": "on", "attributes": {"friendly_name": "Desk Lamp"}},
            {"entity_id": "sensor.temp", "state": "21", "attributes": {"friendly_name": "Temperature"}},
        ]))
        router.get("/api/states/light.desk").mock(return_value=httpx.Response(200, json={"entity_id": "light.desk", "state": "on"}))
        client = HAClient("http://ha:8123", "secret")
        assert [x["entity_id"] for x in await client.search_entities("desk")] == ["light.desk"]
        assert (await client.get_state("light.desk"))["state"] == "on"
        assert router.calls[0].request.headers["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_write_is_disabled_by_default():
    with respx.mock(base_url="http://ha:8123") as router:
        client = HAClient("http://ha:8123", "secret")
        with pytest.raises(ValueError, match="disabled"):
            await client.call_service("light", "turn_on", "light.desk", {})
        assert not router.calls


@pytest.mark.asyncio
async def test_write_requires_allowed_domain_and_entity_match():
    with respx.mock(base_url="http://ha:8123") as router:
        client = HAClient("http://ha:8123", "secret", allow_write=True)
        with pytest.raises(ValueError, match="not allowed"):
            await client.call_service("lock", "unlock", "lock.front", {})
        with pytest.raises(ValueError, match="must match"):
            await client.call_service("light", "turn_on", "switch.desk", {})
        with pytest.raises(ValueError, match="invalid"):
            await client.call_service("light", "turn_on", "light.desk/../x", {})
        assert not router.calls


@pytest.mark.asyncio
async def test_allowed_service_posts_and_returns_ha_result():
    with respx.mock(base_url="http://ha:8123") as router:
        route = router.post("/api/services/light/turn_on").mock(return_value=httpx.Response(200, json=[{"entity_id": "light.desk", "state": "on"}]))
        client = HAClient("http://ha:8123", "secret", allow_write=True)
        result = await client.call_service("light", "turn_on", "light.desk", {"brightness": 120})
        assert result[0]["state"] == "on"
        assert route.calls[0].request.content == b'{"entity_id":"light.desk","brightness":120}'


@pytest.mark.asyncio
async def test_errors_do_not_expose_token():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/states").mock(return_value=httpx.Response(401, text="secret token leaked"))
        client = HAClient("http://ha:8123", "secret")
        with pytest.raises(RuntimeError, match="401") as error:
            await client.search_entities("")
        assert "secret" not in str(error.value)


def test_mcp_tools_are_registered():
    server = create_server(HAClient("http://ha:8123", "secret"))
    import asyncio
    names = {tool.name for tool in asyncio.run(server.list_tools())}
    assert {"ha_search_entities", "ha_get_state", "ha_list_services", "ha_call_service"} <= names
