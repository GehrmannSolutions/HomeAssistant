"""The built-in Marketplace of Home Assistant 2026.11 (HACS moved into Core): the same MCP tools, other websocket API.

Source: HA Core 2026.11.0b6 components/marketplace/websocket/{repositories,repository}.py
(``marketplace/repositories/list``, ``marketplace/repository/info`` {repository_id}, ``marketplace/repository/install``
{repository, version?}, ``marketplace/repository/uninstall`` {repository}, ``marketplace/repositories/add``
{repository, category}; install/add need the accepted Marketplace notice, add also a GitHub connection).
"""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.hacs import HAHacs
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"


def repo(id_, full_name, category="plugin", installed=False, version=None, stars=100, **extra):
    return {"id": id_, "full_name": full_name, "name": full_name.split("/")[1], "category": category,
            "description": f"{full_name} description", "stars": stars, "downloads": 10, "installed": installed,
            "installed_version": version, "available_version": "v2.0.0", "pending_upgrade": False,
            "topics": ["lovelace"], "authors": ["@a"], "last_updated": "2026-10-01T00:00:00Z", "can_install": True,
            "custom": False, "status": "installed" if installed else "default", "new": False,
            "local_path": f"/config/www/community/{full_name.split('/')[1]}", **extra}


class FakeMarketplace:
    """Speaks only the 2026.11 Marketplace API; every hacs/* command is unknown like on a migrated instance."""

    def __init__(self, *, warning_accepted=True, github=True):
        self.warning_accepted, self.github = warning_accepted, github
        self.repos = [repo("111", "thomasloven/lovelace-card-mod", stars=5000),
                      repo("333", "piitaya/lovelace-mushroom", installed=True, version="v5.2.3", stars=4000),
                      repo("444", "someone/heating-integration", category="integration", stars=50),
                      repo("555", "old/card", stars=10, can_install=False, homeassistant="2099.1.0")]
        self.calls = []
        self.issues = []   # repairs; the Marketplace raises 'restart_required_<id>_<ref>' when it needs one

    async def command(self, kind, payload=None, **_):
        payload = payload or {}
        self.calls.append((kind, payload))
        if kind.startswith("hacs/"):
            raise RuntimeError("Home Assistant WebSocket error: unknown_command")
        if kind == "marketplace/repositories/list":
            return [dict(r) for r in self.repos]
        if kind == "marketplace/info":   # per Home Assistant user: the user of the MCP's token
            return {"warning_accepted": self.warning_accepted, "github_connected": self.github, "stage": "running",
                    "version": "2026.11.0", "disabled_reason": None, "categories": ["integration", "plugin"]}
        if kind == "marketplace/repository/info":
            item = next(r for r in self.repos if r["id"] == payload["repository_id"])
            return {**item, "releases": ["v2.0.0", "v1.9.0"], "issues": 3, "default_branch": "main",
                    "update_entity_id": f"update.{item['name']}_update"}
        if kind in ("marketplace/repository/install", "marketplace/repositories/add") and not self.warning_accepted:
            raise RuntimeError("Home Assistant WebSocket error: warning_not_accepted (The Marketplace notice has "
                               "not been accepted)")
        if kind == "marketplace/repository/install":
            item = next(r for r in self.repos if r["id"] == payload["repository"])
            version = payload.get("version") or item["available_version"]
            if item["category"] == "integration" and (item["installed"] or not item.get("config_flow", True)):
                # code the loader already knows (update) or a YAML-only integration: core's integration.py
                self.issues.append({"domain": "marketplace", "issue_id": f"restart_required_{item['id']}_{version}",
                                    "severity": "warning", "is_fixable": True})
            item.update(installed=True, installed_version=version)
            return None
        if kind == "repairs/list_issues":
            return {"issues": list(self.issues)}
        if kind == "marketplace/repository/uninstall":
            item = next(r for r in self.repos if r["id"] == payload["repository"])
            item.update(installed=False, installed_version=None)
            return None
        if kind == "marketplace/repositories/add":
            if not self.github:
                raise RuntimeError("Home Assistant WebSocket error: github_not_connected (Connect GitHub first)")
            full_name = payload["repository"].removeprefix("https://github.com/")
            self.repos.append(repo("999", full_name, category=payload["category"], custom=True))
            return None
        raise AssertionError(kind)


