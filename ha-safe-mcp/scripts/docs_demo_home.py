"""Demo home for the documentation screenshots, built through ha-safe-mcp itself. TEST INSTANCES ONLY.

Writes packages/doc_demo.yaml (three template lights backed by input_booleans), enables packages in
configuration.yaml, restarts Home Assistant, puts the lights into the rooms Wohnzimmer/Küche and creates the
automation "Abendlicht". Every change is journaled and can be undone.

    HA_CONFIG_DIR=/path/to/test/config python scripts/docs_demo_home.py --env-file /path/to/test.env
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
           HA_ALLOWED_DOMAINS="light,switch,input_boolean,automation,homeassistant",
           HA_CONFIG_DIR=os.environ["HA_CONFIG_DIR"])

LIGHTS = [("Stehlampe", "stehlampe", "wohnzimmer"), ("Deckenlicht", "deckenlicht", "wohnzimmer"),
          ("Arbeitslicht", "arbeitslicht", "kuche")]


def package() -> str:
    lines = ["# Demo home for the ha-safe-mcp documentation (dev only)", "input_boolean:"]
    for name, key, _ in LIGHTS:
        lines += [f"  demo_{key}:", f"    name: {name} Schalter"]
    lines += ["template:", "  - light:"]
    for name, key, _ in LIGHTS:
        lines += [f"      - name: {name}", f"        unique_id: demo_light_{key}",
                  f"        state: \"{{{{ is_state('input_boolean.demo_{key}', 'on') }}}}\"",
                  "        turn_on:", "          - action: input_boolean.turn_on",
                  f"            target:", f"              entity_id: input_boolean.demo_{key}",
                  "        turn_off:", "          - action: input_boolean.turn_off",
                  f"            target:", f"              entity_id: input_boolean.demo_{key}"]
    return "\n".join(lines) + "\n"


def data(res):
    if res.isError:
        return {"ERROR": res.content[0].text[:400]}
    sc = res.structuredContent
    return (sc["result"] if set(sc) == {"result"} else sc) if sc is not None else json.loads(res.content[0].text)


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


async def phase2(call):
    areas = {a["name"]: a["area_id"] for a in await call("ha_list_areas")}
    print("areas:", areas)
    for name, key, area in LIGHTS:
        area_id = areas.get("Wohnzimmer") if area == "wohnzimmer" else areas.get("Küche")
        entity = f"light.{name.lower()}"
        print("area", entity, (await call("ha_update_entity_registry", entity_id=entity,
                                         changes={"area_id": area_id})).get("ERROR", "ok"))
    auto = {"alias": "Abendlicht", "description": "Schaltet bei Sonnenuntergang die Stehlampe ein.",
            "triggers": [{"trigger": "sun", "event": "sunset"}],
            "conditions": [{"condition": "state", "entity_id": "input_boolean.demo_stehlampe", "state": "off"}],
            "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.stehlampe"}}], "mode": "single"}
    print("automation:", (await call("ha_save_automation", config_id="demo_abendlicht", config=auto)).get("ERROR", "ok"))
    await asyncio.sleep(3)
    print("trigger:", (await call("ha_call_service", domain="automation", service="trigger",
                                  entity_id="automation.abendlicht")).get("ERROR", "ok"))
    await asyncio.sleep(2)
    print("lights:", [(s, (await call("ha_get_state", entity_id=s)).get("state")) for s in
                      ("light.stehlampe", "light.deckenlicht", "light.arbeitslicht")])
    print("turn off again:", (await call("ha_call_service", domain="light", service="turn_off",
                                         entity_id="light.stehlampe")).get("ERROR", "ok"))


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
