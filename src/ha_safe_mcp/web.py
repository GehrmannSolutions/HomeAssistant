"""Local web UI for ha-safe-mcp: first-run setup, settings and a chat with the local model.

Security model: the UI is bound to loopback by default, rejects foreign Host headers (DNS
rebinding) and non-loopback peers, and every state-changing request must carry the custom
``X-HA-MCP-UI`` header plus a matching ``Origin`` (blocks cross-site form posts and fetches).
The Home Assistant token is written to the local ``.env`` (mode 0600) and never returned.
"""

import argparse
import asyncio
import ipaddress
import json
import os
import re
import time
from contextlib import asynccontextmanager
from functools import partial
from importlib import resources
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession
from mcp.client.stdio import stdio_client
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from starlette.routing import Route

from .chat_runs import RunBusy, RunManager
from .access_auth import AccessTokenVerifier
from .config_store import Settings, SettingsStore, SetupError, merge_settings, normalize_url, resolve_token
from .credentials import CredentialError, CredentialStore
from .audit import AuditLog
from .files import FileError, FileStore
from .ollama_client import mcp_parameters_for, run_chat, sanitize_history

UI_HEADER = "x-ha-mcp-ui"
MAX_BODY = 64 * 1024
MAX_MESSAGE = 4000
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
STATIC = {"app.js": "text/javascript; charset=utf-8", "app.css": "text/css; charset=utf-8",
          "icon.svg": "image/svg+xml"}
# "pw: x", "Passwort ist x", "password=x": a secret value typed into the chat. Asking about a password
# field ("Wie ist das Passwort-Feld ...") or naming a stored alias stays allowed.
PLAINTEXT_SECRET = re.compile(
    r"(?i)\b(?:pw|pwd|pass|passwor[dt]|kennwort|secret|token|api[_-]?key)\b\s*(?::|=|\bist\b|\bis\b|\blautet\b)\s*\S+")
SECRET_REFUSAL = ("Bitte keine Passwörter oder Tokens in den Chat schreiben: sie landen im Verlauf und beim Modell. "
                  "Lege sie unter 'Zugangsdaten' an und nenne im Chat nur den Alias.")


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    host = host.strip("[]").lower()
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def guard_bind_host(host: str, *, allow_remote: bool):
    if not _is_loopback(host) and not allow_remote:
        raise SystemExit(f"Refusing to bind the web UI to {host}: it can control your home. "
                         "Use --allow-remote only behind your own authentication.")


def _host_name(header: str | None) -> str | None:
    if not header:
        return None
    try:
        return urlsplit(f"//{header}").hostname
    except ValueError:
        return None


def _security_headers(response: Response) -> Response:
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


def _error(message: str, status: int = 400) -> JSONResponse:
    return _security_headers(JSONResponse({"error": message}, status_code=status))


def _ok(payload: dict) -> JSONResponse:
    return _security_headers(JSONResponse(payload))


class LocalOnlyGuard:
    """ASGI middleware: loopback peers, allowed Host names, and CSRF protection for mutations."""

    def __init__(self, app, *, allowed_hosts: set[str], allow_remote: bool,
                 public_origin: str | None = None, access_verifier=None):
        self.app = app
        self.allowed_hosts = {host.lower() for host in allowed_hosts}
        self.allow_remote = allow_remote
        self.public_origin = public_origin
        self.access_verifier = access_verifier

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        host = _host_name(request.headers.get("host"))
        if host is None or (host.lower() not in self.allowed_hosts and not (self.allow_remote and host)):
            return await _error("Ungültiger Host", 400)(scope, receive, send)
        peer = scope.get("client")
        if not self.allow_remote and not (peer and _is_loopback(peer[0])):
            return await _error("Nur lokal erreichbar", 403)(scope, receive, send)
        if self.access_verifier is not None:
            assertion = request.headers.get("cf-access-jwt-assertion", "")
            if not assertion or not await asyncio.to_thread(self.access_verifier, assertion):
                return await _error("Cloudflare Access Anmeldung erforderlich", 403)(scope, receive, send)
        if request.method not in {"GET", "HEAD"}:
            origin = request.headers.get("origin")
            expected = self.public_origin or f"{scope.get('scheme', 'http')}://{request.headers.get('host')}"
            if request.headers.get(UI_HEADER) != "1" or (origin is not None and origin != expected):
                return await _error("Anfrage nicht erlaubt", 403)(scope, receive, send)
        return await self.app(scope, receive, send)


async def _json_body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise SetupError("Anfrage zu groß")
    try:
        data = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise SetupError("Ungültiges JSON") from None
    if not isinstance(data, dict):
        raise SetupError("Ungültige Eingabe")
    return data


