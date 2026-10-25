"""Safety-first standalone MCP bridge for Home Assistant's documented REST API."""

import asyncio
import functools
import json
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
        # German domain names ("Sonne", "Rollläden") find entities whose IDs and names are English (sun.sun)
        from .domains import DOMAIN_INFO
        label_domains = {d for d, names in DOMAIN_INFO.items() if len(needle) >= 3
                         and any(needle in label.casefold() for label, _ in names.values())}
        return [{"entity_id": state["entity_id"], "state": state.get("state", ""),
                 "friendly_name": str(state.get("attributes", {}).get("friendly_name", ""))}
                for state in states if isinstance(state, dict) and isinstance(state.get("entity_id"), str)
                and isinstance(state.get("attributes", {}), dict)
                and (not domain or state["entity_id"].startswith(domain + "."))
                and (needle in state["entity_id"].casefold()
                     or needle in str(state["attributes"].get("friendly_name", "")).casefold()
                     or state["entity_id"].split(".", 1)[0] in label_domains)][:limit]

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


READ_BACK_DELAYS = (0.4, 0.8, 1.5)  # seconds between read-backs after an action (about 3 s in total)
KEY_ATTRIBUTES = ("brightness", "color_temp_kelvin", "current_position", "current_tilt_position", "temperature",
                  "hvac_action", "percentage", "volume_level")
ON_OFF_DOMAINS = frozenset({"light", "switch", "fan", "input_boolean", "siren", "humidifier", "remote"})


def expected_states(domain: str, service: str, data) -> set[str] | None:
    """States that confirm an action; None when an action has no single expected result (toggle, set values)."""
    if domain in ON_OFF_DOMAINS:
        return {"turn_on": {"on"}, "turn_off": {"off"}}.get(service)
    if domain == "cover":
        return {"open_cover": {"open", "opening"}, "close_cover": {"closed", "closing"}}.get(service)
    if domain == "lock":
        return {"lock": {"locked", "locking"}, "unlock": {"unlocked", "unlocking", "open"}}.get(service)
    if domain == "media_player":
        return {"turn_off": {"off"}, "media_pause": {"paused"}, "media_play": {"playing"}}.get(service)
    if domain == "climate":
        if service == "set_hvac_mode" and isinstance(data, dict) and isinstance(data.get("hvac_mode"), str):
            return {data["hvac_mode"]}
        return {"turn_off": {"off"}}.get(service)
    return None


