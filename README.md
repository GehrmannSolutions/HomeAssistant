# Home Assistant projects

Development of tools for Home Assistant. This repository is **source code and documentation**, not a backup or configuration export of anyone's Home Assistant installation. The current source tree contains no production tokens or configuration exports. Earlier private Git history has not been prepared for public release.

## Projects

| Project | Purpose | Start here |
|---|---|---|
| [ha-safe-mcp](ha-safe-mcp/) | Safety-first, self-hosted Home Assistant MCP server (stdio), optional local Ollama chat and loopback web UI | [Install](ha-safe-mcp/docs/INSTALL.md) · [User guide](ha-safe-mcp/docs/USER_GUIDE.md) · [Technical docs](ha-safe-mcp/docs/TECHNICAL.md) · [Tool reference](ha-safe-mcp/docs/TOOLS.md) |
| [ha-diorama](ha-diorama/) | Copy of the MIT-licensed 3D card [CarlesRojas/ha-diorama](https://github.com/CarlesRojas/ha-diorama) for analysis and own additions (walls), offered upstream | [Upstream](ha-diorama/UPSTREAM.md) · [Analyse (DE)](ha-diorama/HESTIA-ANALYSE.de.md) |

The `ha-safe-mcp/` directory is self-contained: packaging, source, tests, Docker test setup, examples, and documentation live together. Run its commands **from that directory**, not the repository root. Start with read-only access against your own disposable or test Home Assistant instance; never point destructive integration tests at your home.

**Language:** Documentation is in English for the community; the current web UI and some runtime messages are still in German. Contributions to localization are welcome.

## Safety and reuse

The server registers tools for reads, controls, configuration changes, and deletes, but **all writes are disabled by default**. A Home Assistant token retains its Home Assistant privileges independently of the MCP permission switches. Read the [authorization and residual risk](ha-safe-mcp/docs/TECHNICAL.md#authorization-and-residual-risk) section before enabling writes. This is not a hosted service and does not require a GitHub token.

Code is available under the [MIT license](LICENSE). For problems, see [contributing and security guidance](CONTRIBUTING.md). No release or compatibility guarantee is implied by the repository layout.