class LiveChecks:
    """Read-only connection checks used by the setup wizard."""

    async def check_ha(self, url: str, token: str) -> dict:
        from .management import HAAdmin
        from .server import HAClient

        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(base_url=url, timeout=10, trust_env=False, headers=headers) as http:
                api = await http.get("/api/")
                if api.status_code == 401:
                    return {"ok": False, "message": "Token wurde von Home Assistant abgelehnt (HTTP 401)."}
                api.raise_for_status()
                config = (await http.get("/api/config")).json()
        except httpx.HTTPStatusError as exc:
            return {"ok": False, "message": f"Home Assistant antwortete mit HTTP {exc.response.status_code}."}
        except (httpx.RequestError, ValueError):
            return {"ok": False, "message": "Home Assistant ist unter dieser Adresse nicht erreichbar."}
        if not isinstance(config, dict):
            config = {}
        result = {"ok": True, "version": str(config.get("version", "")),
                  "location_name": str(config.get("location_name", "")), "user": "", "is_admin": None}
        try:
            user = await HAAdmin(HAClient(url, token)).current_user()
            result.update(user=user["name"], is_admin=user["is_admin"])
        except (RuntimeError, ValueError):
            pass
        result["message"] = f"Verbunden mit Home Assistant {result['version']}".strip()
        return result

    async def check_ollama(self, url: str) -> dict:
        try:
            async with httpx.AsyncClient(base_url=url, timeout=10, trust_env=False) as http:
                version = (await http.get("/api/version")).json().get("version", "")
                tags = (await http.get("/api/tags")).json().get("models", [])
                models = []
                for item in tags[:50]:
                    name = str(item.get("name", ""))
                    try:
                        show = (await http.post("/api/show", json={"model": name})).json()
                        tools = "tools" in (show.get("capabilities") or [])
                    except (httpx.HTTPError, ValueError):
                        tools = None
                    models.append({"name": name, "size_gb": round(item.get("size", 0) / 1e9, 1), "tools": tools})
        except (httpx.HTTPError, ValueError, AttributeError):
            return {"ok": False, "message": "Ollama ist unter dieser Adresse nicht erreichbar.", "models": []}
        return {"ok": True, "message": f"Ollama {version} erreichbar".strip(), "version": version, "models": models}


PLAN_REQUEST = re.compile(r"(?i)\b(plan|planung|konzept|vorgehen|schritte|roadmap|checkliste)\w*")
PLAN_MIN_CHARS = 200
FENCE_BLOCK = re.compile(r"```.*?```", re.DOTALL)
PLAN_STEP = re.compile(r"(?m)^\s*(?:\d+[.)]|[-*•]|#{1,4})\s+\S")
PLAN_MIN_STEPS = 2


def store_generated_files(files: FileStore, prompt: str, answer: str) -> list[dict]:
    """Keep what the model produced: fenced code blocks as scripts, a requested plan as Markdown.
    Storage only: nothing here is executed or sent to Home Assistant."""
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    saved = files.save_answer_blocks(answer, prefix=f"chat-{stamp}")
    if (PLAN_REQUEST.search(prompt) and len(answer) >= PLAN_MIN_CHARS
            and len(PLAN_STEP.findall(FENCE_BLOCK.sub("", answer))) >= PLAN_MIN_STEPS):
        title = " ".join(prompt.split())[:200]
        body = f"# Plan\n\n> Anfrage: {title}\n\n{answer.strip()}\n"
        saved.append(files.save("plan", f"plan-{stamp}.md", body, overwrite=False))
    return saved


async def mcp_chat_runner(settings: Settings, prompt: str, history: list[dict], allow_write: bool,
                          approve, on_event, *, credentials_dir: Path | None = None,
                          audit_dir: Path | None = None) -> str:
    """One chat turn: start the MCP stdio server with exactly the saved settings and run the tool loop."""
    env = settings.mcp_env()
    if credentials_dir is not None:
        env["HA_CREDENTIALS_DIR"] = str(credentials_dir)
    if audit_dir is not None:
        env["HA_AUDIT_DIR"] = str(audit_dir)
    async with stdio_client(mcp_parameters_for(env)) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            async with httpx.AsyncClient(base_url=settings.ollama_url, timeout=300, trust_env=False) as http:
                return await run_chat(session, http, settings.ollama_model, prompt, history=history,
                                      allow_write=allow_write, approve=approve, on_event=on_event)


BACKUP_ID = re.compile(r"^[0-9a-z]{6,64}$")


