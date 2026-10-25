"""Background chat runs for the web UI.

A run executes the Ollama/MCP tool loop in a task, records ordered events that the browser
long-polls, and turns every write tool call into a single-use approval the user must grant
in the UI. Unanswered approvals expire as rejections; cancelling a run rejects anything pending.
"""

import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable

import httpx

from .config_store import Settings
from .ollama_client import write_level
from .i18n import L

Runner = Callable[..., Awaitable[str]]
MAX_EVENTS = 500


class RunBusy(RuntimeError):
    """Another chat run is still active."""


def _flatten(error: BaseException) -> BaseException:
    while isinstance(error, BaseExceptionGroup) and error.exceptions:
        error = error.exceptions[0]
    return error


def friendly_error(error: BaseException) -> str:
    """User-facing (UI language) and free of payloads: never echo raw exception text."""
    error = _flatten(error)
    if isinstance(error, PermissionError):
        return L("Action not approved: it was not carried out.",
                 "Schreibaktion nicht freigegeben – diese Aktion wurde nicht ausgeführt.")
    if isinstance(error, httpx.HTTPStatusError):
        return L(f"The local model (Ollama) answered with HTTP {error.response.status_code}. Is the model installed?",
                 f"Das lokale Modell (Ollama) antwortete mit HTTP {error.response.status_code}. "
                 "Ist das Modell installiert?")
    if isinstance(error, httpx.RequestError):
        return L("Ollama cannot be reached. Is it running at the configured address?",
                 "Ollama ist nicht erreichbar. Läuft der Dienst unter der eingestellten Adresse?")
    if isinstance(error, RuntimeError) and str(error).startswith("Tool iteration limit"):
        return L("The model gave no verified answer after several tool rounds.",
                 "Das Modell hat nach mehreren Tool-Runden keine verifizierte Antwort geliefert.")
    if isinstance(error, RuntimeError) and str(error).startswith("Home Assistant"):
        return str(error)
    return L(f"Unexpected error ({type(error).__name__}).", f"Unerwarteter Fehler ({type(error).__name__}).")


class ChatRun:
    def __init__(self, manager: "RunManager", allow_write: bool, auto_levels: frozenset[str] = frozenset()):
        self.id = secrets.token_urlsafe(12)
        self.manager = manager
        self.allow_write = allow_write
        self.auto_levels = auto_levels
        self.events: list[dict] = []
        self.pending: dict[str, asyncio.Future] = {}
        self.finished = False
        self.cancel_requested = False
        self.task: asyncio.Task | None = None
        self._changed = asyncio.Condition()
        self._seq = 0

    async def emit(self, event: dict):
        async with self._changed:
            self._append(event)
            self._changed.notify_all()

    def _append(self, event: dict):
        self._seq += 1
        self.events.append({**event, "seq": self._seq, "ts": time.time()})
        del self.events[:-MAX_EVENTS]

    def finish_now(self, status: str):
        """Synchronous close for a task cancelled before its first step (no coroutine code ran)."""
        if self.finished:
            return
        self.reject_pending()
        self.finished = True
        self._append({"type": "done", "status": status})
        asyncio.get_running_loop().create_task(self._wake())

    async def _wake(self):
        async with self._changed:
            self._changed.notify_all()

    async def wait_events(self, after: int, timeout: float = 25.0) -> list[dict]:
        async with self._changed:
            def fresh():
                return [event for event in self.events if event["seq"] > after]
            if not fresh() and not self.finished:
                try:
                    await asyncio.wait_for(self._changed.wait_for(lambda: fresh() or self.finished), timeout)
                except TimeoutError:
                    pass
            return fresh()

    async def approve(self, name: str, arguments: dict) -> bool:
        if not self.allow_write:
            return False
        level = write_level(name)
        if level is not None and level in self.auto_levels:
            # "enabled" level: no card, but every action stays visible in the chat and the audit log
            await self.emit({"type": "auto_approved", "name": name, "arguments": arguments, "level": level})
            return True
        approval_id = secrets.token_urlsafe(9)
        future = asyncio.get_running_loop().create_future()
        self.pending[approval_id] = future
        await self.emit({"type": "approval_required", "approval_id": approval_id, "name": name,
                         "arguments": arguments, "timeout": self.manager.approval_timeout})
        reason = "user"
        try:
            decision = await asyncio.wait_for(asyncio.shield(future), self.manager.approval_timeout)
        except TimeoutError:
            decision, reason = False, "timeout"
        finally:
            self.pending.pop(approval_id, None)
        if self.cancel_requested:
            # Python 3.11's wait_for can swallow a cancellation that races a completed future.
            raise asyncio.CancelledError()
        await self.emit({"type": "approval_resolved", "approval_id": approval_id,
                         "approved": decision is True, "reason": reason})
        return decision is True

    def reject_pending(self):
        for future in self.pending.values():
            if not future.done():
                future.set_result(False)


