"""Calendars and to-do lists (the interfaces the HA UI uses).

Sources (HA Core 2026.10): components/calendar/__init__.py (REST /api/calendars[/{entity_id}], service
calendar.create_event, WS calendar/event/update|delete) and components/todo/__init__.py (WS todo/item/list, services
todo.add_item|update_item|remove_item).

Guardrails: reading is free. Adding and changing events/items is an action like switching a light: it needs writes
enabled and the domain ``calendar`` or ``todo`` in the allowed domains (same checks as ha_call_service). Deleting
an event or removing items needs the delete level as well. Events and items are data, not configuration, so they
are not in the change journal.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from .server import ENTITY

MAX_EVENTS = 200
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _entity(entity_id, domain: str) -> str:
    if not isinstance(entity_id, str) or not ENTITY.fullmatch(entity_id) or not entity_id.startswith(domain + "."):
        raise ValueError(f"entity_id must be a {domain} entity, e.g. '{domain}.family'")
    return entity_id


def _text(value, label: str, limit: int = 255) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{label} must be 1-{limit} characters")
    return value


def _when(value, label: str) -> tuple[str, bool]:
    """('YYYY-MM-DD', True) for a date, (ISO datetime, False) for a date and time."""
    if isinstance(value, str) and DATE.fullmatch(value):
        date.fromisoformat(value)
        return value, True
    try:
        datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a date 'YYYY-MM-DD' or a date and time 'YYYY-MM-DDTHH:MM[:SS]'") from None
    return value, False


def _range(start, end) -> tuple[str, str, bool]:
    start, start_day = _when(start, "start")
    end, end_day = _when(end, "end")
    if start_day != end_day:
        raise ValueError("start and end must both be dates (all-day) or both date and time")
    first, last = (date.fromisoformat(start), date.fromisoformat(end)) if start_day else \
        (datetime.fromisoformat(start), datetime.fromisoformat(end))
    if not start_day and (first.tzinfo is None) != (last.tzinfo is None):
        raise ValueError("start and end must both have a UTC offset or both have none")
    if last <= first:
        raise ValueError("end must be after start (for all-day events end is the day after the last day)")
    return start, end, start_day


class HAPlanner:
    def __init__(self, client, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete

    def _check_control(self, domain: str):
        if not self.client.allow_write:
            raise ValueError("Writes are disabled; set HA_ALLOW_WRITE=true to enable")
        if domain not in self.client.allowed_domains:
            raise ValueError(f"domain {domain} not allowed: add '{domain}' to the allowed domains")

    async def _existing(self, entity_id, domain: str) -> str:
        """HA silently ignores unknown targets in service calls; refuse them instead of reporting success."""
        _entity(entity_id, domain)
        try:
            await self.client._request("GET", f"/api/states/{entity_id}")
        except RuntimeError as exc:
            if "404" in str(exc):
                lister = "ha_list_calendars" if domain == "calendar" else "ha_list_todo_lists"
                raise ValueError(f"unknown {domain} entity {entity_id}: pick one from {lister}") from None
            raise
        return entity_id

    def _check_delete(self, domain: str):
        self._check_control(domain)
        if not self.allow_admin_write or not self.allow_delete:
            raise ValueError("delete disabled: deleting events or removing items needs the delete level "
                             "(HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE)")

    # ------------------------------------------------------------------ calendars
    async def list_calendars(self) -> list[dict]:
        try:
            items = await self.client._request("GET", "/api/calendars")
        except RuntimeError as exc:
            if "404" in str(exc):
                return []  # the calendar integration is not loaded: no calendars
            raise
        return [{"entity_id": c.get("entity_id"), "name": c.get("name")} for c in items or [] if isinstance(c, dict)]

    @staticmethod
    def _event(calendar: str, event: dict) -> dict:
        start, end = event.get("start") or {}, event.get("end") or {}
        out = {"calendar": calendar, "summary": event.get("summary"),
               "start": start.get("dateTime") or start.get("date"), "end": end.get("dateTime") or end.get("date"),
               "uid": event.get("uid")}
        if "date" in start and "dateTime" not in start:
            out["all_day"] = True
        for key in ("location", "description", "rrule", "recurrence_id"):
            if event.get(key):
                out[key] = event[key][:500] if isinstance(event[key], str) else event[key]
        return out

    async def get_events(self, entity_id: str = "", days: int = 7, start: str = "") -> dict:
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 31:
            raise ValueError("days must be 1-31")
        if start:
            value, is_day = _when(start, "start")
            begin = datetime.fromisoformat(value) if not is_day else datetime.fromisoformat(value + "T00:00:00")
            if begin.tzinfo is None:
                begin = begin.replace(tzinfo=timezone.utc) if is_day else begin.astimezone()
        else:
            begin = datetime.now(timezone.utc)
        until = begin + timedelta(days=days)
        calendars = [_entity(entity_id, "calendar")] if entity_id else [c["entity_id"] for c in await self.list_calendars()]
        events = []
        for calendar in calendars:
            found = await self.client._request("GET", f"/api/calendars/{calendar}?start={begin.isoformat()}"
                                                      f"&end={until.isoformat()}".replace("+", "%2B"))
            events += [self._event(calendar, e) for e in found or [] if isinstance(e, dict)]
        events.sort(key=lambda e: str(e["start"]))
        result = {"start": begin.isoformat(), "end": until.isoformat(), "events": events[:MAX_EVENTS]}
        if len(events) > MAX_EVENTS:
            result["truncated"] = True
        return result

    async def create_event(self, entity_id: str, summary: str, start: str, end: str, description: str | None = None,
                           location: str | None = None) -> dict:
        self._check_control("calendar")
        start, end, all_day = _range(start, end)
        await self._existing(entity_id, "calendar")
        data = {"summary": _text(summary, "summary"),
                **({"start_date": start, "end_date": end} if all_day else
                   {"start_date_time": start, "end_date_time": end})}
        if description:
            data["description"] = _text(description, "description", 2000)
        if location:
            data["location"] = _text(location, "location")
        await self.client.call_service("calendar", "create_event", entity_id, data)
        return {"created": True, "calendar": entity_id, "summary": summary, "start": start, "end": end}

    async def update_event(self, entity_id: str, uid: str, summary: str, start: str, end: str,
                           description: str | None = None, location: str | None = None,
                           recurrence_id: str | None = None, recurrence_range: str | None = None) -> dict:
        self._check_control("calendar")
        start, end, _ = _range(start, end)
        await self._existing(entity_id, "calendar")
        event = {"summary": _text(summary, "summary"), "dtstart": start, "dtend": end}
        if description is not None:
            event["description"] = description
        if location is not None:
            event["location"] = location
        payload = {"entity_id": entity_id, "uid": _text(uid, "uid"), "event": event}
        payload.update(self._recurrence(recurrence_id, recurrence_range))
        await self.ws.command("calendar/event/update", payload)
        return {"updated": True, "calendar": entity_id, "uid": uid}

    @staticmethod
    def _recurrence(recurrence_id, recurrence_range) -> dict:
        extra = {}
        if recurrence_id:
            extra["recurrence_id"] = _text(recurrence_id, "recurrence_id")
        if recurrence_range:
            if recurrence_range != "THISANDFUTURE":
                raise ValueError("recurrence_range may only be 'THISANDFUTURE'")
            extra["recurrence_range"] = recurrence_range
        return extra

    async def delete_event(self, entity_id: str, uid: str, recurrence_id: str | None = None,
                           recurrence_range: str | None = None) -> dict:
        self._check_delete("calendar")
        payload = {"entity_id": await self._existing(entity_id, "calendar"), "uid": _text(uid, "uid")}
        payload.update(self._recurrence(recurrence_id, recurrence_range))
        await self.ws.command("calendar/event/delete", payload)
        return {"deleted": True, "calendar": entity_id, "uid": uid}

    # ------------------------------------------------------------------ to-do lists
    async def list_todo_lists(self) -> list[dict]:
        states = await self.client._request("GET", "/api/states")
        result = []
        for state in states or []:
            if isinstance(state, dict) and str(state.get("entity_id", "")).startswith("todo."):
                try:
                    open_items = int(state.get("state"))
                except (TypeError, ValueError):
                    open_items = None
                result.append({"entity_id": state["entity_id"],
                               "name": (state.get("attributes") or {}).get("friendly_name"),
                               "open_items": open_items})
        return result

    async def get_todo_items(self, entity_id: str, status: str = "needs_action") -> list[dict]:
        _entity(entity_id, "todo")
        if status not in ("", "needs_action", "completed"):
            raise ValueError("status: 'needs_action' (open), 'completed' or '' for all")
        result = await self.ws.command("todo/item/list", {"entity_id": entity_id})
        items = result.get("items", []) if isinstance(result, dict) else []
        return [{key: item[key] for key in ("uid", "summary", "status", "due", "description") if item.get(key)}
                for item in items if isinstance(item, dict) and (not status or item.get("status") == status)][:500]

    @staticmethod
    def _due(due) -> dict:
        if due is None:
            return {}
        value, is_day = _when(due, "due")
        return {"due_date": value} if is_day else {"due_datetime": value}

    async def add_todo_item(self, entity_id: str, item: str, due: str | None = None,
                            description: str | None = None) -> dict:
        self._check_control("todo")
        data = {"item": _text(item, "item"), **self._due(due)}
        if description:
            data["description"] = _text(description, "description", 2000)
        await self.client.call_service("todo", "add_item", await self._existing(entity_id, "todo"), data)
        return {"added": True, "list": entity_id, "item": item}

    async def update_todo_item(self, entity_id: str, item: str, rename: str | None = None, status: str | None = None,
                               due: str | None = None, description: str | None = None) -> dict:
        self._check_control("todo")
        data = {"item": _text(item, "item")}
        if rename:
            data["rename"] = _text(rename, "rename")
        if status is not None:
            if status not in ("needs_action", "completed"):
                raise ValueError("status: 'completed' (done) or 'needs_action' (open again)")
            data["status"] = status
        data.update(self._due(due))
        if description is not None:
            data["description"] = description
        if len(data) == 1:
            raise ValueError("nothing to change: give rename, status, due or description")
        await self.client.call_service("todo", "update_item", await self._existing(entity_id, "todo"), data)
        return {"updated": True, "list": entity_id, "item": item}

    async def remove_todo_items(self, entity_id: str, items: list[str]) -> dict:
        self._check_delete("todo")
        if not isinstance(items, list) or not 1 <= len(items) <= 50:
            raise ValueError("items: a list of 1-50 item names or uids")
        names = [_text(i, "item") for i in items]
        await self.client.call_service("todo", "remove_item", await self._existing(entity_id, "todo"), {"item": names})
        return {"removed": len(names), "list": entity_id}
