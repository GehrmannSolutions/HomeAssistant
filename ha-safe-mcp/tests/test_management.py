import json

import httpx
import pytest
import respx
from websockets.asyncio.server import serve

from ha_safe_mcp.management import HAWebSocket, HAAdmin
from ha_safe_mcp.server import HAClient


class FakeWS:
    def __init__(self):
        self.calls = []
        self.config = {"views": [{"title": "Old", "cards": []}]}
        self.helpers = {"guest_mode": {"id": "guest_mode", "name": "Guest mode"}}
        self.dashboards = [{"id": "energy_id", "url_path": "energy-house", "title": "Energy"}]
        self.registry = [{"entity_id": "input_boolean.guest_mode", "name": "Guest mode"}]

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "lovelace/config":
            return self.config
        if kind == "lovelace/config/save":
            self.config = payload["config"]
            return None
        if kind == "input_boolean/create":
            self.helpers["guest_mode"] = {"id": "guest_mode", **payload}
            return self.helpers["guest_mode"]
        if kind == "input_boolean/update":
            self.helpers[payload["input_boolean_id"]].update({k: v for k, v in payload.items() if k != "input_boolean_id"})
            return self.helpers[payload["input_boolean_id"]]
        if kind == "input_boolean/delete":
            self.helpers.pop(payload["input_boolean_id"])
            return None
        if kind == "input_boolean/list":
            return list(self.helpers.values())
        if kind == "lovelace/dashboards/list":
            return self.dashboards
        if kind == "lovelace/dashboards/update":
            self.dashboards[0].update({k: v for k, v in payload.items() if k != "dashboard_id"})
            return self.dashboards[0]
        if kind == "lovelace/dashboards/delete":
            self.dashboards.clear()
            return None
        if kind == "config/entity_registry/list":
            return self.registry
        if kind == "config/entity_registry/update":
            self.registry[0].update(payload)
            return self.registry[0]
        if kind == "config/entity_registry/get":
            return next((dict(e) for e in self.registry if e["entity_id"] == payload["entity_id"]), None)
        if kind == "validate_config":
            return {"triggers": {"valid": True}, "actions": {"valid": True}}
        return []


@pytest.mark.asyncio
async def test_automation_save_requires_admin_and_reads_back():
    config = {"alias": "Lights", "triggers": [{"trigger": "state", "entity_id": "binary_sensor.motion"}],
              "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.desk"}}]}
    with respx.mock(base_url="http://ha:8123") as router:
        router.post("/api/config/automation/config/lights_1").mock(return_value=httpx.Response(200, json={"result": "ok"}))
        router.get("/api/config/automation/config/lights_1").mock(return_value=httpx.Response(200, json={"id": "lights_1", **config}))
        client = HAClient("http://ha:8123", "secret", allow_write=True)
        with pytest.raises(ValueError, match="admin"):
            await HAAdmin(client, FakeWS()).automation_save("lights_1", config)
        result = await HAAdmin(client, FakeWS(), allow_admin_write=True).automation_save("lights_1", config)
        assert result["id"] == "lights_1"
        assert json.loads(router.calls[0].request.content) == config


@pytest.mark.asyncio
async def test_automation_validation_uses_websocket():
    ws = FakeWS()
    admin = HAAdmin(HAClient("http://ha:8123", "secret"), ws)
    result = await admin.automation_validate({"triggers": [], "actions": []})
    assert result["triggers"]["valid"]
    assert ws.calls == [("validate_config", {"triggers": [], "actions": []})]


@pytest.mark.asyncio
async def test_dashboard_save_reads_back_and_helper_creation_is_verified():
    ws = FakeWS()
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), ws, allow_admin_write=True)
    config = {"views": [{"title": "Energy", "cards": []}]}
    saved = await admin.dashboard_save(config, url_path="energy-house")
    assert saved["config"] == config
    assert saved["previous"]["views"][0]["title"] == "Old"
    helper = await admin.helper_create("input_boolean", {"name": "Guest mode"})
    assert helper["id"] == "guest_mode"
    assert ("input_boolean/create", {"name": "Guest mode"}) in ws.calls


@pytest.mark.asyncio
async def test_first_dashboard_save_allows_missing_previous_config():
    class FreshWS(FakeWS):
        async def command(self, kind, payload=None):
            if kind == "lovelace/config" and self.config is None:
                raise RuntimeError("Home Assistant WebSocket error: config_not_found")
            return await super().command(kind, payload)

    ws = FreshWS()
    ws.config = None
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), ws, allow_admin_write=True)
    result = await admin.dashboard_save({"views": []}, url_path="new-dashboard")
    assert result["previous"] is None
    assert result["config"] == {"views": []}


