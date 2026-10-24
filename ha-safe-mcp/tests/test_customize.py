"""Blueprints, themes and dashboard resources: gated writes, read-back, journal and undo."""
import copy
from datetime import datetime, timezone

import pytest

from ha_safe_mcp.changes import ChangeJournal, Changes
from ha_safe_mcp.customize import HACustomize
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
BP_URL = "https://example.invalid/motion_light.yaml"
RAW = "blueprint:\n  name: Motion light\n  domain: automation\n"


class FakeWS:
    def __init__(self):
        self.calls = []
        self.blueprints = {"automation": {"homeassistant/notify.yaml": {"metadata": {
            "name": "Notify", "domain": "automation", "input": {"device": {}, "message": {}},
            "source_url": "https://example.invalid/notify.yaml"}}}}
        self.themes = {"themes": {"Nord": {}, "Solar": {}}, "default_theme": "default", "default_dark_theme": None}
        self.resources = [{"id": "r1", "url": "/hacsfiles/mini-graph-card.js", "type": "module"}]

    async def command(self, kind, payload=None, **_):
        payload = copy.deepcopy(payload or {})
        self.calls.append((kind, payload))
        if kind == "blueprint/list":
            return copy.deepcopy(self.blueprints.get(payload["domain"], {}))
        if kind == "blueprint/import":
            path = "example/motion_light.yaml"
            return {"suggested_filename": "example/motion_light", "raw_data": RAW,
                    "blueprint": {"metadata": {"name": "Motion light", "domain": "automation",
                                               "input": {"motion": {}, "light": {}}, "source_url": payload["url"]}},
                    "validation_errors": None, "exists": path in self.blueprints["automation"]}
        if kind == "blueprint/save":
            self.blueprints.setdefault(payload["domain"], {})[payload["path"]] = {"metadata": {
                "name": "Motion light", "domain": payload["domain"], "input": {}, "source_url": payload.get("source_url")}}
            return {"overrides_existing": False}
        if kind == "blueprint/delete":
            del self.blueprints[payload["domain"]][payload["path"]]
            return None
        if kind == "frontend/get_themes":
            return copy.deepcopy(self.themes)
        if kind == "lovelace/resources":
            return copy.deepcopy(self.resources)
        if kind == "lovelace/resources/create":
            item = {"id": f"r{len(self.resources) + 2}", "url": payload["url"], "type": payload["res_type"]}
            self.resources.append(item)
            return copy.deepcopy(item)
        if kind == "lovelace/resources/delete":
            self.resources = [r for r in self.resources if r["id"] != payload["resource_id"]]
            return None
        raise AssertionError(kind)


class ThemeClient(HAClient):
    """frontend.set_theme updates the fake's theme state like HA does."""
    ws = None

    async def _request(self, method, path, **kwargs):
        assert (method, path) == ("POST", "/api/services/frontend/set_theme"), path
        data = kwargs["data"]
        key = "default_dark_theme" if data.get("mode") == "dark" else "default_theme"
        self.ws.themes[key] = None if data["name"] == "none" else data["name"]
        return []


def make(*, write=True, admin=True, delete=True):
    ws = FakeWS()
    client = ThemeClient(URL, "t", allow_write=write)
    client.ws = ws
    return HACustomize(client, ws, allow_admin_write=admin, allow_delete=delete), ws


def changes_for(tmp_path, customize):
    journal = ChangeJournal(tmp_path / "changes", now=lambda: datetime(2026, 10, 25, tzinfo=timezone.utc))
    return Changes(journal, admin=None, scenes=None, registry=None, integrations=None, customize=customize)


async def test_blueprints_are_listed_with_inputs():
    customize, _ = make(write=False)
    assert await customize.list_blueprints("automation") == [{
        "path": "homeassistant/notify.yaml", "name": "Notify", "inputs": ["device", "message"],
        "source_url": "https://example.invalid/notify.yaml"}]
    with pytest.raises(ValueError):
        await customize.list_blueprints("light")


