"""Remote MCP endpoint: per-client bearer tokens, capped permissions, Streamable HTTP gateway at /mcp."""
import asyncio
import json
import stat
from contextlib import asynccontextmanager

import httpx
import pytest
from mcp import types

from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import Settings, SettingsStore
from ha_safe_mcp.remote import ClientStore, effective_env, effective_level, tool_visible
from ha_safe_mcp.web import create_app
from test_web import HEADERS, FakeChecks, configure

MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
FULL = Settings(ha_token="t" * 40, allow_write=True, allow_admin_write=True, allow_delete=True,
                allowed_domains=("light", "switch", "cover"))


# ---------------------------------------------------------------- token store
def test_tokens_are_shown_once_and_stored_only_as_hash(tmp_path):
    store = ClientStore(tmp_path / "clients")
    client, token = store.create("Claude Code", "control", ["light"])
    raw = (tmp_path / "clients" / "clients.json").read_text()
    assert token.startswith("hsm_") and len(token) > 40 and token not in raw
    assert stat.S_IMODE((tmp_path / "clients").stat().st_mode) == 0o700
    assert stat.S_IMODE((tmp_path / "clients" / "clients.json").stat().st_mode) == 0o600
    assert store.authenticate(token)["id"] == client["id"]
    assert store.authenticate(token + "x") is None and store.authenticate("") is None
    listed = store.list()
    assert listed[0]["name"] == "Claude Code" and "token_hash" not in listed[0] and listed[0]["last_used"]
    store.delete(client["id"])
    assert store.authenticate(token) is None and store.list() == []


@pytest.mark.parametrize("name,level,domains", [("", "read", []), ("x" * 81, "read", []), ("ok", "root", []),
                                                ("ok", "control", ["Licht!"]), ("ok", "control", "light")])
def test_invalid_client_profiles_are_rejected(tmp_path, name, level, domains):
    with pytest.raises(ValueError):
        ClientStore(tmp_path / "c").create(name, level, domains)


def test_client_level_can_be_changed_without_a_new_token(tmp_path):
    store = ClientStore(tmp_path / "c")
    client, token = store.create("Codex", "read", [])
    store.update(client["id"], level="admin", domains=["light"])
    assert store.authenticate(token)["level"] == "admin" and store.authenticate(token)["domains"] == ["light"]


# ---------------------------------------------------------------- permission caps
def test_client_level_is_capped_by_the_instance_switches():
    assert effective_level(FULL, {"level": "delete"}) == "delete"
    assert effective_level(FULL, {"level": "read"}) == "read"
    control_only = Settings(ha_token="t" * 40, allow_write=True)
    assert effective_level(control_only, {"level": "delete"}) == "control"
    assert effective_level(Settings(ha_token="t" * 40), {"level": "admin"}) == "read"


def test_child_env_carries_only_the_capped_rights_and_domains():
    env = effective_env(FULL, {"id": "abcd1234", "level": "control", "domains": ["light", "climate"]})
    assert env["HA_ALLOW_WRITE"] == "true" and env["HA_ALLOW_ADMIN_WRITE"] == "false"
    assert env["HA_ALLOW_DELETE"] == "false" and env["HA_ALLOWED_DOMAINS"] == "light"
    assert env["HA_AUDIT_CLIENT"] == "abcd1234"
    all_domains = effective_env(FULL, {"id": "abcd1234", "level": "delete", "domains": []})
    assert all_domains["HA_ALLOWED_DOMAINS"] == "cover,light,switch" and all_domains["HA_ALLOW_DELETE"] == "true"
    reader = effective_env(FULL, {"id": "abcd1234", "level": "read", "domains": []})
    assert reader["HA_ALLOW_WRITE"] == "false"


def test_tools_above_the_client_level_are_hidden():
    assert tool_visible("ha_get_state", "read") and not tool_visible("ha_call_service", "read")
    assert tool_visible("ha_call_service", "control") and not tool_visible("ha_save_automation", "control")
    assert tool_visible("ha_save_automation", "admin") and not tool_visible("ha_delete_area", "admin")
    assert tool_visible("ha_delete_area", "delete") and not tool_visible("ha_brand_new_tool", "delete")


