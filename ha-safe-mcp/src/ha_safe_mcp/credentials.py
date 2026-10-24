"""Local credential store for device and service logins (e.g. Shelly) used by integration setup.

Values are encrypted at rest (Fernet) in a 0700 directory outside the repository: a 0600 key file and
a 0600 data file. The key sits next to the data, so this protects against accidental disclosure
(backups, screenshots, a stray `cat`, a commit) but not against someone with the user's shell.
Only aliases, labels and field names are ever shown; values leave the store solely through
`resolve_refs`, which the MCP server calls right before sending them to Home Assistant.
"""

import json
import os
import re
import tempfile
import time
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

ALIAS = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
FIELD = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
MAX_VALUE = 4096
MAX_LABEL = 80
MAX_FIELDS = 8
REF_KEY = "$credential"


class CredentialError(ValueError):
    """User-facing error; never contains a stored value."""


def default_dir() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "ha-safe-mcp" / "credentials"


def _write_private(path: Path, data: bytes):
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class CredentialStore:
    def __init__(self, directory: Path | None = None):
        self.directory = Path(directory) if directory else default_dir()
        self.key_path = self.directory / "store.key"
        self.data_path = self.directory / "store.bin"

    def _fernet(self, create: bool) -> Fernet | None:
        if not self.key_path.exists():
            if not create:
                return None
            self.directory.mkdir(parents=True, exist_ok=True)
            os.chmod(self.directory, 0o700)
            _write_private(self.key_path, Fernet.generate_key())
        return Fernet(self.key_path.read_bytes().strip())

    def _load(self) -> dict:
        fernet = self._fernet(create=False)
        if fernet is None or not self.data_path.exists():
            return {}
        try:
            data = json.loads(fernet.decrypt(self.data_path.read_bytes()))
        except (InvalidToken, ValueError):
            raise CredentialError("Zugangsdaten-Speicher ist beschädigt oder der Schlüssel passt nicht") from None
        if not isinstance(data, dict):
            raise CredentialError("Zugangsdaten-Speicher ist beschädigt")
        return data

    def _store(self, data: dict):
        fernet = self._fernet(create=True)
        assert fernet is not None
        _write_private(self.data_path, fernet.encrypt(json.dumps(data).encode()))

    def list_public(self) -> list[dict]:
        return [{"alias": alias, "label": item["label"], "fields": sorted(item["fields"]),
                 "updated": item["updated"]} for alias, item in sorted(self._load().items())]

    def aliases(self) -> dict[str, list[str]]:
        return {alias: sorted(item["fields"]) for alias, item in self._load().items()}

    def save(self, alias: str, label: str, fields: dict) -> dict:
        if not isinstance(alias, str) or not ALIAS.fullmatch(alias):
            raise CredentialError("Alias: Kleinbuchstaben, Ziffern und _, beginnt mit einem Buchstaben")
        label = str(label or "").strip()[:MAX_LABEL] or alias
        if not isinstance(fields, dict) or not 1 <= len(fields) <= MAX_FIELDS:
            raise CredentialError(f"1 bis {MAX_FIELDS} Felder angeben")
        data = self._load()
        current = data.get(alias, {}).get("fields", {})
        merged = {}
        for name, value in fields.items():
            if not isinstance(name, str) or not FIELD.fullmatch(name):
                raise CredentialError("Feldnamen: Kleinbuchstaben, Ziffern und _")
            if not isinstance(value, str) or len(value) > MAX_VALUE or "\n" in value or "\r" in value:
                raise CredentialError("Werte: eine Zeile, höchstens 4096 Zeichen")
            if value == "":
                if name not in current:
                    raise CredentialError(f"Feld '{name}' braucht einen Wert")
                value = current[name]
            merged[name] = value
        data[alias] = {"label": label, "fields": merged, "updated": int(time.time())}
        self._store(data)
        return next(item for item in self.list_public() if item["alias"] == alias)

    def delete(self, alias: str):
        data = self._load()
        if alias not in data:
            raise CredentialError("Unbekannter Alias")
        del data[alias]
        self._store(data)

    def value(self, alias: str, field: str) -> str:
        item = self._load().get(alias)
        if item is None or field not in item["fields"]:
            raise CredentialError(f"Zugangsdatum '{alias}.{field}' existiert nicht")
        return item["fields"][field]


def resolve_refs(store: CredentialStore, data: dict) -> tuple[dict, dict[str, str]]:
    """Replace top-level {"$credential": alias, "field": name} values; return the secret->label map for scrubbing."""
    resolved, used = {}, {}
    for key, value in data.items():
        if isinstance(value, dict) and REF_KEY in value:
            alias, field = value.get(REF_KEY), value.get("field")
            if set(value) != {REF_KEY, "field"} or not isinstance(alias, str) or not isinstance(field, str):
                raise CredentialError('Referenz braucht genau {"$credential": "<alias>", "field": "<feld>"}')
            secret = store.value(alias, field)
            resolved[key] = secret
            used[secret] = f"{alias}.{field}"
        else:
            resolved[key] = value
    return resolved, used


def scrub(value, used: dict[str, str]):
    """Replace every used secret in a (nested) result with a placeholder."""
    if not used:
        return value
    if isinstance(value, str):
        for secret, label in sorted(used.items(), key=lambda item: -len(item[0])):
            value = value.replace(secret, f"[credential:{label}]")
        return value
    if isinstance(value, dict):
        return {key: scrub(item, used) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item, used) for item in value]
    return value
