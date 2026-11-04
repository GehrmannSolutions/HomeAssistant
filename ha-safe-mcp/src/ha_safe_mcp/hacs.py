"""HACS (Home Assistant Community Store) and, from Home Assistant 2026.11, the built-in Marketplace that replaced
it: search, details, install/update, remove, custom repositories - the same tools for both stores.

Sources: the HACS integration 2.0.5, custom_components/hacs/websocket/{repositories,repository}.py
(``hacs/repositories/list``, ``hacs/repository/info`` {repository_id}, ``hacs/repository/download`` {repository,
version?}, ``hacs/repository/remove`` {repository}, ``hacs/repositories/add`` {repository, category}; all admin) and
HA Core 2026.11 components/marketplace/websocket/{repositories,repository}.py (``marketplace/repositories/list``,
``marketplace/repository/info``, ``marketplace/repository/install``, ``marketplace/repository/uninstall``,
``marketplace/repositories/add``; install/add refuse with ``warning_not_accepted`` until an administrator accepted
the Marketplace notice in the UI, custom repositories also need its GitHub connection: ``github_not_connected``).
The store is detected per call: the Marketplace first, HACS for older Home Assistant versions. Both register the
dashboard resource of a card themselves (HACS under /hacsfiles/, the Marketplace under /local/community/).

Guardrails:
- read: search and details (incl. stars, last update, whether HACS can download it for this HA version)
- admin write: install/update (third-party code; in the web UI chat always with an approval card) and adding a
  custom repository (GitHub only); the result is read back
- admin write + delete: remove an installed repository
- install/update/remove are journaled (kind ``hacs``): undo removes a new install or goes back to the previous
  version
"""
from __future__ import annotations

import re

from .server import HAClient

CATEGORIES = ("integration", "plugin", "theme", "python_script", "template", "appdaemon", "netdaemon")
MARKETPLACE_CATEGORIES = ("integration", "plugin", "theme", "template")   # marketplace/info on 2026.11.0b6
FIELDS = ("id", "full_name", "name", "category", "description", "stars", "downloads", "installed",
          "installed_version", "available_version", "pending_upgrade", "last_updated", "custom", "can_download",
          "homeassistant", "authors", "topics")
FULL_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
FILLER = {"card", "cards", "karte", "karten", "hacs", "for", "the", "a", "an", "and", "with", "für", "fur", "die",
          "der", "das", "ein", "eine", "und", "mit", "plugin", "plugins", "lovelace", "dashboard", "home",
          "assistant", "custom", "integration", "integrations", "theme", "themes"}
GITHUB = re.compile(r"^(?:https://github\.com/)?([A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$")
# websocket commands per store: list, info, install, remove, add
COMMANDS = {
    "marketplace": {"list": "marketplace/repositories/list", "info": "marketplace/repository/info",
                    "install": "marketplace/repository/install", "remove": "marketplace/repository/uninstall",
                    "add": "marketplace/repositories/add"},
    "hacs": {"list": "hacs/repositories/list", "info": "hacs/repository/info", "install": "hacs/repository/download",
             "remove": "hacs/repository/remove", "add": "hacs/repositories/add"},
}
RESOURCE_BASE = {"marketplace": "/local/community", "hacs": "/hacsfiles"}
NOTICE = ("the Marketplace notice has not been accepted yet. It is accepted per Home Assistant user, here by the "
          "user of this MCP's token: log in to Home Assistant as that user once, open Settings > Marketplace and "
          "select 'I understand the risks and agree' (the MCP does not accept it for the user)")
GITHUB_MISSING = ("custom repositories need the Marketplace's GitHub connection: Settings > Marketplace > Custom "
                  "repositories, sign in with GitHub (device code) once in Home Assistant")


def normalize(items) -> list[dict]:
    """Repository dicts of either store; the Marketplace says can_install where HACS said can_download."""
    found = [dict(i) for i in items if isinstance(i, dict)] if isinstance(items, list) else []
    for item in found:
        if "can_download" not in item and "can_install" in item:
            item["can_download"] = item["can_install"]
    return found