# ---------------------------------------------------------------- HTTP gateway
class FakeSession:
    """Stands in for the stdio child session of one client."""

    def __init__(self, env):
        self.env = env
        self.calls = []

    async def list_tools(self):
        def tool(name):
            return types.Tool(name=name, description=name, inputSchema={"type": "object"})
        return types.ListToolsResult(tools=[tool(n) for n in ("ha_get_state", "ha_call_service", "ha_delete_area")])

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return types.CallToolResult(content=[types.TextContent(type="text", text=f"{name} ok")])


class FakePool:
    def __init__(self):
        self.sessions = {}
        self.task_group = None

    def drop(self, key):
        self.sessions.pop(key, None)

    async def session(self, key, env):
        current = self.sessions.get(key)
        if current is None or current.env != env:
            current = self.sessions[key] = FakeSession(env)
        return current

    async def aclose(self):
        pass


@asynccontextmanager
async def running(app):
    """Drive the ASGI lifespan (httpx's ASGITransport does not)."""
    queue, sent = asyncio.Queue(), asyncio.Queue()
    await queue.put({"type": "lifespan.startup"})

    async def receive():
        return await queue.get()

    async def send(message):
        await sent.put(message)
    task = asyncio.create_task(app({"type": "lifespan", "asgi": {"version": "3.0"}, "state": {}}, receive, send))
    assert (await sent.get())["type"] == "lifespan.startup.complete"
    try:
        yield
    finally:
        await queue.put({"type": "lifespan.shutdown"})
        await asyncio.wait_for(task, 5)


def make(tmp_path, *, public=False):
    async def runner(*args, **kwargs):
        return "ok"
    pool = FakePool()
    clients = ClientStore(tmp_path / "clients")
    options = {"public_origin": "https://ha.example.org", "access_verifier": lambda jwt: jwt == "good",
               "allowed_hosts": {"ha.example.org"}} if public else {}
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(runner),
                     clients=clients, mcp_pool=pool, **options)
    return app, clients, pool


def http(app, host="127.0.0.1:8765"):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 50000)),
                             base_url=f"http://{host}")


def rpc(method, params=None, id_=1):
    return {"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}


async def enable_everything(h):
    await configure(h)
    await h.post("/api/settings", headers=HEADERS,
                 json={"allow_write": True, "allow_admin_write": True, "allow_delete": True})


async def test_mcp_without_or_with_a_wrong_token_gets_401_with_a_bearer_challenge(tmp_path):
    app, clients, _ = make(tmp_path)
    clients.create("Codex", "read", [])
    async with running(app), http(app) as h:
        bare = await h.post("/mcp", headers=MCP_HEADERS, json=rpc("tools/list"))
        wrong = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": "Bearer hsm_nope"},
                             json=rpc("tools/list"))
    assert bare.status_code == 401 and wrong.status_code == 401
    assert bare.headers["www-authenticate"].startswith("Bearer")


async def test_a_read_client_sees_only_read_tools_and_cannot_call_others(tmp_path):
    app, clients, pool = make(tmp_path)
    _, token = clients.create("Codex", "read", [])
    auth = {**MCP_HEADERS, "Authorization": f"Bearer {token}"}
    async with running(app), http(app) as h:
        await enable_everything(h)
        listed = await h.post("/mcp", headers=auth, json=rpc("tools/list"))
        refused = await h.post("/mcp", headers=auth, json=rpc("tools/call", {"name": "ha_delete_area",
                                                                              "arguments": {"area_id": "x"}}))
        allowed = await h.post("/mcp", headers=auth, json=rpc("tools/call", {"name": "ha_get_state",
                                                                              "arguments": {"entity_id": "sun.sun"}}))
    names = [t["name"] for t in listed.json()["result"]["tools"]]
    assert names == ["ha_get_state"]
    assert refused.json()["result"]["isError"] is True
    assert allowed.json()["result"]["content"][0]["text"] == "ha_get_state ok"
    (session,) = pool.sessions.values()
    assert session.calls == [("ha_get_state", {"entity_id": "sun.sun"})]
    assert session.env["HA_ALLOW_WRITE"] == "false"


async def test_tool_annotations_tell_clients_what_writes_and_deletes(tmp_path):
    app, clients, _ = make(tmp_path)
    _, token = clients.create("Claude", "delete", [])
    async with running(app), http(app) as h:
        await enable_everything(h)
        listed = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                              json=rpc("tools/list"))
    tools = {t["name"]: t.get("annotations") or {} for t in listed.json()["result"]["tools"]}
    assert tools["ha_get_state"]["readOnlyHint"] is True
    assert tools["ha_call_service"]["readOnlyHint"] is False and tools["ha_call_service"]["destructiveHint"] is False
    assert tools["ha_delete_area"]["destructiveHint"] is True


