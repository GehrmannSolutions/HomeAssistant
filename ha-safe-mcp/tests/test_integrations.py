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
                      "source": "zeroconf", "name": "Plug S",
                      "next": "add it: ha_integration_setup_step(flow_id, data={})"}]


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


# ---------------------------------------------------------------- form sections (found 2026-10-28 with scrape)
SECTION_FORM = {"type": "form", "flow_id": FLOW, "handler": "scrape", "step_id": "user", "errors": {},
                "data_schema": [
                    {"name": "resource", "type": "string", "required": True},
                    {"name": "auth", "type": "expandable", "expanded": False, "schema": [
                        {"name": "username", "type": "string", "description": {"suggested_value": "admin"}},
                        {"name": "password", "type": "string", "default": SECRET,
                         "description": {"suggested_value": SECRET}}]},
                    {"name": "advanced", "type": "expandable", "schema": [
                        {"name": "timeout", "type": "integer", "description": {"suggested_value": 10}}]}]}


@pytest.mark.asyncio
async def test_section_named_auth_is_not_a_secret_but_its_leaf_fields_are_checked(tmp_path):
    with respx.mock(base_url=URL) as router:
        route = router.post(f"/api/config/config_entries/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json={"type": "abort", "flow_id": FLOW, "reason": "done"}))
        await make(tmp_path).flow_step(FLOW, {"resource": "http://192.0.2.9/", "auth": {}, "advanced": {"timeout": 10}})
        await make(tmp_path).flow_step(FLOW, {"auth": {"username": "admin", "password": {
            "$credential": "shelly_login", "field": "password"}}})
        with pytest.raises(ValueError, match="'auth.password' looks secret"):
            await make(tmp_path).flow_step(FLOW, {"auth": {"username": "admin", "password": "klartext"}})
    assert json.loads(route.calls[0].request.content)["auth"] == {}
    assert json.loads(route.calls[1].request.content)["auth"] == {"username": "admin", "password": SECRET}
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_secret_leaf_values_inside_sections_never_reach_the_model(tmp_path):
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json=SECTION_FORM))
        result = await make(tmp_path).start_flow("scrape")
    assert SECRET not in json.dumps(result)
    auth = next(field for field in result["data_schema"] if field["name"] == "auth")
    assert [f.get("current") for f in auth["schema"]] == ["admin", None]
    assert auth["current"] == {"username": "admin"}


@pytest.mark.asyncio
async def test_section_current_values_are_merged_field_by_field(tmp_path):
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/options/flow").mock(
            return_value=httpx.Response(200, json=SECTION_FORM))
        step = router.post(f"/api/config/config_entries/options/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json={"type": "create_entry", "flow_id": FLOW, "handler": ENTRY}))
        integrations = make(tmp_path)
        await integrations.start_options(ENTRY)
        result = await integrations.options_step(FLOW, {"advanced": {}})
    sent = json.loads(step.calls[0].request.content)
    assert sent["advanced"] == {"timeout": 10} and sent["auth"] == {"username": "admin"}
    assert "advanced.timeout" in result["kept_current"]


# ---------------------------------------------------------------- reachability test from the HA host
def probe_routes(router, outcome):
    start = router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json={
        "type": "form", "flow_id": FLOW, "handler": "generic", "step_id": "user", "data_schema": []}))
    step = router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=outcome))
    abort = router.delete(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json={}))
    return start, step, abort


