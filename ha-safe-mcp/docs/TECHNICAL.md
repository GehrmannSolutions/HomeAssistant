# Technical architecture and developer guide

This document describes the implementation in [`src/ha_safe_mcp/`](../src/ha_safe_mcp/), not everything Home Assistant (HA) offers. For setup see [INSTALL.md](INSTALL.md), for operation see [USER_GUIDE.md](USER_GUIDE.md), and for the registered MCP tools and their switches see [TOOLS.md](TOOLS.md). The running HA Core version and the HA token's own privileges also determine whether an operation succeeds. The UI's current interface and some model-facing prompts are in German; this document does not imply English localization of the application.

## Processes, trust boundaries, and data flow

```text
MCP client ── JSON-RPC over stdio ──> FastMCP server ── authenticated HTTP / WS ──> HA Core
                                        │
                                        ├── credential store (local, for selected HA requests)
                                        └── metadata audit log (local)

Browser ── HTTP on loopback ──> Starlette web UI ── per-chat stdio child ──> FastMCP server
                                  │       │
                                  │       └── Ollama /api/chat (configured URL; tool loop)
                                  ├── settings .env / credential store / audit log
                                  └── generated text file store

Optional HTTPS ingress: Cloudflare Access + tunnel ──> loopback web UI
```

- [`server.main()`](../src/ha_safe_mcp/server.py) loads only `.env` in the **current working directory** (`Path.cwd() / ".env"`, without searching parent directories) into the process environment, constructs an `HAClient` and `FastMCP`, then runs **stdio**. It does not listen for MCP over HTTP. Tools are registered even when writes are disabled; gates are checked when called. `python -m ha_safe_mcp` uses [`__main__.py`](../src/ha_safe_mcp/__main__.py).
- [`HAClient`](../src/ha_safe_mcp/server.py) sends Bearer-token HTTP requests for state, service and selected configuration operations. [`RestGateway`](../src/ha_safe_mcp/rest_api.py) handles only its own exact catalog. [`HAWebSocket`](../src/ha_safe_mcp/management.py) authenticates to HA's `/api/websocket` using the same token, opens a new connection per command and expects a matching `result`. HA's authorization is an additional boundary, not replaced by adapter switches.
- [`ha-ollama-chat`](../src/ha_safe_mcp/ollama_client.py) is an optional CLI MCP client, not another transport. It starts a stdio child, lists MCP tools, offers a prompt-dependent subset as Ollama function schemas, executes allowed calls and returns truncated tool results to the configured Ollama endpoint. The HA token is passed to the MCP child rather than included in function schemas, but **tool results and prompts reach the configured Ollama server**. The tool-selection heuristic can omit a relevant tool; it is not a security boundary. The loop is bounded and uses non-streaming Ollama responses.
- [`ha-mcp-ui`](../src/ha_safe_mcp/web.py) is a separate Starlette HTTP service, bound to loopback by default; it is **not an HTTP MCP endpoint**. The browser starts a chat, polls run events and resolves write approvals. For each chat turn, the UI creates a stdio MCP child and calls the same Ollama tool loop. The child receives explicit HA settings plus credential/audit directory locations; auto-approval settings remain in the UI. [`chat_runs.py`](../src/ha_safe_mcp/chat_runs.py) manages one active run, in-memory events, single-use approvals, timeouts and cancellation. Runs are not durable across a restart.
- The UI also has direct, gated endpoints for backup listing/creation/deletion/download using the same [`HABackups`](../src/ha_safe_mcp/backups.py) implementation. A download streams from HA to the browser, rather than creating a server-side backup file. There is no restore endpoint or MCP restore tool.

## Component map