class RunManager:
    """Owns at most one active run. The runner gets (settings, prompt, history, allow_write, approve, on_event)."""

    def __init__(self, runner: Runner, *, approval_timeout: float = 120.0, keep: int = 20):
        self.runner = runner
        self.approval_timeout = approval_timeout
        self.keep = keep
        self.runs: dict[str, ChatRun] = {}
        self.active: ChatRun | None = None
        self.on_answer: Callable[[str, str], list[dict]] | None = None

    def start(self, settings: Settings, prompt: str, history: list[dict], *, allow_write: bool) -> ChatRun:
        if self.active is not None and not self.active.finished:
            raise RunBusy(L("A request is already running", "Es läuft bereits eine Anfrage"))
        run = ChatRun(self, allow_write, frozenset(settings.auto_levels()) if allow_write else frozenset())
        self.runs[run.id] = run
        while len(self.runs) > self.keep:
            oldest = next(iter(self.runs))
            if self.runs[oldest] is run:
                break
            del self.runs[oldest]
        self.active = run
        run.task = asyncio.create_task(self._execute(run, settings, prompt, history))
        run.task.add_done_callback(lambda task, run=run: self._finalize(run, task))
        return run

    def _finalize(self, run: ChatRun, task: asyncio.Task):
        if not run.finished:
            run.finish_now("cancelled" if task.cancelled() else "error")
        if self.active is run:
            self.active = None

    async def _execute(self, run: ChatRun, settings: Settings, prompt: str, history: list[dict]):
        status = "ok"
        try:
            answer = await self.runner(settings, prompt, history, run.allow_write, run.approve, run.emit)
            await run.emit({"type": "answer", "content": answer or L("(no answer)", "(keine Antwort)")})
            if answer and self.on_answer is not None:
                try:
                    saved = self.on_answer(prompt, answer)
                except Exception:  # noqa: BLE001 - storing a copy must never fail the chat
                    await run.emit({"type": "note", "content": L("Generated files could not be saved.",
                                                                      "Erzeugte Dateien konnten nicht gespeichert werden.")})
                else:
                    if saved:
                        await run.emit({"type": "files_saved", "files": saved})
        except asyncio.CancelledError:
            status = "cancelled"
        except BaseException as error:  # noqa: BLE001 - every failure must reach the UI as an event
            status = "error"
            await run.emit({"type": "error", "message": friendly_error(error)})
        finally:
            run.reject_pending()
            run.finished = True
            await run.emit({"type": "done", "status": status})
            if self.active is run:
                self.active = None

    def get(self, run_id: str) -> ChatRun | None:
        return self.runs.get(run_id)

    def resolve(self, run_id: str, approval_id: str, approved: bool) -> bool:
        run = self.runs.get(run_id)
        future = run.pending.get(approval_id) if run else None
        if future is None or future.done():
            return False
        future.set_result(bool(approved) is True)
        return True

    def cancel(self, run_id: str) -> bool:
        run = self.runs.get(run_id)
        if run is None or run.finished or run.task is None:
            return False
        run.cancel_requested = True
        run.task.cancel()
        return True
