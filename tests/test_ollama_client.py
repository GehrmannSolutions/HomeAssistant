"""Tests for the local Ollama to MCP adapter."""
import json
from types import SimpleNamespace

import httpx
import pytest

from ha_safe_mcp.ollama_client import run_chat, mcp_parameters


def test_mcp_child_inherits_ha_settings_but_not_github_pat(monkeypatch):
    monkeypatch.setenv("HA_TOKEN", "test-token")
    monkeypatch.setenv("HA_URL", "http://localhost:8123")
    monkeypatch.setenv("GITHUB_TOKEN", "never-forward-me")
    params = mcp_parameters()
    assert params.env["HA_TOKEN"] == "test-token"
    assert params.env["HA_URL"] == "http://localhost:8123"
    assert "GITHUB_TOKEN" not in params.env


class FakeSession:
    def __init__(self):
        self.calls = []

    async def list_tools(self):
        return SimpleNamespace(tools=[
            SimpleNamespace(name="ha_get_state", description="Read state", inputSchema={"type": "object", "properties": {"entity_id": {"type": "string"}}, "required": ["entity_id"]}),
            SimpleNamespace(name="ha_call_service", description="Change state", inputSchema={"type": "object", "properties": {"domain": {"type": "string"}}}),
            SimpleNamespace(name="ha_rest_write", description="POST", inputSchema={"type": "object", "properties": {"path": {"type": "string"}}}),
            SimpleNamespace(name="ha_rest_delete", description="DELETE", inputSchema={"type": "object", "properties": {"path": {"type": "string"}}}),
        ])

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return SimpleNamespace(isError=False, content=[SimpleNamespace(type="text", text='{"state":"off"}')])


@pytest.mark.asyncio
async def test_read_tool_calls_travel_from_ollama_to_mcp_and_back():
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "", "tool_calls": [{"type": "function", "function": {"name": "ha_get_state", "arguments": {"entity_id": "light.desk"}}}]}})
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "Das Licht ist aus."}})

    session = FakeSession()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://ollama:11434") as http:
        answer = await run_chat(session, http, "qwen2.5-coder:7b", "Ist das Licht an?")
    assert answer == "Das Licht ist aus."
    assert session.calls == [("ha_get_state", {"entity_id": "light.desk"})]
    assert [t["function"]["name"] for t in requests[0]["tools"]] == ["ha_get_state"]
    assert requests[1]["messages"][-1] == {"role": "tool", "tool_name": "ha_get_state", "content": '{"state":"off"}'}


@pytest.mark.asyncio
async def test_small_model_json_tool_request_is_dispatched_as_mcp_call():
    responses = iter([
        {"message": {"role": "assistant", "content": '{"name":"ha_get_state","arguments":{"entity_id":"light.desk"}}'}},
        {"message": {"role": "assistant", "content": "Das Licht ist aus."}},
    ])
    session = FakeSession()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=next(responses))), base_url="http://ollama:11434") as http:
        answer = await run_chat(session, http, "small", "status")
    assert answer == "Das Licht ist aus."
    assert session.calls == [("ha_get_state", {"entity_id": "light.desk"})]


@pytest.mark.asyncio
async def test_unknown_json_tool_request_cannot_escape_allowlist():
    responses = iter([
        {"message": {"role": "assistant", "content": '{"name":"ha_call_service","arguments":{"domain":"light"}}'}},
    ])
    session = FakeSession()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=next(responses))), base_url="http://ollama:11434") as http:
        answer = await run_chat(session, http, "small", "status")
    assert "nicht freigegeben" in answer
    assert session.calls == []


@pytest.mark.asyncio
async def test_write_tool_is_not_exposed_in_read_only_mode():
    def respond(request):
        tools = {tool["function"]["name"] for tool in json.loads(request.content)["tools"]}
        assert tools == {"ha_get_state"}
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "Okay"}})
    session = FakeSession()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://ollama:11434") as http:
        await run_chat(session, http, "small", "hi")
    assert session.calls == []


@pytest.mark.asyncio
async def test_write_needs_explicit_confirmation_even_when_exposed():
    def respond(request):
        return httpx.Response(200, json={"message": {"role": "assistant", "tool_calls": [{"type": "function", "function": {"name": "ha_call_service", "arguments": {"domain": "light", "service": "turn_on", "entity_id": "light.desk"}}}]}})
    session = FakeSession()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://ollama:11434") as http:
        with pytest.raises(PermissionError, match="confirmation"):
            await run_chat(session, http, "small", "on", allow_write=True)
    assert session.calls == []
