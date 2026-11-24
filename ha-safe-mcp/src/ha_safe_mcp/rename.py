"""Rename a device in one step, the way people do it by hand in Home Assistant's device page ("rename the
entity IDs too?") plus what HA leaves to the user: the references in automations, scripts, scenes and dashboards.

Steps, each through the normal gated write and journaled on its own (undo them newest first):
1. device name (device registry ``name_by_user``),
2. entity IDs of the device that start with the old device name (or its original name), with the new name instead,
3. entity names that start with the old device name,
4. every automation, script, scene and storage dashboard that uses one of the renamed IDs.
A taken target ID stops everything before the first write. YAML-only configs and groups are listed, not edited.
"""
from __future__ import annotations

import re

from .notify import slug

DEVICE_ID = re.compile(r"^(?:[0-9a-f]{32}|[0-9A-HJKMNP-TV-Z]{26})$")
REFERENCE_KINDS = ["automation", "script", "scene", "dashboard"]


def replace_ids(value, mapping: dict[str, str]):
    """Replace whole entity IDs in every string and dict key (templates too: states.light.x.state); returns
    (new value, number of replacements). 'sensor.x_total' is not touched when 'sensor.x' is renamed."""
    if not mapping:
        return value, 0
    pattern = re.compile(r"(?<![a-z0-9_])(" + "|".join(re.escape(old) for old in
                                                        sorted(mapping, key=len, reverse=True)) + r")(?![a-z0-9_])")
    count = 0

    def walk(item):
        nonlocal count
        if isinstance(item, str):
            new, n = pattern.subn(lambda m: mapping[m.group(1)], item)
            count += n
            return new
        if isinstance(item, list):
            return [walk(x) for x in item]
        if isinstance(item, dict):
            return {walk(k) if isinstance(k, str) else k: walk(v) for k, v in item.items()}
        return item
    return walk(value), count


