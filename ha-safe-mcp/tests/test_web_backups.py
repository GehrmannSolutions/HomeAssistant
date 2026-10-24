"""Web UI backup page: list, create (admin write), download (streamed), delete (delete switch); no restore."""
import contextlib

import pytest

from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import SettingsStore
from ha_safe_mcp.web import create_app
from test_web import HEADERS, FakeChecks, client, configure


class FakeBackups:
    def __init__(self):
        self.created, self.deleted = [], []

    async def list_backups(self):
        return {"state": "idle", "agents": ["backup.local"],
                "backups": [{"backup_id": "aaaa1111", "name": "Alt", "size": 7}]}

    async def create_backup(self, name, password=None):
        self.created.append(name)
        return {"completed": True, "backup": {"backup_id": "bbbb2222", "name": name}}

    async def delete_backup(self, backup_id):
        self.deleted.append(backup_id)
        return {"deleted": True, "agent_errors": {}}

    @contextlib.asynccontextmanager
    async def download(self, backup_id):
        if backup_id != "aaaa1111":
            raise ValueError("Backup nicht gefunden")

        async def chunks():
            yield b"TAR"
            yield b"DATA"
        yield "alt-aaaa1111.tar", chunks()


def make(tmp_path):
    fake = FakeBackups()
    seen = []

    def factory(settings):
        seen.append(settings)
        return fake

    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(lambda *a: None),
                     backups_factory=factory)
    return app, fake, seen


async def settings(http, **flags):
    response = await http.post("/api/settings", headers=HEADERS, json={"ha_url": "http://127.0.0.1:8123", **flags})
    assert response.status_code == 200, response.text


async def test_backups_need_setup_first(tmp_path):
    app, *_ = make(tmp_path)
    async with client(app) as http:
        assert (await http.get("/api/backups")).status_code == 409


async def test_backups_are_listed_and_downloaded_as_a_stream(tmp_path):
    app, fake, seen = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        listed = await http.get("/api/backups")
        download = await http.get("/api/backups/aaaa1111/download")
        missing = await http.get("/api/backups/cccc3333/download")
        bad = await http.get("/api/backups/..%2Fx/download")
    assert listed.json()["backups"][0]["backup_id"] == "aaaa1111"
    assert download.status_code == 200 and download.content == b"TARDATA"
    assert download.headers["content-disposition"] == 'attachment; filename="alt-aaaa1111.tar"'
    assert download.headers["content-type"] == "application/x-tar"
    assert missing.status_code == 404 and bad.status_code in (400, 404)
    assert seen[0].ha_token  # the backup client uses the stored settings


async def test_create_needs_the_config_switch(tmp_path):
    app, fake, _ = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        refused = await http.post("/api/backups", headers=HEADERS, json={"name": "Vorher"})
        await settings(http, allow_write=True, allow_admin_write=True)
        created = await http.post("/api/backups", headers=HEADERS, json={"name": "Vorher"})
        forged = await http.post("/api/backups", headers={"Origin": "http://evil.example", "X-HA-MCP-UI": "1"},
                                 json={"name": "x"})
    assert refused.status_code == 403 and "Konfiguration" in refused.json()["error"]
    assert created.json()["backup"]["backup_id"] == "bbbb2222" and fake.created == ["Vorher"]
    assert forged.status_code == 403


async def test_delete_needs_the_delete_switch(tmp_path):
    app, fake, _ = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        await settings(http, allow_write=True, allow_admin_write=True)
        refused = await http.delete("/api/backups/aaaa1111", headers=HEADERS)
        await settings(http, allow_write=True, allow_admin_write=True, allow_delete=True)
        deleted = await http.delete("/api/backups/aaaa1111", headers=HEADERS)
    assert refused.status_code == 403 and fake.deleted == ["aaaa1111"]
    assert deleted.json()["deleted"] is True


async def test_there_is_no_restore_route(tmp_path):
    app, *_ = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        for path in ("/api/backups/aaaa1111/restore", "/api/backups/restore"):
            assert (await http.post(path, headers=HEADERS, json={})).status_code in (404, 405)
