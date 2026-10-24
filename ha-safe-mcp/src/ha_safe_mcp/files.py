"""Local store for plans and scripts that the model writes, shown in the web UI's file manager.

Safety: one fixed root with two kinds (``plan``, ``script``) as sub-directories; file names are a strict
allowlist (no paths, no hidden files, known text extensions only); symlinks are never followed, listed,
overwritten or deleted; directory 0700, files 0600 and never executable. Nothing here runs a script:
saving a file is storage only, and the files never reach Home Assistant.
"""

import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

KINDS = ("plan", "script")
EXTENSIONS = ("md", "txt", "yaml", "yml", "json", "sh", "py", "jinja")
NAME = re.compile(rf"^[a-z0-9][a-z0-9_-]{{0,63}}(?:\.[a-z0-9_-]{{1,16}})?\.(?:{'|'.join(EXTENSIONS)})$")
FENCE = re.compile(r"```([A-Za-z0-9_+-]*)[ \t]*\n(.*?)```", re.DOTALL)
LANGUAGES = {"yaml": "yaml", "yml": "yaml", "bash": "sh", "sh": "sh", "shell": "sh", "zsh": "sh",
             "python": "py", "py": "py", "json": "json", "jinja": "jinja", "jinja2": "jinja",
             "markdown": "md", "md": "md"}
MAX_BYTES = 256 * 1024
MAX_FILES = 500


class FileError(ValueError):
    """German, user-facing message."""


def default_directory() -> Path:
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "ha-safe-mcp" / "files"


def code_blocks(text: str) -> list[tuple[str, str]]:
    """Fenced code blocks of an answer as (extension, content); unknown languages become txt."""
    return [(LANGUAGES.get(lang.lower(), "txt"), body) for lang, body in FENCE.findall(text or "") if body.strip()]


class FileStore:
    def __init__(self, directory: Path | None = None, *, max_bytes: int = MAX_BYTES, max_files: int = MAX_FILES):
        self.directory = Path(directory) if directory else default_directory()
        self.max_bytes = max_bytes
        self.max_files = max_files

    def _ensure(self, kind: str) -> Path:
        for path in (self.directory, self.directory / kind):
            if path.is_symlink():
                raise FileError("Ablageordner ist ein symbolischer Link")
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(path, 0o700)
        return self.directory / kind

    def _path(self, kind: str, name: str) -> Path:
        if kind not in KINDS:
            raise FileError("Unbekannte Dateiart (erlaubt: plan, script)")
        if not isinstance(name, str) or not NAME.fullmatch(name):
            raise FileError("Ungültiger Dateiname: nur Kleinbuchstaben, Ziffern, - und _, "
                            f"Endung {', '.join(EXTENSIONS)}")
        return self.directory / kind / name

    def _regular(self, kind: str, name: str) -> Path:
        path = self._path(kind, name)
        if path.is_symlink() or (self.directory / kind).is_symlink() or self.directory.is_symlink():
            raise FileError("Datei nicht gefunden")
        if not path.is_file():
            raise FileError("Datei nicht gefunden")
        return path

    def _info(self, kind: str, path: Path) -> dict:
        info = path.stat()
        return {"kind": kind, "name": path.name, "size": info.st_size,
                "modified": datetime.fromtimestamp(info.st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

    def entries(self) -> list[dict]:
        items = []
        if self.directory.is_symlink() or not self.directory.is_dir():
            return items
        for kind in KINDS:
            folder = self.directory / kind
            if folder.is_symlink() or not folder.is_dir():
                continue
            for path in folder.iterdir():
                if NAME.fullmatch(path.name) and not path.is_symlink() and path.is_file():
                    items.append(self._info(kind, path))
        return sorted(items, key=lambda item: item["modified"], reverse=True)

    def read(self, kind: str, name: str) -> str:
        path = self._regular(kind, name)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as handle:
            data = handle.read(self.max_bytes + 1)
        return data.decode("utf-8", errors="replace")

    def save(self, kind: str, name: str, content: str, *, overwrite: bool = True) -> dict:
        path = self._path(kind, name)
        if not isinstance(content, str):
            raise FileError("Inhalt muss Text sein")
        data = content.encode("utf-8")
        if len(data) > self.max_bytes:
            raise FileError(f"Datei zu groß (höchstens {self.max_bytes // 1024} KB)")
        folder = self._ensure(kind)
        if path.is_symlink():
            raise FileError("Ziel ist ein symbolischer Link")
        if path.exists() and not overwrite:
            stem, dot, ext = name.rpartition(".")
            for number in range(2, 1000):
                candidate = f"{stem}-{number}.{ext}"
                if NAME.fullmatch(candidate) and not (folder / candidate).exists():
                    path = folder / candidate
                    break
            else:
                raise FileError("Kein freier Dateiname gefunden")
        if not path.exists() and len(self.entries()) >= self.max_files:
            raise FileError(f"Ablage voll (höchstens {self.max_files} Dateien); bitte alte Dateien löschen")
        fd, temp = tempfile.mkstemp(dir=folder, prefix=".tmp-")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.chmod(temp, 0o600)
            os.replace(temp, path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise
        return self._info(kind, path)

    def save_answer_blocks(self, answer: str, prefix: str | None = None) -> list[dict]:
        """Store every fenced code block of a model answer as a script (never executed)."""
        stamp = prefix or datetime.now(timezone.utc).strftime("chat-%Y%m%d-%H%M%S")
        saved = []
        for index, (ext, body) in enumerate(code_blocks(answer), start=1):
            saved.append(self.save("script", f"{stamp}-{index}.{ext}", body, overwrite=False))
        return saved

    def delete(self, kind: str, name: str) -> None:
        self._regular(kind, name).unlink()