def live_backups(settings: Settings, credentials_dir: Path, audit: AuditLog):
    """Backup client for the web UI: the same gated code the MCP tools use, with the saved switches."""
    from .backups import HABackups
    from .management import HAWebSocket
    from .server import HAClient
    client = HAClient(settings.ha_url, settings.ha_token, allow_write=settings.allow_write, audit=audit)
    ws = HAWebSocket(client, allow_admin_write=settings.allow_admin_write, allow_delete=settings.allow_delete)
    return HABackups(client, ws, allow_admin_write=settings.allow_admin_write, allow_delete=settings.allow_delete,
                     credentials=CredentialStore(credentials_dir))


def _static_text(name: str) -> str:
    return resources.files("ha_safe_mcp").joinpath("webui", name).read_text(encoding="utf-8")


def create_app(store: SettingsStore, *, checks=None, runs: RunManager | None = None,
               allowed_hosts: set[str] | None = None, allow_remote: bool = False,
               public_origin: str | None = None, access_verifier=None,
               credentials: CredentialStore | None = None, files: FileStore | None = None,
               audit: AuditLog | None = None, backups_factory=None):
    checks = checks or LiveChecks()
    credentials = credentials or CredentialStore()
    files = files or FileStore()
    audit = audit or AuditLog()
    runs = runs or RunManager(partial(mcp_chat_runner, credentials_dir=credentials.directory,
                                      audit_dir=audit.directory))
    runs.on_answer = partial(store_generated_files, files)
    backups_factory = backups_factory or (lambda settings: live_backups(settings, credentials.directory, audit))
    lock = asyncio.Lock()

    async def index(request: Request):
        return _security_headers(Response(_static_text("index.html"), media_type="text/html; charset=utf-8"))

    async def static(request: Request):
        name = request.path_params["name"]
        if name not in STATIC:
            return _error("Nicht gefunden", 404)
        return _security_headers(Response(_static_text(name), media_type=STATIC[name]))

    async def status(request: Request):
        settings = store.load()
        return _ok({"configured": settings.configured, "settings": settings.public(),
                    "chat_busy": runs.active is not None})

    async def test_ha(request: Request):
        try:
            data = await _json_body(request)
            url = normalize_url(data.get("ha_url", ""), "Home-Assistant")
            token = resolve_token(store.load(), url, str(data.get("token") or "").strip())
        except SetupError as exc:
            return _error(str(exc))
        return _ok(await checks.check_ha(url, token))

    async def test_ollama(request: Request):
        try:
            data = await _json_body(request)
            url = normalize_url(data.get("ollama_url", ""), "Ollama")
        except SetupError as exc:
            return _error(str(exc))
        return _ok(await checks.check_ollama(url))

    async def save(request: Request):
        try:
            data = await _json_body(request)
            async with lock:
                settings = merge_settings(store.load(), data)
                check = await checks.check_ha(settings.ha_url, settings.ha_token)
                if not check.get("ok"):
                    return _error(check.get("message") or "Verbindung fehlgeschlagen")
                if settings.allow_admin_write and check.get("is_admin") is False:
                    return _error("Für 'Konfiguration ändern' braucht der Token einen Admin-Benutzer")
                saved = store.save(settings)
        except SetupError as exc:
            return _error(str(exc))
        return _ok({"configured": saved.configured, "settings": saved.public(), "check": check})

    async def chat_start(request: Request):
        settings = store.load()
        if not settings.configured:
            return _error("Bitte zuerst die Ersteinrichtung abschließen", 409)
        try:
            data = await _json_body(request)
            message = data.get("message")
            if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE:
                raise SetupError("Nachricht fehlt oder ist zu lang")
            history = sanitize_history(data.get("history") or [])
            if PLAINTEXT_SECRET.search(message) or any(PLAINTEXT_SECRET.search(item["content"])
                                                       for item in history if item["role"] == "user"):
                raise SetupError(SECRET_REFUSAL)
            allow_write = data.get("allow_write", False)
            if not isinstance(allow_write, bool):
                raise SetupError("allow_write muss true oder false sein")
            if allow_write and not settings.allow_write:
                raise SetupError("Schreibmodus ist aus: in den Einstellungen 'Steuern erlauben' aktivieren")
        except (SetupError, ValueError) as exc:
            return _error(str(exc))
        try:
            run = runs.start(settings, message.strip(), history, allow_write=allow_write)
        except RunBusy as exc:
            return _error(str(exc), 409)
        return _ok({"run_id": run.id})

    async def chat_events(request: Request):
        run = runs.get(request.path_params["run_id"])
        if run is None:
            return _error("Unbekannte Anfrage", 404)
        try:
            after = max(0, int(request.query_params.get("after", "0")))
            wait = min(25.0, max(0.0, float(request.query_params.get("wait", "20"))))
        except ValueError:
            return _error("Ungültige Parameter")
        events = await run.wait_events(after, timeout=wait)
        return _ok({"events": events, "finished": run.finished})

    async def chat_approve(request: Request):
        try:
            data = await _json_body(request)
        except SetupError as exc:
            return _error(str(exc))
        approved = data.get("approved")
        if not isinstance(approved, bool) or not isinstance(data.get("approval_id"), str):
            return _error("Ungültige Freigabe")
        if not runs.resolve(request.path_params["run_id"], data["approval_id"], approved):
            return _error("Freigabe nicht (mehr) offen", 404)
        return _ok({"ok": True})

    async def chat_cancel(request: Request):
        if not runs.cancel(request.path_params["run_id"]):
            return _error("Keine laufende Anfrage", 404)
        return _ok({"ok": True})

    async def credentials_list(request: Request):
        try:
            return _ok({"credentials": credentials.list_public()})
        except CredentialError as exc:
            return _error(str(exc), 500)

    async def credentials_save(request: Request):
        try:
            data = await _json_body(request)
            async with lock:
                saved = credentials.save(str(data.get("alias") or ""), str(data.get("label") or ""),
                                         data.get("fields") if isinstance(data.get("fields"), dict) else {})
        except (SetupError, CredentialError) as exc:
            return _error(str(exc))
        return _ok({"credential": saved})

    async def credentials_delete(request: Request):
        try:
            async with lock:
                credentials.delete(request.path_params["alias"])
        except CredentialError as exc:
            return _error(str(exc), 404)
        return _ok({"ok": True})

    async def files_list(request: Request):
        return _ok({"files": files.entries()})

    async def files_get(request: Request):
        kind, name = request.path_params["kind"], request.path_params["name"]
        try:
            content = files.read(kind, name)
        except FileError as exc:
            return _error(str(exc), 404)
        if request.query_params.get("download") == "1":
            response = PlainTextResponse(content, headers={
                "Content-Disposition": f'attachment; filename="{name}"'})
            return _security_headers(response)
        return _ok({"kind": kind, "name": name, "content": content})

    async def files_delete(request: Request):
        try:
            files.delete(request.path_params["kind"], request.path_params["name"])
        except FileError as exc:
            return _error(str(exc), 404)
        return _ok({"ok": True})

    async def audit_list(request: Request):
        return _ok({"retention_days": audit.retention_days, "entries": audit.entries(limit=500)})

    async def audit_clear(request: Request):
        return _ok({"deleted": audit.clear()})

    def _backups_or_error():
        settings = store.load()
        if not settings.configured:
            return None, None, _error("Bitte zuerst die Ersteinrichtung abschließen", 409)
        return settings, backups_factory(settings), None

    async def backups_list(request: Request):
        settings, backups, problem = _backups_or_error()
        if problem:
            return problem
        try:
            return _ok(await backups.list_backups())
        except (RuntimeError, ValueError) as exc:
            return _error(str(exc), 502)

    async def backups_create(request: Request):
        settings, backups, problem = _backups_or_error()
        if problem:
            return problem
        if not (settings.allow_write and settings.allow_admin_write):
            return _error("Backups anlegen braucht in den Einstellungen 'Konfiguration ändern'", 403)
        try:
            data = await _json_body(request)
            name = str(data.get("name") or "").strip() or time.strftime("MCP %Y-%m-%d %H:%M")
            result = await backups.create_backup(name)
        except SetupError as exc:
            return _error(str(exc))
        except (RuntimeError, ValueError) as exc:
            return _error(str(exc), 502)
        return _ok(result)

    async def backups_delete(request: Request):
        settings, backups, problem = _backups_or_error()
        if problem:
            return problem
        if not (settings.allow_write and settings.allow_admin_write and settings.allow_delete):
            return _error("Backups löschen braucht in den Einstellungen 'Löschen erlauben'", 403)
        backup_id = request.path_params["backup_id"]
        if not BACKUP_ID.fullmatch(backup_id):
            return _error("Ungültige Backup-ID", 400)
        try:
            return _ok(await backups.delete_backup(backup_id))
        except (RuntimeError, ValueError) as exc:
            return _error(str(exc), 502)

    async def backups_download(request: Request):
        settings, backups, problem = _backups_or_error()
        if problem:
            return problem
        backup_id = request.path_params["backup_id"]
        if not BACKUP_ID.fullmatch(backup_id):
            return _error("Ungültige Backup-ID", 400)
        context = backups.download(backup_id)
        try:
            filename, stream = await context.__aenter__()
        except ValueError as exc:
            return _error(str(exc), 404)
        except RuntimeError as exc:
            return _error(str(exc), 502)

        async def body():
            try:
                async for chunk in stream:
                    yield chunk
            finally:
                await context.__aexit__(None, None, None)

        response = StreamingResponse(body(), media_type="application/x-tar",
                                     headers={"Content-Disposition": f'attachment; filename="{filename}"'})
        return _security_headers(response)

    routes = [
        Route("/", index), Route("/static/{name}", static),
        Route("/api/status", status),
        Route("/api/setup/test-ha", test_ha, methods=["POST"]),
        Route("/api/setup/test-ollama", test_ollama, methods=["POST"]),
        Route("/api/setup", save, methods=["POST"]), Route("/api/settings", save, methods=["POST"]),
        Route("/api/chat", chat_start, methods=["POST"]),
        Route("/api/chat/{run_id}/events", chat_events),
        Route("/api/chat/{run_id}/approve", chat_approve, methods=["POST"]),
        Route("/api/chat/{run_id}/cancel", chat_cancel, methods=["POST"]),
        Route("/api/credentials", credentials_list),
        Route("/api/credentials", credentials_save, methods=["POST"]),
        Route("/api/credentials/{alias}", credentials_delete, methods=["DELETE"]),
        Route("/api/files", files_list),
        Route("/api/files/{kind}/{name}", files_get),
        Route("/api/files/{kind}/{name}", files_delete, methods=["DELETE"]),
        Route("/api/audit", audit_list),
        Route("/api/audit", audit_clear, methods=["DELETE"]),
        Route("/api/backups", backups_list),
        Route("/api/backups", backups_create, methods=["POST"]),
        Route("/api/backups/{backup_id}", backups_delete, methods=["DELETE"]),
        Route("/api/backups/{backup_id}/download", backups_download),
    ]

    @asynccontextmanager
    async def lifespan(app):
        yield
        if runs.active is not None:
            runs.cancel(runs.active.id)

    app = Starlette(routes=routes, lifespan=lifespan)
    if bool(public_origin) != bool(access_verifier):
        raise ValueError("Public origin requires Access verification and vice versa")
    return LocalOnlyGuard(app, allowed_hosts=allowed_hosts or LOOPBACK_NAMES, allow_remote=allow_remote,
                          public_origin=public_origin, access_verifier=access_verifier)