def make(ws=None, *, admin=True, delete=False):
    return HAHacs(HAClient(URL, "t", allow_write=True), ws or FakeMarketplace(), allow_admin_write=admin,
                  allow_delete=delete)


async def test_search_uses_the_marketplace_and_says_so():
    ws = FakeMarketplace()
    result = await make(ws).search("lovelace")
    assert [r["full_name"] for r in result["repositories"]][:2] == ["thomasloven/lovelace-card-mod",
                                                                    "piitaya/lovelace-mushroom"]
    assert result["store"] == "marketplace"
    assert not any(kind.startswith("hacs/") for kind, _ in ws.calls[1:])  # detected once, then only marketplace


async def test_an_upgrade_from_hacs_to_the_marketplace_is_noticed_without_a_restart():
    ws = FakeMarketplace()
    hacs = make(ws)
    hacs.store = "hacs"   # learned before Home Assistant was upgraded to 2026.11 (long-lived remote MCP child)
    result = await hacs.search("mushroom")
    assert result["store"] == "marketplace"
    assert result["repositories"][0]["full_name"] == "piitaya/lovelace-mushroom"


async def test_get_reads_marketplace_details_and_maps_can_install():
    details = await make().get("old/card")
    assert details["repository"]["can_download"] is False   # the field the guard and the docs use
    full = await make().get("piitaya/lovelace-mushroom")
    assert full["repository"]["releases"][:1] == ["v2.0.0"] and full["store"] == "marketplace"


async def test_install_goes_through_the_marketplace_and_names_the_new_resource_path():
    ws = FakeMarketplace()
    result = await make(ws).install("thomasloven/lovelace-card-mod")
    assert ("marketplace/repository/install", {"repository": "111"}) in ws.calls
    assert result["installed"] is True and result["store"] == "marketplace"
    assert "/local/community/lovelace-card-mod" in result["next"]
    pinned = await make(ws).install("piitaya/lovelace-mushroom", version="v1.9.0")
    assert ("marketplace/repository/install", {"repository": "333", "version": "v1.9.0"}) in ws.calls
    assert pinned["installed_version"] == "v1.9.0"


async def test_a_new_marketplace_integration_needs_no_restart_but_an_update_does():
    ws = FakeMarketplace()
    new = await make(ws).install("someone/heating-integration")
    assert "ha_start_integration_setup" in new["next"] and "ha_restart" not in new["next"]
    ws.repos[2]["available_version"] = "v3.0.0"
    update = await make(ws).install("someone/heating-integration")
    assert "ha_restart" in update["next"] and "restart required" in update["next"]
    ws.repos.append(repo("666", "someone/yaml-only", category="integration", config_flow=False))
    yaml_only = await make(ws).install("someone/yaml-only")
    assert "ha_restart" in yaml_only["next"]


async def test_install_refuses_what_the_marketplace_cannot_install():
    ws = FakeMarketplace()
    with pytest.raises(ValueError, match="2099.1.0"):
        await make(ws).install("old/card")
    assert not any(kind == "marketplace/repository/install" for kind, _ in ws.calls)


async def test_the_notice_is_accepted_by_a_person_not_by_the_mcp():
    ws = FakeMarketplace(warning_accepted=False)
    with pytest.raises(ValueError, match="Settings > Marketplace") as err:
        await make(ws).install("thomasloven/lovelace-card-mod")
    assert "I understand the risks" in str(err.value) and "user of this MCP's token" in str(err.value)
    assert not any(kind == "marketplace/warning/accept" for kind, _ in ws.calls)


async def test_remove_uses_uninstall():
    ws = FakeMarketplace()
    with pytest.raises(ValueError, match="delete"):
        await make(ws).remove("piitaya/lovelace-mushroom")
    result = await make(ws, delete=True).remove("piitaya/lovelace-mushroom")
    assert result["removed"] is True and ("marketplace/repository/uninstall", {"repository": "333"}) in ws.calls


