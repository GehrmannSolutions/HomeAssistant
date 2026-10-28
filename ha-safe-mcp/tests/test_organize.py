"""Labels, categories, zones and more entity registry fields: gated writes, read-back, journal and undo."""
import copy
from datetime import datetime, timezone

import pytest

from ha_safe_mcp.changes import ChangeJournal, Changes
from ha_safe_mcp.management import HAAdmin
from ha_safe_mcp.organize import HAOrganizer
from ha_safe_mcp.registry import HARegistry
from ha_safe_mcp.server import HAClient

DEVICE_ID = "00000000000000000000000000000001"


class FakeWS:
    """In-memory label/category/zone/entity/device/area registries with HA's command names and errors."""

    def __init__(self):
        self.calls = []
        self.labels = [{"label_id": "batterie", "name": "Batterie", "color": "amber", "icon": "mdi:battery",
                        "description": None, "created_at": 0, "modified_at": 0}]
        self.categories = {"automation": [{"category_id": "c1", "name": "Licht", "icon": None}]}
        self.zones = [{"id": "arbeit", "name": "Arbeit", "latitude": 52.5, "longitude": 13.4, "radius": 100.0,
                       "passive": False, "icon": "mdi:briefcase"}]
        self.entities = [
            {"entity_id": "light.flur", "name": None, "icon": None, "area_id": None, "labels": ["batterie"],
             "categories": {}, "disabled_by": None, "hidden_by": None, "aliases": [], "platform": "hue"},
            {"entity_id": "automation.morgens", "name": None, "icon": None, "area_id": None, "labels": [],
             "categories": {"automation": "c1"}, "disabled_by": None, "hidden_by": None, "aliases": [],
             "platform": "automation"},
        ]
        self.devices = [{"id": DEVICE_ID, "name": "Plug", "name_by_user": None, "manufacturer": "Shelly",
                         "model": "S", "area_id": None, "disabled_by": None, "entry_type": None,
                         "labels": ["batterie"]}]
        self.areas = [{"area_id": "flur", "name": "Flur", "floor_id": None, "icon": None, "aliases": [],
                       "labels": ["batterie"]}]

    @staticmethod
    def _slug(name):
        return name.lower().replace(" ", "_")

    def _entity(self, entity_id):
        found = next((e for e in self.entities if e["entity_id"] == entity_id), None)
        if found is None:
            raise RuntimeError("Home Assistant WebSocket error: not_found")
        return found

    async def command(self, kind, payload=None, **_):
        payload = copy.deepcopy(payload or {})
        self.calls.append((kind, payload))
        if kind == "config/label_registry/list":
            return copy.deepcopy(self.labels)
        if kind == "config/label_registry/create":
            if any(lab["name"].casefold() == payload["name"].casefold() for lab in self.labels):
                raise RuntimeError("Home Assistant WebSocket error: invalid_info")
            label = {"label_id": self._slug(payload["name"]), "color": None, "icon": None, "description": None,
                     **payload}
            self.labels.append(label)
            return copy.deepcopy(label)
        if kind == "config/label_registry/update":
            label_id = payload.pop("label_id")
            label = next(lab for lab in self.labels if lab["label_id"] == label_id)
            label.update(payload)
            return copy.deepcopy(label)
        if kind == "config/label_registry/delete":
            self.labels = [lab for lab in self.labels if lab["label_id"] != payload["label_id"]]
            for item in self.entities + self.devices + self.areas:  # HA removes the label everywhere
                item["labels"] = [x for x in item["labels"] if x != payload["label_id"]]
            return "success"
        if kind == "config/category_registry/list":
            return copy.deepcopy(self.categories.get(payload["scope"], []))
        if kind == "config/category_registry/create":
            scope = self.categories.setdefault(payload.pop("scope"), [])
            category = {"category_id": f"c{sum(len(v) for v in self.categories.values()) + 1}", "icon": None,
                        **payload}
            scope.append(category)
            return copy.deepcopy(category)
        if kind == "config/category_registry/update":
            scope, cid = payload.pop("scope"), payload.pop("category_id")
            category = next(c for c in self.categories[scope] if c["category_id"] == cid)
            category.update(payload)
            return copy.deepcopy(category)
        if kind == "config/category_registry/delete":
            scope, cid = payload["scope"], payload["category_id"]
            self.categories[scope] = [c for c in self.categories[scope] if c["category_id"] != cid]
            for entity in self.entities:
                if entity["categories"].get(scope) == cid:
                    del entity["categories"][scope]
            return "success"
        if kind == "zone/list":
            return copy.deepcopy(self.zones)
        if kind == "zone/create":
            zone = {"id": self._slug(payload["name"]), "radius": 100.0, "passive": False, **payload}
            self.zones.append(zone)
            return copy.deepcopy(zone)
        if kind == "zone/update":
            zone_id = payload.pop("zone_id")
            zone = next(z for z in self.zones if z["id"] == zone_id)
            zone.update(payload)
            return copy.deepcopy(zone)
        if kind == "zone/delete":
            self.zones = [z for z in self.zones if z["id"] != payload["zone_id"]]
            return None
        if kind == "config/entity_registry/list":
            return [{k: v for k, v in e.items() if k != "aliases"} for e in copy.deepcopy(self.entities)]
        if kind == "config/entity_registry/get":
            return copy.deepcopy(self._entity(payload["entity_id"]))
        if kind == "config/entity_registry/update":
            entity = self._entity(payload.pop("entity_id"))
            new_id = payload.pop("new_entity_id", None)
            if new_id:
                if any(e["entity_id"] == new_id for e in self.entities):
                    raise RuntimeError("Home Assistant WebSocket error: invalid_info")
                entity["entity_id"] = new_id
            if "categories" in payload:
                for scope, cid in payload.pop("categories").items():
                    if cid is None:
                        entity["categories"].pop(scope, None)
                    else:
                        entity["categories"][scope] = cid
            if "options_domain" in payload:  # HA replaces the domain's options as a whole
                domain, options = payload.pop("options_domain"), payload.pop("options")
                entity["options"] = {k: v for k, v in (entity.get("options") or {}).items() if k != domain}
                if options is not None:
                    entity["options"][domain] = options
            entity.update(payload)
            return {"entity_entry": copy.deepcopy(entity)}
        if kind == "config/device_registry/list":
            return copy.deepcopy(self.devices)
        if kind == "config/device_registry/update":
            device_id = payload.pop("device_id")
            device = next(d for d in self.devices if d["id"] == device_id)
            device.update(payload)
            return copy.deepcopy(device)
        if kind == "config/area_registry/list":
            return copy.deepcopy(self.areas)
        if kind == "config/floor_registry/list":
            return []
        if kind == "config/area_registry/update":
            area_id = payload.pop("area_id")
            area = next(a for a in self.areas if a["area_id"] == area_id)
            area.update(payload)
            return copy.deepcopy(area)
        raise AssertionError(f"unexpected ws command {kind}")