def main():
    parser = argparse.ArgumentParser(description="Local web UI: first-run setup and chat with the local model")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--env-file", default=None, help="settings file (default: .env in the project)")
    parser.add_argument("--allow-remote", action="store_true",
                        help="bind beyond loopback; only behind your own authentication")
    parser.add_argument("--public-host", default=None,
                        help="HTTPS hostname behind Cloudflare Access; stays bound to loopback")
    args = parser.parse_args()
    guard_bind_host(args.host, allow_remote=args.allow_remote)
    if args.public_host and (args.allow_remote or not _is_loopback(args.host)):
        raise SystemExit("Cloudflare Access origin must be bound to loopback without --allow-remote")
    if args.public_host and not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", args.public_host):
        raise SystemExit("Invalid public hostname")
    if args.public_host:
        aud = os.environ.get("CF_ACCESS_AUD", "")
        team = os.environ.get("CF_ACCESS_TEAM_DOMAIN", "")
        if not aud or not team:
            raise SystemExit("CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN are required")
        try:
            verifier = AccessTokenVerifier(team, aud)
        except ValueError as exc:
            raise SystemExit(str(exc)) from None
    else:
        verifier = None
    project = Path(__file__).resolve().parents[2]
    env_file = Path(args.env_file) if args.env_file else (project / ".env" if (project / "pyproject.toml").exists()
                                                          else Path.cwd() / ".env")
    import uvicorn

    hosts = ({args.public_host} if args.public_host else LOOPBACK_NAMES | ({args.host} if args.allow_remote else set()))
    app = create_app(SettingsStore(env_file), allowed_hosts=hosts, allow_remote=args.allow_remote,
                     public_origin=f"https://{args.public_host}" if args.public_host else None,
                     access_verifier=verifier)
    display_url = (f"https://{args.public_host}/" if args.public_host else
                   f"http://{'localhost' if _is_loopback(args.host) else args.host}:{args.port}/")
    print(f"ha-safe-mcp UI: {display_url}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", proxy_headers=False,
                server_header=False, date_header=False)


if __name__ == "__main__":
    main()
