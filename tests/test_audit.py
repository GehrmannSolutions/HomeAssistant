"""GDPR-minded audit log of MCP <-> Home Assistant traffic: metadata only, 30-day retention, deletable."""
import json
import stat
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx

from ha_safe_mcp.audit import AuditLog, route_template
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)


def clock(moment):
    return lambda: moment


@pytest.mark.parametrize("path, expected", [
    ("/api/states/person.alex", "/api/states/{entity_id}"),
    ("/api/states/light.wohnzimmer?x=1", "/api/states/{entity_id}"),
    ("/api/services/light/turn_on?return_response", "/api/services/light/turn_on"),
    ("/api/config/automation/config/garten_licht", "/api/config/automation/config/{id}"),
    ("/api/config/config_entries/flow/01M5PJ0000000000000000000A", "/api/config/config_entries/flow/{id}"),
    ("/api/config/config_entries/entry/abc123/reload", "/api/config/config_entries/entry/{id}/reload"),
    ("/api/history/period/2026-10-24T00:00:00", "/api/history/period/{id}"),
    ("/api/camera_proxy/camera.haustuer", "/api/camera_proxy/{entity_id}"),
])
def test_routes_are_reduced_to_templates_without_personal_identifiers(path, expected):
    assert route_template(path) == expected


def test_records_are_metadata_only_and_files_are_private(tmp_path):
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    log.record(kind="ha", tool="ha_get_state", channel="rest", method="GET",
               route="/api/states/person.alex", status=200, ok=True, ms=12.3456)
    [entry] = log.entries()
    assert entry == {"ts": "2026-10-24T12:00:00Z", "kind": "ha", "tool": "ha_get_state", "channel": "rest",
                     "method": "GET", "route": "/api/states/{entity_id}", "status": 200, "ok": True, "ms": 12}
    assert stat.S_IMODE((tmp_path / "audit").stat().st_mode) == 0o700
    [path] = (tmp_path / "audit").iterdir()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert "alex" not in path.read_text()


def test_unknown_fields_and_free_text_are_dropped(tmp_path):
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    log.record(kind="ha", tool="ha_call_service", channel="rest", method="POST", route="/api/services/light/turn_on",
               status=200, ok=True, ms=1, body={"entity_id": "light.x"}, prompt="Schalte Alex' Licht")
    log.record(kind="tool", tool="ha_get_state", ok=False, ms=3, error="RuntimeError: person.alex not found")
    entries = log.entries()
    assert all("body" not in entry and "prompt" not in entry for entry in entries)
    assert entries[0]["error"] == "RuntimeError" and "alex" not in json.dumps(entries)


def test_entries_older_than_30_days_are_purged(tmp_path):
    directory = tmp_path / "audit"
    AuditLog(directory, now=clock(NOW - timedelta(days=31))).record(kind="tool", tool="ha_get_state", ok=True, ms=1)
    AuditLog(directory, now=clock(NOW - timedelta(days=29))).record(kind="tool", tool="ha_list_helpers", ok=True, ms=1)
    log = AuditLog(directory, now=clock(NOW))
    log.record(kind="tool", tool="ha_search_entities", ok=True, ms=1)
    assert [entry["tool"] for entry in log.entries()] == ["ha_search_entities", "ha_list_helpers"]
    assert len(list(directory.iterdir())) == 2


def test_clear_deletes_every_record(tmp_path):
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    log.record(kind="tool", tool="ha_get_state", ok=True, ms=1)
    assert log.clear() == 1
    assert log.entries() == [] and list((tmp_path / "audit").iterdir()) == []


def test_foreign_files_in_the_directory_are_ignored_and_kept(tmp_path):
    directory = tmp_path / "audit"
    log = AuditLog(directory, now=clock(NOW))
    directory.mkdir()
    (directory / "notes.txt").write_text("keep me")
    log.record(kind="tool", tool="ha_get_state", ok=True, ms=1)
    log.clear()
    assert (directory / "notes.txt").read_text() == "keep me"


