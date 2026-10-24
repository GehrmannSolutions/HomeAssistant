"""Blueprints, themes and dashboard resources.

Sources (HA Core 2026.10): components/blueprint/websocket_api.py (blueprint/list|import|save|delete),
components/frontend/__init__.py (frontend/get_themes, admin service frontend.set_theme) and
components/lovelace/resources.py + const.py (lovelace/resources, collection lovelace/resources/create|delete with
res_type and url).

Guardrails:
- read: blueprints with their inputs, themes with the defaults, dashboard resources.
- admin write: preview a blueprint from an https URL (HA fetches it), save it under a new path (overwriting is not
  offered), set the default (dark) theme, add a dashboard resource. Resources load JavaScript for every user of the
  HA frontend, so only paths served by this Home Assistant itself are accepted (/local/..., /hacsfiles/...).
- delete level: delete a blueprint (HA refuses while automations use it) or a resource. Undo of a blueprint delete
  re-imports it from its source_url.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

BLUEPRINT_DOMAINS = ("automation", "script", "template")
BLUEPRINT_PATH = re.compile(r"^[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-]+)*\.yaml$")
RESOURCE_PATH = re.compile(r"^/(?:local|hacsfiles)/[A-Za-z0-9_\-./]+\.(?:js|mjs|css)(?:\?[A-Za-z0-9_=.&-]*)?$")
RESOURCE_TYPES = ("module", "js", "css")
YAML_PREVIEW = 3000


class HACustomize:
    def __init__(self, client, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    # ------------------------------------------------------------------ blueprints
    @staticmethod
    def _domain(domain) -> str:
        if domain not in BLUEPRINT_DOMAINS:
            raise ValueError(f"domain: one of {', '.join(BLUEPRINT_DOMAINS)}")
        return domain

    @staticmethod
    def _path(path) -> str:
        if not isinstance(path, str) or ".." in path or len(path) > 200 or not BLUEPRINT_PATH.fullmatch(path):
            raise ValueError("path: relative file name like 'example/motion_light.yaml' (letters, digits, _ - /)")
        return path

    @staticmethod
    def _url(url) -> str:
        parsed = urlparse(url) if isinstance(url, str) else None
        if parsed is None or parsed.scheme != "https" or not parsed.hostname or len(url) > 500:
            raise ValueError("url: an https address of a blueprint (GitHub, gist, community forum, ...)")
        return url

    async def _blueprints(self, domain: str) -> dict:
        result = await self.ws.command("blueprint/list", {"domain": self._domain(domain)})
        return result if isinstance(result, dict) else {}

    async def list_blueprints(self, domain: str = "automation") -> list[dict]:
        out = []
        for path, item in sorted((await self._blueprints(domain)).items()):
            if not isinstance(item, dict):
                continue
            if "error" in item:
                out.append({"path": path, "error": str(item["error"])[:200]})
                continue
            meta = item.get("metadata") or {}
            entry = {"path": path, "name": meta.get("name"), "inputs": sorted((meta.get("input") or {}).keys())}
            for key in ("description", "source_url", "author"):
                if meta.get(key):
                    entry[key] = str(meta[key])[:200]
            out.append(entry)
        return out

    async def find_blueprint(self, domain: str, path: str) -> dict | None:
        item = (await self._blueprints(domain)).get(path)
        return item.get("metadata") if isinstance(item, dict) and "metadata" in item else None

    async def _import(self, url: str) -> dict:
        result = await self.ws.command("blueprint/import", {"url": self._url(url)})
        if not isinstance(result, dict) or not isinstance(result.get("raw_data"), str):
            raise RuntimeError("Unexpected Home Assistant response")
        return result

    async def preview_blueprint(self, url: str) -> dict:
        self._check_write()
        imported = await self._import(url)
        meta = (imported.get("blueprint") or {}).get("metadata") or {}
        return {"path": f"{imported.get('suggested_filename')}.yaml", "name": meta.get("name"),
                "domain": meta.get("domain"), "description": str(meta.get("description") or "")[:500] or None,
                "inputs": sorted((meta.get("input") or {}).keys()), "source_url": meta.get("source_url") or url,
                "validation_errors": imported.get("validation_errors"), "exists": bool(imported.get("exists")),
                "yaml": imported["raw_data"][:YAML_PREVIEW]}

    async def save_blueprint(self, url: str, path: str | None = None) -> dict:
        self._check_write()
        if path is not None:
            self._path(path)
        imported = await self._import(url)
        if imported.get("validation_errors"):
            raise ValueError(f"blueprint is not valid: {str(imported['validation_errors'])[:300]}")
        meta = (imported.get("blueprint") or {}).get("metadata") or {}
        domain = self._domain(meta.get("domain"))
        path = self._path(path or f"{imported.get('suggested_filename')}.yaml")
        if path in await self._blueprints(domain):
            raise ValueError(f"blueprint {domain}/{path} already exists; overwriting is not offered (delete it first "
                             "or choose another path)")
        await self.ws.command("blueprint/save", {"domain": domain, "path": path, "yaml": imported["raw_data"],
                                                 "source_url": url})
        if path not in await self._blueprints(domain):
            raise RuntimeError("Blueprint not visible after save")
        return {"domain": domain, "path": path, "name": meta.get("name")}

    async def delete_blueprint(self, domain: str, path: str) -> dict:
        self._check_delete()
        self._domain(domain)
        self._path(path)
        if path not in await self._blueprints(domain):
            raise ValueError("unknown blueprint: pick one from ha_list_blueprints")
        await self.ws.command("blueprint/delete", {"domain": domain, "path": path})
        if path in await self._blueprints(domain):
            raise RuntimeError("Blueprint still present after delete")
        return {"deleted": True}

    # ------------------------------------------------------------------ themes
    async def list_themes(self) -> dict:
        result = await self.ws.command("frontend/get_themes")
        result = result if isinstance(result, dict) else {}
        return {"themes": sorted((result.get("themes") or {}).keys()), "default_theme": result.get("default_theme"),
                "default_dark_theme": result.get("default_dark_theme")}

    async def set_theme(self, name: str, mode: str = "light") -> dict:
        self._check_write()
        if mode not in ("light", "dark"):
            raise ValueError("mode: 'light' or 'dark'")
        themes = await self.list_themes()
        if name not in themes["themes"] and name not in ("default", "none"):
            raise ValueError(f"unknown theme {name!r}; available: default, {', '.join(themes['themes'])}")
        await self.client._request("POST", "/api/services/frontend/set_theme", data={"name": name, "mode": mode})
        current = await self.list_themes()
        key = "default_dark_theme" if mode == "dark" else "default_theme"
        if current[key] != (None if name == "none" else name):
            raise RuntimeError("Theme change not confirmed by read-back")
        return current

    # ------------------------------------------------------------------ dashboard resources
    async def list_resources(self) -> list[dict]:
        items = await self.ws.command("lovelace/resources")
        return [{"id": r.get("id"), "url": r.get("url"), "type": r.get("type")}
                for r in items or [] if isinstance(r, dict)]

    async def find_resource(self, resource_id: str) -> dict | None:
        return next((r for r in await self.list_resources() if r["id"] == resource_id), None)

    async def add_resource(self, url: str, res_type: str = "module") -> dict:
        self._check_write()
        if not isinstance(url, str) or ".." in url or len(url) > 300 or not RESOURCE_PATH.fullmatch(url):
            raise ValueError("url: only files served by this Home Assistant, e.g. '/local/my-card.js' or "
                             "'/hacsfiles/mini-graph-card/mini-graph-card-bundle.js'")
        if res_type not in RESOURCE_TYPES:
            raise ValueError(f"res_type: one of {', '.join(RESOURCE_TYPES)}")
        if any(r["url"] == url for r in await self.list_resources()):
            raise ValueError("this resource is already registered")
        result = await self.ws.command("lovelace/resources/create", {"res_type": res_type, "url": url})
        resource_id = result.get("id") if isinstance(result, dict) else None
        created = await self.find_resource(resource_id) if resource_id else None
        if created is None:
            raise RuntimeError("Resource not visible after create")
        return created

    async def delete_resource(self, resource_id: str) -> dict:
        self._check_delete()
        if not isinstance(resource_id, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", resource_id):
            raise ValueError("invalid resource id: use the id from ha_list_dashboard_resources")
        if await self.find_resource(resource_id) is None:
            raise ValueError("unknown resource id: pick one from ha_list_dashboard_resources")
        await self.ws.command("lovelace/resources/delete", {"resource_id": resource_id})
        if await self.find_resource(resource_id) is not None:
            raise RuntimeError("Resource still present after delete")
        return {"deleted": True}
