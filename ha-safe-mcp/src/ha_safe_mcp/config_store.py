"""Persist web-UI settings in the project's local .env (atomic, mode 0600, token never echoed)."""

import os
import re
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

PLACEHOLDER_TOKEN = "YOUR_HOME_ASSISTANT_LONG_LIVED_ACCESS_TOKEN"
DEFAULT_DOMAINS = ("light", "switch", "fan", "climate", "cover", "media_player")
DOMAIN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
TOKEN_CHARS = re.compile(r"^[A-Za-z0-9._~+/=-]{20,4096}$")
ENV_KEYS = ("HA_URL", "HA_TOKEN", "HA_ALLOW_WRITE", "HA_ALLOW_ADMIN_WRITE", "HA_ALLOW_DELETE",
            "HA_AUTO_WRITE", "HA_AUTO_ADMIN_WRITE", "HA_AUTO_DELETE", "HA_ALLOWED_DOMAINS", "OLLAMA_URL", "OLLAMA_MODEL")


class SetupError(ValueError):
    """User-facing validation error; messages are German and never contain secrets."""


def normalize_url(raw: str, label: str) -> str:
    parsed = urlsplit(str(raw or "").strip())
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise SetupError(f"{label}-Adresse muss eine einfache http(s)-Adresse ohne Pfad und Zugangsdaten sein")
    try:
        parsed.port
    except ValueError:
        raise SetupError(f"{label}-Adresse hat einen ungültigen Port") from None
    return f"{parsed.scheme}://{parsed.netloc}"


def validate_token(token: str) -> str:
    if not TOKEN_CHARS.fullmatch(token):
        raise SetupError("Token ist ungültig: erwartet wird ein langlebiger Home-Assistant-Zugriffstoken")
    return token


@dataclass(frozen=True)
class Settings:
    ha_url: str = "http://127.0.0.1:8123"
    ha_token: str = field(default="", repr=False)
    allow_write: bool = False
    allow_admin_write: bool = False
    allow_delete: bool = False
    # "enabled" per level: run that level's chat actions without an approval card (only on top of allow_*)
    auto_write: bool = False
    auto_admin_write: bool = False
    auto_delete: bool = False
    allowed_domains: tuple[str, ...] = DEFAULT_DOMAINS
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5-coder:7b"

    @property
    def configured(self) -> bool:
        return bool(self.ha_token) and self.ha_token != PLACEHOLDER_TOKEN

    def public(self) -> dict:
        return {"ha_url": self.ha_url, "token_set": self.configured, "allow_write": self.allow_write,
                "allow_admin_write": self.allow_admin_write, "allow_delete": self.allow_delete,
                "auto_write": self.auto_write, "auto_admin_write": self.auto_admin_write,
                "auto_delete": self.auto_delete, "allowed_domains": list(self.allowed_domains), "ollama_url": self.ollama_url,
                "ollama_model": self.ollama_model}

    def auto_levels(self) -> set[str]:
        """Levels whose chat actions run without an approval card; each needs its allow switch too."""
        return {level for level, allowed, auto in (("control", self.allow_write, self.auto_write),
                                                   ("admin", self.allow_admin_write, self.auto_admin_write),
                                                   ("delete", self.allow_delete, self.auto_delete))
                if allowed and auto}

    def mcp_env(self) -> dict[str, str]:
        """Exactly the variables the MCP server reads; nothing else reaches the child process."""
        flag = lambda value: "true" if value else "false"  # noqa: E731
        env = {"HA_URL": self.ha_url, "HA_TOKEN": self.ha_token, "HA_ALLOW_WRITE": flag(self.allow_write),
               "HA_ALLOW_ADMIN_WRITE": flag(self.allow_admin_write), "HA_ALLOW_DELETE": flag(self.allow_delete),
               "HA_ALLOWED_DOMAINS": ",".join(self.allowed_domains)}
        # operator setting of the UI process (systemd unit), deliberately not editable in the web UI
        config_dir = os.environ.get("HA_CONFIG_DIR", "").strip()
        if config_dir:
            env["HA_CONFIG_DIR"] = config_dir
        return env


