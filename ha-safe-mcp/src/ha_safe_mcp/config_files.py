"""Read and edit Home Assistant configuration files (YAML, packages, templates, custom components).

Access: a local config directory (``HA_CONFIG_DIR``, e.g. the dev container's /config) or, on HA OS/Supervised, the
official File editor add-on (slug ``core_configurator``) through Supervisor ingress (WS ``supervisor/api``:
GET /addons/core_configurator/info, POST /ingress/session; the add-on's API /api/listdir, /api/file, /api/save,
/api/newfolder, /api/delete). Source of the add-on API: hass-configurator's configurator.py.

Safety:
- paths are relative to the config dir; no absolute paths, ``..``, hidden entries (.storage, .cloud, ...), symlinks
  (local), databases, logs, keys/certificates or credential files; ``secrets.yaml`` is never readable or writable;
  only known text extensions; at most MAX_BYTES.
- inline credentials (``password: ...``, ``token``, ``api_key``, URL passwords, JSON keys) are replaced by
  ``__REDACTED_n__`` placeholders before anything reaches a model; writes put the original values back. New
  credentials belong in secrets.yaml (edited by the user) and are referenced with ``!secret``.
- writes need the admin level, deleting the delete level; YAML/JSON is parsed before writing; for YAML files Home
  Assistant's config check runs before and after and a write that adds errors is reverted.
- every write is journaled by the caller (changes.py kind ``file``) with the previous content, so it can be undone.
- nothing is reloaded or restarted here.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path, PurePosixPath
from typing import Awaitable, Callable

import httpx
import yaml

MAX_BYTES = 256_000
TEXT_EXTENSIONS = frozenset({"yaml", "yml", "json", "py", "js", "mjs", "css", "html", "jinja", "jinja2", "j2", "txt",
                             "md", "conf", "csv", "xml", "svg", "sh", "ini", "toml"})
BLOCKED_TOP = frozenset({"deps", "tts", "backups", "image", "__pycache__"})
BLOCKED_WORDS = ("secret", "credential", "service_account", "private", "id_rsa", "id_ed25519")
SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9 _.+@-]{0,99}$")
ADDON = "core_configurator"
ADDON_ROOTS = ("/homeassistant", "/config")

PLACEHOLDER = re.compile(r"__REDACTED_(\d+)__")
SENSITIVE_PARTS = frozenset({"password", "passwd", "passphrase", "pwd", "secret", "token", "apikey", "psk", "pin",
                             "pincode", "passcode"})
SENSITIVE_SUBSTRINGS = ("password", "api_key", "apikey", "private_key", "client_secret", "access_token",
                        "refresh_token", "webhook_id", "auth_key", "secret_key")
YAML_PAIR = re.compile(r"^(?P<lead>[ \t]*(?:-[ \t]+)?)(?P<key>[\"']?[A-Za-z0-9_.\- ]+?[\"']?)(?P<sep>[ \t]*:[ \t]+)"
                       r"(?P<value>[^#\n]*?)(?P<trail>[ \t]+#[^\n]*)?$", re.MULTILINE)
JSON_PAIR = re.compile(r"\"(?P<key>[^\"\n]{1,80})\"(?P<sep>\s*:\s*)\"(?P<value>(?:[^\"\\\n]|\\.)*)\"")
URL_PASSWORD = re.compile(r"(?P<head>\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)(?P<value>[^\s/@]+)(?=@)", re.IGNORECASE)
NOT_SECRET = re.compile(r"^(?:!|\{\{|\{%|[\"']\{|\||>|true$|false$|null$|~$|\"\"$|''$|__REDACTED_)", re.IGNORECASE)
NEXT = ("not active yet: reload the affected part with ha_reload (e.g. 'automation', 'script', 'template', 'all'); "
        "changes to integrations configured in YAML or to homeassistant: need ha_restart")


def _sensitive(key: str) -> bool:
    k = key.strip("\"' ").lower()
    return bool(set(re.split(r"[_.\-\s]+", k)) & SENSITIVE_PARTS) or any(s in k for s in SENSITIVE_SUBSTRINGS)


def mask(text: str) -> tuple[str, dict[int, str]]:
    """Replace inline credentials with numbered placeholders; returns (masked text, number -> original value)."""
    values: dict[int, str] = {}

    def keep(value: str) -> str:
        number = len(values) + 1
        values[number] = value
        return f"__REDACTED_{number}__"

    def url(match):
        return match.group("head") + keep(match.group("value"))

    def pair(match):
        value = match.group("value")
        if not _sensitive(match.group("key")) or not value or NOT_SECRET.match(value):
            return URL_PASSWORD.sub(url, match.group(0))
        return f"{match.group('lead')}{match.group('key')}{match.group('sep')}{keep(value)}{match.group('trail') or ''}"

    def json_pair(match):
        value = match.group("value")
        if not _sensitive(match.group("key")) or not value or PLACEHOLDER.fullmatch(value):
            return match.group(0)
        return f"\"{match.group('key')}\"{match.group('sep')}\"{keep(value)}\""

    out = []
    for line in text.splitlines(keepends=True):
        body, newline = (line[:-1], "\n") if line.endswith("\n") else (line, "")
        stripped = body.lstrip()
        if stripped.startswith("#"):
            out.append(URL_PASSWORD.sub(url, body) + newline)
        elif stripped.startswith(("{", "\"")) or "\": \"" in body or "\":\"" in body:
            out.append(URL_PASSWORD.sub(url, JSON_PAIR.sub(json_pair, body)) + newline)
        else:
            new, count = YAML_PAIR.subn(pair, body)
            out.append((new if count else URL_PASSWORD.sub(url, body)) + newline)
    return "".join(out), values


def unmask(text: str, values: dict[int, str]) -> str:
    unknown = sorted({int(n) for n in PLACEHOLDER.findall(text)} - set(values))
    if unknown:
        raise ValueError(f"unknown placeholder __REDACTED_{unknown[0]}__: credentials cannot be set here; reference "
                         "them with '!secret name' and ask the user to add the value to secrets.yaml")
    return PLACEHOLDER.sub(lambda m: values[int(m.group(1))], text)


def check_path(path) -> str:
    """Validated path relative to the config dir ('' = the config dir itself)."""
    if not isinstance(path, str) or len(path) > 255 or "\\" in path or "\x00" in path:
        raise ValueError("path must be relative to the config directory, e.g. 'packages/heating.yaml'")
    if path in ("", "."):
        return ""
    parts = path.split("/")
    if path.startswith("/") or any(not SEGMENT.match(p) for p in parts):
        raise ValueError("path must be relative to the config directory without '..', hidden entries or empty parts, "
                         "e.g. 'packages/heating.yaml'")
    if parts[0] in BLOCKED_TOP:
        raise ValueError(f"'{parts[0]}/' is not accessible")
    return "/".join(parts)


def readable(path: str) -> bool:
    name = PurePosixPath(path).name.lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    return ext in TEXT_EXTENSIONS and not any(w in name for w in BLOCKED_WORDS) and ".log" not in name \
        and not name.endswith((".db", ".db-wal", ".db-shm"))


def check_file(path) -> str:
    path = check_path(path)
    if not path or not readable(path):
        raise ValueError("not an accessible text file: secrets.yaml, credential and key files, databases and logs are "
                         f"never accessible; allowed extensions: {', '.join(sorted(TEXT_EXTENSIONS))}")
    return path


class _HATagLoader(yaml.SafeLoader):
    """Accepts Home Assistant's YAML tags (!include, !secret, !input, !env_var, ...) for the syntax check."""