@pytest.mark.parametrize("outcome, reachable, verdict", [
    ({"type": "form", "step_id": "user_confirm", "errors": None}, True, "image"),
    ({"type": "form", "step_id": "user", "errors": {"still_image_url": "invalid_still_image"}}, True, "not_an_image"),
    ({"type": "form", "step_id": "user", "errors": {"still_image_url": "unable_still_load_auth"}}, True, "auth_required"),
    ({"type": "form", "step_id": "user", "errors": {"still_image_url": "unable_still_load_not_found"}}, True, "not_found"),
    ({"type": "form", "step_id": "user", "errors": {"still_image_url": "unable_still_load_server_error"}}, True,
     "server_error"),
    ({"type": "form", "step_id": "user", "errors": {"still_image_url": "unable_still_load"}}, False, "unreachable"),
])
@pytest.mark.asyncio
async def test_url_probe_maps_results_and_always_aborts(tmp_path, outcome, reachable, verdict):
    ws = FakeWS()
    ws.command = _log_ws(ws, [])
    with respx.mock(base_url=URL) as router:
        start, step, abort = probe_routes(router, {"flow_id": FLOW, "handler": "generic", **outcome})
        result = await make(tmp_path, ws=ws).test_url("http://192.0.2.10:8080/status", verify_ssl=False)
    assert json.loads(start.calls[0].request.content)["handler"] == "generic"
    assert json.loads(step.calls[0].request.content) == {
        "still_image_url": "http://192.0.2.10:8080/status", "advanced": {"framerate": 2, "verify_ssl": False}}
    assert abort.called
    assert result["reachable"] is reachable and result["result"] == verdict
    assert result["url"] == "http://192.0.2.10:8080/status" and result["created"] is False


def _log_ws(ws, entries):
    async def command(kind, payload=None):
        ws.calls.append((kind, payload or {}))
        if kind == "system_log/list":
            return entries
        raise AssertionError(kind)
    return command


@pytest.mark.asyncio
async def test_url_probe_reads_the_exact_reason_from_the_log(tmp_path):
    ws = FakeWS()
    ws.command = _log_ws(ws, [{"name": "homeassistant.components.generic.config_flow", "timestamp": 1e10,
                               "message": ["Error getting camera image from http://192.0.2.10/: ConnectTimeout"]}])
    with respx.mock(base_url=URL) as router:
        probe_routes(router, {"type": "form", "flow_id": FLOW, "step_id": "user",
                              "errors": {"still_image_url": "unable_still_load"}})
        result = await make(tmp_path, ws=ws).test_url("http://192.0.2.10/")
    assert result["detail"] == "ConnectTimeout" and "timeout" in result["explanation"].lower()


@pytest.mark.parametrize("url", ["ftp://host/x", "192.0.2.1", "http://host/a?turn=on", "http://host/{{ x }}",
                                 "http://user:pw@host/", "http://host/" + "a" * 600])
@pytest.mark.asyncio
async def test_url_probe_rejects_unsafe_urls_before_touching_home_assistant(tmp_path, url):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        start = router.post("/api/config/config_entries/flow")
        with pytest.raises(ValueError):
            await make(tmp_path).test_url(url)
    assert not start.called


@pytest.mark.asyncio
async def test_url_probe_needs_admin_write_and_aborts_even_on_errors(tmp_path):
    with pytest.raises(ValueError, match="admin"):
        await make(tmp_path, admin=False).test_url("http://192.0.2.10/")
    with respx.mock(base_url=URL) as router:
        router.post("/api/config/config_entries/flow").mock(return_value=httpx.Response(200, json={
            "type": "form", "flow_id": FLOW, "handler": "generic", "step_id": "user"}))
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(500))
        abort = router.delete(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200))
        with pytest.raises(RuntimeError):
            await make(tmp_path).test_url("http://192.0.2.10/")
    assert abort.called


@pytest.mark.parametrize("logged, verdict, reachable, detail", [
    ("TimeoutError", "timeout", False, "TimeoutError"),
    ("HTTPStatusError <!DOCTYPE HTML><html>private page</html>", "http_error", True, "HTTPStatusError"),
])
@pytest.mark.asyncio
async def test_url_probe_detail_variants_and_no_response_body(tmp_path, logged, verdict, reachable, detail):
    ws = FakeWS()
    ws.command = _log_ws(ws, [{"name": "homeassistant.components.generic.config_flow", "timestamp": 1e10,
                               "message": [f"Error getting camera image from http://192.0.2.10/: {logged}"]}])
    with respx.mock(base_url=URL) as router:
        probe_routes(router, {"type": "form", "flow_id": FLOW, "step_id": "user",
                              "errors": {"still_image_url": "unable_still_load"}})
        result = await make(tmp_path, ws=ws).test_url("http://192.0.2.10/")
    assert (result["result"], result["reachable"], result["detail"]) == (verdict, reachable, detail)
    assert "private" not in json.dumps(result)


