"""Backups through Home Assistant's own backup integration (the routes the HA UI uses).

Sources (HA Core 2026.10): components/backup/websocket.py (``backup/info``, ``backup/agents/info``,
``backup/generate``, ``backup/delete``; all ``require_admin``) and components/backup/http.py
(``GET /api/backup/download/{backup_id}?agent_id=...``, admin only).

Guardrails:
- read: list backups and agents (admin token in HA, but no change)
- admin write: create a backup on the local agent (``backup.local``); an optional encryption password only as a
  credential reference, scrubbed from every result
- admin write + delete: delete a backup
- download: only for backup IDs that ``backup/info`` lists; streamed to the caller, never kept by the MCP
- **no restore**: a restore replaces the running configuration and restarts HA; it stays in the HA UI.
"""

import asyncio
import re
import time
from contextlib import asynccontextmanager

import httpx

from .credentials import CredentialError, CredentialStore, REF_KEY, resolve_refs, scrub
from .server import HAClient
from .i18n import L

BACKUP_ID = re.compile(r"^[0-9a-z]{6,64}$")
AGENT_ID = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9_\-]+$")
NAME = re.compile(r"^[^\x00-\x1f\x7f]{1,100}$")
LOCAL_AGENT = "backup.local"
FIELDS = ("backup_id", "name", "date", "protected", "homeassistant_included", "database_included", "folders",
          "homeassistant_version")
CREATE_TIMEOUT = 600
DOWNLOAD_TIMEOUT = 1800


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "backup"


