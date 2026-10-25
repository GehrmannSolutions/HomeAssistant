"""Backups through HA's backup integration (WS backup/info|generate|delete|restore, HTTP download): gated."""
import asyncio
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
    def __init__(self, infos=None, *, generate_result=None, restore=None):
        self.calls = []
        self.infos = list(infos or [])
        self.generate_result = generate_result or {"backup_job_id": "job1"}
        self.restore = restore  # None = HA answers, or an exception HA's restart/refusal causes

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "backup/info":
            item = self.infos.pop(0) if len(self.infos) > 1 else self.infos[0]
            if isinstance(item, Exception):
                raise item
            return item
        if kind == "backup/restore":
            if self.restore is not None:
                raise self.restore
            return None
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
    backups = HABackups(HAClient(URL, "token", allow_write=write), ws, allow_admin_write=admin, allow_delete=delete,
                        credentials=store, poll_interval=0)
    backups.settle_seconds = 0
    backups.core_state = running  # no HTTP in unit tests
    return backups


async def running():
    return "RUNNING"


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


def test_backup_tools_are_registered_including_get_and_restore():
    import asyncio
    from ha_safe_mcp.server import create_server
    names = {tool.name for tool in asyncio.run(create_server(HAClient(URL, "token")).list_tools())}
    assert {"ha_list_backups", "ha_get_backup", "ha_create_backup", "ha_delete_backup", "ha_restore_backup"} <= names


async def test_protection_is_taken_from_the_agents_when_the_top_level_flag_is_missing(tmp_path):
    """HA 2026.10 reports 'protected' per agent; the top-level key came back as null in the dev HA."""
    modern = {**OLD, "agents": {"backup.local": {"protected": True, "size": 10}}}
    modern.pop("protected")
    result = await make(tmp_path, FakeWS([info(modern)])).list_backups()
    assert result["backups"][0]["protected"] is True


# --- restore ---------------------------------------------------------------------------------------------------
SAFETY = {**OLD, "backup_id": "cccc3333", "name": "Before restore aaaa1111", "date": "2026-10-25T15:00:00+00:00"}
DONE = {"manager_state": "restore_backup", "stage": None, "state": "completed", "reason": None}
RESTARTING = RuntimeError("Home Assistant WebSocket request failed (ConnectionClosedError)")


def restore_ws(after, *, restore=RESTARTING, before=None):
    """backup/info answers: check, safety-backup baseline, safety backup done, then HA restarting, then ``after``."""
    before = before or info(OLD)
    return FakeWS([before, before, info(OLD, SAFETY), RuntimeError("Home Assistant WebSocket request failed (OSError)"),
                   after], restore=restore)


async def test_get_backup_describes_one_backup_and_what_a_restore_means(tmp_path):
    result = await make(tmp_path, FakeWS([info(OLD)])).get_backup("aaaa1111")
    assert result["backup"]["name"] == "Alt" and result["backup"]["database_included"] is True
    impact = " ".join(result["restore_impact"])
    assert "restart" in impact and "token" in impact and "safety backup" in impact
    with pytest.raises(ValueError):
        await make(tmp_path, FakeWS([info(OLD)])).get_backup("cccc3333")


async def test_restore_needs_the_delete_level(tmp_path):
    ws = FakeWS([info(OLD)])
    with pytest.raises(ValueError, match="delete"):
        await make(tmp_path, ws).restore_backup("aaaa1111")
    with pytest.raises(ValueError, match="admin write"):
        await make(tmp_path, ws, admin=False, delete=True).restore_backup("aaaa1111")
    assert ws.calls == []


async def test_restore_makes_a_safety_backup_first_then_restores_and_waits_for_the_result(tmp_path):
    ws = restore_ws(info(OLD, SAFETY, event=DONE))
    result = await make(tmp_path, ws, delete=True).restore_backup("aaaa1111")
    kinds = [kind for kind, _ in ws.calls]
    assert kinds.index("backup/generate") < kinds.index("backup/restore")
    restore = next(payload for kind, payload in ws.calls if kind == "backup/restore")
    assert restore == {"backup_id": "aaaa1111", "agent_id": "backup.local", "restore_homeassistant": True,
                       "restore_database": True}
    assert result["restored"] is True and result["state"] == "completed"
    assert result["safety_backup"]["backup_id"] == "cccc3333"
    assert "cccc3333" in result["undo"]


async def test_restore_can_leave_the_database_alone(tmp_path):
    ws = restore_ws(info(OLD, SAFETY, event=DONE))
    await make(tmp_path, ws, delete=True).restore_backup("aaaa1111", restore_database=False)
    restore = next(payload for kind, payload in ws.calls if kind == "backup/restore")
    assert restore["restore_database"] is False


