# Changelog

This project follows [Semantic Versioning](https://semver.org/) loosely; tool signatures can change before 1.0.
Historical entries below remain in German.

## 0.13.0 – 2026-10-24

- **OAuth 2.1 for the remote endpoint** (web connectors of ChatGPT, Claude and other OAuth clients): discovery
  documents under `/.well-known/oauth-*`, dynamic client registration and token endpoint under `/mcp/oauth/`,
  consent page `/oauth/authorize` behind the UI login (pick level and domains), mandatory PKCE S256, single-use
  codes, 1-hour access tokens with rotating 60-day refresh tokens. Grants appear as OAuth entries in
  **MCP-Clients** and are capped like token clients. The 401 on `/mcp` points to the discovery document; the
  endpoint no longer answers 404 when no client exists.

## 0.12.0 – 2026-10-24

- **Remote MCP endpoint** `/mcp` (Streamable HTTP) in the web UI process for Claude Code, Codex and other MCP
  clients: per-client bearer tokens (shown once, stored as SHA-256), level read/control/admin/delete plus optional
  domains, capped by the instance switches; each client runs its own stdio server with those rights, tools above
  its level are hidden. UI tab **MCP-Clients** with ready-made `claude mcp add` / `codex mcp add` commands.
  `/mcp` needs no Access JWT (add a proxy bypass for that path only); the UI stays behind Access.
- Tools carry `readOnlyHint`/`destructiveHint`; audit records of remote calls carry the client's random ID.
- Tab bar scrolls on narrow windows.

## 0.11.0 – 2026-10-24

- **Change journal and undo**: automations, scripts, scenes, dashboards (metadata and views), helpers, areas,
  floors, device/entity registry fields and integration settings keep their previous state locally before every
  change (30 days, `HA_CHANGES_DIR`). New tools `ha_list_changes`, `ha_get_change`, `ha_undo_change`; journaled
  tool results carry a `change_id`. Undo runs through the same permission gates, is journaled itself (redo), and
  refuses to overwrite newer changes unless `force=true`. UI tab **Änderungen** with a per-entry undo button. In the
  UI chat an undo counts as a delete for "ohne Freigabe".
- Moved the installable project, tests and Docker files into `ha-safe-mcp/`; added English community install,
  user and technical documentation, a generated tool reference and an MIT license at repository root.
- The stdio server now loads `.env` **only from its current working directory**, not from a parent directory;
  point MCP clients at the correct installation directory. Existing UI deployments with an explicit `--env-file`
  retain that path.
- Docker smoke test uses `docker` by default; set `DOCKER_COMMAND='sudo -n docker'` if needed.

## 0.10.0 – 2026-10-24

- **Ohne Freigabe pro Stufe**: neben „Steuern/Konfiguration ändern/Löschen erlauben“ (Freigabe-Karte je Aktion) je
  ein Schalter „ohne Freigabe ausführen“ (`HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE`). Solche Aktionen
  erscheinen als „Aktion ohne Freigabe“ im Chat und im Protokoll; das Chat-Häkchen bleibt Pflicht.
- **Mehrere Entitäten pro Aufruf**: `ha_call_service` nimmt eine Liste von bis zu 20 `entity_id` derselben Domain.
- **Räume**: neues Tool `ha_list_area_entities` (Name/Alias/ID, Geräte-Bereich wie in HA, verfügbare/nicht verfügbare
  Entitäten, Gruppen). Systemhinweis: Mehrzahl = alle verfügbaren Entitäten des Raums in einem Aufruf, ohne Rückfrage.

## 0.9.2 – 2026-10-24

- **`--max-level control`**: Zwischenstufe für Produktiv-Instanzen; nur „Steuern“ lässt sich einschalten,
  Konfiguration ändern und Löschen sind im Code gesperrt (`.env` wird ignoriert, Speichern abgelehnt, Schalter
  ausgegraut). `/api/status` meldet `max_level`. `--read-only` = `--max-level read`.

## 0.9.1 – 2026-10-24

- **Nur-lesen-Instanz**: `ha-mcp-ui --read-only` sperrt Steuern, Konfiguration und Löschen im Code (`.env`-Werte
  werden ignoriert, Speichern mit Schalter und Chat-Aktionen abgelehnt); Oberfläche zeigt „Nur lesen (fest)“ und
  graut die Schalter aus. Gedacht für eine zweite Oberfläche gegen die Produktiv-HA.

## 0.9.0 – 2026-10-24

- **Integrations-Einstellungen**: `ha_start_integration_options`, `ha_integration_options_step`,
  `ha_abort_integration_options`, `ha_start_integration_reconfigure`, `ha_update_integration`,
  `ha_set_integration_disabled`. `ha_list_integrations` zeigt `supports_options`, `supports_reconfigure` und die
  Systemoptionen.
- Formulare zeigen den aktuellen Wert (`current`); nicht gesendete Felder behält der MCP bei, weil HA sie sonst auf
  den Werkswert zurücksetzt. Geheime Felder zeigen nie einen Wert.

## 0.8.0 – 2026-10-24

- **Szenen und Skripte**: `ha_list_scenes`, `ha_get_scene`, `ha_save_scene`, `ha_delete_scene`,
  `ha_activate_scene`, `ha_list_scripts`, `ha_get_script`, `ha_save_script`, `ha_delete_script`, `ha_run_script`.
  Speichern nur mit existierenden Entitäten bzw. bekannten Diensten, HA-Validierung, Rücklesung und vorherige
  Fassung; Aktivieren/Starten nur mit `scene`/`script` in den erlaubten Domains.
- Ollama-Toolauswahl: eine genannte `input_boolean.…`-Entität bietet keine Helfer-Verwaltung mehr an.

## 0.7.0 – 2026-10-24

- **Bereiche, Etagen, Geräte**: `ha_list_areas`, `ha_list_floors`, `ha_list_devices` (ohne Seriennummern, MACs,
  Kennungen), `ha_create_area`, `ha_update_area`, `ha_delete_area`, `ha_create_floor`, `ha_update_floor`,
  `ha_delete_floor`, `ha_update_device` (Bereich, eigener Name, deaktivieren, Labels). Rücklesung jeder Änderung,
  referenzierte IDs werden geprüft. Geräte entfernen bewusst nicht enthalten.
- WebSocket-Nachrichten bis 16 MB (große Gerätelisten).

## 0.6.0 – 2026-10-24

- **Backups**: `ha_list_backups`, `ha_create_backup` (lokal, wartet auf Fertigstellung, Passwort nur als
  Zugangsdaten-Verweis), `ha_delete_backup`; Weboberfläche **Backups** mit Erstellen, gestreamtem Download und
  Löschen. Wiederherstellen bewusst nicht enthalten.
- Ollama-Client: Toolaufrufe im XML-Textformat von `qwen3-coder` (`<function=…><parameter=…>`) werden erkannt,
  nach dem Tool-Schema typisiert und laufen durch dieselbe Freigabe.

## 0.5.0 – 2026-10-24

- **Dateien** (Weboberfläche): Pläne und Codeblöcke aus Chat-Antworten werden lokal gespeichert
  (`~/.local/share/ha-safe-mcp/files/`) und können gelesen, heruntergeladen und gelöscht werden. Nie ausgeführt.
- **Protokoll** (Weboberfläche): datensparsames Audit-Log aller Tool-Aufrufe und REST-/WebSocket-Anfragen an
  Home Assistant (nur Metadaten, Routen als Muster), 30 Tage Aufbewahrung, Löschknopf. `HA_AUDIT`, `HA_AUDIT_DIR`.
- Lesende Chats dürfen Pläne und Entwürfe als Text schreiben, statt auf „Aktionen erlauben“ zu verweisen.

## 0.4.0 – 2026-10-24

- **Integrationen** über HA-Config-Flows: auflisten, Typen suchen, von HA entdeckte Geräte, Einrichtung
  starten/fortsetzen/abbrechen, neu laden, löschen (9 Tools). Flow-IDs als 32-Hex oder ULID.
- Geheime Formularfelder nur als Verweis `{"$credential": alias, "field": feld}`; Werte werden aus Antworten entfernt.
- Ollama-Client: mehrere als Text ausgegebene JSON-Toolaufrufe werden erkannt; Systemprompt nennt die Grenzen
  (kein eigener Netzwerkscan, keine Passwörter im Chat).

## 0.3.0 – 2026-10-24

- **Zugangsdaten** (Weboberfläche): lokale, Fernet-verschlüsselte Ablage (`~/.config/ha-safe-mcp/credentials/`,
  0700/0600), Werte werden nie zurückgegeben. Der Chat lehnt Passwörter im Klartext ab.

## 0.2.x – 2026-10-24

- Weboberfläche `ha-mcp-ui` mit Ersteinrichtung, Einstellungen, Chat und Freigabe-Karten.
- Cloudflare-Access-JWT-Prüfung am Loopback-Origin (`--public-host`).
- Schreibvorschläge werden vor der Freigabe gegen das Tool-Schema geprüft; leere Tool-Ergebnisse nicht mehr als Fehler.

## 0.1.x – 2026-10-24

- stdio-MCP-Server mit Entitäten/Diensten, REST-Katalog (20 Routen), Automationen, Dashboards, Helfern und
  Entity-Registry; dreistufige Schreibfreigaben; Ollama-Client; Userguide und technische Dokumentation.
