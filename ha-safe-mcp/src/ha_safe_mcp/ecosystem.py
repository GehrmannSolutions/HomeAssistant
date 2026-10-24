"""Read-only views of the Home Assistant ecosystem: add-ons and system info (Supervisor), HACS, Zigbee, Thread.

Sources: HA Core 2026.10 components/hassio/websocket_api.py (``supervisor/api`` proxy; only fixed GET endpoints are
allowed here, enforced again in management.HAWebSocket), components/zha/websocket_api.py (``zha/devices``),
components/thread/websocket_api.py (``thread/list_datasets``) and the HACS integration (``hacs/repositories/list``).

Everything here is read-only. Identifiers and network secrets are dropped: no IEEE/NWK addresses, IP addresses,
host names, PAN IDs or dataset keys; Thread network keys are never requested.
"""
from __future__ import annotations

ADDON_FIELDS = ("slug", "name", "state", "version", "version_latest", "update_available", "repository")
INFO_FIELDS = {
    "core": ("version", "version_latest", "update_available", "machine", "arch"),
    "supervisor": ("version", "version_latest", "update_available", "channel", "healthy", "supported", "auto_update"),
    "os": ("version", "version_latest", "update_available", "board"),
    "host": ("operating_system", "kernel", "chassis", "disk_total", "disk_used", "disk_free", "disk_life_time"),
}
HACS_FIELDS = ("full_name", "name", "category", "installed_version", "available_version", "pending_upgrade")
ZIGBEE_FIELDS = ("model", "manufacturer", "device_type", "power_source", "available", "lqi", "rssi", "last_seen",
                 "area_id")
WEAK_LQI = 80
THREAD_FIELDS = ("network_name", "channel", "preferred", "source", "created")


def _missing(exc: Exception) -> bool:
    text = str(exc)
    return isinstance(exc, RuntimeError) and ("unknown_command" in text or "not_found" in text or "404" in text)


class HAEcosystem:
    def __init__(self, client, ws):
        self.client, self.ws = client, ws

    async def _supervisor(self, endpoint: str):
        return await self.ws.command("supervisor/api", {"endpoint": endpoint, "method": "get"})

    async def list_addons(self) -> list[dict]:
        try:
            result = await self._supervisor("/addons")
        except RuntimeError as exc:
            if _missing(exc):
                return []  # no Supervisor (HA Container/Core install): no add-ons
            raise
        items = result.get("addons", []) if isinstance(result, dict) else []
        return sorted(({key: item.get(key) for key in ADDON_FIELDS} for item in items if isinstance(item, dict)),
                      key=lambda a: (not a["update_available"], str(a["name"]).casefold()))

    async def system_info(self) -> dict:
        info: dict = {}
        for part, fields in INFO_FIELDS.items():
            try:
                result = await self._supervisor(f"/{part}/info")
            except RuntimeError as exc:
                if _missing(exc):
                    return {"supervisor_available": False,
                            "hint": "no Supervisor (HA Container/Core install); see ha_get_overview for the version"}
                raise
            info[part] = {key: result.get(key) for key in fields if isinstance(result, dict) and key in result}
        return {"supervisor_available": True, **info}

    async def list_hacs(self, installed_only: bool = True) -> dict:
        try:
            items = await self.ws.command("hacs/repositories/list")
        except RuntimeError as exc:
            if _missing(exc):
                return {"hacs_installed": False}
            raise
        items = [i for i in items or [] if isinstance(i, dict)]
        chosen = [i for i in items if i.get("installed")] if installed_only else items
        repos = sorted(({key: item.get(key) for key in HACS_FIELDS} for item in chosen),
                       key=lambda r: (not r["pending_upgrade"], str(r["full_name"]).casefold()))
        return {"hacs_installed": True, "repositories": repos[:300], "known_repositories": len(items)}

    async def zigbee_devices(self, problems_only: bool = False) -> dict:
        try:
            items = await self.ws.command("zha/devices")
        except RuntimeError as exc:
            if _missing(exc):
                return {"zha_installed": False}
            raise
        devices = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            entry = {"name": item.get("user_given_name") or item.get("name"),
                     **{key: item.get(key) for key in ZIGBEE_FIELDS if item.get(key) is not None}}
            lqi = item.get("lqi")
            entry["weak_signal"] = isinstance(lqi, (int, float)) and item.get("device_type") != "Coordinator" \
                and lqi < WEAK_LQI
            devices.append(entry)
        summary = {"total": len(devices), "unavailable": sum(1 for d in devices if d.get("available") is False),
                   "weak_signal": sum(1 for d in devices if d["weak_signal"])}
        if problems_only:
            devices = [d for d in devices if d.get("available") is False or d["weak_signal"]]
        devices.sort(key=lambda d: (d.get("available") is not False, d.get("lqi") if isinstance(d.get("lqi"),
                                                                                                 (int, float)) else 999))
        return {**summary, "weak_lqi_below": WEAK_LQI, "devices": devices[:200]}

    async def thread_networks(self) -> list[dict]:
        try:
            result = await self.ws.command("thread/list_datasets")
        except RuntimeError as exc:
            if _missing(exc):
                return []
            raise
        datasets = result.get("datasets", []) if isinstance(result, dict) else []
        return [{key: d.get(key) for key in THREAD_FIELDS} for d in datasets if isinstance(d, dict)]
