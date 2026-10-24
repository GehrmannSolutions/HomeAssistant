"""Add and manage integrations through Home Assistant's config-flow API (the same routes the HA UI uses).

Sources: homeassistant/components/config/config_entries.py and helpers/data_entry_flow.py in the
official HA Core repository. Flow-starting/step/delete routes require an admin token in HA itself.

Guardrails:
- read: entries, available handlers, discovered (zeroconf/dhcp/ssdp/...) flows waiting for confirmation
- admin write: start a flow, submit a step, abort a flow, reload an entry
- admin write + delete: remove an entry
- Secret-looking step fields (password, token, api_key, pin, ...) are accepted only as
  {"$credential": "<alias>", "field": "<field>"} references to the local credential store. Values are
  resolved here, right before the request, and scrubbed from every result; schema defaults are dropped.
"""

import re

from .credentials import CredentialError, CredentialStore, REF_KEY, resolve_refs, scrub
from .server import IDENTIFIER, HAClient

FLOW_ID = re.compile(r"^(?:[0-9a-f]{32}|[0-9A-HJKMNP-TV-Z]{26})$")  # uuid hex (older HA) or ULID (current)
ENTRY_ID = re.compile(r"^[0-9A-Za-z]{20,40}$")
SECRET_FIELD = re.compile(r"(?i)(pass|secret|token|api[_-]?key|pin|auth|credential|private)")
ENTRY_FIELDS = ("entry_id", "domain", "title", "state", "source", "disabled_by", "reason")
FLOW_FIELDS = ("type", "flow_id", "handler", "step_id", "errors", "description_placeholders", "reason",
               "last_step", "title", "menu_options", "progress_action")
MAX_HANDLERS = 100
MAX_STEP_FIELDS = 30
STEP_TIMEOUT = 90  # device handshakes (login, discovery probes) can outlast the default request timeout


class HAIntegrations:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 credentials: CredentialStore | None = None):
        self.client = client
        self.ws = ws
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete
        self.credentials = credentials or CredentialStore()

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    @staticmethod
    def _flow_id(flow_id: str) -> str:
        if not isinstance(flow_id, str) or not FLOW_ID.fullmatch(flow_id):
            raise ValueError("invalid flow_id: copy it exactly from the previous flow result")
        return flow_id

    @staticmethod
    def _entry_id(entry_id: str) -> str:
        if not isinstance(entry_id, str) or not ENTRY_ID.fullmatch(entry_id):
            raise ValueError("invalid entry_id: use the entry_id from ha_list_integrations")
        return entry_id

    # ------------------------------------------------------------------ read
    async def list_entries(self, domain: str = "") -> list[dict]:
        if domain and not IDENTIFIER.fullmatch(domain):
            raise ValueError("invalid domain")
        path = "/api/config/config_entries/entry" + (f"?domain={domain}" if domain else "")
        entries = await self.client._request("GET", path)
        if not isinstance(entries, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [{key: entry.get(key) for key in ENTRY_FIELDS} for entry in entries if isinstance(entry, dict)]

    async def list_handlers(self, query: str = "") -> list[str]:
        handlers = await self.client._request("GET", "/api/config/config_entries/flow_handlers")
        if not isinstance(handlers, list):
            raise RuntimeError("Unexpected Home Assistant response")
        needle = str(query or "").casefold().strip()
        return sorted(h for h in handlers if isinstance(h, str) and needle in h.casefold())[:MAX_HANDLERS]

    async def discovered_flows(self) -> list[dict]:
        flows = await self.ws.command("config_entries/flow/progress")
        result = []
        for flow in flows if isinstance(flows, list) else []:
            if not isinstance(flow, dict):
                continue
            context = flow.get("context") if isinstance(flow.get("context"), dict) else {}
            placeholders = context.get("title_placeholders") if isinstance(context.get("title_placeholders"), dict) else {}
            result.append({"flow_id": flow.get("flow_id"), "handler": flow.get("handler"), "step_id": flow.get("step_id"),
                           "source": context.get("source"), "name": placeholders.get("name")})
        return result

    def credential_aliases(self) -> list[dict]:
        return [{"alias": item["alias"], "label": item["label"], "fields": item["fields"]}
                for item in self.credentials.list_public()]

    # ------------------------------------------------------------------ write
    def _prepare_step(self, data: dict) -> tuple[dict, dict[str, str]]:
        if data is None:
            data = {}
        if not isinstance(data, dict) or len(data) > MAX_STEP_FIELDS:
            raise ValueError(f"step data must be an object with at most {MAX_STEP_FIELDS} fields")
        for key, value in data.items():
            if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", key):
                raise ValueError("invalid step field name")
            is_ref = isinstance(value, dict) and REF_KEY in value
            if SECRET_FIELD.search(key) and not is_ref and value not in ("", None):
                raise ValueError(f"field '{key}' looks secret: pass it as a credential reference "
                                 '{"$credential": "<alias>", "field": "<field>"} from ha_list_credentials')
        try:
            return resolve_refs(self.credentials, data)
        except CredentialError as exc:
            raise ValueError(f"credential reference problem: {exc}") from None

    @staticmethod
    def _reduce(result, used: dict[str, str]) -> dict:
        if not isinstance(result, dict):
            raise RuntimeError("Unexpected Home Assistant response")
        reduced = {key: result[key] for key in FLOW_FIELDS if key in result and result[key] is not None}
        if isinstance(result.get("data_schema"), list):
            reduced["data_schema"] = [
                {key: value for key, value in field.items()
                 if not (key in ("default", "suggested_value") and SECRET_FIELD.search(str(field.get("name", ""))))}
                for field in result["data_schema"] if isinstance(field, dict)]
        if result.get("type") == "create_entry" and isinstance(result.get("result"), dict):
            reduced["entry"] = {key: result["result"].get(key) for key in ENTRY_FIELDS if key in result["result"]}
        return scrub(reduced, used)

    async def start_flow(self, handler: str, show_advanced_options: bool = False) -> dict:
        self._check_write()
        if not isinstance(handler, str) or not IDENTIFIER.fullmatch(handler):
            raise ValueError("invalid handler: integration domain, e.g. 'shelly'")
        result = await self.client._request("POST", "/api/config/config_entries/flow",
                                            data={"handler": handler, "show_advanced_options": bool(show_advanced_options)},
                                            timeout=STEP_TIMEOUT)
        return self._reduce(result, {})

    async def flow_step(self, flow_id: str, data: dict | None = None) -> dict:
        flow_id = self._flow_id(flow_id)
        self._check_write()
        resolved, used = self._prepare_step(data or {})
        try:
            result = await self.client._request("POST", f"/api/config/config_entries/flow/{flow_id}", data=resolved,
                                                timeout=STEP_TIMEOUT)
        except RuntimeError as exc:
            raise RuntimeError(scrub(str(exc), used)) from None
        return self._reduce(result, used)

    async def abort_flow(self, flow_id: str) -> dict:
        flow_id = self._flow_id(flow_id)
        self._check_write()
        await self.client._request("DELETE", f"/api/config/config_entries/flow/{flow_id}")
        return {"aborted": True}

    async def reload_entry(self, entry_id: str) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_write()
        result = await self.client._request("POST", f"/api/config/config_entries/entry/{entry_id}/reload",
                                            timeout=STEP_TIMEOUT)
        return {"require_restart": bool(isinstance(result, dict) and result.get("require_restart"))}

    async def delete_entry(self, entry_id: str) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_delete()
        result = await self.client._request("DELETE", f"/api/config/config_entries/entry/{entry_id}")
        return {"require_restart": bool(isinstance(result, dict) and result.get("require_restart"))}
