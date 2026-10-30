"""Demo home for the documentation, the screenshots and chat tests, built through ha-safe-mcp itself.
TEST INSTANCES ONLY: it edits configuration.yaml, writes a package and restarts Home Assistant.

    HA_CONFIG_DIR=/path/to/test/config python scripts/docs_demo_home.py --env-file /path/to/test.env

Every device is a template entity backed by an input_boolean (so switching works without hardware), and every
step goes through the MCP's own tools, so the run also exercises them. Every change is journaled and can be undone.

What it builds (German names, like the web UI screenshots):

| What | Details |
|---|---|
| Floors | Erdgeschoss (0), Keller (-1), Dachgeschoss (1) |
| Rooms | 17, e.g. Wohnzimmer, Küche, Schlafzimmer, Büro, Waschküche, Technikraum, Dachboden, Terrasse |
| Lights | 20; the first demo home's three keep their IDs (light.stehlampe, light.deckenlicht, light.arbeitslicht) |
| Switches | 8 appliances with a power sensor each (Fernseher, Kaffeemaschine, Waschmaschine, ...) |
| Covers | 7 shutters (Rollladen <room>), open/close and position (any position above 0 counts as open) |
| Lock | Haustür |
| Sensors | room temperatures, 4 window contacts, power per appliance and the whole house (Hausverbrauch) |
| Helpers | Klingel, Urlaubsmodus |
| Automations | Abendlicht, Rollläden bei Sonnenuntergang, Haustür um 22 Uhr abschließen, Fenster offen (Hinweis) |
| Scene, script | Filmabend; Alles aus |

At the end it sets a few demo states (TV and washing machine on, three basement lights on, bathroom window open) and
prints example prompts; scripts/doc_screenshots.py has chat scenarios for them (floor-off, cover, lock, scene, power,
windows).
"""
import asyncio
import json
import os
import sys
import tempfile
import time

from dotenv import dotenv_values
from mcp import ClientSession
from mcp.client.stdio import stdio_client

from ha_safe_mcp.ollama_client import HA_ENV_KEYS, mcp_parameters_for

if len(sys.argv) != 3 or sys.argv[1] != "--env-file" or not os.environ.get("HA_CONFIG_DIR"):
    raise SystemExit(__doc__)
env = {k: v for k, v in dotenv_values(sys.argv[2]).items() if k in HA_ENV_KEYS and v}
env.update(HA_AUDIT="false", HA_ALLOW_WRITE="true", HA_ALLOW_ADMIN_WRITE="true", HA_ALLOW_DELETE="true",
           HA_CHANGES_DIR=os.environ.get("HA_CHANGES_DIR", os.path.join(tempfile.gettempdir(), "docs-demo-journal")),
           HA_ALLOWED_DOMAINS="light,switch,cover,lock,input_boolean,automation,scene,script,homeassistant",
           HA_CONFIG_DIR=os.environ["HA_CONFIG_DIR"])

FLOORS = [("Erdgeschoss", 0, "mdi:home-floor-0"), ("Keller", -1, "mdi:home-floor-negative-1"),
          ("Dachgeschoss", 1, "mdi:home-floor-1")]
