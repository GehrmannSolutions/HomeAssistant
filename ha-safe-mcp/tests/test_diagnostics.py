"""Debugging tools: traces, error log, logbook, history, statistics, repairs, system health, templates, conditions."""
import json
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from ha_safe_mcp.diagnostics import HADiagnostics
from ha_safe_mcp.management import READ_TYPES

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
TRACE = {"domain": "automation", "item_id": "1700000000001", "run_id": "abc123", "state": "stopped",
         "script_execution": "error", "timestamp": {"start": "2026-10-25T06:00:00+00:00", "finish": "2026-10-25T06:00:01+00:00"},
         "last_step": "action/0", "error": "Entity not found", "trigger": "time pattern", "context": {"id": "x"}}


class FakeWS:
    def __init__(self):
        self.calls = []

    async def command(self, kind, payload=None, *, collect_events=None):
        payload = dict(payload or {})
        self.calls.append((kind, payload))
        if kind == "trace/list":
            older = {**TRACE, "run_id": "old", "timestamp": {"start": "2026-10-24T06:00:00+00:00"}}
            return [older, TRACE]
        if kind == "trace/get":
            return {**TRACE, "config": {"alias": "Morgens", "actions": [{"action": "light.turn_on"}]},
                    "trace": {"trigger/0": [{"path": "trigger/0", "timestamp": "t", "changed_variables": {
                        "trigger": {"platform": "time_pattern", "description": "time pattern"}}}],
                        "action/0": [{"path": "action/0", "timestamp": "t", "error": "Entity not found",
                                      "result": {"params": {"domain": "light", "service": "turn_on"}}}]}}
        if kind == "system_log/list":
            return [{"name": "homeassistant.components.unifi", "message": ["Setup failed", "retrying"],
                     "level": "ERROR", "source": ["components/unifi/hub.py", 120], "timestamp": 1761370000.0,
                     "exception": "Traceback ...\n" + "x" * 5000, "count": 7, "first_occurred": 1761300000.0},
                    {"name": "homeassistant.helpers.template", "message": ["Template warning"], "level": "WARNING",
                     "source": ["helpers/template.py", 1], "timestamp": 1761380000.0, "exception": "",
                     "count": 1, "first_occurred": 1761380000.0}]
        if kind == "recorder/statistics_during_period":
            return {"sensor.energy": [{"start": int(NOW.timestamp() * 1000) - (30 - i) * 3600000, "sum": i * 0.5}
                                      for i in range(30)]}
        if kind == "recorder/list_statistic_ids":
            return [{"statistic_id": "sensor.energy", "display_unit_of_measurement": "kWh", "has_sum": True,
                     "has_mean": False, "name": "Energie", "source": "recorder"},
                    {"statistic_id": "sensor.temp", "display_unit_of_measurement": "°C", "has_sum": False,
                     "has_mean": True, "name": "Temperatur", "source": "recorder"}]
        if kind == "repairs/list_issues":
            return {"issues": [{"domain": "unifi", "issue_id": "setup_failed", "severity": "error",
                                "translation_key": "setup_failed", "is_fixable": False, "ignored": False,
                                "created": "2026-10-20T10:00:00+00:00", "learn_more_url": None,
                                "breaks_in_ha_version": None, "translation_placeholders": {"host": "192.0.2.1"}},
                               {"domain": "hacs", "issue_id": "old", "severity": "warning", "ignored": True}]}
        if kind == "system_health/info":
            events = [{"type": "initial", "data": {"homeassistant": {"info": {"version": "2026.10.2",
                                                                              "installation_type": "Home Assistant OS"}},
                                                   "cloud": {"info": {"can_reach_cloud": {"type": "pending"}}}}},
                      {"type": "update", "domain": "cloud", "key": "can_reach_cloud", "success": True, "data": True},
                      {"type": "finish"}]
            for event in events:
                if collect_events(event):
                    break
            return {"result": None, "events": events}
        if kind == "test_condition":
            return {"result": True}
        raise AssertionError(kind)


