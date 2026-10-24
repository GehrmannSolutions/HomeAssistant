"""Read back the target states after an action, and weather forecasts from the service response."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp import server as server_module
from ha_safe_mcp.server import HAClient, create_server
from ha_safe_mcp.weather import HAWeather

URL = "http://ha:8123"


def parse(result):
    if isinstance(result, tuple):
        result = result[1] or result[0]
    if isinstance(result, dict):
        return result.get("result", result)
    return json.loads(result[0].text)


def state(entity_id, value, **attributes):
    return httpx.Response(200, json={"entity_id": entity_id, "state": value, "attributes": attributes,
                                     "last_changed": "2026-10-25T00:00:00+00:00"})


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(server_module, "READ_BACK_DELAYS", (0, 0, 0))


async def test_switching_reports_the_states_read_back():
    server = create_server(HAClient(URL, "t", allow_write=True, allowed_domains=frozenset({"light"})))
    with respx.mock(base_url=URL) as router:
        router.post("/api/services/light/turn_off").mock(return_value=httpx.Response(200, json=[]))
        router.get("/api/states/light.a").mock(side_effect=[state("light.a", "on"), state("light.a", "off")])
        router.get("/api/states/light.b").mock(return_value=state("light.b", "off"))
        result = parse(await server.call_tool("ha_call_service", {"domain": "light", "service": "turn_off",
                                                                   "entity_id": ["light.a", "light.b"]}))
    assert result["all_confirmed"] is True
    assert [(s["entity_id"], s["state"], s["confirmed"]) for s in result["states_after"]] == [
        ("light.a", "off", True), ("light.b", "off", True)]


async def test_a_device_that_does_not_follow_is_reported_not_confirmed():
    server = create_server(HAClient(URL, "t", allow_write=True, allowed_domains=frozenset({"cover", "light"})))
    with respx.mock(base_url=URL) as router:
        router.post("/api/services/cover/close_cover").mock(return_value=httpx.Response(200, json=[]))
        router.get("/api/states/cover.sued").mock(return_value=state("cover.sued", "open", current_position=100))
        result = parse(await server.call_tool("ha_call_service", {"domain": "cover", "service": "close_cover",
                                                                   "entity_id": "cover.sued"}))
    assert result["all_confirmed"] is False
    assert result["states_after"] == [{"entity_id": "cover.sued", "state": "open", "confirmed": False,
                                       "current_position": 100}]
    assert "not confirmed" in result["hint"]


async def test_services_without_an_expected_state_just_report():
    server = create_server(HAClient(URL, "t", allow_write=True, allowed_domains=frozenset({"light"})))
    with respx.mock(base_url=URL) as router:
        router.post("/api/services/light/toggle").mock(return_value=httpx.Response(200, json=[]))
        router.get("/api/states/light.a").mock(return_value=state("light.a", "on", brightness=128))
        result = parse(await server.call_tool("ha_call_service", {"domain": "light", "service": "toggle",
                                                                   "entity_id": "light.a"}))
    assert result["all_confirmed"] is None and result["states_after"][0] == {
        "entity_id": "light.a", "state": "on", "confirmed": None, "brightness": 128}


async def test_weather_forecast_from_the_service_response_in_local_time():
    weather = HAWeather(HAClient(URL, "t"))
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "weather.home", "state": "cloudy", "attributes": {
                "friendly_name": "Home", "temperature": 7.9, "humidity": 80, "wind_speed": 12, "pressure": 1012}}]))
        router.get("/api/config").mock(return_value=httpx.Response(200, json={"time_zone": "Europe/Berlin"}))
        call = router.post("/api/services/weather/get_forecasts").mock(return_value=httpx.Response(200, json={
            "changed_states": [], "service_response": {"weather.home": {"forecast": [
                {"datetime": "2026-10-25T11:00:00+00:00", "condition": "rainy", "temperature": 9.5, "templow": 4.0,
                 "precipitation": 3.2, "precipitation_probability": 80, "wind_speed": 20, "humidity": 90}]}}}))
        result = await weather.forecast()
    assert dict(call.calls[0].request.url.params) == {"return_response": ""}
    assert json.loads(call.calls[0].request.content) == {"entity_id": "weather.home", "type": "daily"}
    assert result["entity_id"] == "weather.home" and result["current"]["condition"] == "cloudy"
    entry = {k: v for k, v in result["forecast"][0].items() if k != "day"}
    assert entry == {"datetime": "2026-10-25T12:00:00+01:00", "condition": "rainy", "temperature": 9.5,
                     "templow": 4.0, "precipitation": 3.2, "precipitation_probability": 80, "wind_speed": 20}
    with pytest.raises(ValueError):
        await weather.forecast("weather.home", kind="weekly")


def test_weather_tool_is_read_only_and_offered():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert "ha_get_weather_forecast" in names & READ_TOOLS
    assert "ha_get_weather_forecast" in select_tool_names("Wie wird das Wetter morgen?", names, allow_write=False)


async def test_forecast_entries_say_which_day_they_are(monkeypatch):
    from datetime import datetime as real_datetime
    from ha_safe_mcp import weather as weather_module

    class Clock(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return real_datetime(2026, 10, 25, 1, 5, tzinfo=tz)  # 01:05 local time
    monkeypatch.setattr(weather_module, "datetime", Clock)
    weather = HAWeather(HAClient(URL, "t"))
    days = [{"datetime": f"2026-10-{d}T11:00:00+00:00", "condition": "rainy", "temperature": 9} for d in (25, 26, 27)]
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "weather.home", "state": "cloudy", "attributes": {}}]))
        router.get("/api/config").mock(return_value=httpx.Response(200, json={"time_zone": "Europe/Berlin"}))
        router.post("/api/services/weather/get_forecasts").mock(return_value=httpx.Response(200, json={
            "service_response": {"weather.home": {"forecast": days}}}))
        result = await weather.forecast()
    assert [f["day"] for f in result["forecast"]] == ["today", "tomorrow", "Tuesday 2026-10-27"]
    assert result["now"].startswith("2026-10-25T01:05")
    with respx.mock(base_url=URL) as router:
        router.get("/api/states").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "weather.home", "state": "cloudy", "attributes": {}}]))
        router.post("/api/services/weather/get_forecasts").mock(return_value=httpx.Response(200, json={
            "service_response": {"weather.home": {"forecast": days}}}))
        tomorrow = await weather.forecast(day="tomorrow")
        by_date = await weather.forecast(day="2026-10-27")
    assert [f["datetime"][:10] for f in tomorrow["forecast"]] == ["2026-10-26"] and tomorrow["day"] == "tomorrow"
    assert [f["day"] for f in by_date["forecast"]] == ["Tuesday 2026-10-27"]
    with pytest.raises(ValueError, match="day"):
        await weather.forecast(day="übermorgen")
