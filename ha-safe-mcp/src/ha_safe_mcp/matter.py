"""Matter: what the Matter server can pair, the Matter devices, and commissioning with a stored code.

Sources: HA Core 2026.11 components/matter/api.py (``matter/commission`` {code, network_only} require_admin;
``matter/node_diagnostics`` {device_id}) and components/matter/diagnostics.py (config entry diagnostics =
{"server": {"info": ServerInfoMessage, "nodes": [...]}}).

Read results keep only fields a person needs: no IP or MAC addresses, fabric IDs, network names (a Wi-Fi node's
network name is the SSID) or raw node attributes. The pairing code is a secret (whoever has it can take over the
device in its pairing window): it is accepted only as a credential reference, resolved right before the one call
and scrubbed from every answer and error.
"""
from __future__ import annotations

import asyncio
import re

from .credentials import REF_KEY, CredentialError, CredentialStore, resolve_refs, scrub

SERVER_FIELDS = ("sdk_version", "schema_version", "bluetooth_enabled", "thread_credentials_set",
                 "wifi_credentials_set")
DEVICE_FIELDS = ("manufacturer", "model", "area_id")
MAX_NODE_DIAGNOSTICS = 40
COMMISSION_TIMEOUT = 330  # HA waits for the Matter server, which itself may take several minutes
QR = re.compile(r"^MT:[0-9A-Z.\-]{10,200}$")
CODE_REF = '{"$credential": "<alias>", "field": "<field>"}'
NEXT_STEPS = ("Next steps: put the device into pairing mode again (most devices open it for 15 minutes after power "
              "on or a reset), keep it close to a Thread border router / the Wi-Fi access point, and check that the "
              "code belongs to this device. A device already paired in another app needs a fresh pairing code from "
              "that app (share / 'turn on pairing mode'), used with network_only=true. The Matter server log "
              "(Matter Server add-on) has the details.")