class FakeClient:
    def __init__(self):
        self.calls = []

    async def _request(self, method, path, *, data=None, timeout=15, as_text=False):
        self.calls.append((method, path, data, as_text))
        if path == "/api/config":
            return {"time_zone": "Europe/Berlin"}
        if path.startswith("/api/states/automation."):
            return {"entity_id": "automation.morgens", "attributes": {"id": "1700000000001"}}
        if path.startswith("/api/logbook/"):
            return [{"when": f"2026-10-25T0{i}:00:00+00:00", "name": "Flur", "entity_id": "light.flur",
                     "state": "on" if i % 2 else "off", "context_user_id": "u" * 32} for i in range(8)]
        if path.startswith("/api/history/period/"):
            return [[{"entity_id": "sensor.t", "state": str(20 + i), "last_changed": f"2026-10-25T{i:02d}:00:00+00:00"}
                     for i in range(24)]]
        if path == "/api/template":
            return "21.5 °C"
        raise AssertionError(path)


def make():
    return HADiagnostics(FakeClient(), FakeWS(), now=lambda: NOW)


def query(path):
    return {k: v[0] for k, v in parse_qs(urlsplit(path).query, keep_blank_values=True).items()}


def test_new_websocket_types_are_read_only():
    assert {"trace/list", "trace/get", "system_log/list", "recorder/statistics_during_period",
            "recorder/list_statistic_ids", "repairs/list_issues", "system_health/info", "test_condition"} <= READ_TYPES


async def test_traces_are_listed_newest_first_and_accept_an_entity_id():
    d = make()
    runs = await d.list_traces("automation", "automation.morgens")
    assert [r["run_id"] for r in runs] == ["abc123", "old"] and "context" not in runs[0]
    assert d.ws.calls[-1] == ("trace/list", {"domain": "automation", "item_id": "1700000000001"})
    with pytest.raises(ValueError):
        await d.list_traces("light")


def test_trace_outcomes_are_explained_in_plain_words():
    # HA marks every finished run as state "stopped"; small models read that as a failure
    from ha_safe_mcp.diagnostics import outcome
    assert outcome({"state": "stopped", "script_execution": "finished"}, "automation").startswith("completed")
    assert "condition" in outcome({"state": "stopped", "script_execution": "failed_conditions"}, "automation")
    assert "error" in outcome({"state": "stopped", "script_execution": "error"}, "script")
    assert outcome({"state": "running"}, "script") == "still running"
    assert "single" in outcome({"state": "stopped", "script_execution": "failed_single"}, "script")


async def test_listed_runs_carry_the_outcome_and_a_manual_trigger_hint():
    d = make()
    runs = await d.list_traces("automation", "automation.morgens")
    assert all("outcome" in r for r in runs)
    manual = {"state": "stopped", "script_execution": "finished", "trigger": None}
    from ha_safe_mcp.diagnostics import summarize_run
    assert "manually" in summarize_run(manual, "automation")["trigger"]


async def test_a_trace_is_condensed_to_the_steps_and_the_error():
    d = make()
    trace = await d.get_trace("automation", "1700000000001", "abc123")
    assert trace["error"] == "Entity not found" and "config" not in trace
    assert [s["path"] for s in trace["steps"]] == ["trigger/0", "action/0"]
    assert trace["steps"][1]["error"] == "Entity not found"
    with_config = await d.get_trace("automation", "1700000000001", "abc123", include_config=True)
    assert with_config["config"]["alias"] == "Morgens"
    with pytest.raises(ValueError):
        await d.get_trace("automation", "1700000000001", "../x")


async def test_error_log_is_filtered_sorted_and_truncated():
    d = make()
    entries = await d.error_log()
    assert [e["level"] for e in entries] == ["WARNING", "ERROR"]  # newest first
    assert entries[1]["message"] == "Setup failed | retrying" and len(entries[1]["exception"]) <= 2100
    assert entries[1]["count"] == 7 and entries[1]["timestamp"].endswith(("+01:00", "+02:00"))
    errors = await d.error_log(level="error", query="unifi")
    assert len(errors) == 1 and errors[0]["name"] == "homeassistant.components.unifi"


async def test_logbook_uses_the_time_window_and_drops_user_ids():
    d = make()
    entries = await d.logbook(entity_id="light.flur", hours=6, limit=5)
    path = next(call[1] for call in d.client.calls if call[1].startswith("/api/logbook/"))
    assert path.startswith("/api/logbook/2026-10-25T06:00:00")
    assert query(path) == {"end_time": "2026-10-25T12:00:00+00:00", "entity": "light.flur"}
    assert len(entries) == 5 and "context_user_id" not in entries[0]
    assert entries[-1]["when"] == "2026-10-25T08:00:00+01:00"  # 07:00 UTC in the HA time zone (after DST end)