def _any_tag(loader, _suffix, node):
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_scalar(node)


_HATagLoader.add_multi_constructor("!", _any_tag)


def check_syntax(path: str, text: str):
    ext = path.rsplit(".", 1)[-1].lower()
    try:
        if ext in ("yaml", "yml"):
            list(yaml.load_all(text, Loader=_HATagLoader))  # noqa: S506 - SafeLoader subclass
        elif ext == "json":
            json.loads(text)
    except (yaml.YAMLError, json.JSONDecodeError) as exc:
        kind = "YAML" if ext in ("yaml", "yml") else "JSON"
        raise ValueError(f"invalid {kind}, nothing written: {str(exc)[:300]}") from None


# ---------------------------------------------------------------- backends
class LocalFiles:
    """A config directory on this machine (dev). Symlinks are never followed."""

    def __init__(self, root):
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise ValueError("HA_CONFIG_DIR is not a directory")

    def _path(self, path: str) -> Path:
        current = self.root
        for part in path.split("/") if path else []:
            current = current / part
            if current.is_symlink():
                raise ValueError("symlinks are not followed")
        return current

    async def listdir(self, path: str) -> list[dict] | None:
        target = self._path(path)
        if not target.is_dir():
            return None
        out = []
        for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if entry.is_symlink():
                continue
            out.append({"name": entry.name, "type": "dir" if entry.is_dir() else "file",
                        "size": entry.stat().st_size if entry.is_file() else None})
        return out

    async def read_raw(self, path: str) -> str | None:
        target = self._path(path)
        if not target.exists():
            return None
        if not target.is_file():
            raise ValueError("not a file")
        if target.stat().st_size > MAX_BYTES:
            raise ValueError(f"file too large (over {MAX_BYTES // 1000} kB)")
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise ValueError("not a UTF-8 text file") from None

    async def write_raw(self, path: str, text: str):
        target = self._path(path)
        current = self.root
        for part in path.split("/")[:-1]:
            current = current / part
            if current.is_symlink():
                raise ValueError("symlinks are not followed")
            current.mkdir(exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".ha-safe-mcp-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    async def delete_raw(self, path: str):
        target = self._path(path)
        if not target.is_file():
            raise ValueError("file not found")
        target.unlink()


class IngressFiles:
    """The File editor add-on through Supervisor ingress (HA OS / Supervised)."""

    def __init__(self, client, ws):
        self.client, self.ws = client, ws
        self.entry: str | None = None
        self.base: str | None = None
        self.session: str | None = None

    async def _connect(self, fresh_session: bool = False):
        if self.entry is None:
            try:
                addons = await self.ws.command("supervisor/api", {"endpoint": "/addons", "method": "get"})
            except RuntimeError as exc:
                if "unknown_command" in str(exc) or "not_found" in str(exc):
                    raise ValueError(NO_ACCESS) from None
                raise
            addon = next((a for a in (addons or {}).get("addons", []) if a.get("slug") == ADDON), None)
            if addon is None:
                raise ValueError(NO_ACCESS)
            if addon.get("state") != "started":
                raise ValueError("the File editor add-on is installed but not started; start it in Home Assistant")
            info = await self.ws.command("supervisor/api", {"endpoint": f"/addons/{ADDON}/info", "method": "get"})
            if not info.get("ingress") or not str(info.get("ingress_entry", "")).startswith("/api/hassio_ingress/"):
                raise ValueError("the File editor add-on has no ingress entry")
            self.entry = info["ingress_entry"].rstrip("/")
        if self.session is None or fresh_session:
            result = await self.ws.command("supervisor/api", {"endpoint": "/ingress/session", "method": "post"})
            self.session = result["session"]

    async def _call(self, method: str, api: str, *, params=None, form=None) -> httpx.Response:
        await self._connect()
        for attempt in (0, 1):
            async with httpx.AsyncClient(base_url=self.client.url, timeout=30, trust_env=False,
                                         cookies={"ingress_session": self.session}) as http:
                response = await http.request(method, f"{self.entry}/api/{api}", params=params, data=form)
            if response.status_code in (401, 403) and attempt == 0:
                await self._connect(fresh_session=True)
                continue
            if response.status_code != 200:
                raise RuntimeError(f"File editor add-on returned HTTP {response.status_code}")
            return response
        raise RuntimeError("File editor add-on: no session")

    async def _root(self) -> str:
        if self.base is None:
            for root in ADDON_ROOTS:
                if await self._list_abs(root) is not None:
                    self.base = root
                    break
            else:
                raise RuntimeError("File editor add-on: config directory not found")
        return self.base

    async def _list_abs(self, path: str) -> list[dict] | None:
        data = (await self._call("GET", "listdir", params={"path": path})).json()
        if not isinstance(data, dict) or data.get("error") or not isinstance(data.get("content"), list):
            return None
        return data["content"]

    async def _abs(self, path: str) -> str:
        root = await self._root()
        return f"{root}/{path}" if path else root

    async def listdir(self, path: str) -> list[dict] | None:
        items = await self._list_abs(await self._abs(path))
        if items is None:
            return None
        return [{"name": i.get("name"), "type": "dir" if i.get("type") == "dir" else "file",
                 "size": i.get("size") if i.get("type") != "dir" else None} for i in items if isinstance(i, dict)]

    async def _entry(self, path: str) -> dict | None:
        parent, _, name = path.rpartition("/")
        items = await self.listdir(parent)
        return next((i for i in items or [] if i["name"] == name), None)

    async def read_raw(self, path: str) -> str | None:
        entry = await self._entry(path)
        if entry is None:
            return None
        if entry["type"] != "file":
            raise ValueError("not a file")
        if (entry.get("size") or 0) > MAX_BYTES:
            raise ValueError(f"file too large (over {MAX_BYTES // 1000} kB)")
        return (await self._call("GET", "file", params={"filename": await self._abs(path)})).text

    async def _post(self, api: str, form: dict):
        data = (await self._call("POST", api, form=form)).json()
        if not isinstance(data, dict) or data.get("error") is not False:
            raise RuntimeError(f"File editor add-on: {str((data or {}).get('message', 'failed'))[:200]}")

    async def write_raw(self, path: str, text: str):
        parts = path.split("/")
        for depth in range(1, len(parts)):
            parent, name = "/".join(parts[:depth - 1]), parts[depth - 1]
            existing = await self._entry(f"{parent}/{name}" if parent else name)
            if existing is None:
                await self._post("newfolder", {"path": await self._abs(parent), "name": name})
            elif existing["type"] != "dir":
                raise ValueError(f"'{name}' is a file, not a folder")
        await self._post("save", {"filename": await self._abs(path), "text": text})

    async def delete_raw(self, path: str):
        entry = await self._entry(path)
        if entry is None or entry["type"] != "file":
            raise ValueError("file not found")
        await self._post("delete", {"path": await self._abs(path)})


NO_ACCESS = ("no access to configuration files: set HA_CONFIG_DIR to the config directory (dev/container) or install "
             "and start the official File editor add-on (HA OS / Supervised)")


# ---------------------------------------------------------------- tools
class ConfigFiles:
    def __init__(self, client, ws, *, allow_admin_write: bool, allow_delete: bool, backend=None,
                 checker: Callable[[], Awaitable[dict]] | None = None):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete
        self._backend = backend
        self.checker = checker

    @property
    def backend(self):
        if self._backend is None:
            directory = os.environ.get("HA_CONFIG_DIR", "").strip()
            self._backend = LocalFiles(directory) if directory else IngressFiles(self.client, self.ws)
        return self._backend

    def _check_admin(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("editing configuration files needs the admin level (HA_ALLOW_WRITE and "
                             "HA_ALLOW_ADMIN_WRITE)")

    # ------------------------------------------------------------------ read
    async def list(self, path: str = "") -> dict:
        path = check_path(path)
        items = await self.backend.listdir(path)
        if items is None:
            raise ValueError("folder not found")
        entries = []
        for item in items:
            name = str(item.get("name", ""))
            if not SEGMENT.match(name) or (not path and name in BLOCKED_TOP):
                continue
            entry = {"name": name, "type": item["type"]}
            if item["type"] == "file":
                entry.update(size=item.get("size"), readable=readable(name))
            entries.append(entry)
        return {"path": path or ".", "entries": entries[:500]}

    async def read_raw(self, path: str) -> str | None:
        """Unmasked content for the journal (never returned to a model)."""
        return await self.backend.read_raw(check_file(path))

    async def read(self, path: str) -> dict:
        path = check_file(path)
        text = await self.backend.read_raw(path)
        if text is None:
            raise ValueError("file not found")
        masked, values = mask(text)
        return {"path": path, "lines": text.count("\n"), "redacted": len(values), "content": masked}

    # ------------------------------------------------------------------ write
    async def _check(self) -> dict | None:
        if self.checker is None:
            return None
        result = await self.checker()
        return {"result": result.get("result"), "errors": result.get("errors"), "warnings": result.get("warnings")}

    async def _store(self, path: str, before: str | None, after: str) -> dict:
        if not after.strip():
            raise ValueError("empty content: use ha_delete_config_file to remove a file")
        if len(after.encode("utf-8")) > MAX_BYTES:
            raise ValueError(f"content too large (over {MAX_BYTES // 1000} kB)")
        check_syntax(path, after)
        is_yaml = path.endswith((".yaml", ".yml"))
        before_check = await self._check() if is_yaml else None
        await self.backend.write_raw(path, after)
        result = {"path": path, "written": True, "created": before is None, "lines": after.count("\n")}
        if is_yaml and before_check is not None:
            after_check = await self._check()
            new_errors = after_check["result"] != "valid" and (
                before_check["result"] == "valid" or after_check["errors"] != before_check["errors"])
            # e.g. a package with an unknown integration: HA says "valid" and only warns
            new_warnings = bool(after_check["warnings"]) and after_check["warnings"] != before_check["warnings"]
            if new_errors or new_warnings:
                problem = (f"error: {after_check['errors']}" if new_errors else f"warning: {after_check['warnings']}")
                if before is None:
                    await self.backend.delete_raw(path)
                    raise ValueError(f"Home Assistant config check reported a new {problem[:500]} - the new file was "
                                     "removed again")
                await self.backend.write_raw(path, before)
                raise ValueError(f"Home Assistant config check reported a new {problem[:500]} - the previous file "
                                 "was restored")
            if after_check["result"] != "valid" or after_check["warnings"]:
                after_check["note"] = "these errors or warnings existed before this change"
            result["config_check"] = after_check
        result["next"] = NEXT
        return result

    async def write(self, path: str, content: str) -> dict:
        self._check_admin()
        path = check_file(path)
        if not isinstance(content, str):
            raise ValueError("content must be text")
        before = await self.backend.read_raw(path)
        _, values = mask(before or "")
        return await self._store(path, before, unmask(content, values))

    async def edit(self, path: str, old_text: str, new_text: str, replace_all: bool = False) -> dict:
        self._check_admin()
        path = check_file(path)
        if not isinstance(old_text, str) or not old_text or not isinstance(new_text, str):
            raise ValueError("old_text (non-empty, copied from ha_read_config_file) and new_text are required")
        before = await self.backend.read_raw(path)
        if before is None:
            raise ValueError("file not found: create it with ha_write_config_file")
        masked, values = mask(before)
        count = masked.count(old_text)
        if count == 0:
            raise ValueError("old_text not found: copy it exactly from ha_read_config_file (including indentation)")
        if count > 1 and not replace_all:
            raise ValueError(f"old_text found {count} times: add surrounding lines to make it unique or set "
                             "replace_all=true")
        result = await self._store(path, before, unmask(masked.replace(old_text, new_text), values))
        return {**result, "replaced": count}

    async def delete(self, path: str) -> dict:
        self._check_admin()
        if not self.allow_delete:
            raise ValueError("deleting files needs the delete level (HA_ALLOW_DELETE)")
        path = check_file(path)
        await self.backend.delete_raw(path)
        return {"path": path, "deleted": True, "next": NEXT}

    # ------------------------------------------------------------------ undo (changes.py)
    async def restore(self, path: str, before) -> dict:
        path = check_file(path)
        if before is None:
            if await self.backend.read_raw(path) is None:
                return {"path": path, "deleted": False, "note": "already gone"}
            return await self.delete(path)
        self._check_admin()
        await self.backend.write_raw(path, before["content"])
        return {"path": path, "restored": True, "next": NEXT}
