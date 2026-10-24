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
                        "source": "user", "disabled_by": None, "reason": None, "supports_options": True,
                        "supports_reconfigure": None, "pref_disable_polling": False,
                        "pref_disable_new_entities": None}]


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
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.50"})
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



class EntryWS(FakeWS):
    """config_entries/update|disable with a tiny in-memory entry."""

    def __init__(self):
        super().__init__()
        self.entry = {"entry_id": ENTRY, "domain": "shelly", "title": "Plug", "state": "loaded",
                      "disabled_by": None, "pref_disable_polling": False, "pref_disable_new_entities": False}

    async def command(self, kind, payload=None):
        self.calls.append((kind, payload or {}))
        if kind == "config_entries/update":
            self.entry.update({k: v for k, v in payload.items() if k != "entry_id"})
            return {"config_entry": dict(self.entry), "require_restart": False}
        if kind == "config_entries/disable":
            self.entry["disabled_by"] = payload["disabled_by"]
            self.entry["state"] = "not_loaded" if payload["disabled_by"] else "loaded"
            return {"require_restart": False}
        if kind == "config_entries/get_single":
            return {"config_entry": dict(self.entry)}
        return await super().command(kind, payload)


@pytest.mark.asyncio
async def test_options_flow_starts_with_the_entry_id_as_handler_and_needs_admin(tmp_path):
    form = {"type": "form", "flow_id": FLOW, "handler": ENTRY, "step_id": "init",
            "data_schema": [{"name": "scan_interval", "type": "integer", "default": 30}], "errors": {}}
    with respx.mock(base_url=URL) as router:
        route = router.post("/api/config/config_entries/options/flow").mock(return_value=httpx.Response(200, json=form))
        with pytest.raises(ValueError, match="admin"):
            await make(tmp_path, admin=False).start_options(ENTRY)
        result = await make(tmp_path).start_options(ENTRY)
    assert json.loads(route.calls[0].request.content) == {"handler": ENTRY, "show_advanced_options": False}
    assert result["data_schema"][0]["default"] == 30 and result["kind"] == "options"


@pytest.mark.asyncio
async def test_options_steps_and_abort_use_the_options_routes_with_credential_refs(tmp_path):
    done = {"type": "create_entry", "flow_id": FLOW, "handler": ENTRY, "title": "", "result": True,
            "description_placeholders": {"x": SECRET}}
    with respx.mock(base_url=URL) as router:
        step = router.post(f"/api/config/config_entries/options/flow/{FLOW}").mock(return_value=httpx.Response(200, json=done))
        abort = router.delete(f"/api/config/config_entries/options/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json={"message": "Flow aborted"}))
        integrations = make(tmp_path)
        result = await integrations.options_step(FLOW, {"scan_interval": 60,
                                                        "password": {"$credential": "shelly_login", "field": "password"}})
        await integrations.abort_options(FLOW)
    assert json.loads(step.calls[0].request.content) == {"scan_interval": 60, "password": SECRET}
    assert SECRET not in json.dumps(result) and result["type"] == "create_entry"
    assert abort.called


@pytest.mark.asyncio
async def test_reconfigure_starts_a_config_flow_for_the_entry(tmp_path):
    form = {"type": "form", "flow_id": FLOW, "handler": "shelly", "step_id": "reconfigure",
            "data_schema": [{"name": "host", "type": "string", "default": "192.0.2.10"}], "errors": {}}
    with respx.mock(base_url=URL) as router:
        router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=[
            {"entry_id": ENTRY, "domain": "shelly", "supports_reconfigure": True}]))
        route = router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).start_reconfigure(ENTRY)
    assert json.loads(route.calls[0].request.content) == {"handler": "shelly", "entry_id": ENTRY,
                                                          "show_advanced_options": False}
    assert result["step_id"] == "reconfigure" and "default" in result["hint"]


@pytest.mark.asyncio
async def test_reconfigure_is_refused_when_the_integration_does_not_support_it(tmp_path):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=[
            {"entry_id": ENTRY, "domain": "sun", "supports_reconfigure": False}]))
        post = router.post("/api/config/config_entries/flow")
        with pytest.raises(ValueError, match="reconfigure"):
            await make(tmp_path).start_reconfigure(ENTRY)
        with pytest.raises(ValueError, match="unknown entry_id"):
            await make(tmp_path).start_reconfigure("01M5NHB2W16NRS2JGCSBJVTCY0")
    assert not post.called


