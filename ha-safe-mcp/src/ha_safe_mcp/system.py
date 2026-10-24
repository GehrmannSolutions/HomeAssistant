"""Updates, reload, configuration check and restart.

Sources (HA Core 2026.10): components/update/__init__.py (update entities, WS update/release_notes, services
update.install|skip|clear_skipped), components/homeassistant/__init__.py (homeassistant.reload_all,
reload_core_config, restart) and components/config/core.py (POST /api/config/core/check_config).

Guardrails:
- read: pending updates with versions, release notes (capped), configuration check (changes nothing).
- admin write: reload a domain's YAML/config (only domains that offer a ``reload`` service, plus ``all`` and
  ``core``), skip an update or clear a skip.
- delete level (the highest): install an update and restart Home Assistant. These are the most far-reaching actions;
  in the UI they never run without an approval card unless deletes may run without one. A restart is refused while
  the configuration check reports errors (HA would not come back).
"""
from __future__ import annotations

from .server import ENTITY

NOTES_MAX = 4000
REMOTE_HINT = ("Home Assistant is restarting; it is usually back within a minute. Check with ha_get_overview or "
               "ha_check_config before the next change.")


class HASystem:
    def __init__(self, client, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete

    def _check_admin(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_top(self):
        if not self.client.allow_write or not self.allow_admin_write or not self.allow_delete:
            raise ValueError("this needs the delete level (HA_ALLOW_WRITE, HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE): "
                             "installing updates and restarting are the most far-reaching actions")

    @staticmethod
    def _update_entity(entity_id) -> str:
        if not isinstance(entity_id, str) or not ENTITY.fullmatch(entity_id) or not entity_id.startswith("update."):
            raise ValueError("entity_id must be an update entity from ha_list_updates, e.g. 'update.plug_firmware'")
        return entity_id

    @staticmethod
    def _summary(state: dict) -> dict:
        attributes = state.get("attributes") or {}
        out = {"entity_id": state["entity_id"], "name": attributes.get("friendly_name") or state["entity_id"],
               "update_available": state.get("state") == "on",
               "installed_version": attributes.get("installed_version"),
               "latest_version": attributes.get("latest_version")}
        for key in ("skipped_version", "in_progress", "auto_update", "release_summary", "release_url"):
            if attributes.get(key):
                out[key] = attributes[key][:300] if isinstance(attributes[key], str) else attributes[key]
        if state.get("state") == "unavailable":
            out["unavailable"] = True
        return out

    # ------------------------------------------------------------------ read
    async def list_updates(self, pending_only: bool = True) -> list[dict]:
        states = await self.client._request("GET", "/api/states")
        updates = [self._summary(s) for s in states or []
                   if isinstance(s, dict) and str(s.get("entity_id", "")).startswith("update.")]
        if pending_only:
            updates = [u for u in updates if u["update_available"]]
        updates.sort(key=lambda u: (not u["update_available"], str(u["name"]).casefold()))
        return updates[:200]

    async def release_notes(self, entity_id: str) -> dict:
        notes = await self.ws.command("update/release_notes", {"entity_id": self._update_entity(entity_id)})
        text = notes if isinstance(notes, str) else ""
        result = {"entity_id": entity_id, "notes": text[:NOTES_MAX] if text else None}
        if len(text) > NOTES_MAX:
            result["truncated"] = True
        if not text:
            result["hint"] = "no release notes from this integration; see release_url in ha_list_updates"
        return result

    async def check_config(self) -> dict:
        result = await self.client._request("POST", "/api/config/core/check_config", timeout=120)
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected Home Assistant response")
        return {key: result.get(key) for key in ("result", "errors", "warnings")}

    # ------------------------------------------------------------------ admin
    async def reload(self, target: str) -> dict:
        self._check_admin()
        if not isinstance(target, str) or not target:
            raise ValueError("target: 'all', 'core' or a domain such as 'automation', 'script', 'template'")
        services = {item.get("domain"): set((item.get("services") or {}).keys())
                    for item in await self.client._request("GET", "/api/services") or [] if isinstance(item, dict)}
        if target in ("all", "core"):
            domain, service = "homeassistant", "reload_all" if target == "all" else "reload_core_config"
        else:
            domain, service = target, "reload"
        if service not in services.get(domain, set()):
            reloadable = sorted(str(d) for d, names in services.items() if d and "reload" in names)
            raise ValueError(f"{target} has no reload service; possible: all, core, {', '.join(reloadable)}")
        await self.client._request("POST", f"/api/services/{domain}/{service}", data={}, timeout=120)
        return {"reloaded": target}

    async def _state(self, entity_id: str) -> dict:
        try:
            return await self.client._request("GET", f"/api/states/{self._update_entity(entity_id)}")
        except RuntimeError as exc:
            if "404" in str(exc):
                raise ValueError(f"unknown update entity {entity_id}: pick one from ha_list_updates") from None
            raise

    async def skip_update(self, entity_id: str, clear: bool = False) -> dict:
        self._check_admin()
        await self._state(entity_id)
        service = "clear_skipped" if clear else "skip"
        await self.client._request("POST", f"/api/services/update/{service}", data={"entity_id": entity_id})
        return {"entity_id": entity_id, "skipped": not clear}

    # ------------------------------------------------------------------ top level
    async def install_update(self, entity_id: str, version: str | None = None, backup: bool = False) -> dict:
        self._check_top()
        state = await self._state(entity_id)
        if state.get("state") != "on":
            raise ValueError(f"no update available for {entity_id} (state {state.get('state')})")
        data: dict[str, object] = {"entity_id": entity_id}
        if version:
            if not isinstance(version, str) or len(version) > 64:
                raise ValueError("version: up to 64 characters")
            data["version"] = version
        if backup:
            data["backup"] = True
        target = version or (state.get("attributes") or {}).get("latest_version")
        try:
            await self.client._request("POST", "/api/services/update/install", data=data, timeout=120)
        except RuntimeError as exc:
            if "ReadTimeout" in str(exc):
                return {"entity_id": entity_id, "started": True, "version": target,
                        "hint": "still installing in Home Assistant; check ha_list_updates (in_progress)"}
            raise
        return {"entity_id": entity_id, "installed": target}

    async def restart(self, safe_mode: bool = False) -> dict:
        self._check_top()
        check = await self.check_config()
        if check.get("result") != "valid":
            raise ValueError(f"configuration is invalid, not restarting: {str(check.get('errors'))[:500]}")
        try:
            await self.client._request("POST", "/api/services/homeassistant/restart",
                                       data={"safe_mode": True} if safe_mode else {}, timeout=30)
        except RuntimeError as exc:
            if "request failed" not in str(exc):  # connection dropped while HA shuts down: expected
                raise
        return {"restarting": True, "safe_mode": bool(safe_mode), "warnings": check.get("warnings"),
                "hint": REMOTE_HINT}
