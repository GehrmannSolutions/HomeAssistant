"""Remove devices and orphaned entities, the way Home Assistant's own settings pages do it.

Sources (HA Core 2026.10): components/config/device_registry.py (``config/device_registry/remove``, before that
``config/device_registry/remove_config_entry``: the integration must support it - ``supports_remove_device`` of the
config entry - and may still refuse) and components/config/entity_registry.py (``config/entity_registry/remove``).

Guardrails:
- read: a preview of what goes with a device (entities, connected devices, where they are used) and the list of
  orphaned entities (registry entries no integration provides any more - HA marks their state ``restored``)
- delete level for both removals; a device is only sent to HA when its integration supports removal, and the
  result is read back
- entities that an integration still provides are refused (HA would add them again; disable them instead)
- removals cannot be undone by the MCP: HA cannot recreate registry entries; an integration may find the device
  again later
"""
from __future__ import annotations

import asyncio
import re

from .server import HAClient

DEVICE_ID = re.compile(r"^[0-9a-f]{32}$|^[0-9A-HJKMNP-TV-Z]{26}$")
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
MAX_USAGE_CHECKS = 10
WARNING = ("Removing cannot be undone by the MCP: the device and its entities leave the registries, their names, "
           "areas and settings are lost. History stays in the recorder. The integration may add the device again "
           "when it finds it again.")