async def test_restore_reports_a_failure_from_home_assistant(tmp_path):
    failed = {**DONE, "state": "failed", "reason": "Restore failed: bad tar"}
    result = await make(tmp_path, restore_ws(info(OLD, SAFETY, event=failed)), delete=True).restore_backup("aaaa1111")
    assert result["restored"] is False and result["state"] == "failed" and "bad tar" in result["reason"]
    assert result["safety_backup"]["backup_id"] == "cccc3333"


async def test_a_refusal_by_home_assistant_is_an_error_and_nothing_restarts(tmp_path):
    ws = restore_ws(info(OLD), restore=RuntimeError("Home Assistant WebSocket error: password_incorrect"))
    with pytest.raises(RuntimeError, match="password_incorrect"):
        await make(tmp_path, ws, delete=True).restore_backup("aaaa1111")


async def test_restore_aborts_when_the_safety_backup_fails(tmp_path):
    failed = {"manager_state": "create_backup", "stage": None, "state": "failed", "reason": "disk_full"}
    ws = FakeWS([info(OLD), info(OLD), info(OLD, event=failed)])
    result = await make(tmp_path, ws, delete=True).restore_backup("aaaa1111")
    assert result["restored"] is False and "disk_full" in result["reason"]
    assert "backup/restore" not in [kind for kind, _ in ws.calls]


async def test_restore_refuses_unknown_backups_busy_managers_and_missing_parts(tmp_path):
    with pytest.raises(ValueError):
        await make(tmp_path, FakeWS([info(OLD)]), delete=True).restore_backup("cccc3333")
    with pytest.raises(RuntimeError, match="busy"):
        await make(tmp_path, FakeWS([info(OLD, state="create_backup")]), delete=True).restore_backup("aaaa1111")
    no_db = {**OLD, "database_included": False}
    with pytest.raises(ValueError, match="restore_database"):
        await make(tmp_path, FakeWS([info(no_db)]), delete=True).restore_backup("aaaa1111")
    no_config = {**OLD, "homeassistant_included": False}
    with pytest.raises(ValueError, match="configuration"):
        await make(tmp_path, FakeWS([info(no_config)]), delete=True).restore_backup("aaaa1111")


async def test_a_protected_backup_needs_a_password_reference_and_it_never_leaks(tmp_path):
    locked = {**OLD, "agents": {"backup.local": {"protected": True, "size": 10}}}
    locked.pop("protected")
    backups = make(tmp_path, FakeWS([info(locked)]), delete=True)
    with pytest.raises(ValueError, match="password"):
        await backups.restore_backup("aaaa1111")
    with pytest.raises(ValueError, match="credential"):
        await backups.restore_backup("aaaa1111", password=SECRET)
    ws = restore_ws(info(locked, SAFETY, event=DONE), before=info(locked))
    result = await make(tmp_path, ws, delete=True).restore_backup(
        "aaaa1111", password={"$credential": "backup_pw", "field": "password"})
    restore = next(payload for kind, payload in ws.calls if kind == "backup/restore")
    assert restore["password"] == SECRET and SECRET not in json.dumps(result)


async def test_restore_gives_up_waiting_honestly(tmp_path):
    ws = restore_ws(RuntimeError("Home Assistant WebSocket request failed (OSError)"))
    backups = make(tmp_path, ws, delete=True)
    backups.restore_timeout = 0
    result = await backups.restore_backup("aaaa1111")
    assert result["restored"] is None and "ha_list_backups" in result["note"]
    assert result["safety_backup"]["backup_id"] == "cccc3333"


async def test_restore_waits_for_delayed_writes_before_the_safety_backup_and_for_a_full_start(tmp_path, monkeypatch):
    """HA stores helpers/registries up to 10 s after a change (helpers/collection.py SAVE_DELAY): a safety backup
    taken right away missed a helper created seconds before (dev E2E). And backup/info answers before HA is fully
    started, so the tool must wait for core state RUNNING."""
    ws = restore_ws(info(OLD, SAFETY, event=DONE))
    backups = make(tmp_path, ws, delete=True)
    backups.settle_seconds = 12
    slept, states = [], iter(["NOT_RUNNING", "STARTING", "RUNNING"])
    real_sleep = asyncio.sleep

    async def fake_sleep(seconds):
        slept.append(seconds)
        await real_sleep(0)

    async def state():
        return next(states)

    monkeypatch.setattr("ha_safe_mcp.backups.asyncio.sleep", fake_sleep)
    backups.core_state = state
    result = await backups.restore_backup("aaaa1111")
    generate_at = [kind for kind, _ in ws.calls].index("backup/generate")
    assert slept[0] == 12 and generate_at > 0
    assert result["restored"] is True and result["ha_state"] == "RUNNING"
    assert next(states, None) is None  # polled until RUNNING
