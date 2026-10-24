"""Read-only debugging tools: automation/script traces, error log, logbook, history, long-term statistics,
repairs, system health, template rendering and condition tests.

Interfaces from Home Assistant Core (2026.10): WS ``trace/list|get``, ``system_log/list``,
``recorder/statistics_during_period``, ``recorder/list_statistic_ids``, ``repairs/list_issues``,
``system_health/info`` (subscription), ``test_condition``; REST ``/api/logbook/<start>``,
``/api/history/period/<start>``, ``POST /api/template``. Several of these need an HA admin user.
Outputs are reduced and capped so a small model's context is not flooded.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Callable
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

TRACE_DOMAINS = ("automation", "script")
ENTITY = re.compile(r"^[a-z_][a-z0-9_]*\.[a-z0-9_]+$")
ITEM_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PERIODS = ("5minute", "hour", "day", "week", "month")
STAT_TYPES = ("change", "last_reset", "max", "mean", "min", "state", "sum")
TRACE_SUMMARY = ("run_id", "item_id", "state", "script_execution", "timestamp", "last_step", "error", "trigger")
ISSUE_FIELDS = ("domain", "issue_id", "severity", "translation_key", "is_fixable", "ignored", "created",
                "learn_more_url", "breaks_in_ha_version")
MAX_TEXT = 2000
MAX_STEP_CHARS = 1500


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


def _clip(value, limit: int):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + " …(gekürzt)"


def _entities(entity_ids) -> list[str]:
    if isinstance(entity_ids, str):
        entity_ids = [e.strip() for e in entity_ids.split(",") if e.strip()]
    if not isinstance(entity_ids, list) or not 0 < len(entity_ids) <= 10 or not all(
            isinstance(e, str) and ENTITY.fullmatch(e) for e in entity_ids):
        raise ValueError("entity_ids: 1-10 entity IDs like 'sensor.living_room_temperature'")
    return entity_ids


def _hours(hours) -> float:
    if not isinstance(hours, (int, float)) or isinstance(hours, bool) or not 0 < hours <= 24 * 366:
        raise ValueError("hours must be a number between 0 and 8784")
    return float(hours)


def _tail(items: list, limit: int) -> list:
    return items[-limit:] if limit and len(items) > limit else items


def _local(value, zone) -> str | None:
    """ISO string or epoch seconds -> ISO in the HA time zone (small models misread +00:00 as local time)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        moment = datetime.fromtimestamp(value, timezone.utc)
    elif isinstance(value, str) and value:
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
    else:
        return value
    return moment.astimezone(zone).isoformat(timespec="seconds")