class Client(HAClient):
    """States follow the fake's storage zones, like HA (a deleted zone's entity disappears)."""
    ws = None

    async def _request(self, method, path, **kwargs):
        assert (method, path) == ("GET", "/api/states")
        home = {"entity_id": "zone.home", "state": "2", "attributes": {"friendly_name": "Zuhause", "latitude": 1.0,
                                                                        "longitude": 2.0, "radius": 50, "passive": False}}
        return [home] + [{"entity_id": f"zone.{z['id']}", "state": "0",
                          "attributes": {"friendly_name": z["name"], "latitude": z["latitude"],
                                         "longitude": z["longitude"], "radius": z["radius"]}} for z in self.ws.zones]


def make(*, write=True, admin=True, delete=True, ws=None):
    ws = ws or FakeWS()
    client = Client("http://ha:8123", "t", allow_write=write)
    client.ws = ws
    gates = {"allow_admin_write": admin, "allow_delete": delete}
    return HAOrganizer(client, ws, **gates), HAAdmin(client, ws, **gates), HARegistry(client, ws, **gates), ws


def changes_for(tmp_path, organizer, admin, registry):
    journal = ChangeJournal(tmp_path / "changes", now=lambda: datetime(2026, 10, 25, tzinfo=timezone.utc))
    return Changes(journal, admin=admin, scenes=None, registry=registry, integrations=None, organizer=organizer)


