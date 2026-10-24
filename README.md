# ha-safe-mcp

Eigenständiger Home-Assistant-MCP-Server (stdio) mit explizitem REST-Katalog und typisierten Verwaltungs-Tools. Nutzt die [offizielle REST-Referenz](https://developers.home-assistant.io/docs/api/rest/) und ausgewählte Konfigurations-APIs aus [Home Assistant Core](https://github.com/home-assistant/core). Kein unbeschränkter HTTP-/WebSocket-Proxy. Dazu gibt es eine lokale **Weboberfläche** mit Ersteinrichtung und einem Chat mit dem lokalen Modell.

## Schnellstart mit Weboberfläche

```bash
cd ha-mcp-local   # Klon dieses Repositorys
.venv/bin/python -m pip install -e '.[test]'
.venv/bin/ha-mcp-ui            # http://127.0.0.1:8765/
```

Die **Ersteinrichtung** fragt nacheinander die Home-Assistant-Adresse mit Token (wird vor dem Speichern geprüft), das lokale Ollama-Modell und die Sicherheitsstufe ab; Standard ist „nur lesen“. Danach gibt es eine **Chat-Seite** und eine **Chat-Bubble** unten rechts, beide mit demselben Verlauf. Schreibaktionen erscheinen als Freigabe-Karte und werden erst nach **Ausführen** ausgeführt, jede einzeln. Die Oberfläche lauscht nur auf `127.0.0.1` und ist gegen DNS-Rebinding und CSRF geschützt. Details: [Userguide Kapitel 7](docs/USERGUIDE.md#7-lokales-modell-weboberfläche-und-kommandozeile).

## Dokumentation

- **[Userguide](docs/USERGUIDE.md)** – Einrichtung, Token, MCP-/Ollama-Bedienung, sichere Beispiele und Fehlersuche.
- **[Technische Dokumentation](docs/TECHNISCHE_DOKUMENTATION.md)** – Architektur, API- und Tool-Referenz, Berechtigungen, Tests und Erweiterung.
- **[Changelog](CHANGELOG.md)** – Versionen und Änderungen.
- Diese README bleibt der kompakte Einstieg; die beiden Dokumente sind die ausführlichen Nachschlagewerke.

## Lokale Daten

| Was | Ort (Standard) | Rechte | Aufbewahrung |
|---|---|---|---|
| Einstellungen und HA-Token | `.env` im Projektordner (git-ignoriert) | 0600 | bis zur Änderung |
| Zugangsdaten (Fernet-verschlüsselt) und Schlüssel | `~/.config/ha-safe-mcp/credentials/` | 0700/0600 | bis zum Löschen in der UI |
| Pläne und Skripte aus dem Chat | `~/.local/share/ha-safe-mcp/files/` | 0700/0600 | bis zum Löschen in der UI |
| Protokoll MCP ↔ HA (nur Metadaten) | `~/.local/state/ha-safe-mcp/audit/` | 0700/0600 | 30 Tage, Löschknopf |
| Chatverlauf | `localStorage` des Browsers | – | bis „Neu“ |

Nichts davon liegt im Repository. Für ein Backup des MCP-Rechners die drei Ordner unter `~/.config`, `~/.local/share` und `~/.local/state` mitsichern; der Credential-Schlüssel gehört dazu, sonst sind die Zugangsdaten nicht wiederherstellbar.

## Plan / Build / Run

| Bereich | Planen/Lesen | Schreiben (Admin-Freigabe) | Löschen (weitere Freigabe) |
|---|---|---|---|
| Zustände/Dienste | `ha_search_entities`, `ha_get_state`, `ha_list_services` | `ha_call_service` für eine Entität | — |
| Dokumentierte REST-API | `ha_rest_catalog`, `ha_rest_query` | `ha_rest_write` | `ha_rest_delete` |
| Automationen | `ha_validate_automation`, `ha_get_automation` | `ha_save_automation` (HA-Validierung + Rücklesung) | `ha_delete_automation` |
| Dashboards | `ha_list_dashboards`, `ha_get_dashboard` | `ha_create_dashboard`, `ha_save_dashboard` (bisherige Konfiguration im Ergebnis), `ha_update_dashboard` | `ha_delete_dashboard` |
| Persistente Helper | `ha_list_helpers` | `ha_create_helper`, `ha_update_helper` | `ha_delete_helper` |
| Entity Registry | `ha_list_entity_registry` | `ha_update_entity_registry` (Name/Bereich/Icon) | — |
| Szenen | `ha_list_scenes`, `ha_get_scene` | `ha_save_scene` (Rücklesung, vorherige Fassung), `ha_activate_scene` (Domain `scene` nötig) | `ha_delete_scene` |
| Skripte | `ha_list_scripts`, `ha_get_script` | `ha_save_script` (HA-Validierung + Dienstprüfung), `ha_run_script` (Domain `script` nötig) | `ha_delete_script` |
| Bereiche, Etagen, Geräte | `ha_list_areas`, `ha_list_floors`, `ha_list_devices`, `ha_list_area_entities` | `ha_create_area`, `ha_update_area`, `ha_create_floor`, `ha_update_floor`, `ha_update_device` (Bereich, Name, deaktivieren) | `ha_delete_area`, `ha_delete_floor` |
| Backups | `ha_list_backups` | `ha_create_backup` (lokal, wartet auf Fertigstellung) | `ha_delete_backup` |
| Integrationen | `ha_list_integrations`, `ha_list_integration_types`, `ha_list_discovered`, `ha_list_credentials` | `ha_start_integration_setup`, `ha_integration_setup_step`, `ha_abort_integration_setup`, `ha_reload_integration`, `ha_start_integration_options`, `ha_integration_options_step`, `ha_abort_integration_options`, `ha_start_integration_reconfigure`, `ha_update_integration`, `ha_set_integration_disabled` | `ha_delete_integration` |

Der REST-Katalog umfasst **20 Methoden/Routen der offiziellen REST-Referenz**, darunter Konfiguration, Zustände, Events, Dienste, History, Logbook, Fehlerprotokoll, Kamera, Template, Konfigurationsprüfung und Intent. Nur deklarierte Routen, Methoden und Query-Parameter sind zugelassen; unbekannte Pfade/Traversal werden vor Netzwerkzugriff abgelehnt. Kamerabilder werden Base64-kodiert zurückgegeben; Antwortgröße maximal 2 MB. `POST /api/states/{entity_id}` setzt nur einen Zustand und erstellt **keine dauerhaft verwaltete Entität**.

Automation-CRUD nutzt `/api/config/automation/config/{id}`; Dashboard- und Helper-CRUD nutzen Home-Assistant-Core-WebSocket-Befehle. Unterstützte Helper: `input_boolean`, `input_number`, `input_select`, `input_text`, `input_datetime`. Die Entity Registry erstellt **keine** Entitäten – dafür die jeweilige Helper-Collection beziehungsweise Integration nutzen. Die Verwaltungsbefehle sind Core-spezifisch und können sich zwischen HA-Versionen ändern; `tests/ha_core_smoke.py` prüft die Kernpfade gegen ein echtes isoliertes Core-Image.

**Integrationen** werden über dieselben Config-Flow-Routen eingerichtet wie in der HA-Oberfläche (`/api/config/config_entries/...`). Passwörter, Tokens und PINs nimmt der MCP nur als Verweis auf die lokale **Zugangsdatenablage** an (`{"$credential": "<alias>", "field": "<feld>"}`). Sie wird in der Weboberfläche unter **Zugangsdaten** gepflegt, liegt verschlüsselt in `~/.config/ha-safe-mcp/credentials/` und gibt Werte nie an Browser oder Modell zurück. Der MCP **durchsucht das Netzwerk nicht selbst**: `ha_list_discovered` zeigt nur, was Home Assistant selbst gefunden hat.

**Szenen und Skripte** nutzen dieselben Konfigurationsrouten wie die HA-Editoren (`/api/config/scene|script/config/{id}`, gespeichert in `scenes.yaml`/`scripts.yaml`). Vor dem Speichern prüft der MCP: Szenen nur mit existierenden Entitäten, Skripte nur mit bekannten Diensten (auch in verschachtelten `choose`/`if`/`parallel`-Blöcken) und nach HA-eigener `validate_config`-Prüfung. Das Ergebnis enthält die vorherige Fassung für einen manuellen Rückweg. **Aktivieren/Starten** ist eine normale Steueraktion und funktioniert nur, wenn `scene` bzw. `script` in den erlaubten Domains steht (Standard: nicht).

**Integrations-Einstellungen** nutzen die Wege der HA-Oberfläche: Optionen (Zahnrad „Konfigurieren“) über `/api/config/config_entries/options/flow`, Neu-Konfigurieren (z. B. neue IP) über einen Config-Flow mit `entry_id`, Umbenennen, Abfrage aus/an, neue Entitäten automatisch hinzufügen und Deaktivieren über `config_entries/update|disable`. Formulare zeigen den **aktuellen** Wert als `current`; Felder, die das Modell nicht schickt, behält der MCP automatisch bei – HA selbst würde sie sonst auf den Werkswert zurücksetzen. Geheime Felder zeigen nie ihren Wert.

**Bereiche, Etagen und Geräte** laufen über die Registry-Befehle, die auch die HA-Oberfläche nutzt (`config/area_registry/*`, `config/floor_registry/*`, `config/device_registry/list|update`). Jede Änderung wird zurückgelesen; Bereichs- und Etagen-IDs müssen existieren. Gerätelisten enthalten **keine** Seriennummern, MAC-Adressen, Kennungen oder Konfigurations-URLs. Geräte **entfernen** bietet der MCP nicht an – das ändert Integrationen; dafür `ha_delete_integration` oder die HA-Oberfläche.

**Backups** nutzen die Backup-Funktion von Home Assistant selbst (WebSocket `backup/info|generate|delete`, Download über `/api/backup/download/{id}`). Erstellt wird ein vollständiges Backup (Konfiguration + Datenbank) auf dem lokalen Speicherort `backup.local`; ein Verschlüsselungspasswort nur als Zugangsdaten-Verweis. In der Weboberfläche unter **Backups**: auflisten, erstellen, herunterladen (gestreamt, der MCP behält keine Kopie), löschen. **Wiederherstellen ist bewusst nicht enthalten** – das ersetzt die laufende Konfiguration und startet HA neu; dafür die HA-Oberfläche nutzen.

**Dateien und Protokoll (Weboberfläche):** Pläne und Codeblöcke (YAML, Shell, Python …), die das Modell im Chat erzeugt, werden automatisch lokal gespeichert und unter **Dateien** zum Lesen, Herunterladen und Löschen angeboten. Sie werden **nie ausgeführt** und nicht an Home Assistant übertragen. Unter **Protokoll** steht die Kommunikation zwischen MCP und Home Assistant, datensparsam: nur Zeit, Tool, Kanal, Route als Muster (`/api/states/{entity_id}`), Status und Dauer – keine Entitäten, Namen, Inhalte oder Tokens. Einträge werden nach 30 Tagen automatisch gelöscht; „Protokoll löschen“ entfernt alles sofort.

**Nicht implementiert:** Options-/Reconfigure-Flows, beliebige Komponenten- und WebSocket-Befehle, Bearbeitung von HA-Konfigurationsdateien, Backup-Wiederherstellung und Backup-Zeitpläne. Damit ist dies eine geprüfte Grundlage für Plan/Build/Run, **nicht** eine vollständige Abbildung sämtlicher HA-Funktionen. Änderungen an Automationen stoßen laut Core einen asynchronen Reload an: erfolgreiche Konfigurations-Rücklesung beweist noch nicht, dass die Automation bereits ausgeführt wurde.

## Sicherheitsfreigaben

`.env.example` beschreibt die Schalter. Standardmäßig sind **alle Writes aus**:

- `HA_ALLOW_WRITE=true`: Dienste für einzelne Entitäten in `HA_ALLOWED_DOMAINS` und gewöhnliche REST-Schreibaktionen freigeben.
- Zusätzlich `HA_ALLOW_ADMIN_WRITE=true`: Automationen, Dashboards, Helper, Registry-Updates sowie administrative REST-Schreibaktionen. Der HA-Token muss Admin-Rechte haben.
- Zusätzlich `HA_ALLOW_DELETE=true`: Löschwerkzeuge/-routen freigeben. Die beiden anderen Schalter bleiben erforderlich.
- **Ohne Freigabe** (`HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE`, in der Oberfläche „ohne Freigabe
  ausführen“ je Stufe): Aktionen dieser Stufe laufen im Chat ohne Freigabe-Karte; sie erscheinen trotzdem als
  „Aktion ohne Freigabe“ im Verlauf und im Protokoll. Gilt nur zusammen mit dem jeweiligen Erlauben-Schalter und dem
  Chat-Häkchen „Aktionen erlauben“; eine Obergrenze (`--max-level`) gilt auch hier.
- **Ollama-Client zusätzlich:** `--allow-write` und manuelles `JA` **pro Tool-Aufruf**; in der Weboberfläche entsprechend „Aktionen erlauben“ und **Ausführen** auf der Freigabe-Karte. Andere MCP-Clients müssen eigene menschliche Freigaben durchsetzen; Server-Schalter allein stellen keine Nutzerbestätigung dar.

`ha_call_service` beschränkt Ziel-Domains standardmäßig auf `light,switch,fan,climate,cover,media_player`, nimmt eine `entity_id` oder eine Liste von bis zu 20 `entity_id` derselben Domain (jede einzeln geprüft) und
verbietet zusätzliche Targets wie `area_id`/`device_id`. Räume löst `ha_list_area_entities` auf (Name, Alias oder
`area_id`; Geräte-Bereich wie in HA), mit verfügbaren und nicht verfügbaren Entitäten und Gruppen des Raums. Der explizite REST-Katalog hat dagegen eigene Berechtigungsklassen und kein willkürliches URL-Schema. Ein HA-Admin-Token besitzt trotzdem weitreichende Rechte; diese Adapter-Checks ersetzen **keine** Home-Assistant-Autorisierung. Der stdio-Server darf nicht ungeschützt ans Netzwerk. Token und Response-Bodies werden in Fehlern nicht ausgegeben.

### Zweite Instanz nur lesend (z. B. Produktiv-HA)

`ha-mcp-ui --port 8766 --read-only --env-file ~/.config/ha-safe-mcp/prod.env` startet eine getrennte Oberfläche, in
der Steuern, Konfiguration ändern und Löschen **im Code** gesperrt sind: Werte aus der `.env` werden ignoriert,
Speichern mit einem Schalter wird abgelehnt, der Chat nimmt keine Aktionen an. Eigene Datenordner per
`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` trennen Zugangsdaten, Dateien und Protokoll von der Dev-Instanz.
Zusätzlich einen **HA-Benutzer ohne Admin-Rechte** für den Token verwenden.

Zwischenstufe: `--max-level control` erlaubt nur „Steuern“ (Dienstaufrufe der erlaubten Domains, jeder einzeln
freigegeben); Konfiguration ändern und Löschen bleiben im Code gesperrt. `--read-only` entspricht `--max-level read`.

## Installation und MCP-Client

```bash
cd ha-mcp-local   # Klon dieses Repositorys
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
cp -n .env.example .env
# HA_URL und HA_TOKEN in .env setzen (Home-Assistant-Long-Lived-Access-Token)
```

`.env` und `.github.env` sind git-ignoriert. Der GitHub-PAT wird für den MCP-Betrieb **nicht** benötigt und darf nie ans Modell/HA weitergereicht werden. HTTPS-Zertifikate werden normal geprüft.

```json
{
  "mcpServers": {
    "home-assistant-local": {
      "command": "/PFAD/ZU/ha-mcp-local/.venv/bin/ha-safe-mcp",
      "cwd": "/PFAD/ZU/ha-mcp-local"
    }
  }
}
```

Ohne `cwd` die `HA_...`-Variablen explizit im MCP-Prozess setzen. Token nicht als Kommandozeilenargument oder in Git speichern.

## Lokales KI-Modell (Ollama)

`qwen2.5-coder:7b` wurde an einem lokalen Test-HA mit echtem MCP-Tool-Aufruf geprüft. Der Ollama-Client wählt **themenbezogen** nur wenige Tools aus, begrenzt Runden und Ergebnislängen und verlangt für jeden Write eine explizite Bestätigung. Die Auswahl per Stichwort ist eine Komfortfunktion, keine semantisch vollständige Planung; für komplizierte Aufgaben Tools gezielt benennen oder einen leistungsfähigeren MCP-Client einsetzen.

```bash
ollama pull qwen2.5-coder:7b
.venv/bin/ha-ollama-chat 'Wie ist der Zustand von light.wohnzimmer?'
# Nur bei bewusst freigeschaltetem HA_ALLOW_WRITE=true:
.venv/bin/ha-ollama-chat --allow-write 'Schalte light.wohnzimmer an'
```

Das Modell sieht weder GitHub-PAT noch HA-Token direkt. Es kann sich trotzdem bei Entitäts- oder Konfigurationsdetails irren: jeden vorgeschlagenen Write prüfen.

## Tests

```bash
.venv/bin/python -m pytest -q
sudo docker compose -f compose.test.yaml up -d
sudo docker build -t ha-safe-mcp:local .
.venv/bin/python tests/docker_smoke.py
TEST_ALLOW_WRITE=true .venv/bin/python tests/docker_smoke.py
sudo docker compose -f compose.test.yaml down
```

Der Docker-Testdouble prüft MCP-Protokoll und REST-Verhalten, ist aber **kein** echter HA Core. Für einen einmaligen Test gegen einen **frischen, isolierten** HA-Core-Container (das Skript erstellt dort einen Admin und verweigert bereits eingerichtete Instanzen):

```bash
sudo docker run -d --name ha-mcp-core-test -p 127.0.0.1:18124:8123 \
  -v ha-mcp-core-test:/config ghcr.io/home-assistant/home-assistant:stable
# Erst ausführen, sobald http://127.0.0.1:18124/api/onboarding erreichbar ist:
.venv/bin/python tests/ha_core_smoke.py
sudo docker rm -f ha-mcp-core-test
sudo docker volume rm ha-mcp-core-test
```

**Nie** `HA_CORE_TEST_URL` auf das echte Smart Home setzen. In diesem Test wurden Helper erstellen/ändern/löschen, Automationen validieren/speichern/löschen und Dashboards erstellen/speichern/ändern/löschen sowie MCP-stdio-Lese- und Schreibaufrufe gegen echtes Core ausgeführt. Registry-Update und alle REST-Spezialrouten sind durch Unit-/Testdouble-Tests, nicht vollständig live, abgedeckt.

Quellen: [REST API](https://developers.home-assistant.io/docs/api/rest/), [WebSocket API](https://developers.home-assistant.io/docs/api/websocket/), [Core-Quellcode](https://github.com/home-assistant/core), [ha-mcp als Funktionsreferenz](https://github.com/homeassistant-ai/ha-mcp).