async def list_store(ws) -> tuple[str | None, list[dict]]:
    """('marketplace' | 'hacs' | None, repositories): the Marketplace (HA 2026.11+) first, then HACS."""
    for store in ("marketplace", "hacs"):
        try:
            items = await ws.command(COMMANDS[store]["list"])
        except RuntimeError as exc:
            if "unknown_command" in str(exc):
                continue
            raise
        return store, normalize(items)
    return None, []


def _store_error(exc: RuntimeError, action: str, name) -> Exception:
    text = str(exc)
    if "warning_not_accepted" in text:
        return ValueError(f"Cannot {action} {name}: {NOTICE}")
    if "github_not_connected" in text:
        return ValueError(f"Cannot {action} {name}: {GITHUB_MISSING}")
    return RuntimeError(f"The store could not {action} {name}: {text}")


def search_words(query) -> list[str]:
    """Meaningful words of a search, singular ('graphs' -> 'graph'); fill words like 'card' are left out."""
    words = []
    for word in re.split(r"[\s,;/]+", str(query or "").casefold().strip()):
        if not word or word in FILLER:
            continue
        if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.append(word)
    # only fill words ("hacs card"): search for them as typed instead of returning everything
    return words or [w for w in str(query or "").casefold().split() if w]


class HAHacs:
    def __init__(self, client: HAClient, ws, *, allow_admin_write: bool = False, allow_delete: bool = False):
        self.client, self.ws = client, ws
        self.allow_admin_write, self.allow_delete = allow_admin_write, allow_delete
        self.store: str | None = None   # set by every listing: 'marketplace' or 'hacs'

    def _command(self, action: str) -> str:
        return COMMANDS[self.store or "hacs"][action]

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    async def _all(self) -> list[dict]:
        if self.store:   # known store: one call
            try:
                items = await self.ws.command(self._command("list"))
            except RuntimeError as exc:
                if "unknown_command" not in str(exc):
                    raise
                self.store = None   # Home Assistant was upgraded meanwhile (HACS -> Marketplace): detect again
            else:
                return normalize(items)
        store, found = await list_store(self.ws)
        if store is None:
            raise ValueError("HACS is not installed in this Home Assistant (and it has no Marketplace, which "
                             "replaced HACS in Home Assistant 2026.11)")
        self.store = store
        return found

    async def _find(self, repository: str) -> dict:
        """A repository by HACS id or GitHub full name (case-insensitive)."""
        if not isinstance(repository, str) or not repository.strip():
            raise ValueError("repository: a GitHub full name like 'owner/repo' or the id from ha_search_hacs")
        wanted = repository.strip().removeprefix("https://github.com/").strip("/").casefold()
        for item in await self._all():
            if str(item.get("id")) == wanted or str(item.get("full_name", "")).casefold() == wanted:
                return item
        raise ValueError(f"repository '{repository}' not found in {self._label()}: search with ha_search_hacs, "
                         "or add a custom repository with ha_add_hacs_custom_repository")

    def _label(self) -> str:
        return "the Marketplace" if self.store == "marketplace" else "HACS"

    @staticmethod
    def _reduce(item: dict) -> dict:
        return {key: item.get(key) for key in FIELDS if key in item}

    async def _restart_needed(self, item: dict) -> bool:
        """Marketplace: did it raise its 'restart required' repair for this repository? Unknown counts as yes."""
        try:
            data = await self.ws.command("repairs/list_issues")
        except RuntimeError:
            return True
        issues = data.get("issues", []) if isinstance(data, dict) else []
        prefix = f"restart_required_{item.get('id')}_"   # core marketplace/const.py RESTART_ISSUE_PREFIX + id + ref
        return any(isinstance(i, dict) and i.get("domain") == "marketplace"
                   and str(i.get("issue_id", "")).startswith(prefix) for i in issues)

    async def state(self, repository: str) -> dict:
        item = await self._find(repository)
        return {"installed": bool(item.get("installed")), "installed_version": item.get("installed_version")}

    # ------------------------------------------------------------------ read
    async def search(self, query: str = "", category: str = "", limit: int = 20, installed_only: bool = False) -> dict:
        if category and category not in CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
        words = search_words(query)
        found = []
        for item in await self._all():
            if category and item.get("category") != category:
                continue
            if installed_only and not item.get("installed"):
                continue
            name = f"{item.get('full_name') or ''} {item.get('name') or ''}".casefold()
            text = name + " " + str(item.get("description") or "").casefold() + " " + \
                " ".join(item.get("topics") or []).casefold()
            hits = sum(1 for word in words if word in text)
            # at least half of the words: "history graphs" also finds the popular "mini-graph-card"
            if words and hits < (len(words) + 1) // 2:
                continue
            item["_name_hit"] = bool(words) and all(word in name for word in words)
            found.append(item)
        # whose name has all words first (exact cards like card-mod), then the most popular
        found.sort(key=lambda i: (not i["_name_hit"], -(i.get("stars") or 0)))
        limit = max(1, min(int(limit), 50))
        return {"repositories": [self._reduce(i) for i in found[:limit]], "total": len(found), "store": self.store,
                "hint": "stars and last_updated help to judge a repository; install with ha_install_hacs_repository"}

    def impact(self, item: dict) -> str:
        category = item.get("category")
        base = ("Downloads third-party code from GitHub into Home Assistant; it runs with Home Assistant's rights. "
                "Check stars, last update and the author first. ")
        if category == "plugin":
            return base + (f"A dashboard card: {self._label()} registers it as dashboard resource; reload the browser "
                           "to use it.")
        if category == "integration" and self.store == "marketplace":
            return base + ("A custom integration: a new one with UI setup usually works without a restart; the "
                           "Marketplace raises the repair 'restart required' when it needs one (updates, YAML-only "
                           "integrations). Then set it up with ha_start_integration_setup.")
        if category == "integration":
            return base + ("A custom integration: Home Assistant must restart before it can be set up (ha_restart, "
                           "then ha_start_integration_setup).")
        if category == "theme":
            return base + "A theme: reload themes (ha_reload 'frontend') and pick it with ha_set_theme."
        return base + "Read the repository's instructions for the next steps."

    async def get(self, repository: str) -> dict:
        item = await self._find(repository)
        info = await self.ws.command(self._command("info"), {"repository_id": str(item["id"])}) or {}
        details = {**self._reduce(item), **{k: info.get(k) for k in ("releases", "issues", "default_branch",
                                                                      "selected_tag", "update_entity_id") if k in info}}
        if isinstance(details.get("releases"), list):
            details["releases"] = details["releases"][:10]
        return {"repository": details, "install_impact": self.impact(item), "store": self.store}

    # ------------------------------------------------------------------ write
    async def install(self, repository: str, version: str | None = None) -> dict:
        """Install or update (version: a release tag from ha_get_hacs_repository; default the newest)."""
        self._check_write()
        item = await self._find(repository)
        if item.get("can_download") is False:
            raise ValueError(f"{self._label()} cannot install {item.get('full_name')}: it needs Home Assistant "
                             f"{item.get('homeassistant') or 'a newer version'}")
        if version is not None and (not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9_.+-]{1,60}",
                                                                                     version)):
            raise ValueError("version: a release tag like 'v1.2.3'")
        payload = {"repository": str(item["id"])}
        if version:
            payload["version"] = version
        try:
            await self.ws.command(self._command("install"), payload)
        except RuntimeError as exc:
            raise _store_error(exc, "install", item.get("full_name")) from None
        after = await self._find(str(item["id"]))
        if not after.get("installed"):
            raise RuntimeError("Installation not confirmed by read-back")
        category = after.get("category")
        if category == "plugin":
            folder = str(after.get("local_path") or "").rstrip("/").rsplit("/", 1)[-1] or after.get("name")
            follow = (f"{self._label()} registered the dashboard resource ({RESOURCE_BASE[self.store or 'hacs']}/"
                      f"{folder}/...); reload the browser, then use the card in a dashboard")
        elif category == "integration" and self.store == "marketplace":
            if await self._restart_needed(after):
                follow = ("the Marketplace asks for a restart (repair 'restart required'): restart Home Assistant "
                          "(ha_restart), then set it up with ha_start_integration_setup if it is new")
            else:
                follow = "no restart needed: set it up with ha_start_integration_setup"
        elif category == "integration":
            follow = "restart Home Assistant (ha_restart), then set it up with ha_start_integration_setup"
        elif category == "theme":
            follow = "reload themes with ha_reload 'frontend', then pick it with ha_set_theme"
        else:
            follow = "see the repository's instructions"
        return {"installed": True, "full_name": after.get("full_name"), "category": category,
                "installed_version": after.get("installed_version"),
                "previous_version": item.get("installed_version"), "store": self.store, "next": follow}

    async def remove(self, repository: str) -> dict:
        self._check_delete()
        item = await self._find(repository)
        if not item.get("installed"):
            raise ValueError(f"{item.get('full_name')} is not installed")
        try:
            await self.ws.command(self._command("remove"), {"repository": str(item["id"])})
        except RuntimeError as exc:
            raise _store_error(exc, "remove", item.get("full_name")) from None
        after = await self._find(str(item["id"]))
        if after.get("installed"):
            raise RuntimeError("Removal not confirmed by read-back")
        category = item.get("category")
        follow = {"plugin": f"{self._label()} removed the dashboard resource; dashboards that still use the card "
                            "show an error card there until it is taken out (find them with ha_find_usages)",
                  "integration": "the integration's files are gone; restart Home Assistant (ha_restart) and delete "
                                 "its leftover config entries",
                  "theme": "reload themes (ha_reload 'frontend'); users who picked it fall back to the default"
                  }.get(category, "see the repository's instructions for leftovers")
        if category == "integration" and self.store == "marketplace" and not await self._restart_needed(item):
            follow = ("the Marketplace removed it without asking for a restart; delete its leftover config entries, "
                      "if any")
        return {"removed": True, "full_name": item.get("full_name"), "category": category,
                "was_version": item.get("installed_version"), "store": self.store, "next": follow}

    async def add_custom(self, repository: str, category: str) -> dict:
        self._check_write()
        match = GITHUB.match(str(repository or "").strip())
        if not match or not FULL_NAME.fullmatch(match.group(1)):
            raise ValueError("only GitHub repositories: 'owner/repo' or 'https://github.com/owner/repo'")
        if category not in CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
        full_name = match.group(1)
        items = await self._all()   # also detects the store
        known = next((i for i in items if str(i.get("full_name", "")).casefold() == full_name.casefold()), None)
        if known:   # small models reach for 'custom repository' when they mean 'install'
            state = "already installed" if known.get("installed") else "not installed yet"
            raise ValueError(f"{known.get('full_name')} is already in {self._label()} ({state}): no need to add it, "
                             "install or update it with ha_install_hacs_repository")
        if self.store == "marketplace" and category not in MARKETPLACE_CATEGORIES:
            raise ValueError(f"the Marketplace takes only these categories: {', '.join(MARKETPLACE_CATEGORIES)} "
                             f"('{category}' existed only in HACS)")
        try:
            await self.ws.command(self._command("add"), {"repository": f"https://github.com/{full_name}",
                                                         "category": category})
        except RuntimeError as exc:
            raise _store_error(exc, "add", full_name) from None
        try:
            item = await self._find(full_name)
        except ValueError:
            raise RuntimeError(f"{self._label()} could not add {full_name} (wrong category, not a valid repository "
                               "or GitHub not reachable; see ha_get_error_log)") from None
        return {"added": True, "repository": self._reduce(item), "store": self.store,
                "next": "install it with ha_install_hacs_repository"}
