"""Change journal: keep the previous state of every configuration change and undo it on request.

Every journaled tool reads the current state first, performs the change through the normal gated code path and
then stores one JSON file with the previous state. ``undo`` writes that previous state back through the same
gated code path, which is journaled again, so an undo can itself be undone. Files live locally (0700/0600) for
30 days; they hold configuration (names, entity IDs), never tokens or credentials.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

RETENTION_DAYS = 30
MAX_ENTRIES = 1000
CHANGE_ID = re.compile(r"^\d{8}T\d{12}Z-[0-9a-f]{8}$")
STAMP = "%Y%m%dT%H%M%S%fZ"
KINDS = ("automation", "script", "scene", "dashboard_config", "dashboard", "helper", "entity", "area", "floor",
         "device", "integration", "label", "category", "zone", "blueprint", "theme", "resource", "file", "energy",
         "pipeline", "exposure")
DASHBOARD_META = ("title", "icon", "require_admin", "show_in_sidebar")
AREA_FIELDS = ("name", "floor_id", "icon", "aliases", "labels")
FLOOR_FIELDS = ("name", "level", "icon", "aliases")
ENTRY_FIELDS = ("title", "pref_disable_polling", "pref_disable_new_entities")
LABEL_FIELDS = ("name", "color", "icon", "description")
CATEGORY_FIELDS = ("name", "icon")
ZONE_FIELDS = ("name", "latitude", "longitude", "radius", "passive", "icon")
NOT_FOUND = ("Home Assistant returned HTTP 404", "Home Assistant WebSocket error: config_not_found")


def default_directory() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "ha-safe-mcp" / "changes"


def journal_from_env() -> "ChangeJournal":
    directory = os.getenv("HA_CHANGES_DIR")
    return ChangeJournal(Path(directory) if directory else None)


class ChangeJournal:
    def __init__(self, directory: Path | None = None, *, retention_days: int = RETENTION_DAYS,
                 max_entries: int = MAX_ENTRIES, now: Callable[[], datetime] | None = None):
        self.directory = Path(directory) if directory else default_directory()
        self.retention_days = retention_days
        self.max_entries = max_entries
        self.now = now or (lambda: datetime.now(timezone.utc))

    def _ensure(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)

    def _files(self) -> list[Path]:
        """Journal files oldest first; anything not named like a change is left alone."""
        if not self.directory.is_dir():
            return []
        return sorted(p for p in self.directory.iterdir()
                      if p.suffix == ".json" and CHANGE_ID.fullmatch(p.stem) and p.is_file() and not p.is_symlink())

    def purge(self):
        cutoff = (self.now() - timedelta(days=self.retention_days)).astimezone(timezone.utc)
        files = self._files()
        for path in files:
            stamp = datetime.strptime(path.stem[:22], STAMP).replace(tzinfo=timezone.utc)
            if stamp < cutoff:
                path.unlink(missing_ok=True)
        files = self._files()
        for path in files[:max(0, len(files) - self.max_entries)]:
            path.unlink(missing_ok=True)

    def _path(self, change_id: str) -> Path:
        if not isinstance(change_id, str) or not CHANGE_ID.fullmatch(change_id):
            raise ValueError("invalid change_id: use an id from ha_list_changes")
        return self.directory / f"{change_id}.json"

    def _write(self, entry: dict):
        self._ensure()
        path = self._path(entry["id"])
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, json.dumps(entry, ensure_ascii=False, indent=1).encode())
        finally:
            os.close(fd)

    def record(self, *, kind: str, target: str, before: Any, tool: str, undoes: str | None = None) -> str:
        if kind not in KINDS:
            raise ValueError("unknown change kind")
        moment = self.now().astimezone(timezone.utc)
        files = self._files()
        if files:
            # IDs sort like time; two changes in the same microsecond (or a clock step back) stay in order
            newest = datetime.strptime(files[-1].stem[:22], STAMP).replace(tzinfo=timezone.utc)
            moment = max(moment, newest + timedelta(microseconds=1))
        change_id = f"{moment.strftime(STAMP)}-{secrets.token_hex(4)}"
        self._write({"id": change_id, "ts": moment.strftime("%Y-%m-%dT%H:%M:%SZ"), "tool": tool, "kind": kind,
                     "target": target, "before": before, "undoes": undoes, "undone_by": None})
        self.purge()
        return change_id

    def get(self, change_id: str) -> dict:
        path = self._path(change_id)
        self.purge()
        if not path.is_file() or path.is_symlink():
            raise ValueError("unknown change_id (older than 30 days or never recorded)")
        return json.loads(path.read_text(encoding="utf-8"))

    def mark_undone(self, change_id: str, by: str):
        entry = self.get(change_id)
        entry["undone_by"] = by
        self._write(entry)

    def entries(self, *, kind: str = "", target: str = "", limit: int = 50) -> list[dict]:
        """Newest first, without the stored configuration (use get for that)."""
        self.purge()
        result = []
        for path in reversed(self._files()):
            try:
                entry = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if (kind and entry.get("kind") != kind) or (target and entry.get("target") != target):
                continue
            summary = {key: entry.get(key) for key in ("id", "ts", "tool", "kind", "target", "undoes", "undone_by")}
            summary["existed_before"] = entry.get("before") is not None
            result.append(summary)
            if len(result) >= max(1, min(int(limit), 200)):
                break
        return result


def _not_found(exc: Exception) -> bool:
    return isinstance(exc, RuntimeError) and str(exc) in NOT_FOUND


def _pick(item: dict | None, keys) -> dict | None:
    return None if item is None else {key: item.get(key) for key in keys}


class Changes:
    """Journaled writes and undo over the gated admin/scenes/registry/integrations objects."""

    def __init__(self, journal: ChangeJournal, *, admin, scenes, registry, integrations, organizer=None,
                 customize=None, config_files=None, energy=None, assist=None):
        self.journal = journal
        self.energy, self.assist = energy, assist
        self.admin, self.scenes, self.registry, self.integrations = admin, scenes, registry, integrations
        self.organizer, self.customize, self.config_files = organizer, customize, config_files

    # ------------------------------------------------------------------ read the current state
    async def _or_none(self, reader: Callable[[], Awaitable[Any]]):
        try:
            return await reader()
        except RuntimeError as exc:
            if _not_found(exc):
                return None
            raise

    async def _dashboard_meta(self, url_path: str) -> dict | None:
        return next((d for d in await self.admin.dashboard_list() if d.get("url_path") == url_path), None)

    async def capture(self, kind: str, target: str | None, fields=None):
        if target is None:
            return None
        if kind == "automation":
            config = await self._or_none(lambda: self.admin.automation_get(target))
            return None if config is None else {k: v for k, v in config.items() if k != "id"}
        if kind == "script":
            return await self._or_none(lambda: self.scenes.get_script(target))
        if kind == "scene":
            config = await self._or_none(lambda: self.scenes.get_scene(target))
            return None if config is None else {k: v for k, v in config.items() if k != "id"}
        if kind == "dashboard_config":
            return await self._or_none(lambda: self.admin.dashboard_get(target or None))
        if kind == "dashboard":
            meta = await self._dashboard_meta(target)
            if meta is None:
                return None
            config = await self._or_none(lambda: self.admin.dashboard_get(target))
            return {"meta": _pick(meta, DASHBOARD_META), "config": config}
        if kind == "helper":
            domain, helper_id = target.split("/", 1)
            item = next((h for h in await self.admin.helper_list(domain) if h.get("id") == helper_id), None)
            return None if item is None else {k: v for k, v in item.items() if k != "id"}
        if kind == "entity":
            item = await self.admin.entity_registry_get(target)
            if fields and "new_entity_id" in fields:  # a rename: remember the old ID
                return None if item is None else {"new_entity_id": target}
            return _pick(item, fields or ("name", "area_id", "icon"))
        if kind == "label":
            item = await self.organizer.find_label(target)
            if item is None:
                return None
            before = _pick(item, LABEL_FIELDS)
            if fields and "assigned" in fields:
                before["assigned"] = await self.organizer.label_assignments(target)
            return before
        if kind == "category":
            scope, category_id = target.split("/", 1)
            item = await self.organizer.find_category(scope, category_id)
            if item is None:
                return None
            before = _pick(item, CATEGORY_FIELDS)
            if fields and "assigned" in fields:
                before["assigned"] = await self.organizer.category_assignments(scope, category_id)
            return before
        if kind == "zone":
            return _pick(await self.organizer.find_zone(target), ZONE_FIELDS)
        if kind == "file":
            content = await self.config_files.read_raw(target)
            return None if content is None else {"content": content}
        if kind == "blueprint":
            domain, path = target.split("/", 1)
            meta = await self.customize.find_blueprint(domain, path)
            return None if meta is None else {"source_url": meta.get("source_url")}
        if kind == "theme":
            themes = await self.customize.list_themes()
            return {"name": themes["default_dark_theme" if target == "dark" else "default_theme"]}
        if kind == "resource":
            return _pick(await self.customize.find_resource(target), ("url", "type"))
        if kind == "area":
            item = next((a for a in await self.registry.list_areas() if a.get("area_id") == target), None)
            return _pick(item, AREA_FIELDS)
        if kind == "floor":
            item = next((f for f in await self.registry.list_floors() if f.get("floor_id") == target), None)
            return _pick(item, FLOOR_FIELDS)
        if kind == "device":
            item = next((d for d in await self.registry.list_devices(limit=500) if d.get("device_id") == target),
                        None)
            return _pick(item, fields or ("area_id", "name_by_user", "disabled_by", "labels"))
        if kind == "integration":
            return _pick(await self.integrations.entry_view(target), fields or ENTRY_FIELDS + ("disabled_by",))
        if kind == "energy":
            return await self.energy.prefs()
        if kind == "pipeline":
            if target == "preferred":
                return {"preferred": await self.assist.preferred()}
            item = await self.assist.pipeline(target)
            return None if item is None else {k: v for k, v in item.items() if k != "id"}
        if kind == "exposure":
            if target.startswith("new:"):
                return {"expose_new": await self.assist.expose_new(target[4:])}
            return await self.assist.exposure_of(list(fields or []), target.split(","))
        raise ValueError("unknown change kind")

    # ------------------------------------------------------------------ journaled write
    async def apply(self, tool: str, kind: str, target: str | None, writer: Callable[[], Awaitable[Any]], *,
                    fields=None, target_from: Callable[[Any], str] | None = None, undoes: str | None = None):
        """Capture, write, journal. A failed write raises and leaves no journal entry."""
        before = await self.capture(kind, target, fields)
        result = await writer()
        final = target_from(result) if target_from else target
        change_id = self.journal.record(kind=kind, target=final or "", before=before, tool=tool, undoes=undoes)
        return result, change_id

    def record_created(self, kind: str, target: str, tool: str) -> str:
        """Journal something that did not exist before (e.g. a config entry created by a setup flow)."""
        return self.journal.record(kind=kind, target=target, before=None, tool=tool)

    @staticmethod
    def with_change(result, change_id: str):
        """Tool result plus the change ID the model or user can pass to ha_undo_change."""
        if isinstance(result, dict):
            return {**result, "change_id": change_id}
        return {"result": result, "change_id": change_id}

    # ------------------------------------------------------------------ undo
    async def undo(self, change_id: str, force: bool = False) -> dict:
        entry = self.journal.get(change_id)
        if entry.get("undone_by"):
            raise ValueError(f"change already undone by {entry['undone_by']}")
        kind, target, before = entry["kind"], entry["target"], entry.get("before")
        newer = [e["id"] for e in self.journal.entries(kind=kind, target=target, limit=200)
                 if e["id"] > change_id and not e.get("undone_by")
                 # an undo of an even newer change only brings the item back towards this change's result
                 and not (e.get("undoes") and e["undoes"] > change_id)
                 and self._overlaps(kind, before, e["id"])]
        if newer and not force:
            raise ValueError(f"newer changes to this target exist: {', '.join(newer[:5])}; undo them first "
                             "(newest first) or repeat with force=true to overwrite them")
        fields = list(before) if isinstance(before, dict) and kind in ("entity", "device", "integration",
                                                                        "exposure") else None
        if kind in ("label", "category") and before is None:
            fields = ["assigned"]  # the undo deletes it: keep where it was used, so a redo can put it back
        holder: dict = {}

        async def restore():
            result, holder["target"] = await self._restore(kind, target, before)
            return result

        result, new_id = await self.apply("ha_undo_change", kind, target, restore, fields=fields,
                                          target_from=lambda _: holder["target"], undoes=change_id)
        self.journal.mark_undone(change_id, new_id)
        return {"undone": change_id, "change_id": new_id, "kind": kind, "target": holder["target"],
                "result": result}

    def _overlaps(self, kind: str, before, other_id: str) -> bool:
        """Field-level kinds (entity, device, integration) only conflict when the same fields changed."""
        if kind not in ("entity", "device", "integration", "exposure") or not isinstance(before, dict):
            return True
        other = self.journal.get(other_id).get("before")
        return not isinstance(other, dict) or bool(set(before) & set(other))

    async def _restore(self, kind: str, target: str, before):
        """Write ``before`` back; returns (result, target after the restore)."""
        a, s, r = self.admin, self.scenes, self.registry
        if kind == "automation":
            if before is None:
                return await a.automation_delete(target), target
            return await a.automation_save(target, before), target
        if kind == "script":
            if before is None:
                return await s.delete_script(target), target
            return await s.save_script(target, before), target
        if kind == "scene":
            if before is None:
                return await s.delete_scene(target), target
            return await s.save_scene(target, before), target
        if kind == "dashboard_config":
            if before is None:
                raise ValueError("no earlier dashboard config stored; edit the dashboard instead")
            return await a.dashboard_save(before, url_path=target or None), target
        if kind == "dashboard":
            return await self._restore_dashboard(target, before), target
        if kind == "helper":
            domain, helper_id = target.split("/", 1)
            exists = any(h.get("id") == helper_id for h in await a.helper_list(domain))
            if before is None:
                return await a.helper_delete(domain, helper_id), target
            if exists:
                return await a.helper_update(domain, helper_id, before), target
            created = await a.helper_create(domain, before)
            return created, f"{domain}/{created['id']}"
        if kind == "integration" and before is None:
            # created by a setup flow: undo removes the entry again (a config entry cannot be recreated by undo)
            return await self.integrations.delete_entry(target), target
        if kind in ("entity", "device", "integration") and not before:
            raise ValueError("nothing stored to restore for this change")
        if kind == "entity":
            if "new_entity_id" in before:
                return await a.entity_rename(target, before["new_entity_id"]), before["new_entity_id"]
            payload = dict(before)
            if "categories" in payload:
                # scopes added by the change are removed again; HA only touches the scopes it is given
                current = await a.entity_registry_get(target) or {}
                payload["categories"] = {**{scope: None for scope in current.get("categories") or {}},
                                         **(payload["categories"] or {})}
            return await a.entity_registry_update(target, payload), target
        if kind == "device":
            return await r.update_device(target, before), target
        if kind == "integration":
            result = None
            settings = {k: v for k, v in before.items() if k in ENTRY_FIELDS}
            if settings:
                result = await self.integrations.update_entry(target, settings)
            if "disabled_by" in before:
                result = await self.integrations.set_entry_disabled(target, before["disabled_by"] is not None)
            return result, target
        if kind in ("area", "floor"):
            return await self._restore_place(kind, target, before)
        if kind == "label":
            return await self._restore_label(target, before)
        if kind == "category":
            return await self._restore_category(target, before)
        if kind == "zone":
            return await self._restore_zone(target, before)
        if kind == "file":
            return await self.config_files.restore(target, before), target
        if kind == "blueprint":
            domain, path = target.split("/", 1)
            if before is None:
                return await self.customize.delete_blueprint(domain, path), target
            if not before.get("source_url"):
                raise ValueError("this blueprint had no source_url, so it cannot be re-imported")
            return await self.customize.save_blueprint(before["source_url"], path), target
        if kind == "theme":
            name = before.get("name") or ("none" if target == "dark" else "default")
            return await self.customize.set_theme(name, target), target
        if kind == "resource":
            if before is None:
                return await self.customize.delete_resource(target), target
            created = await self.customize.add_resource(before["url"], before.get("type") or "module")
            return created, created["id"]
        if kind == "pipeline":
            return await self._restore_pipeline(target, before)
        if kind == "exposure":
            if target.startswith("new:"):
                return await self.assist.set_expose_new(target[4:], bool(before.get("expose_new"))), target
            return await self.assist.restore_exposure(before), target
        if kind == "energy":
            # the whole energy settings go back; sensors that vanished since stay as they were stored
            return await self.energy.save(**before, check_statistics=False), target
        raise ValueError("unknown change kind")

    async def _restore_pipeline(self, target: str, before):
        a = self.assist
        if target == "preferred":
            return await a.set_preferred(before["preferred"]), target
        if before is None:
            if target == await a.preferred():
                raise ValueError("this pipeline was created by the change but is preferred now; make another one "
                                 "preferred first")
            return await a.delete_pipeline(target), target
        if await a.pipeline(target) is not None:
            return await a.save_pipeline(target, before), target
        created = await a.save_pipeline(None, before)
        return created, created["id"]

    async def _restore_label(self, target: str, before):
        o = self.organizer
        if before is None:
            return await o.delete_label(target), target
        settings = {key: before.get(key) for key in LABEL_FIELDS if key in before}
        current = await o.find_label(target)
        if current is None:
            result = await o.create_label(settings["name"], color=settings.get("color"), icon=settings.get("icon"),
                                          description=settings.get("description"))
            target = result["label_id"]
        else:
            changes = {key: value for key, value in settings.items() if current.get(key) != value}
            result = await o.update_label(target, changes) if changes else current
        if before.get("assigned"):
            result = {**result, "restored_assignments": await o.assign_label(target, before["assigned"])}
        return result, target

    async def _restore_category(self, target: str, before):
        o = self.organizer
        scope, category_id = target.split("/", 1)
        if before is None:
            return await o.delete_category(scope, category_id), target
        settings = {key: before.get(key) for key in CATEGORY_FIELDS if key in before}
        current = await o.find_category(scope, category_id)
        if current is None:
            result = await o.create_category(scope, settings["name"], icon=settings.get("icon"))
            category_id = result["category_id"]
        else:
            changes = {key: value for key, value in settings.items() if current.get(key) != value}
            result = await o.update_category(scope, category_id, changes) if changes else current
        if before.get("assigned"):
            result = {**result, "restored_assignments": await o.assign_category(scope, category_id,
                                                                                 before["assigned"])}
        return result, f"{scope}/{category_id}"

    async def _restore_zone(self, target: str, before):
        o = self.organizer
        if before is None:
            return await o.delete_zone(target), target
        settings = {key: before[key] for key in ZONE_FIELDS if before.get(key) is not None}
        current = await o.find_zone(target)
        if current is None:
            created = await o.create_zone(**settings)
            return created, created["zone_id"]
        changes = {key: value for key, value in settings.items() if current.get(key) != value}
        return (await o.update_zone(target, changes) if changes else current), target

    async def _restore_dashboard(self, url_path: str, before):
        a = self.admin
        meta = await self._dashboard_meta(url_path)
        if before is None:
            if meta is None:
                raise ValueError("dashboard no longer exists")
            return await a.dashboard_delete(meta["id"])
        if meta is None:
            meta = await a.dashboard_create(before["meta"]["title"], url_path)
            meta = await self._dashboard_meta(url_path) or meta
        changes = {k: v for k, v in (before.get("meta") or {}).items()
                   if k in DASHBOARD_META and v is not None and meta.get(k) != v}
        result = await a.dashboard_update(meta["id"], changes) if changes else meta
        if before.get("config") is not None:
            await a.dashboard_save(before["config"], url_path=url_path)
        return result

    async def _restore_place(self, kind: str, target: str, before):
        r = self.registry
        key, fields = ("area_id", AREA_FIELDS) if kind == "area" else ("floor_id", FLOOR_FIELDS)
        items = await (r.list_areas() if kind == "area" else r.list_floors())
        current = next((i for i in items if i.get(key) == target), None)
        if before is None:
            return await (r.delete_area(target) if kind == "area" else r.delete_floor(target)), target
        if current is not None:
            # entries written before a field existed (e.g. area labels) do not touch that field
            changes = {k: before.get(k) for k in fields if k in before and current.get(k) != before.get(k)}
            if not changes:
                return current, target
            return await (r.update_area(target, changes) if kind == "area" else r.update_floor(target, changes)), target
        if kind == "area":
            created = await r.create_area(before["name"], floor_id=before.get("floor_id"), icon=before.get("icon"))
        else:
            created = await r.create_floor(before["name"], level=before.get("level"), icon=before.get("icon"))
        new_target = created[key]
        extra = {k: before[k] for k in ("aliases", "labels") if before.get(k) and (kind == "area" or k == "aliases")}
        if extra:
            created = await (r.update_area(new_target, extra) if kind == "area" else r.update_floor(new_target, extra))
        return created, new_target