# --- 0.36.2: a discovered device with a login. Web chat with qwen3-coder:30b, 16.11. (Shelly 1PM Gen3 with a
# password): the model saw the password form, even listed the stored alias, and still asked the user for the
# password. The discovered flow itself showed only its step_id, not the form.

LOGIN_FORM = {"type": "form", "flow_id": FLOW, "handler": "shelly", "step_id": "credentials", "errors": {},
              "data_schema": [{"name": "password", "required": True,
                               "selector": {"text": {"type": "password", "autocomplete": "current-password"}}}],
              "description_placeholders": None, "last_step": None}
REF = {"$credential": "shelly_login", "field": "password"}


@pytest.mark.asyncio
async def test_a_login_form_brings_the_ready_credential_reference(tmp_path):
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=LOGIN_FORM))
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.50"})
    assert result["fill"] == {"password": REF}
    assert "fill" in result["hint"] and "never ask" in result["hint"].lower()
    assert SECRET not in json.dumps(result)


@pytest.mark.asyncio
async def test_the_login_named_after_the_integration_wins_over_other_logins(tmp_path):
    integrations = make(tmp_path)
    integrations.credentials.save("router", "Router", {"password": "r-1"})
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=LOGIN_FORM))
        result = await integrations.flow_step(FLOW, {"host": "192.0.2.50"})
    assert result["fill"] == {"password": REF}


@pytest.mark.asyncio
async def test_two_fitting_logins_are_offered_as_a_choice_without_guessing(tmp_path):
    integrations = make(tmp_path)
    integrations.credentials.save("shelly_keller", "Shelly Keller", {"password": "k-1"})
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=LOGIN_FORM))
        result = await integrations.flow_step(FLOW, {"host": "192.0.2.50"})
    assert "fill" not in result
    assert result["credential_choices"] == {"password": ["shelly_keller", "shelly_login"]}
    assert "ask the user" in result["hint"]


@pytest.mark.asyncio
async def test_a_login_form_without_any_stored_login_says_where_to_store_one(tmp_path):
    form = {**LOGIN_FORM, "handler": "fritz",
            "data_schema": [{"name": "api_key", "required": True, "selector": {"text": {"type": "password"}}}]}
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.1"})
    assert "fill" not in result and "credential_choices" not in result
    assert "Credentials" in result["hint"] and "api_key" in result["hint"]


@pytest.mark.asyncio
async def test_a_plain_form_gets_no_login_help(tmp_path):
    form = {**LOGIN_FORM, "step_id": "user", "data_schema": [{"name": "host", "required": True,
                                                                "selector": {"text": {}}}]}
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).flow_step(FLOW, {})
    assert "fill" not in result and "hint" not in result


@pytest.mark.asyncio
async def test_a_step_without_data_shows_the_current_form_of_a_discovered_device(tmp_path):
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        shown = router.get(f"/api/config/config_entries/flow/{FLOW}").mock(
            return_value=httpx.Response(200, json=LOGIN_FORM))
        sent = router.post(f"/api/config/config_entries/flow/{FLOW}")
        result = await make(tmp_path).flow_step(FLOW)
    assert shown.called and not sent.called
    assert result["step_id"] == "credentials" and result["fill"] == {"password": REF}


@pytest.mark.asyncio
async def test_an_empty_object_still_confirms_a_discovered_device(tmp_path):
    created = {"type": "create_entry", "flow_id": FLOW, "handler": "shelly", "title": "Plug S",
               "result": {"entry_id": ENTRY, "domain": "shelly", "title": "Plug S", "state": "loaded"}}
    with respx.mock(base_url=URL) as router:
        sent = router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=created))
        result = await make(tmp_path).flow_step(FLOW, {})
    assert json.loads(sent.calls[0].request.content) == {} and result["type"] == "create_entry"


