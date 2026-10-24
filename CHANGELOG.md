# Changelog

Alle wesentlichen Änderungen an `ha-safe-mcp`. Versionen folgen grob [SemVer](https://semver.org/lang/de/);
vor 1.0 können sich Tool-Signaturen noch ändern.

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
