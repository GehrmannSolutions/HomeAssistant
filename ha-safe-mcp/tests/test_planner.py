"""Calendars and to-do lists: read freely; add/change at control level (domain allowed); delete at delete level."""
import json

import httpx
import pytest
import respx

from ha_safe_mcp.planner import HAPlanner
from ha_safe_mcp.server import HAClient

URL = "http://ha:8123"


class FakeWS:
    def __init__(self):
        self.calls = []
        self.items = [{"uid": "1", "summary": "Milch", "status": "needs_action"},
                      {"uid": "2", "summary": "Brot", "status": "completed"}]

    async def command(self, kind, payload=None, **_):
        self.calls.append((kind, payload))
        if kind == "todo/item/list":
            return {"items": [dict(i) for i in self.items]}
        if kind in ("calendar/event/update", "calendar/event/delete"):
            return None
        raise AssertionError(kind)


def make(*, write=True, domains=("calendar", "todo"), admin=True, delete=True):
    client = HAClient(URL, "t", allow_write=write, allowed_domains=frozenset(domains))
    ws = FakeWS()
    return HAPlanner(client, ws, allow_admin_write=admin, allow_delete=delete), ws


async def test_calendars_and_events_are_read_over_rest():
    planner, _ = make(write=False)
    with respx.mock(base_url=URL) as router:
        router.get("/api/calendars").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "calendar.familie", "name": "Familie"}]))
        events = router.get("/api/calendars/calendar.familie").mock(return_value=httpx.Response(200, json=[
            {"summary": "Zahnarzt", "start": {"dateTime": "2026-10-26T10:00:00+01:00"},
             "end": {"dateTime": "2026-10-26T11:00:00+01:00"}, "uid": "abc", "description": None,
             "location": "Praxis", "recurrence_id": None, "rrule": None}]))
        assert await planner.list_calendars() == [{"entity_id": "calendar.familie", "name": "Familie"}]
        result = await planner.get_events("calendar.familie", days=3)
    assert result["events"] == [{"calendar": "calendar.familie", "summary": "Zahnarzt",
                                 "start": "2026-10-26T10:00:00+01:00", "end": "2026-10-26T11:00:00+01:00",
                                 "uid": "abc", "location": "Praxis"}]
    query = dict(events.calls[0].request.url.params)
    assert query["start"] < query["end"]


async def test_all_calendars_are_merged_and_sorted_when_no_entity_is_given():
    planner, _ = make(write=False)
    with respx.mock(base_url=URL) as router:
        router.get("/api/calendars").mock(return_value=httpx.Response(200, json=[
            {"entity_id": "calendar.a", "name": "A"}, {"entity_id": "calendar.b", "name": "B"}]))
        router.get("/api/calendars/calendar.a").mock(return_value=httpx.Response(200, json=[
            {"summary": "Spät", "start": {"date": "2026-10-28"}, "end": {"date": "2026-10-29"}, "uid": "x"}]))
        router.get("/api/calendars/calendar.b").mock(return_value=httpx.Response(200, json=[
            {"summary": "Früh", "start": {"dateTime": "2026-10-26T08:00:00+01:00"},
             "end": {"dateTime": "2026-10-26T09:00:00+01:00"}, "uid": "y"}]))
        result = await planner.get_events("", days=7)
    assert [e["summary"] for e in result["events"]] == ["Früh", "Spät"]
    assert result["events"][1]["all_day"] is True


async def test_todo_items_are_listed_and_filtered():
    planner, ws = make(write=False)
    assert [i["summary"] for i in await planner.get_todo_items("todo.einkauf")] == ["Milch"]
    assert len(await planner.get_todo_items("todo.einkauf", status="")) == 2
    assert ws.calls[0] == ("todo/item/list", {"entity_id": "todo.einkauf"})
    with pytest.raises(ValueError):
        await planner.get_todo_items("light.flur")


def known(router, *entity_ids):
    for entity_id in entity_ids:
        router.get(f"/api/states/{entity_id}").mock(return_value=httpx.Response(200, json={
            "entity_id": entity_id, "state": "0", "attributes": {}}))


async def test_writes_to_an_unknown_list_or_calendar_are_refused_instead_of_reported_as_done():
    planner, ws = make()
    with respx.mock(base_url=URL, assert_all_called=False) as router:
        router.get("/api/states/todo.gibtsnicht").mock(return_value=httpx.Response(404, json={}))
        router.get("/api/states/calendar.gibtsnicht").mock(return_value=httpx.Response(404, json={}))
        add = router.post("/api/services/todo/add_item").mock(return_value=httpx.Response(200, json=[]))
        with pytest.raises(ValueError, match="unknown todo entity"):
            await planner.add_todo_item("todo.gibtsnicht", "Eier")
        with pytest.raises(ValueError, match="unknown calendar entity"):
            await planner.delete_event("calendar.gibtsnicht", "abc")
    assert not add.called and ws.calls == []