| Source | Responsibility |
| --- | --- |
| [`server.py`](../src/ha_safe_mcp/server.py), [`__main__.py`](../src/ha_safe_mcp/__main__.py) | FastMCP registration, stdio entry point, `HAClient`, service-target checks, tool audit wrapper |
| [`rest_api.py`](../src/ha_safe_mcp/rest_api.py) | Method/path/query catalog, permission classes, response handling |
| [`management.py`](../src/ha_safe_mcp/management.py) | Authenticated allowlisted WS transport; typed automation, dashboard, helper and entity-registry operations |
| [`integrations.py`](../src/ha_safe_mcp/integrations.py) | Config-entry HTTP flows and typed WS entry settings; credential-reference resolution and result reduction |
| [`scenes.py`](../src/ha_safe_mcp/scenes.py) | Scene/script config HTTP, prechecks, read-back and service invocation |
| [`registry.py`](../src/ha_safe_mcp/registry.py) | Area/floor/device WS operations and area-entity view |
| [`backups.py`](../src/ha_safe_mcp/backups.py) | HA backup WS operations and allowlisted streaming download |
| [`oauth.py`](../src/ha_safe_mcp/oauth.py), [`webui/oauth.html`](../src/ha_safe_mcp/webui/oauth.html) | OAuth 2.1 authorization server for the remote endpoint: metadata, dynamic registration, consent, PKCE code flow, refresh rotation |
| [`domains.py`](../src/ha_safe_mcp/domains.py), [`webui/domains.js`](../src/ha_safe_mcp/webui/domains.js) | Domain labels and risk notes; `/api/domains` (read-only states + services of the connected HA) feeding the domain pickers |
| [`diagnostics.py`](../src/ha_safe_mcp/diagnostics.py) | Read-only debugging: traces, system log, logbook, history, statistics, repairs, system health (WS subscription collected until `finish`), template rendering, condition tests; timestamps converted to HA's time zone |
| [`overview.py`](../src/ha_safe_mcp/overview.py) | Deep search over stored automation/script/scene configs, group members and Lovelace configs (bounded concurrency); system overview from config, states, registries and config entries |
| [`remote.py`](../src/ha_safe_mcp/remote.py) | Remote MCP endpoint: client token store, permission caps, per-client stdio children, gateway server |
| [`changes.py`](../src/ha_safe_mcp/changes.py) | Change journal: capture previous state, journaled writes, undo through the same gated operations |
| [`ollama_client.py`](../src/ha_safe_mcp/ollama_client.py), [`chat_runs.py`](../src/ha_safe_mcp/chat_runs.py) | Model tool loop (keyword preselection, local `find_tools` search with German topic patterns and word overlap, on-demand loading of permitted tools by name), CLI confirmation, web run/approval lifecycle |
| [`web.py`](../src/ha_safe_mcp/web.py), [`webui/`](../src/ha_safe_mcp/webui/index.html), [`access_auth.py`](../src/ha_safe_mcp/access_auth.py) | HTTP UI, bundled static frontend, optional Access JWT validation |
| [`config_store.py`](../src/ha_safe_mcp/config_store.py), [`credentials.py`](../src/ha_safe_mcp/credentials.py), [`audit.py`](../src/ha_safe_mcp/audit.py), [`files.py`](../src/ha_safe_mcp/files.py) | Local settings, secrets, metadata logs and generated text files |

Entrypoints, dependencies and pytest configuration are in [`pyproject.toml`](../pyproject.toml). The precise public tool surface is [TOOLS.md](TOOLS.md) and the `@tool()` registrations in [`server.py`](../src/ha_safe_mcp/server.py).

## Three distinct HA API surfaces

1. **Cataloged REST:** `RestGateway.ROUTES` in [`rest_api.py`](../src/ha_safe_mcp/rest_api.py) matches the *entire* path and method, then checks the route's `read`, `write`, `admin` or `delete` class. `ha_rest_catalog` reports this implemented catalog, not live discovery of all HA routes. `ha_rest_query` accepts cataloged GETs and two explicitly selected POSTs (`/api/template`, `/api/config/core/check_config`); the adapter classifies those POSTs as read, **not** as proof of side-effect freedom or non-admin HA access. `ha_rest_write` handles cataloged POSTs and `ha_rest_delete` the cataloged state DELETE. Query keys are separately allowlisted; history requires `filter_entity_id`, calendars require `start` and `end`. Bodies must be small JSON objects. Service POSTs go through `HAClient.call_service`, rather than becoming generic HTTP forwarding. Other REST responses are capped *after receipt* and image bodies are returned as base64. The ordinary `HAClient._request` path has different timeouts and no equivalent response-size cap.
2. **Typed HA configuration HTTP:** [`HAAdmin`](../src/ha_safe_mcp/management.py) uses `/api/config/automation/config/{config_id}` for automation GET/POST/DELETE; [`HAScenes`](../src/ha_safe_mcp/scenes.py) uses scene/script config routes; [`HAIntegrations`](../src/ha_safe_mcp/integrations.py) uses config-entry flow, options, reconfigure and reload routes. These are *not* automatically exposed by the generic REST catalog. IDs and inputs are validated within their respective typed operations, with selected post-write reads. A REST state POST modifies runtime state, not a persisted integration or device configuration.
3. **Typed HA WebSocket:** [`management.py`](../src/ha_safe_mcp/management.py) defines `READ_TYPES`, `WRITE_TYPES` and `DELETE_TYPES`. The transport rejects unlisted command types, reserved payload fields (`id`, `type`, `access_token`) and oversized payloads, before connecting. It authenticates, sends one command with a matching ID and reduces error detail to a safe code. Typed callers use this for automation validation, Lovelace, helpers, registries, config-entry settings and backups. There is no general-purpose MCP WS-command tool. A transport-allowlisted type is not necessarily published as an MCP tool. WS and config HTTP command availability/semantics can vary by HA Core version.

