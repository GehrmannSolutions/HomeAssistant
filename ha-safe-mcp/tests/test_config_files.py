"""Reading and editing Home Assistant configuration files (local dir on dev, File editor add-on via ingress on prod)."""
import asyncio
import os

import httpx
import pytest
import respx

from ha_safe_mcp.changes import ChangeJournal, Changes
from ha_safe_mcp.config_files import ConfigFiles, IngressFiles, LocalFiles, mask, unmask
from ha_safe_mcp.management import HAWebSocket
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"

CONFIG = """homeassistant:
  name: Home
http:
  use_x_forwarded_for: true
mqtt_login:
  password: hunter2  # old broker
  api_key: !secret broker_key
camera:
  - platform: generic
    still_image_url: http://admin:topsecret@cam.local/snap.jpg
template:
  - sensor:
      - name: token count
        state: "{{ 1 }}"
"""


class Checker:
    def __init__(self, results=None):
        self.results = list(results or [])
        self.calls = 0

    async def __call__(self):
        self.calls += 1
        return self.results.pop(0) if self.results else {"result": "valid", "errors": None}


def make(tmp_path, *, write=True, admin=True, delete=False, checker=None, files=None):
    root = tmp_path / "config"
    root.mkdir(exist_ok=True)
    for name, text in (files or {"configuration.yaml": CONFIG}).items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    client = HAClient(URL, "t", allow_write=write)
    return ConfigFiles(client, None, allow_admin_write=admin, allow_delete=delete, backend=LocalFiles(root),
                       checker=checker or Checker()), root


# ------------------------------------------------------------------ paths
@pytest.mark.parametrize("path", ["../x.yaml", "/etc/passwd", ".storage/auth", "secrets.yaml", "packages/secrets.yaml",
                                  "home-assistant_v2.db", "home-assistant.log", "deps/a.yaml", "a\\b.yaml",
                                  "google_service_account.json", "x.pem", "", "packages/../configuration.yaml",
                                  "a//b.yaml", "tts/x.txt", "backups/x.json", "configuration.yaml\x00"])
async def test_forbidden_paths(tmp_path, path):
    files, _ = make(tmp_path)
    with pytest.raises(ValueError):
        await files.read(path)


async def test_symlinks_out_of_the_config_dir_are_refused(tmp_path):
    files, root = make(tmp_path)
    (tmp_path / "outside.yaml").write_text("a: 1\n")
    os.symlink(tmp_path / "outside.yaml", root / "link.yaml")
    with pytest.raises(ValueError, match="symlink"):
        await files.read("link.yaml")


async def test_listing_hides_hidden_entries_and_marks_protected_files(tmp_path):
    files, root = make(tmp_path, files={"configuration.yaml": CONFIG, "secrets.yaml": "x: y\n",
                                        ".storage/core.config": "{}", "packages/a.yaml": "a: 1\n",
                                        "home-assistant_v2.db": "x"})
    listing = await files.list("")
    names = {e["name"]: e for e in listing["entries"]}
    assert ".storage" not in names and "packages" in names and names["packages"]["type"] == "dir"
    assert names["secrets.yaml"]["readable"] is False and names["configuration.yaml"]["readable"] is True
    assert names["home-assistant_v2.db"]["readable"] is False
    assert [e["name"] for e in (await files.list("packages"))["entries"]] == ["a.yaml"]


# ------------------------------------------------------------------ secrets
def test_mask_hides_inline_credentials_but_keeps_references_and_templates():
    masked, values = mask(CONFIG)
    assert "hunter2" not in masked and "topsecret" not in masked
    assert "password: __REDACTED_1__  # old broker" in masked
    assert "api_key: !secret broker_key" in masked
    assert "http://admin:__REDACTED_2__@cam.local" in masked
    assert 'state: "{{ 1 }}"' in masked and "use_x_forwarded_for: true" in masked
    assert unmask(masked, values) == CONFIG
    json_masked, _ = mask('{"access_token": "abc", "name": "x"}')
    assert json_masked == '{"access_token": "__REDACTED_1__", "name": "x"}'


def test_unknown_placeholders_are_refused():
    with pytest.raises(ValueError, match="!secret"):
        unmask("password: __REDACTED_7__\n", {})


