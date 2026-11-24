"""Matter: read the server's pairing abilities and the Matter devices; commission with a code reference only."""
import asyncio
import json

import httpx
import pytest
import respx

from ha_safe_mcp.credentials import CredentialStore
from ha_safe_mcp.matter import HAMatter
from ha_safe_mcp.server import HAClient, create_server

URL = "http://ha:8123"
ENTRY = {"entry_id": "01MATTERENTRY0000000000000", "domain": "matter", "title": "Matter", "state": "loaded"}
SERVER = {"fabric_id": 1, "compressed_fabric_id": 1234567890, "schema_version": 11,
          "min_supported_schema_version": 9, "sdk_version": "2025.7.0", "wifi_credentials_set": False,
          "thread_credentials_set": True, "bluetooth_enabled": False}
CODE = "34970112332"


def diagnostics(info=None):
    return {"data": {"server": {"info": info or SERVER, "nodes": [{"node_id": 1, "attributes": {"0/40/1": "x"}}]}}}


class FakeWS:
    def __init__(self):
        self.calls = []
        self.devices = [{"id": "d1", "name": "Acme Plug", "name_by_user": "Kaffee", "manufacturer": "Acme",
                         "model": "Plug 2", "area_id": "kuche", "sw_version": "3.5",
                         "config_entries": [ENTRY["entry_id"]], "serial_number": "SER1",
                         "connections": [["mac", "aa:bb"]], "identifiers": [["matter", "deadbeef"]]},
                        {"id": "d9", "name": "Other", "config_entries": ["other"]}]
        self.commission_error = None

    async def command(self, kind, payload=None, **options):
        self.calls.append((kind, payload, options))
        if kind == "config/device_registry/list":
            return [dict(d) for d in self.devices]
        if kind == "matter/node_diagnostics":
            return {"node_id": 1, "network_type": "thread", "node_type": "sleepy_end_device",
                    "network_name": "home-thread", "ip_adresses": ["fd00::1"], "mac_address": "aa:bb",
                    "available": True, "active_fabric_index": 1,
                    "active_fabrics": [{"fabric_id": 1, "vendor_id": 4939, "fabric_index": 1,
                                        "fabric_label": "", "vendor_name": "Nabu Casa"},
                                       {"fabric_id": 7, "vendor_id": 4937, "fabric_index": 2,
                                        "fabric_label": "Apple Home", "vendor_name": "Apple"}]}
        if kind == "matter/commission":
            if self.commission_error:
                raise RuntimeError(self.commission_error)
            self.devices.append({"id": "d2", "name": "Thermostat X", "name_by_user": None, "manufacturer": "Acme",
                                 "model": "Radiator valve", "area_id": None, "config_entries": [ENTRY["entry_id"]]})
            return None
        raise AssertionError(kind)


@pytest.fixture
def store(tmp_path):
    credentials = CredentialStore(tmp_path / "cred")
    credentials.save("thermostat_code", "Thermostat", {"password": "3497-011-2332"})
    return credentials


def make(ws=None, store=None, write=True):
    return HAMatter(HAClient(URL, "token-xyz", allow_write=write), ws or FakeWS(), allow_admin_write=write,
                    credentials=store, settle=0)


def routes(router, entries=(ENTRY,), info=None):
    router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=list(entries)))
    router.get(f"/api/diagnostics/config_entry/{ENTRY['entry_id']}").mock(
        return_value=httpx.Response(200, json=diagnostics(info)))


async def test_info_shows_pairing_abilities_and_devices_without_addresses_or_fabric_ids():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router)
        result = await make().info()
    assert result["matter_set_up"] is True
    assert result["server"] == {"sdk_version": "2025.7.0", "schema_version": 11, "bluetooth_enabled": False,
                                "thread_credentials_set": True, "wifi_credentials_set": False}
    assert result["devices"] == [{"device_id": "d1", "name": "Kaffee", "manufacturer": "Acme", "model": "Plug 2",
                                  "area_id": "kuche", "network": "thread", "node_type": "sleepy_end_device",
                                  "available": True, "also_paired_with": ["Apple Home"]}]
    text = json.dumps(result)
    for secret in ("fd00", "aa:bb", "1234567890", "SER1", "deadbeef", "home-thread"):
        assert secret not in text
    assert any("Bluetooth" in line for line in result["pairing_advice"])


async def test_info_without_matter_says_how_to_set_it_up():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/config/config_entries/entry").mock(return_value=httpx.Response(200, json=[]))
        result = await make().info()
    assert result["matter_set_up"] is False and "Matter" in result["hint"] and "add-on" in result["hint"]


async def test_info_with_the_server_down_names_the_next_step():
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router, entries=({**ENTRY, "state": "setup_retry"},))
        result = await make().info()
    assert result["state"] == "setup_retry" and "ha_list_addons" in result["hint"]


async def test_commission_resolves_the_code_reference_and_lists_the_new_device(store):
    ws = FakeWS()
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router)
        result = await make(ws, store).commission({"$credential": "thermostat_code", "field": "password"})
    sent = next((p, o) for k, p, o in ws.calls if k == "matter/commission")
    assert sent[0] == {"code": CODE, "network_only": True}
    assert sent[1]["timeout"] >= 300 and sent[1]["error_message"] is True
    assert result["commissioned"] is True
    assert result["new_devices"] == [{"device_id": "d2", "name": "Thermostat X", "manufacturer": "Acme",
                                      "model": "Radiator valve", "area_id": None}]
    assert "ha_update_device" in result["next"]
    assert CODE not in json.dumps(result)


async def test_commission_refuses_a_plain_code_and_codes_of_the_wrong_shape(store):
    store.save("bad", "Bad", {"password": "12345"})
    ws = FakeWS()
    with pytest.raises(ValueError, match="credential reference"):
        await make(ws, store).commission(CODE)
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router)
        with pytest.raises(ValueError, match="11 or 21 digits") as error:
            await make(ws, store).commission({"$credential": "bad", "field": "password"})
    assert "12345" not in str(error.value)
    assert not [k for k, _, _ in ws.calls if k == "matter/commission"]


async def test_bluetooth_pairing_is_refused_up_front_when_the_server_has_no_bluetooth(store):
    ws = FakeWS()
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router)
        with pytest.raises(ValueError, match="Bluetooth") as error:
            await make(ws, store).commission({"$credential": "thermostat_code", "field": "password"},
                                             network_only=False)
    assert "Companion app" in str(error.value)
    assert not [k for k, _, _ in ws.calls if k == "matter/commission"]


async def test_a_failed_commissioning_returns_the_reason_with_the_code_scrubbed_and_next_steps(store):
    ws = FakeWS()
    ws.commission_error = f"Home Assistant WebSocket error: 1: Commissioning with code {CODE} failed: timeout"
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        routes(router)
        with pytest.raises(RuntimeError) as error:
            await make(ws, store).commission({"$credential": "thermostat_code", "field": "password"})
    text = str(error.value)
    assert CODE not in text and "[credential:thermostat_code.password]" in text
    assert "failed: timeout" in text and "pairing mode" in text


async def test_commission_needs_admin_write(store):
    with pytest.raises(ValueError, match="admin write"):
        await make(store=store, write=False).commission({"$credential": "thermostat_code", "field": "password"})


def test_matter_tools_are_registered_with_their_levels():
    from ha_safe_mcp.ollama_client import write_level
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    assert {"ha_get_matter_info", "ha_matter_commission"} <= names
    assert write_level("ha_get_matter_info") is None and write_level("ha_matter_commission") == "admin"
