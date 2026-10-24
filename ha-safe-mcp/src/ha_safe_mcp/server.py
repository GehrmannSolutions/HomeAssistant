"""Safety-first standalone MCP bridge for Home Assistant's documented REST API."""

import functools
import os
import re
import time
from pathlib import Path
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from pydantic import Field

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
ENTITY = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")
MAX_TARGETS = 20
DEFAULT_DOMAINS = frozenset({"light", "switch", "fan", "climate", "cover", "media_player"})
HelperId = Annotated[str, Field(
    pattern=r"^[a-z][a-z0-9_]{0,63}$",
    description="Collection ID from ha_list_helpers (field 'id', lowercase, e.g. 'guest_mode'); "
                "not the display name and not the entity_id")]
FlowId = Annotated[str, Field(
    pattern=r"^(?:[0-9a-f]{32}|[0-9A-HJKMNP-TV-Z]{26})$",
    description="flow_id copied exactly from the previous ha_start_integration_setup/ha_integration_setup_step "
                "result or from ha_list_discovered")]
AreaId = Annotated[str, Field(
    pattern=r"^[a-z0-9_]{1,64}$", description="area_id from ha_list_areas (e.g. 'wohnzimmer'); not the area name")]
FloorId = Annotated[str, Field(
    pattern=r"^[a-z0-9_]{1,64}$", description="floor_id from ha_list_floors (e.g. 'erdgeschoss'); not the name")]
DeviceId = Annotated[str, Field(
    pattern=r"^[0-9a-f]{32}$|^[0-9A-HJKMNP-TV-Z]{26}$",
    description="device_id from ha_list_devices (32 hex characters); not the device name")]
SceneId = Annotated[str, Field(
    pattern=r"^[A-Za-z0-9_-]{1,64}$",
    description="scene_id: from ha_list_scenes (field scene_id) or a new id like 'abendlicht'; not the entity_id")]
ScriptId = Annotated[str, Field(
    pattern=r"^[a-z0-9_]{1,64}$",
    description="script_id: the part after 'script.' (e.g. 'gute_nacht'), lowercase, digits and _")]
BackupId = Annotated[str, Field(
    pattern=r"^[0-9a-z]{6,64}$",
    description="backup_id from ha_list_backups (e.g. 'a1b2c3d4'); not the backup name")]
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

    async def _request(self, method: str, path: str, *, data: dict | None = None, timeout: float = 15,
                       as_text: bool = False):
        started, status, error = time.monotonic(), None, None
        try:
            async with httpx.AsyncClient(base_url=self.url, timeout=timeout, trust_env=False,
                                         headers={"Authorization": f"Bearer {self.token}"}) as client:
                response = await client.request(method, path, json=data)
                status = response.status_code
                response.raise_for_status()
                return response.text if as_text else response.json()
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

    async def call_service(self, domain: str, service: str, entity_id: str | list[str],
                           service_data: dict | None = None, *, return_response: bool = False) -> list[dict] | dict:
        if not self.allow_write:
            raise ValueError("Writes are disabled; set HA_ALLOW_WRITE=true to enable")
        if domain not in self.allowed_domains:
            raise ValueError("domain not allowed")
        if not IDENTIFIER.fullmatch(domain) or not IDENTIFIER.fullmatch(service):
            raise ValueError("invalid domain, service, or entity_id")
        targets = [entity_id] if isinstance(entity_id, str) else entity_id
        if not isinstance(targets, list) or not targets:
            raise ValueError("entity_id must be one entity_id or a non-empty list")
        if len(targets) > MAX_TARGETS:
            raise ValueError(f"at most {MAX_TARGETS} entities per call")
        for target in targets:
            if not isinstance(target, str) or not ENTITY.fullmatch(target):
                raise ValueError("invalid domain, service, or entity_id")
            if not target.startswith(domain + "."):
                raise ValueError("entity_id domain must match service domain")
        targets = list(dict.fromkeys(targets))
        entity_id = targets[0] if len(targets) == 1 else targets
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
            from mcp.types import ToolAnnotations
            from .ollama_client import write_level
            level = write_level(fn.__name__)
            hints = ToolAnnotations(readOnlyHint=level is None, destructiveHint=level == "delete",
                                    openWorldHint=False)
            return server.tool(annotations=hints)(wrapper)
        return wrap
    return decorator