ROOMS = {  # name -> (floor, icon)
    "Wohnzimmer": ("Erdgeschoss", "mdi:sofa"), "Esszimmer": ("Erdgeschoss", "mdi:silverware-fork-knife"),
    "Küche": ("Erdgeschoss", "mdi:countertop"), "Diele": ("Erdgeschoss", "mdi:coat-rack"),
    "Windfang": ("Erdgeschoss", "mdi:door"), "Bad": ("Erdgeschoss", "mdi:shower"), "WC": ("Erdgeschoss", "mdi:toilet"),
    "Schlafzimmer": ("Erdgeschoss", "mdi:bed-king"), "Kinderzimmer": ("Erdgeschoss", "mdi:teddy-bear"),
    "Gästezimmer": ("Erdgeschoss", "mdi:bed-outline"), "Terrasse": ("Erdgeschoss", "mdi:table-chair"),
    "Büro": ("Keller", "mdi:chair-rolling"), "Waschküche": ("Keller", "mdi:washing-machine"),
    "Heizungsraum": ("Keller", "mdi:water-boiler"), "Werkstatt": ("Keller", "mdi:hammer-wrench"),
    "Technikraum": ("Keller", "mdi:server-network"), "Dachboden": ("Dachgeschoss", "mdi:home-roof"),
}
# key -> (domain, name, room, icon); the backing helper is input_boolean.demo_<key>
LEGACY = {"stehlampe", "deckenlicht", "arbeitslicht"}   # the first demo home: same helpers, names and entity IDs
DEVICES = {
    "stehlampe": ("light", "Stehlampe", "Wohnzimmer", "mdi:floor-lamp"),
    "deckenlicht": ("light", "Deckenlicht", "Wohnzimmer", "mdi:ceiling-light"),
    "arbeitslicht": ("light", "Arbeitslicht", "Küche", "mdi:light-recessed"),
    "esstisch": ("light", "Esstisch", "Esszimmer", "mdi:ceiling-light-multiple"),
    "diele": ("light", "Diele Decke", "Diele", "mdi:ceiling-light"),
    "windfang": ("light", "Windfang Licht", "Windfang", "mdi:wall-sconce-flat"),
    "bad": ("light", "Bad Spiegelschrank", "Bad", "mdi:mirror"),
    "wc": ("light", "WC Licht", "WC", "mdi:ceiling-light"),
    "schlafzimmer": ("light", "Schlafzimmer Decke", "Schlafzimmer", "mdi:ceiling-light"),
    "nachttische": ("light", "Nachttische", "Schlafzimmer", "mdi:lamp"),
    "kinderzimmer": ("light", "Kinderzimmer Decke", "Kinderzimmer", "mdi:ceiling-light"),
    "gaestezimmer": ("light", "Gästezimmer Decke", "Gästezimmer", "mdi:ceiling-light"),
    "terrasse": ("light", "Terrasse Licht", "Terrasse", "mdi:outdoor-lamp"),
    "buero": ("light", "Büro Decke", "Büro", "mdi:ceiling-light"),
    "schreibtisch": ("light", "Schreibtischlampe", "Büro", "mdi:desk-lamp"),
    "waschkueche": ("light", "Waschküche Licht", "Waschküche", "mdi:ceiling-light"),
    "heizungsraum": ("light", "Heizungsraum Licht", "Heizungsraum", "mdi:ceiling-light"),
    "werkstatt": ("light", "Werkstatt Licht", "Werkstatt", "mdi:fluorescent-tube"),
    "technikraum": ("light", "Technikraum Licht", "Technikraum", "mdi:ceiling-light"),
    "dachboden": ("light", "Dachboden Licht", "Dachboden", "mdi:lightbulb"),
    "fernseher": ("switch", "Fernseher", "Wohnzimmer", "mdi:television"),
    "kaffeemaschine": ("switch", "Kaffeemaschine", "Küche", "mdi:coffee-maker"),
    "geschirrspueler": ("switch", "Geschirrspüler", "Küche", "mdi:dishwasher"),
    "monitore": ("switch", "Monitore", "Büro", "mdi:monitor-multiple"),
    "waschmaschine": ("switch", "Waschmaschine", "Waschküche", "mdi:washing-machine"),
    "trockner": ("switch", "Trockner", "Waschküche", "mdi:tumble-dryer"),
    "heizluefter": ("switch", "Heizlüfter", "Werkstatt", "mdi:radiator"),
    "netzwerk": ("switch", "Netzwerkschrank", "Technikraum", "mdi:router-network"),
    "haustuer": ("lock", "Haustür", "Windfang", "mdi:door-closed-lock"),
}
for _key, _room in (("wohnzimmer", "Wohnzimmer"), ("esszimmer", "Esszimmer"), ("kueche", "Küche"),
                    ("schlafzimmer", "Schlafzimmer"), ("kinderzimmer", "Kinderzimmer"),
                    ("gaestezimmer", "Gästezimmer"), ("buero", "Büro")):
    DEVICES[f"rollladen_{_key}"] = ("cover", f"Rollladen {_room}", _room, "mdi:window-shutter")
WATTS = {"fernseher": (95, 0.5), "kaffeemaschine": (1350, 0), "geschirrspueler": (2050, 0.3), "monitore": (60, 1),
         "waschmaschine": (2100, 0.4), "trockner": (780, 0.4), "heizluefter": (2000, 0), "netzwerk": (42, 42)}
WINDOWS = {"wohnzimmer": "Wohnzimmer", "schlafzimmer": "Schlafzimmer", "bad": "Bad", "werkstatt": "Werkstatt"}
TEMPERATURES = {"Wohnzimmer": 21.5, "Küche": 20.5, "Bad": 23.0, "Schlafzimmer": 18.5, "Kinderzimmer": 20.0,
                "Büro": 21.0, "Werkstatt": 15.5, "Dachboden": 11.0, "Terrasse": 9.5}
