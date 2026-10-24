"""End-to-end MCP stdio smoke test against the Docker HA test double."""
import asyncio
import json
import os
import shlex

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client


async def main():
    docker = shlex.split(os.getenv("DOCKER_COMMAND", "docker"))
    if not docker:
        raise ValueError("DOCKER_COMMAND must name a Docker CLI")
    params = StdioServerParameters(
        command=docker[0], args=[*docker[1:], "run", "--rm", "-i", "--network", "host",
                              "-e", "HA_URL=http://127.0.0.1:18123", "-e", "HA_TOKEN=test-token",
                              "-e", f"HA_ALLOW_WRITE={os.getenv('TEST_ALLOW_WRITE', 'false')}", "ha-safe-mcp:local"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            assert {"ha_search_entities", "ha_get_state", "ha_list_services", "ha_call_service"} <= names
            found = await session.call_tool("ha_search_entities", {"query": "desk"})
            assert not found.isError and json.loads(found.content[0].text)["entity_id"] == "light.desk", found
            state = await session.call_tool("ha_get_state", {"entity_id": "light.desk"})
            assert not state.isError and json.loads(state.content[0].text)["state"] == "off", state
            services = await session.call_tool("ha_list_services")
            assert not services.isError and json.loads(services.content[0].text)["domain"] == "light", services
            catalog = await session.call_tool("ha_rest_catalog")
            assert not catalog.isError and any('"/api/config"' in block.text for block in catalog.content), catalog
            config = await session.call_tool("ha_rest_query", {"path": "/api/config"})
            assert not config.isError and json.loads(config.content[0].text)["data"]["version"] == "test-double", config
            denied = await session.call_tool("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.desk"})
            if os.getenv("TEST_ALLOW_WRITE") == "true":
                assert not denied.isError and json.loads(denied.content[0].text)["state"] == "on", denied
                print("MCP initialize/list_tools/search/get_state/list_services/write-allowed: PASS")
            else:
                assert denied.isError and "disabled" in denied.content[0].text, denied
                print("MCP initialize/list_tools/search/get_state/list_services/write-denied: PASS")


if __name__ == "__main__":
    asyncio.run(main())
