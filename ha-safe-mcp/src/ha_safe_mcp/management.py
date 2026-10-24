"""Allowlisted Home Assistant Core WebSocket transport for config management."""

import asyncio
import json
import re
import time
from urllib.parse import urlsplit

import httpx

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from .server import HAClient

# storage-collection helpers ({domain}/list|create|update|delete); config-flow helpers go through integrations.py
HELPERS = frozenset({"input_boolean", "input_number", "input_select", "input_text", "input_datetime", "input_button",
                     "counter", "timer", "schedule"})
READ_TYPES = frozenset({"validate_config", "lovelace/config", "lovelace/dashboards/list",
                        "config/entity_registry/list", "auth/current_user",
                        "config_entries/flow/progress", "backup/info", "backup/agents/info",
                        "config/area_registry/list", "config/floor_registry/list",
                        "config/device_registry/list", "config_entries/get_single",
                        # debugging (read-only; some need an HA admin user)
                        "trace/list", "trace/get", "system_log/list", "recorder/statistics_during_period",
                        "recorder/list_statistic_ids", "repairs/list_issues", "system_health/info",
                        "test_condition",
                        # organising: labels, categories, zones, one entity registry entry
                        "config/label_registry/list", "config/category_registry/list", "zone/list",
                        "config/entity_registry/get", "todo/item/list", "update/release_notes",
                        "blueprint/list", "frontend/get_themes", "lovelace/resources"}) | frozenset(
                            f"{domain}/list" for domain in HELPERS)
WRITE_TYPES = frozenset({"lovelace/config/save", "lovelace/dashboards/create", "backup/generate",
                         "config/area_registry/create", "config/area_registry/update",
                         "config/floor_registry/create", "config/floor_registry/update",
                         "config/device_registry/update", "config_entries/update", "config_entries/disable",
                         "lovelace/dashboards/update", "config/entity_registry/update",
                         "config/label_registry/create", "config/label_registry/update",
                         "config/category_registry/create", "config/category_registry/update",
                         "zone/create", "zone/update", "blueprint/import", "blueprint/save",
                         "lovelace/resources/create"}) | frozenset(
                             f"{domain}/{action}" for domain in HELPERS for action in ("create", "update"))
DELETE_TYPES = frozenset({"lovelace/config/delete", "lovelace/dashboards/delete", "backup/delete",
                          "config/area_registry/delete", "config/floor_registry/delete",
                          "config/entity_registry/remove", "config/label_registry/delete",
                          "config/category_registry/delete", "zone/delete", "calendar/event/delete",
                          "blueprint/delete", "lovelace/resources/delete"}) | frozenset(
                              f"{domain}/delete" for domain in HELPERS)


ENTITY_ID = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")
ENTITY_UPDATE = frozenset({"name", "area_id", "icon", "aliases", "labels", "categories", "disabled_by", "hidden_by"})


# actions on data (not configuration): need writes enabled only; the caller checks the domain
CONTROL_TYPES = frozenset({"calendar/event/update"})


