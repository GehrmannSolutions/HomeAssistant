"""The stdio process must not silently load a neighboring installation's token."""

import os
import subprocess
import sys

from ha_safe_mcp import server


def test_main_reads_only_cwd_dotenv(tmp_path, monkeypatch):
    calls = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("HA_TOKEN", "local-test-token")
    monkeypatch.setattr(server, "load_dotenv", lambda *, dotenv_path: calls.append(dotenv_path))

    class DummyMCP:
        def run(self, *, transport):
            calls.append(transport)

    monkeypatch.setattr(server, "create_server", lambda *args, **kwargs: DummyMCP())
    server.main()
    assert calls == [tmp_path / ".env", "stdio"]


def test_parent_dotenv_not_loaded_by_stdio_process(tmp_path):
    (tmp_path / ".env").write_text("HA_TOKEN=parent_test_token_never_use\n")
    child = tmp_path / "another-installation"
    child.mkdir()
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("HA_") and key != "PYTHON_DOTENV_DISABLED"}
    result = subprocess.run([sys.executable, "-m", "ha_safe_mcp"], cwd=child,
                            env=env, input="", text=True, capture_output=True, timeout=10)
    assert result.returncode != 0
    assert "HA_TOKEN is required" in result.stderr