@pytest.mark.asyncio
async def test_admin_rejects_unlisted_helper_domain_and_malformed_dashboard():
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), FakeWS(), allow_admin_write=True)
    with pytest.raises(ValueError):
        await admin.helper_create("lock", {"name": "Front"})
    with pytest.raises(ValueError):
        await admin.dashboard_save({"cards": []})


@pytest.mark.asyncio
async def test_helper_update_and_delete_use_collection_id_and_verify_state():
    ws = FakeWS()
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), ws,
                    allow_admin_write=True, allow_delete=True)
    updated = await admin.helper_update("input_boolean", "guest_mode", {"name": "Guests"})
    assert updated["name"] == "Guests"
    assert ("input_boolean/update", {"input_boolean_id": "guest_mode", "name": "Guests"}) in ws.calls
    await admin.helper_delete("input_boolean", "guest_mode")
    assert ("input_boolean/delete", {"input_boolean_id": "guest_mode"}) in ws.calls
    assert await admin.helper_list("input_boolean") == []


@pytest.mark.asyncio
async def test_dashboard_metadata_update_delete_and_registry_update():
    ws = FakeWS()
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), ws,
                    allow_admin_write=True, allow_delete=True)
    updated = await admin.dashboard_update("energy_id", {"title": "New Energy"})
    assert updated["title"] == "New Energy"
    registry = await admin.entity_registry_update("input_boolean.guest_mode", {"name": "Visitors"})
    assert registry["name"] == "Visitors"
    assert await admin.dashboard_delete("energy_id") is None
    assert await admin.dashboard_list() == []


@pytest.mark.asyncio
async def test_delete_requires_separate_opt_in():
    admin = HAAdmin(HAClient("http://ha:8123", "secret", allow_write=True), FakeWS(), allow_admin_write=True)
    with pytest.raises(ValueError, match="delete"):
        await admin.helper_delete("input_boolean", "guest_mode")
    with pytest.raises(ValueError, match="delete"):
        await admin.dashboard_delete("energy_id")


@pytest.mark.asyncio
async def test_websocket_auth_and_validated_command_roundtrip():
    seen = []

    async def handler(ws):
        await ws.send(json.dumps({"type": "auth_required"}))
        seen.append(json.loads(await ws.recv()))
        await ws.send(json.dumps({"type": "auth_ok"}))
        seen.append(json.loads(await ws.recv()))
        await ws.send(json.dumps({"id": 1, "type": "result", "success": True, "result": {"valid": True}}))

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        ws = HAWebSocket(HAClient(f"http://127.0.0.1:{port}", "secret"))
        result = await ws.command("validate_config", {"trigger": []})
    assert result == {"valid": True}
    assert seen == [{"type": "auth", "access_token": "secret"}, {"id": 1, "type": "validate_config", "trigger": []}]


@pytest.mark.asyncio
async def test_websocket_failure_never_leaks_token_or_server_message():
    async def handler(ws):
        await ws.send(json.dumps({"type": "auth_required"}))
        await ws.recv()
        await ws.send(json.dumps({"type": "auth_ok"}))
        await ws.recv()
        await ws.send(json.dumps({"id": 1, "type": "result", "success": False, "error": {"code": "invalid_format", "message": "secret in server error"}}))

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        ws = HAWebSocket(HAClient(f"http://127.0.0.1:{port}", "secret"))
        with pytest.raises(RuntimeError, match="invalid_format") as error:
            await ws.command("validate_config", {"trigger": []})
    assert "secret" not in str(error.value)


@pytest.mark.asyncio
async def test_websocket_rejects_arbitrary_types_and_reserved_fields():
    ws = HAWebSocket(HAClient("http://127.0.0.1:8123", "secret"))
    with pytest.raises(ValueError, match="not allowed"):
        await ws.command("auth/revoke", {})
    with pytest.raises(ValueError, match="reserved"):
        await ws.command("validate_config", {"id": 99})


@pytest.mark.asyncio
async def test_current_user_reports_only_name_and_admin_flags():
    async def handler(ws):
        await ws.send(json.dumps({"type": "auth_required"}))
        await ws.recv()
        await ws.send(json.dumps({"type": "auth_ok"}))
        assert json.loads(await ws.recv())["type"] == "auth/current_user"
        await ws.send(json.dumps({"id": 1, "type": "result", "success": True, "result": {
            "id": "abc123", "name": "Alex", "is_owner": True, "is_admin": True,
            "credentials": [{"auth_provider_type": "homeassistant"}], "mfa_modules": []}}))

    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        admin = HAAdmin(HAClient(f"http://127.0.0.1:{port}", "secret"))
        user = await admin.current_user()
    assert user == {"name": "Alex", "is_owner": True, "is_admin": True}