async def test_read_returns_masked_text(tmp_path):
    files, _ = make(tmp_path)
    result = await files.read("configuration.yaml")
    assert "hunter2" not in result["content"] and result["redacted"] == 2 and result["lines"] == CONFIG.count("\n")


# ------------------------------------------------------------------ writes
async def test_writes_need_the_admin_level(tmp_path):
    files, root = make(tmp_path, admin=False)
    with pytest.raises(ValueError, match="admin"):
        await files.write("packages/a.yaml", "a: 1\n")
    assert not (root / "packages").exists()


async def test_edit_keeps_secrets_and_checks_the_config(tmp_path):
    checker = Checker()
    files, root = make(tmp_path, checker=checker)
    result = await files.edit("configuration.yaml", "name: Home", "name: Zuhause")
    text = (root / "configuration.yaml").read_text()
    assert "name: Zuhause" in text and "password: hunter2" in text and "admin:topsecret@" in text
    assert result["config_check"]["result"] == "valid" and checker.calls == 2  # before and after
    assert "reload" in result["next"]


async def test_edit_needs_a_unique_match(tmp_path):
    files, _ = make(tmp_path)
    with pytest.raises(ValueError, match="not found"):
        await files.edit("configuration.yaml", "name: Nowhere", "x")
    with pytest.raises(ValueError, match=r"\d+ times"):
        await files.edit("configuration.yaml", "  - ", "  -  ")


async def test_invalid_yaml_is_refused_before_writing(tmp_path):
    files, root = make(tmp_path)
    with pytest.raises(ValueError, match="YAML"):
        await files.write("configuration.yaml", "a: [1, 2\n")
    assert (root / "configuration.yaml").read_text() == CONFIG


async def test_ha_tags_are_valid_yaml(tmp_path):
    files, root = make(tmp_path)
    await files.write("packages/p.yaml", "sensor: !include sensors.yaml\nkey: !secret k\nb: !input x\n")
    assert (root / "packages/p.yaml").read_text().startswith("sensor: !include")


async def test_a_failed_config_check_restores_the_file(tmp_path):
    checker = Checker([{"result": "valid", "errors": None}, {"result": "invalid", "errors": "Integration error: foo"}])
    files, root = make(tmp_path, checker=checker)
    with pytest.raises(ValueError, match="Integration error: foo.*restored"):
        await files.edit("configuration.yaml", "name: Home", "foo:\n  bar: 1\n  name: Home")
    assert (root / "configuration.yaml").read_text() == CONFIG


async def test_a_failed_check_removes_a_new_file_again(tmp_path):
    checker = Checker([{"result": "valid", "errors": None}, {"result": "invalid", "errors": "bad"}])
    files, root = make(tmp_path, checker=checker)
    with pytest.raises(ValueError, match="removed again"):
        await files.write("packages/new.yaml", "foo: 1\n")
    assert not (root / "packages/new.yaml").exists()


async def test_new_warnings_also_restore_the_file(tmp_path):
    # HA reports a package with an unknown integration as result "valid" plus a warning
    warn = {"result": "valid", "errors": None,
            "warnings": "Setup of package 'p' failed: Integration 'nope' not found."}
    files, root = make(tmp_path, checker=Checker([{"result": "valid", "errors": None, "warnings": None}, warn]))
    with pytest.raises(ValueError, match="warning.*Setup of package"):
        await files.edit("configuration.yaml", "name: Home", "name: Zuhause")
    assert (root / "configuration.yaml").read_text() == CONFIG


async def test_errors_that_existed_before_do_not_block_a_write(tmp_path):
    same = {"result": "invalid", "errors": "old problem"}
    files, root = make(tmp_path, checker=Checker([same, same]))
    result = await files.write("packages/x.yaml", "x: 1\n")
    assert result["config_check"]["result"] == "invalid" and "existed before" in result["config_check"]["note"]
    assert (root / "packages/x.yaml").exists()


async def test_empty_files_and_large_files_are_refused(tmp_path):
    files, _ = make(tmp_path)
    with pytest.raises(ValueError, match="empty"):
        await files.write("packages/x.yaml", "")
    with pytest.raises(ValueError, match="too large"):
        await files.write("packages/x.yaml", "a: 1\n" * 100_000)