class HAMatter:
    def __init__(self, client, ws, *, allow_admin_write: bool = False, credentials: CredentialStore | None = None,
                 settle: float = 3.0):
        self.client, self.ws = client, ws
        self.allow_admin_write = allow_admin_write
        self.credentials = credentials or CredentialStore()
        self.settle = settle

    async def _entry(self) -> dict | None:
        entries = await self.client._request("GET", "/api/config/config_entries/entry?domain=matter")
        entries = [e for e in entries or [] if isinstance(e, dict) and e.get("domain", "matter") == "matter"]
        return next((e for e in entries if e.get("state") == "loaded"), entries[0] if entries else None)

    async def _server_info(self, entry_id: str) -> dict:
        diagnostics = await self.client._request("GET", f"/api/diagnostics/config_entry/{entry_id}", timeout=30)
        server = ((diagnostics or {}).get("data") or {}).get("server") or {}
        info = server.get("info") if isinstance(server, dict) else None
        return {key: info.get(key) for key in SERVER_FIELDS if isinstance(info, dict) and key in info}

    async def _devices(self, entry_id: str) -> list[dict]:
        devices = await self.ws.command("config/device_registry/list")
        return [d for d in devices or [] if isinstance(d, dict) and entry_id in (d.get("config_entries") or [])]

    @staticmethod
    def _device(item: dict) -> dict:
        return {"device_id": item.get("id"), "name": item.get("name_by_user") or item.get("name"),
                **{key: item.get(key) for key in DEVICE_FIELDS}}

    async def _node(self, device_id: str) -> dict:
        try:
            node = await self.ws.command("matter/node_diagnostics", {"device_id": device_id})
        except RuntimeError:
            return {"network": "unknown (no node diagnostics)"}
        node = node if isinstance(node, dict) else {}
        own = node.get("active_fabric_index")
        others = [f.get("fabric_label") or f.get("vendor_name") or "unknown app"
                  for f in node.get("active_fabrics") or [] if isinstance(f, dict) and f.get("fabric_index") != own]
        return {"network": node.get("network_type"), "node_type": node.get("node_type"),
                "available": node.get("available"), "also_paired_with": others}

    @staticmethod
    def _advice(server: dict) -> list[str]:
        advice = []
        if server.get("bluetooth_enabled") is False:
            advice.append("Bluetooth is off on the Matter server: NEW devices that pair over Bluetooth (most Thread "
                          "and Wi-Fi devices out of the box) cannot be paired from here. Pair them with the Home "
                          "Assistant Companion app on a phone, or share a device that is already in another Matter "
                          "app (multi-admin code, network_only=true).")
        if server.get("thread_credentials_set") is False:
            advice.append("The Matter server holds no Thread credentials of its own, so it cannot bring a NEW Thread "
                          "device into the Thread network by itself. Pairing with the Companion app is the usual way (the phone "
                          "brings the Thread credentials); devices already on Thread are not affected.")
        if not advice:
            advice.append("The Matter server can pair new devices; the device must be in pairing mode.")
        return advice

    async def info(self) -> dict:
        entry = await self._entry()
        if entry is None:
            return {"matter_set_up": False,
                    "hint": "Matter is not set up in Home Assistant. Add it in Settings > Devices & services > Add "
                            "integration > Matter; it needs a Matter server (on Home Assistant OS the 'Matter "
                            "Server' add-on, which the user installs - this MCP does not install add-ons)."}
        if entry.get("state") != "loaded":
            return {"matter_set_up": True, "state": entry.get("state"),
                    "hint": "the Matter integration is not loaded: the Matter server is probably not running. Check "
                            "the add-on with ha_list_addons and the log with ha_get_error_log."}
        try:
            server = await self._server_info(entry["entry_id"])
        except RuntimeError as exc:
            server = {"error": f"server details not readable ({exc}); they need an admin token"}
        devices = []
        for item in (await self._devices(entry["entry_id"]))[:MAX_NODE_DIAGNOSTICS]:
            devices.append({**self._device(item), **await self._node(item["id"])})
        result = {"matter_set_up": True, "server": server, "devices": devices, "device_count": len(devices),
                  "pairing_advice": self._advice(server)}
        if not devices:
            result["hint"] = "no Matter devices yet; pair one with ha_matter_commission or the Companion app"
        return result

    # ------------------------------------------------------------------ commissioning
    @staticmethod
    def _clean_code(code: str) -> str:
        code = code.strip()
        if code.upper().startswith("MT:"):
            code = "MT:" + code[3:].strip()
            if QR.fullmatch(code):
                return code
        else:
            digits = re.sub(r"[\s\-]", "", code)
            if digits.isdigit() and len(digits) in (11, 21):
                return digits
        raise ValueError("the stored value does not look like a Matter pairing code (11 or 21 digits, dashes and "
                         "spaces allowed, or the QR text starting with MT:); check the credential's value in "
                         "'Credentials'")

    async def commission(self, code, network_only: bool = True) -> dict:
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")
        if not (isinstance(code, dict) and REF_KEY in code):
            raise ValueError("code must be a credential reference " + CODE_REF + " from ha_list_credentials, never "
                             "the pairing code itself; if none exists, ask the user to save the code under "
                             "'Credentials'")
        if not isinstance(network_only, bool):
            raise ValueError("network_only: true or false")
        try:
            resolved, used = resolve_refs(self.credentials, {"code": code})
        except CredentialError as exc:
            raise ValueError(f"credential reference problem: {exc}. Check the alias with ha_list_credentials.") from None
        raw = resolved["code"]
        clean = self._clean_code(raw)
        used = {**used, clean: next(iter(used.values()))}
        entry = await self._entry()
        if entry is None or entry.get("state") != "loaded":
            raise ValueError("Matter is not ready in Home Assistant; see ha_get_matter_info for what is missing")
        server = await self._server_info(entry["entry_id"])
        if not network_only and server.get("bluetooth_enabled") is False:
            raise ValueError("Bluetooth is off on the Matter server, so pairing a new device over Bluetooth cannot "
                             "work here. Pair it with the Home Assistant Companion app on a phone, or, if the device "
                             "is already in another Matter app, share it there and retry with network_only=true.")
        before = {d["id"] for d in await self._devices(entry["entry_id"])}
        try:
            await self.ws.command("matter/commission", {"code": clean, "network_only": network_only},
                                  timeout=COMMISSION_TIMEOUT, error_message=True)
        except (RuntimeError, TimeoutError) as exc:
            reason = scrub(str(exc) or type(exc).__name__, used)
            raise RuntimeError(f"Matter commissioning failed: {reason}. {NEXT_STEPS}") from None
        new = []
        for _ in range(5):
            await asyncio.sleep(self.settle)
            new = [self._device(d) for d in await self._devices(entry["entry_id"]) if d["id"] not in before]
            if new or not self.settle:
                break
        result = {"commissioned": True, "new_devices": new,
                  "next": "put the new device into a room and give it a name with ha_update_device "
                          "(changes: area_id, name_by_user); its entities: ha_list_area_entities"}
        if not new:
            result["note"] = "Home Assistant reported success but the device is not in the registry yet; read " \
                             "ha_get_matter_info again in a minute"
        result["undo"] = "a paired device is removed with ha_remove_device (delete level)"
        return scrub(result, used)
