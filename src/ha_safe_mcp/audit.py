"""GDPR-minded audit log of the traffic between this MCP server and Home Assistant.

Data minimisation by construction: a record holds only allowlisted metadata (time, tool, channel,
method, route *template*, status, duration, exception class). Entity IDs, person names, payloads,
answers, prompts and tokens never reach the file: route segments are replaced by placeholders and
unknown fields are dropped. Storage limitation: one JSONL file per UTC day, files older than the
retention period (30 days) are deleted on every write and read; ``clear`` deletes everything.
Files are local only (directory 0700, files 0600).
"""

import contextvars
import json
import os
import re
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RETENTION_DAYS = 30
FILE = re.compile(r"^audit-(\d{4}-\d{2}-\d{2})\.jsonl$")
TOOL = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
WS_TYPE = re.compile(r"^[a-z_]+(?:/[a-z_]+){0,3}$")
ENTITY = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_]+$")
IDENT = re.compile(r"^[a-z][a-z0-9_]*$")
METHODS = frozenset({"GET", "POST", "DELETE", "PUT", "PATCH", "WS"})
CHANNELS = frozenset({"rest", "ws"})
KINDS = frozenset({"ha", "tool"})
# Path words of HA's API that carry no personal data; every other segment becomes a placeholder.
STATIC = frozenset({"api", "states", "services", "config", "automation", "config_entries", "flow", "entry",
                    "reload", "flow_handlers", "history", "period", "logbook", "camera_proxy", "calendars",
                    "template", "core", "check_config", "error_log", "events", "intent", "handle", "components",
                    "websocket", "backup", "subentries", "options"})

current_tool: contextvars.ContextVar[str | None] = contextvars.ContextVar("ha_mcp_current_tool", default=None)


def default_directory() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "ha-safe-mcp" / "audit"


def route_template(route: str) -> str:
    """'/api/states/person.alex?x' -> '/api/states/{entity_id}'; WS command types stay as they are."""
    route = route.split("?", 1)[0]
    if not route.startswith("/"):
        return route if WS_TYPE.fullmatch(route) else "{ws}"
    parts, out = route.strip("/").split("/"), []
    for index, part in enumerate(parts):
        previous = parts[index - 1] if index else ""
        before = parts[index - 2] if index > 1 else ""
        if part in STATIC:
            out.append(part)
        elif (previous == "services" or before == "services" or previous == "events") and IDENT.fullmatch(part):
            out.append(part)  # domain/service and event type names: technical, not personal
        elif ENTITY.fullmatch(part):
            out.append("{entity_id}")
        else:
            out.append("{id}")
    return "/" + "/".join(out)


class AuditLog:
    def __init__(self, directory: Path | None = None, *, retention_days: int = RETENTION_DAYS,
                 now: Callable[[], datetime] | None = None):
        self.directory = Path(directory) if directory else default_directory()
        self.retention_days = retention_days
        self._now = now or (lambda: datetime.now(timezone.utc))

    def _ensure(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)

    def _files(self) -> list[tuple[date, Path]]:
        if not self.directory.is_dir():
            return []
        found = []
        for path in self.directory.iterdir():
            match = FILE.fullmatch(path.name)
            if match and path.is_file() and not path.is_symlink():
                try:
                    found.append((date.fromisoformat(match.group(1)), path))
                except ValueError:
                    continue
        return sorted(found)

    def purge(self) -> int:
        cutoff = self._now().date() - timedelta(days=self.retention_days)
        removed = 0
        for day, path in self._files():
            if day < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def record(self, *, kind: str, tool: str | None = None, channel: str | None = None,
               method: str | None = None, route: str | None = None, status: int | None = None,
               ok: bool = True, ms: float = 0, error: str | None = None, **_ignored) -> None:
        """Write one record; any extra keyword (payloads, prompts) is ignored on purpose."""
        moment = self._now().astimezone(timezone.utc)
        entry: dict = {"ts": moment.strftime("%Y-%m-%dT%H:%M:%SZ"), "kind": kind if kind in KINDS else "ha"}
        if tool and TOOL.fullmatch(tool):
            entry["tool"] = tool
        if channel in CHANNELS:
            entry["channel"] = channel
        if method and method.upper() in METHODS:
            entry["method"] = method.upper()
        if route:
            entry["route"] = route_template(route)
        if isinstance(status, int):
            entry["status"] = status
        entry["ok"] = bool(ok)
        entry["ms"] = int(round(max(0.0, float(ms))))
        if error:
            name = error.split(":", 1)[0].strip()
            entry["error"] = name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name) else "Error"
        self._ensure()
        self.purge()
        path = self.directory / f"audit-{moment.date().isoformat()}.jsonl"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, (json.dumps(entry, separators=(",", ":")) + "\n").encode())
        finally:
            os.close(fd)

    def entries(self, limit: int = 1000) -> list[dict]:
        """Newest first."""
        self.purge()
        result: list[dict] = []
        for _, path in reversed(self._files()):
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            for line in reversed(lines):
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict):
                    result.append(item)
                if len(result) >= limit:
                    return result
        return result

    def clear(self) -> int:
        count = 0
        for _, path in self._files():
            count += sum(1 for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line)
            path.unlink(missing_ok=True)
        return count


def audit_from_env() -> AuditLog | None:
    """MCP server side: log only when the operator did not switch it off."""
    if os.getenv("HA_AUDIT", "true").lower() == "false":
        return None
    directory = os.getenv("HA_AUDIT_DIR")
    return AuditLog(Path(directory)) if directory else AuditLog()
