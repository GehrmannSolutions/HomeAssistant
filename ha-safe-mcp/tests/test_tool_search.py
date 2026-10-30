"""Tool search for small local models: the model can find tools the keyword preselection did not offer."""
import json
from types import SimpleNamespace

import httpx

from ha_safe_mcp.ollama_client import FIND_TOOLS, rank_tools, run_chat


def tool(name, description):
    return SimpleNamespace(name=name, description=description, inputSchema={"type": "object", "properties": {}})


CATALOG = [
    tool("ha_get_state", "Read the current state and attributes of one entity."),
    tool("ha_search_entities", "Search current entity IDs and friendly names."),
    tool("ha_get_history", "State history of 1-10 entities over the last hours."),
    tool("ha_get_statistics", "Long-term statistics (energy, temperatures) aggregated per period."),
    tool("ha_list_traces", "Recent runs (traces) of automations or scripts, newest first."),
    tool("ha_get_error_log", "Home Assistant's error/warning log (system log)."),
    tool("ha_list_backups", "List Home Assistant backups."),
    tool("ha_call_service", "Call an action (e.g. light.turn_on)."),
    tool("ha_delete_area", "Delete an area."),
]


class Session:
    def __init__(self):
        self.calls = []

    async def list_tools(self):
        return SimpleNamespace(tools=CATALOG)

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return SimpleNamespace(isError=False, structuredContent=None,
                               content=[SimpleNamespace(type="text", text=json.dumps({"tool": name}))])


def test_ranking_understands_german_words_and_tool_texts():
    names = [t.name for t in rank_tools("Wie war der Verlauf der Temperatur gestern", CATALOG, limit=3)]
    assert names[0] in ("ha_get_history", "ha_get_statistics") and "ha_get_history" in names
    assert rank_tools("warum ist die Automation nicht gelaufen", CATALOG, limit=1)[0].name == "ha_list_traces"
    assert rank_tools("Fehlermeldungen im Protokoll", CATALOG, limit=1)[0].name == "ha_get_error_log"
    assert rank_tools("Sicherung", CATALOG, limit=1)[0].name == "ha_list_backups"
    assert rank_tools("", CATALOG) == []


def ollama(script):
    """Replay Ollama answers; record the tool names offered in each round."""
    offered = []
    answers = iter(script)

    def respond(request):
        body = json.loads(request.content)
        offered.append({t["function"]["name"] for t in body["tools"]})
        return httpx.Response(200, json={"message": next(answers)})
    return httpx.MockTransport(respond), offered


def call(name, **arguments):
    return {"role": "assistant", "content": "", "tool_calls": [{"function": {"name": name, "arguments": arguments}}]}


async def test_the_model_finds_a_missing_tool_and_uses_it_in_the_next_round():
    transport, offered = ollama([call(FIND_TOOLS, query="Verlauf Temperatur"),
                                 call("ha_get_history", entity_ids=["sensor.t"]),
                                 {"role": "assistant", "content": "Fertig"}])
    session, events = Session(), []
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        answer = await run_chat(session, http, "m", "Wie warm war es im Bad?", on_event=events.append)
    assert answer == "Fertig"
    assert FIND_TOOLS in offered[0] and "ha_get_history" not in offered[0]
    assert "ha_get_history" in offered[1]
    assert session.calls == [("ha_get_history", {"entity_ids": ["sensor.t"]})]
    assert any(e.get("name") == FIND_TOOLS and e["type"] == "tool_result" for e in events)


async def test_tool_search_never_reveals_write_tools_in_a_read_only_chat():
    transport, offered = ollama([call(FIND_TOOLS, query="Bereich löschen schalten"),
                                 {"role": "assistant", "content": "ok"}])
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        await run_chat(Session(), http, "m", "Lösch den Bereich Flur")
    assert "ha_delete_area" not in offered[1] and "ha_call_service" not in offered[1]


async def test_a_real_read_tool_called_by_name_is_loaded_instead_of_refused():
    transport, offered = ollama([call("ha_list_backups"), {"role": "assistant", "content": "ok"}])
    session = Session()
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        await run_chat(session, http, "m", "Was gibt es Neues?")
    assert session.calls == [("ha_list_backups", {})]


