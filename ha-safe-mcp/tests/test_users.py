"""Home Assistant users: list, create (password only as credential reference), change, delete, undo."""
import asyncio
import json

import pytest

from ha_safe_mcp.credentials import CredentialStore
from ha_safe_mcp.management import HAWebSocket
from ha_safe_mcp.server import HAClient, create_server
from ha_safe_mcp.users import HAUsers

URL = "http://ha:8123"
SELF_ID = "a" * 32
OWNER_ID = "b" * 32
GUEST_ID = "c" * 32


def user(user_id, name, *, username=None, groups=("system-users",), owner=False, active=True, system=False,
         local_only=False):
    return {"id": user_id, "username": username, "name": name, "is_owner": owner, "is_active": active,
            "local_only": local_only, "system_generated": system, "group_ids": list(groups),
            "credentials": [{"type": "homeassistant"}] if username else []}


class FakeWS:
    def __init__(self):
        self.calls = []
        self.users = [user(SELF_ID, "MCP", groups=("system-admin",)),
                      user(OWNER_ID, "Owner", username="owner", groups=("system-admin",), owner=True),
                      user(GUEST_ID, "Gast", username="gast"),
                      user("d" * 32, "Supervisor", groups=("system-admin",), system=True)]
        self.fail_login = False
        self.counter = 0

    async def command(self, kind, payload=None, **_):
        payload = dict(payload or {})
        self.calls.append((kind, payload))
        if kind == "auth/current_user":
            return {"id": SELF_ID, "name": "MCP", "is_owner": False, "is_admin": True}
        if kind == "config/auth/list":
            return [dict(u) for u in self.users]
        if kind == "config/auth/create":
            self.counter += 1
            new = user(f"{self.counter:032x}", payload["name"], groups=payload.get("group_ids") or ["system-users"],
                       local_only=bool(payload.get("local_only")))
            self.users.append(new)
            return {"user": dict(new)}
        if kind == "config/auth/update":
            target = next(u for u in self.users if u["id"] == payload["user_id"])
            target.update({k: v for k, v in payload.items() if k != "user_id"})
            return {"user": dict(target)}
        if kind == "config/auth/delete":
            self.users = [u for u in self.users if u["id"] != payload["user_id"]]
            return None
        if kind == "config/auth_provider/homeassistant/create":
            if self.fail_login:
                raise RuntimeError("Home Assistant WebSocket error: username_already_exists")
            target = next(u for u in self.users if u["id"] == payload["user_id"])
            target.update(username=payload["username"], credentials=[{"type": "homeassistant"}])
            return None
        raise AssertionError(kind)


@pytest.fixture
def store(tmp_path):
    credentials = CredentialStore(tmp_path / "cred")
    credentials.save("tablet_login", "Tablet", {"password": "s3cret-Passw0rd!"})
    return credentials


def make(ws=None, *, write=True, delete=False, store=None):
    ws = ws or FakeWS()
    return HAUsers(HAClient(URL, "t", allow_write=write), ws, allow_admin_write=write, allow_delete=delete,
                   credentials=store), ws


async def test_list_users_shows_roles_and_login_but_no_credentials_and_hides_system_users():
    users, _ = make()
    result = await users.list_users()
    names = [u["name"] for u in result["users"]]
    assert names == ["MCP", "Owner", "Gast"]                  # the system user only with include_system
    gast = next(u for u in result["users"] if u["name"] == "Gast")
    assert gast == {"user_id": GUEST_ID, "name": "Gast", "username": "gast", "admin": False, "owner": False,
                    "active": True, "local_only": False, "can_log_in": True}
    assert next(u for u in result["users"] if u["name"] == "MCP")["this_mcp"] is True
    assert "credentials" not in json.dumps(result)
    everything = await users.list_users(include_system=True)
    assert "Supervisor" in [u["name"] for u in everything["users"]]


async def test_create_user_with_login_resolves_the_password_reference_and_never_returns_it(store):
    users, ws = make(store=store)
    result = await users.create_user("Wandtablet", username="wandtablet",
                                     password={"$credential": "tablet_login", "field": "password"})
    assert result["user"]["name"] == "Wandtablet" and result["user"]["can_log_in"] is True
    assert result["user"]["admin"] is False
    login = next(p for k, p in ws.calls if k == "config/auth_provider/homeassistant/create")
    assert login["password"] == "s3cret-Passw0rd!" and login["username"] == "wandtablet"
    assert "s3cret" not in json.dumps(result)


async def test_create_user_refuses_a_plain_text_password_before_any_call(store):
    users, ws = make(store=store)
    with pytest.raises(ValueError, match="credential reference"):
        await users.create_user("Tablet", username="tablet", password="geheim123")
    assert not [k for k, _ in ws.calls if k.startswith("config/auth")]


async def test_a_login_needs_both_username_and_password_and_says_how(store):
    users, _ = make(store=store)
    with pytest.raises(ValueError, match="ha_list_credentials"):
        await users.create_user("Tablet", username="tablet")
    with pytest.raises(ValueError, match="username"):
        await users.create_user("Tablet", password={"$credential": "tablet_login", "field": "password"})


