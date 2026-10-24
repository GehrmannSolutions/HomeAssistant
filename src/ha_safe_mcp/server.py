"""Safety-first standalone MCP bridge for Home Assistant's documented REST API."""

import functools
import os
import re
import time
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import Field

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
ENTITY = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")
DEFAULT_DOMAINS = frozenset({"light", "switch", "fan", "climate", "cover", "media_player"})
HelperId = Annotated[str, Field(
    pattern=r"^[a-z][a-z0-9_]{0,63}$",
    description="Collection ID from ha_list_helpers (field 'id', lowercase, e.g. 'guest_mode'); "
                "not the display name and not the entity_id")]
FlowId = Annotated[str, Field(
    pattern=r"^(?:[0-9a-f]{32}|[0-9A-HJKMNP-TV-Z]{26})$",
    description="flow_id copied exactly from the previous ha_start_integration_setup/ha_integration_setup_step "
                "result or from ha_list_discovered")]
EntryId = Annotated[str, Field(
    pattern=r"^[0-9A-Za-z]{20,40}$",
    description="entry_id from ha_list_integrations; not the title and not the domain")]


def credential_store_from_env():
    from pathlib import Path
    from .credentials import CredentialStore
    directory = os.getenv("HA_CREDENTIALS_DIR")
    return CredentialStore(Path(directory)) if directory else CredentialStore()


