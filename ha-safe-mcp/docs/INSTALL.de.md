# ha-safe-mcp auf deinem eigenen Home Assistant installieren

**Deutsch** · [English](INSTALL.md)

Führe die Befehle im **Unterverzeichnis `ha-safe-mcp/`** eines Klons aus, niemals im Wurzelverzeichnis des Repositorys. Das Repository enthält keine vorkonfigurierte HA-Installation. Du brauchst Python 3.11 oder neuer. Installiere und konfiguriere Home Assistant separat; ein lokaler Ollama-Server mit einem Modell, das Tool-Aufrufe beherrscht, ist optional (nur für den Chat nötig).

## 1. Paket installieren

```bash
git clone https://github.com/GehrmannSolutions/HomeAssistant.git
cd HomeAssistant/ha-safe-mcp
python3 -m venv .venv
.venv/bin/python -m pip install -e .
# optional test dependencies:
.venv/bin/python -m pip install -e '.[test]'
```

Das Repository ist möglicherweise noch nicht öffentlich zugänglich; wenn dir der Zugriff verweigert wird, frag den Eigentümer, statt eine andere Quelle zu versuchen. Deine virtuelle Umgebung bleibt lokal und wird von Git ignoriert. Auf einem anderen Betriebssystem nimmst du statt `.venv/bin/` den dort üblichen Pfad für venv-Aktivierung bzw. ausführbare Dateien. Für diesen Schritt brauchst du weder einen Home-Assistant-Token noch einen persönlichen GitHub-Zugriffstoken.

## 2. Home-Assistant-Token erstellen

