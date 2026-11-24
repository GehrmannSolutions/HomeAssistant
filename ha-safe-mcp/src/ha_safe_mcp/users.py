"""Home Assistant users (Settings > People > Users): list, create, change, delete.

Source: HA Core 2026.11 components/config/auth.py (``config/auth/list|create|update|delete``, all require_admin)
and components/config/auth_provider_homeassistant.py (``config/auth_provider/homeassistant/create`` adds the
username/password login to a user). Groups: ``system-admin``, ``system-users`` (and ``system-read-only``).

Passwords never pass through a model: a login password is accepted only as a credential reference
{"$credential": alias, "field": name} from the local credential store, resolved right before the one call and
scrubbed from every answer. No tool reads or changes an existing password. The owner, system-generated users
(Supervisor, add-ons) and the user this MCP's token belongs to are protected against lock-out changes.
"""
from __future__ import annotations

import re

from .credentials import REF_KEY, CredentialError, CredentialStore, resolve_refs, scrub

ADMIN_GROUP, USER_GROUP = "system-admin", "system-users"
USER_ID = re.compile(r"^[0-9a-f]{32}$")
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._@-]{0,63}$")
UPDATE_FIELDS = ("active", "admin", "local_only", "name")
PASSWORD_REF = '{"$credential": "<alias>", "field": "password"}'