async def test_delete_needs_the_delete_level(tmp_path):
    files, root = make(tmp_path, files={"packages/a.yaml": "a: 1\n"})
    with pytest.raises(ValueError, match="delete"):
        await files.delete("packages/a.yaml")
    files.allow_delete = True
    assert (await files.delete("packages/a.yaml"))["deleted"] is True and not (root / "packages/a.yaml").exists()


# ------------------------------------------------------------------ journal and undo
async def test_writes_are_journaled_and_undone(tmp_path):
    files, root = make(tmp_path, delete=True)
    journal = ChangeJournal(tmp_path / "journal")
    changes = Changes(journal, admin=None, scenes=None, registry=None, integrations=None, config_files=files)
    _, edit_id = await changes.apply("ha_edit_config_file", "file", "configuration.yaml",
                                     lambda: files.edit("configuration.yaml", "name: Home", "name: Zuhause"))
    _, new_id = await changes.apply("ha_write_config_file", "file", "packages/new.yaml",
                                    lambda: files.write("packages/new.yaml", "a: 1\n"))
    await changes.undo(new_id)
    assert not (root / "packages/new.yaml").exists()
    await changes.undo(edit_id)
    assert (root / "configuration.yaml").read_text() == CONFIG
    _, del_id = await changes.apply("ha_delete_config_file", "file", "configuration.yaml",
                                    lambda: files.delete("configuration.yaml"))
    await changes.undo(del_id)
    assert (root / "configuration.yaml").read_text() == CONFIG


# ------------------------------------------------------------------ prod: File editor add-on via ingress
class IngressWS:
    def __init__(self):
        self.sessions = 0

    async def command(self, kind, payload=None, **_):
        assert kind == "supervisor/api"
        endpoint, method = payload["endpoint"], payload["method"]
        if (endpoint, method) == ("/addons", "get"):
            return {"addons": [{"slug": "core_configurator", "name": "File editor", "state": "started"}]}
        if (endpoint, method) == ("/addons/core_configurator/info", "get"):
            return {"ingress": True, "ingress_entry": "/api/hassio_ingress/tok"}
        if (endpoint, method) == ("/ingress/session", "post"):
            self.sessions += 1
            return {"session": f"s{self.sessions}"}
        raise AssertionError(payload)


@respx.mock(assert_all_called=False)
async def test_ingress_backend_reads_writes_and_creates_folders(respx_mock):
    base = URL + "/api/hassio_ingress/tok"
    tree = {"/homeassistant": [{"name": "configuration.yaml", "type": "file", "size": 20}],
            "/homeassistant/packages": None}
    saved, folders = {}, []

    def listdir(request):
        assert request.headers["cookie"].startswith("ingress_session=s")
        path = request.url.params["path"]
        if tree.get(path) is None:
            return httpx.Response(200, json={"error": "not a dir"})
        return httpx.Response(200, json={"content": tree[path], "abspath": path, "error": None})

    def save(request):
        form = dict(httpx.QueryParams(request.content.decode()))
        saved[form["filename"]] = form["text"]
        return httpx.Response(200, json={"error": False, "message": "File saved successfully"})

    def newfolder(request):
        form = dict(httpx.QueryParams(request.content.decode()))
        folders.append(form["path"] + "/" + form["name"])
        tree["/homeassistant/packages"] = []
        return httpx.Response(200, json={"error": False})

    respx_mock.get(base + "/api/listdir").mock(side_effect=listdir)
    respx_mock.get(base + "/api/file").mock(return_value=httpx.Response(200, text="homeassistant:\n  name: x\n"))
    respx_mock.post(base + "/api/save").mock(side_effect=save)
    respx_mock.post(base + "/api/newfolder").mock(side_effect=newfolder)
    backend = IngressFiles(HAClient(URL, "t"), IngressWS())
    assert await backend.read_raw("configuration.yaml") == "homeassistant:\n  name: x\n"
    assert await backend.read_raw("missing.yaml") is None
    await backend.write_raw("packages/heat.yaml", "a: 1\n")
    assert folders == ["/homeassistant/packages"] and saved == {"/homeassistant/packages/heat.yaml": "a: 1\n"}


