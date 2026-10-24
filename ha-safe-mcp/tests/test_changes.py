"""Change journal: every configuration change keeps its previous state locally and can be undone (and redone)."""
import json
import stat
from datetime import datetime, timedelta, timezone

import pytest

from ha_safe_mcp.changes import ChangeJournal, Changes

NOW = datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc)


def clock(moment):
    return lambda: moment


class FakeHA:
    """In-memory stand-in for the admin/scenes/registry/integrations objects the tools use."""

    def __init__(self):
        self.automations = {"flur": {"id": "flur", "alias": "Flur", "triggers": [], "actions": []}}
        self.scripts, self.scenes = {}, {}
        self.dashboards = {"test-views": {"meta": {"id": "test_views", "url_path": "test-views", "title": "Test",
                                                    "icon": None, "require_admin": False, "show_in_sidebar": True},
                                           "config": {"views": [{"title": "A"}]}}}
        self.default_dashboard = None
        self.helpers = {"input_boolean": [{"id": "gast", "name": "Gast"}]}
        self.entities = {"light.flur": {"entity_id": "light.flur", "name": None, "area_id": None, "icon": None}}
        self.areas = {"flur": {"area_id": "flur", "name": "Flur", "floor_id": None, "icon": None, "aliases": []}}
        self.floors = {}
        self.devices = {"d" * 32: {"device_id": "d" * 32, "area_id": None, "name_by_user": None, "disabled_by": None,
                                   "labels": []}}
        self.entries = {"E" * 26: {"title": "Plug", "pref_disable_polling": False, "pref_disable_new_entities": False,
                                   "disabled_by": None}}
        self.counter = 0

    # admin ---------------------------------------------------------------
    async def automation_get(self, config_id):
        if config_id not in self.automations:
            raise RuntimeError("Home Assistant returned HTTP 404")
        return dict(self.automations[config_id])

    async def automation_save(self, config_id, config):
        assert "id" not in config
        self.automations[config_id] = {"id": config_id, **config}
        return dict(self.automations[config_id])

    async def automation_delete(self, config_id):
        self.automations.pop(config_id)
        return {"result": "ok"}

    async def dashboard_list(self):
        return [dict(d["meta"]) for d in self.dashboards.values()]

    async def dashboard_get(self, url_path=None):
        if url_path is None:
            if self.default_dashboard is None:
                raise RuntimeError("Home Assistant WebSocket error: config_not_found")
            return self.default_dashboard
        dashboard = self.dashboards.get(url_path)
        if dashboard is None or dashboard["config"] is None:
            raise RuntimeError("Home Assistant WebSocket error: config_not_found")
        return dashboard["config"]

    async def dashboard_save(self, config, *, url_path=None):
        if url_path is None:
            previous, self.default_dashboard = self.default_dashboard, config
        else:
            previous, self.dashboards[url_path]["config"] = self.dashboards[url_path]["config"], config
        return {"previous": previous, "config": config}

    async def dashboard_create(self, title, url_path):
        self.dashboards[url_path] = {"meta": {"id": url_path.replace("-", "_"), "url_path": url_path, "title": title,
                                              "icon": None, "require_admin": False, "show_in_sidebar": True},
                                     "config": None}
        return dict(self.dashboards[url_path]["meta"])

    async def dashboard_update(self, dashboard_id, changes):
        meta = next(d["meta"] for d in self.dashboards.values() if d["meta"]["id"] == dashboard_id)
        meta.update(changes)
        return dict(meta)

    async def dashboard_delete(self, dashboard_id):
        url = next(k for k, d in self.dashboards.items() if d["meta"]["id"] == dashboard_id)
        del self.dashboards[url]

    async def helper_list(self, domain):
        return [dict(h) for h in self.helpers.get(domain, [])]

    async def helper_create(self, domain, config):
        assert "id" not in config
        self.counter += 1
        item = {"id": f"{config['name'].lower()}_{self.counter}", **config}
        self.helpers.setdefault(domain, []).append(item)
        return dict(item)

    async def helper_update(self, domain, helper_id, config):
        item = next(h for h in self.helpers[domain] if h["id"] == helper_id)
        item.clear()
        item.update({"id": helper_id, **config})
        return dict(item)

    async def helper_delete(self, domain, helper_id):
        self.helpers[domain] = [h for h in self.helpers[domain] if h["id"] != helper_id]

    async def entity_registry_list(self):
        return [dict(e) for e in self.entities.values()]

    async def entity_registry_update(self, entity_id, changes):
        self.entities[entity_id].update(changes)
        return dict(self.entities[entity_id])

    # scenes / scripts ------------------------------------------------------
    async def get_script(self, script_id):
        if script_id not in self.scripts:
            raise RuntimeError("Home Assistant returned HTTP 404")
        return dict(self.scripts[script_id])

    async def save_script(self, script_id, config):
        self.scripts[script_id] = dict(config)
        return {"config": config}

    async def delete_script(self, script_id):
        self.scripts.pop(script_id)
        return {"deleted": True}

    async def get_scene(self, scene_id):
        if scene_id not in self.scenes:
            raise RuntimeError("Home Assistant returned HTTP 404")
        return {"id": scene_id, **self.scenes[scene_id]}

    async def save_scene(self, scene_id, config):
        assert "id" not in config
        self.scenes[scene_id] = dict(config)
        return {"config": config}

    async def delete_scene(self, scene_id):
        self.scenes.pop(scene_id)
        return {"deleted": True}

    # registry -------------------------------------------------------------
    async def list_areas(self):
        return [dict(a) for a in self.areas.values()]

    async def create_area(self, name, floor_id=None, icon=None):
        area_id = name.lower().replace(" ", "_") + ("_2" if name.lower() in self.areas else "")
        self.areas[area_id] = {"area_id": area_id, "name": name, "floor_id": floor_id, "icon": icon, "aliases": []}
        return dict(self.areas[area_id])

    async def update_area(self, area_id, changes):
        self.areas[area_id].update(changes)
        return dict(self.areas[area_id])

    async def delete_area(self, area_id):
        del self.areas[area_id]
        return {"deleted": True}

    async def list_floors(self):
        return [dict(f) for f in self.floors.values()]

    async def create_floor(self, name, level=None, icon=None):
        floor_id = name.lower()
        self.floors[floor_id] = {"floor_id": floor_id, "name": name, "level": level, "icon": icon, "aliases": []}
        return dict(self.floors[floor_id])

    async def update_floor(self, floor_id, changes):
        self.floors[floor_id].update(changes)
        return dict(self.floors[floor_id])

    async def delete_floor(self, floor_id):
        del self.floors[floor_id]
        return {"deleted": True}

    async def list_devices(self, area_id="", query="", limit=200):
        return [dict(d) for d in self.devices.values()]

    async def update_device(self, device_id, changes):
        self.devices[device_id].update(changes)
        return dict(self.devices[device_id])

    # integrations ----------------------------------------------------------
    async def entry_view(self, entry_id):
        return {"entry_id": entry_id, **self.entries[entry_id]}

    async def update_entry(self, entry_id, changes):
        self.entries[entry_id].update(changes)
        return await self.entry_view(entry_id)

    async def set_entry_disabled(self, entry_id, disabled):
        self.entries[entry_id]["disabled_by"] = "user" if disabled else None
        return await self.entry_view(entry_id)