@pytest.mark.asyncio
async def test_entry_settings_rename_polling_and_disable_are_gated_and_read_back(tmp_path):
    ws = EntryWS()
    with pytest.raises(ValueError, match="admin"):
        await make(tmp_path, admin=False, ws=ws).update_entry(ENTRY, {"title": "x"})
    integrations = make(tmp_path, ws=ws)
    updated = await integrations.update_entry(ENTRY, {"title": "Steckdose Flur", "pref_disable_polling": True})
    assert updated["title"] == "Steckdose Flur" and updated["pref_disable_polling"] is True
    with pytest.raises(ValueError, match="fields"):
        await integrations.update_entry(ENTRY, {"data": {"host": "x"}})
    with pytest.raises(ValueError):
        await integrations.update_entry(ENTRY, {"title": ""})
    disabled = await integrations.set_entry_disabled(ENTRY, True)
    assert disabled["disabled_by"] == "user" and ("config_entries/disable", {"entry_id": ENTRY, "disabled_by": "user"}) in ws.calls
    enabled = await integrations.set_entry_disabled(ENTRY, False)
    assert enabled["disabled_by"] is None


def test_option_and_settings_tools_are_registered():
    import asyncio
    from ha_safe_mcp.server import create_server
    names = {tool.name for tool in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_start_integration_options", "ha_integration_options_step", "ha_abort_integration_options",
            "ha_start_integration_reconfigure", "ha_update_integration", "ha_set_integration_disabled"} <= names


@pytest.mark.asyncio
async def test_options_forms_show_the_current_value_and_never_leak_current_secrets(tmp_path):
    """HA puts the current option value in description.suggested_value; default is only the factory value."""
    form = {"type": "form", "flow_id": FLOW, "handler": ENTRY, "step_id": "init", "errors": {}, "data_schema": [
        {"name": "workdays", "default": ["mon", "tue", "wed", "thu", "fri"],
         "description": {"suggested_value": ["mon", "tue", "wed", "thu"]}},
        {"name": "password", "description": {"suggested_value": SECRET}, "default": SECRET},
        {"name": "api_key", "description": {"suggested_value": SECRET, "note": "kept"}}]}
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/options/flow").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).start_options(ENTRY)
    fields = {field["name"]: field for field in result["data_schema"]}
    assert fields["workdays"]["current"] == ["mon", "tue", "wed", "thu"]
    assert SECRET not in json.dumps(result)
    assert fields["password"].get("current") is None and fields["api_key"]["description"] == {"note": "kept"}
    assert "current" in result.get("hint", "") and "kept" in result["hint"]



@pytest.mark.asyncio
async def test_options_steps_keep_current_values_the_model_did_not_send(tmp_path):
    """Real HA 2026.10: a partial options submit resets omitted fields to factory defaults (days_offset 1 -> 0).
    The HA frontend avoids that by pre-filling suggested values; the MCP does the same per flow."""
    form = {"type": "form", "flow_id": FLOW, "handler": ENTRY, "step_id": "init", "errors": {}, "data_schema": [
        {"name": "workdays", "default": ["mon"], "description": {"suggested_value": ["mon", "tue"]}},
        {"name": "days_offset", "default": 0, "description": {"suggested_value": 1}},
        {"name": "password", "description": {"suggested_value": SECRET}}]}
    done = {"type": "create_entry", "flow_id": FLOW, "handler": ENTRY, "result": True}
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/options/flow").mock(return_value=httpx.Response(200, json=form))
        step = router.post(f"/api/config/config_entries/options/flow/{FLOW}").mock(return_value=httpx.Response(200, json=done))
        integrations = make(tmp_path)
        await integrations.start_options(ENTRY)
        result = await integrations.options_step(FLOW, {"workdays": ["mon", "tue", "wed"]})
    assert json.loads(step.calls[0].request.content) == {"workdays": ["mon", "tue", "wed"], "days_offset": 1}
    assert result["kept_current"] == ["days_offset"]
    assert SECRET not in json.dumps(result)


@pytest.mark.asyncio
async def test_kept_values_are_forgotten_after_the_flow_ends(tmp_path):
    form = {"type": "form", "flow_id": FLOW, "handler": ENTRY, "step_id": "init", "errors": {}, "data_schema": [
        {"name": "days_offset", "description": {"suggested_value": 1}}]}
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/options/flow").mock(return_value=httpx.Response(200, json=form))
        router.delete(f"/api/config/config_entries/options/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json={"message": "Flow aborted"}))
        integrations = make(tmp_path)
        await integrations.start_options(ENTRY)
        await integrations.abort_options(FLOW)
    assert integrations._current == {}
