"""Web UI: the change journal can be read and a change undone with one click (same gates as the MCP tools)."""
from ha_safe_mcp.changes import ChangeJournal
from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import SettingsStore
from ha_safe_mcp.web import create_app
from test_web import HEADERS, FakeChecks, client, configure


class FakeChanges:
    def __init__(self, journal):
        self.journal = journal
        self.undone = []

    async def undo(self, change_id, force=False):
        self.journal.get(change_id)
        if not force and self.journal.entries(limit=1)[0]["id"] != change_id:
            raise ValueError("newer changes to this target exist: x; undo them first or force")
        self.undone.append(change_id)
        return {"undone": change_id, "change_id": "new", "kind": "automation", "target": "flur", "result": {}}


def make(tmp_path):
    async def runner(*args, **kwargs):
        return "ok"

    journal = ChangeJournal(tmp_path / "changes")
    fake = FakeChanges(journal)
    seen = []

    def factory(settings):
        seen.append(settings)
        return fake
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(runner),
                     journal=journal, changes_factory=factory)
    return app, journal, fake


async def test_changes_are_listed_newest_first_without_stored_configs(tmp_path):
    app, journal, _ = make(tmp_path)
    journal.record(kind="automation", target="flur", before={"alias": "Flur"}, tool="ha_save_automation")
    async with client(app) as http:
        await configure(http)
        data = (await http.get("/api/changes")).json()
    assert data["retention_days"] == 30
    assert data["entries"][0]["target"] == "flur" and "before" not in data["entries"][0]


async def test_undo_needs_configuration_rights_and_the_ui_header(tmp_path):
    app, journal, fake = make(tmp_path)
    change_id = journal.record(kind="automation", target="flur", before=None, tool="ha_save_automation")
    async with client(app) as http:
        await configure(http)
        refused = await http.post(f"/api/changes/{change_id}/undo", headers=HEADERS)
        forged = await http.post(f"/api/changes/{change_id}/undo")
        await http.post("/api/settings", headers=HEADERS, json={"allow_write": True, "allow_admin_write": True})
        done = await http.post(f"/api/changes/{change_id}/undo", headers=HEADERS)
        bad = await http.post("/api/changes/..%2Fx/undo", headers=HEADERS)
    assert refused.status_code == 403 and forged.status_code == 403
    assert done.status_code == 200 and done.json()["undone"] == change_id and fake.undone == [change_id]
    assert bad.status_code in (400, 404)


async def test_undo_with_newer_changes_reports_conflict_and_can_be_forced(tmp_path):
    app, journal, fake = make(tmp_path)
    old = journal.record(kind="automation", target="flur", before=None, tool="ha_save_automation")
    journal.record(kind="automation", target="flur", before={"alias": "x"}, tool="ha_save_automation")
    async with client(app) as http:
        await configure(http)
        await http.post("/api/settings", headers=HEADERS, json={"allow_write": True, "allow_admin_write": True})
        conflict = await http.post(f"/api/changes/{old}/undo", headers=HEADERS, json={})
        forced = await http.post(f"/api/changes/{old}/undo", headers=HEADERS, json={"force": True})
    assert conflict.status_code == 409 and "newer" in conflict.json()["error"]
    assert forced.status_code == 200 and fake.undone == [old]
