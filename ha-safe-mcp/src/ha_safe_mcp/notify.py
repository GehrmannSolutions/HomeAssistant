"""Test notifications: send a message to a person's phone or another notify target.

Source: HA Core 2026.11 components/mobile_app/notify.py - every phone with the companion app gets the legacy
service ``notify.mobile_app_<slug of the app's device name>``; the notify entity platform (HA 2024.5+) takes
``notify.send_message`` with an entity_id. A person's phones are found through person.* -> device_trackers ->
entity registry (platform mobile_app) -> device registry (the app's device name) -> the service of that slug.

Control level: needs writes enabled and the domain ``notify`` in the allowed domains. The target is bound by the
tool; the optional ``data`` cannot redirect it. Home Assistant only confirms that it accepted the message.
"""
from __future__ import annotations

import json
import re
import unicodedata

GENERIC_SERVICES = frozenset({"send_message", "notify"})   # send_message needs an entity; notify = all/legacy group
MAX_MESSAGE, MAX_TITLE, MAX_DATA = 1000, 200, 4096


def slug(text: str) -> str:
    """Home Assistant's slugify for device names (unidecode-like for German text)."""
    text = str(text).replace("ß", "ss").replace("ẞ", "SS")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


class HANotify:
    def __init__(self, client, ws):
        self.client, self.ws = client, ws

    async def _notify_services(self) -> set[str]:
        services = await self.client._request("GET", "/api/services")
        return {name for item in services or [] if isinstance(item, dict) and item.get("domain") == "notify"
                for name in (item.get("services") or {})}

    async def _phones(self, states: list[dict], services: set[str]) -> dict[str, dict]:
        """person entity_id -> {name, services} (only services that exist)."""
        persons = [s for s in states if isinstance(s, dict) and str(s.get("entity_id", "")).startswith("person.")]
        if not persons:
            return {}
        entities = {e.get("entity_id"): e for e in await self.ws.command("config/entity_registry/list") or []
                    if isinstance(e, dict)}
        devices = {d.get("id"): d for d in await self.ws.command("config/device_registry/list") or []
                   if isinstance(d, dict)}
        result = {}
        for person in persons:
            attributes = person.get("attributes") or {}
            found = []
            for tracker in attributes.get("device_trackers") or []:
                entry = entities.get(tracker) or {}
                device = devices.get(entry.get("device_id")) if entry.get("platform") == "mobile_app" else None
                if device:
                    service = "mobile_app_" + slug(device.get("name") or "")
                    if service in services and f"notify.{service}" not in found:
                        found.append(f"notify.{service}")
            result[person["entity_id"]] = {"name": attributes.get("friendly_name") or person["entity_id"],
                                           "services": found}
        return result

    async def targets(self) -> dict:
        services = await self._notify_services()
        states = await self.client._request("GET", "/api/states")
        phones = await self._phones(states, services)
        personal = {s for p in phones.values() for s in p["services"]}
        entities = [s["entity_id"] for s in states if isinstance(s, dict)
                    and str(s.get("entity_id", "")).startswith("notify.")]
        return {"persons": [{"person": p["name"], "services": p["services"]} for p in phones.values()],
                "other_services": sorted(f"notify.{s}" for s in services
                                         if s not in GENERIC_SERVICES and f"notify.{s}" not in personal),
                "notify_entities": sorted(entities),
                "hint": "pass a person's name, a service (notify.mobile_app_...) or a notify entity as target of "
                        "ha_send_notification"}

    async def _resolve(self, target: str) -> tuple[list[tuple[str, str | None]], str | None]:
        """[(service, entity_id or None)], person name."""
        wanted = target.strip()
        bare = wanted.removeprefix("notify.")
        services = await self._notify_services()
        states = await self.client._request("GET", "/api/states")
        if bare in services and bare not in GENERIC_SERVICES:
            return [(bare, None)], None
        for state in states:
            entity_id = str(state.get("entity_id", ""))
            name = str((state.get("attributes") or {}).get("friendly_name") or "")
            if entity_id.startswith("notify.") and wanted.casefold() in (entity_id, name.casefold()):
                return [("send_message", entity_id)], None
        phones = await self._phones(states, services)
        key = wanted.casefold()
        person = next((p for pid, p in phones.items() if key in (pid, pid.removeprefix("person."),
                                                                 str(p["name"]).casefold())), None)
        with_phone = ", ".join(sorted(p["name"] for p in phones.values() if p["services"])) or "nobody"
        if person is not None:
            if not person["services"]:
                raise ValueError(f"{person['name']} has no phone with the Home Assistant app linked (no mobile_app "
                                 f"tracker on the person). Persons with a phone: {with_phone}. The app must be "
                                 "installed and the phone added to the person in Settings > People.")
            return [(s.removeprefix("notify."), None) for s in person["services"]], person["name"]
        raise ValueError(f"no notification target '{target}'. Persons with a phone: {with_phone}. See all targets "
                         "with ha_list_notification_targets.")

    async def send(self, target: str, message: str, title: str = "", data: dict | None = None) -> dict:
        if not self.client.allow_write:
            raise ValueError("Writes are disabled; set HA_ALLOW_WRITE=true to enable")
        if "notify" not in self.client.allowed_domains:
            raise ValueError("domain not allowed: add 'notify' to the allowed domains (HA_ALLOWED_DOMAINS) to send "
                             "messages")
        if not isinstance(target, str) or not target.strip():
            raise ValueError("target: a person's name, a notify service or a notify entity")
        if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE:
            raise ValueError(f"message: 1-{MAX_MESSAGE} characters of text")
        if not isinstance(title, str) or len(title) > MAX_TITLE:
            raise ValueError(f"title: at most {MAX_TITLE} characters")
        if data is not None:
            if not isinstance(data, dict) or {"target", "entity_id", "message", "title"} & data.keys():
                raise ValueError("data: an object with options for the app (e.g. {\"url\": \"/lovelace/0\"}); it "
                                 "cannot set target, entity_id, message or title")
            if len(json.dumps(data)) > MAX_DATA:
                raise ValueError(f"data larger than {MAX_DATA} bytes")
        resolved, person = await self._resolve(target)
        sent = []
        for service, entity_id in resolved:
            body: dict = {"message": message.strip()}
            if entity_id:
                body = {"entity_id": entity_id, **body}
            if title.strip():
                body["title"] = title.strip()
            if data and not entity_id:
                body["data"] = data
            try:
                await self.client._request("POST", f"/api/services/notify/{service}", data=body)
            except RuntimeError as exc:
                raise RuntimeError(f"{exc}. Sent so far: {', '.join(sent) or 'nothing'}. Next step: check that the "
                                   "Home Assistant app on the phone is signed in and notifications are allowed for "
                                   "it, then try again.") from None
            sent.append(entity_id or f"notify.{service}")
        result = {"sent_to": sent,
                  "note": "Home Assistant accepted the message; it does not confirm that the phone showed it - ask "
                          "the user to look at the phone." if person else
                          "Home Assistant accepted the message; it does not confirm the delivery."}
        if person:
            result["person"] = person
            if len(sent) > 1:
                result["note"] += f" {person} has {len(sent)} phones; all got it."
        return result