class HAWebSocket:
    def __init__(self, client: HAClient, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client = client
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete

    async def command(self, command_type: str, payload: dict | None = None, *, collect_events=None):
        """Send one command. With ``collect_events`` (a callable returning True to stop), keep reading the
        subscription's events after the result for up to 10 s and return {"result": ..., "events": [...]}."""
        if command_type in CONTROL_TYPES and not self.client.allow_write:
            raise ValueError("Writes are disabled")
        if command_type not in READ_TYPES | CONTROL_TYPES | WRITE_TYPES | DELETE_TYPES:
            raise ValueError("websocket command not allowed")
        if command_type in WRITE_TYPES | DELETE_TYPES and (not self.client.allow_write or not self.allow_admin_write):
            raise ValueError("admin write disabled")
        if command_type in DELETE_TYPES and not self.allow_delete:
            raise ValueError("delete disabled")
        payload = payload or {}
        if not isinstance(payload, dict) or {"id", "type", "access_token"} & payload.keys():
            raise ValueError("reserved websocket fields or invalid payload")
        if len(json.dumps(payload).encode()) > 65536:
            raise ValueError("websocket payload too large")
        url = urlsplit(self.client.url)
        scheme = "wss" if url.scheme == "https" else "ws"
        ws_url = f"{scheme}://{url.netloc}/api/websocket"
        started, error = time.monotonic(), None
        try:
            async with asyncio.timeout(20):
                async with connect(ws_url, max_size=16_000_000, open_timeout=10) as ws:
                    hello = json.loads(await ws.recv())
                    if hello.get("type") != "auth_required":
                        raise RuntimeError("Unexpected WebSocket authentication phase")
                    await ws.send(json.dumps({"type": "auth", "access_token": self.client.token}))
                    auth = json.loads(await ws.recv())
                    if auth.get("type") != "auth_ok":
                        raise RuntimeError("Home Assistant WebSocket authentication failed")
                    await ws.send(json.dumps({"id": 1, "type": command_type, **payload}))
                    response = json.loads(await ws.recv())
                    if response.get("type") != "result" or response.get("id") != 1:
                        raise RuntimeError("Unexpected WebSocket response")
                    if not response.get("success"):
                        code = response.get("error", {}).get("code", "unknown")
                        safe_code = code if isinstance(code, str) and re.fullmatch(r"[a-z_]{1,60}", code) else "unknown"
                        error = "WebSocketError"
                        raise RuntimeError(f"Home Assistant WebSocket error: {safe_code}")
                    if collect_events is None:
                        return response.get("result")
                    events = []
                    try:
                        async with asyncio.timeout(10):
                            while True:
                                message = json.loads(await ws.recv())
                                if message.get("type") != "event" or message.get("id") != 1:
                                    continue
                                events.append(message.get("event"))
                                if collect_events(message.get("event")) or len(events) >= 500:
                                    break
                    except TimeoutError:
                        pass
                    return {"result": response.get("result"), "events": events}
        except (OSError, TimeoutError, WebSocketException, json.JSONDecodeError) as exc:
            error = type(exc).__name__
            raise RuntimeError(f"Home Assistant WebSocket request failed ({type(exc).__name__})") from None
        except RuntimeError:
            error = error or "RuntimeError"
            raise
        finally:
            if hasattr(self.client, "log"):
                self.client.log(channel="ws", method="WS", route=command_type, ok=error is None,
                                ms=(time.monotonic() - started) * 1000, error=error)


class HAAdmin:
    """Typed, admin-gated configuration operations; never accept raw URLs/types."""

    def __init__(self, client: HAClient, ws: HAWebSocket | None = None, *,
                 allow_admin_write: bool = False, allow_delete: bool = False):
        self.client = client
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete
        self.ws = ws or HAWebSocket(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled")

    async def current_user(self) -> dict:
        """Who owns the token, reduced to what the setup check needs (no IDs, no MFA details)."""
        user = await self.ws.command("auth/current_user")
        if not isinstance(user, dict):
            raise RuntimeError("Unexpected Home Assistant response")
        return {"name": str(user.get("name") or ""), "is_owner": user.get("is_owner") is True,
                "is_admin": user.get("is_admin") is True}

    async def automation_validate(self, config: dict):
        if not isinstance(config, dict):
            raise ValueError("automation config must be an object")
        payload = {key: config[key] for key in ("triggers", "conditions", "actions") if key in config}
        if not payload:
            raise ValueError("triggers, conditions or actions required")
        return await self.ws.command("validate_config", payload)

    @staticmethod
    def _automation_path(config_id: str) -> str:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", config_id):
            raise ValueError("invalid automation ID")
        return f"/api/config/automation/config/{config_id}"

    async def automation_get(self, config_id: str):
        return await self.client._request("GET", self._automation_path(config_id))

    async def automation_save(self, config_id: str, config: dict):
        self._check_write()
        if not isinstance(config, dict) or not isinstance(config.get("alias"), str) or not config.get("alias") or "id" in config:
            raise ValueError("automation requires alias and must not override id")
        path = self._automation_path(config_id)
        validation = await self.automation_validate(config)
        if any(isinstance(item, dict) and not item.get("valid", False) for item in validation.values()):
            raise ValueError("Home Assistant rejected automation configuration")
        result = await self.client._request("POST", path, data=config)
        if result.get("result") != "ok":
            raise RuntimeError("Automation save was not confirmed")
        readback = await self.automation_get(config_id)
        if readback.get("id") != config_id or readback.get("alias") != config["alias"]:
            raise RuntimeError("Automation read-back differs from requested configuration")
        return readback

    async def automation_delete(self, config_id: str):
        self._check_delete()
        path = self._automation_path(config_id)
        result = await self.client._request("DELETE", path)
        try:
            await self.automation_get(config_id)
        except RuntimeError as exc:
            if str(exc) == "Home Assistant returned HTTP 404":
                return result
            raise
        raise RuntimeError("Automation still present after delete")

    async def dashboard_list(self):
        return await self.ws.command("lovelace/dashboards/list")

    async def dashboard_get(self, url_path: str | None = None):
        return await self.ws.command("lovelace/config", {"url_path": url_path} if url_path else {})

    async def dashboard_create(self, title: str, url_path: str):
        self._check_write()
        if not title or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", url_path):
            raise ValueError("dashboard requires title and hyphenated url_path")
        result = await self.ws.command("lovelace/dashboards/create", {"title": title, "url_path": url_path})
        dashboards = await self.dashboard_list()
        if not any(item.get("url_path") == url_path for item in dashboards):
            raise RuntimeError("Dashboard creation not visible in list")
        return result

    async def dashboard_save(self, config: dict, *, url_path: str | None = None):
        self._check_write()
        if not isinstance(config, dict) or not isinstance(config.get("views"), list):
            raise ValueError("dashboard config requires views list")
        if url_path is not None and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", url_path):
            raise ValueError("invalid dashboard url_path")
        try:
            previous = await self.dashboard_get(url_path)
        except RuntimeError as exc:
            if str(exc) != "Home Assistant WebSocket error: config_not_found":
                raise
            previous = None
        payload = {"config": config, **({"url_path": url_path} if url_path else {})}
        await self.ws.command("lovelace/config/save", payload)
        current = await self.dashboard_get(url_path)
        if current != config:
            raise RuntimeError("Dashboard read-back differs from requested configuration")
        return {"previous": previous, "config": current}

    async def helper_list(self, domain: str):
        if domain not in HELPERS:
            raise ValueError("unsupported helper domain")
        return await self.ws.command(f"{domain}/list")

    async def helper_create(self, domain: str, config: dict):
        self._check_write()
        if domain not in HELPERS or not isinstance(config, dict) or not isinstance(config.get("name"), str) or not config["name"]:
            raise ValueError("unsupported helper domain or missing name")
        if domain == "input_number" and not all(key in config for key in ("min", "max")):
            raise ValueError("input_number requires min and max")
        if domain == "input_select" and (not isinstance(config.get("options"), list) or not config["options"]):
            raise ValueError("input_select requires options")
        if domain == "input_datetime" and not (config.get("has_date") or config.get("has_time")):
            raise ValueError("input_datetime requires has_date or has_time")
        if {"id", "entity_id", "type"} & config.keys():
            raise ValueError("helper config contains reserved fields")
        result = await self.ws.command(f"{domain}/create", config)
        if not isinstance(result, dict) or not result.get("id"):
            raise RuntimeError("Helper creation returned no ID")
        current = await self.helper_list(domain)
        if not any(item.get("id") == result["id"] for item in current):
            raise RuntimeError("Helper creation not visible in list")
        return result

    @staticmethod
    def _helper_id(domain: str, helper_id: str):
        if domain not in HELPERS or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", helper_id):
            raise ValueError("unsupported helper domain or invalid ID")

    async def helper_update(self, domain: str, helper_id: str, config: dict):
        self._check_write()
        self._helper_id(domain, helper_id)
        if not isinstance(config, dict) or not isinstance(config.get("name"), str) or not config["name"]:
            raise ValueError("helper update requires full config with name")
        if {"id", "entity_id", "type", f"{domain}_id"} & config.keys():
            raise ValueError("helper config contains reserved fields")
        await self.ws.command(f"{domain}/update", {f"{domain}_id": helper_id, **config})
        current = await self.helper_list(domain)
        match = next((item for item in current if item.get("id") == helper_id), None)
        if match is None or match.get("name") != config["name"]:
            raise RuntimeError("Helper update not confirmed by read-back")
        return match

    async def helper_delete(self, domain: str, helper_id: str):
        self._check_delete()
        self._helper_id(domain, helper_id)
        await self.ws.command(f"{domain}/delete", {f"{domain}_id": helper_id})
        if any(item.get("id") == helper_id for item in await self.helper_list(domain)):
            raise RuntimeError("Helper still present after delete")
        return None

    async def dashboard_update(self, dashboard_id: str, changes: dict):
        self._check_write()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", dashboard_id) or not isinstance(changes, dict):
            raise ValueError("invalid dashboard ID or changes")
        if not changes or not changes.keys() <= {"title", "icon", "require_admin", "show_in_sidebar"}:
            raise ValueError("unsupported dashboard metadata fields")
        await self.ws.command("lovelace/dashboards/update", {"dashboard_id": dashboard_id, **changes})
        current = next((item for item in await self.dashboard_list() if item.get("id") == dashboard_id), None)
        if current is None or any(current.get(key) != val for key, val in changes.items()):
            raise RuntimeError("Dashboard update not confirmed by read-back")
        return current

    async def dashboard_delete(self, dashboard_id: str):
        self._check_delete()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", dashboard_id):
            raise ValueError("invalid dashboard ID")
        await self.ws.command("lovelace/dashboards/delete", {"dashboard_id": dashboard_id})
        if any(item.get("id") == dashboard_id for item in await self.dashboard_list()):
            raise RuntimeError("Dashboard still present after delete")
        return None

    async def entity_registry_list(self):
        return await self.ws.command("config/entity_registry/list")

    async def entity_registry_get(self, entity_id: str) -> dict | None:
        """One registry entry including aliases; None when the entity is not in the registry."""
        if not isinstance(entity_id, str) or not ENTITY_ID.fullmatch(entity_id):
            raise ValueError("invalid entity_id")
        try:
            return await self.ws.command("config/entity_registry/get", {"entity_id": entity_id})
        except RuntimeError as exc:
            if "not_found" in str(exc):
                return None
            raise

    async def _validate_entity_changes(self, payload: dict):
        for key in ("disabled_by", "hidden_by"):
            if key in payload and payload[key] not in ("user", None):
                raise ValueError(f"{key} may only be 'user' or null")
        if "name" in payload and payload["name"] is not None and (
                not isinstance(payload["name"], str) or not payload["name"].strip() or len(payload["name"]) > 100):
            raise ValueError("name must be 1-100 characters or null (null = name from the integration)")
        if "icon" in payload and payload["icon"] is not None and (
                not isinstance(payload["icon"], str) or not re.fullmatch(r"mdi:[a-z0-9-]{1,64}", payload["icon"])):
            raise ValueError("icon must look like 'mdi:lamp' or be null")
        if "area_id" in payload and payload["area_id"] is not None and (
                not isinstance(payload["area_id"], str) or not re.fullmatch(r"[a-z0-9_]{1,64}", payload["area_id"])):
            raise ValueError("invalid area_id: use the area_id from ha_list_areas")
        if "aliases" in payload and (not isinstance(payload["aliases"], list) or len(payload["aliases"]) > 20 or not all(
                item is None or (isinstance(item, str) and 0 < len(item) <= 100) for item in payload["aliases"])):
            raise ValueError("aliases must be a list of up to 20 names")
        if "labels" in payload:
            labels = payload["labels"]
            if not isinstance(labels, list) or not all(isinstance(x, str) for x in labels):
                raise ValueError("labels must be a list of label IDs (the complete new list)")
            known = {item.get("label_id") for item in await self.ws.command("config/label_registry/list")}
            unknown = sorted(set(labels) - known)
            if unknown:
                raise ValueError(f"unknown label(s) {', '.join(unknown)}: create with ha_create_label or pick from "
                                 "ha_list_labels")
        if "categories" in payload:
            categories = payload["categories"]
            if not isinstance(categories, dict) or not all(
                    isinstance(scope, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,31}", scope)
                    and (cid is None or isinstance(cid, str)) for scope, cid in categories.items()):
                raise ValueError("categories must map a scope to a category_id or null, e.g. {'automation': '<id>'}")
            for scope, cid in categories.items():
                if cid is not None and not any(
                        c.get("category_id") == cid
                        for c in await self.ws.command("config/category_registry/list", {"scope": scope})):
                    raise ValueError(f"unknown category {cid} in scope {scope}: pick one from ha_list_categories")

    async def entity_registry_update(self, entity_id: str, changes: dict):
        self._check_write()
        if not isinstance(entity_id, str) or not ENTITY_ID.fullmatch(entity_id) or not isinstance(changes, dict):
            raise ValueError("invalid entity ID or changes")
        if not changes or not changes.keys() <= ENTITY_UPDATE:
            raise ValueError(f"unsupported entity registry fields; allowed: {', '.join(sorted(ENTITY_UPDATE))}")
        payload = dict(changes)
        await self._validate_entity_changes(payload)
        result = await self.ws.command("config/entity_registry/update", {"entity_id": entity_id, **payload})
        current = await self.entity_registry_get(entity_id)

        def confirmed(key, value):
            if key in ("labels", "aliases"):
                return sorted(map(str, current.get(key) or [])) == sorted(map(str, value or []))
            if key == "categories":
                return all((current.get("categories") or {}).get(scope) == cid for scope, cid in value.items())
            return current.get(key) == value
        if current is None or not all(confirmed(key, value) for key, value in payload.items()):
            raise RuntimeError("Entity registry update not confirmed by read-back")
        hints = {key: result[key] for key in ("require_restart", "reload_delay") if isinstance(result, dict)
                 and key in result}
        return {**current, **hints}

    async def entity_rename(self, entity_id: str, new_entity_id: str) -> dict:
        """Change an entity_id (same domain). References in automations, scripts and dashboards are not updated."""
        self._check_write()
        for value in (entity_id, new_entity_id):
            if not isinstance(value, str) or not ENTITY_ID.fullmatch(value) or len(value) > 255:
                raise ValueError("entity IDs look like 'light.hallway' (lowercase letters, digits, underscores)")
        if new_entity_id == entity_id:
            raise ValueError("new_entity_id equals the current entity_id")
        if new_entity_id.split(".", 1)[0] != entity_id.split(".", 1)[0]:
            raise ValueError("new_entity_id must keep the same domain (light.x -> light.y)")
        if await self.entity_registry_get(entity_id) is None:
            raise ValueError("unknown entity_id, or the entity has no unique ID (not in the registry) and cannot be "
                             "renamed")
        if await self.entity_registry_get(new_entity_id) is not None:
            raise ValueError("an entity with this ID already exists")
        await self.ws.command("config/entity_registry/update",
                              {"entity_id": entity_id, "new_entity_id": new_entity_id})
        current = await self.entity_registry_get(new_entity_id)
        if current is None or current.get("entity_id") != new_entity_id:
            raise RuntimeError("Entity rename not confirmed by read-back")
        return current