def _flag(value) -> bool:
    if not isinstance(value, bool):
        raise SetupError("Schalter müssen true oder false sein")
    return value


def resolve_token(current: Settings, ha_url: str, token: str) -> str:
    """A blank token keeps the stored one only for the URL it was issued for."""
    url = normalize_url(ha_url, "Home-Assistant")
    if token:
        return validate_token(token)
    if current.configured and url == current.ha_url:
        return current.ha_token
    raise SetupError("Für eine neue Home-Assistant-Adresse bitte den Token erneut eingeben")


def merge_settings(current: Settings, data: dict) -> Settings:
    if not isinstance(data, dict):
        raise SetupError("Ungültige Eingabe")
    ha_url = normalize_url(data.get("ha_url", current.ha_url), "Home-Assistant")
    token = resolve_token(current, ha_url, str(data.get("token") or "").strip())
    ollama_url = normalize_url(data.get("ollama_url", current.ollama_url), "Ollama")
    model = str(data.get("ollama_model", current.ollama_model)).strip()
    if not MODEL.fullmatch(model):
        raise SetupError("Modellname ist ungültig")
    raw_domains = data.get("allowed_domains", list(current.allowed_domains))
    if isinstance(raw_domains, str):
        raw_domains = raw_domains.split(",")
    if not isinstance(raw_domains, list):
        raise SetupError("Domain-Liste ist ungültig")
    domains = tuple(dict.fromkeys(str(item).strip() for item in raw_domains if str(item).strip()))
    if any(not DOMAIN.fullmatch(item) for item in domains):
        raise SetupError("Domain-Liste enthält ungültige Einträge")
    allow_write = _flag(data.get("allow_write", current.allow_write))
    allow_admin = _flag(data.get("allow_admin_write", current.allow_admin_write))
    allow_delete = _flag(data.get("allow_delete", current.allow_delete))
    if allow_admin and not allow_write:
        raise SetupError("Konfigurationsänderungen setzen 'Steuern erlauben' voraus")
    if allow_delete and not allow_admin:
        raise SetupError("Löschen setzt 'Konfiguration ändern erlauben' voraus")
    autos = {}
    for key, allowed, label in (("auto_write", allow_write, "Steuern"),
                                ("auto_admin_write", allow_admin, "Konfiguration ändern"),
                                ("auto_delete", allow_delete, "Löschen")):
        if key in data:
            value = _flag(data[key])
            if value and not allowed:
                raise SetupError(f"'Ohne Freigabe' setzt '{label} erlauben' voraus")
            autos[key] = value
        else:
            autos[key] = getattr(current, key) and allowed
    return replace(current, ha_url=ha_url, ha_token=token, ollama_url=ollama_url, ollama_model=model,
                   allowed_domains=domains, allow_write=allow_write, allow_admin_write=allow_admin,
                   allow_delete=allow_delete, **autos)


def _as_bool(value) -> bool:
    return str(value or "").strip().lower() == "true"


READ_ONLY_REFUSAL = "Diese Instanz ist fest auf nur lesen eingestellt (--read-only); Schalter bleiben aus"
CONTROL_ONLY_REFUSAL = ("Diese Instanz erlaubt höchstens Steuern (--max-level control); Konfiguration ändern und "
                        "Löschen bleiben aus")
MAX_LEVELS = ("read", "control", "full")