HELPERS = {"klingel": ("Klingel", "mdi:doorbell"), "urlaubsmodus": ("Urlaubsmodus", "mdi:airplane")}
VERBS = {"light": ("turn_on", "turn_off"), "switch": ("turn_on", "turn_off"), "lock": ("lock", "unlock"),
         "cover": ("open_cover", "close_cover")}
EXAMPLE_PROMPTS = [
    "Welche Lichter sind im Erdgeschoss an?",
    "Mach im Keller alle Lichter aus.",
    "Welche Fenster sind gerade offen?",
    "Wie viel Strom verbraucht das Haus gerade, und welches Gerät zieht am meisten?",
    "Fahr den Rollladen im Wohnzimmer runter.",
    "Ist die Haustür abgeschlossen? Wenn nicht, schließ sie ab.",
    "Starte die Szene Filmabend.",
    "Was macht die Automation 'Rollläden bei Sonnenuntergang'?",
    "Erstelle eine Automation: Wenn der Urlaubsmodus an ist, um 19 Uhr das Wohnzimmerlicht einschalten.",
]


def slug(text: str) -> str:
    return text.lower().replace(" ", "_")


def ib(key: str) -> str:
    return f"input_boolean.demo_{key}"


def yaml_actions(verb: str, action: str, key: str) -> list[str]:
    return [f"        {verb}:", f"          - action: input_boolean.{action}", "            target:",
            f"              entity_id: {ib(key)}"]


def package() -> str:
    lines = ["# Demo home for the ha-safe-mcp documentation (test instances only)", "input_boolean:"]
    for key, (_, name, _, _) in DEVICES.items():
        label = f"{name} Schalter" if key in LEGACY else f"{name} (Demo-Zustand)"
        lines += [f"  demo_{key}:", f"    name: {label}"]
    for key, room in WINDOWS.items():
        lines += [f"  demo_fenster_{key}:", f"    name: Fenster {room} (Demo-Zustand)", "    icon: mdi:window-open"]
    for key, (name, icon) in HELPERS.items():
        lines += [f"  demo_{key}:", f"    name: {name}", f"    icon: {icon}"]
    lines += ["", "template:"]
    for domain in ("light", "switch", "lock", "cover"):
        lines.append(f"  - {domain}:")
        for key, (dom, name, _, _) in DEVICES.items():
            if dom != domain:
                continue
            uid = f"demo_light_{key}" if key in LEGACY else f"demo_{domain}_{key}"
            if domain == "cover":
                state = f"{{{{ 'open' if is_state('{ib(key)}', 'on') else 'closed' }}}}"
            else:
                state = f"{{{{ is_state('{ib(key)}', 'on') }}}}"
            lines += [f"      - name: {name}", f"        unique_id: {uid}", f"        state: \"{state}\""]
            if domain == "cover":   # position too, so set_cover_position works (any position > 0 opens)
                lines += ["        device_class: shutter",
                          f"        position: \"{{{{ 100 if is_state('{ib(key)}', 'on') else 0 }}}}\"",
                          "        set_cover_position:",
                          "          - action: \"input_boolean.turn_{{ 'on' if position | int(0) > 0 else 'off' }}\"",
                          "            target:", f"              entity_id: {ib(key)}"]
            on, off = VERBS[domain]
            lines += yaml_actions(on, "turn_on", key) + yaml_actions(off, "turn_off", key)
    lines.append("  - binary_sensor:")
    for key, room in WINDOWS.items():
        lines += [f"      - name: Fenster {room}", f"        unique_id: demo_window_{key}", "        device_class: window",
                  f"        state: \"{{{{ is_state('{ib('fenster_' + key)}', 'on') }}}}\""]
    lines.append("  - sensor:")
    for key, (on_w, off_w) in WATTS.items():
        name = DEVICES[key][1]
        lines += [f"      - name: {name} Leistung", f"        unique_id: demo_power_{key}", "        device_class: power",
                  "        unit_of_measurement: W", "        state_class: measurement",
                  f"        state: \"{{{{ {on_w} if is_state('{ib(key)}', 'on') else {off_w} }}}}\""]
    total = " + ".join(f"({w} if is_state('{ib(k)}', 'on') else {o})" for k, (w, o) in WATTS.items())
    lines += ["      - name: Hausverbrauch", "        unique_id: demo_power_total", "        device_class: power",
              "        unit_of_measurement: W", "        state_class: measurement",
              f"        state: \"{{{{ ({total} + 180) | round(1) }}}}\""]   # 180 W base load (fridge, heating pump)
    for room, value in TEMPERATURES.items():
        lines += [f"      - name: Temperatur {room}", f"        unique_id: demo_temp_{slug(room)}",
                  "        device_class: temperature", "        unit_of_measurement: \"°C\"",
                  "        state_class: measurement", f"        state: \"{value}\""]
    return "\n".join(lines) + "\n"


