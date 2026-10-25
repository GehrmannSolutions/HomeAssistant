"""Web UI energy page: usage per device and source (read), add/remove a device (journaled, gated)."""
from ha_safe_mcp.changes import ChangeJournal
from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import SettingsStore
from ha_safe_mcp.web import create_app
from test_web import HEADERS, FakeChecks, client, configure
from test_energy import FakeWS, make as make_energy


def make(tmp_path):
    ws = FakeWS()
    seen = []

    def factory(settings):
        seen.append(settings)
        return make_energy(ws, admin=settings.allow_admin_write, delete=settings.allow_delete)

    journal = ChangeJournal(tmp_path / "changes")
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(lambda *a: None),
                     energy_factory=factory, journal=journal)
    return app, ws, journal


async def settings(http, **flags):
    response = await http.post("/api/settings", headers=HEADERS, json={"ha_url": "http://127.0.0.1:8123", **flags})
    assert response.status_code == 200, response.text


async def test_energy_needs_setup_first(tmp_path):
    app, *_ = make(tmp_path)
    async with client(app) as http:
        assert (await http.get("/api/energy")).status_code == 409


async def test_energy_page_reads_usage_config_and_candidates(tmp_path):
    app, ws, _ = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        page = await http.get("/api/energy?period=yesterday")
        bad = await http.get("/api/energy?period=forever")
    data = page.json()
    assert page.status_code == 200 and data["usage"]["period"] == "yesterday"
    assert data["config"]["problem_count"] == 1
    assert [c["entity_id"] for c in data["candidates"]] == ["sensor.plug_energy"]
    assert bad.status_code == 400
    assert not any(kind == "energy/save_prefs" for kind, _ in ws.calls)


async def test_add_needs_the_config_switch_and_is_journaled(tmp_path):
    app, ws, journal = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        refused = await http.post("/api/energy/devices", headers=HEADERS,
                                  json={"stat_consumption": "sensor.plug_energy", "name": "Plug"})
        await settings(http, allow_write=True, allow_admin_write=True)
        added = await http.post("/api/energy/devices", headers=HEADERS,
                                json={"stat_consumption": "sensor.plug_energy", "name": "Plug"})
        forged = await http.post("/api/energy/devices", headers={"Origin": "http://evil.example", "X-HA-MCP-UI": "1"},
                                 json={"stat_consumption": "sensor.plug_energy"})
    assert refused.status_code == 403
    assert added.status_code == 200, added.text
    assert ws.prefs["device_consumption"][-1]["stat_consumption"] == "sensor.plug_energy"
    assert journal.entries()[0]["kind"] == "energy" and added.json()["change_id"] == journal.entries()[0]["id"]
    assert forged.status_code == 403


async def test_remove_needs_the_delete_switch(tmp_path):
    app, ws, journal = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        await settings(http, allow_write=True, allow_admin_write=True)
        refused = await http.delete("/api/energy/devices/sensor.rack_energy", headers=HEADERS)
        await settings(http, allow_write=True, allow_admin_write=True, allow_delete=True)
        removed = await http.delete("/api/energy/devices/sensor.rack_energy", headers=HEADERS)
        bad = await http.delete("/api/energy/devices/..%2Fx", headers=HEADERS)
    assert refused.status_code == 403
    assert removed.status_code == 200 and "change_id" in removed.json()
    assert [d["stat_consumption"] for d in ws.prefs["device_consumption"]] == ["sensor.gone_energy"]
    assert bad.status_code in (400, 404)


def test_undo_in_the_web_ui_knows_every_journal_kind(tmp_path):
    """Regression: the Changes page built its undo without labels, zones, themes, files, energy and assist."""
    from ha_safe_mcp.config_store import Settings
    from ha_safe_mcp.audit import AuditLog
    from ha_safe_mcp.web import live_changes
    changes = live_changes(Settings(ha_url="http://ha:8123", ha_token="t"), tmp_path, AuditLog(tmp_path / "a"),
                           ChangeJournal(tmp_path / "c"))
    for name in ("admin", "scenes", "registry", "integrations", "organizer", "customize", "config_files", "energy",
                 "assist"):
        assert getattr(changes, name) is not None, name
