"""Areas, floors and devices through Home Assistant's registries (the commands the HA UI uses).

Sources (HA Core 2026.10): components/config/area_registry.py, floor_registry.py, device_registry.py.
All create/update/delete commands are ``require_admin`` in HA itself.

Guardrails:
- read: areas, floors, devices. Device results drop serial numbers, MAC/connection data, identifiers and
  configuration URLs (personal/network identifiers the model does not need).
- admin write: create/update areas and floors (metadata only), update a device's area, user name, labels or
  disable it by user. Referenced area/floor IDs must exist. Every write is read back.
- admin write + delete: delete areas and floors (devices keep existing; HA clears their area).
- Not offered: removing devices (``config/device_registry/remove*``) — that changes integrations; use
  ha_delete_integration or the HA UI.
"""

import re

from .server import HAClient

ID = re.compile(r"^[a-z0-9_]{1,64}$")
DEVICE_ID = re.compile(r"^[0-9a-f]{32}$|^[0-9A-HJKMNP-TV-Z]{26}$")
ICON = re.compile(r"^mdi:[a-z0-9-]{1,64}$")
NAME_MAX = 100
AREA_FIELDS = ("area_id", "name", "floor_id", "icon", "aliases", "labels")
FLOOR_FIELDS = ("floor_id", "name", "level", "icon", "aliases")
DEVICE_FIELDS = ("name", "name_by_user", "manufacturer", "model", "area_id", "disabled_by", "entry_type", "labels")
AREA_UPDATE = frozenset({"name", "floor_id", "icon", "aliases"})
FLOOR_UPDATE = frozenset({"name", "level", "icon", "aliases"})
DEVICE_UPDATE = frozenset({"area_id", "name_by_user", "disabled_by", "labels"})


def _name(value) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > NAME_MAX or re.search(r"[\x00-\x1f]", value):
        raise ValueError(f"name must be 1-{NAME_MAX} printable characters")
    return value.strip()


def _icon(value):
    if value is not None and (not isinstance(value, str) or not ICON.fullmatch(value)):
        raise ValueError("icon must look like 'mdi:sofa' or be null")
    return value


def _aliases(value):
    if not isinstance(value, list) or len(value) > 20 or not all(isinstance(a, str) and 0 < len(a) <= NAME_MAX
                                                                   for a in value):
        raise ValueError("aliases must be a list of up to 20 names")
    return value


