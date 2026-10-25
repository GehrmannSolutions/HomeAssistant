"""HACS through the MCP: search, details, install/update, remove, custom repositories (HACS 2.0.5 websocket API)."""
import pytest

from ha_safe_mcp.hacs import HAHacs
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"


def repo(id_, full_name, category="plugin", installed=False, version=None, stars=100, **extra):
    return {"id": id_, "full_name": full_name, "name": full_name.split("/")[1], "category": category,
            "description": f"{full_name} description", "stars": stars, "downloads": 10, "installed": installed,
            "installed_version": version, "available_version": "v2.0.0", "pending_upgrade": False,
            "topics": ["lovelace"], "authors": ["@a"], "last_updated": "2026-09-01T00:00:00Z", "can_download": True,
            "custom": False, "local_path": f"/config/www/community/{full_name.split('/')[1]}", **extra}


class FakeWS:
    def __init__(self, hacs=True):
        self.hacs = hacs
        self.repos = [repo("111", "thomasloven/lovelace-card-mod", stars=5000),
                      repo("222", "thomasloven/lovelace-auto-entities", stars=1500),
                      repo("333", "piitaya/lovelace-mushroom", installed=True, version="v5.2.3", stars=4000),
                      repo("444", "someone/heating-integration", category="integration", stars=50),
                      repo("555", "old/card", stars=10, can_download=False, homeassistant="2099.1.0")]
        self.calls = []

    async def command(self, kind, payload=None):
        payload = payload or {}
        self.calls.append((kind, payload))
        if not self.hacs:
            raise RuntimeError("Home Assistant WebSocket error: unknown_command")
        if kind == "hacs/repositories/list":
            return [dict(r) for r in self.repos]
        if kind == "hacs/repository/info":
            item = next((r for r in self.repos if r["id"] == payload["repository_id"]), None)
            if item is None:
                raise RuntimeError("Home Assistant WebSocket error: repository_not_found")
            return {**item, "releases": ["v2.0.0", "v1.9.0"], "issues": 3, "default_branch": "main"}
        if kind == "hacs/repository/download":
            item = next(r for r in self.repos if r["id"] == payload["repository"])
            item.update(installed=True, installed_version=payload.get("version") or item["available_version"])
            return {}
        if kind == "hacs/repository/remove":
            item = next(r for r in self.repos if r["id"] == payload["repository"])
            item.update(installed=False, installed_version=None)
            return {}
        if kind == "hacs/repositories/add":
            full_name = payload["repository"].removeprefix("https://github.com/")
            if full_name == "nobody/broken":
                return {}  # HACS answers {} and only logs the error
            self.repos.append(repo("999", full_name, category=payload["category"], custom=True))
            return {}
        raise AssertionError(kind)


def make(ws=None, *, admin=True, delete=False):
    return HAHacs(HAClient(URL, "t", allow_write=True), ws or FakeWS(), allow_admin_write=admin, allow_delete=delete)


async def test_search_finds_by_name_description_and_topic_sorted_by_stars():
    result = await make().search("lovelace")
    names = [r["full_name"] for r in result["repositories"]]
    assert names[:3] == ["thomasloven/lovelace-card-mod", "piitaya/lovelace-mushroom",
                         "thomasloven/lovelace-auto-entities"]
    only_integrations = await make().search("", category="integration")
    assert [r["full_name"] for r in only_integrations["repositories"]] == ["someone/heating-integration"]
    with pytest.raises(ValueError, match="category"):
        await make().search("x", category="malware")


async def test_search_is_forgiving_and_puts_name_hits_and_popular_ones_first():
    ws = FakeWS()
    ws.repos += [repo("601", "kalkih/mini-graph-card", stars=3900, description="Minimalistic graph card"),
                 repo("602", "dbuezas/plotly-graph-card", stars=660, description="Plotly history graph card"),
                 repo("603", "someone/better_thermostat", category="integration", stars=1500,
                      description="Smart TRV control"),
                 repo("604", "other/better-ui", category="integration", stars=9000, description="A better UI")]
    graphs = await make(ws).search("history graphs card", category="plugin")
    assert [r["full_name"] for r in graphs["repositories"]][:2] == ["kalkih/mini-graph-card",
                                                                     "dbuezas/plotly-graph-card"]
    thermostat = await make(ws).search("better thermostat")
    assert thermostat["repositories"][0]["full_name"] == "someone/better_thermostat"


async def test_remove_hint_fits_the_category():
    ws = FakeWS()
    card = await make(ws, delete=True).remove("piitaya/lovelace-mushroom")
    assert "dashboard" in card["next"] and "integration" not in card["next"]