# ---------------------------------------------------------------------- labels
async def test_labels_are_listed_with_usage_and_members():
    organizer, *_ = make()
    assert await organizer.list_labels() == [{"label_id": "batterie", "name": "Batterie", "color": "amber",
                                              "icon": "mdi:battery", "description": None,
                                              "used_by": {"entities": 1, "devices": 1, "areas": 1}}]
    label = await organizer.get_label("batterie")
    assert label["members"] == {"entities": ["light.flur"], "devices": [{"device_id": DEVICE_ID, "name": "Plug"}],
                                "areas": ["flur"]}
    with pytest.raises(ValueError, match="unknown label_id"):
        await organizer.get_label("gibtsnicht")


async def test_label_writes_are_validated_gated_and_read_back():
    organizer, *_ = make()
    created = await organizer.create_label("Urlaub", color="#00ff00", icon="mdi:airplane", description="weg")
    assert created["label_id"] == "urlaub" and created["color"] == "#00ff00"
    for bad in ({"name": ""}, {"name": "x", "color": "rainbow"}, {"name": "x", "icon": "airplane"}):
        with pytest.raises(ValueError):
            await organizer.create_label(**bad)
    with pytest.raises(ValueError, match="already exists"):
        await organizer.create_label("batterie")
    assert (await organizer.update_label("urlaub", {"color": "teal"}))["color"] == "teal"
    with pytest.raises(ValueError, match="unsupported"):
        await organizer.update_label("urlaub", {"label_id": "x"})
    assert await organizer.delete_label("urlaub") == {"deleted": True}
    read_only, *_ = make(admin=False)
    with pytest.raises(ValueError, match="admin write disabled"):
        await read_only.create_label("Neu")
    no_delete, *_ = make(delete=False)
    with pytest.raises(ValueError, match="delete disabled"):
        await no_delete.delete_label("batterie")


# ---------------------------------------------------------------------- categories
async def test_categories_per_scope():
    organizer, _, _, ws = make()
    assert await organizer.list_categories("automation") == [{"category_id": "c1", "name": "Licht", "icon": None,
                                                               "used_by": 1}]
    created = await organizer.create_category("automation", "Heizung", icon="mdi:radiator")
    assert created["name"] == "Heizung"
    assert (await organizer.update_category("automation", created["category_id"], {"name": "Wärme"}))["name"] == "Wärme"
    with pytest.raises(ValueError, match="scope"):
        await organizer.list_categories("Automation!")
    with pytest.raises(ValueError, match="unknown category_id"):
        await organizer.update_category("automation", "c99", {"name": "x"})
    assert await organizer.delete_category("automation", created["category_id"]) == {"deleted": True}


# ---------------------------------------------------------------------- zones
async def test_zones_merge_editable_storage_zones_with_yaml_and_home():
    organizer, *_ = make()
    zones = {z["entity_id"]: z for z in await organizer.list_zones()}
    assert zones["zone.arbeit"]["editable"] is True and zones["zone.arbeit"]["zone_id"] == "arbeit"
    assert zones["zone.home"]["editable"] is False and zones["zone.home"]["zone_id"] is None
    assert zones["zone.home"]["persons_inside"] == 2


async def test_zone_writes_are_validated_and_yaml_zones_are_refused():
    organizer, *_ = make()
    created = await organizer.create_zone("Sport", 52.0, 13.0, radius=150, icon="mdi:dumbbell")
    assert created["zone_id"] == "sport" and created["radius"] == 150
    for bad in ({"latitude": 91}, {"longitude": -181}, {"radius": 0}, {"radius": 200000}, {"name": " "}):
        with pytest.raises(ValueError):
            await organizer.create_zone(**{"name": "x", "latitude": 1, "longitude": 1, **bad})
    assert (await organizer.update_zone("sport", {"radius": 300}))["radius"] == 300
    with pytest.raises(ValueError, match="not editable|unknown zone_id"):
        await organizer.update_zone("home", {"radius": 300})
    assert await organizer.delete_zone("sport") == {"deleted": True}


