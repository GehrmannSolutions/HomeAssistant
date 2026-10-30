"""Scenes and scripts through Home Assistant's config API (the routes the HA scene/script editors use).

Sources (HA Core 2026.10): components/config/scene.py (EditIdBasedConfigView over scenes.yaml, key cv.string),
components/config/script.py (EditKeyBasedConfigView over scripts.yaml, key cv.slug, async_validate_config_item),
components/config/view.py (GET/POST/DELETE /api/config/{scene|script}/config/{key}; POST and DELETE require
admin). HA reloads scenes/scripts asynchronously after a write.

Guardrails:
- read: list (from states; scene.<x> with attribute ``id`` is UI-editable), read stored config
- admin write: save (create or replace) after local validation; scripts are validated by HA's
  ``validate_config`` first; previous config returned for manual rollback; config read back
- admin write + delete: delete, then confirm the config is gone
- activate a scene / run a script: a normal write (``scene.turn_on`` / ``script.turn_on``) and only if the
  domain is in HA_ALLOWED_DOMAINS, like every other service call
"""

import asyncio
import re
import time

from .server import ENTITY, HAClient

SCENE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SCRIPT_ID = re.compile(r"^[a-z0-9_]{1,64}$")
SCENE_KEYS = frozenset({"name", "icon", "entities", "metadata"})
SCRIPT_KEYS = frozenset({"alias", "sequence", "description", "icon", "mode", "max", "max_exceeded", "fields",
                         "variables", "trace"})
MAX_ENTITIES = 200


SERVICE_NAME = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def action_names(node) -> set[str]:
    """All literal 'domain.service' names in a (nested) action sequence; templates are skipped."""
    found: set[str] = set()
    if isinstance(node, list):
        for item in node:
            found |= action_names(item)
    elif isinstance(node, dict):
        for key, value in node.items():
            if key in ("action", "service") and isinstance(value, str) and SERVICE_NAME.fullmatch(value):
                found.add(value)
            elif isinstance(value, (list, dict)):
                found |= action_names(value)
    return found