async def test_adding_and_completing_items_use_the_todo_services():
    planner, _ = make()
    with respx.mock(base_url=URL) as router:
        known(router, "todo.einkauf")
        add = router.post("/api/services/todo/add_item").mock(return_value=httpx.Response(200, json=[]))
        update = router.post("/api/services/todo/update_item").mock(return_value=httpx.Response(200, json=[]))
        await planner.add_todo_item("todo.einkauf", "Eier", due="2026-10-27", description="10 Stück")
        await planner.update_todo_item("todo.einkauf", "Eier", status="completed")
    assert json.loads(add.calls[0].request.content) == {"entity_id": "todo.einkauf", "item": "Eier",
                                                        "due_date": "2026-10-27", "description": "10 Stück"}
    assert json.loads(update.calls[0].request.content) == {"entity_id": "todo.einkauf", "item": "Eier",
                                                           "status": "completed"}


async def test_calendar_event_create_update_and_delete():
    planner, ws = make()
    with respx.mock(base_url=URL) as router:
        known(router, "calendar.familie")
        create = router.post("/api/services/calendar/create_event").mock(return_value=httpx.Response(200, json=[]))
        await planner.create_event("calendar.familie", "Zahnarzt", "2026-10-26T10:00:00", "2026-10-26T11:00:00",
                                   location="Praxis")
        await planner.create_event("calendar.familie", "Urlaub", "2026-11-01", "2026-11-08")
        first, second = (json.loads(c.request.content) for c in create.calls)
        await planner.update_event("calendar.familie", "abc", "Zahnarzt", "2026-10-26T11:00:00+01:00",
                                   "2026-10-26T12:00:00+01:00")
        await planner.delete_event("calendar.familie", "abc")
    assert first == {"entity_id": "calendar.familie", "summary": "Zahnarzt", "start_date_time": "2026-10-26T10:00:00",
                     "end_date_time": "2026-10-26T11:00:00", "location": "Praxis"}
    assert second["start_date"] == "2026-11-01" and second["end_date"] == "2026-11-08"
    assert ws.calls[-2] == ("calendar/event/update", {"entity_id": "calendar.familie", "uid": "abc", "event": {
        "summary": "Zahnarzt", "dtstart": "2026-10-26T11:00:00+01:00", "dtend": "2026-10-26T12:00:00+01:00"}})
    assert ws.calls[-1] == ("calendar/event/delete", {"entity_id": "calendar.familie", "uid": "abc"})


async def test_gates_writes_domains_and_delete():
    read_only, _ = make(write=False)
    with pytest.raises(ValueError, match="Writes are disabled"):
        await read_only.add_todo_item("todo.einkauf", "Eier")
    no_todo, _ = make(domains=("light",))
    with pytest.raises(ValueError, match="domain todo not allowed"):
        await no_todo.add_todo_item("todo.einkauf", "Eier")
    with pytest.raises(ValueError, match="domain calendar not allowed"):
        await no_todo.update_event("calendar.familie", "abc", "x", "2026-10-26", "2026-10-27")
    no_delete, _ = make(delete=False)
    with pytest.raises(ValueError, match="delete disabled"):
        await no_delete.remove_todo_items("todo.einkauf", ["Milch"])
    with pytest.raises(ValueError, match="delete disabled"):
        await no_delete.delete_event("calendar.familie", "abc")
    planner, _ = make()
    for bad in ({"start": "morgen"}, {"start": "2026-10-26T10:00:00", "end": "2026-10-26"},
                {"start": "2026-10-27", "end": "2026-10-26"}):
        with pytest.raises(ValueError):
            await planner.create_event("calendar.familie", "x", bad["start"], bad.get("end", "2026-10-27"))


def test_tools_have_the_right_levels():
    import asyncio
    from ha_safe_mcp.ollama_client import CONTROL_TOOLS, DELETE_TOOLS, READ_TOOLS, select_tool_names
    from ha_safe_mcp.remote import tool_level
    from ha_safe_mcp.server import create_server
    names = {t.name for t in asyncio.run(create_server(HAClient(URL, "t")).list_tools())}
    read = {"ha_list_calendars", "ha_get_calendar_events", "ha_list_todo_lists", "ha_get_todo_items"}
    control = {"ha_create_calendar_event", "ha_update_calendar_event", "ha_add_todo_item", "ha_update_todo_item"}
    delete = {"ha_delete_calendar_event", "ha_remove_todo_items"}
    assert read | control | delete <= names and read <= READ_TOOLS
    assert control <= CONTROL_TOOLS and delete <= DELETE_TOOLS
    assert {tool_level(n) for n in control} == {"control"} and {tool_level(n) for n in delete} == {"delete"}
    picked = select_tool_names("Was steht morgen im Kalender?", names, allow_write=False)
    assert "ha_get_calendar_events" in picked
    assert "ha_add_todo_item" in select_tool_names("Setz Milch auf die Einkaufsliste", names, allow_write=True)


async def test_no_calendar_integration_means_no_calendars_not_an_error():
    planner, _ = make(write=False)
    with respx.mock(base_url=URL) as router:
        router.get("/api/calendars").mock(return_value=httpx.Response(404, json={}))
        assert await planner.list_calendars() == []
        assert (await planner.get_events())["events"] == []