class SettingsStore:
    """Owns the .env file. Writes are atomic; unrelated lines and comments survive.

    max_level caps the write switches in code, whatever the .env says: "read" = all off (alias read_only=True),
    "control" = only service calls (HA_ALLOW_WRITE) may be switched on, "full" = no cap. Meant for a second UI
    against a production Home Assistant; saving a switch above the cap is refused."""

    def __init__(self, path: Path, *, read_only: bool = False, max_level: str | None = None):
        self.path = Path(path)
        level = max_level or ("read" if read_only else "full")
        if level not in MAX_LEVELS or (read_only and level != "read"):
            raise ValueError(f"max_level must be one of {', '.join(MAX_LEVELS)}")
        self.max_level = level

    @property
    def read_only(self) -> bool:
        return self.max_level == "read"

    def load(self) -> Settings:
        if not self.path.exists():
            return Settings()
        values = dotenv_values(self.path)
        defaults = Settings()
        token = (values.get("HA_TOKEN") or "").strip()
        domains = tuple(item.strip() for item in (values.get("HA_ALLOWED_DOMAINS") or "").split(",") if item.strip())
        control = self.max_level != "read"
        full = self.max_level == "full"
        allow_write = control and _as_bool(values.get("HA_ALLOW_WRITE"))
        allow_admin = full and allow_write and _as_bool(values.get("HA_ALLOW_ADMIN_WRITE"))
        allow_delete = full and allow_admin and _as_bool(values.get("HA_ALLOW_DELETE"))
        return Settings(ha_url=(values.get("HA_URL") or defaults.ha_url).strip().rstrip("/"),
                        ha_token="" if token == PLACEHOLDER_TOKEN else token,
                        allow_write=allow_write, allow_admin_write=allow_admin, allow_delete=allow_delete,
                        auto_write=allow_write and _as_bool(values.get("HA_AUTO_WRITE")),
                        auto_admin_write=allow_admin and _as_bool(values.get("HA_AUTO_ADMIN_WRITE")),
                        auto_delete=allow_delete and _as_bool(values.get("HA_AUTO_DELETE")),
                        allowed_domains=domains or defaults.allowed_domains,
                        ollama_url=(values.get("OLLAMA_URL") or defaults.ollama_url).strip().rstrip("/"),
                        ollama_model=(values.get("OLLAMA_MODEL") or defaults.ollama_model).strip())

    def save(self, settings: Settings) -> Settings:
        if not settings.configured:
            raise SetupError("Ohne Token kann nicht gespeichert werden")
        if self.read_only and (settings.allow_write or settings.allow_admin_write or settings.allow_delete):
            raise SetupError(READ_ONLY_REFUSAL)
        if self.max_level == "control" and (settings.allow_admin_write or settings.allow_delete):
            raise SetupError(CONTROL_ONLY_REFUSAL)
        flag = lambda value: "true" if value else "false"  # noqa: E731
        values = {"HA_URL": settings.ha_url, "HA_TOKEN": settings.ha_token,
                  "HA_ALLOW_WRITE": flag(settings.allow_write),
                  "HA_ALLOW_ADMIN_WRITE": flag(settings.allow_admin_write),
                  "HA_ALLOW_DELETE": flag(settings.allow_delete),
                  "HA_AUTO_WRITE": flag(settings.auto_write and settings.allow_write),
                  "HA_AUTO_ADMIN_WRITE": flag(settings.auto_admin_write and settings.allow_admin_write),
                  "HA_AUTO_DELETE": flag(settings.auto_delete and settings.allow_delete),
                  "HA_ALLOWED_DOMAINS": ",".join(settings.allowed_domains),
                  "OLLAMA_URL": settings.ollama_url, "OLLAMA_MODEL": settings.ollama_model}
        if any("\n" in value or "\r" in value for value in values.values()):
            raise SetupError("Ungültige Zeichen in den Einstellungen")
        lines, written = [], set()
        if self.path.exists():
            for line in self.path.read_text(encoding="utf-8").splitlines():
                key = line.split("=", 1)[0].strip()
                if key in values:
                    if key not in written:
                        lines.append(f"{key}={values[key]}")
                        written.add(key)
                    continue
                lines.append(line)
        lines.extend(f"{key}={values[key]}" for key in ENV_KEYS if key not in written)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".env.", suffix=".tmp", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write("\n".join(lines) + "\n")
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return self.load()
