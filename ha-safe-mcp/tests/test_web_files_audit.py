"""Web UI: file manager for model-written plans/scripts and the GDPR-minded MCP <-> HA audit log."""
from datetime import datetime, timezone

import pytest

from ha_safe_mcp.audit import AuditLog
from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import SettingsStore
from ha_safe_mcp.files import FileStore
from ha_safe_mcp.web import create_app
from test_web import HEADERS, FakeChecks, client, configure, poll_until_done


def make(tmp_path, runner=None):
    async def default_runner(settings, prompt, history, allow_write, approve, on_event):
        return "ok"

    files = FileStore(tmp_path / "files")
    audit = AuditLog(tmp_path / "audit")
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(),
                     runs=RunManager(runner or default_runner), files=files, audit=audit)
    return app, files, audit


async def test_files_can_be_listed_read_downloaded_and_deleted(tmp_path):
    app, files, _ = make(tmp_path)
    files.save("plan", "abend.md", "# Abendplan\n")
    async with client(app) as http:
        listed = (await http.get("/api/files")).json()["files"]
        read = await http.get("/api/files/plan/abend.md")
        download = await http.get("/api/files/plan/abend.md", params={"download": "1"})
        deleted = await http.delete("/api/files/plan/abend.md", headers=HEADERS)
        after = (await http.get("/api/files")).json()["files"]
    assert [item["name"] for item in listed] == ["abend.md"]
    assert read.json()["content"] == "# Abendplan\n"
    assert download.text == "# Abendplan\n"
    assert download.headers["content-disposition"] == 'attachment; filename="abend.md"'
    assert download.headers["content-type"].startswith("text/plain")
    assert download.headers["x-content-type-options"] == "nosniff"
    assert deleted.status_code == 200 and after == []


@pytest.mark.parametrize("path", ["/api/files/plan/..%2Fx.md", "/api/files/config/a.md", "/api/files/plan/.env"])
async def test_file_paths_outside_the_store_are_rejected(tmp_path, path):
    app, *_ = make(tmp_path)
    async with client(app) as http:
        assert (await http.get(path)).status_code in (400, 404)


async def test_file_delete_needs_ui_header_and_same_origin(tmp_path):
    app, files, _ = make(tmp_path)
    files.save("script", "a.sh", "echo")
    async with client(app) as http:
        forged = await http.delete("/api/files/script/a.sh", headers={"Origin": "http://evil.example", "X-HA-MCP-UI": "1"})
        bare = await http.delete("/api/files/script/a.sh")
    assert forged.status_code == 403 and bare.status_code == 403
    assert files.read("script", "a.sh") == "echo"


async def test_code_blocks_in_a_chat_answer_are_saved_as_scripts(tmp_path):
    async def runner(settings, prompt, history, allow_write, approve, on_event):
        return "Hier:\n```yaml\nalias: Flurlicht\n```\nFertig."

    app, files, _ = make(tmp_path, runner)
    async with client(app) as http:
        await configure(http)
        run_id = (await http.post("/api/chat", headers=HEADERS, json={"message": "Schreib eine Automation"})).json()["run_id"]
        events = await poll_until_done(http, run_id)
    saved = next(event for event in events if event["type"] == "files_saved")
    [item] = files.entries()
    assert item["kind"] == "script" and item["name"].endswith(".yaml") and saved["files"][0]["name"] == item["name"]
    assert files.read("script", item["name"]) == "alias: Flurlicht\n"


async def test_a_requested_plan_is_saved_as_markdown(tmp_path):
    plan = "1. Bestand prüfen\n2. Bereiche anlegen\n3. Geräte zuordnen\n" + "Begründung. " * 20

    async def runner(settings, prompt, history, allow_write, approve, on_event):
        return plan

    app, files, _ = make(tmp_path, runner)
    async with client(app) as http:
        await configure(http)
        run_id = (await http.post("/api/chat", headers=HEADERS, json={"message": "Erstelle einen Plan für die Bereiche"})).json()["run_id"]
        await poll_until_done(http, run_id)
    [item] = files.entries()
    assert item["kind"] == "plan" and item["name"].endswith(".md")
    content = files.read("plan", item["name"])
    assert content.startswith("# Plan") and "Erstelle einen Plan für die Bereiche" in content and plan.strip() in content


async def test_ordinary_answers_are_not_stored(tmp_path):
    app, files, _ = make(tmp_path)
    async with client(app) as http:
        await configure(http)
        run_id = (await http.post("/api/chat", headers=HEADERS, json={"message": "Ist das Licht an?"})).json()["run_id"]
        await poll_until_done(http, run_id)
    assert files.entries() == []


async def test_audit_log_is_listed_and_can_be_cleared(tmp_path):
    app, _, audit = make(tmp_path)
    audit.record(kind="ha", tool="ha_get_state", channel="rest", method="GET",
                 route="/api/states/person.example_user", status=200, ok=True, ms=5)
    async with client(app) as http:
        listed = (await http.get("/api/audit")).json()
        forged = await http.delete("/api/audit", headers={"Origin": "http://evil.example", "X-HA-MCP-UI": "1"})
        cleared = await http.delete("/api/audit", headers=HEADERS)
        after = (await http.get("/api/audit")).json()
    assert listed["retention_days"] == 30 and listed["entries"][0]["route"] == "/api/states/{entity_id}"
    assert "example_user" not in str(listed)
    assert forged.status_code == 403
    assert cleared.json() == {"deleted": 1} and after["entries"] == []


async def test_chat_runner_passes_the_audit_location_to_the_mcp_server(tmp_path, monkeypatch):
    from ha_safe_mcp import web
    captured = {}

    def fake_params(env):
        captured.update(env)
        raise RuntimeError("stop here")

    monkeypatch.setattr(web, "mcp_parameters_for", fake_params)
    settings = SettingsStore(tmp_path / ".env").load()
    with pytest.raises(RuntimeError):
        await web.mcp_chat_runner(settings, "x", [], False, None, None, credentials_dir=tmp_path / "c",
                                  audit_dir=tmp_path / "a")
    assert captured["HA_AUDIT_DIR"] == str(tmp_path / "a") and "HA_FILES_DIR" not in captured


def test_a_refusal_to_a_plan_request_is_not_stored_as_a_plan(tmp_path):
    from ha_safe_mcp.web import store_generated_files
    files = FileStore(tmp_path / "files")
    refusal = ("Da keine Licht- oder Schalt-Entitäten in Home Assistant gefunden wurden, kann keine Automation "
               "erstellt werden. Bitte stelle sicher, dass Geräte eingerichtet sind. " * 2)
    assert store_generated_files(files, "Erstelle einen Plan für das Flurlicht", refusal) == []
    assert files.entries() == []
