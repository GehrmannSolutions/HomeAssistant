"""Put the walls build of the Diorama card on a TEST Home Assistant that has the card installed from HACS or from
the Marketplace that replaced HACS in Home Assistant 2026.11.

Copies dist/card.js over the store's copy in that instance's config folder (the original is kept once in
--orig-dir), writes the .gz next to it, and points the dashboard resource at a new ?hestia=<hash> URL through
ha-safe-mcp: Home Assistant serves the card with a 31-day cache and proxies such as Cloudflare key their cache on the
query, so every build needs its own URL. HACS serves it under /hacsfiles/ha-diorama/, the Marketplace under
/local/community/ha-diorama/ (it migrated the old resource there); the existing resource decides which one is used.
--restore puts the original copy back.

    pnpm build
    cd ../ha-safe-mcp && .venv/bin/python ../ha-diorama/hestia/deploy_dev.py --env-file /path/to/test.env \\
        --config-dir /path/to/test/config [--orig-dir ~/.cache/hestia/diorama-orig] [--restore]

The env file holds HA_URL and HA_TOKEN of the TEST instance; admin write and delete are switched on for this run
only (resource swap). When the config folder belongs to a container, the copy runs through sudo.
Never for production: a HACS update overwrites the copy anyway.
"""
import argparse
import asyncio
import hashlib
import json
import os
import subprocess

from dotenv import dotenv_values
from mcp import ClientSession
from mcp.client.stdio import stdio_client

from ha_safe_mcp.ollama_client import HA_ENV_KEYS, mcp_parameters_for

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "..", "dist", "card.js")
PREFIXES = {"hacs": "/hacsfiles/ha-diorama/card.js", "marketplace": "/local/community/ha-diorama/card.js"}
HACS_TAG = "13768699041829"  # what HACS (?hacstag=) and the Marketplace (?v=) append to the upstream resource URL


def resource_url(store: str, digest: str | None) -> str:
    """The resource URL for one store; digest None = the store's own URL (restore)."""
    tag = f"?v={HACS_TAG}" if store == "marketplace" else f"?hacstag={HACS_TAG}"
    return PREFIXES[store] + tag + (f"&hestia={digest}" if digest else "")


def copy(target: str, *cmd: str) -> None:
    """Run a copy command, through sudo when the target folder is not writable (container volume)."""
    prefix = [] if os.access(target, os.W_OK) else ["sudo"]
    subprocess.run(prefix + list(cmd), check=True)


def data(res):
    if res.isError:
        raise RuntimeError(res.content[0].text[:400])
    sc = res.structuredContent
    return (sc["result"] if set(sc) == {"result"} else sc) if sc is not None else json.loads(res.content[0].text)


async def main(args) -> None:
    env = {k: v for k, v in dotenv_values(args.env_file).items() if k in HA_ENV_KEYS and v}
    env.update(HA_AUDIT="false", HA_ALLOW_WRITE="true", HA_ALLOW_ADMIN_WRITE="true", HA_ALLOW_DELETE="true")
    if os.environ.get("HA_CHANGES_DIR"):
        env["HA_CHANGES_DIR"] = os.environ["HA_CHANGES_DIR"]
    target = os.path.join(args.config_dir, "www", "community", "ha-diorama")
    orig = os.path.expanduser(args.orig_dir)
    os.makedirs(orig, exist_ok=True)
    if not os.path.exists(os.path.join(orig, "card.js")):
        copy(target, "cp", "-p", f"{target}/card.js", f"{target}/card.js.gz", orig)
        copy(orig, "chown", f"{os.getuid()}:{os.getgid()}", f"{orig}/card.js", f"{orig}/card.js.gz")
    source = os.path.join(orig, "card.js") if args.restore else DIST
    digest = hashlib.sha256(open(source, "rb").read()).hexdigest()[:10]
    copy(target, "cp", source, f"{target}/card.js")
    copy(target, "sh", "-c", f"gzip -9 -c {target}/card.js > {target}/card.js.gz")
    async with stdio_client(mcp_parameters_for(env)) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            resources = data(await s.call_tool("ha_list_dashboard_resources", {}))
            items = resources if isinstance(resources, list) else resources.get("resources", [])
            ours = [i for i in items if any(str(i.get("url", "")).startswith(p) for p in PREFIXES.values())]
            store = "marketplace" if any(str(i.get("url", "")).startswith(PREFIXES["marketplace"]) for i in ours) \
                else "hacs"
            for item in ours:
                data(await s.call_tool("ha_delete_dashboard_resource", {"resource_id": str(item["id"])}))
            url = resource_url(store, None if args.restore else digest)
            res = data(await s.call_tool("ha_add_dashboard_resource", {"url": url, "res_type": "module"}))
    print("deployed", "original" if args.restore else "walls build", digest, url,
          res.get("change_id") if isinstance(res, dict) else res)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    p.add_argument("--env-file", required=True, help="HA_URL and HA_TOKEN of the TEST instance")
    p.add_argument("--config-dir", required=True, help="that instance's config folder (www/community/ha-diorama inside)")
    p.add_argument("--orig-dir", default="~/.cache/hestia/diorama-orig", help="where the original HACS copy is kept")
    p.add_argument("--restore", action="store_true", help="put the original HACS copy back")
    asyncio.run(main(p.parse_args()))