Öffne in **deiner** HA-Weboberfläche dein Profil → **Sicherheit** → **Langlebige Zugriffstoken** und erstelle einen Token für diesen Client ([HA-Dokumentation zur Authentifizierung](https://www.home-assistant.io/docs/authentication/)). Für reinen Lesezugriff verwendest du am besten einen eigenen HA-Benutzer ohne Administratorrechte. Werkzeuge, die in HA nur Administratoren vorbehalten sind, brauchen einen Administrator-Token, auch wenn der Server sie als „read“ einstuft. Widerrufe den Token in HA, falls er offengelegt wurde. Füge ihn niemals in einen Chat, ein Issue, einen Screenshot, die Shell-Historie, Git oder einen Ollama-Prompt ein.

Wähle einen Weg zur Konfiguration:

### A. Browser-Assistent (für den lokalen Chat)

Stell sicher, dass dein lokaler Ollama-Dienst läuft und ein Modell bereitstellt, das Tool-Aufrufe unterstützt (der Assistent listet die verfügbaren Modelle auf). Dann:

```bash
.venv/bin/ha-mcp-ui --read-only
# Open http://127.0.0.1:8765/ on this same machine
```

Folge den Schritten für den Test von HA-URL und Token, die Auswahl des Ollama-Modells und die Sicherheitseinstellungen. Die Standard-Einstellungsdatei ist `ha-safe-mcp/.env` (angelegt mit Modus 0600). Der Token wird nach dem Speichern nicht mehr an den Browser zurückgegeben. `--read-only` ist eine zusätzliche **harte Obergrenze**: Gespeicherte Schreib-Einstellungen können sie nicht aushebeln. Lass die Obergrenze nur weg, wenn du erlaubte Aktionen bewusst an einer passenden HA-Instanz testest. `--max-level control` erlaubt nur Dienstaufrufe für erlaubte Domains (sofern in den Einstellungen aktiviert); `--max-level full` erlaubt zusätzlich die konfigurierten Admin- und Lösch-Stufen. Lass den Dienst an `127.0.0.1` gebunden.

Die Weboberfläche ist standardmäßig englisch und lässt sich in der Kopfleiste auf Deutsch umstellen. Die Oberfläche ist eine lokale Anwendung, kein MCP-HTTP-Endpunkt; für den Chat startet sie einen stdio-MCP-Prozess.

### B. stdio-MCP-Client ohne Oberfläche (Ollama nicht nötig)

```bash
cp -n .env.example .env
chmod 600 .env
# Use a local editor to set HA_URL and HA_TOKEN in .env.
# Leave HA_ALLOW_WRITE, HA_ALLOW_ADMIN_WRITE and HA_ALLOW_DELETE false initially.
```

`HA_URL` muss eine `http(s)`-Wurzel-URL ohne Pfad, Query oder eingebettete Zugangsdaten sein und **vom MCP-Prozess aus** erreichbar sein. Für ein entferntes HA verwendest du HTTPS mit normaler Zertifikatsprüfung. Wenn `127.0.0.1:8123` als Standard eingetragen ist, bedeutet das den lokalen Rechner, nicht einen entfernten Server oder einen Docker-Host, der aus einem Container heraus erreicht wird. Setze `HA_URL` auf deine eigene HA-Adresse. Umgebungsvariablen, die im Prozess bereits gesetzt sind, haben Vorrang vor Werten aus `.env`.

Ein MCP-Client, der einen Befehl und ein Arbeitsverzeichnis unterstützt, kann eine Konfiguration nach diesem Muster verwenden (passe sie an deinen Client an und ersetze den Platzhalter durch den absoluten Pfad deines Klons):

```json
{
  "mcpServers": {
    "home-assistant": {
      "command": "/ABSOLUTE/PATH/HomeAssistant/ha-safe-mcp/.venv/bin/ha-safe-mcp",
      "cwd": "/ABSOLUTE/PATH/HomeAssistant/ha-safe-mcp"
    }
  }
}
```

Das Arbeitsverzeichnis ist wichtig: Dort lädt der stdio-Server die `.env`. Wenn dein Client `cwd` nicht unterstützt, verwende stattdessen eine angemessen abgesicherte Umgebung pro Prozess; schreib keinen echten Token in eine gemeinsam genutzte JSON-Datei des Clients. Der MCP-Server spricht stdio-JSON-RPC; wenn du `ha-safe-mcp` in einer Shell startest, öffnet sich weder ein Chat noch eine Webseite.

**Erster Test nur mit Lesezugriff:** Starte den MCP-Client neu, rufe `ha_rest_catalog` mit `{}` auf (lokaler Katalog, keine Anfrage an HA) und danach `ha_rest_query` mit `{"path":"/api/"}` (echte Anfrage an HA). `ha_search_entities` kann bei einem frischen HA leer sein und beweist für sich allein noch keine Verbindung. Ein fehlgeschlagener Aufruf bedeutet nicht, dass das Haus leer ist.

## 3. Optionaler Ollama-Kommandozeilen-Client

Installiere und starte [Ollama](https://docs.ollama.com/), lade ein Modell, das Tool-Aufrufe beherrscht, und führe im selben Verzeichnis aus:

```bash
ollama pull qwen2.5-coder:7b
.venv/bin/ha-ollama-chat 'List available lights using current Home Assistant state.'
```

Das nutzt die `.env` über den MCP-Kindprozess. Wenn Schreibzugriffe in `.env` ausdrücklich aktiviert sind, fügst du `--allow-write` hinzu, um die schreibenden Werkzeuge freizugeben; das CLI fragt trotzdem **bei jedem** vorgeschlagenen Schreibvorgang nach einem exakten `YES` (oder `JA`). Die Auswahl der Werkzeuge basiert auf Schlüsselwörtern und kann bei komplexen Aufgaben etwas übersehen. Der Chat-Text im CLI ist selbst kein HA-Befehl und darf keine Geheimnisse enthalten.

## 4. Berechtigungsschalter und Isolation

| Einstellung in `.env` | Standard | Wirkung |
|---|---|---|
| `HA_ALLOW_WRITE` | `false` | Erlaubt Steuerung bzw. Dienstaufrufe für `HA_ALLOWED_DOMAINS` (und nicht-administrative REST-Schreibzugriffe, soweit katalogisiert). |
| `HA_ALLOW_ADMIN_WRITE` | `false` | Erlaubt zusätzlich zum Schreiben auch Konfigurationsänderungen; HA verlangt, wo nötig, weiterhin seine eigenen Administratorrechte. |
| `HA_ALLOW_DELETE` | `false` | Erlaubt zusätzlich zu den beiden obigen auch zerstörerische Lösch-Werkzeuge. |
| `HA_ALLOWED_DOMAINS` | `light,switch,fan,climate,cover,media_player` | Erlaubnisliste der Ziel-Domains für Dienstaufrufe, **keine** allgemeine Begrenzung für administrative Änderungen. Grenze sie ein, bevor du Steuerung erlaubst. Was Domains sind und welche riskant sind: [USER_GUIDE.de.md](USER_GUIDE.de.md#domains-was-die-liste-erlaubter-domains-bedeutet-und-wie-du-sie-wählst). |
| `HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE` | `false` | Überspringt **nur im Chat der Oberfläche** die Freigabekarte für diese erlaubte Stufe; das Kästchen „Aktionen erlauben“ im Chat bleibt Pflicht. Für den Alltag besser nicht verwenden. |

Ein allgemeiner MCP-Client übernimmt die Freigabekarten der Oberfläche oder das `YES` des CLI **nicht**: Sorge in diesem Client selbst für eine menschliche Freigabe pro Aufruf. Die Server-Einstellungen schalten Operationen frei, sie ersetzen keine Zustimmung. Eine separate Oberfläche mit `--read-only --env-file /path/to/instance.env` begrenzt Schreibzugriffe ebenfalls **im Code**; nimm einen eigenen HA-Token ohne Administratorrechte und eigene XDG-Verzeichnisse, wenn du mehrere Installationen voneinander trennst. `--max-level control` schränkt **nicht** ein, welche einzelnen Lichter oder Geräte innerhalb einer erlaubten Domain gesteuert werden können. Für echten Nur-Lese-Betrieb kombinierst du die harte Obergrenze mit minimalen HA-Rechten.

Die Oberfläche bindet an Loopback und prüft Host, Origin und CSRF; **sie hat keine eigene Anmeldung**. `--allow-remote` schaltet die Loopback-Sperre ab und ist für sich allein unsicher. `--public-host` ist ein *optionaler* Betriebsmodus mit Cloudflare Access; er setzt `CF_ACCESS_AUD` und `CF_ACCESS_TEAM_DOMAIN`, eine gültige Access-Anwendung bzw. -Richtlinie und einen korrekt eingerichteten Reverse-Tunnel voraus und prüft bei jeder Anfrage signierte Access-JWTs. Er ist kein allgemeiner Authentifizierungsmodus und richtet Cloudflare nicht für dich ein. Veröffentliche nicht den rohen Ursprungsserver (Origin). Siehe [technische Dokumentation](TECHNICAL.de.md).

## 5. Lokale Daten und Updates

Die Oberfläche schreibt `.env` in das Projekt-Unterverzeichnis (oder in die Datei, die du ausdrücklich mit `--env-file` angibst). Unter Linux liegen Zugangsdaten und ihr Verschlüsselungsschlüssel standardmäßig in `~/.config/ha-safe-mcp/credentials/`, im Chat erzeugte Pläne/Skripte in `~/.local/share/ha-safe-mcp/files/` und Audit-Metadaten zu Anfragen in `~/.local/state/ha-safe-mcp/audit/` (30 Tage Aufbewahrung). Der Chatverlauf im Browser liegt im `localStorage` des Browsers. Diese Daten sind **Daten deiner eigenen Installation**; sie werden von Git ignoriert und gehören nicht zu diesem Repository. Sichere den Schlüssel für die Zugangsdaten zusammen mit dem verschlüsselten Speicher. Werden Schlüssel und Speicher zusammen gestohlen, sind die Daten nicht mehr geschützt. Um den Quellcode zu aktualisieren, installierst du ihn erneut im editierbaren Modus (`.venv/bin/python -m pip install -e .`), liest das [Changelog](../CHANGELOG.md) und startest Client bzw. Oberfläche neu. Überschreibe die `.env` nicht.

**Umstieg vom früheren Layout im Repository-Wurzelverzeichnis:** Wenn du die `.env` bisher im Wurzelverzeichnis des Repositorys hattest, verschiebe sie nicht blind und verlier den Token nicht aus den Augen. Halte sie geschützt; starte die Oberfläche mit einem ausdrücklichen `--env-file /path/to/previous/.env` und setze das `cwd` des MCP-Clients auf das Verzeichnis dieser Datei, oder übertrage die Einstellungen bewusst mit einem lokalen Editor in die `.env` des Unterprojekts. Neue Installationen sollten `ha-safe-mcp/.env` verwenden. Daten in den XDG-Verzeichnissen bleiben, wo sie sind. Es findet keine automatische Migration statt.

## 6. Tests (niemals an einem echten Zuhause)

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/gen_tool_reference.py --check
```

Unit- und ASGI-Tests laufen mit Fakes und brauchen kein laufendes HA. Optionale Docker-Smoke-Tests verwenden `compose.test.yaml`, um ein **Test-Double** auf dem Loopback-Port 18123 zu erzeugen und MCP über stdio zu testen; `tests/ha_core_smoke.py` ist **zerstörerisch**, richtet ein frisches HA Core ein (Onboarding) und ändert dessen Konfiguration. Setze `HA_CORE_TEST_URL` niemals auf ein produktives, familiär genutztes oder bereits eingerichtetes HA. Siehe [technische Hinweise zu Tests](TECHNICAL.de.md#tests-verifikation-und-grenzen).

Weiter: [Werkzeuge sicher verwenden](USER_GUIDE.de.md) · [Werkzeug-Referenz (englisch)](TOOLS.md) · [Architektur](TECHNICAL.de.md).