class HAClient:
    def __init__(self, url: str, token: str, *, allow_write: bool = False,
                 allowed_domains: frozenset[str] = DEFAULT_DOMAINS, audit=None):
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("HA_URL must be a root http(s) URL without credentials or query")
        if not token:
            raise ValueError("HA_TOKEN is required")
        self.url = url.rstrip("/")
        self.token = token
        self.allow_write = allow_write
        self.allowed_domains = allowed_domains
        self.audit = audit

    def log(self, **fields):
        """Metadata-only audit record (see audit.py); a broken log never breaks the HA call."""
        if self.audit is None:
            return
        from .audit import current_tool
        try:
            self.audit.record(kind="ha", tool=current_tool.get(), **fields)
        except Exception:  # noqa: BLE001 - auditing is best effort by design
            pass

    async def _request(self, method: str, path: str, *, data: dict | None = None, timeout: float = 15):
        started, status, error = time.monotonic(), None, None
        try:
            async with httpx.AsyncClient(base_url=self.url, timeout=timeout, trust_env=False,
                                         headers={"Authorization": f"Bearer {self.token}"}) as client:
                response = await client.request(method, path, json=data)
                status = response.status_code
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            error = "HTTPStatusError"
            raise RuntimeError(f"Home Assistant returned HTTP {exc.response.status_code}") from None
        except (httpx.RequestError, ValueError) as exc:
            error = type(exc).__name__
            raise RuntimeError(f"Home Assistant request failed ({type(exc).__name__})") from None
        finally:
            self.log(channel="rest", method=method, route=path, status=status, ok=error is None,
                     ms=(time.monotonic() - started) * 1000, error=error)

    async def search_entities(self, query: str = "", domain: str = "", limit: int = 50) -> list[dict]:
        if domain and not IDENTIFIER.fullmatch(domain):
            raise ValueError("invalid domain")
        if not 1 <= limit <= 200:
            raise ValueError("limit must be between 1 and 200")
        states = await self._request("GET", "/api/states")
        if not isinstance(states, list):
            raise RuntimeError("Unexpected Home Assistant response")
        needle = query.casefold()
        return [{"entity_id": state["entity_id"], "state": state.get("state", ""),
                 "friendly_name": str(state.get("attributes", {}).get("friendly_name", ""))}
                for state in states if isinstance(state, dict) and isinstance(state.get("entity_id"), str)
                and isinstance(state.get("attributes", {}), dict)
                and (not domain or state["entity_id"].startswith(domain + "."))
                and (needle in state["entity_id"].casefold()
                     or needle in str(state["attributes"].get("friendly_name", "")).casefold())][:limit]

    async def get_state(self, entity_id: str) -> dict:
        if not ENTITY.fullmatch(entity_id):
            raise ValueError("invalid entity_id")
        return await self._request("GET", f"/api/states/{entity_id}")

    async def list_services(self, domain: str = "") -> list[dict]:
        if domain and not IDENTIFIER.fullmatch(domain):
            raise ValueError("invalid domain")
        services = await self._request("GET", "/api/services")
        if not isinstance(services, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [{"domain": item["domain"], "services": list(item["services"])}
                for item in services if isinstance(item, dict) and isinstance(item.get("services"), dict)
                and isinstance(item.get("domain"), str)
                and (not domain or item["domain"] == domain)]

    async def call_service(self, domain: str, service: str, entity_id: str,
                           service_data: dict | None = None, *, return_response: bool = False) -> list[dict] | dict:
        if not self.allow_write:
            raise ValueError("Writes are disabled; set HA_ALLOW_WRITE=true to enable")
        if domain not in self.allowed_domains:
            raise ValueError("domain not allowed")
        if not IDENTIFIER.fullmatch(domain) or not IDENTIFIER.fullmatch(service) or not ENTITY.fullmatch(entity_id):
            raise ValueError("invalid domain, service, or entity_id")
        if not entity_id.startswith(domain + "."):
            raise ValueError("entity_id domain must match service domain")
        if service_data is None:
            service_data = {}
        if not isinstance(service_data, dict) or "entity_id" in service_data or "area_id" in service_data or "device_id" in service_data:
            raise ValueError("service_data must be an object without alternate targets")
        path = f"/api/services/{domain}/{service}"
        if return_response:
            path += "?return_response"
        return await self._request("POST", path,
                                   data={"entity_id": entity_id, **service_data})


def _audited_tool(server: FastMCP, client: HAClient):
    """Like server.tool(), plus one metadata-only audit record per call and the tool name for every
    HA request made during it (contextvar). Arguments and results are never logged."""
    from .audit import current_tool

    def decorator():
        def wrap(fn):
            @functools.wraps(fn)
            async def wrapper(*args, **kwargs):
                token, started, error = current_tool.set(fn.__name__), time.monotonic(), None
                try:
                    return await fn(*args, **kwargs)
                except Exception as exc:
                    error = type(exc).__name__
                    raise
                finally:
                    current_tool.reset(token)
                    if client.audit is not None:
                        try:
                            client.audit.record(kind="tool", tool=fn.__name__, ok=error is None,
                                                ms=(time.monotonic() - started) * 1000, error=error)
                        except Exception:  # noqa: BLE001
                            pass
            return server.tool()(wrapper)
        return wrap
    return decorator


def create_server(client: HAClient, *, allow_admin_write: bool = False,
                  allow_delete: bool = False, credentials=None) -> FastMCP:
    from .rest_api import RestGateway
    from .management import HAAdmin
    from .integrations import HAIntegrations

    rest = RestGateway(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    admin = HAAdmin(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    integrations = HAIntegrations(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                                  credentials=credentials or credential_store_from_env())
    server = FastMCP("ha-safe-mcp", instructions="Home Assistant REST bridge; writes disabled by default.")

    tool = _audited_tool(server, client)

    @tool()
    async def ha_search_entities(query: str = "", domain: str = "", limit: int = 50) -> list[dict]:
        """Search current entity IDs and friendly names, optionally filter by domain."""
        return await client.search_entities(query, domain, limit)

    @tool()
    async def ha_get_state(entity_id: str) -> dict:
        """Read the current state and attributes of one entity."""
        return await client.get_state(entity_id)

    @tool()
    async def ha_list_services(domain: str = "") -> list[dict]:
        """List action names for a domain; filter by domain to save context."""
        return await client.list_services(domain)

    @tool()
    async def ha_call_service(domain: str, service: str, entity_id: str,
                              service_data: dict | None = None) -> list[dict]:
        """Call an action for one entity; disabled unless HA_ALLOW_WRITE=true; only configured domains allowed."""
        return await client.call_service(domain, service, entity_id, service_data)

    @tool()
    async def ha_rest_catalog() -> list[dict]:
        """Discover the documented REST routes and their permission classes."""
        return rest.catalog()

    @tool()
    async def ha_rest_query(path: str, query: dict | None = None,
                            method: str = "GET", body: dict | None = None) -> dict:
        """Call a documented GET route or the safe POST template/config-check routes."""
        if method != "GET" and (method != "POST" or path not in {"/api/template", "/api/config/core/check_config"}):
            raise ValueError("query tool only supports GET or safe POST")
        return await rest.request(method, path, query=query, body=body)

    @tool()
    async def ha_rest_write(path: str, body: dict | None = None,
                            query: dict | None = None) -> dict:
        """POST a documented mutation. Requires HA_ALLOW_WRITE; admin routes need HA_ALLOW_ADMIN_WRITE."""
        return await rest.request("POST", path, body=body, query=query)

    @tool()
    async def ha_rest_delete(path: str) -> dict:
        """DELETE a documented state route. Requires HA_ALLOW_WRITE, HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE."""
        return await rest.request("DELETE", path)

    @tool()
    async def ha_validate_automation(config: dict) -> dict:
        """Ask Home Assistant to validate automation triggers, conditions and actions; no write."""
        return await admin.automation_validate(config)

    @tool()
    async def ha_get_automation(config_id: str) -> dict:
        """Read an automation's raw config by its configuration ID."""
        return await admin.automation_get(config_id)

    @tool()
    async def ha_save_automation(config_id: str, config: dict) -> dict:
        """Validate, create/update and read back automation config. Requires admin write opt-in."""
        return await admin.automation_save(config_id, config)

    @tool()
    async def ha_delete_automation(config_id: str) -> dict:
        """Delete an automation by config ID. Requires admin write and delete opt-ins."""
        return await admin.automation_delete(config_id)

    @tool()
    async def ha_list_dashboards() -> list[dict]:
        """List Lovelace dashboards and their URL paths."""
        return await admin.dashboard_list()

    @tool()
    async def ha_get_dashboard(url_path: str = "") -> dict:
        """Read the Lovelace config for a storage dashboard; blank path selects default."""
        return await admin.dashboard_get(url_path or None)

    @tool()
    async def ha_create_dashboard(title: str, url_path: str) -> dict:
        """Create a storage dashboard and verify it appears in list; admin write required."""
        return await admin.dashboard_create(title, url_path)

    @tool()
    async def ha_save_dashboard(config: dict, url_path: str = "") -> dict:
        """Save and read back dashboard views; returns prior config for manual rollback. Admin write required."""
        return await admin.dashboard_save(config, url_path=url_path or None)

    @tool()
    async def ha_list_helpers(domain: str) -> list[dict]:
        """List storage helpers; domain: input_boolean, input_number, input_select, input_text, input_datetime."""
        return await admin.helper_list(domain)

    @tool()
    async def ha_create_helper(domain: str, config: dict) -> dict:
        """Create a persistent helper entity and verify it appears in list. Admin write required."""
        return await admin.helper_create(domain, config)

    @tool()
    async def ha_update_helper(domain: str, helper_id: HelperId, config: dict) -> dict:
        """Update a storage helper by collection ID and read back. Admin write required."""
        return await admin.helper_update(domain, helper_id, config)

    @tool()
    async def ha_delete_helper(domain: str, helper_id: HelperId) -> None:
        """Delete a storage helper by collection ID; requires admin write and delete opt-ins."""
        return await admin.helper_delete(domain, helper_id)

    @tool()
    async def ha_update_dashboard(dashboard_id: str, changes: dict) -> dict:
        """Update dashboard title/icon/display metadata by collection ID. Admin write required."""
        return await admin.dashboard_update(dashboard_id, changes)

    @tool()
    async def ha_delete_dashboard(dashboard_id: str) -> None:
        """Delete a dashboard by collection ID. Admin write and delete required."""
        return await admin.dashboard_delete(dashboard_id)

    @tool()
    async def ha_list_entity_registry() -> list[dict]:
        """List registry entries for integration-managed entities; does not create entities."""
        return await admin.entity_registry_list()

    @tool()
    async def ha_update_entity_registry(entity_id: str, changes: dict) -> dict:
        """Edit entity name, area or icon; does not create an entity. Admin write required."""
        return await admin.entity_registry_update(entity_id, changes)

    @tool()
    async def ha_list_integrations(domain: str = "") -> list[dict]:
        """List configured integrations (config entries) with entry_id, domain, title and state."""
        return await integrations.list_entries(domain)

    @tool()
    async def ha_list_integration_types(query: str = "") -> list[str]:
        """List integration domains that can be set up through the UI flow, filtered by query (e.g. 'shelly')."""
        return await integrations.list_handlers(query)

    @tool()
    async def ha_list_discovered() -> list[dict]:
        """List devices Home Assistant itself discovered on its network (zeroconf/dhcp/ssdp/...) that wait
        for confirmation. This tool does not scan the network; an empty list means HA found nothing."""
        return await integrations.discovered_flows()

    @tool()
    async def ha_list_credentials() -> list[dict]:
        """List stored credential aliases and their field names (never values) for setup steps."""
        return integrations.credential_aliases()

    @tool()
    async def ha_start_integration_setup(handler: str, show_advanced_options: bool = False) -> dict:
        """Start adding an integration (e.g. handler 'shelly'); returns the first form (data_schema) with a
        flow_id. Admin write required."""
        return await integrations.start_flow(handler, show_advanced_options)

    @tool()
    async def ha_integration_setup_step(flow_id: FlowId, data: dict | None = None) -> dict:
        """Submit one form step of a setup flow, field names from data_schema; keep shown defaults unless the
        user said otherwise. Secret fields (password, token, api_key, pin) must be credential references:
        {"$credential": "<alias>", "field": "<field>"} from ha_list_credentials; plain secret values are rejected.
        For discovered devices send {} to confirm. If the setup cannot be finished, call
        ha_abort_integration_setup. Admin write required."""
        return await integrations.flow_step(flow_id, data)

    @tool()
    async def ha_abort_integration_setup(flow_id: FlowId) -> dict:
        """Abort a running setup flow. Admin write required."""
        return await integrations.abort_flow(flow_id)

    @tool()
    async def ha_reload_integration(entry_id: EntryId) -> dict:
        """Reload a configured integration by entry_id. Admin write required."""
        return await integrations.reload_entry(entry_id)

    @tool()
    async def ha_delete_integration(entry_id: EntryId) -> dict:
        """Remove a configured integration and its devices by entry_id. Admin write and delete required."""
        return await integrations.delete_entry(entry_id)

    return server


def main():
    load_dotenv()
    from .audit import audit_from_env
    domains = frozenset(x.strip() for x in os.getenv("HA_ALLOWED_DOMAINS", ",".join(sorted(DEFAULT_DOMAINS))).split(",") if x.strip())
    client = HAClient(os.getenv("HA_URL", "http://127.0.0.1:8123"), os.getenv("HA_TOKEN", ""),
                      allow_write=os.getenv("HA_ALLOW_WRITE", "false").lower() == "true",
                      allowed_domains=domains, audit=audit_from_env())
    create_server(client,
                  allow_admin_write=os.getenv("HA_ALLOW_ADMIN_WRITE", "false").lower() == "true",
                  allow_delete=os.getenv("HA_ALLOW_DELETE", "false").lower() == "true").run(transport="stdio")


if __name__ == "__main__":
    main()
