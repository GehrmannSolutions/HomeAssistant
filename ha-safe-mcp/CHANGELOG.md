# Changelog

This project follows [Semantic Versioning](https://semver.org/) loosely; tool signatures can change before 1.0.
Historical entries below remain in German.

## 0.34.0 – 2026-10-30

Aus den Chat-Tests mit dem größeren Demo-Zuhause (ein kleines lokales Modell, `qwen3-coder:30b`):

- **Etagen statt Räume:** `ha_list_area_entities` nimmt jetzt auch einen Etagennamen oder Alias ("Keller",
  "Erdgeschoss"). Dann kommen die Entitäten aller Bereiche dieser Etage, jede mit ihrem Bereich, dazu die Liste der
  Bereiche. "Mach im Keller alle Lichter aus" braucht so einen Aufruf zum Lesen und einen zum Schalten statt einer
  Rückfrage. Eine Etage ohne Bereiche sagt das; Bereiche gewinnen bei gleichem Namen. Bei unbekanntem Namen nennt
  die Fehlermeldung auch die Etagen.
- **Sensoren nach ihrer Art finden:** `ha_search_entities` findet Sensoren über ihre Geräteklasse, auf Deutsch und
  Englisch: "power", "Strom" oder "Verbrauch" findet "Fernseher Leistung", "windows" die Fensterkontakte, dazu
  Temperatur, Feuchte, Tür, Batterie, Bewegung, Rauch, CO2, Rollläden und mehr.
- **Szenen werden zurückgelesen:** `ha_activate_scene` liefert jetzt `states_after`: die Entitäten der Szene nach
  dem Aktivieren. Bei Szenen aus der Oberfläche wird jede mit dem in der Szene gespeicherten Zustand verglichen
  (`confirmed` ja/nein, bis etwa 3 s nachgelesen), YAML-Szenen kommen ohne Urteil. Die Antwort kann so sagen, was
  wirklich passiert ist. Das Werkzeug gibt dafür ein Objekt statt einer Liste zurück.
- **Aufrufe wie in YAML:** Der Chat setzt eine `entity_id` aus `target`, `service_data` oder `data` an die oberste
  Ebene, schiebt unbekannte Felder wie `position` in `service_data` und liest Objekte, die als JSON-Text kommen
  (`"service_data": "{\"position\": 0}"`), als Objekt, bevor die Freigabekarte erscheint. Die Karte
  zeigt also, was wirklich läuft. Ein `target` mit Bereichen oder Geräten wird nicht geraten: Das Modell bekommt den
  Schemafehler zurück.
- **Fehlgeschlagene Versuche sichtbar:** Ein vom Schema abgelehnter Aufruf zeigt im Chat jetzt die Argumente, die
  das Modell geschickt hat.
- **Home Assistants Grund bei HTTP 400:** Lehnt Home Assistant eine Anfrage mit einer JSON-Meldung ab, steht diese
  Meldung (eine Zeile, höchstens 300 Zeichen, Token maskiert) jetzt in der Fehlermeldung. Andere Antworten (HTML,
  Tracebacks bei 5xx) bleiben draußen.
- **Demo-Zuhause für Doku und Tests:** `scripts/docs_demo_home.py` baut jetzt drei Etagen mit 17 Bereichen, 20
  Lampen, 8 Geräten mit Leistungsmessung, 7 Rollläden (mit Position), einem Türschloss, Raumtemperaturen,
  Fensterkontakten, vier Automationen, der Szene "Filmabend" und dem Skript "Alles aus", alles über die Werkzeuge
  des MCP selbst. Neue Chat-Beispiele in der Funktionsübersicht: ganze Etage aus, Rollladen, Türschloss, Szene,
  Stromverbrauch, offene Fenster (`scripts/doc_screenshots.py` Szenarien `floor-off`, `cover`, `lock`, `scene`,
  `power`, `windows`).
- **Beispiele ohne Privates:** Beispiele und Testdaten nutzen neutrale Namen (`vendor.set_plan`,
  PV-Wechselrichter, eigene Vorlagen-Ordner).

## 0.33.0 – 2026-10-29

Aus den Funden beim Ausbau echter Dashboards (28.10.):

- **Abschnitte einklappen:** `ha_set_section_collapsible` macht Abschnitte einer Abschnitte-Ansicht unter ihrer
  Überschrift einklappbar (Doppelpfeil rechts, die ganze Titelzeile schaltet). Pro Abschnitt `open`, `closed` oder
  `off`, z. B. `{"Raumklima": "closed"}`. Das gilt bei jedem Öffnen der Seite. Halbe Kachelbreiten bleiben
  nebeneinander, gleich breite Kacheln fließen je nach Fensterbreite. Ein kleines Modell braucht dafür nur einen
  Aufruf statt das ganze Dashboard umzubauen. Braucht die HACS-Karte Expander Card. Im Änderungsjournal, also
  rückgängig zu machen.
- **Erreichbarkeit vom HA aus:** `ha_test_url_from_ha` prüft, ob der Home-Assistant-Rechner selbst eine Adresse
  erreicht, und sagt in einfachen Worten, warum nicht (Zeitüberschreitung, Name unbekannt, Login nötig, 404 …).
  Bisher musste dafür ein Einrichtungsdialog „missbraucht“ werden, und der Scrape-Dialog hat dabei sofort echte
  Einträge angelegt. Jetzt nutzt das Werkzeug den Prüfschritt der generischen Kamera, der vor einer Bestätigung nie
  etwas anlegt, und bricht den Dialog immer ab. Adressen mit `?…`, Anmeldedaten oder Templates werden abgelehnt,
  weil ein Aufruf wie `/relay/0?turn=on` ein Gerät schalten würde.
- **Formular-Abschnitte bei Integrationen:** Die Passwort-Sperre in `ha_integration_setup_step` hat einen leeren
  Abschnitt abgelehnt, nur weil er „auth“ heißt (Scrape). Jetzt zählt jedes Feld im Abschnitt für sich:
  `auth.password` braucht weiter einen Verweis auf *Zugangsdaten*, `auth.username` nicht. Verweise funktionieren
  auch innerhalb von Abschnitten, Passwort-Vorgaben darin werden nie gezeigt, und bei Optionen bleiben fehlende Felder
  eines Abschnitts einzeln erhalten.
- **Template-YAML ohne geladene Template-Integration:** `ha_write_config_file`/`ha_edit_config_file` und
  `ha_reload` sagen jetzt, wenn `template.reload` fehlt, und nennen den Weg ohne Neustart: einen Template-Helfer
  über die Oberfläche anlegen und danach `ha_reload` `template`.

## 0.32.0 – 2026-10-28

- **Aktionen von Integrationen auf ihre eigenen Entitäten:** `ha_call_service` lehnte bisher jeden Aufruf ab, bei
  dem Entität und Aktion verschiedene Domains haben. Manche Integrationen bieten aber Aktionen,
  die auf eine ihrer Sensor-Entitäten zielen (`vendor.set_plan` mit `sensor.vendor_controller_plan`). Das ist jetzt erlaubt, wenn
  die Entität laut Registry wirklich zu dieser Integration gehört (`platform == sf`). Alles andere bleibt gesperrt,
  z. B. eine fremde Integration auf ein Schloss. Die Domain der Aktion muss weiter freigegeben sein.

## 0.31.0 – 2026-10-28

- **Nachkommastellen für Sensoren:** `ha_update_entity_registry` kennt jetzt `display_precision` (nur Sensoren,
  0–10 oder `null` für den Standard der Integration). Beispiel: `{"display_precision": 1}` zeigt 28,7 °C statt
  28,80 °C, überall in Home Assistant. Andere Sensor-Optionen (z. B. die Einheit) bleiben erhalten, die Änderung
  steht im Änderungsprotokoll und lässt sich rückgängig machen. Ein kleines Modell braucht dafür nur einen Aufruf.

## 0.30.2 – 2026-10-26

- **Große Dashboards speichern:** WebSocket-Nachrichten durften höchstens 64 KiB groß sein; ein Dashboard mit
  Grundriss und Raum-Popups (rund 80 KiB) wurde abgelehnt. Home Assistant selbst nimmt bis 4 MiB an; die Grenze
  liegt jetzt bei 1 MiB, und die Meldung nennt Größe und Grenze.

## 0.30.1 – 2026-10-25

Gefunden beim Test mit dem lokalen Modell gegen eine echte HACS-Instanz:

- **HACS-Suche verzeiht mehr:** Es reicht, wenn die Hälfte der Suchwörter passt; Füllwörter wie „card“ oder „für“
  zählen nicht, Mehrzahl wird erkannt. Repositories mit allen Wörtern im Namen kommen zuerst, sonst die mit den
  meisten Sternen. Vorher fand „history graphs“ die beliebte mini-graph-card nicht (sie nennt sich nur „graph card“).
- Das Modell sucht im englischen Store mit englischen Wörtern, und es unterscheidet „was ist installiert“ von „was
  gibt es im Store“.
- Der Hinweis nach dem Entfernen passt zur Art: Bei einer Karte nannte er fälschlich einen Neustart „der Integration“.

## 0.30.0 – 2026-10-25

- **HACS-Store im MCP** (5 neue Werkzeuge): suchen (Name, Beschreibung, Themen, nach Sternen sortiert), Details mit
  Versionen und Klartext, was eine Installation bedeutet; installieren oder aktualisieren (Stufe Konfigurieren, im
  Chat immer mit Freigabe-Karte mit Sternen, letzter Aktualisierung und Folgen), eigenes GitHub-Repository
  hinzufügen (nur `github.com`), entfernen (Stufe Löschen). Installieren und Entfernen stehen im Änderungsjournal:
  Rückgängig entfernt eine neue Installation wieder (Stufe Löschen) oder geht auf die vorige Version zurück. Karten
  trägt HACS selbst als Dashboard-Ressource ein. Getestet auf einer echten Instanz mit HACS 2.0.5.
- Weboberfläche: Freigabe-Karte für HACS-Installationen in Klartext.

## 0.29.1 – 2026-10-25

- **Konfigurationsdateien über den File-Editor (HA OS):** Eine neue Datei in einem noch nicht vorhandenen Ordner
  (z. B. `www/floorplan/neu/plan.svg`) scheiterte mit einem unverständlichen JSON-Fehler, weil das Add-on für fehlende
  Ordner keine JSON-Antwort liefert. Jetzt legt der MCP die Ordner an. Gefunden beim Hochladen der Grundrisse auf
  Prod.
- Dateien unter `www/` sind sofort als `/local/...` aktiv; der Hinweis „neu laden“ kam dort fälschlich und nennt jetzt
  die Adresse und den Tipp gegen Browser-Cache.

## 0.29.0 – 2026-10-25

Wunsch „alles im MCP möglich, auch destruktive Dinge“: die bisher geparkten Punkte.

- **Energie** (7 Werkzeuge): Energie-Einstellungen lesen (mit HAs eigener Prüfung und einer Erklärung pro Problem),
  passende Sensoren finden, Verbrauch pro Gerät und Quelle (heute, gestern, 7 und 30 Tage, Monat), Solarprognose;
  Einstellungen speichern, ein Gerät (Steckdose) hinzufügen, ein Gerät herausnehmen (Stufe Löschen). Neue Sensoren
  müssen Statistiken haben; alles im Änderungsjournal mit Rückgängig.
- **Geräte und verwaiste Entitäten entfernen** (4 Werkzeuge): Vorschau (Entitäten, verbundene Geräte, wo verwendet,
  ob die Integration das kann), Gerät entfernen (Stufe Löschen, im Chat immer mit Karte), verwaiste Entitäten
  auflisten und entfernen. Noch bereitgestellte Entitäten werden abgelehnt. Nicht rückgängig zu machen, das steht
  überall dabei.
- **Assist** (8 Werkzeuge): Pipelines anlegen, ändern, bevorzugen, löschen; Freigabe von Entitäten für Assist,
  Alexa und Google; Regel für neue Entitäten; Satzprüfung, die nur erkennt. Ein freies „Sag Assist etwas“ fehlt
  mit Absicht, weil Assist an Domain-Freigabe und Schutzräumen vorbei schalten würde.
- **Weboberfläche: neue Seite „Energie“** mit Verbrauch pro Gerät und Quelle (heute, gestern, 7, 30 Tage), den
  Problemen, die HA meldet, und Energiesensoren, die noch fehlen; Hinzufügen und Herausnehmen mit
  Änderungsjournal.
- **Freigabekarte zum Entfernen eines Geräts** zeigt die Vorschau in einfachen Worten (Gerät, Integration, welche
  Entitäten mitgehen, wo sie verwendet werden, nicht rückgängig zu machen) statt nur der Geräte-ID.
- **Fehler behoben:** *Rückgängig* auf der Seite „Änderungen“ kannte Labels, Kategorien, Zonen, Themes,
  Blueprints, Ressourcen und Dateien nicht und wäre dort mit einem Serverfehler gescheitert; jetzt baut die Seite
  dieselben Bausteine wie der MCP-Server.
- Satzprüfung ohne Sprachangabe testet die Systemsprache und alle Pipeline-Sprachen und sagt, in welcher Sprache
  ein Satz verstanden wird (ein englischer Satz scheiterte vorher an der deutschen Systemsprache).
- Verbrauchsfragen ohne eingerichtetes Energie-Dashboard werden aus allen Energiesensoren beantwortet; das lokale
  Modell versuchte vorher, dafür ungefragt ein Gerät hinzuzufügen (die Freigabekarte hatte es abgefangen).
- 154 Werkzeuge (Lesen 73, Steuern 80, Konfigurieren 129, Löschen 154). Lokaler Chat findet die neuen Werkzeuge
  über deutsche und englische Stichwörter.
- Alles auf dem Dev-HA echt durchgespielt (Kitchen-Sink-Testgeräte, Demo-Energiesensoren), Energie zusätzlich nur
  lesend gegen Prod.

## 0.28.2 – 2026-10-25

- **Wiederherstellen auf HA OS**: Der Supervisor stellt Home Assistant nur zusammen mit genau der Datenbank-Wahl des
  Backups wieder her („Restore database must match backup“). Enthält das Backup eine Datenbank, geht „nur
  Konfiguration“ dort nicht. Der MCP prüft das jetzt **vor** dem Sicherheits-Backup und sagt klar, dass
  `restore_database=true` nötig ist; `ha_get_backup` meldet `database_can_be_kept`.
- Gefunden beim ersten echten Wiederherstellen auf Prod (auf Wunsch): Der Versuch ohne Datenbank wurde von HA
  abgelehnt, es wurde nichts verändert. Danach mit Datenbank: Test-Helfer, der nach dem Backup angelegt wurde, war
  weg, HA lief nach gut einer Minute wieder vollständig; Sicherheits-Backup für das Rückgängigmachen vorhanden.

## 0.28.1 – 2026-10-25

- **Backups auf HA OS**: Der lokale Speicherort heißt dort `hassio.local`, nicht `backup.local` (nur Core-Installation).
  `ha_create_backup` – und damit auch das Sicherheits-Backup vor einem Wiederherstellen – nahm fest `backup.local` und
  wäre auf HA OS gescheitert. Jetzt wählt der MCP den lokalen Speicherort aus `backup/agents/info`; ohne lokalen
  Speicherort bricht er mit einer klaren Meldung ab. Gefunden beim lesenden Blick auf die Prod-Instanz, bevor dort ein
  Backup angelegt wurde; danach auf Dev (`backup.local`) und Prod (`hassio.local`) erfolgreich getestet.

## 0.28.0 – 2026-10-25

- **Backups wiederherstellen**: `ha_restore_backup` (Stufe Löschen) setzt die Konfiguration von Home Assistant und
  wahlweise die Verlaufsdatenbank auf den Stand eines Backups zurück; Add-ons und Ordner nie. Neu auch
  `ha_get_backup` (Details eines Backups und was ein Wiederherstellen ändern würde) und im Reiter *Backups* der
  Knopf *Wiederherstellen* mit derselben Erklärung.
- Schutz: vorher immer ein Sicherheits-Backup des aktuellen Stands (schlägt es fehl, passiert nichts; es
  zurückzuspielen macht das Wiederherstellen rückgängig). Im Chat erscheint **immer** eine Freigabekarte, auch wenn
  Löschen „ohne Freigabe“ laufen darf; die Karte nennt Name, Datum, HA-Version, Inhalt und Größe des Backups und die
  Folgen in einfachen Worten. Verschlüsselte Backups nur mit Passwort-Verweis auf *Zugangsdaten*.
- Das Werkzeug wartet den Neustart ab und meldet das eigene Ergebnis von HA (`completed`/`failed`) erst, wenn HA
  wieder ganz läuft. Ein Verbindungsabbruch zählt als Neustart, ein Fehlercode von HA als „abgelehnt, nichts
  geändert“.
- Lehre aus dem Dev-Test: HA schreibt Helfer und Register erst bis zu 10 Sekunden nach einer Änderung auf die Platte
  (`SAVE_DELAY`), ein Backup wartet nicht darauf. Ein Sicherheits-Backup direkt nach einer Änderung hätte sie
  verpasst; deshalb wartet der MCP vorher 12 Sekunden. Außerdem antwortet die Backup-Integration nach dem Neustart,
  bevor andere Integrationen geladen sind; das Werkzeug wartet deshalb auf den Zustand `RUNNING`.
- Getestet auf der Dev-Instanz über MCP-stdio: Basis-Backup, danach Prüf-Helfer angelegt, Basis zurückgespielt
  (Helfer weg, Demo-Wohnung unverändert), Sicherheits-Backup zurückgespielt (Helfer wieder da), aufgeräumt.

## 0.27.0 – 2026-10-25

- **Zweisprachige Weboberfläche**: Englisch ist Standard, Deutsch per Umschalter `EN | DE` in der Kopfleiste (auch
  auf der OAuth-Freigabeseite). Die Wahl gilt pro Browser (`localStorage`) und wird als Header `X-UI-Language` an den
  Server geschickt; Fehlermeldungen, Hinweise und Domain-Beschreibungen kommen in derselben Sprache zurück. Englisch
  ist der Quelltext, Deutsch steht direkt daneben (`data-de*`-Attribute im HTML, `t(en, de)` in den Skripten,
  `L(en, de)` im Server). Texte an Modelle und MCP-Clients bleiben englisch.
- **Hell/Dunkel-Schalter** in der Kopfleiste: ohne eigene Wahl folgt das Design dem System; der Schalter merkt sich
  Hell oder Dunkel, unter *Einstellungen → Design* geht es zurück auf „Wie das System“. Das Design wird vor dem ersten
  Zeichnen gesetzt, damit nichts aufblitzt.
- **Lokaler Chat auch auf Englisch zuverlässig**: Die Anweisungen an das Ollama-Modell (Systemprompt, Hinweise zu
  Tool-Ergebnissen, `find_tools`) sind jetzt englisch; nur die Antwortsprache und der Satz „Aktionen erlauben“ folgen
  der Oberfläche. Die Werkzeug-Vorauswahl kennt englische Stichwörter (vorher fast nur deutsche – „where is … used“
  oder „overview“ erreichten die passenden Werkzeuge nicht). Geprüft mit qwen3-coder:30b: je sechs typische Fragen
  auf Englisch und Deutsch, alle mit dem richtigen Werkzeug und in der Sprache der Frage beantwortet.
- Kopfleiste: Passen die Reiter nicht neben Logo und Schalter (schmales Fenster, längere deutsche Begriffe), bekommen
  sie eine eigene Zeile statt abgeschnitten zu werden.
- **Zweisprachige Doku**: README, Bedienungsanleitung, Installation, Technik und Funktionsleitfaden gibt es jetzt auch
  auf Deutsch (`*.de.md`), jede Datei verlinkt ihre andere Sprache. Der Funktionsleitfaden hat eigene Screenshots je
  Sprache (`docs/images/en`, `docs/images/de`); `scripts/doc_screenshots.py --lang en|de`. Tests prüfen beide
  Leitfäden, die Bilder und die Sprachlinks sowie, dass die Oberfläche ohne deutsche Reste auf Englisch läuft.

## 0.26.1 – 2026-10-25

- **Funktionsleitfaden** `docs/FEATURES.md`: alle 133 Werkzeuge in einfachen Worten, gruppiert in 20 Bereiche, mit
  Stufe, Schutzmechanismen, Beispielen und 20 Screenshots der Web-UI (Demo-Wohnung auf der Dev-Instanz, Chat mit
  qwen3-coder). Ein Test stellt sicher, dass jedes Werkzeug beschrieben ist und jedes Bild existiert.
- **Automations-Abläufe verständlich**: `ha_list_traces`/`ha_get_trace` liefern zusätzlich `outcome` in einfachen
  Worten. HA markiert jeden beendeten Lauf mit `state: stopped`; das Modell las das als Fehlschlag. Ein Lauf ohne
  Trigger wird als manuell gestartet erklärt. Werte aus HA Core (`script_execution`).

## 0.26.0 – 2026-10-25

- **Konfigurationsdateien lesen und bearbeiten**: `ha_list_config_files`, `ha_read_config_file`,
  `ha_edit_config_file`, `ha_write_config_file`, `ha_delete_config_file`. Zugriff über das File-editor-Add-on
  (Supervisor-Ingress) oder `HA_CONFIG_DIR`. `secrets.yaml`, `.storage`, Datenbanken, Logs und Schlüsseldateien sind
  gesperrt; Zugangsdaten in Dateien erscheinen als `__REDACTED_n__` und werden unverändert zurückgeschrieben.
  YAML-/JSON-Syntaxprüfung vor dem Schreiben, HA-Konfigurationsprüfung davor und danach; neue Fehler **oder
  Warnungen** stellen die alte Datei automatisch wieder her. Journal-Art `file` mit Undo.
- Lehre aus dem Dev-Test: Ein Paket mit unbekannter Integration meldet HA als `valid` mit Warnung – deshalb zählen
  neue Warnungen als Fehlschlag.
- Getestet auf Dev (Paket + `configuration.yaml`, Reload, absichtlich kaputte Änderung, Undo) und auf Prod über das
  Add-on mit einer eigenen, nirgends eingebundenen Testdatei (danach per Undo entfernt). Chat (qwen3-coder) liest
  `configuration.yaml` korrekt.
- Abhängigkeit PyYAML für die Syntaxprüfung.

## 0.25.0 – 2026-10-25

- **Read-only ecosystem views**: `ha_list_addons`, `ha_get_system_info` (Supervisor installs), `ha_list_hacs_repositories`,
  `ha_list_zigbee_devices` (availability, lqi/rssi, last seen; `problems_only`), `ha_list_thread_networks`.
  Without Supervisor/HACS/ZHA the tools say so instead of failing. The `supervisor/api` proxy only allows GET of
  `/addons`, `/core/info`, `/supervisor/info`, `/os/info`, `/host/info`. No addresses, host names or keys.
- Verified read-only on prod (3 add-ons, healthy Supervisor, 6 HACS repositories, 11 Zigbee devices, 1 Thread
  network) and on the dev HA (no Supervisor/HACS/ZHA).

## 0.24.1 – 2026-10-25

- Weather forecast entries carry their `day` (today/tomorrow/weekday, in HA's time zone) and `now`; new `day`
  parameter returns only one day. Found in a chat test: at 1 a.m. qwen3-coder answered "morgen" with today's entry;
  with `day` and a prompt hint it now picks tomorrow (verified against HA).

## 0.24.0 – 2026-10-25

- **`ha_fire_event`** (admin write): custom events with optional data for automations with event triggers; events
  HA emits itself are refused.
- **`ha_call_service` `return_response`**: returns `service_response` of services that answer (capped).
- Verified on the dev HA: an automation with an event trigger and event_data filter switched a helper only for the
  matching event; `homeassistant_stop` refused; `todo.get_items` response returned.

## 0.23.0 – 2026-10-25

- **`ha_call_service` reads the targets back** (about 3 s) and returns `states_after` with `confirmed` per entity
  and `all_confirmed`; unconfirmed results carry a hint not to claim success. The chat prompt says the same.
- **`ha_get_weather_forecast`** (read-only): current weather and daily/hourly/twice-daily forecast from the
  `weather.get_forecasts` service response, times in HA's time zone.
- Verified on the dev HA (input_boolean on = confirmed, toggle = no expectation; forecasts incl. the DST change) and
  read-only on prod (forecast).

## 0.22.0 – 2026-10-25

- **Blueprints**: `ha_list_blueprints`, `ha_preview_blueprint` (HA fetches from an https URL, nothing saved),
  `ha_save_blueprint` (new path only), `ha_delete_blueprint` (delete level; undo re-imports from source_url).
- **Themes**: `ha_list_themes`, `ha_set_theme` (light/dark default, journaled).
- **Dashboard resources**: `ha_list_dashboard_resources`, `ha_add_dashboard_resource` (only `/local/` and
  `/hacsfiles/` paths: resources run in every user's browser), `ha_delete_dashboard_resource` (delete level).
- Journal kinds `blueprint`, `theme`, `resource`. Verified on the dev HA with the official motion light blueprint
  fetched from GitHub; prod read-only.

## 0.21.0 – 2026-10-25

- **Updates**: `ha_list_updates`, `ha_get_release_notes`, `ha_skip_update` (admin), `ha_install_update` (delete
  level; a timeout is reported as "still installing").
- **Reload and restart**: `ha_check_config` (read), `ha_reload` (all, core or any domain with a reload service;
  admin), `ha_restart` (delete level, refused while the configuration check reports errors).
- Verified on the dev HA: check, reload automation/all, real restart (logbook: stopped and started 5 s later).
  Prod read-only: no pending updates, configuration valid; install/restart refused without the delete level.

## 0.20.0 – 2026-10-25

- **Calendars**: `ha_list_calendars`, `ha_get_calendar_events` (one or all calendars, 1-31 days),
  `ha_create_calendar_event` (timed or all-day), `ha_update_calendar_event` (incl. one occurrence of a series),
  `ha_delete_calendar_event`.
- **To-do lists**: `ha_list_todo_lists`, `ha_get_todo_items`, `ha_add_todo_item`, `ha_update_todo_item` (tick off,
  rename, due), `ha_remove_todo_items`.
- Adding/changing is control level (writes + domain `calendar`/`todo` allowed), deleting needs the delete level;
  writes to unknown calendars or lists are refused instead of reported as done. No calendar integration = no
  calendars (not an error). New WS gate class for data actions (`calendar/event/update`).

## 0.19.0 – 2026-10-25

- **Helpers**: `ha_create_helper` also creates `input_button`, `counter`, `timer` and `schedule`;
  `ha_list_helper_types` lists storage and config-flow helper types (template, group, utility_meter, derivative,
  ...) with the existing config-flow helpers and how to create them.
- Setup flows: menus are answered with `{"next_step_id": ...}` (documented in the tool); an entry created by a flow
  (helper or integration) is journaled and undo removes it again.
- Chat preselection knows helper words (Zähler, Timer, Zeitplan, Template, Gruppe, Verbrauchszähler, ...).
- Tool counts per remote level updated in the user guide.

## 0.18.0 – 2026-10-25

- **Labels**: `ha_list_labels` (with usage), `ha_get_label` (members), `ha_create_label`, `ha_update_label`,
  `ha_delete_label`; areas accept `labels` in `ha_update_area`.
- **Categories** per scope (automation, script, scene, helpers): `ha_list_categories`, `ha_create_category`,
  `ha_update_category`, `ha_delete_category`.
- **Zones**: `ha_list_zones` (incl. persons inside; zone.home/YAML zones marked not editable), `ha_create_zone`,
  `ha_update_zone`, `ha_delete_zone`.
- **Entity registry**: `ha_get_entity_registry`; `ha_update_entity_registry` now also changes aliases, labels,
  categories, `disabled_by` and `hidden_by` (read-back via `config/entity_registry/get`); `ha_rename_entity` changes
  an entity ID within its domain and lists configs still using the old ID.
- Journal kinds `label`, `category`, `zone`; undoing a label/category delete also restores where it was used;
  rename undo renames back. Older area journal entries without labels still undo.

## 0.17.0 – 2026-10-25

- **`ha_find_usages`**: where is an entity or service used? Searches UI automations, scripts, scenes, groups and
  dashboards (storage and YAML) and returns the path inside each config; YAML automations without `id` are listed
  as skipped.
- **`ha_get_overview`**: version, time zone, entity counts per domain (unavailable/unknown/on), registry sizes,
  automations/scripts/scenes/dashboards, failing and disabled integrations.

## 0.16.0 – 2026-10-25

- **Tool search for small local models** (UI chat and CLI): besides the keyword preselection the model always gets
  a local `find_tools` search (German topic patterns plus word overlap with tool names/descriptions, read tools win
  ties, write tools only when actions are allowed); found tools are offered from the next round. A real permitted
  tool called by name is loaded instead of refused. More rounds (6) for search + call.
- Entity search understands German domain names ("Sonne" finds `sun.sun`, "Rollläden" finds covers).
- System prompt maps problem/error and history questions to the right tools; dangling `<tool_call>` tags are
  removed from answers.

## 0.15.0 – 2026-10-25

- **Debugging tools** (all read-only): `ha_list_traces`, `ha_get_trace` (automation/script runs step by step),
  `ha_get_error_log` (system log, filter by level/text), `ha_get_logbook`, `ha_get_history`, `ha_get_statistics`,
  `ha_list_statistic_ids`, `ha_list_repairs`, `ha_get_system_health`, `ha_render_template`, `ha_test_condition`.
  Results are reduced and capped; timestamps are shown in HA's configured time zone (small models misread UTC).
  The chat offers them for questions like "warum", "Verlauf", "Fehler", "Verbrauch", "Template".
- WebSocket transport can collect subscription events (system health); REST helper can return text.

## 0.14.0 – 2026-10-25

- **Domain pickers**: Einstellungen, MCP-Clients and the OAuth consent page list the domains the connected HA
  really has (entity count, German label), as chips writing the existing text field; risky domains (lock, alarm,
  cover, valve, siren, update, button, camera, notify, script, automation) are marked with a note. Clients and
  consent only offer the instance's allowed domains. New read-only `/api/domains`.
- User guide section on domains: what the allowed list covers (control tools only), how to find domains, and a
  risk table.

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