@pytest.mark.asyncio
async def test_a_missing_password_error_names_the_reference_to_send(tmp_path):
    integrations = make(tmp_path)
    with respx.mock(base_url=URL) as router:
        router.get(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=LOGIN_FORM))
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(400, json={
            "message": "User input malformed: required key not provided @ data['password']"}))
        await integrations.flow_step(FLOW)
        with pytest.raises(RuntimeError) as failed:
            await integrations.flow_step(FLOW, {})
    text = str(failed.value)
    assert "required key not provided" in text and json.dumps(REF) in text and SECRET not in text


@pytest.mark.asyncio
async def test_discovered_devices_name_the_next_call(tmp_path):
    ws = FakeWS([{"flow_id": FLOW, "handler": "shelly", "step_id": "credentials",
                  "context": {"source": "zeroconf", "title_placeholders": {"name": "shelly1pmg3-abc"}}},
                 {"flow_id": FLOW.replace("0", "1"), "handler": "apple_tv", "step_id": "confirm",
                  "context": {"source": "zeroconf", "title_placeholders": {"name": "Küche"}}}])
    login, confirm = await make(tmp_path, ws=ws).discovered_flows()
    assert "without data" in login["next"]
    assert "data={}" in confirm["next"]


@pytest.mark.asyncio
async def test_the_login_help_comes_first_with_the_ready_call(tmp_path):
    """Live run 16.11.: with `fill` at the end of the result the 30B still asked for the password."""
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=LOGIN_FORM))
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.50"})
    keys = list(result)
    assert keys.index("next") < keys.index("data_schema") and keys.index("fill") < keys.index("data_schema")
    assert result["next"] == f'ha_integration_setup_step(flow_id="{FLOW}", data={json.dumps({"password": REF})})'
    assert "shelly_login" in result["hint"]


@pytest.mark.asyncio
async def test_no_ready_call_while_another_required_field_is_open(tmp_path):
    form = {**LOGIN_FORM, "data_schema": LOGIN_FORM["data_schema"] + [{"name": "username", "required": True,
                                                                         "selector": {"text": {}}}]}
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=form))
        result = await make(tmp_path).flow_step(FLOW, {"host": "192.0.2.50"})
    assert result["fill"] == {"password": REF} and "next" not in result


class DeviceWS(FakeWS):
    def __init__(self, devices):
        super().__init__()
        self.devices = devices

    async def command(self, kind, payload=None):
        if kind == "config/device_registry/list":
            self.calls.append((kind, payload or {}))
            return self.devices
        return await super().command(kind, payload)


@pytest.mark.asyncio
async def test_a_new_entry_names_its_devices_and_how_to_put_them_into_a_room(tmp_path):
    """Live run 16.11.: the Shelly was added, but 'add it to the hall' never reached the room."""
    ws = DeviceWS([{"id": "dev1", "name": "Hall light", "name_by_user": None, "model": "Shelly 1PM Gen3",
                    "area_id": None, "config_entries": [ENTRY]},
                   {"id": "dev2", "name": "Other", "model": "x", "area_id": "kueche", "config_entries": ["other"]}])
    created = {"type": "create_entry", "flow_id": FLOW, "handler": "shelly", "title": "Hall light",
               "result": {"entry_id": ENTRY, "domain": "shelly", "title": "Hall light", "state": "loaded"}}
    with respx.mock(base_url=URL) as router:
        router.post(f"/api/config/config_entries/flow/{FLOW}").mock(return_value=httpx.Response(200, json=created))
        result = await make(tmp_path, ws=ws).flow_step(FLOW, {"password": REF})
    assert result["devices"] == [{"device_id": "dev1", "name": "Hall light", "model": "Shelly 1PM Gen3",
                                  "area_id": None}]
    assert "ha_update_device" in result["hint"] and "ha_list_areas" in result["hint"]
