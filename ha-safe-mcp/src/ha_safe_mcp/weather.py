"""Weather now and forecast. Since HA 2024 forecasts are no longer state attributes; they come from the
service response of ``weather.get_forecasts`` (components/weather/__init__.py). Reading it changes nothing, so this
is a read tool; times are converted to the time zone configured in Home Assistant."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .server import ENTITY

KINDS = ("daily", "hourly", "twice_daily")
FIELDS = ("datetime", "condition", "temperature", "templow", "precipitation", "precipitation_probability",
          "wind_speed")
CURRENT = ("temperature", "humidity", "wind_speed", "pressure", "cloud_coverage", "uv_index")


class HAWeather:
    def __init__(self, client):
        self.client = client
        self._zone = None

    async def _tz(self):
        if self._zone is None:
            config = await self.client._request("GET", "/api/config")
            try:
                self._zone = ZoneInfo(str((config or {}).get("time_zone") or "UTC"))
            except (ZoneInfoNotFoundError, ValueError):
                self._zone = timezone.utc
        return self._zone

    async def forecast(self, entity_id: str = "", kind: str = "daily", limit: int = 10) -> dict:
        if kind not in KINDS:
            raise ValueError(f"type: one of {', '.join(KINDS)}")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 48:
            raise ValueError("limit: 1-48 entries")
        states = [s for s in await self.client._request("GET", "/api/states") or []
                  if isinstance(s, dict) and str(s.get("entity_id", "")).startswith("weather.")]
        if entity_id:
            if not isinstance(entity_id, str) or not ENTITY.fullmatch(entity_id) or not entity_id.startswith("weather."):
                raise ValueError("entity_id must be a weather entity, e.g. 'weather.home'")
            state = next((s for s in states if s["entity_id"] == entity_id), None)
            if state is None:
                raise ValueError(f"unknown weather entity {entity_id}")
        elif states:
            state = states[0]
        else:
            raise ValueError("no weather entity in Home Assistant (add a weather integration such as Met.no)")
        entity_id = state["entity_id"]
        response = await self.client._request("POST", "/api/services/weather/get_forecasts?return_response",
                                              data={"entity_id": entity_id, "type": kind})
        items = (((response or {}).get("service_response") or {}).get(entity_id) or {}).get("forecast") or []
        zone = await self._tz()
        forecast = []
        for item in items[:limit]:
            entry = {key: item[key] for key in FIELDS if isinstance(item, dict) and item.get(key) is not None}
            if isinstance(entry.get("datetime"), str):
                try:
                    entry["datetime"] = datetime.fromisoformat(entry["datetime"]).astimezone(zone).isoformat()
                except ValueError:
                    pass
            forecast.append(entry)
        attributes = state.get("attributes") or {}
        current = {"condition": state.get("state"),
                   **{key: attributes[key] for key in CURRENT if attributes.get(key) is not None}}
        return {"entity_id": entity_id, "name": attributes.get("friendly_name"), "type": kind, "current": current,
                "forecast": forecast}