def data(res):
    if res.isError:
        return {"ERROR": res.content[0].text[:400]}
    sc = res.structuredContent
    return (sc["result"] if set(sc) == {"result"} else sc) if sc is not None else json.loads(res.content[0].text)


def items(result, key):
    return result if isinstance(result, list) else result.get(key, [])


async def session(steps):
    async with stdio_client(mcp_parameters_for(env)) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()

            async def call(n, **a):
                return data(await s.call_tool(n, a))
            return await steps(call)


async def phase1(call):
    conf = await call("ha_read_config_file", path="configuration.yaml")
    if "packages:" not in conf["content"]:
        e = await call("ha_edit_config_file", path="configuration.yaml", old_text="default_config:\n",
                       new_text="default_config:\n\nhomeassistant:\n  packages: !include_dir_named packages\n")
        print("include packages:", e.get("ERROR") or e["config_check"])
    w = await call("ha_write_config_file", path="packages/doc_demo.yaml", content=package())
    print("package:", w.get("ERROR") or w["config_check"])
    if "ERROR" in w:
        return False
    print("restart:", await call("ha_restart"))
    return True


def expected_unique_ids() -> dict[str, tuple[str, str, str | None]]:
    """unique_id -> (name, room, icon) for everything that should get a room."""
    out = {}
    for key, (domain, name, room, icon) in DEVICES.items():
        out[f"demo_light_{key}" if key in LEGACY else f"demo_{domain}_{key}"] = (name, room, icon)
    for key, room in WINDOWS.items():
        out[f"demo_window_{key}"] = (f"Fenster {room}", room, None)
    for key in WATTS:
        out[f"demo_power_{key}"] = (f"{DEVICES[key][1]} Leistung", DEVICES[key][2], None)
    for room in TEMPERATURES:
        out[f"demo_temp_{slug(room)}"] = (f"Temperatur {room}", room, None)
    out["demo_power_total"] = ("Hausverbrauch", "Technikraum", "mdi:home-lightning-bolt")
    return out


