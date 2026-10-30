# ha-safe-mcp

**Deutsch** · [English](README.md)

Eine selbst gehostete, auf Sicherheit ausgelegte [Model-Context-Protocol](https://modelcontextprotocol.io/)-Brücke zu Home Assistant. Du kannst sie mit einem lokalen MCP-Client über **stdio** nutzen oder die optionale, nur auf Loopback erreichbare Browser-Oberfläche zusammen mit einem lokalen Ollama-Modell verwenden. Sie ist kein uneingeschränkter REST-/WebSocket-Proxy. Alle schreibenden Operationen sind **standardmäßig deaktiviert**; sie einzuschalten ist eine bewusste Entscheidung für **deine eigene** Home-Assistant-Instanz.

Die Weboberfläche gibt es auf Englisch und Deutsch (Sprachumschalter in der Kopfzeile), und sie hat einen Umschalter für helles und dunkles Design.

## Loslegen

Du brauchst Python 3.11+, eine bestehende Home-Assistant-Instanz und einen langlebigen Zugriffstoken (Long-lived access token) von Home Assistant. Ollama wird nur für die mitgelieferte Chat-Oberfläche bzw. das CLI benötigt, nicht für einen allgemeinen MCP-Client.

```bash
# From the root of a clone of this repository:
cd ha-safe-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/ha-mcp-ui  # visit http://127.0.0.1:8765/ on the same machine
```

Der Einrichtungsassistent der Oberfläche testet deine Home-Assistant-Adresse und deinen Token, bevor er sie speichert. Richte für den Chat ein lokales Ollama-Modell ein, das Tool-Aufrufe beherrscht; wenn du einen externen MCP-Client verwendest, brauchst du Ollama nicht. Oberfläche und Dokumentation gibt es auf Englisch und Deutsch. **Gib Port 8765 nicht in dein Netzwerk oder ins Internet frei.** Die Oberfläche hat keine eingebaute Kontoanmeldung. In der vollständigen [Installationsanleitung](docs/INSTALL.de.md) findest du eine Einrichtung als reiner MCP-Server ohne Oberfläche, einen ersten Test nur mit Lesezugriff und Optionen für den Betrieb.

## Was es kann

**[Funktionsübersicht](docs/FEATURES.de.md)**: jede Funktion in einfachen Worten, mit Beispielen und Screenshots.

- **Für kleine lokale Modelle gemacht:** Bereiche und ganze Etagen als Ziel ("alle Lichter im Keller"), Sensoren
  nach ihrer Art auf Deutsch und Englisch ("Strom" findet "Fernseher Leistung") und Aufrufe im Stil von
  Home-Assistant-YAML, die vor der Freigabekarte repariert werden. So schafft ein 30B-Modell auf eigener Hardware
  das meiste mit ein oder zwei Aufrufen.

- Zustände lesen, Entitäten und Dienste finden; Entitäten in einem Raum finden; erlaubte Dienste für eine Entität oder bis zu 20 Entitäten derselben Domain aufrufen.
- Ein **fester, dokumentierter Katalog von REST-Routen** sowie typisierte Werkzeuge für Automationen, Dashboards, Helfer, Registry-Metadaten, Bereiche/Etagen/Geräte (auch Geräte und verwaiste Entitäten entfernen), Szenen/Skripte, Konfigurationsabläufe (Config Flows) und Einstellungen von Integrationen, Home-Assistant-Backups, das Energie-Dashboard (Steckdosen, Solar, Batteriespeicher) und Assist (Pipelines, Freigabe für Sprachassistenten, Satzprüfung).
- Getrennte Schalter für Steuerung, administrative Änderungen und Löschen; in CLI und Oberfläche standardmäßig eine Bestätigung pro Aufruf. Andere MCP-Clients müssen ihre eigene menschliche Freigabe umsetzen.
- Entfernter MCP-Endpunkt `/mcp` (Streamable HTTP) für Claude Code, Codex, ChatGPT, Claude und andere Clients: Bearer-Token oder OAuth-2.1-Anmeldung (Zustimmungsseite hinter deinem UI-Login), eine Berechtigungsstufe pro Client, begrenzt durch die Schalter der Instanz.
- Tiefensuche („Wo wird diese Entität verwendet?“) und eine Systemübersicht.
- Aktionen werden zurückgelesen: Die Antwort sagt, ob jedes Gerät den gewünschten Zustand wirklich erreicht hat; Dienst-Antworten
  und eigene Ereignisse (Custom Events).
- Wettervorhersage (täglich, stündlich) aus den Wetter-Entitäten von Home Assistant.
- Nur-Lese-Ansichten von Add-ons, Systemzustand, HACS, Zigbee-Geräten und Thread-Netzwerken.
- Konfigurationsdateien (YAML, Packages, Custom Components) lesen und bearbeiten, mit Maskierung von Zugangsdaten, Konfigurationsprüfung,
  automatischem Zurücksetzen und Rückgängigmachen; über das File-editor-Add-on oder ein lokales Konfigurationsverzeichnis.
- Blueprints (Import per URL), Themes und Dashboard-Ressourcen.
- Updates, Konfigurationsprüfung, Neuladen und Neustart (Neustart nur nach bestandener Prüfung).
- Kalender und To-do-Listen: Termine und Einträge lesen, hinzufügen, ändern, abhaken, löschen.
- Helfer: Eingabe-Helfer, Tasten, Zähler, Timer, Zeitpläne und Helfer aus Konfigurationsabläufen (Template, Gruppe, Verbrauchszähler
  (Utility Meter), Ableitung, ...).
- Labels, Kategorien und Zonen; Aliasse, Labels, Kategorien und Ausblenden von Entitäten sowie Umbenennen von Entitäts-IDs.
- Fehlersuche: Traces von Automationen/Skripten, Fehlerprotokoll, Logbuch, Verlauf, Langzeitstatistiken, Reparaturen, Systemzustand, Tests von Templates und Bedingungen.
- Änderungsjournal mit Rückgängig: Jede Konfigurationsänderung speichert ihren vorherigen Zustand lokal (30 Tage) und kann im Chat oder im Reiter **Änderungen** der Oberfläche rückgängig gemacht (und wiederhergestellt) werden.
- Speicher für Zugangsdaten in der Oberfläche für Geheimnisse von Integrationen (per Alias referenziert), gespeicherte Pläne/Codeblöcke (werden nicht ausgeführt), Anfrageprotokoll nur mit Metadaten, Backup-Download.
- Backups wiederherstellen, mit Sicherheits-Backup davor (Konfiguration und Datenbank; nie Add-ons oder Ordner).
- Kein Bearbeiten geschützter Dateien (`secrets.yaml`, `.storage`, Datenbanken), keine allgemeine Netzwerkerkennung, keine beliebigen WebSocket-Befehle und kein unbegrenzter API-Proxy.

## Dokumentation

| Dokument | Zielgruppe |
|---|---|
| [Installation](docs/INSTALL.de.md) | Voraussetzungen, Umgang mit dem Token, lokale Einrichtung, MCP-Clients, Oberfläche/CLI, Tests |
| [Benutzerhandbuch](docs/USER_GUIDE.de.md) | Häufige Abläufe zum Lesen, Steuern und Bauen sowie Fehlerbehebung |
| [Technische Dokumentation](docs/TECHNICAL.de.md) | Architektur, Vertrauensgrenzen, APIs, lokale Daten, Entwicklungsablauf |
| [Werkzeug-Referenz (englisch)](docs/TOOLS.md) | Erzeugt aus den registrierten MCP-Tool-Schemas |
| [Changelog](CHANGELOG.md) | Versionsgeschichte (ältere Einträge können auf Deutsch bleiben) |

Siehe [CONTRIBUTING.md](../CONTRIBUTING.md), wenn du beitragen möchtest, und [LICENSE](LICENSE) für die Weiterverwendung unter MIT. Änderungen an den internen Verwaltungsschnittstellen von HA Core können einzelne administrative Werkzeuge kaputt machen; teste sie an einem Wegwerf-HA-Core, bevor du dich auf sie verlässt.
