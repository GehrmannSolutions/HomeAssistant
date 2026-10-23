"""Explicit catalog of the endpoints in Home Assistant's official REST API docs.

Not an open HTTP proxy: method, route, query and mutation class are checked
before any network request. Administrative writes require separate opt-in.
"""

import base64
import re

import httpx

from .server import ENTITY, IDENTIFIER, HAClient

STAMP = r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2}))?"
ENTITY_PATH = r"[a-z][a-z0-9_]*\.[a-z0-9_]+"
ROUTES = (
    ("GET", "/api/", r"/api/", "read"),
    ("GET", "/api/config", r"/api/config", "read"),
    ("GET", "/api/components", r"/api/components", "read"),
    ("GET", "/api/events", r"/api/events", "read"),
    ("GET", "/api/services", r"/api/services", "read"),
    ("GET", "/api/history/period[/<timestamp>]", rf"/api/history/period(?:/{STAMP})?", "read"),
    ("GET", "/api/logbook[/<timestamp>]", rf"/api/logbook(?:/{STAMP})?", "read"),
    ("GET", "/api/states", r"/api/states", "read"),
    ("GET", "/api/states/<entity_id>", rf"/api/states/{ENTITY_PATH}", "read"),
    ("GET", "/api/error_log", r"/api/error_log", "read"),
    ("GET", "/api/camera_proxy/<camera_entity_id>", r"/api/camera_proxy/camera\.[a-z0-9_]+", "read"),
    ("GET", "/api/calendars", r"/api/calendars", "read"),
    ("GET", "/api/calendars/<calendar_entity_id>", r"/api/calendars/calendar\.[a-z0-9_]+", "read"),
    ("POST", "/api/states/<entity_id>", rf"/api/states/{ENTITY_PATH}", "admin"),
    ("POST", "/api/events/<event_type>", r"/api/events/[a-z][a-z0-9_]*", "admin"),
    ("POST", "/api/services/<domain>/<service>", r"/api/services/[a-z][a-z0-9_]*/[a-z][a-z0-9_]*", "write"),
    ("POST", "/api/template", r"/api/template", "read"),
    ("POST", "/api/config/core/check_config", r"/api/config/core/check_config", "read"),
    ("POST", "/api/intent/handle", r"/api/intent/handle", "admin"),
    ("DELETE", "/api/states/<entity_id>", rf"/api/states/{ENTITY_PATH}", "delete"),
)
QUERY_KEYS = {
    "/api/history/period": {"filter_entity_id", "end_time", "minimal_response", "no_attributes", "significant_changes_only"},
    "/api/logbook": {"entity", "end_time"},
    "/api/calendars/": {"start", "end"},
    "/api/camera_proxy/": {"time"},
    "/api/services/": {"return_response"},
}
MAX_BODY = 65536
MAX_RESPONSE = 2_000_000


class RestGateway:
    def __init__(self, client: HAClient, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client = client
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete

    def catalog(self) -> list[dict]:
        return [{"method": method, "path": path, "permission": category}
                for method, path, _, category in ROUTES]

    async def request(self, method: str, path: str, *, query: dict | None = None,
                      body: dict | None = None) -> dict:
        match = next(((pattern, category) for m, _, pattern, category in ROUTES
                      if m == method and re.fullmatch(pattern, path)), None)
        if match is None:
            raise ValueError("route/method not in documented REST catalog")
        category = match[1]
        if category in {"write", "admin", "delete"} and not self.client.allow_write:
            raise ValueError("writes disabled")
        if category in {"admin", "delete"} and not self.allow_admin_write:
            raise ValueError("admin write disabled")
        if category == "delete" and not self.allow_delete:
            raise ValueError("delete disabled")
        if query is None:
            query = {}
        if not isinstance(query, dict) or not all(isinstance(k, str) and isinstance(v, (str, int, bool)) for k, v in query.items()):
            raise ValueError("query must be an object of scalar values")
        query_allowed = next((keys for prefix, keys in QUERY_KEYS.items() if path.startswith(prefix)), set())
        if not query.keys() <= query_allowed:
            raise ValueError("unsupported query parameter")
        if path.startswith("/api/history/period") and not query.get("filter_entity_id"):
            raise ValueError("filter_entity_id required for history")
        if path.startswith("/api/calendars/") and not {"start", "end"} <= query.keys():
            raise ValueError("calendar start/end required")
        if body is not None and (not isinstance(body, dict) or len(str(body).encode()) > MAX_BODY):
            raise ValueError("body must be a small JSON object")
        if method == "POST" and path.startswith("/api/states/") and (not body or "state" not in body):
            raise ValueError("state required")
        if method == "POST" and path.startswith("/api/services/"):
            domain, service = path.split("/")[-2:]
            if not body or not isinstance(body.get("entity_id"), str):
                raise ValueError("single entity_id required for service")
            result = await self.client.call_service(domain, service, body["entity_id"],
                                                    {k: v for k, v in body.items() if k != "entity_id"},
                                                    return_response="return_response" in query)
            return {"status": 200, "content_type": "application/json", "data": result}
        try:
            async with httpx.AsyncClient(base_url=self.client.url, timeout=20, trust_env=False,
                                         follow_redirects=False,
                                         headers={"Authorization": f"Bearer {self.client.token}"}) as http:
                response = await http.request(method, path, params=query, json=body)
                response.raise_for_status()
                if len(response.content) > MAX_RESPONSE:
                    raise RuntimeError("Home Assistant response exceeds size limit")
                content_type = response.headers.get("content-type", "application/json").split(";")[0]
                if content_type.startswith("image/"):
                    return {"status": response.status_code, "content_type": content_type,
                            "data_base64": base64.b64encode(response.content).decode("ascii")}
                if content_type.startswith("text/"):
                    data = response.text
                else:
                    data = response.json()
                return {"status": response.status_code, "content_type": content_type, "data": data}
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"Home Assistant returned HTTP {exc.response.status_code}") from None
        except (httpx.RequestError, ValueError) as exc:
            raise RuntimeError(f"Home Assistant request failed ({type(exc).__name__})") from None