## Authorization and residual risk

Server permissions are cumulative: `HA_ALLOW_WRITE=true` permits a constrained service call and routes classed `write`; `HA_ALLOW_ADMIN_WRITE=true` **in addition** permits administrative mutations; `HA_ALLOW_DELETE=true` **in addition to both** permits deletes. All default to false. `HA_ALLOWED_DOMAINS` restricts service calls, including REST service POSTs, not every administrative mutation. Service targets must match the service domain and may be one entity or a bounded list; alternate top-level `entity_id`, `area_id` and `device_id` keys in `service_data` are rejected. This does not deeply validate all service-specific nested values. HA user permissions still apply, and some adapter-`read` calls may require HA admin rights.

Approval is a **client-side extra layer**, not part of the MCP server. The Ollama CLI exposes write tools only with `--allow-write` and asks for a per-call terminal confirmation. The web UI requires chat write mode as well as saved server switches; normally each proposed write waits for a one-time browser approval. Its explicit `HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE` and `HA_AUTO_DELETE` settings can bypass approval cards for enabled levels; the matching allow switch must also be on. `--read-only`/`--max-level` cap what UI settings can enable. Another MCP client can call any registered tool directly, subject only to server/HA gates; do not assume a universal confirmation dialog. Tool classification should be revisited when adding calls, particularly read-class POSTs and `ha_rest_write` routes classified by the catalog.

Limits of the protections:

- A model can misinterpret or be influenced by HA attributes, logs, templates or tool output. A system prompt says these are data, but prompt injection is not eliminated. Review proposed write payloads and run read-only when possible.
- `HA_URL` validation requires a root HTTP(S) URL without embedded credentials, query or fragment; it is **not** a destination allowlist. A misconfigured URL can send the HA Bearer token to another host. Protect transport, DNS, token scope and the Ollama endpoint. HTTPS certificate verification is not intentionally disabled for HTTP clients.
- Service-domain checks do not sandbox HA services, scripts, automations, templates, events or intents. Configuration writes can have substantial downstream effects even if an HTTP response succeeds.
- Selected management writes validate first and read back afterward, but the checks vary by operation and are not transactions, device-action proofs or automatic rollback. A failed read-back or timeout may happen *after* a mutation. Inspect HA state before retrying.
- This is not multi-user isolation or a general request rate limiter. A local process with access to stdio and the configured token can use the permitted tool surface.

## Local persistence and sensitive data