class HADiagnostics:
    def __init__(self, client, ws, *, now: Callable[[], datetime] | None = None):
        self.client, self.ws = client, ws
        self.now = now or (lambda: datetime.now(timezone.utc))
        self._zone = None

    async def zone(self):
        """Time zone configured in Home Assistant (cached); UTC if it cannot be read."""
        if self._zone is None:
            try:
                config = await self.client._request("GET", "/api/config")
                self._zone = ZoneInfo(config.get("time_zone") or "UTC")
            except (RuntimeError, ZoneInfoNotFoundError, ValueError, AttributeError):
                self._zone = timezone.utc
        return self._zone

    def _window(self, hours, start: str = "", end: str = "") -> tuple[datetime, datetime]:
        def parse(text, name):
            try:
                moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except (AttributeError, ValueError):
                raise ValueError(f"{name} must be an ISO date/time like 2026-10-25T06:00:00+02:00") from None
            return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
        stop = parse(end, "end") if end else self.now()
        begin = parse(start, "start") if start else stop - timedelta(hours=_hours(hours))
        if begin >= stop:
            raise ValueError("start must be before end")
        return begin, stop

    # ------------------------------------------------------------ traces
    async def _item_id(self, domain: str, item: str) -> str:
        if domain not in TRACE_DOMAINS:
            raise ValueError("domain must be 'automation' or 'script'")
        if item.startswith(f"{domain}."):
            if not ENTITY.fullmatch(item):
                raise ValueError("invalid entity_id")
            if domain == "script":
                return item.split(".", 1)[1]
            state = await self.client._request("GET", f"/api/states/{item}")
            item_id = (state.get("attributes") or {}).get("id") if isinstance(state, dict) else None
            if not isinstance(item_id, str):
                raise ValueError("this automation has no ID (YAML without id); traces need one")
            return item_id
        if not ITEM_ID.fullmatch(item):
            raise ValueError("item: entity_id (automation.x / script.x) or the automation's config id")
        return item

    async def list_traces(self, domain: str, item: str = "", limit: int = 20) -> list[dict]:
        if domain not in TRACE_DOMAINS:
            raise ValueError("domain must be 'automation' or 'script'")
        payload = {"domain": domain}
        if item:
            payload["item_id"] = await self._item_id(domain, item)
        runs = await self.ws.command("trace/list", payload)
        runs = [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []
        runs.sort(key=lambda r: str((r.get("timestamp") or {}).get("start") or ""), reverse=True)
        zone = await self.zone()
        result = []
        for run in runs[:max(1, min(limit, 100))]:
            item = {key: run.get(key) for key in TRACE_SUMMARY if key in run}
            if isinstance(item.get("timestamp"), dict):
                item["timestamp"] = {k: _local(v, zone) for k, v in item["timestamp"].items()}
            result.append(item)
        return result

    async def get_trace(self, domain: str, item: str, run_id: str, include_config: bool = False) -> dict:
        item_id = await self._item_id(domain, item)
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise ValueError("run_id from ha_list_traces")
        trace = await self.ws.command("trace/get", {"domain": domain, "item_id": item_id, "run_id": run_id})
        if not isinstance(trace, dict):
            raise RuntimeError("Unexpected Home Assistant response")
        steps = []
        for path, entries in (trace.get("trace") or {}).items():
            for entry in entries if isinstance(entries, list) else []:
                step = {"path": entry.get("path", path), "timestamp": entry.get("timestamp")}
                for key in ("error", "result", "changed_variables"):
                    if entry.get(key) not in (None, {}, []):
                        step[key] = _clip(entry[key], MAX_STEP_CHARS) if key != "error" else entry[key]
                steps.append(step)
        zone = await self.zone()
        for step in steps:
            step["timestamp"] = _local(step.get("timestamp"), zone)
        result = {key: trace.get(key) for key in TRACE_SUMMARY if key in trace}
        if isinstance(result.get("timestamp"), dict):
            result["timestamp"] = {k: _local(v, zone) for k, v in result["timestamp"].items()}
        result["steps"] = steps[:200]
        if include_config:
            result["config"] = trace.get("config")
        return result

    # ------------------------------------------------------------ logs
    async def error_log(self, level: str = "", query: str = "", limit: int = 30) -> list[dict]:
        entries = await self.ws.command("system_log/list")
        entries = [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []
        level, needle = str(level or "").upper(), str(query or "").casefold()
        zone = await self.zone()
        result = []
        for entry in sorted(entries, key=lambda e: e.get("timestamp") or 0, reverse=True):
            message = " | ".join(str(m) for m in entry.get("message") or [])
            if level and entry.get("level") != level:
                continue
            if needle and needle not in f"{entry.get('name', '')} {message}".casefold():
                continue
            stamp = entry.get("timestamp")
            result.append({"level": entry.get("level"), "name": entry.get("name"), "message": _clip(message, MAX_TEXT),
                           "source": entry.get("source"), "count": entry.get("count"),
                           "timestamp": _local(stamp, zone),
                           "exception": _clip(entry.get("exception") or "", MAX_TEXT)})
            if len(result) >= max(1, min(limit, 200)):
                break
        return result

    async def logbook(self, entity_id: str = "", hours: float = 24, start: str = "", end: str = "",
                      limit: int = 100) -> list[dict]:
        begin, stop = self._window(hours, start, end)
        params = {"end_time": _iso(stop)}
        if entity_id:
            params["entity"] = ",".join(_entities(entity_id))
        path = f"/api/logbook/{quote(_iso(begin), safe=':')}?{urlencode(params)}"
        entries = await self.client._request("GET", path, timeout=30)
        entries = [e for e in entries if isinstance(e, dict)] if isinstance(entries, list) else []
        keep = ("when", "name", "message", "entity_id", "state", "domain", "context_event_type",
                "context_domain", "context_service", "context_entity_id", "context_name")
        zone = await self.zone()
        result = []
        for entry in _tail(entries, max(1, min(limit, 500))):
            item = {k: entry[k] for k in keep if k in entry}
            if "when" in item:
                item["when"] = _local(item["when"], zone)
            result.append(item)
        return result

    # ------------------------------------------------------------ history and statistics
    async def history(self, entity_ids, hours: float = 24, start: str = "", end: str = "",
                      max_points: int = 200) -> dict:
        ids = _entities(entity_ids)
        begin, stop = self._window(hours, start, end)
        params = urlencode({"filter_entity_id": ",".join(ids), "end_time": _iso(stop),
                            "minimal_response": "", "no_attributes": ""})
        series = await self.client._request("GET", f"/api/history/period/{quote(_iso(begin), safe=':')}?{params}",
                                            timeout=30)
        result: dict = {}
        zone = await self.zone()
        for rows in series if isinstance(series, list) else []:
            rows = [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []
            if not rows:
                continue
            entity = rows[0].get("entity_id") or ""
            points = [{"state": r.get("state"), "at": _local(r.get("last_changed") or r.get("last_updated"), zone)}
                      for r in rows]
            result[entity] = {"total_points": len(points), "points": _tail(points, max(1, min(max_points, 1000)))}
        return result

    async def statistics(self, statistic_ids, hours: float = 24, start: str = "", end: str = "",
                         period: str = "hour", types=None, max_points: int = 200) -> dict:
        ids = [x.strip() for x in statistic_ids.split(",") if x.strip()] if isinstance(statistic_ids, str) \
            else statistic_ids
        if not isinstance(ids, list) or not 0 < len(ids) <= 10 or not all(
                isinstance(x, str) and re.fullmatch(r"[a-z0-9_]+[.:][a-z0-9_]+", x) for x in ids):
            raise ValueError("statistic_ids: 1-10 IDs from ha_list_statistic_ids")
        if period not in PERIODS:
            raise ValueError(f"period must be one of {', '.join(PERIODS)}")
        payload = {"statistic_ids": ids, "period": period}
        begin, stop = self._window(hours, start, end)
        payload.update(start_time=_iso(begin), end_time=_iso(stop))
        if types:
            if not isinstance(types, list) or not set(types) <= set(STAT_TYPES):
                raise ValueError(f"types: any of {', '.join(STAT_TYPES)}")
            payload["types"] = types
        data = await self.ws.command("recorder/statistics_during_period", payload)
        zone = await self.zone()
        result = {}
        for statistic_id, rows in (data or {}).items():
            rows = [dict(r) for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []
            for row in rows:
                for key in ("start", "end", "last_reset"):
                    if isinstance(row.get(key), (int, float)):
                        row[key] = _local(row[key] / 1000, zone)
            result[statistic_id] = {"total_rows": len(rows), "rows": _tail(rows, max(1, min(max_points, 1000)))}
        return result

    async def list_statistic_ids(self, query: str = "", limit: int = 100) -> list[dict]:
        items = await self.ws.command("recorder/list_statistic_ids")
        needle = str(query or "").casefold()
        result = []
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            text = f"{item.get('statistic_id', '')} {item.get('name') or ''}".casefold()
            if needle and needle not in text:
                continue
            result.append({"statistic_id": item.get("statistic_id"), "name": item.get("name"),
                           "unit": item.get("display_unit_of_measurement") or item.get("statistics_unit_of_measurement"),
                           "has_sum": item.get("has_sum"), "has_mean": item.get("has_mean")})
        return result[:max(1, min(limit, 500))]

    # ------------------------------------------------------------ repairs and health
    async def repairs(self, include_ignored: bool = False) -> list[dict]:
        data = await self.ws.command("repairs/list_issues")
        issues = data.get("issues") if isinstance(data, dict) else []
        return [{k: i.get(k) for k in ISSUE_FIELDS if k in i} for i in issues or []
                if isinstance(i, dict) and (include_ignored or not i.get("ignored"))]

    async def system_health(self) -> dict:
        reply = await self.ws.command("system_health/info", collect_events=lambda e: isinstance(e, dict)
                                      and e.get("type") == "finish")
        health: dict = {}
        for event in reply.get("events", []) if isinstance(reply, dict) else []:
            if not isinstance(event, dict):
                continue
            if event.get("type") == "initial":
                for domain, block in (event.get("data") or {}).items():
                    info = block.get("info") if isinstance(block, dict) else None
                    health[domain] = {k: ("pending" if isinstance(v, dict) and v.get("type") == "pending" else v)
                                      for k, v in (info or {}).items()}
            elif event.get("type") == "update":
                value = event.get("data") if event.get("success") else f"error: {event.get('error', {}).get('msg', '')}"
                health.setdefault(event.get("domain"), {})[event.get("key")] = value
        return health

    # ------------------------------------------------------------ templates and conditions
    async def render_template(self, template: str, variables: dict | None = None) -> dict:
        if not isinstance(template, str) or not template.strip() or len(template) > 10000:
            raise ValueError("template: Jinja text, e.g. \"{{ states('sun.sun') }}\"")
        body = {"template": template}
        if variables:
            if not isinstance(variables, dict):
                raise ValueError("variables must be an object")
            body["variables"] = variables
        text = await self.client._request("POST", "/api/template", data=body, as_text=True)
        return {"result": _clip(text, 20000)}

    async def test_condition(self, condition, variables: dict | None = None) -> dict:
        if not isinstance(condition, (dict, list)) or not condition:
            raise ValueError("condition: an object like {\"condition\": \"state\", \"entity_id\": \"light.x\", "
                             "\"state\": \"on\"} or a list of them")
        payload = {"condition": condition}
        if variables:
            payload["variables"] = variables
        result = await self.ws.command("test_condition", payload)
        return {"result": bool(result.get("result"))} if isinstance(result, dict) else {"result": result}
