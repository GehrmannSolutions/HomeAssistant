import pytest
"""Domain overview for the UI pickers: which domains the connected HA really has, with counts and risk notes."""
from ha_safe_mcp.chat_runs import RunManager
from ha_safe_mcp.config_store import SettingsStore
from ha_safe_mcp.domains import DOMAIN_INFO, summarize
from ha_safe_mcp.web import create_app
from test_remote import http, running
from test_web import FakeChecks, configure

# these tests check the German messages (the UI language German); English is covered in test_i18n.py
pytestmark = pytest.mark.usefixtures("german")

STATES = [{"entity_id": e} for e in ("light.a", "light.b", "lock.door", "sensor.t", "sensor.h", "sensor.x",
                                     "switch.plug", "foo_bar.thing")]
SERVICES = [{"domain": d} for d in ("light", "lock", "switch", "foo_bar", "homeassistant")]


def test_summary_counts_marks_actions_risks_and_allowed():
    items = {i["domain"]: i for i in summarize(STATES, SERVICES, ["light", "climate"])}
    assert items["light"] == {"domain": "light", "label": "Licht", "count": 2, "actions": True, "risk": None,
                              "allowed": True}
    assert items["lock"]["risk"] and items["lock"]["allowed"] is False
    assert items["sensor"]["actions"] is False and items["sensor"]["count"] == 3
    assert items["foo_bar"]["label"] == "foo_bar"  # unknown domains still appear, with their raw name
    assert items["climate"]["count"] == 0 and items["climate"]["allowed"] is True  # allowed but not present
    assert "homeassistant" not in items  # services without entities are not targets of ha_call_service
    order = [i["domain"] for i in summarize(STATES, SERVICES, [])]
    assert order.index("light") < order.index("sensor")  # domains with actions first


def test_well_known_risky_domains_carry_a_note():
    for domain in ("lock", "alarm_control_panel", "cover", "update", "button", "valve", "siren"):
        assert DOMAIN_INFO[domain]["en"][1] and DOMAIN_INFO[domain]["de"][1], domain


async def test_domains_endpoint_reads_the_connected_ha(tmp_path):
    async def source(settings):
        return STATES, SERVICES

    async def runner(*args, **kwargs):
        return "ok"
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(runner),
                     domain_source=source)
    async with running(app), http(app) as h:
        before = await h.get("/api/domains")
        await configure(h)
        data = (await h.get("/api/domains")).json()
    assert before.status_code == 409
    assert data["allowed"] == ["light", "switch", "fan", "climate", "cover", "media_player"]
    assert {i["domain"] for i in data["domains"]} >= {"light", "lock", "sensor"}


async def test_domains_endpoint_reports_an_unreachable_ha(tmp_path):
    async def source(settings):
        raise RuntimeError("Home Assistant returned HTTP 401")

    async def runner(*args, **kwargs):
        return "ok"
    app = create_app(SettingsStore(tmp_path / ".env"), checks=FakeChecks(), runs=RunManager(runner),
                     domain_source=source)
    async with running(app), http(app) as h:
        await configure(h)
        response = await h.get("/api/domains")
    assert response.status_code == 502 and "401" in response.json()["error"]
