"""Put the walls build of the Diorama card on the DEV Home Assistant (HESTIA).

Copies dist/card.js over the HACS copy in the dev config (original kept once in
~/.cache/hestia/diorama-orig/), writes the .gz next to it, and points the dashboard
resource at a new ?hestia=<hash> URL: HA serves /hacsfiles/ with max-age 31 days and
Cloudflare keys its cache on the query, so every build needs its own URL.

    cd ha-safe-mcp && PYTHONPATH=<dir with your MCP helper> \
        ../.venv/bin/python ../ha-diorama/hestia/deploy_dev.py [--restore]
Never for prod.
"""
import asyncio
import hashlib
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "..", "dist", "card.js")
TARGET = "/var/lib/docker/volumes/ha-mcp-dev-config/_data/www/community/ha-diorama"
ORIG = os.path.expanduser("~/.cache/hestia/diorama-orig")
PREFIX = "/hacsfiles/ha-diorama/card.js"


def sh(*cmd):
    subprocess.run(cmd, check=True)


async def main(restore: bool) -> None:
    from dev_mcp import call
    os.makedirs(ORIG, exist_ok=True)
    if not os.path.exists(os.path.join(ORIG, "card.js")):
        sh("sudo", "cp", "-p", f"{TARGET}/card.js", f"{TARGET}/card.js.gz", ORIG)
        sh("sudo", "chown", f"{os.getuid()}:{os.getgid()}", f"{ORIG}/card.js", f"{ORIG}/card.js.gz")
    source = os.path.join(ORIG, "card.js") if restore else DIST
    digest = hashlib.sha256(open(source, "rb").read()).hexdigest()[:10]
    sh("sudo", "cp", source, f"{TARGET}/card.js")
    sh("sudo", "sh", "-c", f"gzip -9 -c {TARGET}/card.js > {TARGET}/card.js.gz")
    resources = await call("ha_list_dashboard_resources")
    items = resources if isinstance(resources, list) else resources.get("resources", [])
    for item in items:
        if str(item.get("url", "")).startswith(PREFIX):
            await call("ha_delete_dashboard_resource", resource_id=str(item["id"]))
    url = f"{PREFIX}?hacstag=13768699041829" + ("" if restore else f"&hestia={digest}")
    r = await call("ha_add_dashboard_resource", url=url, res_type="module")
    print("deployed", "original" if restore else "walls build", digest, url, r.get("change_id") if isinstance(r, dict) else r)


if __name__ == "__main__":
    asyncio.run(main("--restore" in sys.argv))
