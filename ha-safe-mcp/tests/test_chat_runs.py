"""Chat runs for the web UI: ordered events, single-use approvals, cancellation, safe errors."""
import asyncio

import httpx
import pytest

from ha_safe_mcp.chat_runs import RunBusy, RunManager, friendly_error
from ha_safe_mcp.config_store import Settings

# these tests check the German messages (the UI language German); English is covered in test_i18n.py
pytestmark = pytest.mark.usefixtures("german")

SETTINGS = Settings(ha_token="t" * 30)


async def wait_until(predicate, timeout=2.0):
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


def kinds(run):
    return [event["type"] for event in run.events]


async def test_successful_run_records_progress_answer_and_done():
    async def runner(settings, prompt, history, allow_write, approve, on_event):
        assert (prompt, history, allow_write) == ("Hallo", [], False)
        await on_event({"type": "thinking", "round": 1})
        return "Hi!"

    run = RunManager(runner).start(SETTINGS, "Hallo", [], allow_write=False)
    await run.task
    assert kinds(run) == ["thinking", "answer", "done"]
    assert run.events[1]["content"] == "Hi!"
    assert run.events[-1]["status"] == "ok"
    assert [event["seq"] for event in run.events] == [1, 2, 3]


async def test_only_one_run_at_a_time():
    release = asyncio.Event()

    async def runner(*_):
        await release.wait()
        return "ok"

    manager = RunManager(runner)
    first = manager.start(SETTINGS, "a", [], allow_write=False)
    with pytest.raises(RunBusy):
        manager.start(SETTINGS, "b", [], allow_write=False)
    release.set()
    await first.task
    await manager.start(SETTINGS, "c", [], allow_write=False).task


async def test_write_waits_for_single_use_user_approval():
    async def runner(settings, prompt, history, allow_write, approve, on_event):
        decision = await approve("ha_call_service", {"domain": "light", "service": "turn_on", "entity_id": "light.desk"})
        return f"freigegeben={decision}"

    manager = RunManager(runner)
    run = manager.start(SETTINGS, "an", [], allow_write=True)
    await wait_until(lambda: "approval_required" in kinds(run))
    request = next(event for event in run.events if event["type"] == "approval_required")
    assert request["name"] == "ha_call_service" and request["arguments"]["entity_id"] == "light.desk"
    assert manager.resolve(run.id, request["approval_id"], True) is True
    assert manager.resolve(run.id, request["approval_id"], True) is False
    await run.task
    resolved = next(event for event in run.events if event["type"] == "approval_resolved")
    assert (resolved["approved"], resolved["reason"]) == (True, "user")
    assert next(event for event in run.events if event["type"] == "answer")["content"] == "freigegeben=True"


async def test_unanswered_approval_times_out_as_rejection():
    decisions = []

    async def runner(settings, prompt, history, allow_write, approve, on_event):
        decisions.append(await approve("ha_call_service", {}))
        raise PermissionError("Write requires explicit confirmation")

    run = RunManager(runner, approval_timeout=0.05).start(SETTINGS, "an", [], allow_write=True)
    await run.task
    assert decisions == [False]
    assert next(event for event in run.events if event["type"] == "approval_resolved")["reason"] == "timeout"
    assert "nicht ausgeführt" in next(event for event in run.events if event["type"] == "error")["message"]
    assert run.events[-1]["status"] == "error"


async def test_cancel_stops_the_run_and_rejects_pending_approval():
    progressed = []

    async def runner(settings, prompt, history, allow_write, approve, on_event):
        await approve("ha_call_service", {})
        progressed.append("past approval")
        await asyncio.sleep(30)

    manager = RunManager(runner)
    run = manager.start(SETTINGS, "an", [], allow_write=True)
    await wait_until(lambda: "approval_required" in kinds(run))
    assert manager.cancel(run.id) is True
    await asyncio.wait_for(asyncio.shield(run.task), 0.5)
    assert progressed == []
    assert run.events[-1] == {**run.events[-1], "type": "done", "status": "cancelled"}
    assert manager.cancel(run.id) is False
    assert manager.active is None


async def test_wait_events_long_polls_until_something_new_happens():
    gate = asyncio.Event()

    async def runner(settings, prompt, history, allow_write, approve, on_event):
        await gate.wait()
        await on_event({"type": "thinking", "round": 1})
        return "x"

    run = RunManager(runner).start(SETTINGS, "q", [], allow_write=False)
    waiter = asyncio.create_task(run.wait_events(after=0, timeout=2))
    await asyncio.sleep(0.05)
    assert not waiter.done()
    gate.set()
    assert (await waiter)[0]["type"] == "thinking"
    await run.task
    assert await run.wait_events(after=run.events[-1]["seq"], timeout=5) == []


async def test_unknown_runs_and_approvals_are_refused():
    manager = RunManager(lambda *_: None)
    assert manager.get("nope") is None
    assert manager.resolve("nope", "nope", True) is False
    assert manager.cancel("nope") is False


async def test_cancel_before_the_task_ever_ran_still_finishes_the_run():
    started = []

    async def runner(*_):
        started.append(True)
        return "never"

    manager = RunManager(runner)
    run = manager.start(SETTINGS, "q", [], allow_write=False)
    assert manager.cancel(run.id) is True  # no await in between: the task has not started yet
    with pytest.raises(asyncio.CancelledError):
        await run.task
    await asyncio.sleep(0)
    assert started == []
    assert run.finished and run.events[-1]["type"] == "done" and run.events[-1]["status"] == "cancelled"
    assert manager.active is None
    await manager.start(SETTINGS, "next", [], allow_write=False).task


@pytest.mark.parametrize("error, expected", [
    (PermissionError("Write requires explicit confirmation"), "Aktion wurde nicht ausgeführt"),
    (httpx.ConnectError("refused"), "Ollama"),
    (httpx.HTTPStatusError("x", request=httpx.Request("POST", "http://o/api/chat"), response=httpx.Response(404)),
     "HTTP 404"),
    (RuntimeError("Tool iteration limit reached; no verified final answer"), "keine verifizierte Antwort"),
    (BaseExceptionGroup("tasks", [PermissionError("Write requires explicit confirmation")]), "nicht ausgeführt"),
    (ValueError("token=abc123secret"), "Unerwarteter Fehler"),
])
def test_friendly_errors_are_german_and_leak_nothing(error, expected):
    message = friendly_error(error)
    assert expected in message
    assert "abc123secret" not in message