# ---------------------------------------------------------------------- entity registry
async def test_entity_registry_accepts_labels_categories_aliases_and_hiding():
    _, admin, _, ws = make()
    current = await admin.entity_registry_update("light.flur", {
        "labels": ["batterie"], "categories": {"automation": None}, "aliases": ["Gang"], "hidden_by": "user",
        "name": "Flurlicht"})
    assert current["aliases"] == ["Gang"] and current["hidden_by"] == "user" and current["name"] == "Flurlicht"
    with pytest.raises(ValueError, match="unknown label"):
        await admin.entity_registry_update("light.flur", {"labels": ["gibtsnicht"]})
    with pytest.raises(ValueError, match="hidden_by"):
        await admin.entity_registry_update("light.flur", {"hidden_by": "integration"})
    with pytest.raises(ValueError, match="unsupported"):
        await admin.entity_registry_update("light.flur", {"platform": "x"})
    assert (await admin.entity_registry_get("light.flur"))["aliases"] == ["Gang"]
    assert await admin.entity_registry_get("light.gibtsnicht") is None


async def test_display_precision_keeps_other_sensor_options_and_can_be_reset():
    _, admin, _, ws = make()
    ws.entities.append({"entity_id": "sensor.zelt_temp", "name": None, "icon": None, "area_id": None, "labels": [],
                        "categories": {}, "disabled_by": None, "hidden_by": None, "aliases": [], "platform": "vendor",
                        "options": {"sensor": {"unit_of_measurement": "°C", "suggested_display_precision": 2},
                                    "conversation": {"should_expose": False}}})
    current = await admin.entity_registry_update("sensor.zelt_temp", {"display_precision": 1, "name": "Zelt"})
    assert current["display_precision"] == 1 and current["name"] == "Zelt"
    assert current["options"]["sensor"] == {"unit_of_measurement": "°C", "suggested_display_precision": 2,
                                            "display_precision": 1}
    assert current["options"]["conversation"] == {"should_expose": False}
    reset = await admin.entity_registry_update("sensor.zelt_temp", {"display_precision": None})
    assert reset["display_precision"] is None and reset["options"]["sensor"]["unit_of_measurement"] == "°C"
    for bad in (-1, 11, 1.5, True, "1"):
        with pytest.raises(ValueError, match="display_precision"):
            await admin.entity_registry_update("sensor.zelt_temp", {"display_precision": bad})
    with pytest.raises(ValueError, match="only exists for sensor"):
        await admin.entity_registry_update("light.flur", {"display_precision": 1})


async def test_display_precision_change_can_be_undone(tmp_path):
    organizer, admin, registry, ws = make()
    ws.entities.append({"entity_id": "sensor.zelt_rh", "name": None, "icon": None, "area_id": None, "labels": [],
                        "categories": {}, "disabled_by": None, "hidden_by": None, "aliases": [], "platform": "vendor",
                        "options": {}})
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_update_entity_registry", "entity", "sensor.zelt_rh",
                                       lambda: admin.entity_registry_update("sensor.zelt_rh", {"display_precision": 0}),
                                       fields=["display_precision"])
    assert (await admin.entity_registry_get("sensor.zelt_rh"))["display_precision"] == 0
    await changes.undo(change_id)
    assert (await admin.entity_registry_get("sensor.zelt_rh"))["display_precision"] is None


async def test_rename_entity_keeps_the_domain_and_refuses_taken_ids():
    _, admin, _, ws = make()
    renamed = await admin.entity_rename("light.flur", "light.flur_decke")
    assert renamed["entity_id"] == "light.flur_decke"
    with pytest.raises(ValueError, match="same domain"):
        await admin.entity_rename("light.flur_decke", "switch.flur")
    ws.entities.append({**ws.entities[0], "entity_id": "light.taken"})
    with pytest.raises(ValueError, match="already exists"):
        await admin.entity_rename("light.flur_decke", "light.taken")
    with pytest.raises(ValueError, match="equals"):
        await admin.entity_rename("light.flur_decke", "light.flur_decke")


# ---------------------------------------------------------------------- journal + undo
async def test_undo_of_a_label_delete_restores_the_label_and_where_it_was_used(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_delete_label", "label", "batterie",
                                       lambda: organizer.delete_label("batterie"), fields=["assigned"])
    assert ws.labels == [] and ws.entities[0]["labels"] == [] and ws.devices[0]["labels"] == []
    result = await changes.undo(change_id)
    assert result["target"] == "batterie" and [lab["label_id"] for lab in ws.labels] == ["batterie"]
    assert ws.labels[0]["color"] == "amber" and ws.labels[0]["icon"] == "mdi:battery"
    assert ws.entities[0]["labels"] == ["batterie"] and ws.devices[0]["labels"] == ["batterie"]
    assert ws.areas[0]["labels"] == ["batterie"]


