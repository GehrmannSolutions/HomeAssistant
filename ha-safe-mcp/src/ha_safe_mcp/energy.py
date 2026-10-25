"""Energy dashboard settings: sources (grid, solar, battery, gas, water) and single devices (e.g. smart plugs).

Sources (HA Core 2026.10): components/energy/websocket_api.py (``energy/get_prefs``, ``energy/save_prefs`` -
admin, ``energy/validate``, ``energy/info``, ``energy/solar_forecast``) and components/energy/data.py (schemas).
``save_prefs`` replaces each list it is given as a whole; omitted lists stay as they are.

Guardrails:
- read: settings with HA's own validation problems per item, candidate sensors, usage per device/source
- admin write: save settings, add one device; every statistic the settings point to must exist in the recorder
  (HA itself stores anything, the energy dashboard then shows errors)
- admin write + delete: remove one device
- every write is journaled by the server (kind ``energy``), undo writes the previous settings back
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .server import HAClient

SOURCE_TYPES = ("grid", "solar", "battery", "gas", "water")
LISTS = ("energy_sources", "device_consumption", "device_consumption_water")
SOURCE_KEYS = {"type", "name", "cost_adjustment_day", "power_config", "capacity", "flow_from", "flow_to", "power",
               "config_entry_solar_forecast"}
SOURCE_PREFIXES = ("stat_", "entity_", "number_")
DEVICE_KEYS = {"stat_consumption", "stat_rate", "name", "included_in_stat"}
STAT_ID = re.compile(r"^[a-z0-9_]+[.:][a-z0-9_]+$")
PERIODS = ("today", "yesterday", "7d", "30d", "this_month")
# which statistic of a source counts as what in a usage summary
SOURCE_ROLES = {("grid", "stat_energy_from"): "grid_import", ("grid", "stat_energy_to"): "grid_export",
                ("solar", "stat_energy_from"): "solar", ("battery", "stat_energy_from"): "battery_discharge",
                ("battery", "stat_energy_to"): "battery_charge", ("gas", "stat_energy_from"): "gas",
                ("water", "stat_energy_from"): "water"}
CANDIDATE_CLASSES = {"energy": ("energy", "energy_storage"), "power": ("power",), "battery": ("battery",),
                     "gas": ("gas",), "water": ("water",)}
# Plain explanations of HA's validation issue types (components/energy/validate.py), for models and users
PROBLEM_HINTS = {
    "statistics_not_defined": "no long-term statistics yet; a new sensor gets them at the next hourly run, "
                              "otherwise it needs a state_class",
    "recorder_untracked": "the recorder excludes this entity, so it has no history",
    "entity_not_defined": "the entity does not exist (renamed or removed)",
    "entity_unavailable": "the entity is unavailable right now (device offline?)",
    "entity_state_non_numeric": "the state is not a number",
    "entity_negative_state": "the state is negative, energy counters must not be",
    "entity_unexpected_device_class": "wrong device_class for this place (e.g. power instead of energy)",
    "entity_unexpected_state_class": "state_class must be total or total_increasing for energy counters",
    "entity_state_class_measurement_no_last_reset": "state_class measurement needs last_reset; use "
                                                    "total_increasing instead",
    "entity_unexpected_unit_energy": "unit must be an energy unit such as kWh or Wh",
    "entity_unexpected_unit_power": "unit must be a power unit such as W or kW",
    "entity_unexpected_unit_gas": "unit must be a gas unit such as m³ or kWh",
    "entity_unexpected_unit_water": "unit must be a water unit such as m³ or L",
    "entity_unexpected_unit_energy_price": "price unit must be currency per kWh/Wh",
    "entity_unexpected_unit_gas_price": "price unit must be currency per gas unit",
    "entity_unexpected_unit_water_price": "price unit must be currency per water unit",
    "entity_unexpected_unit_volume_flow_rate": "unit must be a flow rate such as m³/h or L/min",
}


def _empty() -> dict:
    return {key: [] for key in LISTS}


class HAEnergy:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 now: Callable[[], datetime] | None = None):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete
        self.now = now or (lambda: datetime.now(timezone.utc))
        self._zone = None

    # ------------------------------------------------------------------ gates and helpers
    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    async def prefs(self) -> dict:
        """The stored settings as three lists (empty when the energy dashboard was never set up)."""
        try:
            data = await self.ws.command("energy/get_prefs")
        except RuntimeError as exc:
            if "not_found" in str(exc):
                return _empty()
            raise
        data = data if isinstance(data, dict) else {}
        return {key: list(data.get(key) or []) for key in LISTS}

    async def _zone_info(self):
        if self._zone is None:
            try:
                config = await self.client._request("GET", "/api/config")
                self._zone = ZoneInfo(config.get("time_zone") or "UTC")
            except (RuntimeError, ZoneInfoNotFoundError, ValueError, AttributeError):
                self._zone = timezone.utc
        return self._zone

    @staticmethod
    def _statistics_of(item: dict) -> list[tuple[str, str]]:
        """(key, statistic id) pairs an item points to, including legacy grid flows."""
        found = [(k, v) for k, v in item.items() if k.startswith("stat_") and isinstance(v, str)]
        for flow in ("flow_from", "flow_to"):
            for sub in item.get(flow) or []:
                if isinstance(sub, dict):
                    found += [(k, v) for k, v in sub.items() if k.startswith("stat_") and isinstance(v, str)]
        return found

    # ------------------------------------------------------------------ read
    async def get_config(self) -> dict:
        try:
            raw = await self.ws.command("energy/get_prefs")
            configured = True
        except RuntimeError as exc:
            if "not_found" not in str(exc):
                raise
            raw, configured = _empty(), False
        prefs = {key: list((raw or {}).get(key) or []) for key in LISTS}
        validation = await self.ws.command("energy/validate") or {}
        info = await self.ws.command("energy/info") or {}
        problems = 0
        result: dict[str, Any] = {"configured": configured}
        for key in LISTS:
            checks = validation.get(key) or []
            items = []
            for index, item in enumerate(prefs[key]):
                issues = checks[index] if index < len(checks) and isinstance(checks[index], list) else []
                issues = [{"type": i.get("type"), "entities": [a[0] for a in i.get("affected_entities") or []],
                           "hint": PROBLEM_HINTS.get(i.get("type"), "")} for i in issues if isinstance(i, dict)]
                problems += len(issues)
                items.append({**item, "problems": issues})
            result[key] = items
        result["problem_count"] = problems
        if not any(prefs[key] for key in LISTS):
            result["hint"] = ("nothing configured yet; ha_get_energy_usage still answers usage questions from all "
                              "energy sensors. Only change the settings when the user asks for it.")
        result["solar_forecast_domains"] = info.get("solar_forecast_domains") or []
        return result

    async def find_sensors(self, query: str = "") -> dict:
        """Sensors that could go into the energy dashboard, grouped by kind, marked if already used."""
        states = await self.client._request("GET", "/api/states")
        statistic_ids = {item.get("statistic_id") for item in await self.ws.command("recorder/list_statistic_ids") or []
                         if isinstance(item, dict)}
        prefs = await self.prefs()
        used = {}
        for key in LISTS:
            for item in prefs[key]:
                for _, statistic in self._statistics_of(item):
                    used.setdefault(statistic, key)
        needle = str(query or "").casefold()
        result: dict[str, Any] = {kind: [] for kind in CANDIDATE_CLASSES}
        for state in states if isinstance(states, list) else []:
            entity_id = state.get("entity_id", "")
            attributes = state.get("attributes") or {}
            if not entity_id.startswith("sensor.") or not isinstance(attributes, dict):
                continue
            name = str(attributes.get("friendly_name") or "")
            if needle and needle not in f"{entity_id} {name}".casefold():
                continue
            for kind, classes in CANDIDATE_CLASSES.items():
                if attributes.get("device_class") in classes:
                    result[kind].append({
                        "entity_id": entity_id, "name": name, "state": state.get("state"),
                        "unit": attributes.get("unit_of_measurement"), "state_class": attributes.get("state_class"),
                        "has_statistics": entity_id in statistic_ids, "in_energy_dashboard": used.get(entity_id, False)})
        result["hint"] = ("energy/gas/water sensors with state_class total or total_increasing and statistics can be "
                          "sources or devices; power sensors only as stat_rate (live power); battery = charge level")
        return result

    async def solar_forecast(self) -> dict:
        return await self.ws.command("energy/solar_forecast") or {}

    def _window(self, period: str, zone) -> tuple[datetime, datetime, str]:
        now = self.now().astimezone(zone)
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == "today":
            return midnight, now, "hour"
        if period == "yesterday":
            return midnight - timedelta(days=1), midnight, "hour"
        if period == "7d":
            return midnight - timedelta(days=6), now, "day"
        if period == "30d":
            return midnight - timedelta(days=29), now, "day"
        return midnight.replace(day=1), now, "day"

    async def usage(self, period: str = "today", statistic_ids=None) -> dict:
        """kWh (or m³) per configured device and source in a period, from the recorder statistics; with
        statistic_ids for any energy statistics instead (e.g. plugs that are not in the energy dashboard)."""
        if period not in PERIODS:
            raise ValueError(f"period must be one of {', '.join(PERIODS)}")
        if statistic_ids:
            if isinstance(statistic_ids, str):
                statistic_ids = [x.strip() for x in statistic_ids.split(",") if x.strip()]
            if not isinstance(statistic_ids, list) or not 0 < len(statistic_ids) <= 50 or not all(
                    isinstance(x, str) and STAT_ID.fullmatch(x) for x in statistic_ids):
                raise ValueError("statistic_ids: 1-50 statistic IDs from ha_find_energy_sensors")
            prefs = {"energy_sources": [], "device_consumption": [{"stat_consumption": x} for x in statistic_ids],
                     "device_consumption_water": []}
        else:
            prefs = await self.prefs()
        fallback = False
        if not statistic_ids and not any(prefs[key] for key in LISTS):
            # nothing configured: answer from every energy sensor with statistics instead of failing
            sensors = (await self.find_sensors())["energy"]
            picked = [s["entity_id"] for s in sensors if s["has_statistics"]][:50]
            names = {s["entity_id"]: s["name"] for s in sensors}
            prefs = {"energy_sources": [], "device_consumption_water": [], "device_consumption": [
                {"stat_consumption": x, "name": names.get(x) or x} for x in picked]}
            fallback = bool(picked)
        wanted: dict[str, list] = {}
        for source in prefs["energy_sources"]:
            for key, statistic in self._statistics_of(source):
                role = SOURCE_ROLES.get((source.get("type"), key))
                if role:
                    wanted.setdefault(statistic, []).append(("source", role))
        for key in ("device_consumption", "device_consumption_water"):
            for device in prefs[key]:
                if isinstance(device.get("stat_consumption"), str):
                    wanted.setdefault(device["stat_consumption"], []).append(("device", device))
        zone = await self._zone_info()
        start, end, step = self._window(period, zone)
        totals: dict[str, float] = {}
        if wanted:
            data = await self.ws.command("recorder/statistics_during_period", {
                "statistic_ids": sorted(wanted), "period": step, "types": ["change"],
                "start_time": start.isoformat(), "end_time": end.isoformat()}) or {}
            for statistic, rows in data.items():
                totals[statistic] = round(sum(r.get("change") or 0 for r in rows if isinstance(r, dict)), 3)
        sources: dict[str, float] = {}
        devices = []
        for statistic, uses in wanted.items():
            for what, detail in uses:
                if what == "source":
                    sources[detail] = round(sources.get(detail, 0) + totals.get(statistic, 0), 3)
                else:
                    devices.append({"name": detail.get("name") or statistic, "statistic": statistic,
                                    "kwh": totals.get(statistic, 0)})
        devices.sort(key=lambda d: d["kwh"], reverse=True)
        hint = ""
        if fallback:
            hint = ("the energy dashboard has no sources or devices, so these are all energy sensors with statistics "
                    "(plugs, meters). Do not change the energy settings unless the user asks for that.")
        elif not wanted:
            hint = "no energy sensors with statistics found. Do not change the energy settings unless asked."
        return {"hint": hint, "period": period, "start": start.isoformat(), "end": end.isoformat(), "sources": sources,
                "devices": devices, "note": "values are the change of each statistic in the period (kWh, gas/water "
                                            "in their own unit); statistics are hourly, the current hour may be "
                                            "missing"}

    # ------------------------------------------------------------------ write
    def _clean(self, key: str, items) -> list:
        if not isinstance(items, list):
            raise ValueError(f"{key} must be a list")
        cleaned = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError(f"every entry of {key} must be an object")
            if key == "energy_sources":
                if item.get("type") not in SOURCE_TYPES:
                    raise ValueError(f"energy source type must be one of {', '.join(SOURCE_TYPES)}")
                extra = [k for k in item if k not in SOURCE_KEYS and not k.startswith(SOURCE_PREFIXES)]
            else:
                if not isinstance(item.get("stat_consumption"), str):
                    raise ValueError(f"every entry of {key} needs stat_consumption")
                extra = [k for k in item if k not in DEVICE_KEYS]
            if extra:
                raise ValueError(f"unknown fields in {key}: {', '.join(sorted(extra))}")
            cleaned.append(item)
        return cleaned

    async def _check_statistics(self, payload: dict):
        """Statistics the change adds must exist in the recorder; ones already stored stay allowed (a vanished
        sensor in an old entry must not block other edits)."""
        known = {item.get("statistic_id") for item in await self.ws.command("recorder/list_statistic_ids") or []
                 if isinstance(item, dict)}
        current = await self.prefs()
        for items in current.values():
            for item in items:
                known |= {statistic for _, statistic in self._statistics_of(item)}
        missing = []
        for items in payload.values():
            for item in items:
                for _, statistic in self._statistics_of(item):
                    if not STAT_ID.fullmatch(statistic) or statistic not in known:
                        missing.append(statistic)
                if isinstance(item.get("included_in_stat"), str) and item["included_in_stat"] not in known:
                    missing.append(item["included_in_stat"])
        if missing:
            raise ValueError("unknown statistics (no recorder data; check ha_find_energy_sensors): "
                             + ", ".join(sorted(set(missing))))

    async def save(self, energy_sources=None, device_consumption=None, device_consumption_water=None, *,
                   check_statistics: bool = True) -> dict:
        self._check_write()
        given = {"energy_sources": energy_sources, "device_consumption": device_consumption,
                 "device_consumption_water": device_consumption_water}
        payload = {key: self._clean(key, value) for key, value in given.items() if value is not None}
        if not payload:
            raise ValueError("nothing to save: pass energy_sources, device_consumption or device_consumption_water")
        if check_statistics:
            await self._check_statistics(payload)
        await self.ws.command("energy/save_prefs", payload)
        after = await self.get_config()
        return {"saved": True, "changed": sorted(payload), "problem_count": after["problem_count"],
                "config": after}

    async def add_device(self, stat_consumption: str, name: str | None = None, stat_rate: str | None = None,
                         included_in_stat: str | None = None, water: bool = False) -> dict:
        self._check_write()
        key = "device_consumption_water" if water else "device_consumption"
        devices = (await self.prefs())[key]
        if any(d.get("stat_consumption") == stat_consumption for d in devices):
            raise ValueError(f"{stat_consumption} is already in {key}")
        device = {"stat_consumption": stat_consumption}
        for field, value in (("name", name), ("stat_rate", stat_rate), ("included_in_stat", included_in_stat)):
            if value:
                device[field] = value
        return await self.save(**{key: devices + [device]})

    async def remove_device(self, stat_consumption: str, water: bool = False) -> dict:
        self._check_delete()
        key = "device_consumption_water" if water else "device_consumption"
        devices = (await self.prefs())[key]
        kept = [d for d in devices if d.get("stat_consumption") != stat_consumption]
        if len(kept) == len(devices):
            raise ValueError(f"{stat_consumption} is not in {key}")
        # remaining entries may point to vanished sensors; keep them as they are
        return await self.save(**{key: kept}, check_statistics=False)
