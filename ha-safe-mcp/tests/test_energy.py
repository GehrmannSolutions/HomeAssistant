"""Energy dashboard settings (HA components/energy websocket_api.py): read, validate, find sensors, usage, write."""
from datetime import datetime, timezone

import pytest

from ha_safe_mcp.energy import HAEnergy
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
PREFS = {"energy_sources": [
    {"type": "grid", "stat_energy_from": "sensor.grid_in", "stat_energy_to": "sensor.grid_out",
     "cost_adjustment_day": 0.0},
    {"type": "solar", "stat_energy_from": "sensor.hms_energy", "config_entry_solar_forecast": None}],
    "device_consumption": [{"stat_consumption": "sensor.rack_energy", "name": "Rack"},
                           {"stat_consumption": "sensor.gone_energy", "name": "Gone"}],
    "device_consumption_water": []}
VALIDATE = {"energy_sources": [[], []],
            "device_consumption": [[], [{"type": "entity_not_defined",
                                         "affected_entities": [["sensor.gone_energy", None]]}]],
            "device_consumption_water": []}
STAT_IDS = [{"statistic_id": s, "statistics_unit_of_measurement": "kWh"} for s in
            ("sensor.grid_in", "sensor.grid_out", "sensor.hms_energy", "sensor.rack_energy", "sensor.plug_energy")]
STATES = [
    {"entity_id": "sensor.plug_energy", "state": "12.5", "attributes": {
        "device_class": "energy", "state_class": "total_increasing", "unit_of_measurement": "kWh",
        "friendly_name": "Plug Energie"}},
    {"entity_id": "sensor.hms_energy", "state": "969", "attributes": {
        "device_class": "energy", "state_class": "total_increasing", "unit_of_measurement": "kWh",
        "friendly_name": "PV-Wechselrichter Energie"}},
    {"entity_id": "sensor.plug_power", "state": "40", "attributes": {
        "device_class": "power", "state_class": "measurement", "unit_of_measurement": "W",
        "friendly_name": "Plug Leistung"}},
    {"entity_id": "sensor.akku_soc", "state": "80", "attributes": {
        "device_class": "battery", "state_class": "measurement", "unit_of_measurement": "%",
        "friendly_name": "Akku Ladestand"}},
    {"entity_id": "light.x", "state": "on", "attributes": {}},
]


class FakeWS:
    def __init__(self, prefs=PREFS, stats=None):
        self.prefs = prefs
        self.stats = stats or {}
        self.calls = []

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "energy/get_prefs":
            if self.prefs is None:
                raise RuntimeError("Home Assistant WebSocket error: not_found")
            return self.prefs
        if kind == "energy/validate":
            return VALIDATE
        if kind == "energy/info":
            return {"cost_sensors": {}, "solar_forecast_domains": ["forecast_solar"]}
        if kind == "energy/solar_forecast":
            return {}
        if kind == "recorder/list_statistic_ids":
            return STAT_IDS
        if kind == "recorder/statistics_during_period":
            return self.stats
        if kind == "energy/save_prefs":
            self.prefs = {**(self.prefs or {"energy_sources": [], "device_consumption": [],
                                             "device_consumption_water": []}), **payload}
            return self.prefs
        raise AssertionError(kind)


class FakeClient(HAClient):
    async def _request(self, method, path, **kwargs):
        if path == "/api/states":
            return STATES
        if path == "/api/config":
            return {"time_zone": "Europe/Berlin"}
        raise AssertionError(path)


def make(ws, *, admin=True, delete=False):
    energy = HAEnergy(FakeClient(URL, "t", allow_write=True), ws, allow_admin_write=admin, allow_delete=delete,
                      now=lambda: datetime(2026, 10, 25, 17, 0, tzinfo=timezone.utc))
    return energy


async def test_config_merges_validation_problems_into_each_item():
    result = await make(FakeWS()).get_config()
    assert result["configured"] is True
    assert result["device_consumption"][0]["problems"] == []
    gone = result["device_consumption"][1]
    assert gone["name"] == "Gone" and gone["problems"][0]["type"] == "entity_not_defined"
    assert "does not exist" in gone["problems"][0]["hint"]
    assert result["energy_sources"][1]["type"] == "solar"
    assert result["solar_forecast_domains"] == ["forecast_solar"]
    assert result["problem_count"] == 1


async def test_unconfigured_energy_reads_as_empty():
    result = await make(FakeWS(prefs=None)).get_config()
    assert result["configured"] is False and result["device_consumption"] == []


async def test_find_sensors_lists_candidates_and_marks_what_is_used():
    result = await make(FakeWS()).find_sensors()
    energy = {item["entity_id"]: item for item in result["energy"]}
    assert energy["sensor.plug_energy"]["in_energy_dashboard"] is False
    assert energy["sensor.hms_energy"]["in_energy_dashboard"] == "energy_sources"
    assert energy["sensor.plug_energy"]["has_statistics"] is True
    assert [item["entity_id"] for item in result["power"]] == ["sensor.plug_power"]
    assert "light.x" not in str(result)