async def test_settings_changes_reach_the_client_session(tmp_path):
    app, clients, pool = make(tmp_path)
    _, token = clients.create("Claude", "delete", [])
    auth = {**MCP_HEADERS, "Authorization": f"Bearer {token}"}
    async with running(app), http(app) as h:
        await configure(h)
        before = await h.post("/mcp", headers=auth, json=rpc("tools/list"))
        await h.post("/api/settings", headers=HEADERS, json={"allow_write": True})
        after = await h.post("/mcp", headers=auth, json=rpc("tools/list"))
    assert [t["name"] for t in before.json()["result"]["tools"]] == ["ha_get_state"]
    assert [t["name"] for t in after.json()["result"]["tools"]] == ["ha_get_state", "ha_call_service"]


async def test_public_mcp_path_needs_no_access_jwt_but_the_ui_still_does(tmp_path):
    app, clients, _ = make(tmp_path, public=True)
    _, token = clients.create("Claude", "read", [])
    async with running(app), http(app, host="ha.example.org") as h:
        mcp = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                           json=rpc("tools/list"))
        ui = await h.get("/api/status")
        lookalike = await h.get("/mcpx")
    async with running(app), http(app, host="evil.example") as h:
        foreign = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {token}"},
                               json=rpc("tools/list"))
    assert mcp.status_code == 200 and ui.status_code == 403 and lookalike.status_code == 403
    assert foreign.status_code == 400


async def test_without_clients_the_endpoint_only_answers_with_the_oauth_challenge(tmp_path):
    app, _, _ = make(tmp_path)
    async with running(app), http(app) as h:
        response = await h.post("/mcp", headers=MCP_HEADERS, json=rpc("tools/list"))
    assert response.status_code == 401 and "resource_metadata=" in response.headers["www-authenticate"]


# ---------------------------------------------------------------- client management in the UI
async def test_clients_are_managed_from_the_ui_and_the_token_is_returned_once(tmp_path):
    app, _, _ = make(tmp_path)
    async with running(app), http(app) as h:
        await configure(h)
        forged = await h.post("/api/clients", json={"name": "x", "level": "read"})
        created = await h.post("/api/clients", headers=HEADERS,
                               json={"name": "Claude Code", "level": "control", "domains": ["light"]})
        listed = (await h.get("/api/clients")).json()
        changed = await h.post(f"/api/clients/{created.json()['client']['id']}", headers=HEADERS,
                               json={"level": "read", "domains": []})
        deleted = await h.delete(f"/api/clients/{created.json()['client']['id']}", headers=HEADERS)
        after = (await h.get("/api/clients")).json()
    assert forged.status_code == 403
    assert created.status_code == 200 and created.json()["token"].startswith("hsm_")
    assert "hsm_" not in json.dumps(listed["clients"]) and "token_hash" not in json.dumps(listed["clients"])
    assert listed["endpoint"] == "http://127.0.0.1:8765/mcp"
    assert listed["clients"][0]["effective_level"] == "read"  # instance switches are still off
    assert changed.json()["client"]["level"] == "read"
    assert deleted.status_code == 200 and after["clients"] == []


def test_audit_records_name_the_remote_client_by_id_only(tmp_path, monkeypatch):
    from ha_safe_mcp.audit import audit_from_env
    monkeypatch.setenv("HA_AUDIT_DIR", str(tmp_path / "a"))
    monkeypatch.setenv("HA_AUDIT_CLIENT", "abcd1234")
    log = audit_from_env()
    log.record(kind="tool", tool="ha_get_state")
    assert log.entries()[0]["client"] == "abcd1234"
    monkeypatch.setenv("HA_AUDIT_CLIENT", "Claude Code")
    assert audit_from_env().client is None


def test_the_stdio_server_marks_read_and_delete_tools():
    from ha_safe_mcp.server import HAClient, create_server
    tools = {t.name: t.annotations for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    assert tools["ha_get_state"].readOnlyHint is True and tools["ha_get_state"].destructiveHint is False
    assert tools["ha_save_automation"].readOnlyHint is False and tools["ha_delete_area"].destructiveHint is True
    from ha_safe_mcp.remote import tool_level
    assert all(tool_level(name) for name in tools), "every tool must be classified read/control/admin/delete"
