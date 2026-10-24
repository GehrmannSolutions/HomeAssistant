# User guide: use ha-safe-mcp with your Home Assistant

This guide is for an installation you own or administer. Start with reads, discover IDs from **your** Home Assistant (HA), and approve changes only after checking the exact target. All entity names, IDs, area names and configuration payloads below are **illustrative placeholders**, not claims that these objects exist on your system. Do not copy a write example into a live home without replacing and checking every target.

For installation and prerequisites see [INSTALL.md](INSTALL.md); for architecture and security boundaries see [TECHNICAL.md](TECHNICAL.md); for the complete current tool signatures see [TOOLS.md](TOOLS.md); for the project overview see [README.md](../README.md). The web UI currently uses **German labels**; this English guide gives those labels in parentheses so you can find them.

## 1. Connect safely

1. In HA, finish onboarding and create a **Long-Lived Access Token** in your user profile under **Security → Long-lived access tokens**. Use an account with only the HA permissions needed; configuration operations normally require an HA administrator. The token inherits that account's HA permissions. Keep it out of chats, screenshots, client configuration shared with others, and version control. Revoke and replace it in HA if exposed.
2. Install this package as described in [INSTALL.md](INSTALL.md). From the `ha-safe-mcp` project directory, the installed commands are `ha-mcp-ui`, `ha-safe-mcp`, and `ha-ollama-chat`. Use Python 3.11 or newer. If configuring without the UI, copy `.env.example` to a **private** `.env` in that directory, set `HA_URL` to your HA root URL and `HA_TOKEN` to your actual token, and keep `HA_ALLOW_WRITE=false`, `HA_ALLOW_ADMIN_WRITE=false`, `HA_ALLOW_DELETE=false` initially. Make the file readable only by your user (`chmod 600 .env`). The example token in `.env.example` is not usable. A nonlocal HA URL should use HTTPS with normal certificate verification; for documentation examples use `https://ha.example.com`, replacing it with your own trusted HA address.
3. The MCP connection is **stdio** (a local child process), not an HTTP MCP endpoint. The web UI is a separate local browser application. Do not expose either the UI or a stdio bridge to the network without an appropriate authentication design. The UI binds to loopback by default and refuses non-loopback binding unless explicitly overridden; a direct remote UI has no built-in user login.

### First-run browser setup

Run `ha-mcp-ui` from the installed environment (for example `.venv/bin/ha-mcp-ui`) and visit `http://localhost:8765/` on the same computer. The wizard (**Ersteinrichtung**) has four stages:

1. **Home Assistant:** enter its root URL and token; click **Verbindung prüfen**. This tests the connection before saving and displays HA and token-user information. Do not paste a token into the chat.
2. **Lokales Modell:** supply your Ollama URL, load installed models (**Modelle laden**) and choose one that supports tools. The configured model is for the UI chat, not a requirement for a generic MCP client.
3. **Sicherheit:** begin read-only. **Steuern erlauben** allows control; **Konfiguration ändern erlauben** also requires control and an HA admin token; **Löschen erlauben** also requires configuration access. Limit **Erlaubte Domains für Steuerbefehle** to domains you intend to control.
4. **Fertig:** settings are saved to the project's `.env` with mode 0600. The UI does not display the saved token again. Open **Einstellungen** later to change settings; leaving the token field empty retains it only if the HA URL is unchanged. Saving tests HA again. UI chats use new settings on their next request; separately running MCP clients must be restarted after `.env` changes.

On the **Übersicht** overview, inspect HA connectivity and permissions. **Chat** and the floating chat bubble share a browser conversation; **Neu** clears it, **Stopp** cancels a running request. The UI can process only one active chat request at a time. If you need a hard ceiling for a separate installation, start the UI with `--read-only` (equivalent to `--max-level read`), or `--max-level control` to forbid admin changes and deletion even when an env file asks for them. Keep separate env files and XDG directories if operating separate instances. These flags cap this UI's child MCP process; they do not change a separately launched MCP server or HA account permissions.