async def test_blueprint_preview_and_save_from_url():
    customize, ws = make()
    preview = await customize.preview_blueprint(BP_URL)
    assert preview["path"] == "example/motion_light.yaml" and preview["inputs"] == ["light", "motion"]
    assert preview["yaml"].startswith("blueprint:") and preview["exists"] is False
    saved = await customize.save_blueprint(BP_URL)
    assert saved == {"domain": "automation", "path": "example/motion_light.yaml", "name": "Motion light"}
    assert ws.calls[-2][0] == "blueprint/save" and ws.calls[-2][1]["yaml"] == RAW
    with pytest.raises(ValueError, match="already exists"):
        await customize.save_blueprint(BP_URL)
    for bad in ("http://example.invalid/x.yaml", "file:///etc/passwd", "https://"):
        with pytest.raises(ValueError):
            await customize.preview_blueprint(bad)
    with pytest.raises(ValueError, match="path"):
        await customize.save_blueprint(BP_URL, path="../../secrets.yaml")


async def test_themes_list_and_set_with_read_back():
    customize, ws = make()
    assert await customize.list_themes() == {"themes": ["Nord", "Solar"], "default_theme": "default",
                                             "default_dark_theme": None}
    assert (await customize.set_theme("Nord"))["default_theme"] == "Nord"
    assert (await customize.set_theme("Solar", mode="dark"))["default_dark_theme"] == "Solar"
    with pytest.raises(ValueError, match="unknown theme"):
        await customize.set_theme("Gibtsnicht")
    with pytest.raises(ValueError, match="admin write disabled"):
        await make(admin=False)[0].set_theme("Nord")


async def test_resources_only_from_this_home_assistant():
    customize, ws = make()
    assert await customize.list_resources() == [{"id": "r1", "url": "/hacsfiles/mini-graph-card.js",
                                                 "type": "module"}]
    added = await customize.add_resource("/local/cards/my-card.js")
    assert added["url"] == "/local/cards/my-card.js" and added["type"] == "module"
    for bad in ("https://evil.invalid/x.js", "//evil.invalid/x.js", "/local/../config/secrets.yaml", "/api/x.js"):
        with pytest.raises(ValueError):
            await customize.add_resource(bad)
    with pytest.raises(ValueError, match="delete disabled"):
        await make(delete=False)[0].delete_resource("r1")
    assert await customize.delete_resource(added["id"]) == {"deleted": True}


async def test_undo_blueprint_save_theme_and_resources(tmp_path):
    customize, ws = make()
    changes = changes_for(tmp_path, customize)
    _, saved = await changes.apply("ha_save_blueprint", "blueprint", None, lambda: customize.save_blueprint(BP_URL),
                                   target_from=lambda r: f"{r['domain']}/{r['path']}")
    await changes.undo(saved)
    assert "example/motion_light.yaml" not in ws.blueprints["automation"]

    _, deleted = await changes.apply("ha_delete_blueprint", "blueprint", "automation/homeassistant/notify.yaml",
                                     lambda: customize.delete_blueprint("automation", "homeassistant/notify.yaml"))
    assert "homeassistant/notify.yaml" not in ws.blueprints["automation"]
    await changes.undo(deleted)
    assert "homeassistant/notify.yaml" in ws.blueprints["automation"]
    assert ("blueprint/import", {"url": "https://example.invalid/notify.yaml"}) in ws.calls[-5:]  # from its source

    _, theme = await changes.apply("ha_set_theme", "theme", "light", lambda: customize.set_theme("Nord"))
    await changes.undo(theme)
    assert ws.themes["default_theme"] == "default"

    _, removed = await changes.apply("ha_delete_dashboard_resource", "resource", "r1",
                                     lambda: customize.delete_resource("r1"))
    result = await changes.undo(removed)
    assert [r["url"] for r in ws.resources] == ["/hacsfiles/mini-graph-card.js"] and result["target"] != "r1"


def test_tools_have_the_right_levels():
    import asyncio
    from ha_safe_mcp.ollama_client import DELETE_TOOLS, READ_TOOLS, WRITE_TOOLS
    from ha_safe_mcp.remote import tool_level
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    read = {"ha_list_blueprints", "ha_list_themes", "ha_list_dashboard_resources"}
    admin = {"ha_preview_blueprint", "ha_save_blueprint", "ha_set_theme", "ha_add_dashboard_resource"}
    delete = {"ha_delete_blueprint", "ha_delete_dashboard_resource"}
    assert read | admin | delete <= names and read <= READ_TOOLS and admin | delete <= WRITE_TOOLS
    assert delete <= DELETE_TOOLS
    assert {tool_level(n) for n in admin} == {"admin"} and {tool_level(n) for n in delete} == {"delete"}
