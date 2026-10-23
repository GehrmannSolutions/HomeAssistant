"""Safety-first standalone MCP bridge for Home Assistant's documented REST API."""

import os
import re
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
ENTITY = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")
DEFAULT_DOMAINS = frozenset({"light", "switch", "fan", "climate", "cover", "media_player"})


class HAClient:
    def __init__(self, url: str, token: str, *, allow_write: bool = False,
                 allowed_domains: frozenset[str] = DEFAULT_DOMAINS):
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("HA_URL must be a root http(s) URL without credentials or query")
        if not token:
            raise ValueError("HA_TOKEN is required")
        self.url = url.rstrip("/")
        self.token = token
        self.allow_write = allow_write
        self.allowed_domains = allowed_domains

    async def _request(self, method: str, path: str, *, data: dict | None = None):
        try:
            async with httpx.AsyncClient(base_url=self.url, timeout=15, trust_env=False,
                                         headers={"Authorization": f"Bearer {self.token}"}) as client:
                response = await client.request(method, path, json=data)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"Home Assistant returned HTTP {exc.response.status_code}") from None
        except (httpx.RequestError, ValueError) as exc:
            raise RuntimeError(f"Home Assistant request failed ({type(exc).__name__})") from None

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


def create_server(client: HAClient, *, allow_admin_write: bool = False,
                  allow_delete: bool = False) -> FastMCP:
    from .rest_api import RestGateway

    rest = RestGateway(client, allow_admin_write=allow_admin_write, allow_delete=allow_delete)
    server = FastMCP("ha-safe-mcp", instructions="Home Assistant REST bridge; writes disabled by default.")

    @server.tool()
    async def ha_search_entities(query: str = "", domain: str = "", limit: int = 50) -> list[dict]:
        """Search current entity IDs and friendly names, optionally filter by domain."""
        return await client.search_entities(query, domain, limit)

    @server.tool()
    async def ha_get_state(entity_id: str) -> dict:
        """Read the current state and attributes of one entity."""
        return await client.get_state(entity_id)

    @server.tool()
    async def ha_list_services(domain: str = "") -> list[dict]:
        """List action names for a domain; filter by domain to save context."""
        return await client.list_services(domain)

    @server.tool()
    async def ha_call_service(domain: str, service: str, entity_id: str,
                              service_data: dict | None = None) -> list[dict]:
        """Call an action for one entity; disabled unless HA_ALLOW_WRITE=true; only configured domains allowed."""
        return await client.call_service(domain, service, entity_id, service_data)

    @server.tool()
    async def ha_rest_catalog() -> list[dict]:
        """Discover the documented REST routes and their permission classes."""
        return rest.catalog()

    @server.tool()
    async def ha_rest_query(path: str, query: dict | None = None,
                            method: str = "GET", body: dict | None = None) -> dict:
        """Call a documented GET route or the safe POST template/config-check routes."""
        if method != "GET" and (method != "POST" or path not in {"/api/template", "/api/config/core/check_config"}):
            raise ValueError("query tool only supports GET or safe POST")
        return await rest.request(method, path, query=query, body=body)

    @server.tool()
    async def ha_rest_write(path: str, body: dict | None = None,
                            query: dict | None = None) -> dict:
        """POST a documented mutation. Requires HA_ALLOW_WRITE; admin routes need HA_ALLOW_ADMIN_WRITE."""
        return await rest.request("POST", path, body=body, query=query)

    @server.tool()
    async def ha_rest_delete(path: str) -> dict:
        """DELETE a documented state route. Requires HA_ALLOW_WRITE, HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE."""
        return await rest.request("DELETE", path)

    return server


def main():
    load_dotenv()
    domains = frozenset(x.strip() for x in os.getenv("HA_ALLOWED_DOMAINS", ",".join(sorted(DEFAULT_DOMAINS))).split(",") if x.strip())
    client = HAClient(os.getenv("HA_URL", "http://127.0.0.1:8123"), os.getenv("HA_TOKEN", ""),
                      allow_write=os.getenv("HA_ALLOW_WRITE", "false").lower() == "true",
                      allowed_domains=domains)
    create_server(client,
                  allow_admin_write=os.getenv("HA_ALLOW_ADMIN_WRITE", "false").lower() == "true",
                  allow_delete=os.getenv("HA_ALLOW_DELETE", "false").lower() == "true").run(transport="stdio")


if __name__ == "__main__":
    main()