- [`SettingsStore`](../src/ha_safe_mcp/config_store.py) reads/writes a selected local `.env`; UI writes replace it atomically with mode `0600`, preserve unrelated lines and omit the token from status responses. It keeps an existing token for a blank UI token field only when the HA URL is unchanged. Separately, server `main()` loads only the process's **current-directory** `.env` (`Path.cwd() / ".env"`), never traversing parents; pre-existing environment variables take precedence with default dotenv behavior. The UI passes saved HA settings explicitly to its stdio child. Do not commit `.env`, put tokens in chat, or expose the UI settings route to untrusted callers.
- [`CredentialStore`](../src/ha_safe_mcp/credentials.py) defaults to an XDG configuration directory outside the repository, with a `0700` credential directory and `0600` key/data files. Values are Fernet-encrypted at rest; **the key is stored beside the ciphertext**, so this is not a defense against someone with the same user's filesystem access. Public listing returns aliases, labels and field names, not secret values. In integration flow fields whose names look secret, [`integrations.py`](../src/ha_safe_mcp/integrations.py) requires `{"$credential":"<alias>","field":"<field>"}` references, resolves them immediately before the HA request and scrubs used values from reduced results. Backup passwords also require references. These are field-name heuristics and top-level reference handling, not an exhaustive secret detector. The UI rejects some plaintext-secret chat patterns, not every possible secret.
- [`AuditLog`](../src/ha_safe_mcp/audit.py) records allowlisted metadata for MCP tool calls and HA HTTP/WS requests (tool, channel, method, route template or command type, status, duration, success and exception class), not prompts, arguments, tokens or response bodies. Certain technical route segments such as service domains and event types remain. Its default XDG state-directory files are JSONL by UTC day, with `0700` directory/`0600` files and a default 30-day purge on reads/writes. Server auditing is best effort and can be disabled with `HA_AUDIT=false`; a logging failure does not stop an HA call. The UI's audit endpoint uses its own `AuditLog` object and shares its directory with spawned MCP children.
- [`ChangeJournal`](../src/ha_safe_mcp/changes.py) stores, for each journaled configuration write, one JSON file
  (`<UTC timestamp with microseconds>-<random>.json`, strictly increasing so order survives same-instant writes) with
  tool, kind, target and the `before` state read immediately before the write; a failed write leaves no entry.
  Default directory is the XDG state directory (`changes/`), `HA_CHANGES_DIR` overrides it; the web UI passes its own
  directory to the stdio child so separate instances (e.g. dev and production) never share a journal. `0700`/`0600`,
  30-day and 1000-entry pruning. `Changes.undo` restores `before` via the normal typed operations (so all permission
  gates and read-backs apply), journals the undo with `undoes`, marks the original `undone_by`, refuses an undo when
  newer non-undone changes to the same target exist (field-level kinds only when fields overlap; undo entries of
  even newer changes do not count) unless `force` is set. Scope: automations, scripts, scenes, dashboard metadata and
  views, storage helpers, areas, floors, device and entity registry fields, integration title/system options/disabled
  state. Not journaled: service calls, integration add/remove, options/reconfigure flows, backups, generic REST
  writes. The journal holds configuration content, not secrets; it is not a backup of HA.
- [`FileStore`](../src/ha_safe_mcp/files.py) saves web-chat-generated plans and fenced code blocks as text under XDG data storage in `plan`/`script` subdirectories. Names/extensions and sizes are restricted, directory/file modes are `0700`/`0600`, and symlinks in the store are rejected. Stored scripts are **not executed** or sent to HA. The file manager is a web feature, not a generic MCP filesystem tool. Browser chat history lives in frontend storage; do not put credentials into it.

## Remote MCP endpoint

`create_app` returns `McpRouter`: requests to `/mcp` and `/mcp/...` go to the MCP gateway, everything else to the UI
behind `LocalOnlyGuard`. The router does its own Host and loopback-peer check and requires `Authorization: Bearer hsm_...`; it does **not** require the Access JWT, so a proxy bypass for `/mcp`
is enough. [`ClientStore`](../src/ha_safe_mcp/remote.py) keeps clients in the XDG config directory
(`clients/clients.json`, `0700`/`0600`) with the SHA-256 of the token (256-bit random, shown once).

The gateway is a low-level MCP `Server` served by the SDK's `StreamableHTTPSessionManager` in stateless JSON mode.
For each call it reads the authenticated client from the request scope, computes the effective environment
(`effective_env`: instance settings capped by the client level read < control < admin < delete, domains
intersected, `HA_AUDIT_CLIENT` set) and forwards to that client's own stdio child of the normal server
(`ChildPool`; restarted when the effective environment changes, stopped after 15 minutes idle). So every server-side
gate, read-back, credential-reference rule, audit record and change-journal entry applies unchanged. The gateway
lists only tools the client level may use (`tool_level`; unclassified tools are never exposed), refuses others, and
sets `readOnlyHint`/`destructiveHint`; the stdio server sets the same annotations. Undo is visible from level admin;
the child's delete gate decides when an undo would remove something.

### OAuth

`McpRouter` also serves, without the UI login, the discovery documents (`/.well-known/oauth-protected-resource`
and `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`; issuer = public
origin) and `/mcp/oauth/register` and `/mcp/oauth/token`, with permissive CORS (bearer tokens, no cookies). The 401
on `/mcp` carries `resource_metadata`. [`OAuthServer`](../src/ha_safe_mcp/oauth.py) keeps registrations in
`clients/oauth_clients.json` (redirect URIs https or loopback http only, no fragments; optional client secret stored
as SHA-256; at most 200, oldest unused dropped first). The consent page `/oauth/authorize` is a static UI page behind
`LocalOnlyGuard`; it calls `/api/oauth/check|approve|deny` (UI header + Origin), and the server re-validates client,
exact redirect URI, `response_type=code`, PKCE S256 and `resource` on every call. Codes are single-use, in memory,
valid 10 minutes, bound to client, redirect URI and challenge. The token endpoint verifies the client (none,
`client_secret_post`, `client_secret_basic`) and PKCE, then `ClientStore.issue_oauth` creates or replaces one
profile per OAuth client with a 1-hour access token and a rotating 60-day refresh token (both stored as SHA-256).

