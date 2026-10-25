"""Backups through HA's backup integration (WS backup/info|generate|delete, HTTP download): gated, no restore."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.backups import HABackups
from ha_safe_mcp.credentials import CredentialStore
from ha_safe_mcp.server import HAClient

# these tests check the German messages (the UI language German); English is covered in test_i18n.py
pytestmark = pytest.mark.usefixtures("german")

URL = "http://ha:8123"
SECRET = "Backup-Schl3ssel!"
OLD = {"backup_id": "aaaa1111", "name": "Alt", "date": "2026-10-20T10:00:00+00:00", "protected": False,
       "homeassistant_included": True, "database_included": True, "folders": [], "addons": [],
       "homeassistant_version": "2026.10.3", "agents": {"backup.local": {"protected": False, "size": 2048}},
       "extra_metadata": {"supervisor.backup_request_date": "x"}, "failed_agent_ids": []}
NEW = {**OLD, "backup_id": "bbbb2222", "name": "MCP Test", "date": "2026-10-24T11:00:00+00:00"}


class FakeWS:
    def __init__(self, infos=None, *, generate_result=None):
        self.calls = []
        self.infos = list(infos or [])
        self.generate_result = generate_result or {"backup_job_id": "job1"}

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "backup/info":
            return self.infos.pop(0) if len(self.infos) > 1 else self.infos[0]
        if kind == "backup/agents/info":
            return {"agents": [{"agent_id": "backup.local", "name": "local"}]}
        if kind == "backup/generate":
            return self.generate_result
        if kind == "backup/delete":
            return {"agent_errors": {}}
        raise AssertionError(f"unexpected ws command {kind}")


def info(*backups, state="idle", event=None):
    return {"backups": list(backups), "agent_errors": {}, "state": state, "last_action_event": event,
            "last_completed_automatic_backup": None, "next_automatic_backup": None}


def make(tmp_path, ws, *, write=True, admin=True, delete=False):
    store = CredentialStore(tmp_path / "creds")
    store.save("backup_pw", "Backup", {"password": SECRET})
    return HABackups(HAClient(URL, "token", allow_write=write), ws, allow_admin_write=admin, allow_delete=delete,
                     credentials=store, poll_interval=0)


async def test_list_reduces_backups_to_a_small_field_set(tmp_path):
    backups = make(tmp_path, FakeWS([info(OLD)]))
    result = await backups.list_backups()
    assert result["state"] == "idle" and result["agents"] == ["backup.local"]
    [item] = result["backups"]
    assert item == {"backup_id": "aaaa1111", "name": "Alt", "date": "2026-10-20T10:00:00+00:00", "protected": False,
                    "size": 2048, "agents": ["backup.local"], "homeassistant_included": True,
                    "database_included": True, "folders": [], "homeassistant_version": "2026.10.3"}


async def test_create_needs_admin_write(tmp_path):
    ws = FakeWS([info()])
    with pytest.raises(ValueError, match="admin write"):
        await make(tmp_path, ws, admin=False).create_backup("x")
    assert ws.calls == []


async def test_create_starts_a_local_backup_and_waits_for_the_new_one(tmp_path):
    ws = FakeWS([info(OLD), info(OLD, state="create_backup"), info(OLD, NEW)])
    result = await make(tmp_path, ws).create_backup("MCP Test")
    kind, payload = ws.calls[1]
    assert kind == "backup/generate"
    assert payload == {"agent_ids": ["backup.local"], "name": "MCP Test", "include_database": True,
                       "include_homeassistant": True}
    assert result["backup"]["backup_id"] == "bbbb2222" and result["completed"] is True


async def test_create_with_password_takes_only_a_credential_reference(tmp_path):
    ws = FakeWS([info(), info(NEW)])
    backups = make(tmp_path, ws)
    with pytest.raises(ValueError, match="credential"):
        await backups.create_backup("x", password=SECRET)
    result = await backups.create_backup("MCP Test", password={"$credential": "backup_pw", "field": "password"})
    generate = next(payload for kind, payload in ws.calls if kind == "backup/generate")
    assert generate["password"] == SECRET
    assert SECRET not in json.dumps(result)


async def test_create_reports_a_failed_backup_without_inventing_one(tmp_path):
    failed = {"manager_state": "create_backup", "stage": None, "state": "failed", "reason": "upload_failed"}
    ws = FakeWS([info(OLD), info(OLD, event=failed)])
    result = await make(tmp_path, ws).create_backup("kaputt")
    assert result["completed"] is False and result["backup"] is None and result["reason"] == "upload_failed"


async def test_create_gives_up_after_the_timeout_honestly(tmp_path):
    ws = FakeWS([info(OLD), info(OLD, state="create_backup")])
    backups = make(tmp_path, ws)
    backups.timeout = 0
    result = await backups.create_backup("lang")
    assert result["completed"] is False and "läuft noch" in result["note"]


@pytest.mark.parametrize("name", ["", "x" * 101, "a\nb"])
async def test_invalid_backup_names_are_rejected(tmp_path, name):
    with pytest.raises(ValueError):
        await make(tmp_path, FakeWS([info()])).create_backup(name)


async def test_delete_needs_the_delete_switch_and_a_valid_id(tmp_path):
    ws = FakeWS([info(OLD)])
    with pytest.raises(ValueError, match="delete"):
        await make(tmp_path, ws).delete_backup("aaaa1111")
    backups = make(tmp_path, ws, delete=True)
    with pytest.raises(ValueError, match="backup_id"):
        await backups.delete_backup("../etc")
    assert await backups.delete_backup("aaaa1111") == {"deleted": True, "agent_errors": {}}
    assert ("backup/delete", {"backup_id": "aaaa1111"}) in ws.calls


async def test_download_streams_the_tar_from_the_backup_route(tmp_path):
    backups = make(tmp_path, FakeWS([info(OLD)]))
    with respx.mock(base_url=URL) as router:
        route = router.get("/api/backup/download/aaaa1111").mock(return_value=httpx.Response(
            200, content=b"TARDATA", headers={"content-type": "application/x-tar"}))
        chunks = []
        async with backups.download("aaaa1111") as (filename, stream):
            async for chunk in stream:
                chunks.append(chunk)
    assert b"".join(chunks) == b"TARDATA" and filename == "alt-aaaa1111.tar"
    assert route.calls[0].request.url.params["agent_id"] == "backup.local"
    assert route.calls[0].request.headers["authorization"] == "Bearer token"


async def test_download_of_an_unknown_backup_is_refused_before_any_request(tmp_path):
    backups = make(tmp_path, FakeWS([info(OLD)]))
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        route = router.get(url__regex=r".*/api/backup/download/.*")
        with pytest.raises(ValueError, match="nicht gefunden"):
            async with backups.download("cccc3333"):
                pass
    assert not route.called


def test_backup_tools_are_registered_and_restore_is_not():
    import asyncio
    from ha_safe_mcp.server import create_server
    names = {tool.name for tool in asyncio.run(create_server(HAClient(URL, "token")).list_tools())}
    assert {"ha_list_backups", "ha_create_backup", "ha_delete_backup"} <= names
    assert not any("restore" in name for name in names)


async def test_protection_is_taken_from_the_agents_when_the_top_level_flag_is_missing(tmp_path):
    """HA 2026.10 reports 'protected' per agent; the top-level key came back as null in the dev HA."""
    modern = {**OLD, "agents": {"backup.local": {"protected": True, "size": 10}}}
    modern.pop("protected")
    result = await make(tmp_path, FakeWS([info(modern)])).list_backups()
    assert result["backups"][0]["protected"] is True
