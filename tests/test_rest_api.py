import base64

import httpx
import pytest
import respx

from ha_safe_mcp.rest_api import RestGateway
from ha_safe_mcp.server import HAClient


def gateway(*, write=False, admin=False, delete=False):
    return RestGateway(HAClient("http://ha:8123", "secret", allow_write=write),
                       allow_admin_write=admin, allow_delete=delete)


def test_catalog_contains_every_documented_rest_route():
    routes = {(item["method"], item["path"]) for item in gateway().catalog()}
    assert len(routes) == 20
    assert ("GET", "/api/camera_proxy/<camera_entity_id>") in routes
    assert ("POST", "/api/services/<domain>/<service>") in routes
    assert ("DELETE", "/api/states/<entity_id>") in routes


@pytest.mark.asyncio
async def test_read_config_and_history_query():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/config").mock(return_value=httpx.Response(200, json={"version": "test"}))
        router.get("/api/history/period").mock(return_value=httpx.Response(200, json=[[{"state": "on"}]]))
        api = gateway()
        result = await api.request("GET", "/api/config")
        assert result["data"] == {"version": "test"}
        history = await api.request("GET", "/api/history/period", query={"filter_entity_id": "light.desk", "minimal_response": ""})
        assert history["data"][0][0]["state"] == "on"
        assert "filter_entity_id=light.desk" in str(router.calls[-1].request.url)
        assert router.calls[0].request.headers["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_binary_camera_is_bounded_and_encoded():
    with respx.mock(base_url="http://ha:8123") as router:
        router.get("/api/camera_proxy/camera.front").mock(return_value=httpx.Response(200, content=b"\xff\xd8\x00", headers={"content-type": "image/jpeg"}))
        result = await gateway().request("GET", "/api/camera_proxy/camera.front")
        assert result["data_base64"] == base64.b64encode(b"\xff\xd8\x00").decode()
        assert result["content_type"] == "image/jpeg"


@pytest.mark.asyncio
async def test_unknown_routes_and_path_traversal_are_rejected_without_network():
    with respx.mock(base_url="http://ha:8123") as router:
        api = gateway(write=True, admin=True)
        for route in ("/api/auth", "/api/states/../config", "/api/states/%2e%2e", "/api/history/period/..", "https://evil/api/config", "/api/states/light.desk?x=1"):
            with pytest.raises(ValueError):
                await api.request("GET", route, query={"filter_entity_id": "light.desk"} if route.startswith("/api/history/") else None)
        assert not router.calls


@pytest.mark.asyncio
async def test_mutations_have_separate_gates_and_single_entity_service_policy():
    with respx.mock(base_url="http://ha:8123") as router:
        with pytest.raises(ValueError, match="disabled"):
            await gateway().request("POST", "/api/states/sensor.test", body={"state": "1"})
        with pytest.raises(ValueError, match="admin"):
            await gateway(write=True).request("POST", "/api/events/open_door", body={})
        with pytest.raises(ValueError, match="admin"):
            await gateway(write=True).request("POST", "/api/states/sensor.test", body={"state": "1"})
        with pytest.raises(ValueError, match="delete"):
            await gateway(write=True, admin=True).request("DELETE", "/api/states/sensor.test")
        with pytest.raises(ValueError, match="not allowed"):
            await gateway(write=True).request("POST", "/api/services/lock/unlock", body={"entity_id": "lock.front"})
        assert not router.calls


@pytest.mark.asyncio
async def test_safe_template_and_config_check_are_available_without_write():
    with respx.mock(base_url="http://ha:8123") as router:
        router.post("/api/template").mock(return_value=httpx.Response(200, text="21°C", headers={"content-type": "text/plain"}))
        router.post("/api/config/core/check_config").mock(return_value=httpx.Response(200, json={"result": "valid", "errors": None}))
        api = gateway()
        assert (await api.request("POST", "/api/template", body={"template": "{{ 21 }}°C"}))["data"] == "21°C"
        assert (await api.request("POST", "/api/config/core/check_config"))["data"]["result"] == "valid"
        assert len(router.calls) == 2


@pytest.mark.asyncio
async def test_allowed_single_target_service_uses_existing_boundary():
    with respx.mock(base_url="http://ha:8123") as router:
        router.post("/api/services/light/turn_on").mock(return_value=httpx.Response(200, json=[{"entity_id": "light.desk", "state": "on"}]))
        result = await gateway(write=True).request("POST", "/api/services/light/turn_on", body={"entity_id": "light.desk", "brightness": 100})
        assert result["data"][0]["state"] == "on"
        assert len(router.calls) == 1