class HARemoval:
    def __init__(self, client: HAClient, ws, *, overview=None, allow_admin_write: bool = False,
                 allow_delete: bool = False):
        self.client, self.ws, self.overview = client, ws, overview
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete

    def _check_delete(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    @staticmethod
    def _device_id(value) -> str:
        if not isinstance(value, str) or not DEVICE_ID.fullmatch(value):
            raise ValueError("invalid device_id: use the device_id from ha_list_devices, not the device name")
        return value

    async def _devices(self) -> list[dict]:
        items = await self.ws.command("config/device_registry/list")
        return [d for d in items if isinstance(d, dict)] if isinstance(items, list) else []

    async def _entities(self) -> list[dict]:
        items = await self.ws.command("config/entity_registry/list")
        return [e for e in items if isinstance(e, dict)] if isinstance(items, list) else []

    async def _entry(self, entry_id: str | None) -> dict | None:
        if not entry_id:
            return None
        try:
            result = await self.ws.command("config_entries/get_single", {"entry_id": entry_id})
        except RuntimeError:
            return None
        entry = result.get("config_entry") if isinstance(result, dict) else None
        return entry if isinstance(entry, dict) else None

    async def _usages(self, entity_ids: list[str]) -> list[dict]:
        if self.overview is None or not entity_ids:
            return []
        checked = entity_ids[:MAX_USAGE_CHECKS]
        results = await asyncio.gather(*(self.overview.find_usages(e) for e in checked), return_exceptions=True)
        used = []
        for entity_id, result in zip(checked, results):
            if isinstance(result, dict):
                used += [{"entity_id": entity_id, "kind": m.get("kind"), "id": m.get("id"), "name": m.get("name")}
                         for m in result.get("matches") or []]
        return used

    # ------------------------------------------------------------------ devices
    async def device_removal(self, device_id: str) -> dict:
        """What would go with this device, and whether Home Assistant can remove it at all."""
        device_id = self._device_id(device_id)
        devices = await self._devices()
        device = next((d for d in devices if d.get("id") == device_id), None)
        if device is None:
            raise ValueError("unknown device_id: pick one from ha_list_devices")
        entry_id = device.get("config_entry_id") or (device.get("config_entries") or [None])[0]
        entry = await self._entry(entry_id)
        entities = sorted(e["entity_id"] for e in await self._entities()
                          if e.get("device_id") == device_id and isinstance(e.get("entity_id"), str))
        if entry is None:
            can_remove, reason = False, "the device belongs to no loaded integration entry"
        elif not entry.get("supports_remove_device"):
            can_remove, reason = False, (f"the integration {entry.get('domain')} does not support removing devices; "
                                         "disable the device or remove the whole integration instead")
        else:
            can_remove, reason = True, ""
        return {
            "device": {"device_id": device_id, "name": device.get("name_by_user") or device.get("name"),
                       "manufacturer": device.get("manufacturer"), "model": device.get("model"),
                       "area_id": device.get("area_id")},
            "integration": None if entry is None else {"domain": entry.get("domain"), "title": entry.get("title"),
                                                        "entry_id": entry.get("entry_id")},
            "can_remove": can_remove, "reason": reason, "entities": entities,
            "connected_devices": [{"device_id": d["id"], "name": d.get("name_by_user") or d.get("name")}
                                  for d in devices if d.get("via_device_id") == device_id],
            "used_in": await self._usages(entities), "warning": WARNING}

    async def remove_device(self, device_id: str) -> dict:
        self._check_delete()
        preview = await self.device_removal(device_id)
        if not preview["can_remove"]:
            raise ValueError(preview["reason"])
        device_id = preview["device"]["device_id"]
        try:
            try:
                await self.ws.command("config/device_registry/remove", {"device_id": device_id})
            except RuntimeError as exc:
                if "unknown_command" not in str(exc):
                    raise
                # Home Assistant before 2026.10 only knows the older command
                await self.ws.command("config/device_registry/remove_config_entry", {
                    "device_id": device_id, "config_entry_id": preview["integration"]["entry_id"]})
        except RuntimeError as exc:
            if "home_assistant_error" in str(exc):
                raise ValueError(f"the integration {preview['integration']['domain']} refused to remove this "
                                 "device (often: it is still connected or still reported by the hub)") from None
            raise
        if any(d.get("id") == device_id for d in await self._devices()):
            raise RuntimeError("Device removal not confirmed by read-back")
        left = {e.get("entity_id") for e in await self._entities()}
        return {"removed": True, "device": preview["device"], "integration": preview["integration"],
                "entities_removed": [e for e in preview["entities"] if e not in left],
                "entities_left": [e for e in preview["entities"] if e in left],
                "note": "cannot be undone by the MCP"}

    # ------------------------------------------------------------------ entities
    async def _restored(self) -> set[str]:
        states = await self.client._request("GET", "/api/states")
        if not isinstance(states, list):
            return set()
        return {str(s.get("entity_id")) for s in states if isinstance(s, dict)
                and (s.get("attributes") or {}).get("restored") is True}

    async def orphaned_entities(self) -> dict:
        """Registry entries no integration provides any more (shown as 'not provided' in HA's entity list)."""
        restored = await self._restored()
        result = []
        for entity in await self._entities():
            if entity.get("entity_id") in restored and not entity.get("disabled_by"):
                result.append({"entity_id": entity["entity_id"], "name": entity.get("name")
                               or entity.get("original_name"), "platform": entity.get("platform"),
                               "device_id": entity.get("device_id")})
        result.sort(key=lambda e: e["entity_id"])
        return {"entities": result, "count": len(result),
                "hint": "check with ha_find_usages before removing; ha_remove_entity removes one"}

    async def remove_entity(self, entity_id: str) -> dict:
        self._check_delete()
        if not isinstance(entity_id, str) or not ENTITY_ID.fullmatch(entity_id):
            raise ValueError("invalid entity_id")
        entity = next((e for e in await self._entities() if e.get("entity_id") == entity_id), None)
        if entity is None:
            raise ValueError("entity is not in the entity registry (YAML entities cannot be removed here)")
        if entity_id not in await self._restored():
            raise ValueError("entity is still provided by its integration, Home Assistant would add it again; "
                             "disable it with ha_update_entity_registry (disabled_by='user') or remove the device")
        await self.ws.command("config/entity_registry/remove", {"entity_id": entity_id})
        return {"removed": entity_id, "name": entity.get("name") or entity.get("original_name"),
                "platform": entity.get("platform")}