async def test_custom_repository_through_the_marketplace_and_github_hint():
    ws = FakeMarketplace()
    with pytest.raises(ValueError, match="integration, plugin, theme, template"):
        await make(ws).add_custom("owner/automations", "appdaemon")   # HACS knew it, the Marketplace does not
    assert not any(kind == "marketplace/repositories/add" for kind, _ in ws.calls)
    added = await make(ws).add_custom("https://github.com/owner/new-card", "plugin")
    assert ("marketplace/repositories/add", {"repository": "https://github.com/owner/new-card",
                                             "category": "plugin"}) in ws.calls
    assert added["repository"]["full_name"] == "owner/new-card"
    with pytest.raises(ValueError, match="GitHub"):
        await make(FakeMarketplace(github=False)).add_custom("owner/other", "plugin")


async def test_ecosystem_lists_marketplace_repositories():
    from ha_safe_mcp.ecosystem import HAEcosystem
    eco = HAEcosystem(HAClient(URL, "t"), FakeMarketplace())
    result = await eco.list_hacs()
    assert result["hacs_installed"] is True and result["store"] == "marketplace"
    assert [r["full_name"] for r in result["repositories"]] == ["piitaya/lovelace-mushroom"]
    assert result["marketplace"] == {"notice_accepted": True, "github_connected": True}
    blocked = await HAEcosystem(HAClient(URL, "t"), FakeMarketplace(warning_accepted=False)).list_hacs()
    assert blocked["marketplace"]["notice_accepted"] is False and "Settings > Marketplace" in blocked["hint"]


def test_websocket_allowlist_knows_the_marketplace_at_the_right_levels():
    from ha_safe_mcp.management import DELETE_TYPES, READ_TYPES, WRITE_TYPES
    assert {"marketplace/repositories/list", "marketplace/repository/info", "marketplace/info"} <= READ_TYPES
    assert {"marketplace/repository/install", "marketplace/repositories/add"} <= WRITE_TYPES
    assert "marketplace/repository/uninstall" in DELETE_TYPES
    assert "marketplace/warning/accept" not in READ_TYPES | WRITE_TYPES | DELETE_TYPES   # a person's consent


def test_small_models_find_the_tools_by_the_new_name():
    from ha_safe_mcp.ollama_client import READ_TOOLS, WRITE_TOOLS, select_tool_names
    names = set(READ_TOOLS | WRITE_TOOLS)
    assert "ha_search_hacs" in select_tool_names("Installiere eine Karte aus dem Marketplace", names, allow_write=True)
    assert "ha_list_hacs_repositories" in select_tool_names("what is installed from the marketplace?", names,
                                                            allow_write=False)
    assert "ha_search_hacs" in select_tool_names("Was gibt es im Marktplatz?", names, allow_write=False)


async def test_a_core_update_that_drops_the_connection_is_reported_as_started():
    from ha_safe_mcp.system import HASystem
    state = {"entity_id": "update.home_assistant_core_update", "state": "on",
             "attributes": {"installed_version": "2026.10.2", "latest_version": "2026.10.4"}}

    class NoWS:
        async def command(self, *_args, **_kwargs):
            raise AssertionError("no websocket needed")

    system = HASystem(HAClient(URL, "t", allow_write=True), NoWS(), allow_admin_write=True, allow_delete=True)
    with respx.mock(base_url=URL) as router:
        router.get("/api/states/update.home_assistant_core_update").mock(return_value=httpx.Response(200, json=state))
        install = router.post("/api/services/update/install").mock(
            side_effect=httpx.RemoteProtocolError("Server disconnected without sending a response."))
        result = await system.install_update("update.home_assistant_core_update")
    assert json.loads(install.calls[0].request.content) == {"entity_id": "update.home_assistant_core_update"}
    assert result["started"] is True and result["version"] == "2026.10.4" and "restart" in result["hint"]
