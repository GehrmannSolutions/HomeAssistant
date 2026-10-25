# Technische Architektur und Entwicklerhandbuch

**Deutsch** · [English](TECHNICAL.md)

Dieses Dokument beschreibt die Implementierung in [`src/ha_safe_mcp/`](../src/ha_safe_mcp/), nicht alles, was Home Assistant (HA) bietet. Zur Einrichtung siehe [INSTALL.de.md](INSTALL.de.md), zum Betrieb [USER_GUIDE.de.md](USER_GUIDE.de.md) und zu den registrierten MCP-Werkzeugen und ihren Schaltern die [Werkzeug-Referenz (englisch)](TOOLS.md). Ob eine Operation gelingt, hängt außerdem von der laufenden HA-Core-Version und den eigenen Rechten des HA-Tokens ab. Die Weboberfläche ist zweisprachig (siehe [Sprachen](#sprachen-englisch-und-deutsch)); Anweisungen an das Modell sind englisch.

## Prozesse, Vertrauensgrenzen und Datenfluss

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

- [`server.main()`](../src/ha_safe_mcp/server.py) lädt nur die `.env` im **aktuellen Arbeitsverzeichnis** (`Path.cwd() / ".env"`, ohne übergeordnete Verzeichnisse zu durchsuchen) in die Prozessumgebung, erzeugt einen `HAClient` und `FastMCP` und läuft dann über **stdio**. Er lauscht nicht auf MCP über HTTP. Die Werkzeuge werden auch dann registriert, wenn Schreibzugriffe deaktiviert sind; die Schalter werden erst beim Aufruf geprüft. `python -m ha_safe_mcp` verwendet [`__main__.py`](../src/ha_safe_mcp/__main__.py).
- [`HAClient`](../src/ha_safe_mcp/server.py) sendet HTTP-Anfragen mit Bearer-Token für Zustände, Dienste und ausgewählte Konfigurationsoperationen. [`RestGateway`](../src/ha_safe_mcp/rest_api.py) bearbeitet nur seinen eigenen, exakt festgelegten Katalog. [`HAWebSocket`](../src/ha_safe_mcp/management.py) authentifiziert sich mit demselben Token an HAs `/api/websocket`, öffnet pro Befehl eine neue Verbindung und erwartet ein passendes `result`. Die Autorisierung durch HA ist eine zusätzliche Grenze und wird durch die Schalter des Adapters nicht ersetzt.
- [`ha-ollama-chat`](../src/ha_safe_mcp/ollama_client.py) ist ein optionaler CLI-MCP-Client, kein weiterer Transport. Er startet einen stdio-Kindprozess, listet die MCP-Werkzeuge auf, bietet eine vom Prompt abhängige Teilmenge als Ollama-Funktionsschemas an, führt erlaubte Aufrufe aus und gibt gekürzte Werkzeugergebnisse an den konfigurierten Ollama-Endpunkt zurück. Der HA-Token wird an den MCP-Kindprozess übergeben und nicht in die Funktionsschemas aufgenommen, aber **Werkzeugergebnisse und Prompts erreichen den konfigurierten Ollama-Server**. Die Heuristik zur Werkzeugauswahl kann ein relevantes Werkzeug auslassen; sie ist keine Sicherheitsgrenze. Die Schleife ist begrenzt und verwendet nicht-streamende Ollama-Antworten.
- [`ha-mcp-ui`](../src/ha_safe_mcp/web.py) ist ein separater Starlette-HTTP-Dienst, standardmäßig an Loopback gebunden; er ist **kein HTTP-MCP-Endpunkt**. Der Browser startet einen Chat, fragt Lauf-Ereignisse ab und entscheidet über Schreibfreigaben. Für jeden Chat-Durchgang erzeugt die UI einen stdio-MCP-Kindprozess und ruft dieselbe Ollama-Werkzeugschleife auf. Der Kindprozess erhält ausdrücklich übergebene HA-Einstellungen sowie die Speicherorte der Verzeichnisse für Zugangsdaten und Audit; die Einstellungen zur automatischen Freigabe bleiben in der UI. [`chat_runs.py`](../src/ha_safe_mcp/chat_runs.py) verwaltet einen aktiven Lauf, Ereignisse im Arbeitsspeicher, einmalig verwendbare Freigaben, Zeitüberschreitungen und Abbruch. Läufe überstehen keinen Neustart.
- Die UI hat außerdem direkte, durch Schalter geschützte Endpunkte zum Auflisten, Erstellen, Löschen und Herunterladen von Backups, die dieselbe Implementierung [`HABackups`](../src/ha_safe_mcp/backups.py) verwenden. Ein Download wird von HA zum Browser durchgestreamt, statt auf dem Server eine Backup-Datei anzulegen. Es gibt keinen Endpunkt und kein MCP-Werkzeug zur Wiederherstellung.

## Übersicht der Komponenten

| Quelle | Zuständigkeit |
| --- | --- |
| [`server.py`](../src/ha_safe_mcp/server.py), [`__main__.py`](../src/ha_safe_mcp/__main__.py) | FastMCP-Registrierung, stdio-Einstiegspunkt, `HAClient`, Prüfung der Dienstziele, Audit-Wrapper für Werkzeuge; Zurücklesen der Aktionsziele (`read_back`, erwartete Zustände pro Domain/Dienst) |
| [`rest_api.py`](../src/ha_safe_mcp/rest_api.py) | Katalog aus Methode/Pfad/Query, Berechtigungsklassen, Verarbeitung der Antworten |
| [`management.py`](../src/ha_safe_mcp/management.py) | Authentifizierter WS-Transport mit Erlaubnisliste; typisierte Operationen für Automationen, Dashboards, Helfer und die Entitäten-Registry |
| [`integrations.py`](../src/ha_safe_mcp/integrations.py) | HTTP-Abläufe für Config Entries und typisierte WS-Einstellungen von Einträgen; Auflösung von Zugangsdaten-Referenzen und Reduzierung der Ergebnisse; Helfer-Typen (`flow_handlers?type=helper`), durch einen Ablauf erzeugte Einträge werden im Journal erfasst |
| [`scenes.py`](../src/ha_safe_mcp/scenes.py) | Konfigurations-HTTP für Szenen/Skripte, Vorabprüfungen, Zurücklesen und Dienstaufruf |
| [`registry.py`](../src/ha_safe_mcp/registry.py) | WS-Operationen für Bereiche/Etagen/Geräte und Ansicht der Entitäten eines Bereichs |
| [`backups.py`](../src/ha_safe_mcp/backups.py) | WS-Operationen für HA-Backups und Streaming-Download über eine Erlaubnisliste |
| [`oauth.py`](../src/ha_safe_mcp/oauth.py), [`webui/oauth.html`](../src/ha_safe_mcp/webui/oauth.html) | OAuth-2.1-Autorisierungsserver für den entfernten Endpunkt: Metadaten, dynamische Registrierung, Zustimmung, PKCE-Code-Flow, Rotation der Refresh-Tokens |
| [`domains.py`](../src/ha_safe_mcp/domains.py), [`webui/domains.js`](../src/ha_safe_mcp/webui/domains.js) | Bezeichnungen und Risikohinweise für Domains; `/api/domains` (nur lesend: Zustände und Dienste des verbundenen HA) als Datenquelle für die Domain-Auswahl |
| [`diagnostics.py`](../src/ha_safe_mcp/diagnostics.py) | Nur lesende Fehlersuche: Traces, Systemprotokoll, Logbuch, Verlauf, Statistiken, Reparaturen, Systemzustand (WS-Abonnement, gesammelt bis `finish`), Rendern von Templates, Tests von Bedingungen; Zeitstempel werden in die Zeitzone von HA umgerechnet |
| [`config_files.py`](../src/ha_safe_mcp/config_files.py) | Konfigurationsdateien: `LocalFiles` (`HA_CONFIG_DIR`, keine Symlinks, atomares Ersetzen) oder `IngressFiles` (File-editor-Add-on `core_configurator`: WS `supervisor/api` GET `/addons/core_configurator/info` + POST `/ingress/session`, danach `/api/listdir`, `/api/file`, `/api/save`, `/api/newfolder`, `/api/delete` des Add-ons mit dem Cookie `ingress_session`); Pfadrichtlinie, Maskierung von Zugangsdaten (`__REDACTED_n__`), YAML-/JSON-Syntaxprüfung, HA-Konfigurationsprüfung vorher/nachher mit Zurücksetzen bei neuen Fehlern oder Warnungen; Journal-Art `file` |
| [`ecosystem.py`](../src/ha_safe_mcp/ecosystem.py) | Nur lesend: Add-ons/Systeminformationen (WS `supervisor/api`, GET auf fünf feste Endpunkte, zusätzlich in `HAWebSocket` erzwungen), HACS (`hacs/repositories/list`), ZHA (`zha/devices`), Thread (`thread/list_datasets`); Kennungen und Netzwerkgeheimnisse werden entfernt |
| [`weather.py`](../src/ha_safe_mcp/weather.py) | Aktuelles Wetter und Vorhersage aus der Dienst-Antwort von `weather.get_forecasts` (`?return_response`), Zeiten in der Zeitzone von HA |
| [`customize.py`](../src/ha_safe_mcp/customize.py) | Blueprints (WS `blueprint/list|import|save|delete`, nur https-URLs, kein Überschreiben), Themes (`frontend/get_themes`, Admin-Dienst `frontend.set_theme`), Dashboard-Ressourcen (`lovelace/resources[/create|delete]`, nur Pfade derselben Origin) |
| [`system.py`](../src/ha_safe_mcp/system.py) | Update-Entitäten (Zustände, WS `update/release_notes`, `update.install|skip|clear_skipped`), Reload-Dienste, ermittelt aus `/api/services`, `POST /api/config/core/check_config`, `homeassistant.restart` nach bestandener Prüfung (abgebrochene Verbindung = Neustart läuft); eigene Ereignisse (`POST /api/events/<type>`, HA-Systemereignisse werden abgelehnt) |
| [`planner.py`](../src/ha_safe_mcp/planner.py) | Kalender (REST `/api/calendars`, `calendar.create_event`, WS `calendar/event/update|delete`) und To-do-Listen (WS `todo/item/list`, `todo.*`-Dienste); Schreibzugriffe auf Steuerungsstufe mit Domain- und Existenzprüfung, Löschstufe für Entfernungen |
| [`organize.py`](../src/ha_safe_mcp/organize.py) | Registries für Labels und Kategorien, Storage-Collection für Zonen (`zone/*`, `zone_id`); Validierung, Zurücklesen, Nutzungszähler; Hilfsfunktionen zur Neuzuordnung beim Rückgängigmachen |
| [`overview.py`](../src/ha_safe_mcp/overview.py) | Tiefensuche über gespeicherte Konfigurationen von Automationen/Skripten/Szenen, Gruppenmitglieder und Lovelace-Konfigurationen (begrenzte Parallelität); Systemübersicht aus Konfiguration, Zuständen, Registries und Config Entries |
| [`remote.py`](../src/ha_safe_mcp/remote.py) | Entfernter MCP-Endpunkt: Token-Speicher für Clients, Obergrenzen der Berechtigungen, stdio-Kindprozesse pro Client, Gateway-Server |
| [`changes.py`](../src/ha_safe_mcp/changes.py) | Änderungsjournal: vorherigen Zustand erfassen, im Journal erfasste Schreibvorgänge, Rückgängigmachen über dieselben durch Schalter geschützten Operationen |
| [`ollama_client.py`](../src/ha_safe_mcp/ollama_client.py), [`chat_runs.py`](../src/ha_safe_mcp/chat_runs.py) | Werkzeugschleife des Modells (Vorauswahl per Schlüsselwort, lokale Suche `find_tools` mit englischen und deutschen Themenmustern und Wortüberschneidung, Nachladen erlaubter Werkzeuge nach Namen bei Bedarf), Bestätigung im CLI, Lebenszyklus von Läufen/Freigaben im Web |
| [`web.py`](../src/ha_safe_mcp/web.py), [`webui/`](../src/ha_safe_mcp/webui/index.html), [`access_auth.py`](../src/ha_safe_mcp/access_auth.py) | HTTP-UI, mitgeliefertes statisches Frontend, optionale Prüfung von Access-JWTs |
| [`config_store.py`](../src/ha_safe_mcp/config_store.py), [`credentials.py`](../src/ha_safe_mcp/credentials.py), [`audit.py`](../src/ha_safe_mcp/audit.py), [`files.py`](../src/ha_safe_mcp/files.py) | Lokale Einstellungen, Geheimnisse, Metadaten-Protokolle und erzeugte Textdateien |

Einstiegspunkte, Abhängigkeiten und die pytest-Konfiguration stehen in [`pyproject.toml`](../pyproject.toml). Die genaue öffentliche Werkzeugoberfläche ergibt sich aus der [Werkzeug-Referenz (englisch)](TOOLS.md) und den `@tool()`-Registrierungen in [`server.py`](../src/ha_safe_mcp/server.py).

## Drei getrennte HA-API-Oberflächen

1. **Katalogisiertes REST:** `RestGateway.ROUTES` in [`rest_api.py`](../src/ha_safe_mcp/rest_api.py) prüft den *gesamten* Pfad und die Methode auf Übereinstimmung und danach die Klasse der Route: `read`, `write`, `admin` oder `delete`. `ha_rest_catalog` meldet diesen implementierten Katalog, keine Live-Erkennung aller HA-Routen. `ha_rest_query` akzeptiert katalogisierte GETs und zwei ausdrücklich ausgewählte POSTs (`/api/template`, `/api/config/core/check_config`); der Adapter stuft diese POSTs als read ein, das ist aber **kein** Beweis für Nebenwirkungsfreiheit oder dafür, dass kein HA-Adminzugriff nötig ist. `ha_rest_write` bearbeitet katalogisierte POSTs und `ha_rest_delete` das katalogisierte DELETE auf Zustände. Query-Schlüssel stehen auf einer eigenen Erlaubnisliste; der Verlauf verlangt `filter_entity_id`, Kalender verlangen `start` und `end`. Bodys müssen kleine JSON-Objekte sein. Dienst-POSTs laufen über `HAClient.call_service`, statt zu einer allgemeinen HTTP-Weiterleitung zu werden. Andere REST-Antworten werden *nach dem Empfang* gekürzt, Bild-Bodys werden als Base64 zurückgegeben. Der normale Pfad `HAClient._request` hat andere Zeitlimits und keine vergleichbare Begrenzung der Antwortgröße.
2. **Typisiertes HA-Konfigurations-HTTP:** [`HAAdmin`](../src/ha_safe_mcp/management.py) verwendet `/api/config/automation/config/{config_id}` für GET/POST/DELETE von Automationen; [`HAScenes`](../src/ha_safe_mcp/scenes.py) verwendet die Konfigurationsrouten für Szenen/Skripte; [`HAIntegrations`](../src/ha_safe_mcp/integrations.py) verwendet die Routen für Config-Entry-Abläufe, Optionen, Neukonfiguration und Neuladen. Diese werden *nicht* automatisch über den allgemeinen REST-Katalog bereitgestellt. IDs und Eingaben werden innerhalb der jeweiligen typisierten Operation validiert, mit ausgewählten Lesevorgängen nach dem Schreiben. Ein REST-POST auf einen Zustand ändert den Laufzeitzustand, nicht eine dauerhaft gespeicherte Konfiguration einer Integration oder eines Geräts.
3. **Typisiertes HA-WebSocket:** [`management.py`](../src/ha_safe_mcp/management.py) definiert `READ_TYPES`, `WRITE_TYPES` und `DELETE_TYPES`. Der Transport lehnt nicht aufgeführte Befehlstypen, reservierte Payload-Felder (`id`, `type`, `access_token`) und zu große Payloads ab, noch bevor er eine Verbindung aufbaut. Er authentifiziert sich, sendet einen Befehl mit passender ID und reduziert Fehlerdetails auf einen sicheren Code. Typisierte Aufrufer nutzen das für die Validierung von Automationen, Lovelace, Helfer, Registries, Einstellungen von Config Entries und Backups. Es gibt kein universelles MCP-Werkzeug für WS-Befehle. Ein Typ, der auf der Erlaubnisliste des Transports steht, wird nicht zwangsläufig als MCP-Werkzeug veröffentlicht. Verfügbarkeit und Bedeutung von WS- und Konfigurations-HTTP-Befehlen können sich je nach HA-Core-Version unterscheiden.

## Autorisierung und Restrisiko

Die Serverberechtigungen bauen aufeinander auf: `HA_ALLOW_WRITE=true` erlaubt einen eingeschränkten Dienstaufruf und Routen der Klasse `write`; `HA_ALLOW_ADMIN_WRITE=true` erlaubt **zusätzlich** administrative Änderungen; `HA_ALLOW_DELETE=true` erlaubt **zusätzlich zu beiden** das Löschen. Alle stehen standardmäßig auf false. `HA_ALLOWED_DOMAINS` beschränkt Dienstaufrufe einschließlich REST-Dienst-POSTs, aber nicht jede administrative Änderung. Dienstziele müssen zur Domain des Dienstes passen und können eine Entität oder eine begrenzte Liste sein; alternative Schlüssel `entity_id`, `area_id` und `device_id` auf oberster Ebene in `service_data` werden abgelehnt. Verschachtelte, dienstspezifische Werte werden dabei nicht vollständig validiert. Die Benutzerrechte in HA gelten weiterhin, und manche Aufrufe, die der Adapter als `read` einstuft, können HA-Administratorrechte erfordern.

Die Freigabe ist eine **zusätzliche Schicht auf Client-Seite**, kein Teil des MCP-Servers. Das Ollama-CLI stellt schreibende Werkzeuge nur mit `--allow-write` bereit und verlangt pro Aufruf eine Bestätigung im Terminal. Die Weboberfläche verlangt den Schreibmodus im Chat und zusätzlich die gespeicherten Server-Schalter; normalerweise wartet jeder vorgeschlagene Schreibvorgang auf eine einmalige Freigabe im Browser. Ihre ausdrücklichen Einstellungen `HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE` und `HA_AUTO_DELETE` können die Freigabekarten für aktivierte Stufen umgehen; der passende Erlaubnis-Schalter muss dafür ebenfalls eingeschaltet sein. `--read-only`/`--max-level` begrenzen, was die UI-Einstellungen aktivieren können. Ein anderer MCP-Client kann jedes registrierte Werkzeug direkt aufrufen, nur begrenzt durch die Schalter von Server und HA; geh nicht von einem allgemeingültigen Bestätigungsdialog aus. Die Einstufung von Werkzeugen sollte beim Hinzufügen von Aufrufen überprüft werden, besonders bei POSTs der Klasse read und bei `ha_rest_write`-Routen, die über den Katalog eingestuft werden.

Grenzen der Schutzmaßnahmen:

- Ein Modell kann HA-Attribute, Protokolle, Templates oder Werkzeugausgaben falsch verstehen oder von ihnen beeinflusst werden. Ein System-Prompt erklärt diese zu Daten, aber Prompt-Injection ist damit nicht ausgeschlossen. Prüfe vorgeschlagene Schreib-Payloads und arbeite wenn möglich nur lesend.
- Die Validierung von `HA_URL` verlangt eine HTTP(S)-Wurzel-URL ohne eingebettete Zugangsdaten, Query oder Fragment; sie ist **keine** Erlaubnisliste für Ziele. Eine falsch konfigurierte URL kann den HA-Bearer-Token an einen anderen Host senden. Schütze Transport, DNS, den Umfang des Tokens und den Ollama-Endpunkt. Die Prüfung von HTTPS-Zertifikaten ist bei den HTTP-Clients nicht absichtlich abgeschaltet.
- Die Prüfung der Dienst-Domain sperrt HA-Dienste, Skripte, Automationen, Templates, Ereignisse oder Intents nicht in eine Sandbox. Schreibzugriffe auf die Konfiguration können erhebliche Folgewirkungen haben, auch wenn eine HTTP-Antwort erfolgreich ist.
- Ausgewählte Verwaltungs-Schreibvorgänge validieren vorher und lesen danach zurück, aber die Prüfungen unterscheiden sich je nach Operation und sind keine Transaktionen, keine Nachweise für Geräteaktionen und kein automatisches Rollback. Ein fehlgeschlagenes Zurücklesen oder eine Zeitüberschreitung kann *nach* einer Änderung auftreten. Prüfe den HA-Zustand, bevor du es erneut versuchst.
- Dies ist weder eine Isolation mehrerer Benutzer noch eine allgemeine Ratenbegrenzung für Anfragen. Ein lokaler Prozess mit Zugriff auf stdio und den konfigurierten Token kann die erlaubte Werkzeugoberfläche nutzen.

## Lokale Speicherung und sensible Daten

- [`SettingsStore`](../src/ha_safe_mcp/config_store.py) liest und schreibt eine ausgewählte lokale `.env`; Schreibvorgänge der UI ersetzen sie atomar mit Modus `0600`, erhalten fremde Zeilen und lassen den Token in Statusantworten weg. Bei leerem Token-Feld in der UI behält es einen vorhandenen Token nur, wenn die HA-URL unverändert ist. Unabhängig davon lädt `main()` des Servers nur die `.env` im **aktuellen Verzeichnis** des Prozesses (`Path.cwd() / ".env"`) und durchsucht nie übergeordnete Verzeichnisse; bereits vorhandene Umgebungsvariablen haben nach dem Standardverhalten von dotenv Vorrang. Die UI übergibt gespeicherte HA-Einstellungen ausdrücklich an ihren stdio-Kindprozess. Committe keine `.env`, schreib keine Tokens in den Chat und mach die Einstellungsroute der UI nicht für nicht vertrauenswürdige Aufrufer zugänglich.
- [`CredentialStore`](../src/ha_safe_mcp/credentials.py) verwendet standardmäßig ein XDG-Konfigurationsverzeichnis außerhalb des Repositorys, mit einem Verzeichnis für Zugangsdaten im Modus `0700` und Schlüssel-/Datendateien im Modus `0600`. Die Werte sind im Ruhezustand mit Fernet verschlüsselt; **der Schlüssel liegt neben dem Geheimtext**, das schützt also nicht vor jemandem mit Dateisystemzugriff als derselbe Benutzer. Die öffentliche Auflistung liefert Aliasse, Bezeichnungen und Feldnamen, keine geheimen Werte. In Feldern von Integrationsabläufen, deren Namen nach Geheimnissen aussehen, verlangt [`integrations.py`](../src/ha_safe_mcp/integrations.py) Referenzen der Form `{"$credential":"<alias>","field":"<field>"}`, löst sie unmittelbar vor der Anfrage an HA auf und entfernt verwendete Werte aus den reduzierten Ergebnissen. Auch Backup-Passwörter erfordern Referenzen. Das sind Heuristiken anhand von Feldnamen und eine Behandlung von Referenzen auf oberster Ebene, keine vollständige Erkennung von Geheimnissen. Die UI lehnt einige Chat-Muster mit Geheimnissen im Klartext ab, aber nicht jedes mögliche Geheimnis.
- [`AuditLog`](../src/ha_safe_mcp/audit.py) zeichnet Metadaten aus einer Erlaubnisliste für MCP-Werkzeugaufrufe und HA-HTTP-/WS-Anfragen auf (Werkzeug, Kanal, Methode, Routen-Vorlage oder Befehlstyp, Status, Dauer, Erfolg und Ausnahmeklasse), nicht aber Prompts, Argumente, Tokens oder Antwort-Bodys. Bestimmte technische Routensegmente wie Dienst-Domains und Ereignistypen bleiben erhalten. Die Dateien im standardmäßigen XDG-Zustandsverzeichnis sind JSONL-Dateien pro UTC-Tag, mit Modus `0700` für das Verzeichnis und `0600` für die Dateien und einer standardmäßigen Bereinigung nach 30 Tagen bei Lese- und Schreibvorgängen. Das Audit des Servers erfolgt nach bestem Bemühen und lässt sich mit `HA_AUDIT=false` abschalten; ein Fehler beim Protokollieren hält einen HA-Aufruf nicht auf. Der Audit-Endpunkt der UI verwendet ein eigenes `AuditLog`-Objekt und teilt dessen Verzeichnis mit den gestarteten MCP-Kindprozessen.
- [`ChangeJournal`](../src/ha_safe_mcp/changes.py) speichert für jeden im Journal erfassten Konfigurations-Schreibvorgang eine JSON-Datei
  (`<UTC timestamp with microseconds>-<random>.json`, streng aufsteigend, damit die Reihenfolge auch bei Schreibvorgängen im selben Augenblick erhalten bleibt) mit
  Werkzeug, Art, Ziel und dem `before`-Zustand, der unmittelbar vor dem Schreiben gelesen wurde; ein fehlgeschlagener Schreibvorgang hinterlässt keinen Eintrag.
  Standardverzeichnis ist das XDG-Zustandsverzeichnis (`changes/`), `HA_CHANGES_DIR` überschreibt es; die Weboberfläche übergibt ihr eigenes
  Verzeichnis an den stdio-Kindprozess, sodass getrennte Instanzen (z. B. Entwicklung und Produktion) nie ein Journal teilen. `0700`/`0600`,
  Bereinigung nach 30 Tagen und 1000 Einträgen. `Changes.undo` stellt `before` über die normalen typisierten Operationen wieder her (sodass alle Berechtigungsschalter
  und Rücklesevorgänge greifen), erfasst das Rückgängigmachen im Journal mit `undoes`, markiert das Original mit `undone_by` und verweigert ein Rückgängigmachen, wenn
  es neuere, nicht rückgängig gemachte Änderungen am selben Ziel gibt (bei feldbezogenen Arten nur, wenn sich die Felder überschneiden; Rückgängig-Einträge
  noch neuerer Änderungen zählen nicht), es sei denn, `force` ist gesetzt. Umfang: Automationen, Skripte, Szenen, Dashboard-Metadaten und
  -Ansichten, Storage-Helfer, Bereiche, Etagen, Felder der Geräte- und Entitäten-Registry, Titel/Systemoptionen/Deaktiviert-Zustand
  von Integrationen. Nicht im Journal erfasst: Dienstaufrufe, Hinzufügen/Entfernen von Integrationen, Options-/Neukonfigurations-Abläufe, Backups, allgemeine
  REST-Schreibvorgänge. Das Journal enthält Konfigurationsinhalte, keine Geheimnisse; es ist kein Backup von HA.
- [`FileStore`](../src/ha_safe_mcp/files.py) speichert im Web-Chat erzeugte Pläne und Codeblöcke in Code-Fences als Text im XDG-Datenspeicher in den Unterverzeichnissen `plan`/`script`. Namen/Endungen und Größen sind beschränkt, die Modi für Verzeichnisse/Dateien sind `0700`/`0600`, und Symlinks im Speicher werden abgelehnt. Gespeicherte Skripte werden **nicht ausgeführt** und nicht an HA gesendet. Die Dateiverwaltung ist eine Web-Funktion, kein allgemeines MCP-Dateisystemwerkzeug. Der Chatverlauf im Browser liegt im Speicher des Frontends; leg dort keine Zugangsdaten ab.

## Entfernter MCP-Endpunkt

`create_app` liefert `McpRouter` zurück: Anfragen an `/mcp` und `/mcp/...` gehen an das MCP-Gateway, alles andere an die UI
hinter `LocalOnlyGuard`. Der Router führt seine eigene Prüfung von Host und Loopback-Gegenstelle durch und verlangt `Authorization: Bearer <token>`; er verlangt **nicht** das Access-JWT, sodass eine Proxy-Ausnahme (Bypass) für `/mcp`
ausreicht. [`ClientStore`](../src/ha_safe_mcp/remote.py) hält die Clients im XDG-Konfigurationsverzeichnis
(`clients/clients.json`, `0700`/`0600`) mit dem SHA-256 des Tokens (256 Bit zufällig, nur einmal angezeigt).

Das Gateway ist ein Low-Level-MCP-`Server`, der vom `StreamableHTTPSessionManager` des SDK im zustandslosen JSON-Modus bedient wird.
Bei jedem Aufruf liest es den authentifizierten Client aus dem Request-Scope, berechnet die wirksame Umgebung
(`effective_env`: Instanz-Einstellungen, begrenzt durch die Client-Stufe read < control < admin < delete, Domains
als Schnittmenge, `HA_AUDIT_CLIENT` gesetzt) und leitet an den eigenen stdio-Kindprozess dieses Clients mit dem normalen Server weiter
(`ChildPool`; neu gestartet, wenn sich die wirksame Umgebung ändert, beendet nach 15 Minuten Leerlauf). Dadurch gelten jeder serverseitige
Schalter, jedes Zurücklesen, jede Regel für Zugangsdaten-Referenzen, jeder Audit-Eintrag und jeder Eintrag im Änderungsjournal unverändert. Das Gateway
listet nur Werkzeuge auf, die die Client-Stufe verwenden darf (`tool_level`; nicht eingestufte Werkzeuge werden nie bereitgestellt), lehnt andere ab und
setzt `readOnlyHint`/`destructiveHint`; der stdio-Server setzt dieselben Annotationen. Rückgängigmachen ist ab der Stufe admin sichtbar;
der Lösch-Schalter des Kindprozesses entscheidet, wann ein Rückgängigmachen etwas entfernen würde.

### OAuth

`McpRouter` stellt außerdem ohne UI-Login die Discovery-Dokumente bereit (`/.well-known/oauth-protected-resource`
und `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`; Issuer = öffentliche
Origin) sowie `/mcp/oauth/register` und `/mcp/oauth/token`, mit großzügigem CORS (Bearer-Tokens, keine Cookies). Die 401-Antwort
auf `/mcp` enthält `resource_metadata`. [`OAuthServer`](../src/ha_safe_mcp/oauth.py) hält die Registrierungen in
`clients/oauth_clients.json` (Redirect-URIs nur https oder Loopback-http, keine Fragmente; optionales Client-Secret, gespeichert
als SHA-256; höchstens 200, die ältesten unbenutzten werden zuerst entfernt). Die Zustimmungsseite `/oauth/authorize` ist eine statische UI-Seite hinter
`LocalOnlyGuard`; sie ruft `/api/oauth/check|approve|deny` auf (UI-Header + Origin), und der Server prüft bei jedem Aufruf erneut Client,
exakte Redirect-URI, `response_type=code`, PKCE S256 und `resource`. Codes sind nur einmal verwendbar, liegen im Arbeitsspeicher,
sind 10 Minuten gültig und an Client, Redirect-URI und Challenge gebunden. Der Token-Endpunkt prüft den Client (none,
`client_secret_post`, `client_secret_basic`) und PKCE, danach erstellt oder ersetzt `ClientStore.issue_oauth` ein
Profil pro OAuth-Client mit einem Access-Token für 1 Stunde und einem rotierenden Refresh-Token für 60 Tage (beide als SHA-256 gespeichert).

## Sprachen (Englisch und Deutsch)

Englisch ist der Quelltext und die Voreinstellung; Deutsch steht direkt daneben. Es gibt also keine getrennten
Übersetzungsdateien, die auseinanderlaufen können.

| Ebene | Mechanismus |
|---|---|
| HTML der Weboberfläche | englischer Text im Element, Deutsch in `data-de`, `data-de-html`, `data-de-placeholder`, `data-de-title`, `data-de-aria-label` |
| Skripte der Weboberfläche | `t("English", "Deutsch")` aus `webui/prefs.js`, das synchron im `<head>` vor allen anderen Skripten lädt |
| Server | `i18n.L(en, de)`; die Sprache einer Anfrage kommt aus dem Header `X-UI-Language` (setzt die Oberfläche) und liegt in einer `ContextVar`, sodass Chat-Läufe sie erben; unbekannte oder fehlende Werte bedeuten Englisch |
| Lokales Chat-Modell | Anweisungen sind englisch; `language_hint()` nennt nur die Antwortsprache, und der eine Satz, den das Modell wörtlich an den Nutzer weitergeben soll, folgt der Sprache der Oberfläche |
| MCP-Werkzeuge und entfernte Clients | nur Englisch, unabhängig von der Oberfläche |

`prefs.js` setzt außerdem das Design vor dem ersten Zeichnen: Ohne gespeicherte Wahl entscheidet
`prefers-color-scheme`; der Schalter in der Kopfleiste speichert `light` oder `dark` in `localStorage`,
*Einstellungen → Design → Wie das System* entfernt die Wahl wieder. `tests/test_ui_i18n.py` schlägt fehl, wenn
deutscher Text außerhalb von `data-de*`-Attributen oder `t()`-Aufrufen steht.

## Modell der Web-Erreichbarkeit

[`web.py`](../src/ha_safe_mcp/web.py) bindet standardmäßig an Loopback und lehnt Gegenstellen außerhalb von Loopback sowie unbekannte Host-Header ab. Ändernde HTTP-Anfragen müssen `X-HA-MCP-UI: 1` mitschicken; ist ein `Origin`-Header vorhanden, muss er zur erwarteten Origin passen. Die Antwort-Header enthalten CSP, Verbot der Einbettung in Frames, `nosniff`, no-referrer und no-store; JSON-Request-Bodys und die Länge von Chat-Nachrichten sind begrenzt. Die statischen Frontend-Dateien werden mitgeliefert; im lokalen Standardmodus ist die UI kein eigenständiger Dienst mit Authentifizierung. Behandle jeden Prozess, der auf die Loopback-UI zugreifen kann, als vertrauenswürdig. `--allow-remote` lockert ausdrücklich die Beschränkungen für Gegenstelle und Host und führt **keine** Anmeldung ein; verwende es nur hinter einer Authentifizierung, die du selbst verwaltest, oder lass den Ursprungsserver besser an Loopback gebunden.

Das optionale [`--public-host`](../src/ha_safe_mcp/web.py) lässt die UI an Loopback gebunden, beschränkt den Host auf den konfigurierten öffentlichen HTTPS-Hostnamen und verlangt `CF_ACCESS_AUD` und `CF_ACCESS_TEAM_DOMAIN`; es lässt sich nicht mit `--allow-remote` kombinieren. Der [`AccessTokenVerifier`](../src/ha_safe_mcp/access_auth.py) prüft die `Cf-Access-Jwt-Assertion` anhand der JWKS von Cloudflare Access, RS256, Issuer, Audience, Ausstellungszeitpunkt und Ablauf. Fehlende oder ungültige Assertions werden abgelehnt, bevor Routen ausgeführt werden. Du musst für deine eigene Domain separat einen sicheren Tunnel und eine Access-Richtlinie einrichten, den Ursprungsserver schützen und den echten Eingangsweg testen. Dies ist keine allgemeine OIDC-Login-Implementierung und macht eine beliebige entfernte Bindung nicht sicher. Der nicht öffentliche Loopback-Modus verlangt keine Access-Assertions.

## Tests, Verifikation und Grenzen

Die Testsuite in [`tests/`](../tests/) verwendet pytest, gemocktes HA-HTTP (`respx`), WS-Doubles bzw. einen Test-Transport und Starlette-ASGI-Anfragen. Sie deckt ab: Standardwerte der Berechtigungen, Ablehnung von Routen/Queries/Zielen, WS-Authentifizierung und Erlaubnislisten für Befehle, Zurücklesen bei Verwaltungsoperationen, Umgang mit Zugangsdaten bei Integrationen, Audit- und Dateispeicher, Werkzeugauswahl und Freigaben im CLI, Chat-Lebenszyklus, Einrichtung und Schutzverhalten der UI sowie das Verhalten bei Backups. So führst du die Suite ohne Live-System im Paketverzeichnis aus, wenn das Test-Extra installiert ist:

```sh
python -m pytest -q
```

[`tests/mock_ha.py`](../tests/mock_ha.py) ist ein kleines REST-Test-Double; [`tests/docker_smoke.py`](../tests/docker_smoke.py) testet MCP über stdio per Docker gegen dieses Double, nicht die vollständige Verwaltungssemantik von HA. [`tests/ha_core_smoke.py`](../tests/ha_core_smoke.py) ist ein **zerstörerisches Integrationsskript, das nur auf ausdrücklichen Wunsch läuft (Opt-in)**: Es führt das Onboarding einer HA-Instanz durch und ändert deren Konfiguration. Führe es *nur* gegen eine frische, isolierte Wegwerf-Instanz von HA Core aus, die du kontrollierst, niemals gegen ein bestehendes oder produktives HA. Weder die Unit-Tests noch ein bestandener Smoke-Test gegen das Test-Double belegen die Kompatibilität mit jeder HA-Core-Version, jedem integrationsspezifischen Ablauf, jedem physischen Gerät, jedem Browser-Eingangsweg oder jeder Netzwerkrichtlinie. Dieses Dokument behauptet nicht, dass diese optionalen Smoke-Tests für eine bestimmte Installation gelaufen sind.

## Den Adapter erweitern

1. Bestimme die HA-Oberfläche und die Version: katalogisiertes REST, eine bestimmte Konfigurations-HTTP-Operation oder ein typisierter WS-Befehl. Prüfe die Autorisierung durch HA und ob eine nominell lesende Operation Auswirkungen haben kann. Füge keine rohe URL und keinen beliebigen WS-Proxy hinzu.
2. Füge eine enge Erlaubnisliste für Methode/Pfad/Query/Body oder WS-Typ und einen typisierten Wrapper in der passenden Komponente hinzu. Validiere Kennungen, Ziele, reservierte Felder und Größenlimits **vor** jedem Netzwerkzugriff. Wende die aufeinander aufbauenden Server-Schalter an, halte den HA-Token aus Fehlern und Ergebnissen heraus und reduziere sensible Felder in Antworten. Lege bei einem Schreibvorgang die zu prüfende Nachbedingung fest; dokumentiere, dass es keine Transaktion ist.
3. Registriere ein Werkzeug in [`server.py`](../src/ha_safe_mcp/server.py) erst, nachdem du seine Berechtigungsklasse festgelegt hast. Aktualisiere, soweit zutreffend, in [`ollama_client.py`](../src/ha_safe_mcp/ollama_client.py) die Lese-/Schreibmengen, die Themenauswahl und die Einstufung in Steuerungs- bzw. Löschstufe; sonst lässt der Modell-Client das Werkzeug womöglich aus oder behandelt Freigaben falsch. Prüfe die Auswirkungen auf die automatische Freigabe im Web.
4. Füge positive und negative Tests neben den passenden Modulen in [`tests/`](../tests/) hinzu: verweigerte Schalter, fehlerhafte Methode/Pfad/Payload, kein I/O bei lokaler Ablehnung, sichere Fehlermeldungen, Varianten von HA-Antworten und Zurücklesen nach dem Schreiben. Teste auch die Registrierung des Werkzeugs und die Weiterleitung der Freigaben in Modell und UI. Führe pytest lokal aus; für versionsabhängiges Verhalten verwendest du ein **Wegwerf**-HA-Core, keine Live-Installation.
5. Aktualisiere die [Werkzeug-Referenz (englisch)](TOOLS.md) über ihren Generator [`scripts/gen_tool_reference.py`](../scripts/gen_tool_reference.py), außerdem dieses Dokument und [USER_GUIDE.de.md](USER_GUIDE.de.md), wenn sich für Benutzer sichtbares Verhalten ändert. Halte Anleitungen zur Einrichtung in [INSTALL.de.md](INSTALL.de.md); vermeide installationsspezifische URLs, Geräte, IDs oder Geheimnisse in der Community-Dokumentation.
