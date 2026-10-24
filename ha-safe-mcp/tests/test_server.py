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


@pytest.mark.asyncio
async def test_search_is_compact_for_small_models():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "light.desk", "state": "on", "attributes": {"friendly_name": "Desk Lamp", "huge_blob": "x" * 10000}}
        ]))
        result = await HAClient("http://ha:8123", "secret").search_entities("desk")
        assert result == [{"entity_id": "light.desk", "state": "on", "friendly_name": "Desk Lamp"}]


@pytest.mark.asyncio
async def test_list_services_filters_domain_and_omits_large_descriptions():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/services").mock(return_value=httpx.Response(200, json=[
            {"domain": "light", "services": {"turn_on": {"description": "x" * 10000}}},
            {"domain": "switch", "services": {"turn_off": {}}},
        ]))
        result = await HAClient("http://ha:8123", "secret").list_services("light")
        assert result == [{"domain": "light", "services": ["turn_on"]}]


@pytest.mark.asyncio
async def test_service_can_request_documented_response_data():
    with respx.mock(base_url="http://ha:8123") as router:
        router.post("/api/services/weather/get_forecasts?return_response").mock(return_value=httpx.Response(200, json={"changed_states": [], "service_response": {"forecast": []}}))
        client = HAClient("http://ha:8123", "secret", allow_write=True,
                          allowed_domains=frozenset({"weather"}))
        result = await client.call_service("weather", "get_forecasts", "weather.home", {"type": "daily"}, return_response=True)
        assert "service_response" in result


def test_mcp_tools_are_registered():
    server = create_server(HAClient("http://ha:8123", "secret"))
    import asyncio
    names = {tool.name for tool in asyncio.run(server.list_tools())}
    assert {"ha_search_entities", "ha_get_state", "ha_list_services", "ha_call_service", "ha_rest_catalog", "ha_rest_query", "ha_rest_write", "ha_rest_delete", "ha_validate_automation", "ha_get_automation", "ha_save_automation", "ha_delete_automation", "ha_list_dashboards", "ha_get_dashboard", "ha_create_dashboard", "ha_save_dashboard", "ha_update_dashboard", "ha_delete_dashboard", "ha_list_helpers", "ha_create_helper", "ha_update_helper", "ha_delete_helper", "ha_list_entity_registry", "ha_update_entity_registry"} <= names


def test_helper_id_schema_tells_the_model_the_exact_id_format():
    """A small model passed the display name 'Testschalter' as helper_id; the schema must say what an ID is."""
    import asyncio
    import jsonschema
    tools = {tool.name: tool for tool in asyncio.run(create_server(HAClient("http://ha:8123", "secret")).list_tools())}
    for name in ("ha_update_helper", "ha_delete_helper"):
        prop = tools[name].inputSchema["properties"]["helper_id"]
        assert "ha_list_helpers" in prop.get("description", ""), name
        jsonschema.validate("testschalter", prop)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate("Testschalter", prop)


INTEGRATION_TOOLS = {"ha_list_integrations", "ha_list_integration_types", "ha_list_discovered", "ha_list_credentials",
                     "ha_start_integration_setup", "ha_integration_setup_step", "ha_abort_integration_setup",
                     "ha_reload_integration", "ha_delete_integration"}


def test_integration_tools_are_registered_and_describe_their_limits():
    import asyncio
    tools = {tool.name: tool for tool in asyncio.run(create_server(HAClient("http://ha:8123", "secret")).list_tools())}
    assert INTEGRATION_TOOLS <= tools.keys()
    assert "netzwerk" in tools["ha_list_discovered"].description.lower() or "network" in tools["ha_list_discovered"].description.lower()
    assert "$credential" in tools["ha_integration_setup_step"].description
    flow_id = tools["ha_integration_setup_step"].inputSchema["properties"]["flow_id"]
    assert flow_id.get("pattern") == "^(?:[0-9a-f]{32}|[0-9A-HJKMNP-TV-Z]{26})$"


def test_server_uses_the_credential_dir_from_the_environment(tmp_path, monkeypatch):
    from ha_safe_mcp import server as server_module
    monkeypatch.setenv("HA_CREDENTIALS_DIR", str(tmp_path / "creds"))
    assert server_module.credential_store_from_env().directory == tmp_path / "creds"