def create_server(client: HAClient, *, allow_admin_write: bool = False,
                  allow_delete: bool = False, credentials=None, journal=None) -> FastMCP:
    from .rest_api import RestGateway
    from .management import HAAdmin
    from .integrations import HAIntegrations
    from .backups import HABackups
    from .registry import HARegistry
    from .scenes import HAScenes
    from .changes import Changes, journal_from_env
    from .diagnostics import HADiagnostics

    rest = RestGateway(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    admin = HAAdmin(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    integrations = HAIntegrations(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                                  credentials=credentials or credential_store_from_env())
    scenes = HAScenes(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    registry = HARegistry(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    backups = HABackups(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                        credentials=integrations.credentials)
    diagnostics = HADiagnostics(client, admin.ws)
    changes = Changes(journal or journal_from_env(), admin=admin, scenes=scenes, registry=registry,
                      integrations=integrations)

    async def journaled(tool_name: str, kind: str, target, writer, **options):
        result, change_id = await changes.apply(tool_name, kind, target, writer, **options)
        return changes.with_change(result, change_id)

    async def dashboard_url(dashboard_id: str) -> str:
        found = next((d for d in await admin.dashboard_list() if d.get("id") == dashboard_id), None)
        if found is None:
            raise ValueError("unknown dashboard_id: pick one from ha_list_dashboards")
        return found["url_path"]

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
    async def ha_call_service(domain: str, service: str, entity_id: str | list[str],
                              service_data: dict | None = None) -> list[dict]:
        """Call an action (e.g. light.turn_on) for one entity_id or a list of up to 20 entity_ids of the same
        domain (e.g. all available lights of a room from ha_list_area_entities). Disabled unless
        HA_ALLOW_WRITE=true; only configured domains allowed."""
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
        return await journaled("ha_save_automation", "automation", config_id,
                               lambda: admin.automation_save(config_id, config))

    @tool()
    async def ha_delete_automation(config_id: str) -> dict:
        """Delete an automation by config ID. Requires admin write and delete opt-ins."""
        return await journaled("ha_delete_automation", "automation", config_id,
                               lambda: admin.automation_delete(config_id))

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
        return await journaled("ha_create_dashboard", "dashboard", url_path,
                               lambda: admin.dashboard_create(title, url_path))

    @tool()
    async def ha_save_dashboard(config: dict, url_path: str = "") -> dict:
        """Save and read back dashboard views; returns prior config for manual rollback. Admin write required."""
        return await journaled("ha_save_dashboard", "dashboard_config", url_path,
                               lambda: admin.dashboard_save(config, url_path=url_path or None))

    @tool()
    async def ha_list_helpers(domain: str) -> list[dict]:
        """List storage helpers; domain: input_boolean, input_number, input_select, input_text, input_datetime."""
        return await admin.helper_list(domain)

    @tool()
    async def ha_create_helper(domain: str, config: dict) -> dict:
        """Create a persistent helper entity and verify it appears in list. Admin write required."""
        return await journaled("ha_create_helper", "helper", None, lambda: admin.helper_create(domain, config),
                               target_from=lambda result: f"{domain}/{result['id']}")

    @tool()
    async def ha_update_helper(domain: str, helper_id: HelperId, config: dict) -> dict:
        """Update a storage helper by collection ID and read back. Admin write required."""
        admin._helper_id(domain, helper_id)
        return await journaled("ha_update_helper", "helper", f"{domain}/{helper_id}",
                               lambda: admin.helper_update(domain, helper_id, config))

    @tool()
    async def ha_delete_helper(domain: str, helper_id: HelperId) -> dict:
        """Delete a storage helper by collection ID; requires admin write and delete opt-ins."""
        admin._helper_id(domain, helper_id)
        return await journaled("ha_delete_helper", "helper", f"{domain}/{helper_id}",
                               lambda: admin.helper_delete(domain, helper_id))

    @tool()
    async def ha_update_dashboard(dashboard_id: str, changes: dict) -> dict:
        """Update dashboard title/icon/display metadata by collection ID. Admin write required."""
        return await journaled("ha_update_dashboard", "dashboard", await dashboard_url(dashboard_id),
                               lambda: admin.dashboard_update(dashboard_id, changes))

    @tool()
    async def ha_delete_dashboard(dashboard_id: str) -> dict:
        """Delete a dashboard by collection ID. Admin write and delete required."""
        return await journaled("ha_delete_dashboard", "dashboard", await dashboard_url(dashboard_id),
                               lambda: admin.dashboard_delete(dashboard_id))

    @tool()
    async def ha_list_entity_registry() -> list[dict]:
        """List registry entries for integration-managed entities; does not create entities."""
        return await admin.entity_registry_list()

    @tool()
    async def ha_update_entity_registry(entity_id: str, changes: dict) -> dict:
        """Edit entity name, area or icon; does not create an entity. Admin write required."""
        fields = list(changes) if isinstance(changes, dict) else None
        return await journaled("ha_update_entity_registry", "entity", entity_id,
                               lambda: admin.entity_registry_update(entity_id, changes), fields=fields)

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
    async def ha_start_integration_options(entry_id: EntryId, show_advanced_options: bool = False) -> dict:
        """Open the settings (options) of a configured integration whose supports_options is true; returns a form
        with current values as defaults and a flow_id. Admin write required."""
        return await integrations.start_options(entry_id, show_advanced_options)

    @tool()
    async def ha_integration_options_step(flow_id: FlowId, data: dict | None = None) -> dict:
        """Submit one options form step; keep shown defaults unless the user wants them changed. Secret fields only
        as credential references. Admin write required."""
        return await integrations.options_step(flow_id, data)

    @tool()
    async def ha_abort_integration_options(flow_id: FlowId) -> dict:
        """Abort an options flow without saving. Admin write required."""
        return await integrations.abort_options(flow_id)

    @tool()
    async def ha_start_integration_reconfigure(entry_id: EntryId, show_advanced_options: bool = False) -> dict:
        """Reconfigure the connection of an integration whose supports_reconfigure is true (e.g. new host/IP);
        continue with ha_integration_setup_step. Admin write required."""
        return await integrations.start_reconfigure(entry_id, show_advanced_options)

    @tool()
    async def ha_update_integration(entry_id: EntryId, changes: dict) -> dict:
        """Rename an integration entry or change its system options: changes may contain title,
        pref_disable_polling, pref_disable_new_entities. Admin write required."""
        fields = list(changes) if isinstance(changes, dict) else None
        return await journaled("ha_update_integration", "integration", entry_id,
                               lambda: integrations.update_entry(entry_id, changes), fields=fields)

    @tool()
    async def ha_set_integration_disabled(entry_id: EntryId, disabled: bool) -> dict:
        """Disable (true) or re-enable (false) an integration entry; its entities become unavailable while
        disabled. Admin write required."""
        return await journaled("ha_set_integration_disabled", "integration", entry_id,
                               lambda: integrations.set_entry_disabled(entry_id, disabled), fields=["disabled_by"])

    @tool()
    async def ha_reload_integration(entry_id: EntryId) -> dict:
        """Reload a configured integration by entry_id. Admin write required."""
        return await integrations.reload_entry(entry_id)

    @tool()
    async def ha_delete_integration(entry_id: EntryId) -> dict:
        """Remove a configured integration and its devices by entry_id. Admin write and delete required."""
        return await integrations.delete_entry(entry_id)

    @tool()
    async def ha_list_scenes() -> list[dict]:
        """List scenes with entity_id, name, scene_id (editable when set) and the entities they control."""
        return await scenes.list_scenes()

    @tool()
    async def ha_get_scene(scene_id: SceneId) -> dict:
        """Read a UI scene's stored config (name, entities with target states)."""
        return await scenes.get_scene(scene_id)

    @tool()
    async def ha_save_scene(scene_id: SceneId, config: dict) -> dict:
        """Create or replace a scene: config {"name": "Abendlicht", "entities": {"light.flur": {"state": "on",
        "brightness": 120}}}. Use real entity_ids from ha_search_entities. Returns previous config for rollback.
        Admin write required."""
        return await journaled("ha_save_scene", "scene", scene_id, lambda: scenes.save_scene(scene_id, config))

    @tool()
    async def ha_delete_scene(scene_id: SceneId) -> dict:
        """Delete a UI scene by scene_id. Admin write and delete required."""
        return await journaled("ha_delete_scene", "scene", scene_id, lambda: scenes.delete_scene(scene_id))

    @tool()
    async def ha_activate_scene(entity_id: str) -> list:
        """Activate a scene (scene.turn_on), e.g. entity_id 'scene.abendlicht'. Needs write and 'scene' in the
        allowed domains."""
        return await scenes.activate_scene(entity_id)

    @tool()
    async def ha_list_scripts() -> list[dict]:
        """List scripts with entity_id, name, script_id, running state and last run."""
        return await scenes.list_scripts()

    @tool()
    async def ha_get_script(script_id: ScriptId) -> dict:
        """Read a UI script's stored config (alias, sequence, mode, ...)."""
        return await scenes.get_script(script_id)

    @tool()
    async def ha_save_script(script_id: ScriptId, config: dict) -> dict:
        """Create or replace a script: config {"alias": "Gute Nacht", "sequence": [{"action": "light.turn_off",
        "target": {"entity_id": "light.flur"}}], "mode": "single"}. HA validates the sequence first. Returns
        previous config for rollback. Admin write required."""
        return await journaled("ha_save_script", "script", script_id, lambda: scenes.save_script(script_id, config))

    @tool()
    async def ha_delete_script(script_id: ScriptId) -> dict:
        """Delete a UI script by script_id. Admin write and delete required."""
        return await journaled("ha_delete_script", "script", script_id, lambda: scenes.delete_script(script_id))

    @tool()
    async def ha_run_script(entity_id: str) -> list:
        """Start a script (script.turn_on), e.g. 'script.gute_nacht'. Needs write and 'script' in the allowed
        domains."""
        return await scenes.run_script(entity_id)

    @tool()
    async def ha_list_areas() -> list[dict]:
        """List areas (rooms) with area_id, name, floor_id, icon and aliases."""
        return await registry.list_areas()

    @tool()
    async def ha_list_floors() -> list[dict]:
        """List floors with floor_id, name and level."""
        return await registry.list_floors()

    @tool()
    async def ha_list_area_entities(area: str, domain: str = "") -> dict:
        """Entities of one room: area may be the area_id, its name or an alias (e.g. 'Wohnzimmer'). Follows the
        device's area like HA does. Returns available/unavailable entity_ids, the entities with state, and groups
        whose members are in the room. Optional domain filter, e.g. 'light'."""
        return await registry.list_area_entities(area, domain)

    @tool()
    async def ha_list_devices(area_id: str = "", query: str = "", limit: int = 200) -> list[dict]:
        """List devices with device_id, name, manufacturer, model and area_id. Filter by area_id, or
        area_id='none' for devices without an area; query matches name/manufacturer/model."""
        return await registry.list_devices(area_id, query, limit)

    @tool()
    async def ha_create_area(name: str, floor_id: str | None = None, icon: str | None = None) -> dict:
        """Create an area (room), e.g. name 'Flur', icon 'mdi:door'; returns its area_id. Admin write required."""
        return await journaled("ha_create_area", "area", None, lambda: registry.create_area(name, floor_id, icon),
                               target_from=lambda result: result["area_id"])

    @tool()
    async def ha_update_area(area_id: AreaId, changes: dict) -> dict:
        """Change an area's name, floor_id, icon or aliases and read back. Admin write required."""
        return await journaled("ha_update_area", "area", area_id, lambda: registry.update_area(area_id, changes))

    @tool()
    async def ha_delete_area(area_id: AreaId) -> dict:
        """Delete an area; its devices and entities stay and lose the area. Admin write and delete required."""
        return await journaled("ha_delete_area", "area", area_id, lambda: registry.delete_area(area_id))

    @tool()
    async def ha_create_floor(name: str, level: int | None = None, icon: str | None = None) -> dict:
        """Create a floor, e.g. name 'Erdgeschoss', level 0. Admin write required."""
        return await journaled("ha_create_floor", "floor", None, lambda: registry.create_floor(name, level, icon),
                               target_from=lambda result: result["floor_id"])

    @tool()
    async def ha_update_floor(floor_id: FloorId, changes: dict) -> dict:
        """Change a floor's name, level, icon or aliases and read back. Admin write required."""
        return await journaled("ha_update_floor", "floor", floor_id, lambda: registry.update_floor(floor_id, changes))

    @tool()
    async def ha_delete_floor(floor_id: FloorId) -> dict:
        """Delete a floor; its areas stay without floor. Admin write and delete required."""
        return await journaled("ha_delete_floor", "floor", floor_id, lambda: registry.delete_floor(floor_id))

    @tool()
    async def ha_update_device(device_id: DeviceId, changes: dict) -> dict:
        """Assign a device to an area or rename/disable it: changes may contain area_id (or null),
        name_by_user (or null to reset), disabled_by ('user' or null), labels. Admin write required.
        Removing devices is not offered (delete the integration instead)."""
        fields = list(changes) if isinstance(changes, dict) else None
        return await journaled("ha_update_device", "device", device_id,
                               lambda: registry.update_device(device_id, changes), fields=fields)

    @tool()
    async def ha_list_backups() -> dict:
        """List Home Assistant backups (newest first) with backup_id, name, date, size and storage agents."""
        return await backups.list_backups()

    @tool()
    async def ha_create_backup(name: str, password: dict | None = None) -> dict:
        """Create a full backup (configuration + database) on the local backup agent and wait until it is
        listed. Optional encryption password only as credential reference {"$credential": "<alias>",
        "field": "password"}. Admin write required. Restoring is not available through this MCP."""
        return await backups.create_backup(name, password)

    @tool()
    async def ha_delete_backup(backup_id: BackupId) -> dict:
        """Delete one backup by backup_id from ha_list_backups. Admin write and delete required."""
        return await backups.delete_backup(backup_id)

    @tool()
    async def ha_list_traces(domain: str = "automation", item: str = "", limit: int = 20) -> list[dict]:
        """Recent runs (traces) of automations or scripts, newest first: run_id, state, error, last_step, trigger.
        domain 'automation' or 'script'; item = entity_id (e.g. 'automation.morning_light') or empty for all.
        Use it to find out why an automation did or did not run; then ha_get_trace for details."""
        return await diagnostics.list_traces(domain, item, limit)

    @tool()
    async def ha_get_trace(domain: str, item: str, run_id: str, include_config: bool = False) -> dict:
        """Steps of one automation/script run from ha_list_traces: each step's path, error, result and changed
        variables (shortened). include_config=true adds the configuration as it was at that run."""
        return await diagnostics.get_trace(domain, item, run_id, include_config)

    @tool()
    async def ha_get_error_log(level: str = "", query: str = "", limit: int = 30) -> list[dict]:
        """Home Assistant's error/warning log (system log), newest first, deduplicated with count. Filter by
        level ('ERROR', 'WARNING', ...) and/or text (integration name, message). Needs an HA admin user."""
        return await diagnostics.error_log(level, query, limit)

    @tool()
    async def ha_get_logbook(entity_id: str = "", hours: float = 24, start: str = "", end: str = "",
                             limit: int = 100) -> list[dict]:
        """Logbook: what happened and what caused it (state changes, automation triggers, service calls) in the
        last `hours` (or start/end ISO time), optionally for entity_id (comma list allowed); oldest first, last
        `limit` entries."""
        return await diagnostics.logbook(entity_id, hours, start, end, limit)

    @tool()
    async def ha_get_history(entity_ids: list[str], hours: float = 24, start: str = "", end: str = "",
                             max_points: int = 200) -> dict:
        """State history of 1-10 entities over the last `hours` (or start/end ISO time): per entity the state
        changes with time (in Home Assistant's time zone), newest `max_points` kept. For long periods of numeric
        sensors prefer ha_get_statistics."""
        return await diagnostics.history(entity_ids, hours, start, end, max_points)

    @tool()
    async def ha_get_statistics(statistic_ids: list[str], hours: float = 24, start: str = "", end: str = "",
                                period: str = "hour", types: list[str] | None = None, max_points: int = 200) -> dict:
        """Long-term statistics (energy, temperatures, ...) aggregated per period ('5minute', 'hour', 'day',
        'week', 'month'); types any of mean, min, max, sum, state, change. IDs from ha_list_statistic_ids."""
        return await diagnostics.statistics(statistic_ids, hours, start, end, period, types, max_points)

    @tool()
    async def ha_list_statistic_ids(query: str = "", limit: int = 100) -> list[dict]:
        """Which entities have long-term statistics, with unit and whether they have sum (meters) or mean."""
        return await diagnostics.list_statistic_ids(query, limit)

    @tool()
    async def ha_list_repairs(include_ignored: bool = False) -> list[dict]:
        """Open repair issues Home Assistant reports (Settings → Repairs): domain, issue_id, severity, fixable."""
        return await diagnostics.repairs(include_ignored)

    @tool()
    async def ha_get_system_health() -> dict:
        """System health per component (version, installation type, database, cloud reachability, ...)."""
        return await diagnostics.system_health()

    @tool()
    async def ha_render_template(template: str, variables: dict | None = None) -> dict:
        """Render a Jinja template against the live state, e.g. \"{{ states('sun.sun') }}\" or
        \"{{ states.light | selectattr('state','eq','on') | list | count }}\". Read-only; needs an HA admin user."""
        return await diagnostics.render_template(template, variables)

    @tool()
    async def ha_test_condition(condition: dict | list, variables: dict | None = None) -> dict:
        """Test an automation condition right now without saving anything, e.g. {"condition": "state",
        "entity_id": "light.hallway", "state": "on"} or {"condition": "time", "after": "22:00:00"}."""
        return await diagnostics.test_condition(condition, variables)

    @tool()
    async def ha_list_changes(kind: str = "", target: str = "", limit: int = 20) -> list[dict]:
        """List recent configuration changes made through this MCP (newest first, kept 30 days) with change_id,
        tool, kind (automation, script, scene, dashboard, dashboard_config, helper, entity, area, floor, device,
        integration), target and whether it was undone. Use the change_id with ha_undo_change."""
        return changes.journal.entries(kind=kind, target=target, limit=limit)

    @tool()
    async def ha_get_change(change_id: str) -> dict:
        """Show one journaled change including the stored previous state ('before'; null = did not exist)."""
        return changes.journal.get(change_id)

    @tool()
    async def ha_undo_change(change_id: str, force: bool = False) -> dict:
        """Undo one configuration change from ha_list_changes: writes the stored previous state back (removes a
        created item, recreates a deleted one). The undo is journaled too and can itself be undone. If newer changes
        to the same item exist it refuses; undo newest first, force=true only when the user wants to overwrite them.
        Needs the same permissions as the original change (admin write; delete when the undo removes something)."""
        return await changes.undo(change_id, force=force)

    return server


def main():
    # Read only the selected instance's settings, never walk parent directories for .env.
    load_dotenv(dotenv_path=Path.cwd() / ".env")
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