def make(tmp_path, moment=NOW):
    ha = FakeHA()
    journal = ChangeJournal(tmp_path / "changes", now=clock(moment))
    return ha, journal, Changes(journal, admin=ha, scenes=ha, registry=ha, integrations=ha)


# ---------------------------------------------------------------- storage
def test_journal_files_are_private_and_listed_newest_first(tmp_path):
    journal = ChangeJournal(tmp_path / "changes", now=clock(NOW))
    first = journal.record(kind="automation", target="a", before=None, tool="ha_save_automation")
    journal.now = clock(NOW + timedelta(seconds=5))
    second = journal.record(kind="scene", target="b", before={"name": "B"}, tool="ha_save_scene")
    assert [e["id"] for e in journal.entries()] == [second, first]
    assert journal.entries(kind="scene")[0]["existed_before"] is True
    assert "before" not in journal.entries()[0] and journal.get(second)["before"] == {"name": "B"}
    assert stat.S_IMODE((tmp_path / "changes").stat().st_mode) == 0o700
    assert all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in (tmp_path / "changes").iterdir())


def test_changes_in_the_same_instant_keep_their_order(tmp_path):
    journal = ChangeJournal(tmp_path / "changes", now=clock(NOW))
    ids = [journal.record(kind="automation", target=str(i), before=None, tool="t") for i in range(30)]
    assert [e["id"] for e in journal.entries(limit=100)] == ids[::-1]
    assert [e["target"] for e in journal.entries(kind="automation", limit=1)] == ["29"]