async def test_usage_sums_the_change_per_configured_statistic():
    stats = {"sensor.rack_energy": [{"change": 1.5}, {"change": 2.0}],
             "sensor.hms_energy": [{"change": 3.25}], "sensor.grid_in": [{"change": 4.0}]}
    ws = FakeWS(stats=stats)
    result = await make(ws).usage("today")
    kind, payload = next(c for c in ws.calls if c[0] == "recorder/statistics_during_period")
    assert payload["types"] == ["change"] and payload["period"] == "hour"
    assert payload["start_time"].startswith("2026-10-24T22:00:00") or payload["start_time"].startswith("2026-10-25T")
    devices = {item["name"]: item["kwh"] for item in result["devices"]}
    assert devices["Rack"] == 3.5 and devices["Gone"] == 0
    assert result["sources"]["solar"] == 3.25 and result["sources"]["grid_import"] == 4.0
    with pytest.raises(ValueError):
        await make(ws).usage("forever")


async def test_save_needs_admin_and_known_statistics():
    ws = FakeWS()
    with pytest.raises(ValueError, match="admin write"):
        await make(ws, admin=False).save(device_consumption=[])
    with pytest.raises(ValueError, match="sensor.nope_energy"):
        await make(ws).save(device_consumption=[{"stat_consumption": "sensor.nope_energy"}])
    # a vanished sensor that is already stored does not block
    await make(ws).save(device_consumption=PREFS["device_consumption"])
    assert sum(kind == "energy/save_prefs" for kind, _ in ws.calls) == 1
    ws.calls.clear()
    assert not any(kind == "energy/save_prefs" for kind, _ in ws.calls)


async def test_save_sends_only_the_given_parts_and_reports_new_problems():
    ws = FakeWS()
    sources = [{"type": "solar", "stat_energy_from": "sensor.hms_energy"}]
    result = await make(ws).save(energy_sources=sources)
    kind, payload = next(c for c in ws.calls if c[0] == "energy/save_prefs")
    assert payload == {"energy_sources": sources}
    assert "problem_count" in result and result["saved"] is True


async def test_add_device_appends_and_refuses_duplicates():
    ws = FakeWS()
    energy = make(ws)
    await energy.add_device("sensor.plug_energy", name="Plug")
    saved = ws.prefs["device_consumption"]
    assert saved[-1] == {"stat_consumption": "sensor.plug_energy", "name": "Plug"} and len(saved) == 3
    with pytest.raises(ValueError, match="already"):
        await energy.add_device("sensor.plug_energy")


async def test_remove_device_needs_the_delete_level():
    ws = FakeWS()
    with pytest.raises(ValueError, match="delete"):
        await make(ws).remove_device("sensor.gone_energy")
    await make(ws, delete=True).remove_device("sensor.gone_energy")
    assert [d["stat_consumption"] for d in ws.prefs["device_consumption"]] == ["sensor.rack_energy"]
    with pytest.raises(ValueError, match="not in"):
        await make(ws, delete=True).remove_device("sensor.gone_energy")


async def test_unknown_source_types_and_fields_are_refused():
    with pytest.raises(ValueError, match="type"):
        await make(FakeWS()).save(energy_sources=[{"type": "nuclear", "stat_energy_from": "sensor.grid_in"}])
    with pytest.raises(ValueError):
        await make(FakeWS()).save(device_consumption=[{"stat_consumption": "sensor.rack_energy", "evil": 1}])


async def test_energy_changes_are_journaled_and_undone(tmp_path):
    from ha_safe_mcp.changes import ChangeJournal, Changes
    ws = FakeWS()
    energy = make(ws, delete=True)
    changes = Changes(ChangeJournal(tmp_path), admin=None, scenes=None, registry=None, integrations=None,
                      energy=energy)
    _, change_id = await changes.apply("ha_add_energy_device", "energy", "prefs",
                                       lambda: energy.add_device("sensor.plug_energy", name="Plug"))
    assert len(ws.prefs["device_consumption"]) == 3
    entry = changes.journal.get(change_id)
    assert len(entry["before"]["device_consumption"]) == 2
    undone = await changes.undo(change_id)
    # the vanished sensor.gone_energy of the old settings does not block the undo
    assert [d["stat_consumption"] for d in ws.prefs["device_consumption"]] == ["sensor.rack_energy",
                                                                               "sensor.gone_energy"]
    await changes.undo(undone["change_id"])  # redo
    assert ws.prefs["device_consumption"][-1]["stat_consumption"] == "sensor.plug_energy"


def test_energy_tools_have_the_right_levels():
    from ha_safe_mcp.ollama_client import write_level
    assert write_level("ha_get_energy_usage") is None
    assert write_level("ha_add_energy_device") == "admin"
    assert write_level("ha_remove_energy_device") == "delete"


async def test_usage_of_sensors_outside_the_dashboard_and_hint_when_empty():
    ws = FakeWS(prefs=None, stats={"sensor.plug_energy": [{"change": 0.75}]})
    empty = await make(ws).usage("7d")
    assert "Do not change the energy settings" in empty["hint"] and "all energy sensors" in empty["hint"]
    assert {"name": "Plug Energie", "statistic": "sensor.plug_energy", "kwh": 0.75} in empty["devices"]
    result = await make(ws).usage("7d", ["sensor.plug_energy"])
    assert result["devices"] == [{"name": "sensor.plug_energy", "statistic": "sensor.plug_energy", "kwh": 0.75}]
    assert result["hint"] == ""
    with pytest.raises(ValueError, match="statistic_ids"):
        await make(ws).usage("7d", ["not an id"])
