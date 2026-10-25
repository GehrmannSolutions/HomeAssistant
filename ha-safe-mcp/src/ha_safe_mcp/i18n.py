"""UI language for messages the web UI shows (English default, German on request).

The browser sends ``X-UI-Language: de|en`` with every request; LocalOnlyGuard stores it in ``ui_language`` for the
request. Chat runs are asyncio tasks created inside the request, so they inherit the language. Messages for models
and MCP clients stay English; only texts shown to people go through ``L``.
"""
from contextvars import ContextVar

LANGUAGES = ("en", "de")
HEADER = "x-ui-language"
ui_language: ContextVar[str] = ContextVar("ui_language", default="en")


def pick(value) -> str:
    return value if value in LANGUAGES else "en"


def L(en: str, de: str) -> str:  # noqa: N802 - short on purpose, used in many messages
    """The message in the current UI language."""
    return de if ui_language.get() == "de" else en