def test_journal_keeps_30_days_and_ignores_foreign_files(tmp_path):
    journal = ChangeJournal(tmp_path / "changes", now=clock(NOW - timedelta(days=31)))
    old = journal.record(kind="automation", target="a", before=None, tool="t")
    (tmp_path / "changes" / "notes.txt").write_text("keep")
    journal.now = clock(NOW)
    new = journal.record(kind="automation", target="b", before=None, tool="t")
    assert [e["id"] for e in journal.entries()] == [new]
    with pytest.raises(ValueError, match="unknown change"):
        journal.get(old)
    assert (tmp_path / "changes" / "notes.txt").exists()


def test_change_ids_are_checked_before_touching_the_disk(tmp_path):
    journal = ChangeJournal(tmp_path / "changes", now=clock(NOW))
    for bad in ("../x", "", "a/b", "x" * 200):
        with pytest.raises(ValueError):
            journal.get(bad)


# ---------------------------------------------------------------- update, create, delete + undo
async def test_updated_automation_can_be_undone_and_redone(tmp_path):
    ha, journal, changes = make(tmp_path)
    result, change_id = await changes.apply("ha_save_automation", "automation", "flur",
                                            lambda: ha.automation_save("flur", {"alias": "Flur neu", "triggers": []}))
    assert ha.automations["flur"]["alias"] == "Flur neu" and result["alias"] == "Flur neu"
    undo = await changes.undo(change_id)
    assert ha.automations["flur"]["alias"] == "Flur"
    assert journal.get(change_id)["undone_by"] == undo["change_id"]
    with pytest.raises(ValueError, match="already undone"):
        await changes.undo(change_id)
    await changes.undo(undo["change_id"])
    assert ha.automations["flur"]["alias"] == "Flur neu"


async def test_undoing_an_older_change_needs_force_when_newer_ones_exist(tmp_path):
    ha, _, changes = make(tmp_path)
    _, first = await changes.apply("ha_save_automation", "automation", "flur",
                                   lambda: ha.automation_save("flur", {"alias": "Zwei"}))
    _, second = await changes.apply("ha_save_automation", "automation", "flur",
                                    lambda: ha.automation_save("flur", {"alias": "Drei"}))
    with pytest.raises(ValueError, match=second):
        await changes.undo(first)
    assert ha.automations["flur"]["alias"] == "Drei"
    await changes.undo(first, force=True)
    assert ha.automations["flur"]["alias"] == "Flur"


async def test_undo_chains_and_other_fields_do_not_count_as_newer_changes(tmp_path):
    ha, _, changes = make(tmp_path)
    _, created = await changes.apply("ha_save_automation", "automation", "neu",
                                     lambda: ha.automation_save("neu", {"alias": "A"}))
    _, renamed = await changes.apply("ha_save_automation", "automation", "neu",
                                     lambda: ha.automation_save("neu", {"alias": "B"}))
    undo = await changes.undo(renamed)
    redo = await changes.undo(undo["change_id"])
    await changes.undo(redo["change_id"])
    await changes.undo(created)  # the newer changes are all neutralised
    assert "neu" not in ha.automations
    _, name = await changes.apply("ha_update_device", "device", "d" * 32,
                                  lambda: ha.update_device("d" * 32, {"name_by_user": "X"}), fields=["name_by_user"])
    await changes.apply("ha_update_device", "device", "d" * 32,
                        lambda: ha.update_device("d" * 32, {"area_id": "flur"}), fields=["area_id"])
    await changes.undo(name)
    assert ha.devices["d" * 32]["name_by_user"] is None and ha.devices["d" * 32]["area_id"] == "flur"