async def phase2(call):
    # floors and rooms
    have = {f["name"]: f["floor_id"] for f in items(await call("ha_list_floors"), "floors")}
    for name, level, icon in FLOORS:
        if name not in have:
            print("floor", name, (await call("ha_create_floor", name=name, level=level, icon=icon)).get("ERROR", "ok"))
    floors = {f["name"]: f["floor_id"] for f in items(await call("ha_list_floors"), "floors")}
    areas = {a["name"]: a["area_id"] for a in items(await call("ha_list_areas"), "areas")}
    for name, (floor, icon) in ROOMS.items():
        if name in areas:
            r = await call("ha_update_area", area_id=areas[name], changes={"floor_id": floors[floor], "icon": icon})
        else:
            r = await call("ha_create_area", name=name, floor_id=floors[floor], icon=icon)
        print("room", name, r.get("ERROR", "ok") if isinstance(r, dict) else r)
    areas = {a["name"]: a["area_id"] for a in items(await call("ha_list_areas"), "areas")}
    # entities by unique_id (entity IDs come from the names; umlauts are folded by Home Assistant)
    registry = {e.get("unique_id"): e["entity_id"] for e in items(await call("ha_list_entity_registry"), "entities")
                if e.get("platform") == "template"}
    ids: dict[str, str] = {}
    missing = []
    for uid, (name, room, icon) in expected_unique_ids().items():
        entity_id = registry.get(uid)
        if not entity_id:
            missing.append(uid)
            continue
        ids[uid] = entity_id
        changes = {"area_id": areas[room]}
        if icon:
            changes["icon"] = icon
        r = await call("ha_update_entity_registry", entity_id=entity_id, changes=changes)
        if isinstance(r, dict) and r.get("ERROR"):
            print("area", entity_id, r["ERROR"])
    print(f"entities placed in rooms: {len(ids)}, missing: {missing or 'none'}")

    def eid(key: str) -> str:
        domain = DEVICES[key][0]
        return ids[f"demo_light_{key}" if key in LEGACY else f"demo_{domain}_{key}"]

    covers_eg = [eid(k) for k, d in DEVICES.items() if d[0] == "cover" and ROOMS[d[2]][0] == "Erdgeschoss"]
    windows = [ids[f"demo_window_{k}"] for k in WINDOWS]
    automations = {
        "demo_abendlicht": {
            "alias": "Abendlicht", "description": "Schaltet bei Sonnenuntergang die Stehlampe ein.",
            "triggers": [{"trigger": "sun", "event": "sunset"}],
            "conditions": [{"condition": "state", "entity_id": ib("stehlampe"), "state": "off"}],
            "actions": [{"action": "light.turn_on", "target": {"entity_id": eid("stehlampe")}}], "mode": "single"},
        "demo_rolllaeden_abends": {
            "alias": "Rollläden bei Sonnenuntergang",
            "description": "Schließt 15 Minuten nach Sonnenuntergang alle Rollläden im Erdgeschoss.",
            "triggers": [{"trigger": "sun", "event": "sunset", "offset": "00:15:00"}],
            "actions": [{"action": "cover.close_cover", "target": {"entity_id": covers_eg}}], "mode": "single"},
        "demo_haustuer_22_uhr": {
            "alias": "Haustür um 22 Uhr abschließen", "description": "Schließt die Haustür abends ab, falls offen.",
            "triggers": [{"trigger": "time", "at": "22:00:00"}],
            "conditions": [{"condition": "state", "entity_id": eid("haustuer"), "state": "unlocked"}],
            "actions": [{"action": "lock.lock", "target": {"entity_id": eid("haustuer")}}], "mode": "single"},
        "demo_fenster_offen": {
            "alias": "Fenster offen (Hinweis)",
            "description": "Meldet ein Fenster, das länger als 15 Minuten offen ist.",
            "triggers": [{"trigger": "state", "entity_id": windows, "to": "on", "for": "00:15:00"}],
            "actions": [{"action": "persistent_notification.create",
                         "data": {"title": "Fenster offen",
                                  "message": "{{ trigger.to_state.name }} ist seit 15 Minuten offen."}}],
            "mode": "parallel"},
    }
    for config_id, config in automations.items():
        print("automation", config["alias"], (await call("ha_save_automation", config_id=config_id,
                                                         config=config)).get("ERROR", "ok"))
    scene = {"name": "Filmabend", "icon": "mdi:movie-open",
             "entities": {eid("stehlampe"): {"state": "on"}, eid("deckenlicht"): {"state": "off"},
                          eid("fernseher"): {"state": "on"}, eid("rollladen_wohnzimmer"): {"state": "closed"}}}
    print("scene Filmabend", (await call("ha_save_scene", scene_id="demo_filmabend", config=scene)).get("ERROR", "ok"))
    off = [eid(k) for k, d in DEVICES.items() if d[0] in ("light", "switch") and k != "netzwerk"]
    script = {"alias": "Alles aus", "icon": "mdi:power",
              "description": "Schaltet alle Lampen und Geräte aus, nur der Netzwerkschrank bleibt an.",
              "sequence": [{"action": "homeassistant.turn_off", "target": {"entity_id": off}}], "mode": "single"}
    print("script Alles aus", (await call("ha_save_script", script_id="alles_aus", config=script)).get("ERROR", "ok"))
    await asyncio.sleep(3)
    # the first demo home's check: the automation turns the Stehlampe on, then off again
    print("trigger Abendlicht:", (await call("ha_call_service", domain="automation", service="trigger",
                                             entity_id="automation.abendlicht")).get("ERROR", "ok"))
    for _ in range(10):   # the automation runs on its own; give it up to 10 s
        await asyncio.sleep(1)
        lamp = (await call("ha_get_state", entity_id=eid("stehlampe"))).get("state")
        if lamp == "on":
            break
    print("Stehlampe after the automation:", lamp)
    print("turn off again:", (await call("ha_call_service", domain="light", service="turn_off",
                                         entity_id=eid("stehlampe"))).get("ERROR", "ok"))
    # demo states for the example prompts
    for key in ("fernseher", "waschmaschine", "netzwerk", "fenster_bad", "rollladen_wohnzimmer",
                "rollladen_kueche", "esstisch", "terrasse", "buero", "werkstatt", "waschkueche"):
        await call("ha_call_service", domain="input_boolean", service="turn_on", entity_id=ib(key))
    await asyncio.sleep(2)
    total = await call("ha_get_state", entity_id=ids["demo_power_total"])
    print("Hausverbrauch:", total.get("state"), (total.get("attributes") or {}).get("unit_of_measurement"))
    print("\nTry in the chat (with 'Allow actions' ticked for the switching ones):")
    for p in EXAMPLE_PROMPTS:
        print("  -", p)


if asyncio.run(session(phase1)):
    for _ in range(40):
        time.sleep(3)
        try:
            asyncio.run(session(lambda call: call("ha_get_state", entity_id="light.stehlampe")))
            break
        except Exception:  # HA still restarting
            pass
    time.sleep(5)
    asyncio.run(session(phase2))