class HARegistry:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client = client
        self.ws = ws
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    @staticmethod
    def _id(value, label: str) -> str:
        if not isinstance(value, str) or not ID.fullmatch(value):
            raise ValueError(f"invalid {label}: use the {label} from the matching list tool")
        return value

    async def _list(self, kind: str) -> list[dict]:
        items = await self.ws.command(f"config/{kind}_registry/list")
        if not isinstance(items, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [item for item in items if isinstance(item, dict)]

    # ------------------------------------------------------------------ read
    async def list_areas(self) -> list[dict]:
        return [{key: item.get(key) for key in AREA_FIELDS} for item in await self._list("area")]

    async def list_floors(self) -> list[dict]:
        return [{key: item.get(key) for key in FLOOR_FIELDS} for item in await self._list("floor")]

    async def list_area_entities(self, area: str, domain: str = "") -> dict:
        """Entities in one area, resolved like HA: an entity's own area wins, otherwise its device's area."""
        if not isinstance(area, str) or not area.strip() or len(area) > 100:
            raise ValueError("area: area_id, name or alias of a room")
        if domain and (not isinstance(domain, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", domain)):
            raise ValueError("invalid domain, e.g. 'light'")
        areas = await self._list("area")
        wanted = area.strip().casefold()
        match = next((a for a in areas if str(a.get("area_id", "")).casefold() == wanted), None) or next(
            (a for a in areas if str(a.get("name", "")).casefold() == wanted
             or wanted in (str(alias).casefold() for alias in a.get("aliases") or [])), None)
        if match is None:
            names = ", ".join(sorted(str(a.get("name")) for a in areas))
            raise ValueError(f"unknown area '{area}'; known areas: {names}")
        area_id = match["area_id"]
        devices = {d.get("id"): d for d in await self._list("device")}
        entities = await self._list("entity")
        states = await self.client._request("GET", "/api/states")
        if not isinstance(states, list):
            raise RuntimeError("Unexpected Home Assistant response")
        state_by_id = {s.get("entity_id"): s for s in states if isinstance(s, dict)}
        found = []
        for entry in entities:
            entity_id = entry.get("entity_id")
            if not isinstance(entity_id, str) or entry.get("disabled_by") or entry.get("hidden_by"):
                continue
            if domain and not entity_id.startswith(domain + "."):
                continue
            own = entry.get("area_id")
            device_area = (devices.get(entry.get("device_id")) or {}).get("area_id")
            if (own or device_area) != area_id:
                continue
            state = state_by_id.get(entity_id) or {}
            attributes = state.get("attributes") if isinstance(state.get("attributes"), dict) else {}
            found.append({"entity_id": entity_id, "name": attributes.get("friendly_name"),
                          "state": state.get("state", "unknown")})
        found.sort(key=lambda item: item["entity_id"])
        in_area = {item["entity_id"] for item in found}
        groups = []
        for state in states:
            members = (state.get("attributes") or {}).get("entity_id") if isinstance(state, dict) else None
            entity_id = state.get("entity_id") if isinstance(state, dict) else None
            if (isinstance(members, list) and members and isinstance(entity_id, str)
                    and (not domain or entity_id.startswith(domain + "."))
                    and all(member in in_area for member in members)):
                groups.append({"entity_id": entity_id, "name": state["attributes"].get("friendly_name"),
                               "members": members})
        group_ids = {group["entity_id"] for group in groups}
        down = {"unavailable", "unknown"}
        return {"area_id": area_id, "name": match.get("name"), "entities": found,
                "available": [i["entity_id"] for i in found if i["state"] not in down and i["entity_id"] not in group_ids],
                "unavailable": [i["entity_id"] for i in found if i["state"] in down],
                "groups": sorted(groups, key=lambda g: g["entity_id"])}

    @staticmethod
    def _device(item: dict) -> dict:
        return {"device_id": item.get("id"), **{key: item.get(key) for key in DEVICE_FIELDS}}

    async def list_devices(self, area_id: str = "", query: str = "", limit: int = 200) -> list[dict]:
        if area_id and area_id != "none":
            self._id(area_id, "area_id")
        if not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")
        needle = str(query or "").casefold().strip()
        result = []
        for item in await self._list("device"):
            if area_id == "none" and item.get("area_id") is not None:
                continue
            if area_id and area_id != "none" and item.get("area_id") != area_id:
                continue
            text = " ".join(str(item.get(key) or "") for key in ("name", "name_by_user", "manufacturer", "model"))
            if needle and needle not in text.casefold():
                continue
            result.append(self._device(item))
        return result[:limit]

    # ------------------------------------------------------------------ areas
    async def _area(self, area_id: str) -> dict | None:
        return next((a for a in await self.list_areas() if a["area_id"] == area_id), None)

    async def _check_floor(self, floor_id):
        if floor_id is None:
            return
        self._id(floor_id, "floor_id")
        if not any(f["floor_id"] == floor_id for f in await self.list_floors()):
            raise ValueError("unknown floor_id: create it with ha_create_floor or pick one from ha_list_floors")

    async def create_area(self, name: str, floor_id: str | None = None, icon: str | None = None) -> dict:
        self._check_write()
        payload = {"name": _name(name)}
        if icon is not None:
            payload["icon"] = _icon(icon)
        if floor_id is not None:
            await self._check_floor(floor_id)
            payload["floor_id"] = floor_id
        if any(a["name"].casefold() == payload["name"].casefold() for a in await self.list_areas()):
            raise ValueError("an area with this name already exists")
        result = await self.ws.command("config/area_registry/create", payload)
        area_id = result.get("area_id") if isinstance(result, dict) else None
        created = await self._area(area_id) if area_id else None
        if created is None:
            raise RuntimeError("Area creation not visible in list")
        return created

    async def update_area(self, area_id: str, changes: dict) -> dict:
        self._check_write()
        self._id(area_id, "area_id")
        if not isinstance(changes, dict) or not changes or not changes.keys() <= AREA_UPDATE:
            raise ValueError(f"unsupported area fields; allowed: {', '.join(sorted(AREA_UPDATE))}")
        payload = dict(changes)
        if "name" in payload:
            payload["name"] = _name(payload["name"])
        if "icon" in payload:
            _icon(payload["icon"])
        if "aliases" in payload:
            _aliases(payload["aliases"])
        if "floor_id" in payload:
            await self._check_floor(payload["floor_id"])
        if await self._area(area_id) is None:
            raise ValueError("unknown area_id")
        await self.ws.command("config/area_registry/update", {"area_id": area_id, **payload})
        current = await self._area(area_id)
        if current is None or any(current.get(key) != value for key, value in payload.items()):
            raise RuntimeError("Area update not confirmed by read-back")
        return current

    async def delete_area(self, area_id: str) -> dict:
        self._check_delete()
        self._id(area_id, "area_id")
        await self.ws.command("config/area_registry/delete", {"area_id": area_id})
        if await self._area(area_id) is not None:
            raise RuntimeError("Area still present after delete")
        return {"deleted": True}

    # ------------------------------------------------------------------ floors
    async def _floor(self, floor_id: str) -> dict | None:
        return next((f for f in await self.list_floors() if f["floor_id"] == floor_id), None)

    @staticmethod
    def _level(value):
        if value is not None and (not isinstance(value, int) or isinstance(value, bool) or not -10 <= value <= 100):
            raise ValueError("level must be an integer between -10 and 100 or null")
        return value

    async def create_floor(self, name: str, level: int | None = None, icon: str | None = None) -> dict:
        self._check_write()
        payload = {"name": _name(name)}
        if level is not None:
            payload["level"] = self._level(level)
        if icon is not None:
            payload["icon"] = _icon(icon)
        if any(f["name"].casefold() == payload["name"].casefold() for f in await self.list_floors()):
            raise ValueError("a floor with this name already exists")
        result = await self.ws.command("config/floor_registry/create", payload)
        floor_id = result.get("floor_id") if isinstance(result, dict) else None
        created = await self._floor(floor_id) if floor_id else None
        if created is None:
            raise RuntimeError("Floor creation not visible in list")
        return created

    async def update_floor(self, floor_id: str, changes: dict) -> dict:
        self._check_write()
        self._id(floor_id, "floor_id")
        if not isinstance(changes, dict) or not changes or not changes.keys() <= FLOOR_UPDATE:
            raise ValueError(f"unsupported floor fields; allowed: {', '.join(sorted(FLOOR_UPDATE))}")
        payload = dict(changes)
        if "name" in payload:
            payload["name"] = _name(payload["name"])
        if "level" in payload:
            self._level(payload["level"])
        if "icon" in payload:
            _icon(payload["icon"])
        if "aliases" in payload:
            _aliases(payload["aliases"])
        if await self._floor(floor_id) is None:
            raise ValueError("unknown floor_id")
        await self.ws.command("config/floor_registry/update", {"floor_id": floor_id, **payload})
        current = await self._floor(floor_id)
        if current is None or any(current.get(key) != value for key, value in payload.items()):
            raise RuntimeError("Floor update not confirmed by read-back")
        return current

    async def delete_floor(self, floor_id: str) -> dict:
        self._check_delete()
        self._id(floor_id, "floor_id")
        await self.ws.command("config/floor_registry/delete", {"floor_id": floor_id})
        if await self._floor(floor_id) is not None:
            raise RuntimeError("Floor still present after delete")
        return {"deleted": True}

    # ------------------------------------------------------------------ devices
    async def update_device(self, device_id: str, changes: dict) -> dict:
        self._check_write()
        if not isinstance(device_id, str) or not DEVICE_ID.fullmatch(device_id):
            raise ValueError("invalid device_id: use the device_id from ha_list_devices, not the device name")
        if not isinstance(changes, dict) or not changes or not changes.keys() <= DEVICE_UPDATE:
            raise ValueError(f"unsupported device fields; allowed: {', '.join(sorted(DEVICE_UPDATE))}")
        payload = dict(changes)
        if "area_id" in payload and payload["area_id"] is not None:
            self._id(payload["area_id"], "area_id")
            if await self._area(payload["area_id"]) is None:
                raise ValueError("unknown area_id: create it with ha_create_area or pick one from ha_list_areas")
        if "name_by_user" in payload and payload["name_by_user"] is not None:
            payload["name_by_user"] = _name(payload["name_by_user"])
        if "disabled_by" in payload and payload["disabled_by"] not in ("user", None):
            raise ValueError("disabled_by may only be 'user' (disable) or null (enable)")
        if "labels" in payload and (not isinstance(payload["labels"], list)
                                    or not all(isinstance(x, str) and ID.fullmatch(x) for x in payload["labels"])):
            raise ValueError("labels must be a list of label IDs")
        await self.ws.command("config/device_registry/update", {"device_id": device_id, **payload})
        current = next((d for d in await self._list("device") if d.get("id") == device_id), None)
        if current is None or any(current.get(key) != value for key, value in payload.items()
                                  if key != "labels"):
            raise RuntimeError("Device update not confirmed by read-back")
        return self._device(current)