class HAScenes:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 settle_seconds: float = 5.0, read_back_delays: tuple[float, ...] = (0.4, 0.8, 1.5)):
        self.client = client
        self.read_back_delays = read_back_delays
        self.ws = ws
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete
        self.settle_seconds = settle_seconds

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    @staticmethod
    def _scene_id(scene_id) -> str:
        if not isinstance(scene_id, str) or not SCENE_ID.fullmatch(scene_id):
            raise ValueError("invalid scene_id: use scene_id from ha_list_scenes or a new id like 'abendlicht'")
        return scene_id

    @staticmethod
    def _script_id(script_id) -> str:
        if not isinstance(script_id, str) or not SCRIPT_ID.fullmatch(script_id):
            raise ValueError("invalid script_id: lowercase letters, digits and _ (e.g. 'gute_nacht')")
        return script_id

    async def _states(self, domain: str) -> list[dict]:
        states = await self.client._request("GET", "/api/states")
        if not isinstance(states, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [s for s in states if isinstance(s, dict) and str(s.get("entity_id", "")).startswith(domain + ".")
                and isinstance(s.get("attributes", {}), dict)]

    async def _get_or_none(self, kind: str, key: str):
        try:
            return await self.client._request("GET", f"/api/config/{kind}/config/{key}")
        except RuntimeError as exc:
            if str(exc) == "Home Assistant returned HTTP 404":
                return None
            raise

    async def _wait_for_entity(self, match) -> str | None:
        """HA reloads after a write in the background; report the entity once it is there (or None)."""
        deadline = time.monotonic() + self.settle_seconds
        while True:
            for state in await self._states(match[0]):
                if match[1](state):
                    return state["entity_id"]
            if time.monotonic() >= deadline:
                return None
            await asyncio.sleep(0.5)

    # ------------------------------------------------------------------ scenes
    async def list_scenes(self) -> list[dict]:
        result = []
        for state in await self._states("scene"):
            attributes = state.get("attributes") or {}
            scene_id = attributes.get("id")
            entities = attributes.get("entity_id") if isinstance(attributes.get("entity_id"), list) else []
            result.append({"entity_id": state["entity_id"], "name": attributes.get("friendly_name"),
                           "scene_id": scene_id if isinstance(scene_id, str) else None,
                           "editable": isinstance(scene_id, str), "entities": entities})
        return result

    async def get_scene(self, scene_id: str) -> dict:
        return await self.client._request("GET", f"/api/config/scene/config/{self._scene_id(scene_id)}")

    @staticmethod
    def _validate_scene(config) -> dict:
        if not isinstance(config, dict) or not config.keys() <= SCENE_KEYS:
            raise ValueError(f"scene config may only contain {', '.join(sorted(SCENE_KEYS))} (no id)")
        if not isinstance(config.get("name"), str) or not config["name"].strip():
            raise ValueError("scene needs a name")
        entities = config.get("entities")
        if not isinstance(entities, dict) or not 0 < len(entities) <= MAX_ENTITIES:
            raise ValueError("scene needs entities: {\"light.flur\": {\"state\": \"on\", \"brightness\": 120}}")
        for entity_id, target in entities.items():
            if not isinstance(entity_id, str) or not ENTITY.fullmatch(entity_id):
                raise ValueError(f"invalid entity_id in scene: {str(entity_id)[:60]}")
            if not isinstance(target, (dict, str, int, float, bool)):
                raise ValueError("scene entity value must be a state string or an object with state/attributes")
        return config

    async def save_scene(self, scene_id: str, config: dict) -> dict:
        self._check_write()
        scene_id = self._scene_id(scene_id)
        config = self._validate_scene(config)
        states = await self.client._request("GET", "/api/states")
        existing = {s.get("entity_id") for s in states if isinstance(s, dict)} if isinstance(states, list) else set()
        missing = sorted(set(config["entities"]) - existing)
        if missing:
            raise ValueError(f"unknown entities: {', '.join(missing[:5])}; use entity_ids from ha_search_entities")
        previous = await self._get_or_none("scene", scene_id)
        result = await self.client._request("POST", f"/api/config/scene/config/{scene_id}", data=config)
        if not isinstance(result, dict) or result.get("result") != "ok":
            raise RuntimeError("Scene save was not confirmed")
        current = await self.get_scene(scene_id)
        if current.get("name") != config["name"] or current.get("entities") != config["entities"]:
            raise RuntimeError("Scene read-back differs from requested configuration")
        entity_id = await self._wait_for_entity(
            ("scene", lambda s: (s.get("attributes") or {}).get("id") == scene_id))
        return {"previous": previous, "config": current, "entity_id": entity_id}

    async def delete_scene(self, scene_id: str) -> dict:
        self._check_delete()
        scene_id = self._scene_id(scene_id)
        await self.client._request("DELETE", f"/api/config/scene/config/{scene_id}")
        if await self._get_or_none("scene", scene_id) is not None:
            raise RuntimeError("Scene still present after delete")
        return {"deleted": True}

    async def activate_scene(self, entity_id: str) -> dict:
        if "scene" not in self.client.allowed_domains:
            raise ValueError("activating scenes needs 'scene' in the allowed domains (settings)")
        await self.client.call_service("scene", "turn_on", entity_id)
        return await self._scene_read_back(entity_id)

    async def _scene_read_back(self, entity_id: str) -> dict:
        """Read the scene's entities after activating it. A UI scene's stored config gives each entity's target
        state, so members are re-read (about 3 s) until they show it and reported confirmed true/false, like
        ha_call_service does; YAML scenes have no stored config, so their states come without a verdict."""
        scene = await self.client._request("GET", f"/api/states/{entity_id}")
        attributes = scene.get("attributes") if isinstance(scene, dict) else None
        attributes = attributes if isinstance(attributes, dict) else {}
        members = [m for m in attributes.get("entity_id") or [] if isinstance(m, str)][:50]
        targets: dict[str, str] = {}
        if attributes.get("id"):
            try:
                config = await self.client._request("GET", f"/api/config/scene/config/{attributes['id']}")
            except RuntimeError:
                config = None
            for member, spec in ((config or {}).get("entities") or {}).items():
                target = spec.get("state") if isinstance(spec, dict) else spec
                if isinstance(target, str):
                    targets[member] = target
        states: dict[str, dict] = {}

        def reached(member):
            return member not in targets or states[member].get("state") == targets[member]
        for delay in (0,) + tuple(self.read_back_delays):
            if delay:
                await asyncio.sleep(delay)
            for member in members:
                if member in states and reached(member):
                    continue
                try:
                    states[member] = await self.client._request("GET", f"/api/states/{member}")
                except RuntimeError:
                    states[member] = {"state": "unknown"}
            if all(reached(member) for member in members):
                break
        after = []
        for member in members:
            current = states[member]
            item = {"entity_id": member, "name": (current.get("attributes") or {}).get("friendly_name"),
                    "state": current.get("state")}
            if member in targets:
                item.update(target=targets[member], confirmed=current.get("state") == targets[member])
            after.append(item)
        confirmed = all(item["confirmed"] for item in after if "confirmed" in item) if targets else None
        result = {"activated": entity_id, "states_after": after, "all_confirmed": confirmed}
        if confirmed is False:
            result["hint"] = ("not confirmed: some entities did not reach the scene's state within about 3 s (slow, "
                              "offline or changed by something else). Tell the user what was reported.")
        return result

    # ------------------------------------------------------------------ scripts
    async def list_scripts(self) -> list[dict]:
        result = []
        for state in await self._states("script"):
            attributes = state.get("attributes") or {}
            result.append({"entity_id": state["entity_id"], "name": attributes.get("friendly_name"),
                           "script_id": state["entity_id"].split(".", 1)[1], "running": state.get("state") == "on",
                           "last_triggered": attributes.get("last_triggered"), "mode": attributes.get("mode")})
        return result

    async def get_script(self, script_id: str) -> dict:
        return await self.client._request("GET", f"/api/config/script/config/{self._script_id(script_id)}")

    async def save_script(self, script_id: str, config: dict) -> dict:
        self._check_write()
        script_id = self._script_id(script_id)
        if not isinstance(config, dict) or not config.keys() <= SCRIPT_KEYS:
            raise ValueError(f"script config may only contain {', '.join(sorted(SCRIPT_KEYS))} (no id)")
        if not isinstance(config.get("alias"), str) or not config["alias"].strip():
            raise ValueError("script needs an alias (display name)")
        if not isinstance(config.get("sequence"), list) or not config["sequence"]:
            raise ValueError("script needs a non-empty sequence list of actions")
        services = await self.client._request("GET", "/api/services")
        known = {f"{item['domain']}.{name}" for item in services if isinstance(item, dict)
                 and isinstance(item.get("domain"), str) and isinstance(item.get("services"), dict)
                 for name in item["services"]}
        unknown = sorted(action_names(config["sequence"]) - known)
        if unknown:
            raise ValueError(f"unknown action(s): {', '.join(unknown[:5])}; check ha_list_services")
        validation = await self.ws.command("validate_config", {"actions": config["sequence"]})
        if any(isinstance(item, dict) and not item.get("valid", False) for item in (validation or {}).values()):
            raise ValueError("Home Assistant rejected the script sequence")
        previous = await self._get_or_none("script", script_id)
        result = await self.client._request("POST", f"/api/config/script/config/{script_id}", data=config)
        if not isinstance(result, dict) or result.get("result") != "ok":
            raise RuntimeError("Script save was not confirmed")
        current = await self.get_script(script_id)
        if current.get("alias") != config["alias"] or current.get("sequence") != config["sequence"]:
            raise RuntimeError("Script read-back differs from requested configuration")
        entity_id = await self._wait_for_entity(("script", lambda s: s["entity_id"] == f"script.{script_id}"))
        return {"previous": previous, "config": current, "entity_id": entity_id}

    async def delete_script(self, script_id: str) -> dict:
        self._check_delete()
        script_id = self._script_id(script_id)
        await self.client._request("DELETE", f"/api/config/script/config/{script_id}")
        if await self._get_or_none("script", script_id) is not None:
            raise RuntimeError("Script still present after delete")
        return {"deleted": True}

    async def run_script(self, entity_id: str) -> list | dict:
        if "script" not in self.client.allowed_domains:
            raise ValueError("running scripts needs 'script' in the allowed domains (settings)")
        return await self.client.call_service("script", "turn_on", entity_id)