### Connect another MCP client

Configure a client that supports local stdio servers to launch the installed `ha-safe-mcp` command, with its working directory set to the `ha-safe-mcp` directory containing `.env`. Adapt the syntax to your client's actual configuration format:

```json
{
  "mcpServers": {
    "home-assistant": {
      "command": "/absolute/path/to/ha-safe-mcp/.venv/bin/ha-safe-mcp",
      "cwd": "/absolute/path/to/ha-safe-mcp"
    }
  }
}
```

The stdio server loads **only** `.env` in its current working directory (`Path.cwd() / ".env"); it does not search parent directories. If the client does not support `cwd`, arrange for the required `HA_...` settings to reach its process securely instead; do not publish a client config containing a token. Existing process environment variables take precedence over values loaded from that `.env`. Restart the client after a settings change. First call `ha_rest_catalog` with `{}` (local catalog), then `ha_rest_query` with `{"path":"/api/"}` to actually check HA access. `ha_search_entities` with `{"limit":10}` can be empty even when a new HA instance is healthy. Your MCP client may show all tools even in read-only mode; the server checks permissions **at call time**. A generic MCP client does not inherit this UI's approval cards: configure its own human approval policy for writes.

### Connect a remote client over HTTP (Claude Code, Codex, ChatGPT, Claude)

The web UI also serves the MCP endpoint `/mcp` (Streamable HTTP), e.g. `http://localhost:8765/mcp` or, behind a
reverse proxy, `https://<your-host>/mcp`.

1. Open **MCP-Clients** in the UI, enter a name, pick a level (**Nur lesen**, **Steuern**, **Konfiguration ändern**,
   **Löschen**) and optionally a domain list, then **Client anlegen**. The token (`hsm_…`) is shown **once**; the UI
   prints ready-made commands:
   - Claude Code: `claude mcp add --transport http ha-safe-mcp <endpoint> --header "Authorization: Bearer <token>"`
   - Codex: `export HA_SAFE_MCP_TOKEN='<token>'` and
     `codex mcp add ha-safe-mcp --url <endpoint> --bearer-token-env-var HA_SAFE_MCP_TOKEN`
   - other clients: the endpoint URL plus the header `Authorization: Bearer <token>`.
2. The client's level is **capped by the instance switches** in **Einstellungen** (shown as "Wirksam"). The domain
   list narrows the instance's allowed domains further. Tools above the client's level are not even listed for it.
3. Change a client's level in the table at any time; **Entfernen** revokes its token immediately.

Notes:

- Requests without a valid token get HTTP 401 with a pointer to the OAuth discovery document.
- Foreign clients do not show this UI's approval cards and ignore the "ohne Freigabe" switches; whether they ask
  before acting is up to the client (tools carry `readOnlyHint`/`destructiveHint` so clients can ask before writes).
  Give each client only the level it needs.
- Every client gets its own MCP server process with its capped rights; its tool calls appear in **Protokoll** with
  the client's random ID and its configuration changes in **Änderungen**, like chat actions.
- Device names and states go to the provider of the AI client you connect.
- **Behind Cloudflare Access** (or another login proxy): the proxy's browser login cannot be completed by MCP
  clients. Add a bypass for exactly the paths `/mcp` and `/.well-known/oauth-*` (Cloudflare: a self-hosted
  application for `<host>/mcp` and `<host>/.well-known/oauth-*` with a *Bypass* policy). The UI and the OAuth
  consent page `/oauth/authorize` stay behind the login; `/mcp` is protected by the tokens.

### Connect with OAuth (ChatGPT and Claude web connectors, or any client that supports OAuth)

In the client, add a custom MCP server / connector with the URL `https://<your-host>/mcp` and choose OAuth (no
client ID or secret needed: the client registers itself). The client then opens the consent page
`/oauth/authorize` in your browser, behind your UI login. It shows the client's name and where you will be sent
back; pick the level and optional domains and press **Freigeben** (or **Ablehnen**).

- The grant becomes an entry of kind OAuth in **MCP-Clients**, capped by the instance switches like any token
  client. Authorizing the same client again replaces its level and tokens. **Entfernen** revokes it.
- Access tokens last one hour; the client refreshes them with a rotating refresh token (60 days).
- Technically: OAuth 2.1 with dynamic client registration and mandatory PKCE (S256); discovery documents at
  `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`; token and
  registration endpoints at `/mcp/oauth/token` and `/mcp/oauth/register`.

### Ask a local Ollama model from the command line

Install and start Ollama separately and download a **tool-capable** model. The CLI defaults to `qwen2.5-coder:7b` and the loopback Ollama service; override with `--model` and `--ollama-url` if needed. From the project directory, after setting up `.env`:

```sh
ollama pull qwen2.5-coder:7b
.venv/bin/ha-ollama-chat 'Use ha_search_entities to find available lights; report only IDs actually found.'
```

The CLI exposes read tools by default. For a deliberate write, enable the matching server permission first and run `ha-ollama-chat --allow-write '...'`. It prints the proposed tool name and **full JSON arguments** and requires the exact input `JA` **for each write call**. Anything else declines it. Never enter `JA` until you have checked the entity ID, service and payload; there is no dry run. `--allow-write` alone cannot bypass disabled server permissions. The model selects a limited set of tools by prompt keywords and explicit tool names, and has a bounded number of tool rounds: if it misses a tool, name that tool directly or use a full MCP client. The CLI's prompts/approval text, like the UI, may currently be German.

## 2. Understand permissions and approvals

| Task | Server settings required | HA account / extra checks |
|---|---|---|
| Read current states, areas, configuration, tool catalog | None of the write switches | HA still enforces endpoint permissions; some read endpoints (notably backups and some integration data) require an admin in HA. |
| Control an allowed entity (`ha_call_service`, scene activation, script run) | `HA_ALLOW_WRITE=true` | Target domain in `HA_ALLOWED_DOMAINS`; HA action must exist. |
| Create/change automations, dashboards, helpers, areas, integrations, backups; admin REST operations | `HA_ALLOW_WRITE=true` **and** `HA_ALLOW_ADMIN_WRITE=true` | HA administrator token. |
| Delete supported objects | All above **and** `HA_ALLOW_DELETE=true` | HA administrator token; choose an ID returned by a list/read tool. |

Default write and auto flags are all `false`. The default control-domain list is `light,switch,fan,climate,cover,media_player`; it is **not** a global restriction on what an automation or script may subsequently do. A service call accepts one entity ID or a list of at most 20 same-domain entity IDs, with no alternative `area_id`/`device_id` targets in `service_data`. A room can be resolved first with `ha_list_area_entities` instead of passing a room directly to the action. `scene` and `script` must be deliberately added to the domain list before their activation tools work; a script can itself invoke actions outside that list. Use especially narrow permissions for `switch`, `script` and any domain controlling sensitive equipment.

In **Chat**, enabling **Steuern erlauben** in settings is not enough: tick **Aktionen erlauben** under the message box for that request. By default every proposed write shows a **Freigabe erforderlich** card with tool name and JSON arguments. **Ausführen** approves *this call once*; **Ablehnen** rejects it. Unanswered cards expire after 120 seconds; **Stopp** rejects pending approvals. Multiple write calls require multiple decisions.

Under **Einstellungen**, each level has a separate **ohne Freigabe ausführen** switch (`HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE` in `.env`). This is **auto-execution**, not a broader permission: the matching allow switch, the chat's **Aktionen erlauben** checkbox, the UI ceiling and the server/HA checks still apply, but the approval card for that level is skipped. Executed calls remain visible in chat and the metadata audit log. Keep auto switches off unless you intentionally accept model-initiated actions without reviewing each payload. The UI classifies `ha_rest_write` as an admin-level tool for auto-approval even when its specific REST route is control-level; the server still gates each route by its catalog permission. CLI `JA` and approval mechanisms in other MCP clients are **independent** of the UI auto switches; these auto flags are not server authorization flags. Review the [tool reference](TOOLS.md) and use `ha_rest_catalog` for route-specific permissions.

### Two layers of permissions: server level and client settings

A remote client is limited twice:

1. **Server side (binding):** the client's level in **MCP-Clients** (or chosen on the consent page), capped by the
   instance switches. Tools above the level are not even listed for the client. Number of tools a client sees:

   | Level | Tools listed | marked read-only | marked write/delete |
   |---|---|---|---|
   | Nur lesen | 26 | 26 | 0 |
   | Steuern | 29 | 26 | 3 |
   | Konfiguration ändern | 56 | 26 | 30 |
   | Löschen | 66 | 26 | 40 |

2. **Client side (additional):** many clients let you allow, confirm or block tools. They group them by the hints
   this server sends (`readOnlyHint`, `destructiveHint`). Example, Claude → Settings → Connectors → the connector →
   *Tool permissions*: a client with level **Konfiguration ändern** shows "read-only tools (26)" and "write/delete
   tools (30)"; setting the first to *Always allow* and the second to *Blocked* makes Claude read only.

The client setting only protects that client. Anyone else holding the same token is limited by the server level
alone, so set the server level to what the client really needs and use the client settings as an extra layer (or
to require a confirmation, e.g. *Ask* instead of *Blocked*).

### Domains: what the allowed list means and how to choose it

A **domain** is the part of an entity ID before the dot: `light` in `light.living_room`, `lock` in
`lock.front_door`. The allowed-domain list (`HA_ALLOWED_DOMAINS`, **Einstellungen → Erlaubte Domains für
Steuerbefehle**) decides which entities the control tools may target: `ha_call_service`, `ha_activate_scene`
(needs `scene`) and `ha_run_script` (needs `script`). It does **not** limit configuration changes: an automation
saved with "Konfiguration ändern" may still act on any entity when it runs.

- Any Home Assistant domain can be entered (lowercase, e.g. `light`). Which ones exist depends on the
  integrations of *your* HA. The default is `light, switch, fan, climate, cover, media_player`.
- **Find them:** in **Einstellungen**, **MCP-Clients** and on the OAuth consent page the UI lists the domains your
  HA actually has, with the number of entities, as clickable chips (the text field stays editable and is the value
  that is saved). In a chat or MCP client, `ha_list_services` lists the domains that offer actions.
- Clients (token or OAuth) can only **narrow** the instance list: their picker shows only the allowed domains, and
  an empty choice means "all allowed domains".
- Domains without actions (`sensor`, `binary_sensor`, `event`, `sun`, ...) are read-only anyway; reading never
  needs an allowed domain.

Domains marked ⚠ in the UI have physical or security consequences; allow them only on purpose, and preferably not
together with "ohne Freigabe" or for foreign clients:

| Domain | What its actions do |
|---|---|
| `lock` | opens doors |
| `alarm_control_panel` | arms or disarms the alarm system |
| `cover` | opens and closes covers, gates and garage doors |
| `valve` | opens and closes water or gas valves |
| `siren` | triggers sirens |
| `update` | installs firmware and software updates |
| `button` | presses device buttons, e.g. restart or factory reset |
| `camera` | switches cameras and recordings |
| `notify` | sends messages |
| `script`, `automation` | start scripts / switch or trigger automations, which can contain any action |

Also consider what hides behind `switch`: besides lamps and plugs, integrations expose device settings as switches
(e.g. camera privacy modes or recording), so check the entity list before allowing it broadly.

## 3. Common workflows (read → decide → approve → verify)

The JSON blocks below are **MCP tool arguments**, not HTTP commands. Names such as `light.example_lamp`, `office`, `test-views`, `example_scene`, and `sample_automation` are fictional stand-ins. **Replace them with IDs actually discovered on your installation.** For existing configuration, save a copy of the read result and consider an HA backup before approving a change. After every write, read the target back; a successful MCP response does not prove a physical device acted or an asynchronous HA reload finished.

### Find an entity, inspect a room, control lights

- `ha_search_entities` `{"domain":"light","limit":20}` finds current IDs and states; `ha_get_state` `{"entity_id":"light.example_lamp"}` applies **only if that exact ID was returned**. `ha_list_services` `{"domain":"light"}` shows actions available in HA.
- `ha_list_areas` `{}` lists actual room names and IDs. `ha_list_area_entities` `{"area":"office","domain":"light"}` accepts a real area ID, name or alias. Read its `available`, `unavailable`, and `groups` fields. If the room name is ambiguous, resolve it before continuing.
- After enabling control and reviewing targets, `ha_call_service` `{"domain":"light","service":"turn_on","entity_id":"light.example_lamp","service_data":{}}` operates on the chosen light. For several available lights use `"entity_id":["light.example_lamp","light.example_second_lamp"]` after checking **both** returned IDs and the 20-target limit. Do not also target a group whose member lights you are calling individually. Re-read states afterward.
- To organize a room, `ha_create_area` `{"name":"Example Office"}` returns a new `area_id`; `ha_list_devices` `{"area_id":"none"}` shows unassigned devices. Use the actual `device_id` and actual `area_id` in `ha_update_device` `{"device_id":"<device_id from ha_list_devices>","changes":{"area_id":"<area_id from ha_create_area>"}}`. These are admin changes. `ha_create_floor` / `ha_update_area` can assign an area to a floor. `ha_update_entity_registry` can change only an existing entity's `name`, `area_id`, or `icon`; it does **not** create an entity.

### Edit an automation

Use `ha_get_automation` `{"config_id":"<existing configuration ID>"}` before editing an existing automation; its `config_id` is **not** the `automation.*` entity ID. For a new one, choose an unused config ID and build a complete config with an `alias`; `id` must not appear inside `config`. Validate first:

```json
{"config":{"alias":"Example test automation","triggers":[{"trigger":"state","entity_id":"input_boolean.example_flag","to":"on"}],"conditions":[],"actions":[]}}
```

Supply this to `ha_validate_automation` only after confirming that the trigger entity exists and reviewing HA's validation result. To commit, pass the same config and `{"config_id":"sample_automation"}` to `ha_save_automation` (admin write), then `ha_get_automation` to check the stored result. The example's empty actions are intentional; an automation with real actions needs a review of what those actions can control. Saving triggers an asynchronous HA reload; check HA itself before relying on the automation. `ha_delete_automation` requires delete permission and the config ID.

### Create a dashboard or helper

- `ha_list_dashboards` `{}` → `ha_get_dashboard` `{"url_path":"<existing URL path>"}` to copy existing storage dashboard views. Create a new storage dashboard with `ha_create_dashboard` `{"title":"Example test views","url_path":"test-views"}`; then save `ha_save_dashboard` `{"url_path":"test-views","config":{"views":[{"title":"Test","path":"test","cards":[]}]}}`. `url_path` must be hyphenated; `ha_update_dashboard` and `ha_delete_dashboard` instead need the **collection `id`** from `ha_list_dashboards`. Saving replaces the views; the tool returns `previous` for **manual** rollback, not an automatic recovery. Avoid using the default dashboard for a first test.
- `ha_list_helpers` `{"domain":"input_boolean"}` → `ha_create_helper` `{"domain":"input_boolean","config":{"name":"Example test flag"}}` → list again. Supported storage domains: `input_boolean`, `input_number`, `input_select`, `input_text`, `input_datetime`. `ha_update_helper` uses the returned **collection `id`** as `helper_id`, not an assumed entity ID, and requires a full config including `name`; preserve other important existing fields. `input_number` needs `min`/`max`, `input_select` nonempty `options`, `input_datetime` `has_date` or `has_time`. Do not send `id`, `entity_id`, or `type` inside helper `config`.

### Save and run a scene or script

Inspect `ha_list_scenes` / `ha_get_scene` and `ha_list_scripts` / `ha_get_script` before replacing a UI-editable item. Example **only after discovering `light.example_lamp`**:

```json
{"scene_id":"example_scene","config":{"name":"Example scene","entities":{"light.example_lamp":{"state":"on","brightness":100}}}}
```

Pass this to `ha_save_scene` with admin write; it validates target entities, stores the UI scene and returns `previous` for manual rollback. A separate `ha_activate_scene` needs the real `scene.*` entity ID, control permission and `scene` in allowed domains. Similarly, `ha_save_script` can take `{"script_id":"example_script","config":{"alias":"Example script","sequence":[{"action":"light.turn_off","target":{"entity_id":"light.example_lamp"}}],"mode":"single"}}`; review the action and verify the entity/service first. `ha_run_script` needs the real `script.*` ID and `script` on the control allowlist. Script/scene save and run are **different** permissions; running can actuate devices. These edit UI-backed configs, not arbitrary YAML packages. Delete tools require delete permission.

### Add or change an integration using credential references

1. `ha_list_integration_types` `{"query":"<integration domain>"}` checks available UI setup handlers; `ha_list_discovered` `{}` shows what **HA itself** discovered, not a network scan by this MCP. `ha_list_integrations` `{}` shows existing `entry_id`s and support flags.
2. If a form needs a password/token/PIN, use the UI's **Zugangsdaten** tab to save it under a local alias such as `example_device_login`; `ha_list_credentials` shows alias and field names, **not values**. Never place a secret in a chat, approval payload, tool argument, issue, or example command. Secret form fields accept a reference like `{"$credential":"example_device_login","field":"password"}` instead of plaintext. The local server resolves it immediately before sending it to HA. In an illustrative form step, `{"flow_id":"<flow_id from previous result>","data":{"password":{"$credential":"example_device_login","field":"password"}}}` is valid **only if** the returned schema actually has a `password` field; other forms differ.
3. `ha_start_integration_setup` uses a handler returned by the types list and returns a form and `flow_id`; submit only fields from its `data_schema` using `ha_integration_setup_step`. Abort an unfinished flow with `ha_abort_integration_setup`. These are admin writes, including abort. For an existing entry, `ha_start_integration_options` / `ha_integration_options_step` use an `entry_id` with `supports_options`; omit unchanged fields with shown `current` values. For `supports_reconfigure`, use `ha_start_integration_reconfigure` followed by setup steps. `ha_update_integration` can rename or change polling/new-entity preferences; `ha_set_integration_disabled` toggles availability, and `ha_reload_integration` reloads. Confirm with `ha_list_integrations`. `ha_delete_integration` is a consequential delete: it can remove its devices and entities.

### Undo a configuration change

Every configuration change made through this MCP keeps the previous state locally: automations, scripts, scenes,
dashboards (metadata and views), helpers, areas, floors, device and entity registry fields, and integration
title/system options/disabled state. Each such tool result carries a `change_id`.

- `ha_list_changes` `{}` lists recent changes (newest first, kept 30 days); `ha_get_change` shows the stored previous
  state (`before`; `null` means the item did not exist).
- `ha_undo_change` `{"change_id":"<id>"}` writes the previous state back: it removes a created item, recreates a
  deleted one (areas, floors and helpers get a new ID) and resets changed fields. The undo is itself journaled, so
  undoing the undo re-applies the change.
- If the same item was changed again later, undo refuses and names the newer changes. Undo newest first, or pass
  `"force":true` only when you really want to discard the later changes.
- In the UI, the **Änderungen** tab lists the same journal with a **Rückgängig** button per entry. In the chat, ask
  e.g. "Mach die letzte Änderung rückgängig".
- Undo needs **Konfiguration ändern**; when it removes something it also needs **Löschen erlauben**. In the UI chat,
  an undo is treated like a delete for "ohne Freigabe": it always shows an approval card unless deletes may run
  without one.
- Not journaled: device control (service calls), adding or removing integrations, options/reconfigure dialogs,
  backups and generic REST writes. A dashboard without an earlier stored config (HA's auto-generated default) cannot
  be reset this way.

### Debug: why did something (not) happen?

All of these are read-only (some need an HA admin user, like the HA UI pages they mirror):

- **Automation or script runs:** `ha_list_traces` `{"domain":"automation","item":"automation.example"}` lists the
  recent runs with state, error and last step; `ha_get_trace` with a `run_id` shows each step (trigger,
  conditions, actions) with its result or error. `include_config:true` adds the configuration of that run.
- **What happened and why:** `ha_get_logbook` `{"entity_id":"light.example","hours":6}` (who or what changed it,
  e.g. which automation or service); `ha_get_history` `{"entity_ids":["sensor.example"],"hours":24}` for the state
  changes; `ha_get_statistics` (IDs from `ha_list_statistic_ids`) for long periods of numeric sensors, aggregated
  per `5minute`, `hour`, `day`, `week` or `month`.
- **Errors and health:** `ha_get_error_log` (filter by `level` or text, e.g. an integration name),
  `ha_list_repairs`, `ha_get_system_health`.
- **Try before saving:** `ha_render_template` renders a Jinja template against the live state;
  `ha_test_condition` evaluates an automation condition right now.

Times in these results are converted to the time zone configured in Home Assistant. Long results are cut to the
newest entries (`limit`, `max_points`).

### Back up before changing configuration

Use `ha_list_backups` `{}` (HA may require an administrator even for listing). With admin-write permission, `ha_create_backup` `{"name":"Before example change"}` asks HA for a full configuration-and-database backup on its local backup agent and waits for it to appear. If encryption is needed, add `"password":{"$credential":"example_backup_password","field":"password"}` after storing that field in **Zugangsdaten**. Confirm creation via `ha_list_backups`; if it reports the backup is still running, check again later rather than treating the response as completion. The UI **Backups** tab can list, create, download and—with delete permission—delete backups; a download streams from HA and is not retained by MCP. **Restore is not provided here**: use HA's own **Settings → System → Backups** workflow. `ha_delete_backup` uses a listed `backup_id` and is not a restore/rollback mechanism.

## 4. Pitfalls and troubleshooting

| Symptom or risk | What to check |
|---|---|
| `HA_TOKEN is required`, HTTP 401, or wrong HA target | Check the private `.env`, working directory, HA URL (root URL only), process-environment overrides and token. Revoke an exposed token; don't paste it into bug reports. `localhost` in a container/remote client refers to **that** container/computer. |
| HA 403 / WebSocket unauthorized | The HA user behind the token may lack administrator or endpoint permissions. MCP switches cannot grant HA rights. Some read tools, including backups, require HA admin rights. |
| `writes disabled`, `admin write disabled`, `delete disabled` | Enable only the specific tier required, then restart an external MCP process; in UI chat also tick **Aktionen erlauben**. Check `--read-only` / `--max-level` on the UI. |
| Approval did not appear, or action executed without one | Check the settings' **ohne Freigabe ausführen** at the correct level. It skips review when enabled; otherwise approve each payload within 120 seconds. UI auto settings do not affect CLI `JA` or your other MCP client's confirmation policy. |
| `domain not allowed`, wrong target, missing entity | Discover a current ID, match its domain to the service, check `HA_ALLOWED_DOMAINS`, and avoid alternate targets in `service_data`. No tool can infer that an invented ID really exists. |
| Room command targets the wrong things | Use `ha_list_area_entities` and its `available` array; don't call unavailable IDs or both a group and its members. Device area and an entity's own area can differ. |
| Automation/dashboard/helper rejected or changed unexpectedly | Compare configuration IDs, entity IDs, dashboard URL paths versus collection IDs, and full helper configs. Save the previous config, inspect HA validation, and read back. Config reload can lag. |
| Integration flow fails or secret is rejected | Follow the returned form schema/flow ID, use stored alias references for secret fields, and check the HA user's permissions. Discovery depends on **HA's** network, not this adapter's reachability. Abort abandoned flows. |
| REST call rejected | Run `ha_rest_catalog`; only cataloged method/path pairs and route-specific query keys are accepted. `ha_rest_query` allows GET and only the catalog's template/config-check POSTs. Even these can consume HA resources. `ha_rest_write` on `/api/states/<entity_id>` sets a temporary state, **not** a persistent helper or a physical device action. |
| UI unreachable or wrong model | Open the UI on the same machine via `http://localhost:8765/`; check its running process, Ollama service/model and UI **Einstellungen**. A foreign Host header is rejected. Do not use `--allow-remote` on an unauthenticated network. |
| Model gives a stale/unsupported answer | Ask it to use a named read tool to fetch the *current* state or start a new chat. Small Ollama models use keyword-based tool selection; a plausible answer is not verification. |

The REST gateway is an allowlisted subset, **not** an arbitrary HTTP or WebSocket proxy. It cannot edit arbitrary HA files, schedule/restore backups, or remove an individual device from the registry. The HA token still has its underlying HA authority outside this adapter. Prefer a separate less-privileged HA account for routine reads, backups before admin changes, and manual verification in HA after consequential writes.

## 5. Where data is stored

| Data | Default location | Retention / handling |
|---|---|---|
| HA settings and token | `.env` in the `ha-safe-mcp` project directory, or the UI's `--env-file` | UI writes mode 0600; keep the file out of version control. |
| Integration/backup credential aliases, encrypted values **and local encryption key** | `~/.config/ha-safe-mcp/credentials/` (or `XDG_CONFIG_HOME` equivalent) | Directory 0700, files 0600; values not returned to UI/model. The key sits next to the data: encryption is not protection against someone with access to your user account. Back up key and encrypted data **together** if you need to recover them. |
| Generated plans and fenced code blocks from UI chat | `~/.local/share/ha-safe-mcp/files/` (or `XDG_DATA_HOME` equivalent) | Local text files; **never automatically executed or sent to HA**. Review before using. Up to 256 KB per file and 500 files; delete via **Dateien**. |
| Change journal (previous state of configuration changes) | `~/.local/state/ha-safe-mcp/changes/` (or `XDG_STATE_HOME` equivalent; `HA_CHANGES_DIR` for a separately started server) | One JSON file per change, directory 0700, files 0600, 30 days and at most 1000 entries. Contains configuration (names, entity IDs, automation content), never tokens or credential values. |
| Audit metadata | `~/.local/state/ha-safe-mcp/audit/` (or `XDG_STATE_HOME` equivalent) | UTC time, tool, route template, status, duration/error class; no prompts, target entity IDs, payloads or tokens. 30-day retention with pruning on read/write; clear via **Protokoll**. Set `HA_AUDIT=false` for a separately started MCP server to disable its audit. |
| UI conversation | Browser `localStorage` | Shared by main chat and bubble; **Neu** clears it. Recent user/assistant text goes to the selected local Ollama model as context; don't type secrets or sensitive data into chat. |

The UI's **Dateien** and **Protokoll** delete controls affect MCP-local generated files/logs, not HA configuration or HA backups. Downloaded HA backup archives reside wherever **your browser** saves downloads. Protect local backups and the browser profile too.
