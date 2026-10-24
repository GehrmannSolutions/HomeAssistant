"""Add and manage integrations through Home Assistant's config-flow API (the same routes the HA UI uses).

Sources: homeassistant/components/config/config_entries.py and helpers/data_entry_flow.py in the
official HA Core repository. Flow-starting/step/delete routes require an admin token in HA itself.

Guardrails:
- read: entries, available handlers, discovered (zeroconf/dhcp/ssdp/...) flows waiting for confirmation
- admin write: start a flow, submit a step, abort a flow, reload an entry
- admin write: options flows (/api/config/config_entries/options/flow[/{flow_id}], handler = entry_id),
  reconfigure flows (config flow with entry_id), entry title/polling/new-entity preferences and disabling
  (WS config_entries/update, config_entries/disable)
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
LIST_FIELDS = ENTRY_FIELDS + ("supports_options", "supports_reconfigure", "pref_disable_polling",
                              "pref_disable_new_entities")
OPTIONS_HINT = ("Send only the fields the user wants changed; fields with a `current` value that you leave out are "
                "kept automatically (listed in kept_current), others fall back to their `default`. Secret fields show "
                "no value; resend them only as a credential reference when the user wants them changed.")
ENTRY_UPDATE = frozenset({"title", "pref_disable_polling", "pref_disable_new_entities"})
FLOW_FIELDS = ("type", "flow_id", "handler", "step_id", "errors", "description_placeholders", "reason",
               "last_step", "title", "menu_options", "progress_action")
MAX_HANDLERS = 100
MAX_STEP_FIELDS = 30
STEP_TIMEOUT = 90  # device handshakes (login, discovery probes) can outlast the default request timeout


def _form_field(field: dict) -> dict:
    """One form field for the model. HA keeps the *current* value in description.suggested_value (options
    and reconfigure forms); expose it as `current`, but never for secret fields, where every value is dropped."""
    secret = bool(SECRET_FIELD.search(str(field.get("name", ""))))
    out = {key: value for key, value in field.items()
           if key != "description" and not (secret and key in ("default", "suggested_value"))}
    description = field.get("description")
    if isinstance(description, dict):
        rest = {key: value for key, value in description.items() if key != "suggested_value"}
        if rest:
            out["description"] = rest
        if "suggested_value" in description and not secret:
            out["current"] = description["suggested_value"]
    elif description is not None:
        out["description"] = description
    return out


class HAIntegrations:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 credentials: CredentialStore | None = None):
        self.client = client
        self.ws = ws
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete
        self.credentials = credentials or CredentialStore()
        # flow_id -> current (suggested) values of the last form; HA resets omitted fields to factory defaults
        self._current: dict[str, dict] = {}

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
        return [{key: entry.get(key) for key in LIST_FIELDS} for entry in entries if isinstance(entry, dict)]

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
            reduced["data_schema"] = [_form_field(field) for field in result["data_schema"]
                                      if isinstance(field, dict)]
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
        return self._remember(self._reduce(result, {}))

    def _remember(self, reduced: dict) -> dict:
        """Remember a form's current values for its next step; forget them once the flow is over."""
        flow_id = reduced.get("flow_id")
        if reduced.get("type") == "form" and isinstance(flow_id, str):
            self._current[flow_id] = {field["name"]: field["current"] for field in reduced.get("data_schema", [])
                                      if isinstance(field.get("name"), str) and "current" in field}
        elif isinstance(flow_id, str):
            self._current.pop(flow_id, None)
        return reduced

    def _merge_current(self, flow_id: str, data: dict) -> tuple[dict, list[str]]:
        """Fill fields the model left out with their current value, as the HA frontend does."""
        current = self._current.get(flow_id, {})
        kept = sorted(key for key in current if key not in data)
        return {**{key: current[key] for key in kept}, **data}, kept

    async def _step(self, base: str, flow_id: str, data: dict | None) -> dict:
        flow_id = self._flow_id(flow_id)
        self._check_write()
        merged, kept = self._merge_current(flow_id, data or {})
        resolved, used = self._prepare_step(merged)
        try:
            result = await self.client._request("POST", f"{base}/{flow_id}", data=resolved, timeout=STEP_TIMEOUT)
        except RuntimeError as exc:
            raise RuntimeError(scrub(str(exc), used)) from None
        reduced = self._remember(self._reduce(result, used))
        if reduced.get("type") != "form":
            self._current.pop(flow_id, None)
        return {**reduced, **({"kept_current": kept} if kept else {})}

    async def flow_step(self, flow_id: str, data: dict | None = None) -> dict:
        return await self._step("/api/config/config_entries/flow", flow_id, data)

    async def abort_flow(self, flow_id: str) -> dict:
        flow_id = self._flow_id(flow_id)
        self._check_write()
        await self.client._request("DELETE", f"/api/config/config_entries/flow/{flow_id}")
        self._current.pop(flow_id, None)
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

    # ------------------------------------------------------------------ options, reconfigure, settings
    async def start_options(self, entry_id: str, show_advanced_options: bool = False) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_write()
        result = await self.client._request("POST", "/api/config/config_entries/options/flow",
                                            data={"handler": entry_id, "show_advanced_options": bool(show_advanced_options)},
                                            timeout=STEP_TIMEOUT)
        return {**self._remember(self._reduce(result, {})), "kind": "options", "hint": OPTIONS_HINT}

    async def options_step(self, flow_id: str, data: dict | None = None) -> dict:
        reduced = await self._step("/api/config/config_entries/options/flow", flow_id, data)
        return {**reduced, "kind": "options", **({"hint": OPTIONS_HINT} if reduced.get("type") == "form" else {})}

    async def abort_options(self, flow_id: str) -> dict:
        flow_id = self._flow_id(flow_id)
        self._check_write()
        await self.client._request("DELETE", f"/api/config/config_entries/options/flow/{flow_id}")
        self._current.pop(flow_id, None)
        return {"aborted": True}

    async def _raw_entry(self, entry_id: str) -> dict:
        entries = await self.client._request("GET", "/api/config/config_entries/entry")
        entry = next((e for e in entries if isinstance(e, dict) and e.get("entry_id") == entry_id), None) \
            if isinstance(entries, list) else None
        if entry is None:
            raise ValueError("unknown entry_id: use the entry_id from ha_list_integrations")
        return entry

    async def start_reconfigure(self, entry_id: str, show_advanced_options: bool = False) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_write()
        entry = await self._raw_entry(entry_id)
        if not entry.get("supports_reconfigure"):
            raise ValueError("this integration does not support reconfigure; try ha_start_integration_options")
        domain = entry.get("domain")
        if not isinstance(domain, str) or not IDENTIFIER.fullmatch(domain):
            raise RuntimeError("Unexpected Home Assistant response")
        result = await self.client._request("POST", "/api/config/config_entries/flow",
                                            data={"handler": domain, "entry_id": entry_id,
                                                  "show_advanced_options": bool(show_advanced_options)},
                                            timeout=STEP_TIMEOUT)
        return {**self._remember(self._reduce(result, {})), "hint": OPTIONS_HINT}

    async def _entry_view(self, entry_id: str) -> dict:
        result = await self.ws.command("config_entries/get_single", {"entry_id": entry_id})
        entry = result.get("config_entry") if isinstance(result, dict) else None
        if not isinstance(entry, dict):
            raise RuntimeError("Unexpected Home Assistant response")
        return {key: entry.get(key) for key in LIST_FIELDS if key in entry}

    async def entry_view(self, entry_id: str) -> dict:
        return await self._entry_view(self._entry_id(entry_id))

    async def update_entry(self, entry_id: str, changes: dict) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_write()
        if not isinstance(changes, dict) or not changes or not changes.keys() <= ENTRY_UPDATE:
            raise ValueError(f"unsupported entry fields; allowed: {', '.join(sorted(ENTRY_UPDATE))}")
        if "title" in changes and (not isinstance(changes["title"], str) or not changes["title"].strip()
                                   or len(changes["title"]) > 100):
            raise ValueError("title must be 1-100 characters")
        for key in ("pref_disable_polling", "pref_disable_new_entities"):
            if key in changes and not isinstance(changes[key], bool):
                raise ValueError(f"{key} must be true or false")
        result = await self.ws.command("config_entries/update", {"entry_id": entry_id, **changes})
        current = await self._entry_view(entry_id)
        if any(current.get(key) != value for key, value in changes.items()):
            raise RuntimeError("Integration update not confirmed by read-back")
        return {**current, "require_restart": bool(isinstance(result, dict) and result.get("require_restart"))}

    async def set_entry_disabled(self, entry_id: str, disabled: bool) -> dict:
        entry_id = self._entry_id(entry_id)
        self._check_write()
        if not isinstance(disabled, bool):
            raise ValueError("disabled must be true or false")
        result = await self.ws.command("config_entries/disable",
                                       {"entry_id": entry_id, "disabled_by": "user" if disabled else None})
        current = await self._entry_view(entry_id)
        if (current.get("disabled_by") == "user") != disabled:
            raise RuntimeError("Integration disable state not confirmed by read-back")
        return {**current, "require_restart": bool(isinstance(result, dict) and result.get("require_restart"))}