@respx.mock(assert_all_called=False)
async def test_ingress_backend_creates_missing_nested_folders_when_listing_them_is_not_json(respx_mock):
    """Found on prod: for a folder that does not exist the real add-on answers listdir without JSON."""
    base = URL + "/api/hassio_ingress/tok"
    tree = {"/homeassistant": [{"name": "www", "type": "dir", "size": None}], "/homeassistant/www": []}
    saved, folders = {}, []

    def listdir(request):
        path = request.url.params["path"]
        if path not in tree:
            return httpx.Response(200, text="")  # what the add-on really returns
        return httpx.Response(200, json={"content": tree[path], "abspath": path, "error": None})

    def newfolder(request):
        form = dict(httpx.QueryParams(request.content.decode()))
        new = form["path"] + "/" + form["name"]
        folders.append(new)
        tree[form["path"]].append({"name": form["name"], "type": "dir"})
        tree[new] = []
        return httpx.Response(200, json={"error": False})

    def save(request):
        form = dict(httpx.QueryParams(request.content.decode()))
        saved[form["filename"]] = form["text"]
        return httpx.Response(200, json={"error": False, "message": "File saved successfully"})

    respx_mock.get(base + "/api/listdir").mock(side_effect=listdir)
    respx_mock.post(base + "/api/newfolder").mock(side_effect=newfolder)
    respx_mock.post(base + "/api/save").mock(side_effect=save)
    backend = IngressFiles(HAClient(URL, "t"), IngressWS())
    assert await backend.read_raw("www/floorplan/plans/eg.svg") is None
    assert await backend.listdir("www/floorplan") is None
    await backend.write_raw("www/floorplan/plans/eg.svg", "<svg/>")
    assert folders == ["/homeassistant/www/floorplan", "/homeassistant/www/floorplan/plans"]
    assert saved == {"/homeassistant/www/floorplan/plans/eg.svg": "<svg/>"}


async def test_without_file_access_the_tools_say_how_to_get_it(monkeypatch):
    monkeypatch.delenv("HA_CONFIG_DIR", raising=False)

    class NoSupervisor:
        async def command(self, *a, **k):
            raise RuntimeError("Home Assistant WebSocket error: unknown_command")
    files = ConfigFiles(HAClient(URL, "t"), NoSupervisor(), allow_admin_write=False, allow_delete=False)
    with pytest.raises(ValueError, match="File editor"):
        await files.read("configuration.yaml")


async def test_the_websocket_gate_allows_only_the_file_editor_session_calls():
    ws = HAWebSocket(HAClient(URL, "t"))
    for payload in ({"endpoint": "/addons/core_mosquitto/info", "method": "get"},
                    {"endpoint": "/ingress/session", "method": "get"},
                    {"endpoint": "/ingress/validate_session", "method": "post"}):
        with pytest.raises(ValueError, match="supervisor"):
            await ws.command("supervisor/api", payload)


# ------------------------------------------------------------------ tools
def test_tools_are_registered_and_classified():
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names, write_level
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_list_config_files", "ha_read_config_file"} <= names & READ_TOOLS
    assert write_level("ha_write_config_file") == write_level("ha_edit_config_file") == "admin"
    assert write_level("ha_delete_config_file") == "delete"
    assert "ha_read_config_file" in select_tool_names("Zeig mir die configuration.yaml", names, allow_write=False)
    assert "ha_edit_config_file" in select_tool_names("Ändere in der YAML-Datei den Namen", names, allow_write=True)


async def test_get_change_never_shows_secrets_of_files(tmp_path, monkeypatch):
    from ha_safe_mcp.server import create_server
    root = tmp_path / "config"
    root.mkdir()
    (root / "configuration.yaml").write_text(CONFIG)
    monkeypatch.setenv("HA_CONFIG_DIR", str(root))
    monkeypatch.setenv("HA_CHANGES_DIR", str(tmp_path / "journal"))
    journal = ChangeJournal(tmp_path / "journal")
    change_id = journal.record(kind="file", target="configuration.yaml", before={"content": CONFIG},
                               tool="ha_edit_config_file")
    server = create_server(HAClient(URL, "t"))
    result = await server.call_tool("ha_get_change", {"change_id": change_id})
    text = str(result)
    assert "hunter2" not in text and "topsecret" not in text and "__REDACTED_1__" in text


def test_files_under_www_are_active_right_away():
    from ha_safe_mcp.config_files import NEXT, next_step
    assert next_step("www/floorplan/eg.svg").startswith("active right away: Home Assistant serves it as /local/floorplan/eg.svg")
    assert next_step("packages/heat.yaml") == NEXT
