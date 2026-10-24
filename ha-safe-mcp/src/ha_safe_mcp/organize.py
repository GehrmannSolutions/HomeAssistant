"""Labels, categories and zones: the registries the HA UI uses to organise things.

Sources (HA Core 2026.10): components/config/label_registry.py, components/config/category_registry.py and
components/zone/__init__.py (storage collection: zone/list|create|update|delete with ``zone_id``). All writes are
``require_admin`` in HA itself.

Guardrails:
- read: labels with usage counts and members, categories per scope with usage, zones (storage zones are editable;
  zone.home from the core config and YAML zones are listed as not editable).
- admin write: create/update labels, categories and zones; names 1-100 printable characters, icons ``mdi:...``,
  label colours are HA theme colours or ``#rrggbb``, zone radius 1-100000 m. Every write is read back.
- admin write + delete: delete them. HA removes a deleted label/category from every entity, device and area; the
  change journal stores where it was used so an undo can put it back.
"""
from __future__ import annotations

import math
import re

from .registry import ID, _icon, _name

LABEL_COLORS = frozenset({"primary", "accent", "disabled", "red", "pink", "purple", "deep-purple", "indigo", "blue",
                          "light-blue", "cyan", "teal", "green", "light-green", "lime", "yellow", "amber", "orange",
                          "deep-orange", "brown", "light-grey", "grey", "dark-grey", "blue-grey", "black", "white"})
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SCOPE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
CATEGORY_ID = re.compile(r"^[A-Za-z0-9_]{1,64}$")
LABEL_FIELDS = ("label_id", "name", "color", "icon", "description")
LABEL_UPDATE = frozenset({"name", "color", "icon", "description"})
CATEGORY_UPDATE = frozenset({"name", "icon"})
ZONE_FIELDS = ("name", "latitude", "longitude", "radius", "passive", "icon")
ZONE_UPDATE = frozenset(ZONE_FIELDS)
MAX_MEMBERS = 500


def _color(value):
    if value is not None and (not isinstance(value, str) or not (HEX_COLOR.fullmatch(value) or value in LABEL_COLORS)):
        raise ValueError("color: a theme colour like 'amber', 'teal', 'red', 'blue-grey' or '#rrggbb', or null")
    return value


def _description(value):
    if value is not None and (not isinstance(value, str) or len(value) > 500
                              or re.search(r"[\x00-\x08\x0b-\x1f]", value)):
        raise ValueError("description: up to 500 characters or null")
    return value