class HABackups:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 credentials: CredentialStore | None = None, poll_interval: float = 2.0):
        self.client = client
        self.ws = ws
        self.allow_admin_write = allow_admin_write
        self.allow_delete = allow_delete
        self.credentials = credentials or CredentialStore()
        self.poll_interval = poll_interval
        self.timeout = CREATE_TIMEOUT

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    @staticmethod
    def _backup_id(backup_id: str) -> str:
        if not isinstance(backup_id, str) or not BACKUP_ID.fullmatch(backup_id):
            raise ValueError("invalid backup_id: use the backup_id from ha_list_backups")
        return backup_id

    @staticmethod
    def _reduce(backup: dict) -> dict:
        agents = backup.get("agents") if isinstance(backup.get("agents"), dict) else {}
        sizes = [item.get("size") for item in agents.values() if isinstance(item, dict)]
        reduced = {key: backup.get(key) for key in FIELDS[:5]}
        if not isinstance(reduced.get("protected"), bool):
            reduced["protected"] = any(isinstance(item, dict) and item.get("protected") is True
                                       for item in agents.values())
        reduced["size"] = next((size for size in sizes if isinstance(size, int)), None)
        reduced["agents"] = sorted(agent for agent in agents if isinstance(agent, str))
        reduced.update({key: backup.get(key) for key in FIELDS[5:]})
        return reduced

    async def _info(self) -> dict:
        info = await self.ws.command("backup/info")
        if not isinstance(info, dict) or not isinstance(info.get("backups"), list):
            raise RuntimeError("Unexpected Home Assistant response")
        return info

    async def list_backups(self) -> dict:
        info = await self._info()
        agents = await self.ws.command("backup/agents/info")
        agent_ids = [item.get("agent_id") for item in (agents or {}).get("agents", []) if isinstance(item, dict)]
        backups = [self._reduce(item) for item in info["backups"] if isinstance(item, dict)]
        return {"state": info.get("state"), "agents": [a for a in agent_ids if isinstance(a, str)],
                "backups": sorted(backups, key=lambda item: str(item.get("date") or ""), reverse=True),
                "last_completed_automatic_backup": info.get("last_completed_automatic_backup"),
                "next_automatic_backup": info.get("next_automatic_backup")}

    async def create_backup(self, name: str, password=None) -> dict:
        self._check_write()
        if not isinstance(name, str) or not NAME.fullmatch(name.strip() or "\x00"):
            raise ValueError("invalid name: 1-100 printable characters")
        payload = {"agent_ids": [LOCAL_AGENT], "name": name.strip(), "include_database": True,
                   "include_homeassistant": True}
        used: dict[str, str] = {}
        if password not in (None, ""):
            if not (isinstance(password, dict) and REF_KEY in password):
                raise ValueError('password must be a credential reference {"$credential": "<alias>", '
                                 '"field": "<field>"} from ha_list_credentials')
            try:
                resolved, used = resolve_refs(self.credentials, {"password": password})
            except CredentialError as exc:
                raise ValueError(f"credential reference problem: {exc}") from None
            payload["password"] = resolved["password"]
        before = {item.get("backup_id") for item in (await self._info())["backups"] if isinstance(item, dict)}
        try:
            await self.ws.command("backup/generate", payload)
        except RuntimeError as exc:
            raise RuntimeError(scrub(str(exc), used)) from None
        deadline = time.monotonic() + self.timeout
        while True:
            info = await self._info()
            new = [item for item in info["backups"] if isinstance(item, dict) and item.get("backup_id") not in before]
            if new:
                return scrub({"completed": True, "backup": self._reduce(new[0])}, used)
            event = info.get("last_action_event") if isinstance(info.get("last_action_event"), dict) else {}
            if event.get("state") == "failed":
                return {"completed": False, "backup": None, "reason": str(event.get("reason") or "unknown")}
            if time.monotonic() >= deadline:
                return {"completed": False, "backup": None,
                        "note": L("Backup still running; check later with ha_list_backups.",
                                  "Backup läuft noch; später mit ha_list_backups prüfen.")}
            await asyncio.sleep(self.poll_interval)

    async def delete_backup(self, backup_id: str) -> dict:
        backup_id = self._backup_id(backup_id)
        self._check_delete()
        result = await self.ws.command("backup/delete", {"backup_id": backup_id})
        errors = result.get("agent_errors") if isinstance(result, dict) else {}
        return {"deleted": not errors, "agent_errors": {str(k): "error" for k in (errors or {})}}

    @asynccontextmanager
    async def download(self, backup_id: str):
        """Yield (filename, async byte iterator) for a listed backup; the MCP never stores the file."""
        backup_id = self._backup_id(backup_id)
        listed = {item.get("backup_id"): item for item in (await self._info())["backups"] if isinstance(item, dict)}
        if backup_id not in listed:
            raise ValueError(L("Backup not found", "Backup nicht gefunden"))
        backup = listed[backup_id]
        agents = backup.get("agents") if isinstance(backup.get("agents"), dict) else {}
        agent = LOCAL_AGENT if LOCAL_AGENT in agents else next((a for a in agents if AGENT_ID.fullmatch(str(a))), None)
        if agent is None:
            raise ValueError("Backup hat keinen herunterladbaren Speicherort")
        filename = f"{_slug(str(backup.get('name') or ''))}-{backup_id}.tar"
        started, status, error = time.monotonic(), None, None
        try:
            async with httpx.AsyncClient(base_url=self.client.url, timeout=DOWNLOAD_TIMEOUT, trust_env=False,
                                         follow_redirects=False,
                                         headers={"Authorization": f"Bearer {self.client.token}"}) as http:
                async with http.stream("GET", f"/api/backup/download/{backup_id}",
                                       params={"agent_id": agent}) as response:
                    status = response.status_code
                    if response.status_code != 200:
                        error = "HTTPStatusError"
                        raise RuntimeError(f"Home Assistant returned HTTP {response.status_code}")
                    yield filename, response.aiter_bytes()
        except httpx.RequestError as exc:
            error = type(exc).__name__
            raise RuntimeError(f"Home Assistant request failed ({type(exc).__name__})") from None
        finally:
            self.client.log(channel="rest", method="GET", route=f"/api/backup/download/{backup_id}",
                            status=status, ok=error is None, ms=(time.monotonic() - started) * 1000, error=error)