class DeviceRenamer:
    def __init__(self, client, admin, registry, scenes, overview, *, allow_admin_write: bool = False):
        self.client, self.admin, self.registry, self.scenes, self.overview = client, admin, registry, scenes, overview
        self.allow_admin_write = allow_admin_write

    def _check_write(self):
        if not self.client.allow_write or not self.allow_admin_write:
            raise ValueError("admin write disabled; enable HA_ALLOW_WRITE and HA_ALLOW_ADMIN_WRITE")

    async def _device(self, device: str) -> dict:
        if not isinstance(device, str) or not device.strip():
            raise ValueError("device: the device_id or the device's name from ha_list_devices")
        devices = [d for d in await self.admin.ws.command("config/device_registry/list") or [] if isinstance(d, dict)]
        wanted = device.strip()
        key = wanted.casefold()
        hits = [d for d in devices if d.get("id") == wanted] or [
            d for d in devices if str(d.get("name_by_user") or d.get("name") or "").casefold() == key] or [
            d for d in devices if str(d.get("name") or "").casefold() == key]   # the original name as fallback
        if len(hits) == 1:
            return hits[0]
        if hits:
            listed = "; ".join(f"{d.get('name_by_user') or d.get('name')} ({d['id']}, area {d.get('area_id')})"
                               for d in hits[:10])
            raise ValueError(f"'{device}' matches {len(hits)} devices: {listed}. Pass the device_id.")
        similar = sorted({str(d.get("name_by_user") or d.get("name")) for d in devices
                          if wanted.casefold()[:4] in str(d.get("name_by_user") or d.get("name") or "").casefold()})
        raise ValueError(f"no device '{device}'" + (f"; similar: {', '.join(similar[:8])}" if similar else "")
                         + ". Find it with ha_list_devices (query or area).")

    async def plan(self, device: str, new_name: str, rename_entity_ids: bool = True,
                   update_references: bool = True) -> dict:
        self._check_write()
        if not isinstance(new_name, str) or not 1 <= len(new_name.strip()) <= 100:
            raise ValueError("new_name: 1-100 characters, e.g. 'Espresso machine'")
        new_name = new_name.strip()
        item = await self._device(device)
        old_name = item.get("name_by_user") or item.get("name") or ""
        new_slug = slug(new_name)
        if not new_slug:
            raise ValueError("new_name needs letters or digits for the entity IDs")
        prefixes = sorted({p for p in (slug(old_name), slug(item.get("name") or "")) if p}, key=len, reverse=True)
        registry = [e for e in await self.admin.entity_registry_list() or [] if isinstance(e, dict)]
        own = sorted((e for e in registry if e.get("device_id") == item["id"]), key=lambda e: e["entity_id"])
        ids, kept = {}, []
        for entry in own:
            domain, object_id = entry["entity_id"].split(".", 1)
            prefix = next((p for p in prefixes if object_id == p or object_id.startswith(p + "_")), None)
            if not rename_entity_ids or prefix is None:
                kept.append(entry["entity_id"])
                continue
            target = f"{domain}.{new_slug}{object_id[len(prefix):]}"
            if target != entry["entity_id"]:
                ids[entry["entity_id"]] = target
        taken = sorted(t for t in ids.values() if t in {e["entity_id"] for e in registry} and t not in ids)
        if len(set(ids.values())) != len(ids):
            raise ValueError("two entities would get the same new ID; rename them one by one with ha_rename_entity")
        if taken:
            raise ValueError(f"{', '.join(taken)} already exists; pick another new_name or rename that entity first. "
                             "Nothing was changed.")
        names = {}
        for entry in own:
            name = entry.get("name")
            if isinstance(name, str) and old_name and name.casefold().startswith(old_name.casefold()):
                names[ids.get(entry["entity_id"], entry["entity_id"])] = new_name + name[len(old_name):]
        references = []
        if update_references and ids:
            seen = {}
            for needle in prefixes:   # one search per name prefix finds every renamed ID (confirmed below)
                usages = await self.overview.find_usages(needle, REFERENCE_KINDS, 500)
                for match in usages["matches"]:
                    seen[(match["kind"], match["id"])] = {"kind": match["kind"], "id": match["id"],
                                                          "name": match.get("name")}
            for ref in sorted(seen.values(), key=lambda m: (m["kind"], str(m["id"]))):
                _, count = replace_ids(await self._read(ref["kind"], ref["id"]), ids)
                if count:
                    references.append({**ref, "uses": count})
        return {"device": {"device_id": item["id"], "old_name": old_name, "new_name": new_name},
                "entity_ids": ids, "kept_entity_ids": kept, "entity_names": names, "references": references}

    # ------------------------------------------------------------------ reference writers
    async def _read(self, kind: str, ref_id: str):
        if kind == "automation":
            return {k: v for k, v in (await self.admin.automation_get(ref_id)).items() if k != "id"}
        if kind == "script":
            return await self.scenes.get_script(ref_id)
        if kind == "scene":
            return {k: v for k, v in (await self.scenes.get_scene(ref_id)).items() if k != "id"}
        return await self.admin.dashboard_get(None if ref_id == "default" else ref_id)

    def _writer(self, kind: str, ref_id: str, config):
        if kind == "automation":
            return "automation", ref_id, lambda: self.admin.automation_save(ref_id, config)
        if kind == "script":
            return "script", ref_id, lambda: self.scenes.save_script(ref_id, config)
        if kind == "scene":
            return "scene", ref_id, lambda: self.scenes.save_scene(ref_id, config)
        url = None if ref_id == "default" else ref_id
        return "dashboard_config", url or "", lambda: self.admin.dashboard_save(config, url_path=url)

    async def run(self, plan: dict, journaled) -> dict:
        """journaled(kind, target, writer, **options) -> result with change_id."""
        device = plan["device"]
        change_ids, failed, updated = [], [], []
        result = await journaled("device", device["device_id"],
                                 lambda: self.registry.update_device(device["device_id"],
                                                                     {"name_by_user": device["new_name"]}),
                                 fields=["name_by_user"])
        change_ids.append(result["change_id"])
        renamed = {}
        for old, new in plan["entity_ids"].items():
            try:
                result = await journaled("entity", old, lambda o=old, n=new: self.admin.entity_rename(o, n),
                                         fields=["new_entity_id"], target_from=lambda r: r["entity_id"])
            except (RuntimeError, ValueError) as exc:
                failed.append({"step": f"rename {old}", "error": str(exc)})
                break
            change_ids.append(result["change_id"])
            renamed[old] = new
        planned_from = {new: old for old, new in plan["entity_ids"].items()}
        for final_id, name in plan["entity_names"].items():
            old_id = planned_from.get(final_id, final_id)
            current = renamed.get(old_id, old_id)   # a rename that failed keeps the old ID
            try:
                result = await journaled("entity", current,
                                         lambda c=current, n=name: self.admin.entity_registry_update(c, {"name": n}),
                                         fields=["name"])
                change_ids.append(result["change_id"])
            except (RuntimeError, ValueError) as exc:
                failed.append({"step": f"name of {current}", "error": str(exc)})
        for ref in plan["references"]:
            try:
                config = await self._read(ref["kind"], ref["id"])
                new_config, count = replace_ids(config, renamed)
                if not count:
                    continue
                kind, target, writer = self._writer(ref["kind"], ref["id"], new_config)
                result = await journaled(kind, target, writer)
                change_ids.append(result["change_id"])
                updated.append({key: ref[key] for key in ("kind", "id", "name")} | {"replaced": count})
            except (RuntimeError, ValueError) as exc:
                failed.append({"step": f"{ref['kind']} {ref['id']}", "error": str(exc)})
        return {"done": not failed, "device": device, "entity_ids": renamed, "entity_names": plan["entity_names"],
                "kept_entity_ids": plan["kept_entity_ids"], "references_updated": updated, "failed": failed,
                "change_ids": change_ids,
                "undo": "each step has its own change_id; undo them newest first with ha_undo_change (last id "
                        "first)",
                **({"hint": "some steps failed (see failed); everything else is done. Fix the cause and repeat "
                            "with the same arguments, or undo"} if failed else {}),
                "not_updated": "YAML files, old-style groups and template sensors are not changed: check them "
                               "with ha_find_usages for the old IDs"}