async def test_create_user_without_login_and_as_admin_and_local_only():
    users, ws = make()
    result = await users.create_user("Automationen", admin=True, local_only=True)
    created = next(p for k, p in ws.calls if k == "config/auth/create")
    assert created == {"name": "Automationen", "group_ids": ["system-admin"], "local_only": True}
    assert result["user"]["can_log_in"] is False and "no login" in result["note"]


async def test_create_user_refuses_a_taken_name_or_username(store):
    users, _ = make(store=store)
    with pytest.raises(ValueError, match="already exists"):
        await users.create_user("gast")
    with pytest.raises(ValueError, match="already taken"):
        await users.create_user("Neu", username="Gast",
                                password={"$credential": "tablet_login", "field": "password"})


async def test_failed_login_creation_says_the_user_exists_without_login(store):
    ws = FakeWS()
    ws.fail_login = True
    users, _ = make(ws, store=store)
    result = await users.create_user("Tablet", username="tablet",
                                     password={"$credential": "tablet_login", "field": "password"})
    assert result["user"]["can_log_in"] is False
    assert "username_already_exists" in result["login_error"] and "ha_delete_user" in result["hint"]


async def test_update_user_maps_admin_and_refuses_owner_system_and_own_lockout():
    users, ws = make()
    result = await users.update_user("Gast", {"admin": True, "name": "Gäste"})
    assert result["user"]["admin"] is True and result["user"]["name"] == "Gäste"
    sent = [p for k, p in ws.calls if k == "config/auth/update"][-1]
    assert sent == {"user_id": GUEST_ID, "group_ids": ["system-admin"], "name": "Gäste"}
    with pytest.raises(ValueError, match="owner"):
        await users.update_user(OWNER_ID, {"active": False})
    with pytest.raises(ValueError, match="this MCP"):
        await users.update_user(SELF_ID, {"admin": False})
    with pytest.raises(ValueError, match="system"):
        await users.update_user("Supervisor", {"name": "x"})
    with pytest.raises(ValueError, match="allowed: active, admin, local_only, name"):
        await users.update_user(GUEST_ID, {"password": "x"})


async def test_unknown_user_lists_the_existing_names():
    users, _ = make()
    with pytest.raises(ValueError, match="Gast") as error:
        await users.update_user("Besuch", {"active": False})
    assert "ha_list_users" in str(error.value)


async def test_delete_needs_the_delete_level_and_never_removes_owner_or_itself():
    users, _ = make()
    with pytest.raises(ValueError, match="delete"):
        await users.delete_user("Gast")
    users, ws = make(delete=True)
    with pytest.raises(ValueError, match="owner"):
        await users.delete_user("Owner")
    with pytest.raises(ValueError, match="this MCP"):
        await users.delete_user(SELF_ID)
    result = await users.delete_user("Gast")
    assert result["deleted"] == GUEST_ID and GUEST_ID not in [u["id"] for u in ws.users]


async def test_writes_are_refused_without_admin_write():
    users, ws = make(write=False)
    with pytest.raises(ValueError, match="admin write"):
        await users.create_user("x")
    assert ws.calls == []


async def test_user_tools_are_journaled_and_undo_deletes_a_created_user(tmp_path, monkeypatch, store):
    from ha_safe_mcp.changes import ChangeJournal
    ws = FakeWS()

    async def command(self, kind, payload=None, **_):
        return await ws.command(kind, payload)

    monkeypatch.setattr(HAWebSocket, "command", command)
    journal = ChangeJournal(tmp_path / "changes")
    server = create_server(HAClient(URL, "t", allow_write=True), allow_admin_write=True, allow_delete=True,
                           journal=journal, credentials=store)

    async def call(name, args):
        raw = await server.call_tool(name, args)
        return raw[1] if isinstance(raw, tuple) and isinstance(raw[1], dict) else json.loads(raw[0].text)

    created = await call("ha_create_user", {"name": "Wandtablet"})
    new_id = created["user"]["user_id"]
    assert journal.get(created["change_id"])["before"] is None
    changed = await call("ha_update_user", {"user": "Wandtablet", "changes": {"active": False}})
    assert journal.get(changed["change_id"])["before"] == {"is_active": True}
    await call("ha_undo_change", {"change_id": changed["change_id"]})
    assert next(u for u in ws.users if u["id"] == new_id)["is_active"] is True
    await call("ha_undo_change", {"change_id": created["change_id"]})
    assert new_id not in [u["id"] for u in ws.users]


def test_user_tools_are_registered_with_their_levels():
    from ha_safe_mcp.ollama_client import write_level
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_list_users", "ha_create_user", "ha_update_user", "ha_delete_user"} <= names
    assert write_level("ha_list_users") is None
    assert write_level("ha_create_user") == "admin" and write_level("ha_update_user") == "admin"
    assert write_level("ha_delete_user") == "delete"