async def read_back(client: HAClient, domain: str, service: str, entity_id, data) -> dict:
    """Read the targets after an action until they show the expected state (or about 3 s passed)."""
    targets = [entity_id] if isinstance(entity_id, str) else list(dict.fromkeys(entity_id))
    expected = expected_states(domain, service, data)
    states: dict[str, dict] = {}
    for delay in (0,) + tuple(READ_BACK_DELAYS):
        if delay:
            await asyncio.sleep(delay)
        for target in targets:
            if target in states and expected is not None and states[target].get("state") in expected:
                continue
            try:
                states[target] = await client._request("GET", f"/api/states/{target}")
            except RuntimeError:
                states[target] = {"state": "unknown"}
        if expected is None or all(states[t].get("state") in expected for t in targets):
            break
    after = []
    for target in targets:
        current = states[target]
        attributes = current.get("attributes") or {}
        after.append({"entity_id": target, "state": current.get("state"),
                      "confirmed": None if expected is None else current.get("state") in expected,
                      **{key: attributes[key] for key in KEY_ATTRIBUTES if attributes.get(key) is not None}})
    confirmed = None if expected is None else all(item["confirmed"] for item in after)
    result = {"states_after": after, "all_confirmed": confirmed}
    if confirmed is False:
        result["hint"] = ("not confirmed: some devices did not report the expected state within about 3 s (still "
                          "moving, slow or offline). Tell the user what was reported instead of claiming success.")
    return result


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
    from .energy import HAEnergy
    from .removal import HARemoval
    from .assist import HAAssist
    from .hacs import HAHacs
    from .registry import HARegistry
    from .scenes import HAScenes
    from .changes import Changes, journal_from_env
    from .diagnostics import HADiagnostics
    from .organize import HAOrganizer
    from .planner import HAPlanner
    from .system import HASystem
    from .customize import HACustomize
    from .weather import HAWeather
    from .ecosystem import HAEcosystem
    from .config_files import ConfigFiles, mask
    from .overview import HAOverview

    rest = RestGateway(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    admin = HAAdmin(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    integrations = HAIntegrations(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                                  credentials=credentials or credential_store_from_env())
    scenes = HAScenes(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    registry = HARegistry(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    organizer = HAOrganizer(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    planner = HAPlanner(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    system = HASystem(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    customize = HACustomize(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    weather = HAWeather(client)
    ecosystem = HAEcosystem(client, admin.ws)
    config_files = ConfigFiles(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                               checker=system.check_config)
    backups = HABackups(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete,
                        credentials=integrations.credentials)
    diagnostics = HADiagnostics(client, admin.ws)
    energy = HAEnergy(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    assist = HAAssist(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    hacs = HAHacs(client, admin.ws, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    overview = HAOverview(client, admin.ws, admin=admin, scenes=scenes, integrations=integrations)
    removal = HARemoval(client, admin.ws, overview=overview, allow_admin_write=allow_admin_write,
                        allow_delete=allow_delete)
    changes = Changes(journal or journal_from_env(), admin=admin, scenes=scenes, registry=registry,
                      integrations=integrations, organizer=organizer, customize=customize,
                      config_files=config_files, energy=energy, assist=assist, hacs=hacs)

    async def journaled(tool_name: str, kind: str, target, writer, **options):
        result, change_id = await changes.apply(tool_name, kind, target, writer, **options)
        return changes.with_change(result, change_id)

    def journal_created(tool_name: str, result: dict) -> dict:
        entry_id = (result.get("entry") or {}).get("entry_id") if isinstance(result, dict) else None
        if result.get("type") == "create_entry" and isinstance(entry_id, str):
            return {**result, "change_id": changes.record_created("integration", entry_id, tool_name)}
        return result

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
                              service_data: dict | None = None, return_response: bool = False) -> dict:
        """Call an action (e.g. light.turn_on) for one entity_id or a list of up to 20 entity_ids of the same
        domain (e.g. all available lights of a room from ha_list_area_entities). Returns states_after: the targets
        read back after the call with confirmed true/false (false = expected state not reached; report that, do not
        claim success). return_response=true returns the data of services that answer (e.g. todo.get_items).
        Disabled unless HA_ALLOW_WRITE=true; only configured domains allowed."""
        response = await client.call_service(domain, service, entity_id, service_data,
                                             return_response=bool(return_response))
        result = await read_back(client, domain, service, entity_id, service_data)
        if return_response:
            answer = response.get("service_response") if isinstance(response, dict) else None
            text = json.dumps(answer, default=str)
            result = {"service_response": answer if len(text) <= 8000 else text[:8000],
                      **({"service_response_truncated": True} if len(text) > 8000 else {}), **result}
        return result

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
        """List storage helpers of one domain: input_boolean, input_number, input_select, input_text,
        input_datetime, input_button, counter, timer, schedule. Config-flow helpers: ha_list_helper_types."""
        return await admin.helper_list(domain)

    @tool()
    async def ha_create_helper(domain: str, config: dict) -> dict:
        """Create a storage helper and verify it appears in the list. domain and config: input_boolean {name},
        input_number {name, min, max, step?, mode?}, input_select {name, options}, input_text {name},
        input_datetime {name, has_date, has_time}, input_button {name}, counter {name, initial?, step?, minimum?,
        maximum?}, timer {name, duration 'HH:MM:SS'}, schedule {name, monday..sunday: [{from, to}]}; icon optional.
        Template, group, utility meter and other helpers are config flows (ha_list_helper_types). Admin write
        required."""
        return await journaled("ha_create_helper", "helper", None, lambda: admin.helper_create(domain, config),
                               target_from=lambda result: f"{domain}/{result['id']}")

    @tool()
    async def ha_list_helper_types() -> dict:
        """Which helper types exist and how to create them: storage helpers (ha_create_helper) and config-flow
        helpers such as template, group, utility_meter, derivative, threshold, tod (setup flow), plus the existing
        config-flow helpers with entry_id."""
        return await integrations.list_helper_types()

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
    async def ha_get_entity_registry(entity_id: str) -> dict:
        """One entity's registry entry: name, icon, area, labels, categories, aliases (voice assistant names),
        disabled/hidden state, platform. Entities without a unique ID are not in the registry."""
        entry = await admin.entity_registry_get(entity_id)
        if entry is None:
            raise ValueError("entity not in the entity registry (no unique ID) or unknown")
        return entry

    @tool()
    async def ha_update_entity_registry(entity_id: str, changes: dict) -> dict:
        """Edit an entity's registry entry; does not create entities. changes may contain: name (null = name from
        the integration), icon, area_id (null = follow the device), aliases (complete list of names for voice
        assistants; a null entry stands for the entity's own name, keep it), labels (complete list of label_ids), categories ({scope: category_id or null}, e.g.
        {"automation": "<id>"} to file an automation), disabled_by / hidden_by ('user' or null). Admin write
        required. To change the entity_id use ha_rename_entity."""
        fields = list(changes) if isinstance(changes, dict) else None
        return await journaled("ha_update_entity_registry", "entity", entity_id,
                               lambda: admin.entity_registry_update(entity_id, changes), fields=fields)

    @tool()
    async def ha_rename_entity(entity_id: str, new_entity_id: str) -> dict:
        """Change an entity_id within its domain (light.x -> light.y); HA keeps its history. Automations, scripts
        and dashboards that use the old ID are NOT updated: the result lists them under references_to_old_id.
        Admin write required."""
        result = await journaled("ha_rename_entity", "entity", entity_id,
                                 lambda: admin.entity_rename(entity_id, new_entity_id), fields=["new_entity_id"],
                                 target_from=lambda renamed: renamed["entity_id"])
        try:
            usages = await overview.find_usages(entity_id)
            result["references_to_old_id"] = [{key: match[key] for key in ("kind", "id", "name")}
                                              for match in usages["matches"]]
        except (RuntimeError, ValueError) as exc:
            result["references_to_old_id"] = f"not checked: {exc}"
        return result

    @tool()
    async def ha_list_config_files(path: str = "") -> dict:
        """List a folder of the Home Assistant config directory ('' = top level, e.g. 'packages'): files with size
        and whether they can be read, sub-folders. Hidden folders (.storage) are not shown."""
        return await config_files.list(path)

    @tool()
    async def ha_read_config_file(path: str) -> dict:
        """Read a text file of the HA config directory, e.g. 'configuration.yaml', 'packages/heating.yaml',
        'custom_components/x/sensor.py'. Inline credentials appear as __REDACTED_n__ placeholders; keep them unchanged
        when editing. secrets.yaml, .storage, databases and logs are never readable."""
        return await config_files.read(path)

    @tool()
    async def ha_edit_config_file(path: str, old_text: str, new_text: str, replace_all: bool = False) -> dict:
        """Replace old_text (copied exactly from ha_read_config_file, unique unless replace_all) with new_text in a
        config file. YAML is syntax-checked and HA's config check runs; a change that adds errors is reverted.
        Journaled (undo with ha_undo_change). Not active until ha_reload or ha_restart. Admin write required."""
        return await journaled("ha_edit_config_file", "file", path,
                               lambda: config_files.edit(path, old_text, new_text, replace_all))

    @tool()
    async def ha_write_config_file(path: str, content: str) -> dict:
        """Create a config file or replace its whole content (e.g. a new package 'packages/x.yaml'; packages need
        'homeassistant: packages: !include_dir_named packages' in configuration.yaml). Keep __REDACTED_n__
        placeholders; new credentials go into secrets.yaml (by the user) and are referenced with !secret. Same checks,
        journal and activation as ha_edit_config_file. Admin write required."""
        return await journaled("ha_write_config_file", "file", path, lambda: config_files.write(path, content))

    @tool()
    async def ha_delete_config_file(path: str) -> dict:
        """Delete a config file (journaled, undo restores it). Admin write and delete required."""
        return await journaled("ha_delete_config_file", "file", path, lambda: config_files.delete(path))

    @tool()
    async def ha_list_addons() -> list[dict]:
        """Installed add-ons (Supervisor installs) with state (started/stopped), version and pending updates; empty
        without a Supervisor."""
        return await ecosystem.list_addons()

    @tool()
    async def ha_get_system_info() -> dict:
        """Versions of Core, Supervisor and OS with pending updates, Supervisor health, board and disk usage
        (Supervisor installs). No network details."""
        return await ecosystem.system_info()

    @tool()
    async def ha_list_hacs_repositories(installed_only: bool = True) -> dict:
        """What is ALREADY INSTALLED through HACS (custom integrations, cards, themes) with installed/available
        version and pending upgrades. To find something new in the store (a card that does X), use ha_search_hacs."""
        return await ecosystem.list_hacs(installed_only)

    @tool()
    async def ha_search_hacs(query: str = "", category: str = "", limit: int = 20,
                             installed_only: bool = False) -> dict:
        """Search the HACS store (custom integrations, dashboard cards = category 'plugin', themes, ...) by words in
        name, description and topics (at least half of the words must match; fill words like 'card' are ignored).
        Repositories whose name has all words come first, then the most GitHub stars. The store is in English:
        translate the user's words into short English search words (e.g. 'Verlaufsgraph' -> 'graph'). Read only."""
        return await hacs.search(query, category, limit, installed_only)

    @tool()
    async def ha_get_hacs_repository(repository: str) -> dict:
        """One HACS repository ('owner/repo' or id) with stars, last update, releases, installed version and what
        installing it means (install_impact). Show this to the user before installing. Read only."""
        return await hacs.get(repository)

    @tool()
    async def ha_install_hacs_repository(repository: str, version: str = "") -> dict:
        """Install or update a HACS repository ('owner/repo' or id; version = a release tag, default the newest).
        Downloads third-party code into Home Assistant. Cards are registered as dashboard resource by HACS;
        integrations need ha_restart. Journaled: undo removes a new install or goes back to the previous version.
        Admin write required."""
        return await journaled("ha_install_hacs_repository", "hacs", repository,
                               lambda: hacs.install(repository, version or None),
                               target_from=lambda r: r["full_name"])

    @tool()
    async def ha_remove_hacs_repository(repository: str) -> dict:
        """Remove an installed HACS repository (its files; a card left in a dashboard shows an error). Journaled,
        undo reinstalls the same version. Admin write and delete required."""
        return await journaled("ha_remove_hacs_repository", "hacs", repository, lambda: hacs.remove(repository),
                               target_from=lambda r: r["full_name"])

    @tool()
    async def ha_add_hacs_custom_repository(repository: str, category: str) -> dict:
        """Add a GitHub repository that is not in the HACS store ('owner/repo' or https://github.com/owner/repo;
        category: integration, plugin, theme, python_script, template, appdaemon, netdaemon). Only adds it to the
        list; install with ha_install_hacs_repository. Admin write required."""
        return await hacs.add_custom(repository, category)

    @tool()
    async def ha_list_zigbee_devices(problems_only: bool = False) -> dict:
        """Zigbee (ZHA) devices with availability, link quality (lqi), rssi, last seen and role; counts of
        unavailable and weak devices. problems_only=true lists only those. No device addresses."""
        return await ecosystem.zigbee_devices(problems_only)

    @tool()
    async def ha_list_thread_networks() -> list[dict]:
        """Thread networks known to Home Assistant (name, channel, preferred, source). No network keys or IDs."""
        return await ecosystem.thread_networks()

    @tool()
    async def ha_get_weather_forecast(entity_id: str = "", type: str = "daily", limit: int = 10,
                                      day: str = "") -> dict:
        """Weather now and the forecast (type 'daily', 'hourly' or 'twice_daily') of a weather entity (default: the
        first one); times in Home Assistant's time zone, each entry labelled with its day ('today', 'tomorrow',
        weekday). For a question about one day pass day='today', 'tomorrow' or 'YYYY-MM-DD'. Read-only."""
        return await weather.forecast(entity_id, type, limit, day)

    @tool()
    async def ha_list_blueprints(domain: str = "automation") -> list[dict]:
        """Blueprints of a domain ('automation', 'script', 'template') with path, name, inputs and source_url.
        Use one in an automation with {"use_blueprint": {"path": ..., "input": {...}}} via ha_save_automation."""
        return await customize.list_blueprints(domain)

    @tool()
    async def ha_preview_blueprint(url: str) -> dict:
        """Let Home Assistant fetch a blueprint from an https URL and show name, inputs, validation errors and the
        YAML without saving it. Admin write required."""
        return await customize.preview_blueprint(url)

    @tool()
    async def ha_save_blueprint(url: str, path: str | None = None) -> dict:
        """Import a blueprint from an https URL and save it (default path as suggested by HA; existing blueprints are
        not overwritten). Journaled: undo deletes it again. Admin write required."""
        return await journaled("ha_save_blueprint", "blueprint", None, lambda: customize.save_blueprint(url, path),
                               target_from=lambda saved: f"{saved['domain']}/{saved['path']}")

    @tool()
    async def ha_delete_blueprint(domain: str, path: str) -> dict:
        """Delete a blueprint (HA refuses while automations or scripts use it); undo re-imports it from its
        source_url. Admin write and delete required."""
        return await journaled("ha_delete_blueprint", "blueprint", f"{domain}/{path}",
                               lambda: customize.delete_blueprint(domain, path))

    @tool()
    async def ha_list_themes() -> dict:
        """Installed frontend themes and the default (dark) theme."""
        return await customize.list_themes()

    @tool()
    async def ha_set_theme(name: str, mode: str = "light") -> dict:
        """Set the default frontend theme for light or dark mode ('default' resets light mode, 'none' clears the
        dark theme). Journaled. Admin write required."""
        return await journaled("ha_set_theme", "theme", mode if mode in ("light", "dark") else "light",
                               lambda: customize.set_theme(name, mode))

    @tool()
    async def ha_list_dashboard_resources() -> list[dict]:
        """Dashboard resources (custom cards: JavaScript/CSS files loaded by the frontend) with id, url and type."""
        return await customize.list_resources()

    @tool()
    async def ha_add_dashboard_resource(url: str, res_type: str = "module") -> dict:
        """Register a custom card file served by this Home Assistant ('/local/...' or '/hacsfiles/...'; external
        URLs are refused because resources run in every user's browser). Journaled. Admin write required."""
        return await journaled("ha_add_dashboard_resource", "resource", None,
                               lambda: customize.add_resource(url, res_type), target_from=lambda added: added["id"])

    @tool()
    async def ha_delete_dashboard_resource(resource_id: str) -> dict:
        """Remove a dashboard resource (undo registers it again). Admin write and delete required."""
        return await journaled("ha_delete_dashboard_resource", "resource", resource_id,
                               lambda: customize.delete_resource(resource_id))

    @tool()
    async def ha_fire_event(event_type: str, event_data: dict | None = None) -> dict:
        """Fire a custom event, e.g. 'doorbell_pressed' with event_data {"door": "front"}; automations with an
        event trigger react to it. Events Home Assistant emits itself (state_changed, homeassistant_start, ...) are
        refused. Admin write required."""
        return await system.fire_event(event_type, event_data)

    @tool()
    async def ha_list_updates(pending_only: bool = True) -> list[dict]:
        """Updates (firmware, integrations, add-ons, HA itself) with installed and latest version; by default only
        pending ones."""
        return await system.list_updates(pending_only)

    @tool()
    async def ha_get_release_notes(entity_id: str) -> dict:
        """Release notes of one update entity (capped), if the integration provides them."""
        return await system.release_notes(entity_id)

    @tool()
    async def ha_check_config() -> dict:
        """Check Home Assistant's configuration files (result valid/invalid with errors and warnings); changes
        nothing. Use before a restart or after YAML edits."""
        return await system.check_config()

    @tool()
    async def ha_reload(target: str) -> dict:
        """Reload configuration without a restart: target 'all', 'core' (core config) or a domain with a reload
        service such as 'automation', 'script', 'scene', 'template', 'group'. Admin write required."""
        return await system.reload(target)

    @tool()
    async def ha_skip_update(entity_id: str, clear: bool = False) -> dict:
        """Skip the offered version of an update (clear=true offers it again). Admin write required."""
        return await system.skip_update(entity_id, clear)

    @tool()
    async def ha_install_update(entity_id: str, version: str | None = None, backup: bool = False) -> dict:
        """Install an update (entity from ha_list_updates); backup=true asks the integration to back up first
        (where supported). Far-reaching: needs the delete level; the user should have read the release notes."""
        return await system.install_update(entity_id, version, backup)

    @tool()
    async def ha_restart(safe_mode: bool = False) -> dict:
        """Restart Home Assistant after a successful configuration check (refused when it reports errors).
        Interrupts all automations for about a minute. Far-reaching: needs the delete level."""
        return await system.restart(safe_mode)

    @tool()
    async def ha_list_calendars() -> list[dict]:
        """List calendar entities (entity_id, name)."""
        return await planner.list_calendars()

    @tool()
    async def ha_get_calendar_events(entity_id: str = "", days: int = 7, start: str = "") -> dict:
        """Events of one calendar (or all calendars when entity_id is empty) from start (default now; date or
        date+time) for 1-31 days, sorted by start, with uid for changes."""
        return await planner.get_events(entity_id, days, start)

    @tool()
    async def ha_create_calendar_event(entity_id: str, summary: str, start: str, end: str,
                                       description: str | None = None, location: str | None = None) -> dict:
        """Add an event. start/end as 'YYYY-MM-DDTHH:MM' (local time) or as dates 'YYYY-MM-DD' for an all-day event
        (end = the day after the last day). Needs writes and the domain 'calendar' allowed."""
        return await planner.create_event(entity_id, summary, start, end, description, location)

    @tool()
    async def ha_update_calendar_event(entity_id: str, uid: str, summary: str, start: str, end: str,
                                       description: str | None = None, location: str | None = None,
                                       recurrence_id: str | None = None, recurrence_range: str | None = None) -> dict:
        """Replace an event (uid from ha_get_calendar_events): pass summary, start and end even if unchanged. For one
        occurrence of a series add recurrence_id ('THISANDFUTURE' as recurrence_range changes the rest of the
        series too). Needs writes and the domain 'calendar' allowed."""
        return await planner.update_event(entity_id, uid, summary, start, end, description, location, recurrence_id,
                                          recurrence_range)

    @tool()
    async def ha_delete_calendar_event(entity_id: str, uid: str, recurrence_id: str | None = None,
                                       recurrence_range: str | None = None) -> dict:
        """Delete an event (or one occurrence with recurrence_id). Cannot be undone. Needs the delete level and the
        domain 'calendar' allowed."""
        return await planner.delete_event(entity_id, uid, recurrence_id, recurrence_range)

    @tool()
    async def ha_list_todo_lists() -> list[dict]:
        """List to-do lists (e.g. shopping list) with the number of open items."""
        return await planner.list_todo_lists()

    @tool()
    async def ha_get_todo_items(entity_id: str, status: str = "needs_action") -> list[dict]:
        """Items of a to-do list; status 'needs_action' (open, default), 'completed' or '' for all."""
        return await planner.get_todo_items(entity_id, status)

    @tool()
    async def ha_add_todo_item(entity_id: str, item: str, due: str | None = None,
                               description: str | None = None) -> dict:
        """Add an item to a to-do list (due as date or date+time). Needs writes and the domain 'todo' allowed."""
        return await planner.add_todo_item(entity_id, item, due, description)

    @tool()
    async def ha_update_todo_item(entity_id: str, item: str, rename: str | None = None, status: str | None = None,
                                  due: str | None = None, description: str | None = None) -> dict:
        """Change an item (name or uid): status 'completed' ticks it off, 'needs_action' opens it again; rename,
        due, description. Needs writes and the domain 'todo' allowed."""
        return await planner.update_todo_item(entity_id, item, rename, status, due, description)

    @tool()
    async def ha_remove_todo_items(entity_id: str, items: list[str]) -> dict:
        """Remove items (names or uids) from a to-do list. Cannot be undone; to finish an item prefer
        ha_update_todo_item with status 'completed'. Needs the delete level and the domain 'todo' allowed."""
        return await planner.remove_todo_items(entity_id, items)

    @tool()
    async def ha_list_labels() -> list[dict]:
        """List labels with label_id, name, colour, icon and how many entities, devices and areas carry them."""
        return await organizer.list_labels()

    @tool()
    async def ha_get_label(label_id: str) -> dict:
        """One label with the entities, devices and areas that carry it."""
        return await organizer.get_label(label_id)

    @tool()
    async def ha_create_label(name: str, color: str | None = None, icon: str | None = None,
                              description: str | None = None) -> dict:
        """Create a label, e.g. name 'Batterie', color 'amber' (HA theme colour or '#rrggbb'), icon 'mdi:battery'.
        Assign it with ha_update_entity_registry / ha_update_device / ha_update_area (labels). Admin write
        required."""
        return await journaled("ha_create_label", "label", None,
                               lambda: organizer.create_label(name, color, icon, description),
                               target_from=lambda created: created["label_id"])

    @tool()
    async def ha_update_label(label_id: str, changes: dict) -> dict:
        """Change a label's name, color, icon or description and read back. Admin write required."""
        return await journaled("ha_update_label", "label", label_id,
                               lambda: organizer.update_label(label_id, changes))

    @tool()
    async def ha_delete_label(label_id: str) -> dict:
        """Delete a label; HA removes it from all entities, devices and areas (undo puts it back there).
        Admin write and delete required."""
        return await journaled("ha_delete_label", "label", label_id, lambda: organizer.delete_label(label_id),
                               fields=["assigned"])

    @tool()
    async def ha_list_categories(scope: str) -> list[dict]:
        """Categories of one HA UI list, with usage count. scope: 'automation', 'script', 'scene' or 'helpers'."""
        return await organizer.list_categories(scope)

    @tool()
    async def ha_create_category(scope: str, name: str, icon: str | None = None) -> dict:
        """Create a category in a scope ('automation', 'script', 'scene', 'helpers'); file items into it with
        ha_update_entity_registry (categories). Admin write required."""
        return await journaled("ha_create_category", "category", None,
                               lambda: organizer.create_category(scope, name, icon),
                               target_from=lambda created: f"{scope}/{created['category_id']}")

    @tool()
    async def ha_update_category(scope: str, category_id: str, changes: dict) -> dict:
        """Rename a category or change its icon and read back. Admin write required."""
        return await journaled("ha_update_category", "category", f"{scope}/{category_id}",
                               lambda: organizer.update_category(scope, category_id, changes))

    @tool()
    async def ha_delete_category(scope: str, category_id: str) -> dict:
        """Delete a category; its items become uncategorised (undo files them again). Admin write and delete
        required."""
        return await journaled("ha_delete_category", "category", f"{scope}/{category_id}",
                               lambda: organizer.delete_category(scope, category_id), fields=["assigned"])

    @tool()
    async def ha_list_zones() -> list[dict]:
        """List zones with name, position, radius, passive flag, persons inside and whether they can be edited
        here (zone.home and YAML zones cannot)."""
        return await organizer.list_zones()

    @tool()
    async def ha_create_zone(name: str, latitude: float, longitude: float, radius: float = 100,
                             passive: bool = False, icon: str | None = None) -> dict:
        """Create a zone (e.g. work, school) at latitude/longitude with radius in metres; passive zones only serve
        automations and do not change a person's state. Admin write required."""
        return await journaled("ha_create_zone", "zone", None,
                               lambda: organizer.create_zone(name, latitude, longitude, radius, passive, icon),
                               target_from=lambda created: created["zone_id"])

    @tool()
    async def ha_update_zone(zone_id: str, changes: dict) -> dict:
        """Change a zone's name, latitude, longitude, radius, passive or icon and read back. Admin write
        required."""
        return await journaled("ha_update_zone", "zone", zone_id, lambda: organizer.update_zone(zone_id, changes))

    @tool()
    async def ha_delete_zone(zone_id: str) -> dict:
        """Delete an editable zone. Admin write and delete required."""
        return await journaled("ha_delete_zone", "zone", zone_id, lambda: organizer.delete_zone(zone_id))

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
        """Start adding an integration (e.g. handler 'shelly') or a config-flow helper (e.g. 'template', 'group',
        'utility_meter', 'derivative'; see ha_list_helper_types); returns the first form (data_schema) or a menu
        (menu_options) with a flow_id. Admin write required."""
        return journal_created("ha_start_integration_setup", await integrations.start_flow(handler,
                                                                                           show_advanced_options))

    @tool()
    async def ha_integration_setup_step(flow_id: FlowId, data: dict | None = None) -> dict:
        """Submit one form step of a setup flow, field names from data_schema; keep shown defaults unless the
        user said otherwise. Secret fields (password, token, api_key, pin) must be credential references:
        {"$credential": "<alias>", "field": "<field>"} from ha_list_credentials; plain secret values are rejected.
        For discovered devices send {} to confirm. For a menu (type 'menu') send {"next_step_id": "<one of
        menu_options>"}. If the setup cannot be finished, call ha_abort_integration_setup. A created entry is
        journaled (undo removes it). Admin write required."""
        return journal_created("ha_integration_setup_step", await integrations.flow_step(flow_id, data))

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
    async def ha_get_backup(backup_id: BackupId) -> dict:
        """One backup's details (name, date, HA version, contents, size, encrypted) plus restore_impact: what
        restoring it would change. Read this and show it to the user before ha_restore_backup."""
        return await backups.get_backup(backup_id)

    @tool()
    async def ha_create_backup(name: str, password: dict | None = None) -> dict:
        """Create a full backup (configuration + database) on the local backup agent and wait until it is
        listed. Optional encryption password only as credential reference {"$credential": "<alias>",
        "field": "password"}. Admin write required."""
        return await backups.create_backup(name, password)

    @tool()
    async def ha_restore_backup(backup_id: BackupId, restore_database: Annotated[bool, Field(
            description="true = also replace the history database (recorder) with the backup's; false = keep the "
                        "current history. Use false whenever the user wants to keep history, data or the database; not possible on "
                        "Home Assistant OS when the backup contains a database (see database_can_be_kept)"
            )] = True, password: dict | None = None) -> dict:
        """Restore Home Assistant's configuration (and with restore_database=true also its history database)
        from a backup. Far-reaching: replaces the current configuration, HA restarts, changes since the backup
        are lost. Before calling, show the user the backup's name, date and restore_impact from ha_get_backup
        and get an explicit yes. A fresh safety backup is made first (restore it to undo); add-ons and folders
        are never restored. Encrypted backups need password as credential reference {"$credential": "<alias>",
        "field": "password"}. Waits for the restart and reports restored true/false. Delete level required."""
        return await backups.restore_backup(backup_id, restore_database, password)

    @tool()
    async def ha_delete_backup(backup_id: BackupId) -> dict:
        """Delete one backup by backup_id from ha_list_backups. Admin write and delete required."""
        return await backups.delete_backup(backup_id)

    @tool()
    async def ha_list_assist_pipelines() -> dict:
        """Assist voice pipelines (conversation agent, language, speech-to-text, text-to-speech, wake word) with
        the preferred one marked, plus the available conversation agents."""
        return await assist.list_pipelines()

    @tool()
    async def ha_save_assist_pipeline(changes: dict, pipeline_id: str = "") -> dict:
        """Create an Assist pipeline (no pipeline_id; needs name and language) or change one (pipeline_id from
        ha_list_assist_pipelines; only the given fields change). Fields: name, language, conversation_engine,
        conversation_language, stt_engine, stt_language, tts_engine, tts_language, tts_voice, wake_word_entity,
        wake_word_id, prefer_local_intents. Journaled. Admin write required."""
        if pipeline_id:
            return await journaled("ha_save_assist_pipeline", "pipeline", pipeline_id,
                                   lambda: assist.save_pipeline(pipeline_id, changes))
        return await journaled("ha_save_assist_pipeline", "pipeline", None,
                               lambda: assist.save_pipeline(None, changes), target_from=lambda r: r["id"])

    @tool()
    async def ha_set_preferred_assist_pipeline(pipeline_id: str) -> dict:
        """Make a pipeline the preferred one (used by Assist unless a device picks another). Journaled. Admin
        write required."""
        return await journaled("ha_set_preferred_assist_pipeline", "pipeline", "preferred",
                               lambda: assist.set_preferred(pipeline_id))

    @tool()
    async def ha_delete_assist_pipeline(pipeline_id: str) -> dict:
        """Delete an Assist pipeline (not the preferred one). Journaled, undo recreates it with a new id. Admin
        write and delete required."""
        return await journaled("ha_delete_assist_pipeline", "pipeline", pipeline_id,
                               lambda: assist.delete_pipeline(pipeline_id))

    @tool()
    async def ha_list_exposed_entities() -> dict:
        """Which entities voice assistants may use, per assistant: conversation (Assist, also local voice),
        cloud.alexa, cloud.google_assistant; plus whether new entities are exposed automatically."""
        return await assist.list_exposure()

    @tool()
    async def ha_set_exposure(entity_ids: list[str], should_expose: bool,
                              assistants: list[str] | None = None) -> dict:
        """Expose entities to voice assistants or hide them (assistants default ['conversation'] = Assist).
        Journaled with the previous value of every entity, undo with ha_undo_change. Admin write required."""
        targets = assist._assistants(assistants)
        return await journaled("ha_set_exposure", "exposure", ",".join(targets),
                               lambda: assist.set_exposure(entity_ids, should_expose, targets),
                               fields=list(entity_ids) if isinstance(entity_ids, list) else [entity_ids])

    @tool()
    async def ha_set_expose_new_entities(assistant: str, expose_new: bool) -> dict:
        """Whether entities added later are exposed to an assistant automatically. Journaled. Admin write
        required."""
        return await journaled("ha_set_expose_new_entities", "exposure", f"new:{assistant}",
                               lambda: assist.set_expose_new(assistant, expose_new))

    @tool()
    async def ha_test_assist_sentences(sentences: list[str], language: str = "") -> dict:
        """Check how Assist's built-in agent would understand sentences (intent, slots, target entities)
        WITHOUT running anything. Use it to debug voice commands, aliases and exposure. Without language it tries
        Home Assistant's language and every pipeline language and reports where a sentence matched; null or
        match false = not understood in any of them. Read only."""
        return await assist.test_sentences(sentences, language)

    @tool()
    async def ha_get_device_removal(device_id: str) -> dict:
        """Preview before removing a device: its entities, connected devices (via this hub), where the entities
        are used (automations, scripts, scenes, dashboards), the integration and whether it supports removing
        devices at all (can_remove, reason). Read only."""
        return await removal.device_removal(device_id)

    @tool()
    async def ha_remove_device(device_id: str) -> dict:
        """Remove a device and its entities from Home Assistant, like 'Delete' on the device page. Only when its
        integration supports it (see ha_get_device_removal); the integration may still refuse. Cannot be undone
        by the MCP; the integration may add the device again if it finds it. Show the user the preview first.
        Prefer disabling (ha_update_device disabled_by='user') when the device may come back. Admin write and
        delete required."""
        return await removal.remove_device(device_id)

    @tool()
    async def ha_list_orphaned_entities() -> dict:
        """Entities no integration provides any more (HA shows them as 'not provided', state unavailable,
        restored): leftovers of removed devices or renamed integrations. Read only."""
        return await removal.orphaned_entities()

    @tool()
    async def ha_remove_entity(entity_id: str) -> dict:
        """Remove an orphaned entity (from ha_list_orphaned_entities) from the entity registry. Entities an
        integration still provides are refused, disable those instead. Cannot be undone by the MCP. Admin write
        and delete required."""
        return await removal.remove_entity(entity_id)

    @tool()
    async def ha_get_energy_config() -> dict:
        """Energy dashboard settings: energy_sources (grid, solar, battery storage, gas, water with their
        statistics), device_consumption (single devices such as smart plugs) and device_consumption_water. Each
        item carries Home Assistant's own validation problems (e.g. entity_not_defined). For usage questions
        ('how much did ... use') call ha_get_energy_usage directly; it also works when nothing is configured."""
        return await energy.get_config()

    @tool()
    async def ha_find_energy_sensors(query: str = "") -> dict:
        """Sensors that could go into the energy dashboard, grouped as energy, power, battery, gas, water, with
        unit, state_class, has_statistics and in_energy_dashboard (where it is already used, or false). Read only;
        for usage numbers call ha_get_energy_usage next."""
        return await energy.find_sensors(query)

    @tool()
    async def ha_get_energy_usage(period: Annotated[str, Field(
            description="today, yesterday, 7d, 30d or this_month (time zone of Home Assistant)")] = "today",
            statistic_ids: list[str] | None = None) -> dict:
        """Energy per source (grid_import, grid_export, solar, battery_charge, battery_discharge, gas, water) and
        per configured device in a period, summed from the hourly/daily statistics. Answers 'how much did the
        plugs use today', 'how much solar yesterday'. statistic_ids: evaluate these energy sensors instead (also
        ones not in the energy dashboard, from ha_find_energy_sensors). Read only: answering a usage question
        never needs a change to the energy settings."""
        return await energy.usage(period, statistic_ids)

    @tool()
    async def ha_get_solar_forecast() -> dict:
        """Solar production forecast per configured forecast integration (e.g. Forecast.Solar), Wh per hour."""
        return await energy.solar_forecast()

    @tool()
    async def ha_save_energy_config(energy_sources: list[dict] | None = None,
                                    device_consumption: list[dict] | None = None,
                                    device_consumption_water: list[dict] | None = None) -> dict:
        """Replace whole parts of the energy dashboard settings; omitted parts stay. Read ha_get_energy_config
        first and send the full list with your change. energy_sources items: {"type": "grid"|"solar"|"battery"|
        "gas"|"water", "stat_energy_from": ..., "stat_energy_to": ... (grid export / battery charge),
        optional cost fields and "power_config"}. Devices: {"stat_consumption": ..., "name": ...,
        "stat_rate": <power sensor>, "included_in_stat": <parent device statistic>}. New statistic IDs must exist
        (ha_find_energy_sensors). Journaled, undo with ha_undo_change. Admin write required; removing entries
        this way is the same as editing them."""
        return await journaled("ha_save_energy_config", "energy", "prefs", lambda: energy.save(
            energy_sources, device_consumption, device_consumption_water))

    @tool()
    async def ha_add_energy_device(stat_consumption: str, name: str = "", stat_rate: str = "",
                                   included_in_stat: str = "", water: bool = False) -> dict:
        """Only when the user explicitly asks to add a device to the energy dashboard (never to answer a usage
        question: ha_get_energy_usage works without it). Adds one device (e.g. a smart plug's energy sensor).
        stat_rate: optional power sensor for live power; included_in_stat: statistic of a device it is part of
        (so it is not counted twice); water=true for water meters. Journaled. Admin write required."""
        return await journaled("ha_add_energy_device", "energy", "prefs", lambda: energy.add_device(
            stat_consumption, name or None, stat_rate or None, included_in_stat or None, water))

    @tool()
    async def ha_remove_energy_device(stat_consumption: str, water: bool = False) -> dict:
        """Remove one device from the energy dashboard (its history stays in the recorder). Journaled, undo with
        ha_undo_change. Admin write and delete required."""
        return await journaled("ha_remove_energy_device", "energy", "prefs", lambda: energy.remove_device(
            stat_consumption, water))

    @tool()
    async def ha_find_usages(needle: str, kinds: list[str] | None = None, limit: int = 100) -> dict:
        """Where is something used? Searches UI automations, scripts, scenes, groups and dashboards for a text,
        usually an entity_id (e.g. 'light.hallway') or a service ('notify.mobile'). Returns each match with the
        path inside its config. kinds: any of automation, script, scene, group, dashboard (default all).
        Use before renaming or removing an entity."""
        return await overview.find_usages(needle, kinds, limit)

    @tool()
    async def ha_get_overview() -> dict:
        """Compact overview of this Home Assistant: version, time zone, entity counts per domain (unavailable,
        on), areas/floors/devices, automations/scripts/scenes/dashboards, failing and disabled integrations."""
        return await overview.overview()

    @tool()
    async def ha_list_traces(domain: str = "automation", item: str = "", limit: int = 20) -> list[dict]:
        """Recent runs (traces) of automations or scripts, newest first: run_id, outcome (the result in plain words;
        state 'stopped' only means the run is over), error, last_step, trigger.
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
        entry = changes.journal.get(change_id)
        before = entry.get("before")
        if entry.get("kind") == "file" and isinstance(before, dict) and isinstance(before.get("content"), str):
            entry = {**entry, "before": {"content": mask(before["content"])[0]}}
        return entry

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
