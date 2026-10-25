"""HACS (Home Assistant Community Store) through the MCP: search, details, install/update, remove, custom repos.

Source: the HACS integration 2.0.5, custom_components/hacs/websocket/{repositories,repository}.py
(``hacs/repositories/list``, ``hacs/repository/info`` {repository_id}, ``hacs/repository/download`` {repository,
version?}, ``hacs/repository/remove`` {repository}, ``hacs/repositories/add`` {repository, category}; all admin).
HACS registers the dashboard resource of a card itself after the download (repositories/plugin.py).

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
FIELDS = ("id", "full_name", "name", "category", "description", "stars", "downloads", "installed",
          "installed_version", "available_version", "pending_upgrade", "last_updated", "custom", "can_download",
          "homeassistant", "authors", "topics")
FULL_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
FILLER = {"card", "cards", "karte", "karten", "hacs", "for", "the", "a", "an", "and", "with", "für", "fur", "die",
          "der", "das", "ein", "eine", "und", "mit", "plugin", "plugins", "lovelace", "dashboard", "home",
          "assistant", "custom", "integration", "integrations", "theme", "themes"}
GITHUB = re.compile(r"^(?:https://github\.com/)?([A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$")


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

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    def _check_delete(self):
        self._check_write()
        if not self.allow_delete:
            raise ValueError("delete disabled; enable HA_ALLOW_DELETE")

    async def _all(self) -> list[dict]:
        try:
            items = await self.ws.command("hacs/repositories/list")
        except RuntimeError as exc:
            if "unknown_command" in str(exc):
                raise ValueError("HACS is not installed in this Home Assistant") from None
            raise
        return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []

    async def _find(self, repository: str) -> dict:
        """A repository by HACS id or GitHub full name (case-insensitive)."""
        if not isinstance(repository, str) or not repository.strip():
            raise ValueError("repository: a GitHub full name like 'owner/repo' or the id from ha_search_hacs")
        wanted = repository.strip().removeprefix("https://github.com/").strip("/").casefold()
        for item in await self._all():
            if str(item.get("id")) == wanted or str(item.get("full_name", "")).casefold() == wanted:
                return item
        raise ValueError(f"repository '{repository}' not found in HACS: search with ha_search_hacs, or add a "
                         "custom repository with ha_add_hacs_custom_repository")

    @staticmethod
    def _reduce(item: dict) -> dict:
        return {key: item.get(key) for key in FIELDS if key in item}

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
        return {"repositories": [self._reduce(i) for i in found[:limit]], "total": len(found),
                "hint": "stars and last_updated help to judge a repository; install with ha_install_hacs_repository"}

    @staticmethod
    def impact(item: dict) -> str:
        category = item.get("category")
        base = ("Downloads third-party code from GitHub into Home Assistant; it runs with Home Assistant's rights. "
                "Check stars, last update and the author first. ")
        if category == "plugin":
            return base + "A dashboard card: HACS registers it as dashboard resource; reload the browser to use it."
        if category == "integration":
            return base + ("A custom integration: Home Assistant must restart before it can be set up (ha_restart, "
                           "then ha_start_integration_setup).")
        if category == "theme":
            return base + "A theme: reload themes (ha_reload 'frontend') and pick it with ha_set_theme."
        return base + "Read the repository's instructions for the next steps."

    async def get(self, repository: str) -> dict:
        item = await self._find(repository)
        info = await self.ws.command("hacs/repository/info", {"repository_id": str(item["id"])}) or {}
        details = {**self._reduce(item), **{k: info.get(k) for k in ("releases", "issues", "default_branch",
                                                                      "selected_tag") if k in info}}
        if isinstance(details.get("releases"), list):
            details["releases"] = details["releases"][:10]
        return {"repository": details, "install_impact": self.impact(item)}

    # ------------------------------------------------------------------ write
    async def install(self, repository: str, version: str | None = None) -> dict:
        """Install or update (version: a release tag from ha_get_hacs_repository; default the newest)."""
        self._check_write()
        item = await self._find(repository)
        if item.get("can_download") is False:
            raise ValueError(f"HACS cannot download {item.get('full_name')}: it needs Home Assistant "
                             f"{item.get('homeassistant') or 'a newer version'}")
        if version is not None and (not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9_.+-]{1,60}",
                                                                                     version)):
            raise ValueError("version: a release tag like 'v1.2.3'")
        payload = {"repository": str(item["id"])}
        if version:
            payload["version"] = version
        try:
            await self.ws.command("hacs/repository/download", payload)
        except RuntimeError as exc:
            raise RuntimeError(f"HACS could not download {item.get('full_name')}: {exc}") from None
        after = await self._find(str(item["id"]))
        if not after.get("installed"):
            raise RuntimeError("Installation not confirmed by read-back")
        category = after.get("category")
        if category == "plugin":
            folder = str(after.get("local_path") or "").rstrip("/").rsplit("/", 1)[-1] or after.get("name")
            follow = (f"HACS registered the dashboard resource (/hacsfiles/{folder}/...); reload the browser, then "
                      "use the card in a dashboard")
        elif category == "integration":
            follow = "restart Home Assistant (ha_restart), then set it up with ha_start_integration_setup"
        elif category == "theme":
            follow = "reload themes with ha_reload 'frontend', then pick it with ha_set_theme"
        else:
            follow = "see the repository's instructions"
        return {"installed": True, "full_name": after.get("full_name"), "category": category,
                "installed_version": after.get("installed_version"),
                "previous_version": item.get("installed_version"), "next": follow}

    async def remove(self, repository: str) -> dict:
        self._check_delete()
        item = await self._find(repository)
        if not item.get("installed"):
            raise ValueError(f"{item.get('full_name')} is not installed")
        await self.ws.command("hacs/repository/remove", {"repository": str(item["id"])})
        after = await self._find(str(item["id"]))
        if after.get("installed"):
            raise RuntimeError("Removal not confirmed by read-back")
        category = item.get("category")
        follow = {"plugin": "HACS removed the dashboard resource; dashboards that still use the card show an error "
                            "card there until it is taken out (find them with ha_find_usages)",
                  "integration": "the integration's files are gone; restart Home Assistant (ha_restart) and delete "
                                 "its leftover config entries",
                  "theme": "reload themes (ha_reload 'frontend'); users who picked it fall back to the default"
                  }.get(category, "see the repository's instructions for leftovers")
        return {"removed": True, "full_name": item.get("full_name"), "category": category,
                "was_version": item.get("installed_version"), "next": follow}

    async def add_custom(self, repository: str, category: str) -> dict:
        self._check_write()
        match = GITHUB.match(str(repository or "").strip())
        if not match or not FULL_NAME.fullmatch(match.group(1)):
            raise ValueError("only GitHub repositories: 'owner/repo' or 'https://github.com/owner/repo'")
        if category not in CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(CATEGORIES)}")
        full_name = match.group(1)
        await self.ws.command("hacs/repositories/add", {"repository": f"https://github.com/{full_name}",
                                                        "category": category})
        try:
            item = await self._find(full_name)
        except ValueError:
            raise RuntimeError(f"HACS could not add {full_name} (wrong category, not a valid HACS repository or "
                               "GitHub not reachable; see ha_get_error_log)") from None
        return {"added": True, "repository": self._reduce(item),
                "next": "install it with ha_install_hacs_repository"}