def _number(value, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ValueError(f"{label} must be a number between {low:g} and {high:g}")
    return value


class HAOrganizer:
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

    async def _list(self, command: str, payload: dict | None = None) -> list[dict]:
        items = await self.ws.command(command, payload) if payload else await self.ws.command(command)
        if not isinstance(items, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [item for item in items if isinstance(item, dict)]

    async def _usage(self):
        return (await self._list("config/entity_registry/list"), await self._list("config/device_registry/list"),
                await self._list("config/area_registry/list"))

    # ------------------------------------------------------------------ labels
    @staticmethod
    def _label_id(value) -> str:
        if not isinstance(value, str) or not ID.fullmatch(value):
            raise ValueError("invalid label_id: use the label_id from ha_list_labels")
        return value

    async def _labels(self) -> list[dict]:
        return [{key: item.get(key) for key in LABEL_FIELDS}
                for item in await self._list("config/label_registry/list")]

    async def find_label(self, label_id: str) -> dict | None:
        return next((item for item in await self._labels() if item["label_id"] == label_id), None)

    async def list_labels(self) -> list[dict]:
        labels = await self._labels()
        entities, devices, areas = await self._usage()

        def count(items, label_id):
            return sum(1 for item in items if label_id in (item.get("labels") or []))
        return [{**label, "used_by": {"entities": count(entities, label["label_id"]),
                                      "devices": count(devices, label["label_id"]),
                                      "areas": count(areas, label["label_id"])}} for label in labels]

    async def label_assignments(self, label_id: str) -> dict:
        """Complete lists of entity IDs, device IDs and area IDs carrying the label (for the journal)."""
        entities, devices, areas = await self._usage()
        return {"entities": [e["entity_id"] for e in entities if label_id in (e.get("labels") or [])],
                "devices": [d["id"] for d in devices if label_id in (d.get("labels") or [])],
                "areas": [a["area_id"] for a in areas if label_id in (a.get("labels") or [])]}

    async def get_label(self, label_id: str) -> dict:
        label = await self.find_label(self._label_id(label_id))
        if label is None:
            raise ValueError("unknown label_id: pick one from ha_list_labels")
        entities, devices, areas = await self._usage()
        members = {
            "entities": [e["entity_id"] for e in entities if label_id in (e.get("labels") or [])][:MAX_MEMBERS],
            "devices": [{"device_id": d.get("id"), "name": d.get("name_by_user") or d.get("name")}
                        for d in devices if label_id in (d.get("labels") or [])][:MAX_MEMBERS],
            "areas": [a["area_id"] for a in areas if label_id in (a.get("labels") or [])]}
        return {**label, "members": members}

    async def create_label(self, name: str, color: str | None = None, icon: str | None = None,
                           description: str | None = None) -> dict:
        self._check_write()
        payload = {"name": _name(name)}
        if color is not None:
            payload["color"] = _color(color)
        if icon is not None:
            payload["icon"] = _icon(icon)
        if description is not None:
            payload["description"] = _description(description)
        if any(item["name"].casefold() == payload["name"].casefold() for item in await self._labels()):
            raise ValueError("a label with this name already exists")
        result = await self.ws.command("config/label_registry/create", payload)
        label_id = result.get("label_id") if isinstance(result, dict) else None
        created = await self.find_label(label_id) if label_id else None
        if created is None:
            raise RuntimeError("Label creation not visible in list")
        return created

    async def update_label(self, label_id: str, changes: dict) -> dict:
        self._check_write()
        self._label_id(label_id)
        if not isinstance(changes, dict) or not changes or not changes.keys() <= LABEL_UPDATE:
            raise ValueError(f"unsupported label fields; allowed: {', '.join(sorted(LABEL_UPDATE))}")
        payload = dict(changes)
        if "name" in payload:
            payload["name"] = _name(payload["name"])
        if "color" in payload:
            _color(payload["color"])
        if "icon" in payload:
            _icon(payload["icon"])
        if "description" in payload:
            _description(payload["description"])
        labels = await self._labels()
        if not any(item["label_id"] == label_id for item in labels):
            raise ValueError("unknown label_id: pick one from ha_list_labels")
        if "name" in payload and any(item["name"].casefold() == payload["name"].casefold()
                                     and item["label_id"] != label_id for item in labels):
            raise ValueError("a label with this name already exists")
        await self.ws.command("config/label_registry/update", {"label_id": label_id, **payload})
        current = await self.find_label(label_id)
        if current is None or any(current.get(key) != value for key, value in payload.items()):
            raise RuntimeError("Label update not confirmed by read-back")
        return current

    async def delete_label(self, label_id: str) -> dict:
        self._check_delete()
        self._label_id(label_id)
        if await self.find_label(label_id) is None:
            raise ValueError("unknown label_id: pick one from ha_list_labels")
        await self.ws.command("config/label_registry/delete", {"label_id": label_id})
        if await self.find_label(label_id) is not None:
            raise RuntimeError("Label still present after delete")
        return {"deleted": True}

    async def assign_label(self, label_id: str, assigned: dict) -> dict:
        """Put a label back on the given entities, devices and areas (used by undo)."""
        self._check_write()
        entities, devices, areas = await self._usage()
        done = {"entities": 0, "devices": 0, "areas": 0}
        targets = (("entities", entities, "entity_id", "config/entity_registry/update", "entity_id"),
                   ("devices", devices, "id", "config/device_registry/update", "device_id"),
                   ("areas", areas, "area_id", "config/area_registry/update", "area_id"))
        for group, items, key, command, payload_key in targets:
            wanted = set(assigned.get(group) or [])
            for item in items:
                labels = list(item.get("labels") or [])
                if item.get(key) in wanted and label_id not in labels:
                    await self.ws.command(command, {payload_key: item[key], "labels": [*labels, label_id]})
                    done[group] += 1
        return done

    # ------------------------------------------------------------------ categories
    @staticmethod
    def _scope(value) -> str:
        if not isinstance(value, str) or not SCOPE.fullmatch(value):
            raise ValueError("scope: the area of the HA UI the category belongs to, e.g. 'automation', 'script', "
                             "'scene' or 'helpers'")
        return value

    @staticmethod
    def _category_id(value) -> str:
        if not isinstance(value, str) or not CATEGORY_ID.fullmatch(value):
            raise ValueError("invalid category_id: use the category_id from ha_list_categories")
        return value

    async def _categories(self, scope: str) -> list[dict]:
        return [{key: item.get(key) for key in ("category_id", "name", "icon")}
                for item in await self._list("config/category_registry/list", {"scope": scope})]

    async def find_category(self, scope: str, category_id: str) -> dict | None:
        return next((c for c in await self._categories(scope) if c["category_id"] == category_id), None)

    async def list_categories(self, scope: str) -> list[dict]:
        categories = await self._categories(self._scope(scope))
        entities = await self._list("config/entity_registry/list")
        return [{**category, "used_by": sum(1 for e in entities
                                            if (e.get("categories") or {}).get(scope) == category["category_id"])}
                for category in categories]

    async def category_assignments(self, scope: str, category_id: str) -> list[str]:
        return [e["entity_id"] for e in await self._list("config/entity_registry/list")
                if (e.get("categories") or {}).get(scope) == category_id]

    async def create_category(self, scope: str, name: str, icon: str | None = None) -> dict:
        self._check_write()
        payload = {"scope": self._scope(scope), "name": _name(name)}
        if icon is not None:
            payload["icon"] = _icon(icon)
        if any(c["name"].casefold() == payload["name"].casefold() for c in await self._categories(scope)):
            raise ValueError("a category with this name already exists in this scope")
        result = await self.ws.command("config/category_registry/create", payload)
        category_id = result.get("category_id") if isinstance(result, dict) else None
        created = await self.find_category(scope, category_id) if category_id else None
        if created is None:
            raise RuntimeError("Category creation not visible in list")
        return created

    async def update_category(self, scope: str, category_id: str, changes: dict) -> dict:
        self._check_write()
        self._scope(scope)
        self._category_id(category_id)
        if not isinstance(changes, dict) or not changes or not changes.keys() <= CATEGORY_UPDATE:
            raise ValueError(f"unsupported category fields; allowed: {', '.join(sorted(CATEGORY_UPDATE))}")
        payload = dict(changes)
        if "name" in payload:
            payload["name"] = _name(payload["name"])
        if "icon" in payload:
            _icon(payload["icon"])
        if await self.find_category(scope, category_id) is None:
            raise ValueError("unknown category_id: pick one from ha_list_categories")
        await self.ws.command("config/category_registry/update",
                              {"scope": scope, "category_id": category_id, **payload})
        current = await self.find_category(scope, category_id)
        if current is None or any(current.get(key) != value for key, value in payload.items()):
            raise RuntimeError("Category update not confirmed by read-back")
        return current

    async def delete_category(self, scope: str, category_id: str) -> dict:
        self._check_delete()
        self._scope(scope)
        self._category_id(category_id)
        if await self.find_category(scope, category_id) is None:
            raise ValueError("unknown category_id: pick one from ha_list_categories")
        await self.ws.command("config/category_registry/delete", {"scope": scope, "category_id": category_id})
        if await self.find_category(scope, category_id) is not None:
            raise RuntimeError("Category still present after delete")
        return {"deleted": True}

    async def assign_category(self, scope: str, category_id: str, entity_ids: list[str]) -> int:
        """Put a category back on the given entities (used by undo)."""
        self._check_write()
        done = 0
        for entity in await self._list("config/entity_registry/list"):
            if entity.get("entity_id") in set(entity_ids) \
                    and (entity.get("categories") or {}).get(scope) != category_id:
                await self.ws.command("config/entity_registry/update",
                                      {"entity_id": entity["entity_id"], "categories": {scope: category_id}})
                done += 1
        return done

    # ------------------------------------------------------------------ zones
    @staticmethod
    def _zone_id(value) -> str:
        if not isinstance(value, str) or not ID.fullmatch(value):
            raise ValueError("invalid zone_id: use the zone_id from ha_list_zones")
        return value

    @staticmethod
    def _zone(item: dict) -> dict:
        return {"zone_id": item.get("id"), **{key: item.get(key) for key in ZONE_FIELDS}}

    async def find_zone(self, zone_id: str) -> dict | None:
        return next((self._zone(z) for z in await self._list("zone/list") if z.get("id") == zone_id), None)

    async def _zone_states(self) -> list[dict]:
        states = await self.client._request("GET", "/api/states")
        return [s for s in states if isinstance(s, dict) and str(s.get("entity_id", "")).startswith("zone.")] \
            if isinstance(states, list) else []

    async def list_zones(self) -> list[dict]:
        storage = [self._zone(z) for z in await self._list("zone/list")]
        states = await self._zone_states()
        by_unique_id = {e.get("unique_id"): e.get("entity_id") for e in await self._list("config/entity_registry/list")
                        if e.get("platform") == "zone" and e.get("unique_id")}
        state_by_id = {s["entity_id"]: s for s in states}
        result, used = [], set()
        for zone in storage:
            entity_id = by_unique_id.get(zone["zone_id"]) or next(
                (s["entity_id"] for s in states
                 if (s.get("attributes") or {}).get("friendly_name") == zone["name"]), None)
            state = state_by_id.get(entity_id) if entity_id else None
            used.add(entity_id)
            result.append({"entity_id": entity_id, **zone, "editable": True,
                           "persons_inside": self._persons(state)})
        for state in states:
            if state["entity_id"] in used:
                continue
            attributes = state.get("attributes") or {}
            result.append({"entity_id": state["entity_id"], "zone_id": None,
                           "name": attributes.get("friendly_name"), "latitude": attributes.get("latitude"),
                           "longitude": attributes.get("longitude"), "radius": attributes.get("radius"),
                           "passive": attributes.get("passive"), "icon": attributes.get("icon"), "editable": False,
                           "persons_inside": self._persons(state)})
        return result

    @staticmethod
    def _persons(state) -> int | None:
        try:
            return int(state.get("state")) if state else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _zone_payload(values: dict) -> dict:
        payload = dict(values)
        if "name" in payload:
            payload["name"] = _name(payload["name"])
        if "latitude" in payload:
            _number(payload["latitude"], "latitude", -90, 90)
        if "longitude" in payload:
            _number(payload["longitude"], "longitude", -180, 180)
        if "radius" in payload:
            _number(payload["radius"], "radius (metres)", 1, 100000)
        if "passive" in payload and not isinstance(payload["passive"], bool):
            raise ValueError("passive must be true or false")
        if "icon" in payload:
            if payload["icon"] is None:
                raise ValueError("icon must look like 'mdi:home'")
            _icon(payload["icon"])
        return payload

    async def create_zone(self, name: str, latitude: float, longitude: float, radius: float = 100,
                          passive: bool = False, icon: str | None = None) -> dict:
        self._check_write()
        values = {"name": name, "latitude": latitude, "longitude": longitude, "radius": radius, "passive": passive}
        if icon is not None:
            values["icon"] = icon
        payload = self._zone_payload(values)
        names = {str(z.get("name", "")).casefold() for z in await self.list_zones()}
        if payload["name"].casefold() in names:
            raise ValueError("a zone with this name already exists")
        result = await self.ws.command("zone/create", payload)
        zone_id = result.get("id") if isinstance(result, dict) else None
        created = await self.find_zone(zone_id) if zone_id else None
        if created is None:
            raise RuntimeError("Zone creation not visible in list")
        return created

    async def _editable_zone(self, zone_id: str) -> dict:
        zone = await self.find_zone(self._zone_id(zone_id))
        if zone is not None:
            return zone
        if any(s["entity_id"] == f"zone.{zone_id}" for s in await self._zone_states()):
            raise ValueError("zone is not editable here (zone.home comes from Settings > System > General, other "
                             "zones from YAML)")
        raise ValueError("unknown zone_id: pick one from ha_list_zones (editable zones only)")

    async def update_zone(self, zone_id: str, changes: dict) -> dict:
        self._check_write()
        if not isinstance(changes, dict) or not changes or not changes.keys() <= ZONE_UPDATE:
            raise ValueError(f"unsupported zone fields; allowed: {', '.join(sorted(ZONE_UPDATE))}")
        payload = self._zone_payload(changes)
        await self._editable_zone(zone_id)
        await self.ws.command("zone/update", {"zone_id": zone_id, **payload})
        current = await self.find_zone(zone_id)
        if current is None or any(
                (float(current.get(key)) != float(value)) if key in ("latitude", "longitude", "radius")
                else current.get(key) != value for key, value in payload.items()):
            raise RuntimeError("Zone update not confirmed by read-back")
        return current

    async def delete_zone(self, zone_id: str) -> dict:
        self._check_delete()
        await self._editable_zone(zone_id)
        await self.ws.command("zone/delete", {"zone_id": zone_id})
        if await self.find_zone(zone_id) is not None:
            raise RuntimeError("Zone still present after delete")
        return {"deleted": True}
