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
            if item["category"] == "integration" and not item.get("config_flow", True):   # YAML-only: core keeps it
                self.issues.append({"domain": "marketplace", "issue_id": f"restart_required_{item['id']}_uninstall"})
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


async def test_removing_a_marketplace_integration_follows_the_restart_repair():
    ws = FakeMarketplace()
    ws.repos[2].update(installed=True, installed_version="v1.0.0")              # config flow, no repair
    clean = await make(ws, delete=True).remove("someone/heating-integration")
    assert "ha_restart" not in clean["next"] and "config entries" in clean["next"]
    ws.repos.append(repo("777", "someone/yaml-thing", category="integration", installed=True, version="v1",
                         config_flow=False))
    yaml_only = await make(ws, delete=True).remove("someone/yaml-thing")
    assert "ha_restart" in yaml_only["next"]


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


async def test_adding_a_repository_that_is_already_in_the_store_points_to_install():
    ws = FakeMarketplace()
    with pytest.raises(ValueError, match="already in the Marketplace") as err:
        await make(ws).add_custom("thomasloven/lovelace-card-mod", "plugin")
    assert "ha_install_hacs_repository" in str(err.value)
    assert not any(kind == "marketplace/repositories/add" for kind, _ in ws.calls)
    with pytest.raises(ValueError, match="already installed"):
        await make(ws).add_custom("https://github.com/piitaya/lovelace-mushroom", "plugin")


async def test_tool_search_offers_the_install_tool_for_custom_component_words():
    from ha_safe_mcp.ollama_client import rank_tools
    from ha_safe_mcp.server import create_server
    server = create_server(HAClient(URL, "t", allow_write=True), allow_admin_write=True, allow_delete=True)
    tools = await server.list_tools()
    for query in ("custom component installation", "benutzerdefinierte Komponente installieren"):
        assert "ha_install_hacs_repository" in [t.name for t in rank_tools(query, tools)], query


async def test_a_confirmation_keeps_the_tools_of_the_previous_turn():
    from types import SimpleNamespace

    from ha_safe_mcp.ollama_client import run_chat
    names = ["ha_search_entities", "ha_get_state", "ha_search_hacs", "ha_get_hacs_repository",
             "ha_install_hacs_repository", "ha_list_dashboards"]

    class Session:
        async def list_tools(self):
            return SimpleNamespace(tools=[SimpleNamespace(name=n, description=n, inputSchema={"type": "object",
                                                                                            "properties": {}})
                                          for n in names])

        async def call_tool(self, name, arguments):
            raise AssertionError("no tool call expected")

    offered = []

    def respond(request):
        offered.append([t["function"]["name"] for t in json.loads(request.content)["tools"]])
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}})

    history = [{"role": "user", "content": "Installiere die mini-graph-card aus dem Marktplatz."},
               {"role": "assistant", "content": "Die Karte hat 3.910 Sterne. Soll ich sie installieren?"}]
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://ollama:11434") as http:
        await run_chat(Session(), http, "small", "Ja, installiere sie.", allow_write=True,
                       approve=lambda n, a: True, history=history)
        await run_chat(Session(), http, "small", "Ja, installiere sie.", allow_write=True,
                       approve=lambda n, a: True)
    assert "ha_install_hacs_repository" in offered[0]
    assert "ha_install_hacs_repository" not in offered[1]   # without the earlier turn nothing points to the store


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


class ToolSession:
    """Lists the given tool names; every call succeeds with a small JSON result."""

    def __init__(self, names):
        from types import SimpleNamespace
        self.ns, self.names, self.calls = SimpleNamespace, names, []

    async def list_tools(self):
        return self.ns(tools=[self.ns(name=n, description=n, inputSchema={"type": "object", "properties": {}})
                              for n in self.names])

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return self.ns(isError=False, content=[self.ns(type="text", text='{"removed": true}')])


async def test_the_last_answer_also_keeps_the_topic():
    from ha_safe_mcp.ollama_client import run_chat
    offered = []

    def respond(request):
        offered.append([t["function"]["name"] for t in json.loads(request.content)["tools"]])
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "ok"}})

    history = [{"role": "user", "content": "Ja, installiere sie."},
               {"role": "assistant", "content": "Die mini-graph-card wurde aus dem Marktplatz installiert."}]
    names = ["ha_search_entities", "ha_get_state", "ha_remove_hacs_repository", "ha_list_dashboards"]
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://ollama:11434") as http:
        await run_chat(ToolSession(names), http, "small", "Entferne die mini-graph-card wieder.", allow_write=True,
                       approve=lambda n, a: True, history=history)
    assert "ha_remove_hacs_repository" in offered[0]


@pytest.mark.parametrize("language, marker", [("en", "nothing was changed"), ("de", "wurde nichts geändert")])
async def test_a_claimed_change_without_any_write_gets_a_note(language, marker):
    from ha_safe_mcp.i18n import ui_language
    from ha_safe_mcp.ollama_client import run_chat
    claim = {"message": {"role": "assistant", "content": "Die mini-graph-card wurde erfolgreich entfernt."}}
    token = ui_language.set(language)
    try:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=claim)),
                                     base_url="http://ollama:11434") as http:
            answer = await run_chat(ToolSession(["ha_get_state"]), http, "small",
                                    "Entferne die mini-graph-card wieder.", allow_write=True,
                                    approve=lambda n, a: True)
    finally:
        ui_language.reset(token)
    assert answer.startswith("Die mini-graph-card wurde erfolgreich entfernt.") and marker in answer


async def test_no_note_after_a_real_write_or_for_a_question():
    from ha_safe_mcp.ollama_client import WRITE_TOOLS, run_chat
    assert "ha_remove_hacs_repository" in WRITE_TOOLS
    steps = iter([
        {"message": {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {
            "name": "ha_remove_hacs_repository", "arguments": {"repository": "kalkih/mini-graph-card"}}}]}},
        {"message": {"role": "assistant", "content": "Die mini-graph-card wurde entfernt."}},
        {"message": {"role": "assistant", "content": "Das Licht wurde um 18 Uhr eingeschaltet."}},
    ])
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=next(steps))),
                                 base_url="http://ollama:11434") as http:
        session = ToolSession(["ha_get_state", "ha_remove_hacs_repository"])
        done = await run_chat(session, http, "small", "Entferne die mini-graph-card aus dem Marketplace.",
                              allow_write=True, approve=lambda n, a: True)
        question = await run_chat(session, http, "small", "Wann wurde das Licht eingeschaltet?", allow_write=True,
                                  approve=lambda n, a: True)
    assert session.calls == [("ha_remove_hacs_repository", {"repository": "kalkih/mini-graph-card"})]
    assert done == "Die mini-graph-card wurde entfernt." and question == "Das Licht wurde um 18 Uhr eingeschaltet."
