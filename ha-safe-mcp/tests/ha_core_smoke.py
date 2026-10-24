"""Opt-in integration test against a disposable, un-onboarded HA Core container.

Never point HA_CORE_TEST_URL at a real instance: this script creates an admin.
"""
import asyncio
import json
import os
import secrets
from pathlib import Path

import httpx
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from ha_safe_mcp.management import HAAdmin
from ha_safe_mcp.server import HAClient


async def main():
    url = os.environ.get("HA_CORE_TEST_URL", "http://127.0.0.1:18124")
    client_id = url + "/"
    async with httpx.AsyncClient(base_url=url, timeout=60, trust_env=False) as http:
        status = (await http.get("/api/onboarding")).json()
        if next(item for item in status if item["step"] == "user")["done"]:
            raise RuntimeError("Refusing to run: target has already been onboarded")
        response = await http.post("/api/onboarding/users", json={"name": "MCP Test", "username": "mcp_test",
                                     "password": secrets.token_urlsafe(24), "client_id": client_id, "language": "en"})
        response.raise_for_status()
        code = response.json()["auth_code"]
        token_response = await http.post("/auth/token", data={"client_id": client_id,
                                              "grant_type": "authorization_code", "code": code})
        token_response.raise_for_status()
        token = token_response.json()["access_token"]
    admin = HAAdmin(HAClient(url, token, allow_write=True), allow_admin_write=True, allow_delete=True)
    print("HA Core API:", (await admin.client._request("GET", "/api/"))["message"])
    print("Dashboard list:", type(await admin.dashboard_list()).__name__)
    helper = await admin.helper_create("input_boolean", {"name": "MCP Guest mode"})
    print("Persistent helper ID:", helper["id"])
    automation = {"alias": "MCP Test Automation", "triggers": [{"trigger": "state", "entity_id": "input_boolean." + helper["id"], "to": "on"}],
                  "actions": [{"action": "input_boolean.turn_off", "target": {"entity_id": "input_boolean." + helper["id"]}}]}
    validated = await admin.automation_validate(automation)
    print("Automation validation:", validated)
    saved = await admin.automation_save("mcp_test_automation", automation)
    print("Automation read-back:", saved["id"], saved["alias"])
    dashboard = await admin.dashboard_create("MCP Test Dashboard", "mcp-test-dashboard")
    print("Dashboard created:", dashboard)
    saved_dash = await admin.dashboard_save({"views": [{"title": "Overview", "cards": [{"type": "entities", "entities": ["input_boolean." + helper["id"]]}]}]}, url_path="mcp-test-dashboard")
    print("Dashboard read-back views:", len(saved_dash["config"]["views"]))
    project = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(command=str(project / ".venv/bin/ha-safe-mcp"), cwd=str(project),
                                   env={"HA_URL": url, "HA_TOKEN": token, "HA_ALLOW_WRITE": "true",
                                        "HA_ALLOW_ADMIN_WRITE": "true"})
    async with stdio_client(params) as (reader, writer):
        async with ClientSession(reader, writer) as mcp:
            await mcp.initialize()
            read = await mcp.call_tool("ha_get_automation", {"config_id": "mcp_test_automation"})
            assert not read.isError and json.loads(read.content[0].text)["id"] == "mcp_test_automation", read
            create = await mcp.call_tool("ha_create_helper", {"domain": "input_text", "config": {"name": "MCP Note"}})
            assert not create.isError and json.loads(create.content[0].text)["id"] == "mcp_note", create
            dashboards = await mcp.call_tool("ha_list_dashboards")
            assert not dashboards.isError and any("mcp-test-dashboard" in block.text for block in dashboards.content), dashboards
            print("MCP stdio read/write/dashboard against real HA Core: PASS")
    updated_helper = await admin.helper_update("input_boolean", helper["id"], {"name": "MCP Visitors"})
    assert updated_helper["name"] == "MCP Visitors"
    updated_dash = await admin.dashboard_update(dashboard["id"], {"title": "MCP New Dashboard"})
    assert updated_dash["title"] == "MCP New Dashboard"
    await admin.helper_delete("input_boolean", helper["id"])
    await admin.dashboard_delete(dashboard["id"])
    await admin.automation_delete("mcp_test_automation")
    print("Helper/dashboard/automation update and delete: PASS")


if __name__ == "__main__":
    asyncio.run(main())