async def test_created_automation_is_removed_by_undo_and_deleted_one_comes_back(tmp_path):
    ha, journal, changes = make(tmp_path)
    _, created = await changes.apply("ha_save_automation", "automation", "neu",
                                     lambda: ha.automation_save("neu", {"alias": "Neu"}))
    assert journal.get(created)["before"] is None
    await changes.undo(created)
    assert "neu" not in ha.automations
    _, deleted = await changes.apply("ha_delete_automation", "automation", "flur", lambda: ha.automation_delete("flur"))
    await changes.undo(deleted)
    assert ha.automations["flur"]["alias"] == "Flur"


async def test_scene_and_script_round_trip(tmp_path):
    ha, _, changes = make(tmp_path)
    _, scene = await changes.apply("ha_save_scene", "scene", "abend",
                                   lambda: ha.save_scene("abend", {"name": "Abend", "entities": {"light.flur": "on"}}))
    await changes.undo(scene)
    assert "abend" not in ha.scenes
    ha.scripts["nacht"] = {"alias": "Nacht", "sequence": []}
    _, script = await changes.apply("ha_save_script", "script", "nacht",
                                    lambda: ha.save_script("nacht", {"alias": "Nacht 2", "sequence": []}))
    await changes.undo(script)
    assert ha.scripts["nacht"]["alias"] == "Nacht"


async def test_helper_ids_come_from_the_result_and_deleted_helpers_are_recreated(tmp_path):
    ha, journal, changes = make(tmp_path)
    created, change_id = await changes.apply("ha_create_helper", "helper", None,
                                             lambda: ha.helper_create("input_boolean", {"name": "Neu"}),
                                             target_from=lambda r: f"input_boolean/{r['id']}")
    assert journal.get(change_id)["target"] == f"input_boolean/{created['id']}"
    await changes.undo(change_id)
    assert not any(h["id"] == created["id"] for h in ha.helpers["input_boolean"])
    _, deleted = await changes.apply("ha_delete_helper", "helper", "input_boolean/gast",
                                     lambda: ha.helper_delete("input_boolean", "gast"))
    undo = await changes.undo(deleted)
    assert any(h["name"] == "Gast" for h in ha.helpers["input_boolean"])
    assert undo["target"].startswith("input_boolean/")


async def test_registry_updates_restore_only_the_changed_fields(tmp_path):
    ha, _, changes = make(tmp_path)
    _, entity = await changes.apply("ha_update_entity_registry", "entity", "light.flur",
                                    lambda: ha.entity_registry_update("light.flur", {"name": "Deckenlicht"}),
                                    fields=["name"])
    ha.entities["light.flur"]["icon"] = "mdi:lamp"  # unrelated later change stays
    await changes.undo(entity)
    assert ha.entities["light.flur"] == {"entity_id": "light.flur", "name": None, "area_id": None, "icon": "mdi:lamp"}
    _, device = await changes.apply("ha_update_device", "device", "d" * 32,
                                    lambda: ha.update_device("d" * 32, {"area_id": "flur"}), fields=["area_id"])
    await changes.undo(device)
    assert ha.devices["d" * 32]["area_id"] is None


async def test_deleted_area_is_recreated_under_its_name(tmp_path):
    ha, _, changes = make(tmp_path)
    _, deleted = await changes.apply("ha_delete_area", "area", "flur", lambda: ha.delete_area("flur"))
    undo = await changes.undo(deleted)
    assert any(a["name"] == "Flur" for a in ha.areas.values()) and undo["target"]
    _, created = await changes.apply("ha_create_floor", "floor", None, lambda: ha.create_floor("OG", level=1),
                                     target_from=lambda r: r["floor_id"])
    await changes.undo(created)
    assert ha.floors == {}


async def test_dashboards_metadata_and_views_round_trip(tmp_path):
    ha, _, changes = make(tmp_path)
    _, views = await changes.apply("ha_save_dashboard", "dashboard_config", "test-views",
                                   lambda: ha.dashboard_save({"views": [{"title": "B"}]}, url_path="test-views"))
    await changes.undo(views)
    assert ha.dashboards["test-views"]["config"] == {"views": [{"title": "A"}]}
    _, deleted = await changes.apply("ha_delete_dashboard", "dashboard", "test-views",
                                     lambda: ha.dashboard_delete("test_views"))
    await changes.undo(deleted)
    assert ha.dashboards["test-views"]["meta"]["title"] == "Test"
    assert ha.dashboards["test-views"]["config"] == {"views": [{"title": "A"}]}
    _, new = await changes.apply("ha_create_dashboard", "dashboard", "neu-views",
                                 lambda: ha.dashboard_create("Neu", "neu-views"))
    await changes.undo(new)
    assert "neu-views" not in ha.dashboards