async def test_ha_client_logs_each_request_with_tool_name_and_status(tmp_path):
    from ha_safe_mcp.audit import current_tool
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    client = HAClient(URL, "token", audit=log)
    token = current_tool.set("ha_get_state")
    try:
        with respx.mock(base_url=URL) as router:
            router.get("/api/states/person.alex").mock(return_value=httpx.Response(200, json={"state": "home"}))
            router.get("/api/states/person.nobody").mock(return_value=httpx.Response(404))
            await client.get_state("person.alex")
            with pytest.raises(RuntimeError):
                await client.get_state("person.nobody")
    finally:
        current_tool.reset(token)
    newest, oldest = log.entries()
    assert oldest["tool"] == "ha_get_state" and oldest["status"] == 200 and oldest["ok"] is True
    assert newest["status"] == 404 and newest["ok"] is False
    assert newest["route"] == "/api/states/{entity_id}" and "home" not in json.dumps(log.entries())


async def test_failing_audit_never_breaks_the_home_assistant_call(tmp_path):
    class Broken:
        def record(self, **_):
            raise OSError("disk full")

    client = HAClient(URL, "token", audit=Broken())
    with respx.mock(base_url=URL) as router:
        router.get("/api/states/light.x").mock(return_value=httpx.Response(200, json={"state": "on"}))
        assert (await client.get_state("light.x"))["state"] == "on"


async def test_mcp_tool_calls_are_tagged_and_logged_once_per_tool(tmp_path):
    from ha_safe_mcp.server import create_server
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    server = create_server(HAClient(URL, "token", audit=log))
    with respx.mock(base_url=URL) as router:
        router.get("/api/states/light.flur").mock(return_value=httpx.Response(200, json={"state": "on"}))
        await server.call_tool("ha_get_state", {"entity_id": "light.flur"})
    tool, ha = log.entries()
    tool.pop("ms")
    assert tool == {"ts": "2026-10-24T12:00:00Z", "kind": "tool", "tool": "ha_get_state", "ok": True}
    assert ha["kind"] == "ha" and ha["tool"] == "ha_get_state" and ha["route"] == "/api/states/{entity_id}"


async def test_rest_gateway_requests_are_logged_as_templates(tmp_path):
    from ha_safe_mcp.rest_api import RestGateway
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    gateway = RestGateway(HAClient(URL, "token", audit=log))
    with respx.mock(base_url=URL) as router:
        router.get("/api/history/period/2026-10-24T00:00:00Z").mock(return_value=httpx.Response(200, json=[]))
        await gateway.request("GET", "/api/history/period/2026-10-24T00:00:00Z",
                              query={"filter_entity_id": "person.alex"})
    [entry] = log.entries()
    assert entry["route"] == "/api/history/period/{id}" and entry["status"] == 200
    assert "alex" not in json.dumps(entry)


def test_mcp_server_reads_audit_settings_from_the_environment(tmp_path, monkeypatch):
    from ha_safe_mcp.audit import audit_from_env
    monkeypatch.setenv("HA_AUDIT_DIR", str(tmp_path / "x"))
    assert audit_from_env().directory == tmp_path / "x"
    monkeypatch.setenv("HA_AUDIT", "false")
    assert audit_from_env() is None


async def test_websocket_commands_are_logged_by_type_only(tmp_path, monkeypatch):
    from ha_safe_mcp import management

    class FakeSocket:
        def __init__(self):
            self.replies = [{"type": "auth_required"}, {"type": "auth_ok"},
                            {"id": 1, "type": "result", "success": True, "result": [{"name": "Alex"}]}]

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def recv(self):
            return json.dumps(self.replies.pop(0))

        async def send(self, _):
            pass

    monkeypatch.setattr(management, "connect", lambda *a, **k: FakeSocket())
    log = AuditLog(tmp_path / "audit", now=clock(NOW))
    await management.HAWebSocket(HAClient(URL, "token", audit=log)).command("input_boolean/list")
    [entry] = log.entries()
    assert entry["channel"] == "ws" and entry["method"] == "WS" and entry["route"] == "input_boolean/list"
    assert entry["ok"] is True and "Alex" not in json.dumps(entry)
