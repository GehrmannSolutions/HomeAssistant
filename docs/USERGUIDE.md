# ha-safe-mcp: Benutzerhandbuch

Dieses Handbuch beschreibt **die Implementierung in diesem Repository**, nicht einen allgemeinen Home-Assistant-Agenten. Alle `entity_id`-, `config_id`-, `helper_id`- und `dashboard_id`-Werte in den Beispielen sind **illustrative Platzhalter**: erst aus der eigenen, isolierten Testinstanz auslesen, dann einsetzen. Die Beispiele sind Tool-Argumente im JSON-Format, keine HTTP-Requests und keine Befehle zum blinden Ausführen. Beginne ausschließlich lesend.

## 1. Zweck, Architektur und Grenzen

`ha-safe-mcp` verbindet einen MCP-Client über **stdio** mit Home Assistant (HA). Es gibt einfache Zustands-/Dienst-Tools, einen **festen REST-Katalog** und typisierte Verwaltungs-Tools für Automationen, Storage-Dashboards, fünf Helper-Domains und Entity-Registry-Metadaten. Zusätzlich gibt es eine **lokale Weboberfläche** (`ha-mcp-ui`) mit Ersteinrichtung, Einstellungen und einem Chat mit dem lokalen Modell – als eigene Chat-Seite und als schwebende Chat-Bubble (Kapitel 7). REST läuft über HTTP(S), ausgewählte Verwaltung über HA-WebSocket. Der Server akzeptiert **keine beliebigen URLs oder WebSocket-Befehle**. Der REST-Katalog hat 20 Methoden/Routen; `ha_rest_catalog` zeigt die tatsächlich angebotenen Einträge und Berechtigungsklassen. Siehe [Server](../src/ha_safe_mcp/server.py), [REST-Gateway](../src/ha_safe_mcp/rest_api.py), [Verwaltung](../src/ha_safe_mcp/management.py) und die [offizielle REST-API](https://developers.home-assistant.io/docs/api/rest/) sowie [WebSocket-API](https://developers.home-assistant.io/docs/api/websocket/).

**Nicht enthalten:** generische Integrations-/Config-Flow-Verwaltung, Dateizugriff/YAML-Editieren, beliebige HA-Komponenten, vollständige HA-Abdeckung oder eine Backup-Funktion. `ha_update_entity_registry` bearbeitet nur `name`, `area_id`, `icon` einer bestehenden Registry-Entität; es erstellt keine Entität. `ha_rest_write` auf `/api/states/<entity_id>` setzt einen Zustand, **keinen dauerhaft verwalteten Helper**. Der Token bleibt mächtig: MCP-Schalter begrenzen nur diesen Adapter, nicht HA selbst. Vertraue LLM-Vorschlägen nie ungeprüft. [README](../README.md) · [REST-Referenz](https://developers.home-assistant.io/docs/api/rest/).

## 2. Isolierte lokale HA-Entwicklungsinstanz

Die hier vorgesehene Entwicklungsinstanz heißt **`ha-mcp-dev`** und speichert ihre HA-Konfiguration im Docker-Volume **`ha-mcp-dev-config`**. Im Browser des **gleichen Rechners** `http://127.0.0.1:8123` bzw. `http://localhost:8123` öffnen. Der Port soll **nur an 127.0.0.1** gebunden sein; niemals `0.0.0.0:8123`, Router-Portfreigabe oder eine produktive HA-Instanz verwenden. `127.0.0.1` aus einem separaten Container oder Remote-Client bezeichnet **diesen** Container/Rechner, nicht automatisch den HA-Host. Eine andere HA-Adresse nur bewusst in `HA_URL` setzen. Der Server selbst hat **keinen Netzwerk-Listener**; der MCP-Client startet ihn lokal per stdio. [HA-Container-Dokumentation](https://www.home-assistant.io/installation/linux#install-home-assistant-container) · [REST-API/Port](https://developers.home-assistant.io/docs/api/rest/).

Falls die bereits eingerichtete Testinstanz steht, **nicht neu initialisieren**. Wer Container/Volume administriert, kann Bindung und Namen mit `docker ps --filter name=ha-mcp-dev` und `docker inspect ha-mcp-dev` kontrollieren (bei lokal notwendiger Berechtigung ggf. `sudo`). `docker start ha-mcp-dev` nur, wenn der Container existiert und gestoppt ist. **Kein** `docker rm -v`, `docker volume rm ha-mcp-dev-config` oder Testskript mit produktiver URL: Das Volume enthält die persistenten Testdaten. Dieses Handbuch setzt nicht voraus, dass bereits Entitäten, Dashboards oder ein Token angelegt sind.

## 3. Voraussetzungen und Token

- Python **3.11+** und eine funktionierende `venv`-/`pip`-Installation; für den Test-HA-Container Docker; ein lokal ausführender, stdio-fähiger MCP-Client. Für das optionale Modellbeispiel läuft Ollama lokal. Die Python-Abhängigkeiten und Konsolenprogramme stehen in [pyproject.toml](../pyproject.toml).
- HA läuft unter der konfigurierten URL und die Einrichtung/Anmeldung im Browser ist abgeschlossen. Für reine Leseversuche einen geeigneten HA-Benutzer verwenden; administrative Verwaltungsaktionen benötigen einen HA-**Admin**-Benutzer und dessen Token. Der Token übernimmt dessen Rechte.

**Long-lived Access Token anlegen:** Im HA-Webinterface anmelden, das **eigene Benutzerprofil → Sicherheit (Security) → Long-lived access tokens** öffnen und dort einen neuen Token für diesen lokalen Client erstellen. Die offizielle Dokumentation nennt den Weg **User profile → Security** und die Erstellung von Long-lived Access Tokens; die konkreten Schaltflächenbezeichnungen können sich mit Sprache/Version ändern. Token unmittelbar sicher ablegen, nicht in Chat, Screenshots, Issues, Terminal-Ausgaben oder Repository kopieren. Bei Verdacht auf Offenlegung im selben Profil widerrufen und ersetzen. [HA-Authentifizierung](https://www.home-assistant.io/docs/authentication/) · [HA-REST-Authentifizierung](https://developers.home-assistant.io/docs/api/rest/).

## 4. Installation und `.env` ohne Geheimnisleck

Im Projektverzeichnis auf **dem Rechner des MCP-Clients**:

```bash
cd ha-mcp-local   # Klon dieses Repositorys
python3 -m venv .venv
.venv/bin/python -m pip install -e .
cp -n .env.example .env
chmod 600 .env
```

Die neue `.env` in einem lokalen Editor bearbeiten; den **echten** Token nur dort eintragen (in dieser Dokumentation absichtlich kein Token). Das folgende Schema ist eine **Vorlage**, kein zusätzlicher Befehl, und der Tokenwert ist ausdrücklich **kein gültiger Token**:

```dotenv
HA_URL=http://127.0.0.1:8123
HA_TOKEN=HIER_LOKAL_DEN_EIGENEN_HA_TOKEN_EINTRAGEN
HA_ALLOW_WRITE=false
HA_ALLOW_ADMIN_WRITE=false
HA_ALLOW_DELETE=false
HA_ALLOWED_DOMAINS=light,switch,fan,climate,cover,media_player
```

`.env.example` enthält dieselben Standards ([Vorlage](../.env.example)); `.env` ist laut [README](../README.md) git-ignoriert. Trotzdem vor jeder Veröffentlichung auf Geheimnisse prüfen und `.env` nicht an andere weitergeben. **Nicht** Token in Kommandozeile, MCP-Client-JSON, Ollama-Prompt oder Repository schreiben. `HA_URL` muss eine Root-URL mit `http` oder `https` **ohne** Pfad, Query, eingebettete Zugangsdaten sein. Auf einer nichtlokalen Verbindung HTTPS nutzen; Zertifikatsprüfung nicht abschalten. Die `.env` wird beim Start im Arbeitsverzeichnis geladen; vorhandene Prozess-Umgebungsvariablen haben Vorrang. Zum Wirksamwerden geänderter Schalter den MCP-Prozess/Client neu starten. [Server-Konfiguration](../src/ha_safe_mcp/server.py).

> **Noch kein Token?** Nicht versuchen, den Platzhalter zu benutzen. Ohne gültiges `HA_TOKEN` ist der Server nicht verwendbar. Für einen reinen Installationscheck ist `.venv/bin/python -m pip show ha-safe-mcp` ohne HA-Zugriff möglich.

> **Einfacher:** Statt `.env` von Hand zu bearbeiten, führt die Weboberfläche durch die Ersteinrichtung (Kapitel 7.1). Sie prüft Verbindung und Token, bevor sie speichert, und schreibt dieselbe `.env` mit Dateirechten `600`. Zusätzlich legt sie `OLLAMA_URL` und `OLLAMA_MODEL` ab; der MCP-Server ignoriert diese beiden Werte.

## 5. MCP-Client über stdio verbinden

Ein Client, der eine `mcpServers`-Konfiguration unterstützt, kann **sinngemäß** so konfiguriert werden (Speicherort/Feldschema im jeweiligen Client nachschlagen):

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

`cwd` ist entscheidend, damit `load_dotenv()` die lokale `.env` findet. Falls der Client `cwd` nicht unterstützt, die `HA_...`-Werte **sicher als Prozessumgebung** einrichten; Client-Konfigurationsdateien mit Token nie teilen. `ha-safe-mcp` benutzt stdio für das MCP-Protokoll: nicht als gewöhnlichen interaktiven Chat/HTTP-Server starten und stdout nicht für fremde Statusmeldungen nutzen. Nach dem Client-Neustart zunächst `ha_rest_catalog` mit `{}` testen; das benötigt keine HA-Anfrage. Danach `ha_search_entities` mit `{ "limit": 10 }` gegen die Testinstanz ausführen. Ein leerer Ergebnis-Satz ist bei einer frischen Instanz kein Verbindungsbeweis; `ha_list_services` mit `{ "domain": "light" }` oder `ha_rest_query` mit `{ "path": "/api/" }` prüfen die HA-Verbindung. [Server-Start](../src/ha_safe_mcp/server.py) · [MCP-Transporte](https://modelcontextprotocol.io/docs/learn/architecture#transport-layer).

## 6. Rechte und Freigaben

**Ausgangszustand:** alle drei Schalter `false`, nur Lesen. Für **einen bewussten, isolierten** Versuch Schalter in `.env` setzen und Client neu starten; danach zurück auf `false` setzen. `HA_ALLOWED_DOMAINS` ist die Ziel-Domain-Allowlist für Dienstaufrufe, nicht die Lesesuche. Dienstaufrufe verlangen **eine** konkrete `entity_id`, deren Domain zu `domain` passt; `service_data` darf keine `entity_id`, `area_id` oder `device_id` enthalten. Den bestehenden Schaltern fehlt eine eigene Nutzerbestätigung: bei generischen MCP-Clients menschliche Freigabe **im Client** erzwingen. [Prüfungen im Server](../src/ha_safe_mcp/server.py) · [REST-Klassen](../src/ha_safe_mcp/rest_api.py) · [Admin-Gates](../src/ha_safe_mcp/management.py).

| Operationen | Benötigte Server-Schalter | Zusätzlich |
|---|---|---|
| `ha_search_entities`, `ha_get_state`, `ha_list_services`, `ha_rest_catalog`, `ha_rest_query` (nur GET, bzw. POST auf `/api/template` oder `/api/config/core/check_config`), `ha_validate_automation`, `ha_get_automation`, `ha_list_dashboards`, `ha_get_dashboard`, `ha_list_helpers`, `ha_list_entity_registry`, `ha_list_integrations`, `ha_list_integration_types`, `ha_list_discovered`, `ha_list_credentials` | keine | gültiger HA-Token; HA-Berechtigung für jeweiligen Endpunkt |
| `ha_call_service`; `ha_rest_write` mit REST-Klasse `write` | `HA_ALLOW_WRITE=true` | passende `HA_ALLOWED_DOMAINS`, vorhandenes Einzelziel, HA-Rechte |
| `ha_save_automation`, `ha_create_dashboard`, `ha_save_dashboard`, `ha_update_dashboard`, `ha_create_helper`, `ha_update_helper`, `ha_update_entity_registry`, `ha_start_integration_setup`, `ha_integration_setup_step`, `ha_abort_integration_setup`, `ha_reload_integration`; `ha_rest_write` mit REST-Klasse `admin` | `HA_ALLOW_WRITE=true` **und** `HA_ALLOW_ADMIN_WRITE=true` | HA-Admin-Token |
| `ha_delete_automation`, `ha_delete_dashboard`, `ha_delete_helper`, `ha_delete_integration`, `ha_rest_delete` | alle obigen **und** `HA_ALLOW_DELETE=true` | HA-Admin-Token; REST-DELETE betrifft nur katalogisierte States-Route |

`ha_rest_catalog` liefert `read`, `write`, `admin` oder `delete`; die Freigabe hängt von **Methode und Pfad**, nicht vom Toolnamen allein ab. `/api/services/...` über `ha_rest_write` wird über die **gleichen Einzelziel-/Domain-Prüfungen** wie `ha_call_service` geleitet. `ha_rest_query` ist keine Hintertür für andere POST-Routen. **Warnung:** `POST /api/template` kann Templates auswerten und `POST /api/config/core/check_config` führt eine HA-Konfigurationsprüfung aus; beide sind im Adapter als `read` klassifiziert, aber nicht mit einer Garantie auf null Ressourcen-/Nebeneffekte zu verwechseln. [REST-Gateway](../src/ha_safe_mcp/rest_api.py).

## 7. Lokales Modell: Weboberfläche und Kommandozeile

Optional Ollama gemäß [offizieller Ollama-Dokumentation](https://docs.ollama.com/) installieren/starten und ein toolfähiges Modell bereitstellen (voreingestellt `qwen2.5-coder:7b`). Mit dem Modell sprichst du entweder über die **Weboberfläche** (7.1–7.4) oder über die **Kommandozeile** (7.5). Beide nutzen dieselbe Tool-Auswahl, dieselben Server-Schalter und verlangen für **jede** Schreibaktion eine eigene Bestätigung.

### 7.1 Weboberfläche starten und Ersteinrichtung

```bash
cd ha-mcp-local   # Klon dieses Repositorys
.venv/bin/ha-mcp-ui            # dann http://127.0.0.1:8765/ im Browser öffnen
```

Optionen: `--port` (Standard `8765`), `--host` (Standard `127.0.0.1`), `--env-file` (Standard: `.env` im Projekt). Ohne gültigen Token startet die Oberfläche im Assistenten **Ersteinrichtung** mit vier Schritten:

1. **Home Assistant:** Adresse und langlebigen Token eintragen, **Verbindung prüfen**. Geprüft wird rein lesend (`/api/`, `/api/config`, WebSocket `auth/current_user`). Angezeigt werden HA-Version, Name des Zuhauses und der Benutzer, dem der Token gehört. Bei falschem Token erscheint „Token wurde von Home Assistant abgelehnt (HTTP 401)“, und es wird nichts gespeichert.
2. **Lokales Modell:** Ollama-Adresse prüfen; die installierten Modelle werden mit Größe angezeigt. Modelle ohne Tool-Unterstützung sind nicht wählbar.
3. **Sicherheit:** Standard ist **nur lesen**. „Konfiguration ändern“ setzt „Steuern“ voraus und „Löschen“ setzt „Konfiguration ändern“ voraus. „Konfiguration ändern“ lässt sich nur speichern, wenn der Token zu einem HA-Admin gehört.
4. **Fertig:** Die Einstellungen stehen in `.env` (Rechte `600`). Der Token wird danach **nie wieder angezeigt**, auch nicht in den Einstellungen.

Unter **Einstellungen** lässt sich alles später ändern. Ein leeres Token-Feld behält den gespeicherten Token, gilt aber nur für **dieselbe** HA-Adresse; bei neuer Adresse muss der Token neu eingegeben werden. Jedes Speichern prüft die Verbindung erneut. Die Oberfläche selbst übernimmt geänderte Einstellungen sofort für die nächste Chat-Anfrage. Ein **separat laufender** MCP-Client (Kapitel 5) liest `.env` dagegen nur beim Start und muss neu gestartet werden.

### 7.1a Zweite Instanz für die Produktiv-HA (nur lesen)

1. Einstellungsdatei anlegen, z. B. `~/.config/ha-safe-mcp/prod.env` (Rechte 600), mit `HA_URL=http://<ip>:8123`.
2. Starten mit `ha-mcp-ui --port 8766 --read-only --env-file ~/.config/ha-safe-mcp/prod.env`, am besten als eigener
   systemd-User-Dienst mit eigenen `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`.
3. `http://127.0.0.1:8766/` öffnen, in der Ersteinrichtung den Token eintragen. Die drei Rechte-Schalter sind
   ausgegraut; die Anzeige oben lautet „Nur lesen (fest)“.

Der Token sollte zu einem HA-Benutzer **ohne** Administratorrechte gehören. Dann kann auch ein Fehler im MCP nichts an
der Konfiguration ändern. Einige Admin-Abfragen (z. B. Integrationsliste, Backups) liefern mit so einem Token „nicht
berechtigt“; Zustände, Bereiche, Geräte und Entitäten sind lesbar.

### 7.2 Chat-Seite und Chat-Bubble

- **Chat** (Reiter oben): großer Chat mit Verlauf, Startvorschlägen und eingeklappten Zeilen für jeden Tool-Aufruf (Argumente und gekürztes Ergebnis zum Aufklappen).
- **Chat-Bubble** (runder Button unten rechts auf Übersicht und Einstellungen): kleiner Schnell-Chat mit **demselben Verlauf**. ⤢ öffnet den großen Chat, ✕ oder `Esc` schließt die Bubble. Ein Zähler auf dem Button meldet neue Antworten, `!` eine offene Freigabe.
- `Enter` sendet, `Shift+Enter` erzeugt einen Zeilenumbruch. **Stopp** bricht eine laufende Anfrage ab, **Neu** leert den Verlauf. Es läuft immer nur **eine** Anfrage zur Zeit.
- Der Verlauf liegt im Browser (`localStorage`). Die letzten zwölf Nachrichten gehen als Kontext an das Modell, aber nur Text: keine Tool-Ergebnisse und keine Systemanweisungen.

### 7.2a Backups

Der Reiter **Backups** listet alle Backups von Home Assistant (Name, Datum, Größe, Speicherort; 🔒 = verschlüsselt).

- **Backup erstellen** (braucht „Konfiguration ändern“): fragt einen Namen ab und erstellt ein vollständiges Backup (Konfiguration und Datenbank) auf dem lokalen Speicherort von Home Assistant. Die Oberfläche wartet, bis HA es meldet (in der Dev-Instanz wenige Sekunden, bei großen Datenbanken Minuten; nach 10 Minuten meldet sie „läuft noch“).
- **Herunterladen**: lädt die `.tar`-Datei direkt aus Home Assistant; der MCP speichert keine Kopie.
- **Löschen** (nur sichtbar mit „Löschen erlauben“): entfernt das Backup in Home Assistant, nach Rückfrage.
- **Wiederherstellen** gibt es hier nicht: in Home Assistant unter *Einstellungen → System → Backups*.

Im Chat geht dasselbe mit „Aktionen erlauben“, z. B. *„Erstelle ein Backup mit dem Namen Vor Umbau“* → Freigabe-Karte `ha_create_backup` → **Ausführen**. Ein verschlüsseltes Backup braucht ein Passwort unter **Zugangsdaten** (z. B. Alias `backup_pw`, Feld *Passwort*); im Chat dann *„… verschlüsselt mit backup_pw“*.

Empfehlung: vor jeder größeren Änderung (Integrationen löschen, Dashboards umbauen) ein Backup anlegen.

### 7.2b Dateien: gespeicherte Pläne und Skripte

Bittet man das Modell um einen **Plan** (Wörter wie „Plan“, „Konzept“, „Schritte“, „Checkliste“) und antwortet es mit mindestens zwei Schritten, wird die Antwort als Markdown unter `plan/plan-<Zeit>.md` gespeichert. Jeder Codeblock einer Antwort (```` ```yaml ````, ```` ```bash ````, ```` ```python ```` …) wird zusätzlich als eigene Datei unter `script/chat-<Zeit>-<n>.<endung>` abgelegt. Unter dem Chat erscheint dann „📄 Gespeichert unter Dateien: …“.

Im Reiter **Dateien** stehen alle gespeicherten Dateien mit **Lesen**, **Herunterladen** und **Löschen**. Wichtig:

- Dateien werden **nie automatisch ausgeführt** und nicht an Home Assistant übertragen. Ein Skript prüfen, bevor man es selbst verwendet: Das Modell kann Entitäten erfinden (z. B. `weather.your_weather_entity`).
- Ablage: `~/.local/share/ha-safe-mcp/files/` (Ordner 0700, Dateien 0600, nicht ausführbar). Höchstens 256 KB pro Datei und 500 Dateien; ältere Dateien bitte selbst löschen.
- Eine Absage des Modells („kann keine Automation erstellen …“) wird nicht als Plan gespeichert.

### 7.2c Protokoll: Kommunikation MCP ↔ Home Assistant

Der Reiter **Protokoll** zeigt jede Anfrage des MCP an Home Assistant (REST und WebSocket) und jeden Tool-Aufruf. Gespeichert werden **nur Metadaten**: Zeit (UTC), Tool, Kanal, Methode, Route als **Muster** (`/api/states/{entity_id}` statt der echten Entität), HTTP-Status, Dauer und bei Fehlern nur die Fehlerklasse. Keine Entitäts-IDs, Personennamen, Anfrage- oder Antwortinhalte, Chattexte oder Tokens.

- Aufbewahrung: **30 Tage**; ältere Tagesdateien werden bei jedem Schreiben und Lesen gelöscht. **Protokoll löschen** entfernt sofort alles.
- Ablage: `~/.local/state/ha-safe-mcp/audit/audit-JJJJ-MM-TT.jsonl` (0700/0600), nur lokal.
- Abschalten: `HA_AUDIT=false` in der Umgebung des MCP-Servers; anderer Ordner mit `HA_AUDIT_DIR`.

### 7.3 Aktionen freigeben

Ein Modell darf nur dann Schreib-Tools vorschlagen, wenn **beides** gilt: „Steuern erlauben“ ist in den Einstellungen aktiv **und** im Chat ist das Häkchen **Aktionen erlauben** gesetzt. Dann erscheint vor jeder Schreibaktion eine Karte **Freigabe erforderlich** mit Tool-Name und vollständigen JSON-Argumenten:

- **Ausführen** gibt genau diesen einen Aufruf frei. Jede Freigabe gilt einmal; ein zweiter Klick oder eine gefälschte Anfrage wird abgewiesen.
- **Ablehnen** führt nichts aus; der Chat meldet „Schreibaktion nicht freigegeben – diese Aktion wurde nicht ausgeführt.“
- Ohne Entscheidung verfällt die Freigabe nach **120 Sekunden** als Ablehnung. **Stopp** lehnt offene Freigaben ebenfalls ab.

Wie beim `JA` im CLI gilt: Die Freigabe bestätigt den **angezeigten Payload**, keine allgemeine Erlaubnis. Entity-ID und Dienst vor dem Klick prüfen; ein Modell kann IDs erfinden.

### 7.4 Sicherheit der Weboberfläche

- Bindet standardmäßig nur an `127.0.0.1` und nimmt nur Verbindungen von diesem Rechner an. Fremde `Host`-Header (DNS-Rebinding) beantwortet sie mit 400.
- Jede ändernde Anfrage braucht einen eigenen Header und darf nur von der eigenen Seite kommen. Fremde Webseiten können also weder Einstellungen ändern noch Aktionen freigeben.
- Eine strikte Content-Security-Policy erlaubt keine fremden Skripte; die Seite darf nicht in Frames eingebettet werden.
- `--host` mit einer Nicht-Loopback-Adresse verweigert den Start. Das historische `--allow-remote` hebt das auf, ist aber **nicht** die Konfiguration dieses Dienstes: Der Direktmodus hat keine eigene Benutzeranmeldung. Im Access-Modus verhindert `--public-host` die Kombination mit `--allow-remote` und verlangt eine gültige signierte Access-Assertion.

**Cloudflare-Access-Betrieb auf diesem Rechner:** Der systemd-Benutzerdienst `ha-safe-mcp-ui.service` lauscht nur auf `127.0.0.1:8765`. Der Tunnel leitet `https://mcp.example.com/` auf `http://127.0.0.1:8765` weiter. **Keine ufw-Freigabe für 8765** setzen; `192.168.1.13:8765` soll gerade nicht direkt erreichbar sein. Der Origin verlangt bei *jeder* Anfrage einen gültigen `Cf-Access-Jwt-Assertion`-Token (RS256-Signatur, Team-Issuer, App-Audience und Ablaufdatum). Das ist eine **Cloudflare-Access-JWT-Prüfung**, kein allgemeiner OIDC-Authorization-Code-Client für andere Identitätsanbieter. Cloudflare Access kann selbst upstream OIDC verwenden.

Die Prüfkonfiguration liegt in `~/.config/ha-safe-mcp/access.env` (0600, Audience-Tag und Team-Domain, **keine** HA-Zugangsdaten). Der Audience-Tag wurde aus der Access-Login-Weiterleitung übernommen; er muss für eine endgültige Freigabe mit dem **Application Audience (AUD) Tag** in Cloudflare Zero Trust → Access controls → Applications übereinstimmen. Änderungen dort erfordern `systemctl --user restart ha-safe-mcp-ui.service`. Status: `systemctl --user status ha-safe-mcp-ui.service`; Rückbau: `systemctl --user disable --now ha-safe-mcp-ui.service` (die `.env` mit HA-Token bleibt unberührt). Ohne gültigen Token liefert der Origin 403; über die öffentliche Domain führt Cloudflare zuerst zum Login. Echte Anmeldung und Setup mit dem HA-Token separat prüfen.

### 7.5 Kommandozeile

Die Kommandozeile ist die Alternative ohne Browser:

```bash
ollama pull qwen2.5-coder:7b
cd ha-mcp-local   # Klon dieses Repositorys
.venv/bin/ha-ollama-chat 'Finde verfügbare Licht-Entitäten und nenne nur geprüfte IDs.'
```

Der Client nutzt standardmäßig `http://127.0.0.1:11434`; `--model` und `--ollama-url` lassen sich anpassen. Er zeigt bei normalem Start **nur Lesetools** an und wählt bei Stichworten passende Tools aus; diese Vorauswahl ist **keine** zuverlässige Aufgabenplanung. Für einen Write müssen **beide** Bedingungen gelten: passende Server-Schalter in `.env` und `--allow-write` am Chat-Aufruf. **Zusätzlich** zeigt das Programm vor **jedem einzelnen Write-Tool-Aufruf** Namen und JSON-Argumente an und verlangt die exakte Eingabe `JA`; alles andere verweigert den Aufruf. Beispiel erst nach bewusster Freigabe und nur mit einer zuvor gefundenen Test-Entität:

```bash
.venv/bin/ha-ollama-chat --allow-write 'Bitte zuerst ha_search_entities nutzen; schalte nur die von mir bestätigte Test-Entität ein.'
```

Ohne konkret bestätigte ID **nicht `JA` eingeben**. Ein Modell kann Entity-IDs oder Argumente erfinden; „JA“ ist eine Freigabe für den **angezeigten JSON-Payload**, keine allgemeine Erlaubnis. Keine Garantie auf vollständige Modellantwort bei Erreichen des Rundenlimits. Andere MCP-Clients haben diese `JA`-Abfrage nicht automatisch. [Ollama-Client-Implementierung](../src/ha_safe_mcp/ollama_client.py).

## 8. Beispielabläufe mit exakten Tool-Argumenten

Jeder Block bezeichnet **einen MCP-Tool-Aufruf**; JSON ist der Argument-Body. Platzhalter wie `light.beispiel`, `input_boolean.beispiel`, `beispiel-test` und `beispiel_automation` bezeichnen **keine behaupteten existierenden Entitäten oder IDs**. Bei Bedarf erst auf der Testinstanz auslesen, dann **nur dort** ersetzen. Für Schreibbeispiele zunächst Backup/Plan, Schalter und Client-Freigabe nach Kapitel 6–9 prüfen. Nicht alle HA-Installationen haben jede Domain/Integration aktiviert.

### 8.1 Zustände entdecken und lesen (ohne Write)

1. `ha_search_entities` (liefert `entity_id`, `state`, `friendly_name`):

   ```json
   {"query":"beispiel","domain":"light","limit":10}
   ```

2. `ha_get_state` (ID **aus Schritt 1** übernehmen):

   ```json
   {"entity_id":"light.beispiel"}
   ```

`ha_get_state` gibt HA-Zustand und Attribute zurück; eine ID, die es nicht gibt, liefert einen HA-Fehler. Die Suche ruft `/api/states` ab und filtert lokal; `limit` muss zwischen 1 und 200 liegen. [Server](../src/ha_safe_mcp/server.py) · [HA-States-API](https://developers.home-assistant.io/docs/api/rest/).

### 8.2 Einzelne Dienstaktion (Write)

Erst `ha_list_services` mit `{"domain":"light"}` und `ha_get_state` für die gewählte ID. Nur falls ein Testlicht **wirklich** vorhanden und `HA_ALLOW_WRITE=true` gesetzt ist:

- `ha_call_service`:

  ```json
  {"domain":"light","service":"turn_on","entity_id":"light.beispiel","service_data":{}}
  ```

Das ist eine reale Geräteaktion, **kein** Dry Run. Keine Gruppen-/Bereichs-/Geräteziele und keine anderen Domains ohne bewusste Allowlist-Anpassung. Die gleiche Aktion über `ha_rest_write` zeigt Abschnitt 8.7. [Dienst-Validierung](../src/ha_safe_mcp/server.py) · [HA-Actions](https://www.home-assistant.io/docs/scripts/perform-actions/).

### 8.3 Automation prüfen, lesen und gegebenenfalls speichern

`config_id` ist die **Konfigurations-ID**, nicht die Entity-ID `automation.*`. Beispiel-Config mit bewusst leerer Aktionsliste: HA kann je nach Version/Schema weitere Felder verlangen; Ergebnis der Validierung prüfen, bevor geschrieben wird.

- `ha_validate_automation` (lesend; HA-Validierung der vorhandenen `triggers`/`conditions`/`actions`):

  ```json
  {"config":{"alias":"Beispiel ohne Aktion","triggers":[{"trigger":"state","entity_id":"input_boolean.beispiel","to":"on"}],"conditions":[],"actions":[]}}
  ```

- `ha_get_automation` zum Sichern der vorhandenen Konfiguration (nur wenn die ID bereits existiert):

  ```json
  {"config_id":"beispiel_automation"}
  ```

- `ha_save_automation` **nur mit Admin-Write** und bewusst gewählter ID; zuerst HA-validieren, dann speichern und zurücklesen:

  ```json
  {"config_id":"beispiel_automation","config":{"alias":"Beispiel ohne Aktion","triggers":[{"trigger":"state","entity_id":"input_boolean.beispiel","to":"on"}],"conditions":[],"actions":[]}}
  ```

Die Config darf kein eigenes `id` überschreiben und muss ein nichtleeres `alias` enthalten. Die Rücklesung prüft ID/Alias, **nicht**, ob ein asynchroner HA-Reload beendet ist oder die Automation ausgeführt wurde. `ha_delete_automation` mit `{"config_id":"beispiel_automation"}` verlangt zusätzlich Delete-Freigabe. Auch „leere Aktionen“ können eine Automation anlegen/überschreiben; nur isoliert testen. [Verwaltung](../src/ha_safe_mcp/management.py) · [HA-Automationen](https://www.home-assistant.io/docs/automation/).

### 8.4 Storage-Dashboard sicher bearbeiten

- `ha_list_dashboards` mit `{}` aufrufen; für bestehende Dashboards `url_path`/`id` **aus der Antwort** verwenden.
- `ha_get_dashboard` mit `{"url_path":"beispiel-test"}` liest die Views eines **bereits existierenden Storage-Dashboards**; `{}` liest das Standard-Dashboard, falls HA es in dieser Form bereitstellt.
- `ha_create_dashboard` (Admin-Write) mit `{"title":"Beispiel Test","url_path":"beispiel-test"}` erzeugt einen Eintrag. Der Pfad benötigt Kleinbuchstaben/Ziffern und mindestens einen Bindestrich; er muss frei sein.
- `ha_save_dashboard` (Admin-Write), **erst nach** Erzeugung und Sicherung der vorherigen Konfiguration:

  ```json
  {"url_path":"beispiel-test","config":{"views":[{"title":"Test","path":"test","cards":[]}]}}
  ```

`ha_save_dashboard` liest vorher (oder erhält `null`, falls Konfiguration fehlt) und gibt `{"previous": ..., "config": ...}` zurück: `previous` **selbst sicher aufbewahren**, es ist **kein automatischer Rollback**. Die aktuelle Konfiguration wird auf exakte Gleichheit rückgelesen. `ha_update_dashboard` ändert **nur Metadaten**, nicht Views, und braucht die Collection-ID aus `ha_list_dashboards`, z. B. `{"dashboard_id":"beispiel_test","changes":{"title":"Neuer Testtitel"}}` **nur wenn genau diese ID zurückkam**. `ha_delete_dashboard` mit `{"dashboard_id":"beispiel_test"}` braucht Delete-Freigabe. Das Standard-Dashboard nicht als erste Schreibübung verwenden. [Verwaltung](../src/ha_safe_mcp/management.py) · [HA-Dashboards](https://www.home-assistant.io/dashboards/).

### 8.5 Persistenten Helper anlegen und prüfen

Unterstützt sind **nur** `input_boolean`, `input_number`, `input_select`, `input_text`, `input_datetime`. Zuerst `ha_list_helpers` mit `{"domain":"input_boolean"}`. Beispiel nach Admin-Write-Freigabe:

- `ha_create_helper`:

  ```json
  {"domain":"input_boolean","config":{"name":"Beispiel Testschalter"}}
  ```

Nach dem Anlegen die Antwort-ID und `ha_list_helpers` auswerten; **`helper_id` ist die Collection-ID**, nicht automatisch die `entity_id`. Beispiel-Update nur wenn `beispiel_testschalter` tatsächlich als `id` gelistet wird:

- `ha_update_helper`:

  ```json
  {"domain":"input_boolean","helper_id":"beispiel_testschalter","config":{"name":"Beispiel Testschalter neu"}}
  ```

Für Updates eine **vollständige Konfiguration mit `name`** liefern und vorhandene wichtige Felder aus der Liste übernehmen. `id`, `entity_id`, `type` gehören **nicht** in `config`. `input_number` benötigt `min`/`max`, `input_select` nichtleere `options`, `input_datetime` `has_date` und/oder `has_time`. Löschen nur nach Sicherung und Freigabe: `ha_delete_helper` mit `{"domain":"input_boolean","helper_id":"beispiel_testschalter"}`. [Verwaltung](../src/ha_safe_mcp/management.py) · [HA-Helper](https://www.home-assistant.io/integrations/input_boolean/).

### 8.5a Bereiche, Etagen und Geräte ordnen

Typischer Ablauf, z. B. im Chat mit „Aktionen erlauben“: *„Lege einen Bereich Flur an und ordne das Gerät Forecast diesem Bereich zu.“* Das Modell ruft nacheinander:

```json
{"tool": "ha_create_area", "arguments": {"name": "Flur", "icon": "mdi:door"}}
```

```json
{"tool": "ha_list_devices", "arguments": {"query": "Forecast"}}
```

```json
{"tool": "ha_update_device", "arguments": {"device_id": "<device_id aus der Liste>", "changes": {"area_id": "flur"}}}
```

Jeder Schreibaufruf erscheint als eigene Freigabe-Karte. Hinweise:

- `device_id` ist eine 32-stellige Kennung aus `ha_list_devices`, nie der Gerätename. Ein unbekannter `area_id` wird abgelehnt, statt still einen leeren Bereich zu setzen.
- `ha_list_devices` mit `area_id: "none"` zeigt alle Geräte **ohne** Bereich – gut für das Aufräumen.
- `changes` beim Gerät: `area_id` (oder `null` zum Entfernen), `name_by_user` (eigener Name, `null` = Herstellername), `disabled_by` (`"user"` = deaktivieren, `null` = aktivieren), `labels`.
- Etagen: `ha_create_floor` (`name`, `level` z. B. 0 für Erdgeschoss), dann Bereich mit `ha_update_area` und `{"floor_id": "<floor_id>"}` zuordnen.
- Löschen (`ha_delete_area`, `ha_delete_floor`) braucht „Löschen erlauben“. Geräte und Entitäten bleiben erhalten und verlieren nur die Zuordnung.
- Geräte entfernen geht hier nicht; dafür die Integration löschen oder die HA-Oberfläche nutzen.

### 8.5b Szenen und Skripte

Szene anlegen (Chat mit „Aktionen erlauben“: *„Lege eine Szene Abendstimmung an, in der light.flur auf 40 % gedimmt ist“*):

```json
{"tool": "ha_save_scene", "arguments": {"scene_id": "abendstimmung", "config": {"name": "Abendstimmung", "entities": {"light.flur": {"state": "on", "brightness": 100}}}}}
```

Skript anlegen:

```json
{"tool": "ha_save_script", "arguments": {"script_id": "gute_nacht", "config": {"alias": "Gute Nacht", "sequence": [{"action": "light.turn_off", "target": {"entity_id": "light.flur"}}], "mode": "single"}}}
```

- `scene_id` und `script_id` sind kurze IDs (Kleinbuchstaben, Ziffern, `_`). Die Entität heißt danach `scene.<…>` bzw. `script.<script_id>`; bei Szenen bildet HA die Entitäts-ID aus dem **Namen**.
- Der MCP lehnt Szenen mit unbekannten Entitäten und Skripte mit unbekannten Diensten ab, bevor etwas gespeichert wird. Platzhalter wie `light.your_light` landen also nicht in HA.
- Das Ergebnis enthält `previous` (alte Fassung oder `null`). Zum Zurücksetzen `previous` erneut mit `ha_save_scene`/`ha_save_script` speichern.
- **Aktivieren** (`ha_activate_scene`) und **Starten** (`ha_run_script`) schalten echte Geräte. Dafür in den Einstellungen bei „Erlaubte Domains“ `scene` bzw. `script` ergänzen. Achtung: ein Skript darf intern beliebige Dienste aufrufen, auch außerhalb der erlaubten Domains – deshalb `script` nur freigeben, wenn die Skripte bekannt sind.
- Nur Szenen und Skripte aus der Oberfläche (`scenes.yaml`/`scripts.yaml`) sind bearbeitbar; YAML-Pakete nicht (`ha_list_scenes` zeigt `editable: false`).

### 8.6 Entity Registry: nur Metadaten, keine Erzeugung

`ha_list_entity_registry` mit `{}` lesen. Nur eine **tatsächlich gelistete** `entity_id` wählen; bei Admin-Write-Freigabe etwa:

- `ha_update_entity_registry`:

  ```json
  {"entity_id":"light.beispiel","changes":{"name":"Testlicht"}}
  ```

Erlaubte Felder: `name`, `area_id`, `icon`; keine neue Entity-ID, keine Serviceaktion, kein Registry-Delete-Tool. Vorherigen Namen und gegebenenfalls Bereich/Icon dokumentieren. [Verwaltung](../src/ha_safe_mcp/management.py) · [HA Entity Registry](https://developers.home-assistant.io/docs/entity_registry_index/).

### 8.6a Integration hinzufügen (z. B. Shelly) mit Zugangsdaten

1. **Zugangsdaten anlegen** (nur nötig, wenn das Gerät ein Passwort hat): Weboberfläche → **Zugangsdaten** → Alias, z. B. `shelly_login`, und Passwort eintragen → **Speichern**. Der Wert liegt verschlüsselt in `~/.config/ha-safe-mcp/credentials/` (Ordner 0700, Dateien 0600) und wird nie wieder angezeigt; in der Liste stehen nur Alias, Bezeichnung und Feldnamen.
2. **Im Chat** mit gesetztem Häkchen „Aktionen erlauben“, z. B.: „Füge den Shelly mit der IP 192.168.1.50 hinzu, Zugangsdaten shelly_login“. Das Modell nutzt dann nacheinander:
   - `ha_start_integration_setup` mit `{"handler":"shelly"}` → liefert Formular (`data_schema`) und `flow_id`
   - `ha_integration_setup_step` mit `{"flow_id":"<aus dem Ergebnis>","data":{"host":"192.168.1.50"}}`
   - fragt das Gerät nach einem Passwort: `ha_integration_setup_step` mit `{"flow_id":"<…>","data":{"password":{"$credential":"shelly_login","field":"password"}}}`
   - kann die Einrichtung nicht abgeschlossen werden: `ha_abort_integration_setup` mit `{"flow_id":"<…>"}`
   Jeder dieser Schritte erscheint als eigene Freigabe-Karte. Auf der Karte siehst du nur den Verweis, nie das Passwort.
3. **Prüfen:** „Welche Integrationen gibt es?“ (`ha_list_integrations`); Entfernen bei Bedarf mit `ha_delete_integration` und der `entry_id` aus der Liste (braucht „Löschen erlauben“).

**Wichtig:** Der MCP **durchsucht das Netzwerk nicht selbst**. „Suche im Netzwerk“ heißt hier: `ha_list_discovered` zeigt, was Home Assistant selbst gefunden hat (zeroconf/DHCP/SSDP) und was auf Bestätigung wartet; für die Bestätigung ruft das Modell `ha_integration_setup_step` mit `{}` auf. Läuft HA in einem Docker-Container ohne Host-Netzwerk (wie `ha-mcp-dev`), findet HA dort keine Geräte – dann die IP angeben. Passwörter im Chat-Text lehnt die Oberfläche ab, bevor sie beim Modell oder im Verlauf landen.

### 8.6b Integrations-Einstellungen ändern

Chat mit „Aktionen erlauben“, z. B. *„Ändere bei der Integration Workday Sensor DE die Arbeitstage auf Montag bis Donnerstag“*:

1. `ha_list_integrations` zeigt je Eintrag `supports_options` (Zahnrad „Konfigurieren“ in HA) und `supports_reconfigure` (Verbindungsdaten ändern).
2. `ha_start_integration_options` mit `{"entry_id":"<aus der Liste>"}` → Formular; jedes Feld zeigt den aktuellen Wert als `current`, `default` ist nur der Werkswert.
3. `ha_integration_options_step` mit nur den geänderten Feldern, z. B. `{"flow_id":"<…>","data":{"workdays":["mon","tue","wed","thu"]}}`. Nicht genannte Felder behält der MCP bei und meldet sie in `kept_current`. Abbrechen ohne Speichern: `ha_abort_integration_options`.

Weitere Einstellungen:

- **Neu konfigurieren** (z. B. neue IP oder neue Feed-Adresse, nur bei `supports_reconfigure: true`): `ha_start_integration_reconfigure`, dann `ha_integration_setup_step`. HA meldet Erfolg als `abort` mit `reason: reconfigure_successful`.
- **Umbenennen und Systemoptionen:** `ha_update_integration` mit `{"entry_id":"<…>","changes":{"title":"Steckdose Flur"}}`; außerdem `pref_disable_polling` (Abfrage aus) und `pref_disable_new_entities` (neue Entitäten nicht automatisch hinzufügen).
- **Deaktivieren/Aktivieren:** `ha_set_integration_disabled` mit `{"entry_id":"<…>","disabled":true}`; die Entitäten sind dann nicht verfügbar, die Einrichtung bleibt erhalten.

Alles braucht „Konfiguration ändern“ (Admin-Write); jeder Schritt erscheint als Freigabe-Karte. Geheime Felder zeigen nie ihren Wert; ändern nur als Verweis auf einen Eintrag unter „Zugangsdaten“.

### 8.7 REST-Katalog: ausdrücklich erlaubte Methoden und Routen

1. `ha_rest_catalog` mit `{}` lesen; Pfad-Templates und Klassen prüfen.
2. `ha_rest_query` (GET), zum Beispiel **ohne echte ID**:

   ```json
   {"path":"/api/config","method":"GET"}
   ```

   History benötigt einen Filter für eine **zuvor gefundene** Entity-ID:

   ```json
   {"path":"/api/history/period","query":{"filter_entity_id":"sensor.beispiel"}}
   ```

   Die beiden zugelassenen POST-Lesevarianten sind `/api/template` und `/api/config/core/check_config`; z. B. `ha_rest_query` mit `{"path":"/api/config/core/check_config","method":"POST"}`. Auch dies kann HA-Arbeit auslösen. Abfrageparameter werden nur pro Route laut [REST-Gateway](../src/ha_safe_mcp/rest_api.py) akzeptiert.
3. `ha_rest_write` ist **nie** Standard: Dienstaufruf mit Einzelziel und `HA_ALLOW_WRITE=true` (als Alternative zu 8.2):

   ```json
   {"path":"/api/services/light/turn_on","body":{"entity_id":"light.beispiel"}}
   ```

   Eine administrative **Zustandsänderung**, keine permanente Entität, benötigt zusätzlich `HA_ALLOW_ADMIN_WRITE=true`; nicht für physische Geräte als Ersatz für den Dienstaufruf verwenden:

   ```json
   {"path":"/api/states/sensor.beispiel_test","body":{"state":"probe"}}
   ```

4. `ha_rest_delete` löscht **nur** die erlaubte REST-State-Route, benötigt alle drei Schalter und die richtige ID. Das folgende JSON ist **nur ein Formatbeispiel**, nicht ohne bestätigten Zustand ausführen:

   ```json
   {"path":"/api/states/sensor.beispiel_test"}
   ```

Unbekannte Routen, Traversal und nicht erlaubte Query-Keys werden abgelehnt. REST-Antworten enthalten `status`, `content_type`, `data`; Kamerabilder kommen als `data_base64`. Die maximale Antwortgröße beträgt 2 MB, der Request-Body ist begrenzt. `/api/events/...` und `/api/intent/handle` sind administrative Writes mit möglichen HA-Nebeneffekten: nicht als harmlose Leseproben benutzen. [REST-Gateway](../src/ha_safe_mcp/rest_api.py) · [offizielle REST-Referenz](https://developers.home-assistant.io/docs/api/rest/).

## 9. Sicherung, Prüfung und Rückweg

Vor jeder Änderung auf der **isolierten** Instanz: Ziel und erwarteten Zustand lesend ermitteln; für bestehende Automation `ha_get_automation`, für Dashboard `ha_get_dashboard`, für Helper `ha_list_helpers`, für Registry `ha_list_entity_registry` sichern (ohne Token oder sensible Antwortdaten zu veröffentlichen). Vorher ein Backup mit `ha_create_backup` (oder im Reiter **Backups**) anlegen und prüfen, dass es in `ha_list_backups` erscheint; Wiederherstellen geht nur in der HA-Oberfläche. Home Assistant beschreibt Backups und Wiederherstellung in [Common tasks](https://www.home-assistant.io/common-tasks/general/#backups); beim Container das persistente Volume **`ha-mcp-dev-config`** nicht löschen und eine Volume-Sicherung nur nach geeigneter, konsistenter Backup-Prozedur vornehmen. Kein produktives Home Assistant für Experimente verwenden.

Nach einem Write mit dem passenden Lesetool prüfen; eine erfolgreiche Tool-Rückgabe ist keine Garantie für wirksame Geräteaktion, fertigen Automation-Reload oder langfristige Persistenz. Rollback ist **manuell**: vorher gesicherte Dashboard-Konfiguration erneut mit `ha_save_dashboard` setzen; Automation mit gesicherter Config (ohne `id`-Feld) erneut `ha_save_automation` übermitteln; Helper/Registry-Metadaten anhand gesicherter Werte korrigieren. Gelöschte Objekte müssen ggf. aus Backup oder manuell wiederhergestellt werden. `ha_save_dashboard` liefert zwar `previous`, speichert es aber nicht selbst dauerhaft. Wer den alten Stand als Datei behalten will, lässt sich ihn im Chat als YAML-Codeblock ausgeben: er landet dann unter **Dateien**. Für den Rückweg bleiben die entsprechenden Write-Schalter und HA-Rechte notwendig. [Verwaltung](../src/ha_safe_mcp/management.py) · [HA-Backup-Hilfe](https://www.home-assistant.io/common-tasks/general/#backups).

## 10. Fehlersuche

| Symptom | Prüfung / sichere Abhilfe |
|---|---|
| `HA_TOKEN is required` oder 401 | Token im **lokalen** `.env` setzen bzw. im HA-Profil erneuern; `cwd` und eventuell vorrangige Prozessumgebung prüfen. Token nie ins Ticket kopieren. [Authentifizierung](https://www.home-assistant.io/docs/authentication/). |
| 403 oder WebSocket-`unauthorized` | HA-Benutzerrechte/Admin-Status und Token prüfen; Adapter-Schalter gewähren **keine** HA-Rechte. [Authentifizierung](https://www.home-assistant.io/docs/authentication/). |
| Verbindungsfehler/Timeout | Browser auf demselben Host: `http://127.0.0.1:8123`; Containerstatus und Portbindung prüfen; bei Remote-/Container-Client stimmt dessen `localhost` nicht mit dem HA-Host überein. [HA-REST](https://developers.home-assistant.io/docs/api/rest/). |
| `writes disabled`, `admin write disabled`, `delete disabled` | Schalter aus Kapitel 6 prüfen, Prozess **neu starten**; nur für beabsichtigte Testaktion freigeben. [Code](../src/ha_safe_mcp/server.py). |
| `domain not allowed`, `entity_id domain must match`, `service_data ... alternate targets` | `ha_search_entities` und `ha_list_services` lesen; passende Einzel-Entität und Domain wählen, Target-Felder aus `service_data` entfernen. [Code](../src/ha_safe_mcp/server.py). |
| `route/method not in documented REST catalog`, `unsupported query parameter` | Erst `ha_rest_catalog`; echte Pfadstruktur und route-spezifische Parameter prüfen, keine freie URL übergeben. [REST-Katalog](../src/ha_safe_mcp/rest_api.py). |
| Automation/Dashboard/Helper wird abgelehnt | Validierung/HA-Fehler prüfen, vorhandene ID von Collection-ID/URL-Pfad unterscheiden, nur Storage-Dashboard verwenden; Core-Verwaltungs-APIs können sich zwischen HA-Versionen ändern. [Verwaltung](../src/ha_safe_mcp/management.py). |
| Ollama bietet kein gewünschtes Tool an oder beendet ohne Antwort | Thema oder **exakten Toolnamen** im Prompt nennen; Modell mit Tool-Unterstützung prüfen, bei komplexen Aufgaben MCP-Client direkt benutzen. `--allow-write` nur bewusst einsetzen. [Ollama-Client](../src/ha_safe_mcp/ollama_client.py). |
| Weboberfläche: „Ungültiger Host“ (400), „Nur lokal erreichbar“ oder „Cloudflare Access Anmeldung erforderlich“ (403) | Beim geschützten Dienst `https://mcp.example.com/` nutzen; die direkte lokale Adresse ist ohne gültige Access-Assertion absichtlich gesperrt. Tunnel-Ziel, Access-Login, AUD-Tag und Dienststatus prüfen. [Weboberfläche](../src/ha_safe_mcp/web.py). |
| Weboberfläche: „Ollama ist nicht erreichbar“ | Läuft der Ollama-Dienst, stimmt die Adresse in den Einstellungen? Ist das gewählte Modell installiert (`ollama list`)? |
| Weboberfläche: Häkchen „Aktionen erlauben“ ist ausgegraut | In den Einstellungen zuerst „Steuern erlauben“ aktivieren und speichern. |
| Anlegen/Ändern/Schalten passiert nicht; das Modell verweist auf „Aktionen erlauben“ | Ohne das Häkchen bekommt das Modell nur Lese-Tools. Häkchen setzen und die Anfrage erneut senden; danach erscheint die Freigabe-Karte. |
| Weboberfläche: „Für 'Konfiguration ändern' braucht der Token einen Admin-Benutzer“ | Token eines HA-Admins verwenden oder ohne Konfigurationsrechte speichern. |
| Modell antwortet aus dem Verlauf statt aktuell nachzusehen | Kleine Modelle verlassen sich manchmal auf frühere Antworten. **Neu** starten oder ausdrücklich „prüfe den aktuellen Zustand“ schreiben. |

## 11. FAQ

**Kann das Tool eine neue Integration oder beliebige Entität anlegen?** Nein. Nur die fünf genannten persistenten Helper-Collections können Helper anlegen. Registry-Update ändert Metadaten; REST-`POST /api/states/...` setzt einen Zustand, keine persistente HA-Integration. [Verwaltung](../src/ha_safe_mcp/management.py) · [REST-API](https://developers.home-assistant.io/docs/api/rest/).

**Ist `HA_ALLOW_WRITE=true` eine globale Bestätigung?** Nein. Es aktiviert bestimmte Toolklassen im Server. Für Verwaltungsaktionen braucht es zusätzlich Admin-Write; für Deletes zusätzlich Delete. Nur der mitgelieferte Ollama-Client verlangt mit `--allow-write` noch einmal **`JA` pro Write**. Andere MCP-Clients benötigen eigene Freigaberegeln. [Server](../src/ha_safe_mcp/server.py) · [Ollama-Client](../src/ha_safe_mcp/ollama_client.py).

**Muss ich einen GitHub-Token einrichten?** Nein, für den HA-MCP-Betrieb nicht. Nur einen HA-Long-lived Access Token verwenden; keine anderen Credentials ins Modell oder an HA reichen. [README](../README.md) · [HA-Authentifizierung](https://www.home-assistant.io/docs/authentication/).

**Kann ich ein bestehendes Dashboard gefahrlos überschreiben?** Nein. Vorher `ha_get_dashboard`, extern gesicherte Kopie und HA-Backup; `ha_save_dashboard` überschreibt Konfiguration und liefert `previous` lediglich als Antwort. [Verwaltung](../src/ha_safe_mcp/management.py) · [Backups](https://www.home-assistant.io/common-tasks/general/#backups).

**Warum schlägt ein vermeintlich lesender REST-Aufruf fehl?** `ha_rest_query` akzeptiert nur katalogisierte GET-Routen sowie genau zwei POST-Sonderfälle; History verlangt `filter_entity_id`, Kalender `start` und `end`. Berechtigungen und aktivierte HA-Funktionen bleiben nötig. [REST-Gateway](../src/ha_safe_mcp/rest_api.py) · [HA-REST](https://developers.home-assistant.io/docs/api/rest/).

## Weiterführende Links

- [Projekt-README](../README.md), [Server/Tool-Signaturen](../src/ha_safe_mcp/server.py), [Verwaltungslogik](../src/ha_safe_mcp/management.py), [REST-Katalog](../src/ha_safe_mcp/rest_api.py), [Ollama-Adapter](../src/ha_safe_mcp/ollama_client.py)
- [Home Assistant: Authentifizierung](https://www.home-assistant.io/docs/authentication/), [REST-API](https://developers.home-assistant.io/docs/api/rest/), [WebSocket-API](https://developers.home-assistant.io/docs/api/websocket/), [Backups](https://www.home-assistant.io/common-tasks/general/#backups)
- [Home Assistant: Automationen](https://www.home-assistant.io/docs/automation/), [Dashboards](https://www.home-assistant.io/dashboards/), [Entity Registry](https://developers.home-assistant.io/docs/entity_registry_index/), [Ollama-Dokumentation](https://docs.ollama.com/)