class HAUsers:
    def __init__(self, client, ws, *, allow_admin_write: bool = False, allow_delete: bool = False,
                 credentials: CredentialStore | None = None):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete
        self.credentials = credentials or CredentialStore()

    # ------------------------------------------------------------------ helpers
    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    async def _raw(self) -> list[dict]:
        items = await self.ws.command("config/auth/list")
        if not isinstance(items, list):
            raise RuntimeError("Unexpected Home Assistant response")
        return [u for u in items if isinstance(u, dict) and isinstance(u.get("id"), str)]

    async def _self_id(self) -> str | None:
        try:
            me = await self.ws.command("auth/current_user")
        except RuntimeError:
            return None
        return me.get("id") if isinstance(me, dict) else None

    @staticmethod
    def _view(item: dict, self_id: str | None = None) -> dict:
        groups = item.get("group_ids") or []
        view = {"user_id": item["id"], "name": item.get("name"), "username": item.get("username"),
                "admin": ADMIN_GROUP in groups or bool(item.get("is_owner")), "owner": bool(item.get("is_owner")),
                "active": bool(item.get("is_active")), "local_only": bool(item.get("local_only")),
                "can_log_in": bool(item.get("username"))}
        if "system-read-only" in groups:
            view["read_only"] = True
        if item.get("system_generated"):
            view["system_generated"] = True
        if self_id and item["id"] == self_id:
            view["this_mcp"] = True
        return view

    async def find(self, user: str) -> dict:
        """A user by user_id, name or username (case-insensitive); errors list the existing names."""
        if not isinstance(user, str) or not user.strip():
            raise ValueError("user: a user_id, name or username from ha_list_users")
        items = await self._raw()
        needle = user.strip().casefold()
        hits = [u for u in items if u["id"] == user.strip()] or \
               [u for u in items if needle in (str(u.get("name") or "").casefold(),
                                               str(u.get("username") or "").casefold())]
        if len(hits) == 1:
            return hits[0]
        names = ", ".join(sorted(str(u.get("name")) for u in items if not u.get("system_generated")))
        if not hits:
            raise ValueError(f"no user '{user}'. Users: {names}. Use a name or user_id from ha_list_users.")
        raise ValueError(f"'{user}' matches {len(hits)} users; use the user_id from ha_list_users")

    # ------------------------------------------------------------------ read
    async def list_users(self, include_system: bool = False) -> dict:
        self_id = await self._self_id()
        users = [self._view(u, self_id) for u in await self._raw() if include_system or not u.get("system_generated")]
        result = {"users": users, "count": len(users)}
        if not include_system:
            result["note"] = ("system users of Home Assistant itself (Supervisor, add-ons) are hidden; "
                              "include_system=true lists them")
        return result

    async def capture(self, user_id: str) -> dict | None:
        """Journal state of one user (no credentials)."""
        item = next((u for u in await self._raw() if u["id"] == user_id), None)
        if item is None:
            return None
        return {"name": item.get("name"), "is_active": bool(item.get("is_active")),
                "group_ids": list(item.get("group_ids") or []), "local_only": bool(item.get("local_only"))}

    # ------------------------------------------------------------------ write
    async def create_user(self, name: str, username: str = "", password=None, admin: bool = False,
                          local_only: bool = False) -> dict:
        self._check_write()
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 100:
            raise ValueError("name: 1-100 characters, e.g. 'Wall tablet'")
        name = name.strip()
        username = (username or "").strip()
        if username and password in (None, ""):
            raise ValueError("a login needs a password as credential reference " + PASSWORD_REF + " from "
                             "ha_list_credentials (the user stores it under 'Credentials' first); without username "
                             "and password the user is created without login")
        if password not in (None, "") and not username:
            raise ValueError("password given without username: pass the username the person types to log in")
        if password not in (None, "") and not (isinstance(password, dict) and REF_KEY in password):
            raise ValueError("password must be a credential reference " + PASSWORD_REF + " from "
                             "ha_list_credentials; never the password itself")
        if username and not USERNAME.fullmatch(username.casefold()):
            raise ValueError("username: lowercase letters, digits and . _ @ - (max. 64), e.g. 'wall_tablet'")
        items = await self._raw()
        if any(str(u.get("name") or "").casefold() == name.casefold() for u in items):
            raise ValueError(f"a user named '{name}' already exists; pick another name or change that user "
                             "with ha_update_user")
        if username and any(str(u.get("username") or "").casefold() == username.casefold() for u in items):
            raise ValueError(f"username '{username}' is already taken; pick another one")
        used: dict[str, str] = {}
        secret = None
        if username:
            try:
                resolved, used = resolve_refs(self.credentials, {"password": password})
            except CredentialError as exc:
                raise ValueError(f"credential reference problem: {exc}. Check the alias with "
                                 "ha_list_credentials.") from None
            secret = resolved["password"]
        created = await self.ws.command("config/auth/create", {
            "name": name, "group_ids": [ADMIN_GROUP if admin else USER_GROUP], "local_only": bool(local_only)})
        new = (created or {}).get("user") if isinstance(created, dict) else None
        if not isinstance(new, dict) or not isinstance(new.get("id"), str):
            raise RuntimeError("Unexpected Home Assistant response")
        result: dict = {}
        if username:
            try:
                await self.ws.command("config/auth_provider/homeassistant/create",
                                      {"user_id": new["id"], "username": username.casefold(), "password": secret})
            except RuntimeError as exc:
                result["login_error"] = scrub(str(exc), used)
                result["hint"] = ("the user was created WITHOUT login. Remove it with ha_delete_user and try again "
                                  "with another username, or add the login in Settings > People.")
        item = next((u for u in await self._raw() if u["id"] == new["id"]), new)
        result = {"user": self._view(item), **result}
        if not username:
            result["note"] = ("user created with no login (cannot sign in). For a login pass username and password "
                              "as credential reference.")
        else:
            result["next"] = ("the person signs in with this username; a dashboard for this user: "
                              "ha_create_dashboard, a person for presence: Settings > People")
        return scrub(result, used)

    def _check_protected(self, item: dict, self_id: str | None, *, deleting: bool = False, changes: dict | None = None):
        changes = changes or {}
        if item.get("system_generated"):
            raise ValueError("this is a system user of Home Assistant (Supervisor, add-on); it cannot be changed")
        locking = deleting or changes.get("active") is False or changes.get("admin") is False
        if item.get("is_owner") and (deleting or changes.get("active") is False or "admin" in changes):
            raise ValueError("the owner cannot be deleted, deactivated or lose admin rights")
        if self_id and item["id"] == self_id and locking:
            raise ValueError("this is the user of this MCP's own token: deleting, deactivating it or removing "
                             "admin would lock the MCP out")

    async def update_user(self, user: str, changes: dict) -> dict:
        self._check_write()
        if not isinstance(changes, dict) or not changes or not changes.keys() <= set(UPDATE_FIELDS):
            raise ValueError(f"changes: allowed: {', '.join(UPDATE_FIELDS)} (passwords are never changed here)")
        item = await self.find(user)
        self._check_protected(item, await self._self_id(), changes=changes)
        payload: dict = {"user_id": item["id"]}
        if "admin" in changes:
            if not isinstance(changes["admin"], bool):
                raise ValueError("admin: true or false")
            groups = [g for g in item.get("group_ids") or [] if g not in (ADMIN_GROUP, USER_GROUP)]
            payload["group_ids"] = [ADMIN_GROUP if changes["admin"] else USER_GROUP] + groups
        if "name" in changes:
            if not isinstance(changes["name"], str) or not 1 <= len(changes["name"].strip()) <= 100:
                raise ValueError("name: 1-100 characters")
            payload["name"] = changes["name"].strip()
        for key, ha_key in (("active", "is_active"), ("local_only", "local_only")):
            if key in changes:
                if not isinstance(changes[key], bool):
                    raise ValueError(f"{key}: true or false")
                payload[ha_key] = changes[key]
        await self.ws.command("config/auth/update", payload)
        after = next((u for u in await self._raw() if u["id"] == item["id"]), None)
        return {"user": self._view(after or item), "changed": sorted(changes)}

    async def delete_user(self, user: str) -> dict:
        self._check_delete()
        item = await self.find(user)
        self._check_protected(item, await self._self_id(), deleting=True)
        await self.ws.command("config/auth/delete", {"user_id": item["id"]})
        return {"deleted": item["id"], "name": item.get("name"),
                "note": "the user and its login are gone; a person linked to it stays (Settings > People)"}

    # ------------------------------------------------------------------ undo
    async def restore(self, user_id: str, before: dict | None) -> tuple[dict, str]:
        """Write a journaled state back: None = the change created the user, so it is removed again."""
        if before is None:
            self._check_delete()
            await self.ws.command("config/auth/delete", {"user_id": user_id})
            return {"deleted": user_id}, user_id
        self._check_write()
        if any(u["id"] == user_id for u in await self._raw()):
            payload = {"user_id": user_id}
            payload.update({k: before[k] for k in ("name", "is_active", "group_ids", "local_only") if k in before})
            await self.ws.command("config/auth/update", payload)
            return {"restored": user_id}, user_id
        created = await self.ws.command("config/auth/create", {
            "name": before.get("name") or "restored user", "group_ids": before.get("group_ids") or [USER_GROUP],
            "local_only": bool(before.get("local_only"))})
        new_id = created["user"]["id"]
        if before.get("is_active") is False:
            await self.ws.command("config/auth/update", {"user_id": new_id, "is_active": False})
        return {"recreated": new_id, "note": "recreated with a new user_id and WITHOUT login: a password cannot be "
                                             "restored; add the login in Settings > People"}, new_id
