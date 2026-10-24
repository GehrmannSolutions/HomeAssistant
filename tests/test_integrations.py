"""Integration setup through HA's config-flow API: gated writes, credential references, no secret echoes."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.credentials import CredentialStore
from ha_safe_mcp.integrations import HAIntegrations
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"
SECRET = "Sh3lly-Wert-9z!"
FLOW = "0123456789abcdef0123456789abcdef"
ENTRY = "01M5NHB2W16NRS2JGCSBJVTCY9"


class FakeWS:
    def __init__(self, progress=None):
        self.calls = []
        self.progress = progress or []

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "config_entries/flow/progress":
            return self.progress
        raise AssertionError(f"unexpected ws command {kind}")


def make(tmp_path, *, write=True, admin=True, delete=False, ws=None):
    store = CredentialStore(tmp_path / "creds")
    store.save("shelly_login", "Shelly", {"username": "admin", "password": SECRET})
    client = HAClient(URL, "token", allow_write=write)
    return HAIntegrations(client, ws or FakeWS(), allow_admin_write=admin, allow_delete=delete, credentials=store)


@pytest.mark.asyncio
async def test_entries_are_listed_with_a_small_stable_field_set(tmp_path):
    with respx.mock(base_url=URL) as router:
        route = router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=[
            {"entry_id": ENTRY, "domain": "shelly", "title": "Plug", "state": "loaded", "source": "user",
             "disabled_by": None, "reason": None, "supports_options": True, "pref_disable_polling": False}]))
        entries = await make(tmp_path).list_entries("shelly")
    assert route.calls[0].request.url.params["domain"] == "shelly"
    assert entries == [{"entry_id": ENTRY, "domain": "shelly", "title": "Plug", "state": "loaded",
                        "source": "user", "disabled_by": None, "reason": None}]


@pytest.mark.asyncio
async def test_handlers_are_filtered_and_bounded(tmp_path):
    with respx.mock(base_url=URL) as router:
        router.get("/api/config/config_entries/flow_handlers").mock(
            return_value=httpx.Response(200, json=["hue", "shelly", "shelly_pro", "met"] + [f"x{i}" for i in range(200)]))
        integrations = make(tmp_path)
        assert await integrations.list_handlers("shel") == ["shelly", "shelly_pro"]
        assert len(await integrations.list_handlers("")) == 100


@pytest.mark.asyncio
async def test_discovered_flows_are_read_over_websocket_and_reduced(tmp_path):
    ws = FakeWS([{"flow_id": FLOW, "handler": "shelly", "step_id": "confirm_discovery",
                  "context": {"source": "zeroconf", "unique_id": "shellyplug-ABC", "title_placeholders": {"name": "Plug S"}}}])
    flows = await make(tmp_path, ws=ws).discovered_flows()
    assert flows == [{"flow_id": FLOW, "handler": "shelly", "step_id": "confirm_discovery",
                      "source": "zeroconf", "name": "Plug S"}]


@pytest.mark.asyncio
async def test_starting_a_flow_needs_admin_write_and_returns_the_form(tmp_path):
    form = {"type": "form", "flow_id": FLOW, "handler": "shelly", "step_id": "user", "errors": {},
            "data_schema": [{"name": "host", "type": "string", "required": True}], "description_placeholders": None,
            "last_step": None}
    with respx.mock(base_url=URL) as router:
        route = router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json=form))
        with pytest.raises(ValueError, match="admin"):
            await make(tmp_path, admin=False).start_flow("shelly")
        result = await make(tmp_path).start_flow("shelly")
    assert json.loads(route.calls[0].request.content) == {"handler": "shelly", "show_advanced_options": False}
    assert result["step_id"] == "user" and result["data_schema"][0]["name"] == "host"


@pytest.mark.asyncio
async def test_flow_step_resolves_credential_refs_and_never_echoes_the_secret(tmp_path):
    echoed = {"type": "form", "flow_id": FLOW, "handler": "shelly", "step_id": "credentials",
              "errors": {"base": "invalid_auth"}, "description_placeholders": {"hint": f"tried {SECRET}"},
              "data_schema": [{"name": "password", "type": "string", "required": True, "default": SECRET}]}
    with respx.mock(base_url=URL) as router:
        route = router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=echoed))
        result = await make(tmp_path).flow_step(FLOW, {"password": {"$credential": "shelly_login", "field": "password"}})
    assert json.loads(route.calls[0].request.content) == {"password": SECRET}
    assert SECRET not in json.dumps(result)
    assert result["errors"] == {"base": "invalid_auth"}
    assert "default" not in result["data_schema"][0]


@pytest.mark.parametrize("data", [{"password": "klartext"}, {"api_key": "abc"}, {"token": "x"}, {"pin": "1234"}])
@pytest.mark.asyncio
async def test_secret_fields_must_be_credential_references(tmp_path, data):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        route = router.post(f"/api/config/config_entries/flow/{FLOW}")
        with pytest.raises(ValueError, match="credential"):
            await make(tmp_path).flow_step(FLOW, data)
    assert not route.called


@pytest.mark.asyncio
async def test_create_entry_result_is_reduced_to_the_new_entry(tmp_path):
    created = {"type": "create_entry", "flow_id": FLOW, "handler": "shelly", "title": "Plug S", "version": 1,
               "result": {"entry_id": ENTRY, "domain": "shelly", "title": "Plug S", "state": "loaded", "source": "user"}}
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=created))
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.168.1.50"})
    assert result == {"type": "create_entry", "flow_id": FLOW, "handler": "shelly", "title": "Plug S",
                      "entry": {"entry_id": ENTRY, "domain": "shelly", "title": "Plug S", "state": "loaded", "source": "user"}}


@pytest.mark.parametrize("bad", ["../entry", "x" * 33, "ABCDEF0123456789ABCDEF0123456789", "", "0123456789abcdef0123456789abcde/",
                                 "01m5phzkt2w8gxj0e0rxncaenq", "01M5PHZKT2W8GXJ0E0RXNCAEN"])
@pytest.mark.asyncio
async def test_malformed_flow_ids_are_rejected_before_any_request(tmp_path, bad):
    with respx.mock(base_url=URL, assert_all_called=False):
        with pytest.raises(ValueError):
            await make(tmp_path).flow_step(bad, {"host": "x"})
        with pytest.raises(ValueError):
            await make(tmp_path).abort_flow(bad)


@pytest.mark.asyncio
async def test_ulid_flow_ids_from_current_home_assistant_are_accepted(tmp_path):
    """HA 2026.x issues flow IDs as ULIDs (26 Crockford base32 chars), older releases as 32 hex chars."""
    ulid = "01M5PHZKT2W8GXJ0E0RXNCAENQ"
    with respx.mock(base_url=URL) as router:
        route = router.delete(f"/api/config/config_entries/flow/{ulid}").mock(
            return_value=httpx.Response(200, json={"message": "Flow aborted"}))
        assert await make(tmp_path).abort_flow(ulid) == {"aborted": True}
    assert route.called


@pytest.mark.parametrize("bad", ["../../api/states", "abc", "01M5NHB2W16NRS2JGCSBJVTCY9/reload", "a b"])
@pytest.mark.asyncio
async def test_malformed_entry_ids_are_rejected(tmp_path, bad):
    with respx.mock(base_url=URL, assert_all_called=False):
        with pytest.raises(ValueError):
            await make(tmp_path, delete=True).delete_entry(bad)
        with pytest.raises(ValueError):
            await make(tmp_path).reload_entry(bad)


@pytest.mark.asyncio
async def test_abort_reload_and_delete_use_the_documented_routes_and_gates(tmp_path):
    with respx.mock(base_url=URL) as router:
        abort = router.delete(f"/api/config/config_entries/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json={"message": "Flow aborted"}))
        reload = router.post(f"/api/config/config_entries/entry/{ENTRY}/reload").mock(
            return_value=httpx.Response(200, json={"require_restart": False}))
        delete = router.delete(f"/api/config/config_entries/entry/{ENTRY}").mock(
            return_value=httpx.Response(200, json={"require_restart": False}))
        integrations = make(tmp_path)
        assert await integrations.abort_flow(FLOW) == {"aborted": True}
        assert await integrations.reload_entry(ENTRY) == {"require_restart": False}
        with pytest.raises(ValueError, match="delete"):
            await integrations.delete_entry(ENTRY)
        assert await make(tmp_path, delete=True).delete_entry(ENTRY) == {"require_restart": False}
    assert abort.called and reload.called and delete.call_count == 1


@pytest.mark.asyncio
async def test_writes_need_the_base_write_switch_too(tmp_path):
    with pytest.raises(ValueError, match="admin"):
        await make(tmp_path, write=False).start_flow("shelly")


@pytest.mark.asyncio
async def test_credential_aliases_are_listed_without_values(tmp_path):
    aliases = make(tmp_path).credential_aliases()
    assert aliases == [{"alias": "shelly_login", "label": "Shelly", "fields": ["password", "username"]}]
    assert SECRET not in json.dumps(aliases)


@pytest.mark.asyncio
async def test_unknown_credential_alias_is_a_clear_error_without_request(tmp_path):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        route = router.post(f"/api/config/config_entries/flow/{FLOW}")
        with pytest.raises(ValueError, match="nope.password"):
            await make(tmp_path).flow_step(FLOW, {"password": {"$credential": "nope", "field": "password"}})
    assert not route.called


@pytest.mark.asyncio
async def test_flow_steps_allow_slow_device_handshakes(tmp_path):
    """A real fritz step against an unreachable host took longer than the default 15 s request timeout."""
    seen = {}

    def capture(request):
        seen.update(request.extensions["timeout"])
        return httpx.Response(200, json={"type": "form", "flow_id": FLOW, "handler": "fritz", "step_id": "user",
                                         "errors": {"base": "cannot_connect"}, "data_schema": []})

    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(side_effect=capture)
        await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.1"})
    assert seen["read"] >= 60


@pytest.mark.asyncio
async def test_harmless_defaults_stay_visible_so_the_model_does_not_invent_ports(tmp_path):
    """The 7B model guessed port 8080 because every default had been stripped; only secret defaults must go."""
    form = {"type": "form", "flow_id": FLOW, "handler": "shelly", "step_id": "user_manual", "errors": {},
            "data_schema": [{"name": "host", "type": "string", "required": True},
                            {"name": "port", "type": "integer", "default": 80},
                            {"name": "password", "type": "string", "default": SECRET}]}
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).start_flow("shelly")
    fields = {field["name"]: field for field in result["data_schema"]}
    assert fields["port"]["default"] == 80
    assert "default" not in fields["password"]
