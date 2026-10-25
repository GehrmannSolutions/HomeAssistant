"""Backups through Home Assistant's own backup integration (the routes the HA UI uses).

Sources (HA Core 2026.10): components/backup/websocket.py (``backup/info``, ``backup/agents/info``,
``backup/generate``, ``backup/delete``, ``backup/restore``; all ``require_admin``), components/backup/manager.py
(``CoreBackupReaderWriter.async_restore_backup``: writes ``.HA_RESTORE`` and restarts; the result arrives after the
restart as ``last_action_event``), homeassistant/backup_restore.py (keeps ``backups/``) and components/backup/http.py
(``GET /api/backup/download/{backup_id}?agent_id=...``, admin only).

Guardrails:
- read: list backups and agents (admin token in HA, but no change)
- admin write: create a backup on the local agent (``backup.local``); an optional encryption password only as a
  credential reference, scrubbed from every result
- admin write + delete: delete a backup
- download: only for backup IDs that ``backup/info`` lists; streamed to the caller, never kept by the MCP
- restore (delete level): Home Assistant configuration and optionally the database, never add-ons or folders;
  always a fresh local safety backup first (abort if it fails), then HA restarts; the tool waits for the result.
  The chat never runs it without an approval card (see ollama_client.ALWAYS_ASK).
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
LOCAL_AGENTS = (LOCAL_AGENT, "hassio.local")  # Core install, HA OS/Supervised
FIELDS = ("backup_id", "name", "date", "protected", "homeassistant_included", "database_included", "folders",
          "homeassistant_version")
CREATE_TIMEOUT = 600
RESTORE_TIMEOUT = 900
# HA writes collections and registries up to 10 s after a change (helpers/collection.py SAVE_DELAY = 10) and a
# backup does not flush them: wait before the safety backup, or it misses changes made seconds before.
SETTLE_SECONDS = 12
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
        self.restore_timeout = RESTORE_TIMEOUT
        self.settle_seconds = SETTLE_SECONDS
        self.core_state = self._core_state

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
        payload = {"agent_ids": [await self._local_agent()], "name": name.strip(), "include_database": True,
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

    async def _local_agent(self) -> str:
        """The local storage agent: 'backup.local' on Core installs, 'hassio.local' on HA OS/Supervised."""
        agents = await self.ws.command("backup/agents/info")
        ids = [item.get("agent_id") for item in (agents or {}).get("agents", []) if isinstance(item, dict)]
        for preferred in LOCAL_AGENTS:
            if preferred in ids:
                return preferred
        raise RuntimeError("No local backup storage found in Home Assistant (expected backup.local or hassio.local)")

    async def _core_state(self) -> str | None:
        config = await self.client._request("GET", "/api/config", timeout=10)
        return config.get("state") if isinstance(config, dict) else None

    async def _listed(self, backup_id: str) -> tuple[dict, dict]:
        info = await self._info()
        listed = {item.get("backup_id"): item for item in info["backups"] if isinstance(item, dict)}
        if backup_id not in listed:
            raise ValueError("Backup not found: use a backup_id from ha_list_backups")
        return info, listed[backup_id]

    @staticmethod
    def _agent(backup: dict) -> str | None:
        agents = backup.get("agents") if isinstance(backup.get("agents"), dict) else {}
        local = next((agent for agent in LOCAL_AGENTS if agent in agents), None)
        return local or next((a for a in agents if AGENT_ID.fullmatch(str(a))), None)

    @staticmethod
    def restore_impact(backup: dict, restore_database: bool = True) -> list[str]:
        """Plain consequences of restoring this backup (English; shown to the model and on approval cards)."""
        lines = [f"Home Assistant configuration is replaced by the state of {backup.get('date')} "
                 f"(HA {backup.get('homeassistant_version')}); every change made since then is lost.",
                 "The history database is " + ("also replaced by the backup's." if restore_database and
                                               backup.get("database_included") else "kept as it is now."),
                 "Users and long-lived access tokens created after the backup stop working (also this MCP's token, "
                 "if it is newer than the backup).",
                 "A fresh safety backup of the current state is created first; restoring it undoes the restore.",
                 "Home Assistant restarts and is unavailable for a while; add-ons and folders are not touched."]
        return lines

    @staticmethod
    def _database_can_be_kept(agent: str | None, reduced: dict) -> bool:
        """The Supervisor restores HA only with exactly the backup's database choice (hassio/backup.py)."""
        return not (str(agent or "").startswith("hassio.") and reduced.get("database_included"))

    async def get_backup(self, backup_id: str) -> dict:
        backup_id = self._backup_id(backup_id)
        _, backup = await self._listed(backup_id)
        reduced = self._reduce(backup)
        return {"backup": reduced, "restore_impact": self.restore_impact(reduced),
                "database_can_be_kept": self._database_can_be_kept(self._agent(backup), reduced)}

    async def restore_backup(self, backup_id: str, restore_database: bool = True, password=None) -> dict:
        backup_id = self._backup_id(backup_id)
        self._check_delete()
        if not isinstance(restore_database, bool):
            raise ValueError("restore_database must be true or false")
        info, backup = await self._listed(backup_id)
        if info.get("state") not in (None, "idle"):
            raise RuntimeError(f"Backup manager busy ({info.get('state')}); try again later")
        reduced = self._reduce(backup)
        if reduced.get("homeassistant_included") is False:
            raise ValueError("This backup contains no Home Assistant configuration; restore it in Home Assistant")
        if restore_database and reduced.get("database_included") is False:
            raise ValueError("This backup has no database: call again with restore_database=false")
        agent = self._agent(backup)
        if agent is None:
            raise ValueError("Backup has no storage location this MCP can restore from")
        if not restore_database and not self._database_can_be_kept(agent, reduced):
            raise ValueError("On Home Assistant OS the database must be restored together with the configuration "
                             "when the backup contains one: call again with restore_database=true (the history "
                             "since the backup is then lost)")
        used: dict[str, str] = {}
        payload = {"backup_id": backup_id, "agent_id": agent, "restore_homeassistant": True,
                   "restore_database": restore_database}
        if password not in (None, ""):
            if not (isinstance(password, dict) and REF_KEY in password):
                raise ValueError('password must be a credential reference {"$credential": "<alias>", '
                                 '"field": "<field>"} from ha_list_credentials')
            try:
                resolved, used = resolve_refs(self.credentials, {"password": password})
            except CredentialError as exc:
                raise ValueError(f"credential reference problem: {exc}") from None
            payload["password"] = resolved["password"]
        elif reduced.get("protected"):
            raise ValueError("This backup is encrypted: pass its password as a credential reference "
                             '{"$credential": "<alias>", "field": "password"} from ha_list_credentials')

        await asyncio.sleep(self.settle_seconds)
        stamp = time.strftime("%Y-%m-%d %H:%M")
        safety = await self.create_backup(f"Before restore of {backup_id} ({stamp})")
        result = {"backup": reduced, "restore_database": restore_database}
        if not safety.get("completed"):
            return {**result, "restored": False, "safety_backup": None,
                    "reason": "Safety backup failed, nothing was restored: "
                              + str(safety.get("reason") or safety.get("note") or "unknown")}
        result["safety_backup"] = safety["backup"]
        result["undo"] = (f"ha_restore_backup with backup_id={safety['backup']['backup_id']} returns to the state "
                          "right before this restore")
        try:
            await self.ws.command("backup/restore", payload)
        except RuntimeError as exc:
            message = scrub(str(exc), used)
            if "WebSocket error" in message:  # HA refused before restarting: nothing changed
                raise RuntimeError(f"{message}; nothing was restored (safety backup "
                                   f"{safety['backup']['backup_id']} was created)") from None
            # otherwise the connection dropped because HA is restarting into the restore

        deadline = time.monotonic() + self.restore_timeout
        while True:
            await asyncio.sleep(self.poll_interval)
            try:
                event = (await self._info()).get("last_action_event")
            except RuntimeError:
                event = None  # still restarting
            if (isinstance(event, dict) and event.get("manager_state") == "restore_backup"
                    and event.get("state") in ("completed", "failed")):
                ok = event["state"] == "completed"
                ha_state = await self._wait_until_running(deadline)
                return scrub({**result, "restored": ok, "state": event["state"], "ha_state": ha_state,
                              "reason": None if ok else str(event.get("reason") or "unknown")}, used)
            if time.monotonic() >= deadline:
                return {**result, "restored": None, "state": "unknown",
                        "note": "Home Assistant did not report a restore result in time; check ha_list_backups and "
                                "the HA log once it is back."}

    async def _wait_until_running(self, deadline: float) -> str | None:
        """backup/info answers early in the start; integrations (helpers, automations) load later."""
        state = None
        while True:
            try:
                state = await self.core_state()
            except RuntimeError:
                state = None
            if state == "RUNNING" or time.monotonic() >= deadline:
                return state
            await asyncio.sleep(self.poll_interval)

    @asynccontextmanager
    async def download(self, backup_id: str):
        """Yield (filename, async byte iterator) for a listed backup; the MCP never stores the file."""
        backup_id = self._backup_id(backup_id)
        listed = {item.get("backup_id"): item for item in (await self._info())["backups"] if isinstance(item, dict)}
        if backup_id not in listed:
            raise ValueError(L("Backup not found", "Backup nicht gefunden"))
        backup = listed[backup_id]
        agents = backup.get("agents") if isinstance(backup.get("agents"), dict) else {}
        agent = self._agent(backup)
        if agent is None:
            raise ValueError("Backup has no downloadable storage location")
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