## Web exposure model

[`web.py`](../src/ha_safe_mcp/web.py) defaults to a loopback bind and rejects non-loopback peers and unrecognized Host headers. Mutating HTTP requests must supply `X-HA-MCP-UI: 1`; if an `Origin` header is present it must match the expected origin. Response headers include CSP, frame denial, `nosniff`, no-referrer and no-store; JSON request bodies and chat message lengths are bounded. Static frontend assets are bundled; the UI is not a standalone authenticated service in its default local mode. Treat every process able to access the loopback UI as trusted. `--allow-remote` explicitly relaxes peer/Host restrictions and does **not** introduce login; only use it behind authentication you administer, or preferably keep the origin bound to loopback.

Optional [`--public-host`](../src/ha_safe_mcp/web.py) keeps the UI loopback-bound, restricts the Host to the configured HTTPS public hostname and requires `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`; it cannot be combined with `--allow-remote`. The [`AccessTokenVerifier`](../src/ha_safe_mcp/access_auth.py) checks the `Cf-Access-Jwt-Assertion` with Cloudflare Access JWKS, RS256, issuer, audience, issued-at and expiry. Missing or invalid assertions are rejected before routes execute. You must separately configure a secure tunnel and Access policy for your own domain, protect the origin, and test the real ingress path. This is not a generic OIDC login implementation and does not make arbitrary remote binding safe. The non-public loopback mode does not require Access assertions.

## Tests, verification and limitations

The [`tests/`](../tests/) suite uses pytest, mocked HA HTTP (`respx`), WS doubles/test transport and Starlette ASGI requests. It covers permission defaults, route/query/target rejection, WS authentication and command allowlists, management read-backs, integration credential handling, audit/file stores, CLI tool selection and approvals, chat lifecycle, UI setup and guard behavior, and backup behavior. To run the non-live suite from the package directory with the test extra installed:

```sh
python -m pytest -q
```

[`tests/mock_ha.py`](../tests/mock_ha.py) is a small REST test double; [`tests/docker_smoke.py`](../tests/docker_smoke.py) exercises MCP stdio through Docker against that double, not full HA management semantics. [`tests/ha_core_smoke.py`](../tests/ha_core_smoke.py) is an **opt-in destructive** integration script: it onboards an HA instance and mutates configuration. Run it *only* against a fresh, isolated, disposable HA Core instance you control, never an existing or production HA. Neither the unit tests nor a passing test-double smoke test establish compatibility with every HA Core release, integration-specific flow, physical device, browser ingress, or network policy. This document does not claim that those optional smoke tests ran for a particular installation.

## Extending the adapter

1. Identify the HA surface and version: cataloged REST, a specific configuration HTTP operation, or a typed WS command. Check HA authorization and whether a nominally read operation can have effects. Do not add a raw URL or arbitrary WS proxy.
2. Add a narrow method/path/query/body or WS type allowlist and typed wrapper in the appropriate component. Validate identifiers, targets, reserved fields and size limits **before** network I/O. Apply the cumulative server gates, keep the HA token out of errors/results, and reduce sensitive response fields. For a write, define the postcondition to check; document that it is not a transaction.
3. Register a tool in [`server.py`](../src/ha_safe_mcp/server.py) only after defining its permission class. Update [`ollama_client.py`](../src/ha_safe_mcp/ollama_client.py) read/write sets, topic selection and control/delete level classification as applicable; otherwise the model client may omit it or mis-handle approvals. Review web auto-approval implications.
4. Add positive and negative tests alongside the relevant [`tests/`](../tests/) modules: denied gates, malformed method/path/payload, no I/O on local rejection, safe errors, HA response variants and post-write read-back. Test tool registration and model/UI approval routing too. Run pytest locally; for version-dependent behavior use a **disposable** HA Core, not a live installation.
5. Update [TOOLS.md](TOOLS.md) through its generator [`scripts/gen_tool_reference.py`](../scripts/gen_tool_reference.py), plus this document and [USER_GUIDE.md](USER_GUIDE.md) when user-visible behavior changes. Keep setup guidance in [INSTALL.md](INSTALL.md); avoid installation-specific URLs, devices, IDs or secrets in community documentation.
