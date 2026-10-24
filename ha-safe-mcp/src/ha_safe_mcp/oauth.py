"""OAuth 2.1 authorization server for the remote MCP endpoint (web connectors of ChatGPT, Claude and others).

- Discovery: protected-resource metadata (RFC 9728) and authorization-server metadata (RFC 8414) under
  ``/.well-known/oauth-*``; token and registration endpoints live under ``/mcp/oauth/`` so a proxy bypass for
  ``/mcp`` and ``/.well-known/oauth-*`` is enough. The consent page ``/oauth/authorize`` stays behind the UI login
  (e.g. Cloudflare Access): whoever may open the UI may grant access, no separate user store.
- Dynamic client registration (RFC 7591), redirect URIs https or loopback http only.
- Authorization code with mandatory PKCE S256, single-use codes valid 10 minutes, exact redirect_uri match.
- An approved grant becomes a normal remote-client profile (level + domains, capped by the instance switches) with
  a 1-hour access token and a rotating 60-day refresh token; deleting the profile in the UI revokes it.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode, urlsplit

from .remote import LEVELS, ClientStore, _hash

CODE_SECONDS = 600
MAX_REGISTRATIONS = 200
AUTH_METHODS = ("none", "client_secret_post", "client_secret_basic")
LOOPBACK = {"localhost", "127.0.0.1", "[::1]", "::1"}
VERIFIER = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")


class OAuthError(Exception):
    def __init__(self, error: str, description: str, status: int = 400):
        super().__init__(description)
        self.error, self.description, self.status = error, description, status

    def body(self) -> dict:
        return {"error": self.error, "error_description": self.description}


def metadata(base: str) -> tuple[dict, dict]:
    """(protected resource metadata, authorization server metadata) for the given public base URL."""
    resource = {"resource": f"{base}/mcp", "authorization_servers": [base], "bearer_methods_supported": ["header"],
                "scopes_supported": ["ha"], "resource_name": "ha-safe-mcp"}
    server = {"issuer": base, "authorization_endpoint": f"{base}/oauth/authorize",
              "token_endpoint": f"{base}/mcp/oauth/token", "registration_endpoint": f"{base}/mcp/oauth/register",
              "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"],
              "code_challenge_methods_supported": ["S256"], "token_endpoint_auth_methods_supported": list(AUTH_METHODS),
              "scopes_supported": ["ha"]}
    return resource, server


def _redirect_ok(uri) -> bool:
    if not isinstance(uri, str) or len(uri) > 2000 or "#" in uri:
        return False
    parts = urlsplit(uri)
    if parts.scheme == "https" and parts.hostname:
        return True
    return parts.scheme == "http" and (parts.hostname or "") in LOOPBACK


def _with_query(uri: str, params: dict) -> str:
    return uri + ("&" if urlsplit(uri).query else "?") + urlencode({k: v for k, v in params.items() if v})


class OAuthServer:
    def __init__(self, clients: ClientStore, *, now: Callable[[], float] = time.time):
        self.clients = clients
        self.path = clients.directory / "oauth_clients.json"
        self.now = now
        self._codes: dict[str, dict] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------ registrations
    def _load(self) -> dict:
        if not self.path.is_file() or self.path.is_symlink():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _save(self, data: dict):
        directory = self.clients.directory
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        tmp = directory / f".oauth-{secrets.token_hex(4)}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, json.dumps(data, indent=1).encode())
        finally:
            os.close(fd)
        os.replace(tmp, self.path)

    def register(self, data: dict) -> dict:
        if not isinstance(data, dict):
            raise OAuthError("invalid_client_metadata", "JSON object expected")
        uris = data.get("redirect_uris")
        if not isinstance(uris, list) or not 0 < len(uris) <= 10 or not all(_redirect_ok(u) for u in uris):
            raise OAuthError("invalid_redirect_uri", "redirect_uris must be https URLs or http loopback URLs")
        method = data.get("token_endpoint_auth_method") or "client_secret_basic"
        if method not in AUTH_METHODS:
            raise OAuthError("invalid_client_metadata", "unsupported token_endpoint_auth_method")
        name = str(data.get("client_name") or "MCP-Client").strip()[:60] or "MCP-Client"
        client_id = secrets.token_urlsafe(18)
        secret = secrets.token_urlsafe(32) if method != "none" else None
        record = {"client_name": name, "redirect_uris": uris, "token_endpoint_auth_method": method,
                  "secret_hash": _hash(secret) if secret else None, "issued_at": int(self.now())}
        with self._lock:
            registrations = self._load()
            if len(registrations) >= MAX_REGISTRATIONS:
                # drop the oldest registrations that never got a profile
                used = {c.get("oauth_client_id") for c in self.clients._load()}
                for old in sorted(registrations, key=lambda k: registrations[k].get("issued_at", 0)):
                    if len(registrations) < MAX_REGISTRATIONS:
                        break
                    if old not in used:
                        del registrations[old]
                if len(registrations) >= MAX_REGISTRATIONS:
                    raise OAuthError("invalid_client_metadata", "too many registered clients", 400)
            registrations[client_id] = record
            self._save(registrations)
        result = {"client_id": client_id, "client_id_issued_at": record["issued_at"], "client_name": name,
                  "redirect_uris": uris, "token_endpoint_auth_method": method,
                  "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}
        if secret:
            result.update(client_secret=secret, client_secret_expires_at=0)
        return result

    def _registration(self, client_id) -> dict:
        record = self._load().get(client_id) if isinstance(client_id, str) else None
        if record is None:
            raise OAuthError("invalid_client", "unknown client_id", 401)
        return record

    # ------------------------------------------------------------ authorization (consent page)
    def check(self, params: dict, base: str) -> dict:
        """Validate an authorization request; errors here are shown on the page, never redirected."""
        if not isinstance(params, dict):
            raise OAuthError("invalid_request", "parameters missing")
        try:
            record = self._registration(params.get("client_id"))
        except OAuthError as exc:
            raise OAuthError("invalid_request", exc.description) from None
        if params.get("redirect_uri") not in record["redirect_uris"]:
            raise OAuthError("invalid_request", "redirect_uri is not registered for this client")
        if params.get("response_type") != "code":
            raise OAuthError("invalid_request", "only response_type=code is supported")
        challenge = params.get("code_challenge")
        if params.get("code_challenge_method") != "S256" or not isinstance(challenge, str) \
                or not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge):
            raise OAuthError("invalid_request", "PKCE with code_challenge_method=S256 is required")
        resource = params.get("resource")
        if resource and resource.rstrip("/") != f"{base}/mcp":
            raise OAuthError("invalid_target", "resource must be this server's /mcp endpoint")
        return {"client_name": record["client_name"], "redirect_host": urlsplit(params["redirect_uri"]).hostname}

    def approve(self, params: dict, base: str, level: str, domains) -> str:
        info = self.check(params, base)
        if level not in LEVELS:
            raise OAuthError("invalid_request", "unknown level")
        code = secrets.token_urlsafe(32)
        with self._lock:
            now = self.now()
            self._codes = {k: v for k, v in self._codes.items() if v["expires"] > now}
            self._codes[_hash(code)] = {"client_id": params["client_id"], "redirect_uri": params["redirect_uri"],
                                        "challenge": params["code_challenge"], "level": level,
                                        "domains": list(domains or []), "name": info["client_name"],
                                        "expires": now + CODE_SECONDS}
        return _with_query(params["redirect_uri"], {"code": code, "state": params.get("state"), "iss": base})

    def deny(self, params: dict, base: str) -> str:
        self.check(params, base)
        return _with_query(params["redirect_uri"], {"error": "access_denied", "state": params.get("state"),
                                                    "iss": base})

    # ------------------------------------------------------------ token endpoint
    def _authenticate_client(self, form: dict, basic: tuple[str, str] | None) -> str:
        client_id = basic[0] if basic else form.get("client_id")
        record = self._registration(client_id)
        method = record["token_endpoint_auth_method"]
        if method != "none":
            secret = basic[1] if basic else form.get("client_secret")
            if not isinstance(secret, str) or not record.get("secret_hash") \
                    or not secrets.compare_digest(_hash(secret), record["secret_hash"]):
                raise OAuthError("invalid_client", "client authentication failed", 401)
        return client_id

    @staticmethod
    def _response(access: str, refresh: str) -> dict:
        from .remote import ACCESS_SECONDS
        return {"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_SECONDS,
                "refresh_token": refresh, "scope": "ha"}

    def token(self, form: dict, basic: tuple[str, str] | None = None) -> dict:
        grant = form.get("grant_type")
        if grant not in ("authorization_code", "refresh_token"):
            raise OAuthError("unsupported_grant_type", "use authorization_code or refresh_token")
        client_id = self._authenticate_client(form, basic)
        if grant == "refresh_token":
            issued = self.clients.refresh_oauth(form.get("refresh_token"), client_id)
            if issued is None:
                raise OAuthError("invalid_grant", "refresh token invalid, expired or already used")
            return self._response(issued[1], issued[2])
        code = form.get("code")
        with self._lock:
            grant_data = self._codes.pop(_hash(code), None) if isinstance(code, str) else None
        if grant_data is None or grant_data["expires"] <= self.now() or grant_data["client_id"] != client_id:
            raise OAuthError("invalid_grant", "authorization code invalid, expired or already used")
        if form.get("redirect_uri") != grant_data["redirect_uri"]:
            raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request")
        verifier = form.get("code_verifier")
        if not isinstance(verifier, str) or not VERIFIER.fullmatch(verifier):
            raise OAuthError("invalid_grant", "code_verifier missing or malformed")
        digest = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if not secrets.compare_digest(digest, grant_data["challenge"]):
            raise OAuthError("invalid_grant", "PKCE verification failed")
        _, access, refresh = self.clients.issue_oauth(grant_data["name"], grant_data["level"], grant_data["domains"],
                                                      oauth_client_id=client_id)
        return self._response(access, refresh)