async def test_without_hacs_the_answer_says_so():
    with pytest.raises(ValueError, match="HACS is not installed"):
        await make(FakeWS(hacs=False)).search("x")


async def test_get_accepts_full_name_or_id_and_explains_what_install_does():
    by_name = await make().get("Thomasloven/Lovelace-Card-Mod")
    by_id = await make().get("111")
    assert by_name["repository"]["id"] == by_id["repository"]["id"] == "111"
    assert by_name["repository"]["releases"][:1] == ["v2.0.0"]
    assert "dashboard resource" in by_name["install_impact"]
    integration = await make().get("someone/heating-integration")
    assert "restart" in integration["install_impact"] and "third-party code" in integration["install_impact"]
    with pytest.raises(ValueError, match="not found"):
        await make().get("nobody/nothing")


async def test_install_needs_admin_and_reads_back():
    ws = FakeWS()
    with pytest.raises(ValueError, match="admin write"):
        await make(ws, admin=False).install("thomasloven/lovelace-card-mod")
    result = await make(ws).install("thomasloven/lovelace-card-mod")
    assert ("hacs/repository/download", {"repository": "111"}) in ws.calls
    assert result["installed"] is True and result["installed_version"] == "v2.0.0"
    assert "/hacsfiles/lovelace-card-mod" in result["next"]
    pinned = await make(ws).install("222", version="v1.9.0")
    assert pinned["installed_version"] == "v1.9.0"


async def test_install_refuses_what_hacs_cannot_download():
    ws = FakeWS()
    with pytest.raises(ValueError, match="2099.1.0"):
        await make(ws).install("old/card")
    assert not any(kind == "hacs/repository/download" for kind, _ in ws.calls)


async def test_integration_install_says_restart():
    result = await make().install("someone/heating-integration")
    assert "ha_restart" in result["next"] and "ha_start_integration_setup" in result["next"]


async def test_remove_needs_delete_and_an_installed_repository():
    ws = FakeWS()
    with pytest.raises(ValueError, match="delete"):
        await make(ws).remove("piitaya/lovelace-mushroom")
    with pytest.raises(ValueError, match="not installed"):
        await make(ws, delete=True).remove("thomasloven/lovelace-card-mod")
    result = await make(ws, delete=True).remove("piitaya/lovelace-mushroom")
    assert result["removed"] is True and ("hacs/repository/remove", {"repository": "333"}) in ws.calls


async def test_custom_repository_only_from_github_and_confirmed():
    ws = FakeWS()
    with pytest.raises(ValueError, match="GitHub"):
        await make(ws).add_custom("https://evil.example/x/y", "plugin")
    with pytest.raises(ValueError, match="category"):
        await make(ws).add_custom("owner/repo", "nonsense")
    added = await make(ws).add_custom("https://github.com/owner/new-card", "plugin")
    assert added["repository"]["full_name"] == "owner/new-card" and added["repository"]["custom"] is True
    with pytest.raises(RuntimeError, match="could not add"):
        await make(ws).add_custom("nobody/broken", "plugin")


async def test_install_is_journaled_and_undo_removes_or_restores_the_version(tmp_path):
    from ha_safe_mcp.changes import ChangeJournal, Changes
    ws = FakeWS()
    hacs = make(ws, delete=True)
    changes = Changes(ChangeJournal(tmp_path), admin=None, scenes=None, registry=None, integrations=None, hacs=hacs)
    _, new_id = await changes.apply("ha_install_hacs_repository", "hacs", "thomasloven/lovelace-card-mod",
                                    lambda: hacs.install("thomasloven/lovelace-card-mod"))
    await changes.undo(new_id)
    assert next(r for r in ws.repos if r["id"] == "111")["installed"] is False
    _, update_id = await changes.apply("ha_install_hacs_repository", "hacs", "piitaya/lovelace-mushroom",
                                       lambda: hacs.install("piitaya/lovelace-mushroom"))
    assert next(r for r in ws.repos if r["id"] == "333")["installed_version"] == "v2.0.0"
    await changes.undo(update_id)
    assert next(r for r in ws.repos if r["id"] == "333")["installed_version"] == "v5.2.3"


def test_levels_and_card():
    from ha_safe_mcp.ollama_client import ALWAYS_ASK, CARD_DETAILS, write_level
    assert write_level("ha_search_hacs") is None and write_level("ha_get_hacs_repository") is None
    assert write_level("ha_install_hacs_repository") == "admin"
    assert write_level("ha_add_hacs_custom_repository") == "admin"
    assert write_level("ha_remove_hacs_repository") == "delete"
    assert "ha_install_hacs_repository" in ALWAYS_ASK
    assert CARD_DETAILS["ha_install_hacs_repository"][0] == "ha_get_hacs_repository"