async def test_undo_of_label_and_category_create_or_update(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, created = await changes.apply("ha_create_label", "label", None, lambda: organizer.create_label("Neu"),
                                     target_from=lambda r: r["label_id"])
    await changes.undo(created)
    assert [lab["label_id"] for lab in ws.labels] == ["batterie"]
    _, updated = await changes.apply("ha_update_category", "category", "automation/c1",
                                     lambda: organizer.update_category("automation", "c1", {"name": "Lampen"}))
    await changes.undo(updated)
    assert ws.categories["automation"][0]["name"] == "Licht"


async def test_undo_of_a_category_delete_restores_the_category_on_its_entities(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_delete_category", "category", "automation/c1",
                                       lambda: organizer.delete_category("automation", "c1"), fields=["assigned"])
    assert ws.entities[1]["categories"] == {}
    result = await changes.undo(change_id)
    new_id = result["target"].split("/", 1)[1]
    assert [c["name"] for c in ws.categories["automation"]] == ["Licht"]
    assert ws.entities[1]["categories"] == {"automation": new_id}


async def test_undo_of_a_zone_delete_recreates_it(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_delete_zone", "zone", "arbeit", lambda: organizer.delete_zone("arbeit"))
    assert ws.zones == []
    result = await changes.undo(change_id)
    assert [z["name"] for z in ws.zones] == ["Arbeit"] and ws.zones[0]["radius"] == 100.0
    assert result["target"] == ws.zones[0]["id"]


async def test_undo_of_a_rename_renames_back_and_can_be_redone(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_rename_entity", "entity", "light.flur",
                                       lambda: admin.entity_rename("light.flur", "light.decke"),
                                       fields=["new_entity_id"], target_from=lambda r: r["entity_id"])
    entry = changes.journal.get(change_id)
    assert entry["target"] == "light.decke" and entry["before"] == {"new_entity_id": "light.flur"}
    undo = await changes.undo(change_id)
    assert undo["target"] == "light.flur" and ws.entities[0]["entity_id"] == "light.flur"
    await changes.undo(undo["change_id"])
    assert ws.entities[0]["entity_id"] == "light.decke"


async def test_undo_of_entity_alias_and_label_changes(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    _, change_id = await changes.apply("ha_update_entity_registry", "entity", "light.flur",
                                       lambda: admin.entity_registry_update("light.flur", {"aliases": ["Gang"],
                                                                                           "labels": []}),
                                       fields=["aliases", "labels"])
    await changes.undo(change_id)
    assert ws.entities[0]["aliases"] == [] and ws.entities[0]["labels"] == ["batterie"]


async def test_old_area_journal_entries_without_labels_still_undo(tmp_path):
    organizer, admin, registry, ws = make()
    changes = changes_for(tmp_path, organizer, admin, registry)
    old = changes.journal.record(kind="area", target="flur", tool="ha_update_area",
                                 before={"name": "Gang", "floor_id": None, "icon": None, "aliases": []})
    await changes.undo(old)
    assert ws.areas[0]["name"] == "Gang" and ws.areas[0]["labels"] == ["batterie"]


# ---------------------------------------------------------------------- registration
def test_tools_are_registered_with_the_right_levels():
    import asyncio
    from ha_safe_mcp.ollama_client import DELETE_TOOLS, READ_TOOLS, WRITE_TOOLS
    from ha_safe_mcp.remote import tool_level
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    read = {"ha_list_labels", "ha_get_label", "ha_list_categories", "ha_list_zones", "ha_get_entity_registry"}
    write = {"ha_create_label", "ha_update_label", "ha_create_category", "ha_update_category", "ha_create_zone",
             "ha_update_zone", "ha_rename_entity"}
    delete = {"ha_delete_label", "ha_delete_category", "ha_delete_zone"}
    assert read | write | delete <= names
    assert read <= READ_TOOLS and write | delete <= WRITE_TOOLS and delete <= DELETE_TOOLS
    assert {tool_level(n) for n in read} == {"read"} and {tool_level(n) for n in write} == {"admin"}
    assert {tool_level(n) for n in delete} == {"delete"}