async def test_default_dashboard_without_earlier_config_cannot_be_undone(tmp_path):
    ha, _, changes = make(tmp_path)
    _, change_id = await changes.apply("ha_save_dashboard", "dashboard_config", "",
                                       lambda: ha.dashboard_save({"views": []}, url_path=None))
    with pytest.raises(ValueError, match="no earlier"):
        await changes.undo(change_id)


async def test_integration_settings_and_disable_round_trip(tmp_path):
    ha, _, changes = make(tmp_path)
    entry = "E" * 26
    _, renamed = await changes.apply("ha_update_integration", "integration", entry,
                                     lambda: ha.update_entry(entry, {"title": "Steckdose"}), fields=["title"])
    _, disabled = await changes.apply("ha_set_integration_disabled", "integration", entry,
                                      lambda: ha.set_entry_disabled(entry, True), fields=["disabled_by"])
    await changes.undo(disabled)
    assert ha.entries[entry]["disabled_by"] is None
    await changes.undo(renamed)
    assert ha.entries[entry]["title"] == "Plug"


async def test_a_failed_change_is_not_journaled(tmp_path):
    ha, journal, changes = make(tmp_path)

    async def boom():
        raise RuntimeError("Home Assistant returned HTTP 500")
    with pytest.raises(RuntimeError):
        await changes.apply("ha_save_automation", "automation", "flur", boom)
    assert journal.entries() == []


def test_change_tools_are_registered():
    import asyncio
    from ha_safe_mcp.server import HAClient, create_server
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    assert {"ha_list_changes", "ha_get_change", "ha_undo_change"} <= names


def test_journal_location_follows_the_environment(tmp_path, monkeypatch):
    from ha_safe_mcp.changes import journal_from_env
    monkeypatch.setenv("HA_CHANGES_DIR", str(tmp_path / "x"))
    assert journal_from_env().directory == tmp_path / "x"


async def test_chat_runner_hands_the_journal_location_to_the_mcp_server(tmp_path, monkeypatch):
    from ha_safe_mcp import web
    from ha_safe_mcp.config_store import SettingsStore
    from ha_safe_mcp.ollama_client import HA_ENV_KEYS
    captured = {}

    def fake_params(env):
        captured.update(env)
        raise RuntimeError("stop here")

    monkeypatch.setattr(web, "mcp_parameters_for", fake_params)
    with pytest.raises(RuntimeError):
        await web.mcp_chat_runner(SettingsStore(tmp_path / ".env").load(), "x", [], False, None, None,
                                  changes_dir=tmp_path / "j")
    assert captured["HA_CHANGES_DIR"] == str(tmp_path / "j") and "HA_CHANGES_DIR" in HA_ENV_KEYS


def test_journal_entries_are_plain_json(tmp_path):
    journal = ChangeJournal(tmp_path / "changes", now=clock(NOW))
    change_id = journal.record(kind="area", target="flur", before={"name": "Flur"}, tool="ha_update_area")
    assert json.loads((tmp_path / "changes" / f"{change_id}.json").read_text())["before"] == {"name": "Flur"}


def test_chat_offers_undo_tools_and_treats_undo_like_a_delete():
    from ha_safe_mcp.ollama_client import select_tool_names, write_level
    available = {"ha_list_changes", "ha_get_change", "ha_undo_change", "ha_search_entities", "ha_get_state"}
    assert {"ha_list_changes", "ha_undo_change"} <= select_tool_names("Mach die letzte Änderung rückgängig",
                                                                      available, allow_write=True)
    assert "ha_undo_change" not in select_tool_names("Mach das rückgängig", available, allow_write=False)
    assert write_level("ha_undo_change") == "delete" and write_level("ha_list_changes") is None