async def test_history_is_minimal_capped_and_needs_entities():
    d = make()
    result = await d.history(["sensor.t"], hours=24, max_points=10)
    path = next(call[1] for call in d.client.calls if call[1].startswith("/api/history/"))
    q = query(path)
    assert q["filter_entity_id"] == "sensor.t" and "minimal_response" in q and "no_attributes" in q
    series = result["sensor.t"]
    assert len(series["points"]) == 10 and series["total_points"] == 24 and series["points"][-1]["state"] == "43"
    assert series["points"][-1]["at"] == "2026-10-26T00:00:00+01:00"
    with pytest.raises(ValueError):
        await d.history([], hours=1)
    with pytest.raises(ValueError):
        await d.history(["sensor.t; drop"], hours=1)


async def test_statistics_and_their_ids():
    d = make()
    stats = await d.statistics(["sensor.energy"], hours=48, period="hour", max_points=12)
    kind, payload = d.ws.calls[-1]
    assert kind == "recorder/statistics_during_period" and payload["period"] == "hour"
    assert payload["start_time"] == "2026-10-23T12:00:00+00:00" and payload["statistic_ids"] == ["sensor.energy"]
    assert len(stats["sensor.energy"]["rows"]) == 12 and stats["sensor.energy"]["total_rows"] == 30
    assert stats["sensor.energy"]["rows"][0]["start"].startswith("2026-")
    with pytest.raises(ValueError):
        await d.statistics(["sensor.energy"], period="minute")
    ids = await d.list_statistic_ids("energ")
    assert ids == [{"statistic_id": "sensor.energy", "name": "Energie", "unit": "kWh", "has_sum": True,
                    "has_mean": False}]


async def test_repairs_hide_ignored_issues_and_placeholders():
    d = make()
    issues = await d.repairs()
    assert [i["domain"] for i in issues] == ["unifi"] and "translation_placeholders" not in issues[0]
    assert len(await d.repairs(include_ignored=True)) == 2


async def test_system_health_merges_pending_updates():
    d = make()
    health = await d.system_health()
    assert health["homeassistant"]["version"] == "2026.10.2"
    assert health["cloud"]["can_reach_cloud"] is True


async def test_templates_render_as_text_and_conditions_are_tested():
    d = make()
    assert await d.render_template("{{ states('sensor.t') }} °C") == {"result": "21.5 °C"}
    assert d.client.calls[-1] == ("POST", "/api/template", {"template": "{{ states('sensor.t') }} °C"}, True)
    assert await d.test_condition({"condition": "state", "entity_id": "light.flur", "state": "on"}) == {"result": True}
    with pytest.raises(ValueError):
        await d.render_template("")
    with pytest.raises(ValueError):
        await d.test_condition("state")


def test_debug_tools_are_registered_read_only_and_offered_in_the_chat():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS, select_tool_names
    from ha_safe_mcp.server import HAClient, create_server
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    debug = {"ha_list_traces", "ha_get_trace", "ha_get_error_log", "ha_get_logbook", "ha_get_history",
             "ha_get_statistics", "ha_list_statistic_ids", "ha_list_repairs", "ha_get_system_health",
             "ha_render_template", "ha_test_condition"}
    assert debug <= names and debug <= READ_TOOLS
    picked = select_tool_names("Warum hat die Automation heute morgen nicht ausgelöst?", names, allow_write=False)
    assert {"ha_list_traces", "ha_get_trace"} <= picked
    assert "ha_get_history" in select_tool_names("Zeig mir den Verlauf der Temperatur", names, allow_write=False)
    json.dumps({})


async def test_times_fall_back_to_utc_when_the_time_zone_is_unknown():
    d = make()

    async def no_config(method, path, **kwargs):
        if path == "/api/config":
            raise RuntimeError("Home Assistant returned HTTP 401")
        return await FakeClient._request(d.client, method, path, **kwargs)
    d.client._request = no_config
    entries = await d.logbook(hours=6, limit=1)
    assert entries[-1]["when"] == "2026-10-25T07:00:00+00:00"
