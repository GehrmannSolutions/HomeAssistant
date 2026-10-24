"""Deep search ("where is light.x used?") and a compact system overview, read-only.

Sources: entity states (automation/script/scene/group entities), the stored configs of UI automations, scripts and
scenes (config HTTP API), Lovelace dashboards (``lovelace/dashboards/list`` + ``lovelace/config``), registries and
config entries. YAML automations without an ``id`` cannot be read through the API and are reported as skipped.
"""
from __future__ import annotations

import asyncio
from collections import Counter

KINDS = ("automation", "script", "scene", "group", "dashboard")
FAILING_STATES = {"setup_error", "setup_retry", "migration_error", "failed_unload"}
MAX_PATHS = 10


def _walk(value, needle: str, path: str = ""):
    """Yield paths in a JSON-like value whose string values (or dict keys) contain the needle."""
    if isinstance(value, dict):
        for key, item in value.items():
            here = f"{path}.{key}" if path else str(key)
            if needle in str(key).casefold():
                yield f"{here} (key)"
            yield from _walk(item, needle, here)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk(item, needle, f"{path}[{index}]")
    elif isinstance(value, str) and needle in value.casefold():
        yield path or "(value)"


class HAOverview:
    def __init__(self, client, ws, *, admin, scenes, integrations):
        self.client, self.ws, self.admin, self.scenes, self.integrations = client, ws, admin, scenes, integrations

    async def _states(self) -> list[dict]:
        states = await self.client._request("GET", "/api/states")
        return [s for s in states if isinstance(s, dict) and isinstance(s.get("entity_id"), str)] \
            if isinstance(states, list) else []

    async def find_usages(self, needle: str, kinds: list[str] | None = None, limit: int = 100) -> dict:
        if not isinstance(needle, str) or not 2 <= len(needle.strip()) <= 200:
            raise ValueError("needle: 2-200 characters, e.g. an entity_id like 'light.hallway'")
        kinds = kinds or list(KINDS)
        if not isinstance(kinds, list) or not set(kinds) <= set(KINDS):
            raise ValueError(f"kinds: any of {', '.join(KINDS)}")
        text = needle.strip().casefold()
        states = await self._states()
        matches, skipped, errors = [], [], []
        searched: Counter = Counter()
        semaphore = asyncio.Semaphore(8)

        async def check(kind, item_id, name, entity_id, reader):
            async with semaphore:
                try:
                    config = await reader()
                except (RuntimeError, ValueError) as exc:
                    errors.append(f"{kind} {item_id}: {exc}")
                    return
            searched[kind + "s"] += 1
            paths = list(dict.fromkeys(_walk(config, text)))
            if paths:
                matches.append({"kind": kind, "id": item_id, "name": name, "entity_id": entity_id,
                                "paths": paths[:MAX_PATHS]})

        jobs = []
        for state in states:
            entity_id = state["entity_id"]
            domain, object_id = entity_id.split(".", 1)
            attributes = state.get("attributes") or {}
            name = attributes.get("friendly_name") or object_id
            if domain == "automation" and "automation" in kinds:
                config_id = attributes.get("id")
                if not isinstance(config_id, str):
                    skipped.append(f"{entity_id} (no id)")
                    continue
                jobs.append(check("automation", config_id, name, entity_id,
                                  lambda c=config_id: self.admin.automation_get(c)))
            elif domain == "script" and "script" in kinds:
                jobs.append(check("script", object_id, name, entity_id, lambda o=object_id: self.scenes.get_script(o)))
            elif domain == "scene" and "scene" in kinds and isinstance(attributes.get("id"), str):
                jobs.append(check("scene", attributes["id"], name, entity_id,
                                  lambda i=attributes["id"]: self.scenes.get_scene(i)))
            elif domain == "group" and "group" in kinds:
                members = attributes.get("entity_id") if isinstance(attributes.get("entity_id"), list) else []
                searched["groups"] += 1
                hits = [f"entity_id[{i}]" for i, m in enumerate(members) if text in str(m).casefold()]
                if hits:
                    matches.append({"kind": "group", "id": entity_id, "name": name, "entity_id": entity_id,
                                    "paths": hits[:MAX_PATHS]})
        if "dashboard" in kinds:
            try:
                dashboards = await self.admin.dashboard_list()
            except RuntimeError as exc:
                dashboards, _ = [], errors.append(f"dashboards: {exc}")
            for board in [{"url_path": None, "title": "Overview (default)"}] + list(dashboards or []):
                async def read(url=board.get("url_path")):
                    try:
                        return await self.admin.dashboard_get(url)
                    except RuntimeError as exc:
                        if "config_not_found" in str(exc):
                            return {}  # auto-generated default dashboard: nothing stored to search
                        raise
                jobs.append(check("dashboard", board.get("url_path") or "default", board.get("title"), None, read))
        await asyncio.gather(*jobs)
        order = {kind: index for index, kind in enumerate(KINDS)}
        matches.sort(key=lambda m: (order[m["kind"]], str(m["id"])))
        return {"needle": needle.strip(), "matches": matches[:max(1, min(limit, 500))], "searched": dict(searched),
                "skipped": skipped, "errors": errors[:20]}

    async def overview(self) -> dict:
        config, states = await asyncio.gather(self.client._request("GET", "/api/config"), self._states())
        by_domain: dict = {}
        for state in states:
            domain = state["entity_id"].split(".", 1)[0]
            entry = by_domain.setdefault(domain, {"total": 0, "unavailable": 0})
            entry["total"] += 1
            if state.get("state") == "unavailable":
                entry["unavailable"] += 1
            if domain in ("light", "switch", "fan", "media_player") and state.get("state") == "on":
                entry["on"] = entry.get("on", 0) + 1
        areas, floors, devices, registry = await asyncio.gather(
            self.ws.command("config/area_registry/list"), self.ws.command("config/floor_registry/list"),
            self.ws.command("config/device_registry/list"), self.ws.command("config/entity_registry/list"))
        entries = await self.integrations.list_entries()
        try:
            dashboards = len(await self.admin.dashboard_list())
        except RuntimeError:
            dashboards = None
        automations = [s for s in states if s["entity_id"].startswith("automation.")]
        return {
            "version": config.get("version"), "location_name": config.get("location_name"),
            "time_zone": config.get("time_zone"), "state": config.get("state"),
            "safe_mode": config.get("safe_mode"), "recovery_mode": config.get("recovery_mode"),
            "entities": {"total": len(states),
                         "unavailable": sum(1 for s in states if s.get("state") == "unavailable"),
                         "unknown": sum(1 for s in states if s.get("state") == "unknown"),
                         "by_domain": dict(sorted(by_domain.items(), key=lambda kv: -kv[1]["total"]))},
            "registry": {"areas": len(areas or []), "floors": len(floors or []), "devices": len(devices or []),
                         "entities_disabled": sum(1 for e in registry or [] if isinstance(e, dict) and e.get("disabled_by"))},
            "automations": {"total": len(automations), "on": sum(1 for s in automations if s.get("state") == "on")},
            "scripts": sum(1 for s in states if s["entity_id"].startswith("script.")),
            "scenes": sum(1 for s in states if s["entity_id"].startswith("scene.")),
            "dashboards": dashboards,
            "integrations": {
                "total": len(entries),
                "disabled": sum(1 for e in entries if e.get("disabled_by")),
                "failing": [{"domain": e.get("domain"), "title": e.get("title"), "state": e.get("state")}
                            for e in entries if e.get("state") in FAILING_STATES][:30]},
        }
