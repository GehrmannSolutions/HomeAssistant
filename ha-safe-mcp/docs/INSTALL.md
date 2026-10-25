# Install ha-safe-mcp on your own Home Assistant

**English** · [Deutsch](INSTALL.de.md)

Run commands from the **`ha-safe-mcp/` subdirectory** of a clone, never the repository root. The repository does not include a preconfigured HA installation. Python 3.11 or newer is required. Install and configure Home Assistant separately; a local Ollama server with a tool-capable model is optional (needed only for chat).

## 1. Install the package

```bash
git clone https://github.com/GehrmannSolutions/HomeAssistant.git
cd HomeAssistant/ha-safe-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -e .
# optional test dependencies:
.venv/bin/python -m pip install -e '.[test]'
```

The repository may not yet be publicly accessible; if access is denied, ask the owner rather than trying a different source. Your virtual environment stays local and is ignored by Git. For another operating system, use that platform's venv activation/executable path instead of `.venv/bin/`. Nothing in this step needs a Home Assistant token or GitHub personal access token.

## 2. Create a Home Assistant token

In **your** HA web interface, open your profile → **Security** → **Long-lived access tokens** and create one for this client ([HA authentication docs](https://www.home-assistant.io/docs/authentication/)). Prefer a separate non-admin HA user for read-only access. HA admin-only tools require an administrator token, even if the server calls them "read". Revoke the token in HA if exposed. Never paste it into chat, an issue, a screenshot, shell history, Git, or an Ollama prompt.

Choose one configuration route:

### A. Browser wizard (for local chat)

Ensure your local Ollama service is running with a model that supports tool calls (the wizard will list available models). Then:

```bash
.venv/bin/ha-mcp-ui --read-only
# Open http://127.0.0.1:8765/ on this same machine
```

Follow the HA URL/token test, Ollama model selection and safety steps. The default settings file is `ha-safe-mcp/.env` (created with mode 0600). The token is not returned to the browser after saving. `--read-only` is an additional **hard cap**: saved write settings cannot override it. Omit the cap only when deliberately testing permitted actions on an appropriate HA instance. `--max-level control` permits only service calls for allowed domains (if enabled in settings); `--max-level full` permits the configured admin/delete levels as well. Leave the service bound to `127.0.0.1`.

The web UI is in English by default and can be switched to German in its header. The UI is a local application, not an MCP HTTP endpoint; it spawns a stdio MCP process for chat.

### B. Headless stdio MCP client (Ollama not required)

```bash
cp -n .env.example .env
chmod 600 .env
# Use a local editor to set HA_URL and HA_TOKEN in .env.
# Leave HA_ALLOW_WRITE, HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE false initially.
```

`HA_URL` must be a root `http(s)` URL with no path, query, or embedded credentials, reachable **from the MCP process**. For remote HA use HTTPS with normal certificate verification. If `127.0.0.1:8123` is the default, it means the local computer, not a remote server or a Docker host reached from inside a container. Set `HA_URL` to your own HA address. Environment variables already present in the process override values loaded from `.env`.

An MCP client that supports a command and working directory can use a config shaped like this (adjust for your client, and replace the placeholder with the absolute path of your clone):

```json
{
  "mcpServers": {
    "home-assistant": {
      "command": "/ABSOLUTE/PATH/HomeAssistant/ha-safe-mcp/.venv/bin/ha-safe-mcp",
      "cwd": "/ABSOLUTE/PATH/HomeAssistant/ha-safe-mcp"
    }
  }
}
```

The working directory is significant: it is where the stdio server loads `.env`. If your client does not implement `cwd`, use an appropriately secured per-process environment instead; do not put a real token in a shared client JSON file. The MCP server speaks stdio JSON-RPC; running `ha-safe-mcp` in a shell will not open a chat or a web page.

**First read-only check:** restart the MCP client, call `ha_rest_catalog` with `{}` (local catalog, no HA request), then `ha_rest_query` with `{"path":"/api/"}` (real HA request). `ha_search_entities` can be empty on a fresh HA and does not by itself prove connectivity. A failed call should not be interpreted as an empty house.

## 3. Optional Ollama command-line client

Install/start [Ollama](https://docs.ollama.com/), pull a tool-capable model, and from the same directory run:

```bash
ollama pull qwen2.5-coder:7b
.venv/bin/ha-ollama-chat 'List available lights using current Home Assistant state.'
```

This uses `.env` via the MCP child process. With writes explicitly enabled in `.env`, add `--allow-write` to expose write tools; the CLI still asks for exact `YES` **for each** proposed write. Tool routing is keyword-based and may miss complex tasks. The CLI chat text is not itself an HA command and must not contain secrets.

## 4. Permission switches and isolation

| `.env` setting | Default | Effect |
|---|---|---|
| `HA_ALLOW_WRITE` | `false` | Allow control/service calls for `HA_ALLOWED_DOMAINS` (and non-admin REST writes where catalogued). |
| `HA_ALLOW_ADMIN_WRITE` | `false` | In addition to write, allow configuration changes; HA still requires its own admin rights where applicable. |
| `HA_ALLOW_DELETE` | `false` | In addition to both above, allow destructive delete tools. |
| `HA_ALLOWED_DOMAINS` | `light,switch,fan,climate,cover,media_player` | Service-call target domain allowlist, **not** a general limit on admin mutations. Narrow it before granting control. What domains are and which ones are risky: [USER_GUIDE.md](USER_GUIDE.md#domains-what-the-allowed-list-means-and-how-to-choose-it). |
| `HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE` | `false` | In **UI chat only**, skip the approval card for that allowed level; the chat "Allow actions" checkbox remains required. Avoid for routine use. |

A generic MCP client does **not** inherit the UI approval cards or CLI `YES`: enforce per-call human approval in that client. The server settings gate operations, not consent. Running a separate UI with `--read-only --env-file /path/to/instance.env` also caps writes **in code**; use a separate non-admin HA token and XDG directories when isolating multiple installations. `--max-level control` does **not** restrict which individual lights or devices can be controlled within an allowed domain. For truly read-only operation, combine the hard cap with minimal HA privileges.

The UI binds to loopback and has Host, Origin, and CSRF checks; **it has no standalone login**. `--allow-remote` turns off the loopback gate and is unsafe by itself. `--public-host` is an *optional* Cloudflare Access deployment mode requiring `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`, a valid Access application/policy and a correctly configured reverse tunnel; it verifies signed Access JWTs on every request. It is not a generic authentication mode and does not set up Cloudflare for you. Do not publish the raw origin. See [technical documentation](TECHNICAL.md).

## 5. Local data and upgrades

The UI writes `.env` in the project subdirectory (or the explicit `--env-file` you choose). On Linux, credentials and their encryption key default to `~/.config/ha-safe-mcp/credentials/`; generated chat plans/scripts to `~/.local/share/ha-safe-mcp/files/`; request audit metadata to `~/.local/state/ha-safe-mcp/audit/` (30-day retention). Browser chat history uses browser `localStorage`. These contain **your own installation data**; they are ignored by Git, not part of this repository. Back up the credential key together with the encrypted store. A stolen key and store together are not secure. To upgrade the source, reinstall editable (`.venv/bin/python -m pip install -e .`), review the [changelog](../CHANGELOG.md), and restart your client/UI. Do not overwrite `.env`.

**Migrating from the earlier repository-root layout:** If you already kept `.env` at the repository root, do not move it blindly or lose track of the token. Keep it protected; start the UI with an explicit `--env-file /path/to/previous/.env` and set the MCP client's `cwd` to the directory of that file, or deliberately copy settings with a local editor into the subproject's `.env`. Fresh installs should use `ha-safe-mcp/.env`. Data under XDG directories stays where it was. No automatic migration is performed.

## 6. Tests (never on a real home)

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/gen_tool_reference.py --check
```

Unit and ASGI tests run with fakes and require no live HA. Optional Docker smoke tests use `compose.test.yaml` to create a **test double** at loopback port 18123 and exercise MCP stdio; `tests/ha_core_smoke.py` is **destructive**, onboards a fresh HA Core and changes configuration. Never set `HA_CORE_TEST_URL` to a production, family, or already configured HA. See [technical testing notes](TECHNICAL.md#tests-verification-and-limitations).

Next: [use the tools safely](USER_GUIDE.md) · [tool reference](TOOLS.md) · [architecture](TECHNICAL.md).
