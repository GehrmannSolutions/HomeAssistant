# ha-safe-mcp

**English** · [Deutsch](README.de.md)

A self-hosted, safety-first [Model Context Protocol](https://modelcontextprotocol.io/) bridge to Home Assistant. Use it with a local MCP client over **stdio**, or use the optional loopback-only browser UI and a local Ollama model. It is not an unrestricted REST/WebSocket proxy. All write operations are **disabled by default**; enabling them is a deliberate choice on **your own** Home Assistant instance.

The web UI is available in English and German (language switch in the header) and has a light/dark toggle.

## Get started

Requires Python 3.11+, an existing Home Assistant instance, and a Home Assistant long-lived access token. Ollama is needed only for the included chat UI/CLI, not for a generic MCP client.

```bash
# From the root of a clone of this repository:
cd ha-safe-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/ha-mcp-ui  # visit http://127.0.0.1:8765/ on the same machine
```

The UI wizard tests your Home Assistant address and token before saving them. Configure a local, tool-capable Ollama model for chat; if using an external MCP client, Ollama is unnecessary. The UI and the documentation are available in English and German. **Do not expose port 8765 to your network or the internet.** The UI has no built-in account login. See the full [installation guide](docs/INSTALL.md) for a headless MCP setup, a read-only first test, and deployment options.

## What it does

**[Feature guide](docs/FEATURES.md)**: every function in plain words, with examples and screenshots.

- Read states, discover entities and services; discover entities in a room; call allowed services on one or up to 20 entities of the same domain.
- A **fixed, documented REST route catalog** plus typed tools for automations, dashboards, helpers, registry metadata, areas/floors/devices, scenes/scripts, integration config flows and settings, and Home Assistant backups.
- Separate gates for control, admin changes, and deletion; CLI/UI per-call confirmation by default. Other MCP clients must implement their own human approval.
- Remote MCP endpoint `/mcp` (Streamable HTTP) for Claude Code, Codex, ChatGPT, Claude and other clients: bearer token or OAuth 2.1 login (consent page behind your UI login), one permission level per client, capped by the instance switches.
- Deep search ("where is this entity used?") and a system overview.
- Actions are read back: the answer says whether each device really reached the requested state; service responses
  and custom events.
- Weather forecast (daily, hourly) from Home Assistant's weather entities.
- Read-only views of add-ons, system health, HACS, Zigbee devices and Thread networks.
- Read and edit configuration files (YAML, packages, custom components) with credential masking, config check,
  automatic revert and undo; via the File editor add-on or a local config directory.
- Blueprints (import from URL), themes and dashboard resources.
- Updates, configuration check, reload and restart (restart only after a passing check).
- Calendars and to-do lists: read events and items, add, change, tick off, delete.
- Helpers: input helpers, buttons, counters, timers, schedules, and config-flow helpers (template, group, utility
  meter, derivative, ...).
- Labels, categories and zones; entity aliases, labels, categories, hiding and entity ID renames.
- Debugging: automation/script traces, error log, logbook, history, long-term statistics, repairs, system health, template and condition tests.
- Change journal with undo: every configuration change keeps its previous state locally (30 days) and can be undone (and redone) from the chat or the UI's **Changes** tab.
- UI credential store for integration secrets (referenced by alias), saved plans/code blocks (not executed), metadata-only request log, backup download.
- No backup restore, editing of protected files (`secrets.yaml`, `.storage`, databases), generic network discovery, arbitrary WebSocket commands, or unbounded API proxy.

## Documentation

| Document | Audience |
|---|---|
| [Installation](docs/INSTALL.md) | Prerequisites, token handling, local setup, MCP clients, UI/CLI, tests |
| [User guide](docs/USER_GUIDE.md) | Common read/control/build workflows and troubleshooting |
| [Technical documentation](docs/TECHNICAL.md) | Architecture, trust boundaries, APIs, local data, developer workflow |
| [Tool reference](docs/TOOLS.md) | Generated from the registered MCP tool schemas |
| [Changelog](CHANGELOG.md) | Release history (historical entries may remain in German) |

See [CONTRIBUTING.md](../CONTRIBUTING.md) to contribute and [LICENSE](LICENSE) for MIT reuse. Changes to HA Core's internal management interfaces can break specific administrative tools; test against a disposable HA Core before relying on them.