async def test_unknown_tool_names_stay_refused():
    transport, offered = ollama([call("ha_format_disk"), {"role": "assistant", "content": "ok"}])
    session, events = Session(), []
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        await run_chat(session, http, "m", "x", on_event=events.append)
    assert session.calls == [] and any(e.get("ok") is False for e in events if e["type"] == "tool_result")


def test_everyday_german_words_find_the_debugging_tools():
    import asyncio
    from ha_safe_mcp.ollama_client import READ_TOOLS
    from ha_safe_mcp.server import HAClient, create_server
    tools = [t for t in asyncio.run(create_server(HAClient("http://x:8123", "t")).list_tools()) if t.name in READ_TOOLS]
    top = lambda q, n=3: [t.name for t in rank_tools(q, tools, limit=n)]  # noqa: E731
    assert {"ha_get_error_log", "ha_list_repairs"} & set(top("Gibt es Probleme, um die ich mich kümmern muss?"))
    assert "ha_get_history" in top("Wie hat sich die Sonne über den Tag entwickelt?")
    assert "ha_list_traces" in top("Ist die Automation heute früh gelaufen?")


def test_the_system_prompt_explains_when_to_search_for_tools():
    from ha_safe_mcp.ollama_client import SYSTEM
    assert FIND_TOOLS in SYSTEM


async def test_entity_search_understands_german_domain_names():
    from ha_safe_mcp.server import HAClient

    class Client(HAClient):
        async def _request(self, method, path, **kwargs):
            return [{"entity_id": "sun.sun", "state": "below_horizon", "attributes": {"friendly_name": "Sun"}},
                    {"entity_id": "light.flur", "state": "on", "attributes": {"friendly_name": "Flur"}}]
    found = await Client("http://x:8123", "t").search_entities("Sonne")
    assert [e["entity_id"] for e in found] == ["sun.sun"]


async def test_entity_search_finds_sensors_by_their_kind_in_english_and_german():
    """English questions about German-named sensors: 'power' finds 'Fernseher Leistung' by its device class."""
    from ha_safe_mcp.server import HAClient

    class Client(HAClient):
        async def _request(self, method, path, **kwargs):
            return [{"entity_id": "sensor.fernseher_leistung", "state": "95",
                     "attributes": {"friendly_name": "Fernseher Leistung", "device_class": "power"}},
                    {"entity_id": "binary_sensor.fenster_bad", "state": "on",
                     "attributes": {"friendly_name": "Fenster Bad", "device_class": "window"}},
                    {"entity_id": "sensor.temperatur_bad", "state": "23",
                     "attributes": {"friendly_name": "Temperatur Bad", "device_class": "temperature"}},
                    {"entity_id": "light.flur", "state": "on", "attributes": {"friendly_name": "Flur"}}]
    client = Client("http://x:8123", "t")

    async def ids(query):
        return [e["entity_id"] for e in await client.search_entities(query)]
    assert await ids("power") == ["sensor.fernseher_leistung"]
    assert await ids("Stromverbrauch") == ["sensor.fernseher_leistung"]
    assert await ids("windows") == ["binary_sensor.fenster_bad"]
    assert await ids("Fenster") == ["binary_sensor.fenster_bad"]
    assert await ids("temperature") == ["sensor.temperatur_bad"]
    assert await ids("Flur") == ["light.flur"]


async def test_find_tools_accepts_other_argument_names_and_falls_back_to_the_question():
    transport, offered = ollama([call(FIND_TOOLS, keywords="Verlauf"), call(FIND_TOOLS),
                                 {"role": "assistant", "content": "ok"}])
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        await run_chat(Session(), http, "m", "Wie war die Temperatur gestern?")
    assert "ha_get_history" in offered[1]


async def test_a_dangling_tool_tag_is_removed_from_the_answer():
    transport, _ = ollama([{"role": "assistant", "content": "Alles ruhig.<tool_call>"}])
    async with httpx.AsyncClient(transport=transport, base_url="http://ollama") as http:
        assert await run_chat(Session(), http, "m", "x") == "Alles ruhig."
