# Benutzerhandbuch: ha-safe-mcp mit deinem Home Assistant nutzen

**Deutsch** · [English](USER_GUIDE.md)

Dieses Handbuch ist für eine Installation gedacht, die dir gehört oder die du verwaltest. Fang mit Lesezugriffen an, ermittle IDs aus **deinem** Home Assistant (HA) und gib Änderungen erst frei, nachdem du das genaue Ziel geprüft hast. Alle Entitätsnamen, IDs, Bereichsnamen und Konfigurationsdaten unten sind **erfundene Platzhalter** zur Veranschaulichung; sie behaupten nicht, dass diese Objekte auf deinem System existieren. Kopiere kein Schreib-Beispiel in ein echtes Zuhause, ohne jedes Ziel zu ersetzen und zu prüfen.

Eine leicht verständliche Beschreibung jeder Funktion mit Beispielen und Bildschirmfotos findest du in der
[Funktionsübersicht](FEATURES.de.md). Installation und Voraussetzungen stehen in [INSTALL.de.md](INSTALL.de.md); Aufbau und Sicherheitsgrenzen in [TECHNICAL.de.md](TECHNICAL.de.md); die vollständigen aktuellen Werkzeug-Signaturen in der [Werkzeug-Referenz (englisch)](TOOLS.md); den Projektüberblick in [README.de.md](../README.de.md). Dieses Handbuch nennt die Beschriftungen der deutschen Oberfläche (Umschalter `EN | DE` in der Kopfleiste) genau so, wie sie dort stehen, damit du sie leicht findest.

## 1. Sicher verbinden

1. Schließe in HA die Ersteinrichtung ab und erstelle in deinem Benutzerprofil unter **Sicherheit → Langlebige Zugriffstoken** ein **langlebiges Zugriffstoken**. Verwende ein Konto, das nur die nötigen HA-Berechtigungen hat; Konfigurationsänderungen erfordern in der Regel einen HA-Administrator. Das Token erbt die HA-Berechtigungen dieses Kontos. Halte es aus Chats, Bildschirmfotos, mit anderen geteilten Client-Konfigurationen und der Versionsverwaltung heraus. Wenn es offengelegt wurde, widerrufe es in HA und ersetze es.
2. Installiere dieses Paket wie in [INSTALL.de.md](INSTALL.de.md) beschrieben. Im Projektverzeichnis `ha-safe-mcp` stehen danach die Befehle `ha-mcp-ui`, `ha-safe-mcp` und `ha-ollama-chat` zur Verfügung. Verwende Python 3.11 oder neuer. Wenn du ohne die Oberfläche einrichtest, kopiere `.env.example` in diesem Verzeichnis in eine **private** `.env`, setze `HA_URL` auf die Stamm-URL deines HA und `HA_TOKEN` auf dein echtes Token, und lass anfangs `HA_ALLOW_WRITE=false`, `HA_ALLOW_ADMIN_WRITE=false`, `HA_ALLOW_DELETE=false` stehen. Mach die Datei nur für deinen Benutzer lesbar (`chmod 600 .env`). Das Beispiel-Token in `.env.example` ist nicht nutzbar. Eine nicht lokale HA-Adresse sollte HTTPS mit normaler Zertifikatsprüfung verwenden; in Beispielen der Dokumentation steht `https://ha.example.com`, das du durch deine eigene, vertrauenswürdige HA-Adresse ersetzt.
3. Die MCP-Verbindung läuft über **stdio** (einen lokalen Kindprozess), nicht über einen HTTP-MCP-Endpunkt. Die Weboberfläche ist eine eigene, lokale Browser-Anwendung. Mach weder die Oberfläche noch eine stdio-Brücke ohne ein passendes Anmeldekonzept im Netzwerk erreichbar. Die Oberfläche lauscht standardmäßig nur auf Loopback (dem eigenen Rechner) und verweigert andere Adressen, solange das nicht ausdrücklich überschrieben wird; eine direkt aus der Ferne erreichbare Oberfläche hat keine eingebaute Benutzeranmeldung.

### Ersteinrichtung im Browser

Starte `ha-mcp-ui` aus der installierten Umgebung (zum Beispiel `.venv/bin/ha-mcp-ui`) und öffne `http://localhost:8765/` auf demselben Rechner. Der Assistent (**Ersteinrichtung**) hat vier Schritte:

1. **Home Assistant:** Gib die Stamm-URL und das Token ein und klicke auf **Verbindung prüfen**. Damit wird die Verbindung vor dem Speichern getestet, und es werden Informationen zu HA und zum Benutzer des Tokens angezeigt. Füge niemals ein Token in den Chat ein.
2. **Lokales Modell:** Gib die Adresse deines Ollama an, lade die installierten Modelle (**Modelle laden**) und wähle eines, das Werkzeuge unterstützt. Das eingestellte Modell ist für den Chat in der Oberfläche gedacht; ein beliebiger MCP-Client braucht es nicht.
3. **Sicherheit:** Beginne mit Nur-Lesen. **Steuern erlauben** erlaubt das Steuern; **Konfiguration ändern erlauben** setzt zusätzlich Steuern und ein HA-Administrator-Token voraus; **Löschen erlauben** setzt zusätzlich Konfigurationszugriff voraus. Beschränke **Erlaubte Domains für Steuerbefehle** auf die Domains, die du wirklich steuern willst.
4. **Fertig:** Die Einstellungen werden mit den Rechten 0600 in die `.env` des Projekts gespeichert. Die Oberfläche zeigt das gespeicherte Token nicht wieder an. Öffne später **Einstellungen**, um etwas zu ändern; lässt du das Token-Feld leer, bleibt das Token nur erhalten, wenn die HA-Adresse gleich bleibt. Beim Speichern wird HA erneut getestet. Chats in der Oberfläche verwenden neue Einstellungen ab ihrer nächsten Anfrage; separat laufende MCP-Clients musst du nach Änderungen an der `.env` neu starten.

Auf der Seite **Übersicht** siehst du die HA-Verbindung und die Berechtigungen. **Chat** und die schwebende Chat-Blase teilen sich ein Gespräch im Browser; **Neu** leert es, **Stopp** bricht eine laufende Anfrage ab. Die Oberfläche kann immer nur eine Chat-Anfrage gleichzeitig bearbeiten. Wenn du für eine eigene Installation eine feste Obergrenze brauchst, starte die Oberfläche mit `--read-only` (gleichbedeutend mit `--max-level read`) oder mit `--max-level control`, um Administrator-Änderungen und Löschen zu verbieten, selbst wenn eine Env-Datei sie verlangt. Halte für getrennte Instanzen auch getrennte Env-Dateien und XDG-Verzeichnisse. Diese Schalter begrenzen den MCP-Kindprozess dieser Oberfläche; sie ändern weder einen separat gestarteten MCP-Server noch die Berechtigungen des HA-Kontos.

### Sprache und Hell/Dunkel

Die Weboberfläche startet auf Englisch. Mit dem Umschalter `EN | DE` in der Kopfleiste wechselst du auf Deutsch
und zurück; Fehlermeldungen und Hinweise vom Server kommen dann ebenfalls auf Deutsch. Der Sonne/Mond-Schalter
daneben wechselt zwischen hellem und dunklem Design. Ohne eigene Wahl richtet sich die Oberfläche nach deinem
System; unter *Einstellungen → Design → Wie das System* kommst du dorthin zurück. Beide Einstellungen gelten nur
für diesen Browser. Das Modell antwortet in der Sprache, in der du schreibst; ist das unklar, in der Sprache des Umschalters.

### Einen anderen MCP-Client verbinden

Richte einen Client, der lokale stdio-Server unterstützt, so ein, dass er den installierten Befehl `ha-safe-mcp` startet, und zwar mit dem Verzeichnis `ha-safe-mcp`, in dem die `.env` liegt, als Arbeitsverzeichnis. Pass die Schreibweise an das tatsächliche Konfigurationsformat deines Clients an:

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

Der stdio-Server lädt **nur** die `.env` in seinem aktuellen Arbeitsverzeichnis (`Path.cwd() / ".env"`); in übergeordneten Verzeichnissen sucht er nicht. Unterstützt der Client `cwd` nicht, sorge auf anderem, sicherem Weg dafür, dass die nötigen `HA_...`-Einstellungen seinen Prozess erreichen; veröffentliche keine Client-Konfiguration, die ein Token enthält. Bereits gesetzte Umgebungsvariablen des Prozesses haben Vorrang vor Werten aus dieser `.env`. Starte den Client nach einer Änderung der Einstellungen neu. Rufe zuerst `ha_rest_catalog` mit `{}` auf (lokaler Katalog), dann `ha_rest_query` mit `{"path":"/api/"}`, um den Zugriff auf HA wirklich zu prüfen. `ha_search_entities` mit `{"limit":10}` kann leer sein, selbst wenn eine neue HA-Instanz einwandfrei läuft. Dein MCP-Client zeigt eventuell auch im Nur-Lesen-Modus alle Werkzeuge an; der Server prüft die Berechtigungen **beim Aufruf**. Ein beliebiger MCP-Client übernimmt die Freigabe-Karten dieser Oberfläche nicht: Lege dort eine eigene Regel für menschliche Freigaben von Schreibzugriffen fest.

### Einen entfernten Client über HTTP verbinden (Claude Code, Codex, ChatGPT, Claude)

Die Weboberfläche stellt außerdem den MCP-Endpunkt `/mcp` bereit (Streamable HTTP), z. B. `http://localhost:8765/mcp` oder, hinter einem
Reverse Proxy, `https://<your-host>/mcp`.

1. Öffne in der Oberfläche **MCP-Clients**, gib einen Namen ein, wähle eine Stufe (**Nur lesen**, **Steuern**, **Konfiguration ändern**,
   **Löschen**) und optional eine Domain-Liste, dann **Client anlegen**. Das Token (`hsm_…`) wird **nur einmal** angezeigt; die Oberfläche
   gibt fertige Befehle aus:
   - Claude Code: `claude mcp add --transport http ha-safe-mcp <endpoint> --header "Authorization: Bearer <token>"`
   - Codex: `export HA_SAFE_MCP_TOKEN='<token>'` und
     `codex mcp add ha-safe-mcp --url <endpoint> --bearer-token-env-var HA_SAFE_MCP_TOKEN`
   - andere Clients: die Endpunkt-Adresse plus der Header `Authorization: Bearer <token>`.
2. Die Stufe des Clients wird durch die **Schalter der Instanz** unter **Einstellungen** **nach oben begrenzt** (angezeigt als „Wirksam“). Die Domain-Liste
   schränkt die erlaubten Domains der Instanz weiter ein. Werkzeuge oberhalb der Stufe des Clients werden ihm gar nicht erst angezeigt.
3. Du kannst die Stufe eines Clients jederzeit in der Tabelle ändern; **Entfernen** widerruft sein Token sofort.

Hinweise:

- Anfragen ohne gültiges Token bekommen HTTP 401 mit einem Verweis auf das OAuth-Discovery-Dokument.
- Fremde Clients zeigen die Freigabe-Karten dieser Oberfläche nicht an und ignorieren die Schalter „ohne Freigabe“; ob sie vor einer Aktion
  nachfragen, entscheidet der Client (die Werkzeuge tragen `readOnlyHint`/`destructiveHint`, damit Clients vor Schreibzugriffen nachfragen können).
  Gib jedem Client nur die Stufe, die er braucht.
- Jeder Client bekommt einen eigenen MCP-Server-Prozess mit seinen begrenzten Rechten; seine Werkzeugaufrufe erscheinen unter **Protokoll** mit
  der zufälligen ID des Clients und seine Konfigurationsänderungen unter **Änderungen**, genau wie Aktionen aus dem Chat.
- Gerätenamen und Zustände gehen an den Anbieter des KI-Clients, den du verbindest.
- **Hinter Cloudflare Access** (oder einem anderen Anmelde-Proxy): Die Browser-Anmeldung des Proxys können MCP-Clients nicht durchlaufen.
  Lege eine Ausnahme für genau die Pfade `/mcp` und `/.well-known/oauth-*` an (Cloudflare: eine selbst gehostete
  Anwendung für `<host>/mcp` und `<host>/.well-known/oauth-*` mit einer *Bypass*-Richtlinie). Die Oberfläche und die OAuth-Zustimmungsseite
  `/oauth/authorize` bleiben hinter der Anmeldung; `/mcp` wird durch die Tokens geschützt.

### Mit OAuth verbinden (Web-Connectors von ChatGPT und Claude oder jeder Client mit OAuth-Unterstützung)

Füge im Client einen eigenen MCP-Server bzw. Connector mit der Adresse `https://<your-host>/mcp` hinzu und wähle OAuth (keine
Client-ID und kein Secret nötig: Der Client registriert sich selbst). Der Client öffnet dann die Zustimmungsseite
`/oauth/authorize` in deinem Browser, hinter der Anmeldung deiner Oberfläche. Sie zeigt den Namen des Clients und wohin du
zurückgeleitet wirst; wähle die Stufe und optional Domains und drücke **Freigeben** (oder **Ablehnen**).

- Die Freigabe wird zu einem Eintrag der Art OAuth unter **MCP-Clients** und ist wie jeder Token-Client durch die Schalter der Instanz
  begrenzt. Gibst du denselben Client erneut frei, ersetzt das seine Stufe und seine Tokens. **Entfernen** widerruft ihn.
- Zugriffstokens gelten eine Stunde; der Client erneuert sie mit einem wechselnden Refresh-Token (60 Tage).
- Technisch: OAuth 2.1 mit dynamischer Client-Registrierung und verpflichtendem PKCE (S256); Discovery-Dokumente unter
  `/.well-known/oauth-protected-resource/mcp` und `/.well-known/oauth-authorization-server`; Token- und
  Registrierungs-Endpunkte unter `/mcp/oauth/token` und `/mcp/oauth/register`.

### Ein lokales Ollama-Modell über die Kommandozeile fragen

Installiere und starte Ollama separat und lade ein Modell herunter, das **Werkzeuge unterstützt**. Die Kommandozeile verwendet standardmäßig `qwen2.5-coder:7b` und den Ollama-Dienst auf dem eigenen Rechner; bei Bedarf überschreibst du das mit `--model` und `--ollama-url`. Im Projektverzeichnis, nachdem die `.env` eingerichtet ist:

```sh
ollama pull qwen2.5-coder:7b
.venv/bin/ha-ollama-chat 'Use ha_search_entities to find available lights; report only IDs actually found.'
```

Die Kommandozeile stellt standardmäßig nur Lese-Werkzeuge bereit. Für einen bewussten Schreibzugriff schaltest du zuerst die passende Server-Berechtigung frei und startest `ha-ollama-chat --allow-write '...'`. Das Programm zeigt den vorgeschlagenen Werkzeugnamen und die **vollständigen JSON-Argumente** an und verlangt **für jeden Schreibaufruf** genau die Eingabe `YES` (oder `JA`). Jede andere Eingabe lehnt ihn ab. Gib `YES` erst ein, wenn du Entitäts-ID, Dienst und Daten geprüft hast; es gibt keinen Probelauf. `--allow-write` allein kann abgeschaltete Server-Berechtigungen nicht umgehen. Das Modell wählt anhand von Stichwörtern im Prompt und ausdrücklich genannten Werkzeugnamen eine begrenzte Auswahl an Werkzeugen und hat eine begrenzte Zahl an Werkzeug-Runden: Wenn ihm ein Werkzeug fehlt, nenne es direkt beim Namen oder verwende einen vollwertigen MCP-Client. Die Rückfragen der Kommandozeile sind englisch.

## 2. Berechtigungen und Freigaben verstehen

| Aufgabe | Nötige Server-Einstellungen | HA-Konto / weitere Prüfungen |
|---|---|---|
| Aktuelle Zustände, Bereiche, Konfiguration, Werkzeugkatalog lesen | Keiner der Schreib-Schalter | HA erzwingt trotzdem die Berechtigungen der Endpunkte; manche Lese-Endpunkte (vor allem Backups und einige Integrationsdaten) erfordern in HA einen Administrator. |
| Eine erlaubte Entität steuern (`ha_call_service`, Szene aktivieren, Skript ausführen) | `HA_ALLOW_WRITE=true` | Ziel-Domain in `HA_ALLOWED_DOMAINS`; die HA-Aktion muss existieren. |
| Automationen, Dashboards, Helfer, Bereiche, Integrationen, Backups anlegen/ändern; Administrator-REST-Operationen | `HA_ALLOW_WRITE=true` **und** `HA_ALLOW_ADMIN_WRITE=true` | HA-Administrator-Token. |
| Unterstützte Objekte löschen | Alles oben **und** `HA_ALLOW_DELETE=true` | HA-Administrator-Token; wähle eine ID, die ein Listen- oder Lese-Werkzeug zurückgegeben hat. |

Alle Schreib- und Auto-Schalter stehen standardmäßig auf `false`. Die voreingestellte Liste der Steuer-Domains ist `light,switch,fan,climate,cover,media_player`; sie ist **keine** allgemeine Beschränkung dafür, was eine Automation oder ein Skript später tun darf. Ein Dienstaufruf akzeptiert eine Entitäts-ID oder eine Liste von höchstens 20 Entitäts-IDs derselben Domain, ohne alternative Ziele wie `area_id`/`device_id` in `service_data`. Einen Raum kannst du vorher mit `ha_list_area_entities` auflösen, statt ihn direkt an die Aktion zu übergeben. `scene` und `script` müssen bewusst zur Domain-Liste hinzugefügt werden, bevor ihre Aktivierungs-Werkzeuge funktionieren; ein Skript kann seinerseits Aktionen außerhalb dieser Liste auslösen. Vergib besonders enge Berechtigungen für `switch`, `script` und jede Domain, die empfindliche Geräte steuert.

Im **Chat** reicht es nicht, **Steuern erlauben** in den Einstellungen einzuschalten: Hake für die jeweilige Anfrage unter dem Eingabefeld **Aktionen erlauben** an. Standardmäßig zeigt jeder vorgeschlagene Schreibzugriff eine Karte **Freigabe erforderlich** mit Werkzeugname und JSON-Argumenten. **Ausführen** gibt *diesen einen Aufruf einmal* frei; **Ablehnen** weist ihn zurück. Unbeantwortete Karten verfallen nach 120 Sekunden; **Stopp** lehnt offene Freigaben ab. Mehrere Schreibaufrufe erfordern mehrere Entscheidungen.

Unter **Einstellungen** hat jede Stufe einen eigenen Schalter **ohne Freigabe ausführen** (`HA_AUTO_WRITE`, `HA_AUTO_ADMIN_WRITE`, `HA_AUTO_DELETE` in der `.env`). Das ist **automatisches Ausführen**, keine weitergehende Berechtigung: Der passende Erlauben-Schalter, das Häkchen **Aktionen erlauben** im Chat, die Obergrenze der Oberfläche und die Prüfungen von Server und HA gelten weiterhin, nur die Freigabe-Karte für diese Stufe entfällt. Ausgeführte Aufrufe bleiben im Chat und im Metadaten-Protokoll sichtbar. Ausnahmen: `ha_restore_backup` und `ha_remove_device` zeigen immer ihre Karte, auch wenn Löschen ohne Freigabe laufen darf. Lass die Auto-Schalter aus, solange du nicht bewusst in Kauf nimmst, dass das Modell Aktionen auslöst, ohne dass du jede einzelne prüfst. Für die automatische Freigabe stuft die Oberfläche `ha_rest_write` als Administrator-Werkzeug ein, selbst wenn die konkrete REST-Route nur Steuer-Stufe hat; der Server prüft jede Route trotzdem anhand ihrer Berechtigung im Katalog. Das `YES` der Kommandozeile und die Freigabe-Mechanismen anderer MCP-Clients sind **unabhängig** von den Auto-Schaltern der Oberfläche; diese Auto-Schalter sind keine Berechtigungsschalter des Servers. Sieh dir die [Werkzeug-Referenz (englisch)](TOOLS.md) an und nutze `ha_rest_catalog` für die Berechtigungen einzelner Routen.

### Zwei Ebenen von Berechtigungen: Server-Stufe und Client-Einstellungen

Ein entfernter Client wird doppelt begrenzt:

1. **Auf dem Server (verbindlich):** die Stufe des Clients unter **MCP-Clients** (oder die auf der Zustimmungsseite gewählte), begrenzt durch die
   Schalter der Instanz. Werkzeuge oberhalb der Stufe werden dem Client gar nicht erst angezeigt. Anzahl der Werkzeuge, die ein Client sieht
   (Version 0.30.0; die Zahlen wachsen mit neuen Versionen, deshalb muss ein Client nach einem Update „Werkzeuge neu laden“):

   | Stufe | Angezeigte Werkzeuge | als nur lesend markiert | als schreibend/löschend markiert |
   |---|---|---|---|
   | Nur lesen | 75 | 75 | 0 |
   | Steuern | 82 | 75 | 7 |
   | Konfiguration ändern | 133 | 75 | 58 |
   | Löschen | 159 | 75 | 84 |

2. **Im Client (zusätzlich):** Viele Clients lassen dich Werkzeuge erlauben, bestätigen lassen oder sperren. Sie gruppieren sie anhand der Hinweise,
   die dieser Server mitschickt (`readOnlyHint`, `destructiveHint`). Beispiel Claude → Settings → Connectors → der Connector →
   *Tool permissions*: Ein Client mit der Stufe **Konfiguration ändern** zeigt „read-only tools (73)“ und „write/delete
   tools (56)“; stellst du die erste Gruppe auf *Always allow* (immer erlauben) und die zweite auf *Blocked* (gesperrt), liest Claude nur noch.

Die Client-Einstellung schützt nur diesen einen Client. Jeder andere, der dasselbe Token besitzt, wird allein durch die Server-Stufe
begrenzt. Stell die Server-Stufe also auf das, was der Client wirklich braucht, und nutze die Client-Einstellungen als zusätzliche Schicht (oder
um eine Bestätigung zu verlangen, z. B. *Ask* (nachfragen) statt *Blocked*).

### Domains: was die Liste erlaubter Domains bedeutet und wie du sie wählst

Eine **Domain** ist der Teil einer Entitäts-ID vor dem Punkt: `light` in `light.living_room`, `lock` in
`lock.front_door`. Die Liste erlaubter Domains (`HA_ALLOWED_DOMAINS`, **Einstellungen → Erlaubte Domains für
Steuerbefehle**) legt fest, welche Entitäten die Steuer-Werkzeuge ansprechen dürfen: `ha_call_service`, `ha_activate_scene`
(braucht `scene`) und `ha_run_script` (braucht `script`). Sie beschränkt **keine** Konfigurationsänderungen: Eine Automation,
die mit „Konfiguration ändern“ gespeichert wurde, darf beim Ausführen trotzdem jede Entität ansprechen.

- Jede Home-Assistant-Domain kann eingetragen werden (kleingeschrieben, z. B. `light`). Welche es gibt, hängt von den
  Integrationen *deines* HA ab. Voreingestellt ist `light, switch, fan, climate, cover, media_player`.
- **So findest du sie:** Unter **Einstellungen**, **MCP-Clients** und auf der OAuth-Zustimmungsseite listet die Oberfläche die Domains, die dein
  HA tatsächlich hat, mit der Anzahl der Entitäten als anklickbare Chips (das Textfeld bleibt bearbeitbar und ist der Wert,
  der gespeichert wird). In einem Chat oder MCP-Client listet `ha_list_services` die Domains, die Aktionen anbieten.
- Clients (Token oder OAuth) können die Liste der Instanz nur **weiter einschränken**: Ihre Auswahl zeigt nur die erlaubten Domains, und
  eine leere Auswahl bedeutet „alle erlaubten Domains“.
- Domains ohne Aktionen (`sensor`, `binary_sensor`, `event`, `sun`, ...) sind ohnehin nur lesbar; zum Lesen braucht es nie
  eine erlaubte Domain.

Domains, die in der Oberfläche mit ⚠ markiert sind, haben körperliche oder sicherheitsrelevante Folgen; erlaube sie nur mit Absicht und möglichst nicht
zusammen mit „ohne Freigabe“ oder für fremde Clients:

| Domain | Was ihre Aktionen tun |
|---|---|
| `lock` | öffnet Türen |
| `alarm_control_panel` | schaltet die Alarmanlage scharf oder unscharf |
| `cover` | öffnet und schließt Rollläden, Tore und Garagentore |
| `valve` | öffnet und schließt Wasser- oder Gasventile |
| `siren` | löst Sirenen aus |
| `update` | installiert Firmware- und Software-Updates |
| `button` | drückt Geräte-Tasten, z. B. Neustart oder Werksreset |
| `camera` | schaltet Kameras und Aufnahmen |
| `notify` | verschickt Nachrichten |
| `script`, `automation` | starten Skripte / schalten oder lösen Automationen aus, die jede beliebige Aktion enthalten können |

Bedenke auch, was sich hinter `switch` verbirgt: Neben Lampen und Steckdosen stellen Integrationen auch Geräte-Einstellungen als Schalter bereit
(z. B. Privatsphäre-Modi oder Aufnahme bei Kameras); prüfe also die Liste der Entitäten, bevor du die Domain breit erlaubst.

## 3. Typische Abläufe (lesen → entscheiden → freigeben → prüfen)

Die JSON-Blöcke unten sind **Argumente für MCP-Werkzeuge**, keine HTTP-Befehle. Namen wie `light.example_lamp`, `office`, `test-views`, `example_scene` und `sample_automation` sind erfundene Platzhalter. **Ersetze sie durch IDs, die du auf deiner Installation tatsächlich ermittelt hast.** Bei bestehender Konfiguration speichere eine Kopie des Leseergebnisses und erwäge ein HA-Backup, bevor du eine Änderung freigibst. Lies nach jedem Schreibzugriff das Ziel erneut aus; eine erfolgreiche MCP-Antwort beweist nicht, dass ein Gerät wirklich reagiert hat oder dass ein asynchrones Neuladen in HA abgeschlossen ist.

### Entität finden, Raum ansehen, Lichter steuern

- `ha_search_entities` `{"domain":"light","limit":20}` findet aktuelle IDs und Zustände; `ha_get_state` `{"entity_id":"light.example_lamp"}` gilt **nur, wenn genau diese ID zurückgegeben wurde**. `ha_list_services` `{"domain":"light"}` zeigt die in HA verfügbaren Aktionen.
- `ha_list_areas` `{}` listet die tatsächlichen Raumnamen und IDs. `ha_list_area_entities` `{"area":"office","domain":"light"}` akzeptiert eine echte Bereichs-ID, einen Namen oder einen Alias. Lies die Felder `available`, `unavailable` und `groups` aus. Ist der Raumname mehrdeutig, kläre das, bevor du weitermachst.
- Nachdem du Steuern freigeschaltet und die Ziele geprüft hast, schaltet `ha_call_service` `{"domain":"light","service":"turn_on","entity_id":"light.example_lamp","service_data":{}}` das gewählte Licht. Für mehrere verfügbare Lichter verwende `"entity_id":["light.example_lamp","light.example_second_lamp"]`, nachdem du **beide** zurückgegebenen IDs und die Grenze von 20 Zielen geprüft hast. Sprich nicht zusätzlich eine Gruppe an, deren einzelne Lichter du bereits direkt aufrufst. Lies die Zustände danach erneut aus.
- Um einen Raum zu ordnen, liefert `ha_create_area` `{"name":"Example Office"}` eine neue `area_id`; `ha_list_devices` `{"area_id":"none"}` zeigt Geräte ohne Bereich. Verwende die echte `device_id` und die echte `area_id` in `ha_update_device` `{"device_id":"<device_id from ha_list_devices>","changes":{"area_id":"<area_id from ha_create_area>"}}`. Das sind Administrator-Änderungen. `ha_create_floor` / `ha_update_area` können einen Bereich einer Etage zuordnen. `ha_update_entity_registry` kann nur `name`, `area_id` oder `icon` einer bestehenden Entität ändern; es legt **keine** Entität an.

### Eine Automation bearbeiten

Verwende `ha_get_automation` `{"config_id":"<existing configuration ID>"}`, bevor du eine bestehende Automation bearbeitest; ihre `config_id` ist **nicht** die Entitäts-ID `automation.*`. Für eine neue wählst du eine noch unbenutzte Konfigurations-ID und baust eine vollständige Konfiguration mit einem `alias`; `id` darf nicht innerhalb von `config` stehen. Prüfe zuerst:

```json
{"config":{"alias":"Example test automation","triggers":[{"trigger":"state","entity_id":"input_boolean.example_flag","to":"on"}],"conditions":[],"actions":[]}}
```

Übergib das erst an `ha_validate_automation`, nachdem du bestätigt hast, dass die Auslöser-Entität existiert, und sieh dir das Prüfergebnis von HA an. Zum Übernehmen gibst du dieselbe Konfiguration und `{"config_id":"sample_automation"}` an `ha_save_automation` (Administrator-Schreibzugriff) und liest danach mit `ha_get_automation` das gespeicherte Ergebnis aus. Die leeren Aktionen im Beispiel sind Absicht; bei einer Automation mit echten Aktionen musst du prüfen, was diese Aktionen steuern können. Das Speichern löst ein asynchrones Neuladen in HA aus; prüfe in HA selbst, bevor du dich auf die Automation verlässt. `ha_delete_automation` erfordert die Lösch-Berechtigung und die Konfigurations-ID.

### Ein Dashboard oder einen Helfer anlegen

- `ha_list_dashboards` `{}` → `ha_get_dashboard` `{"url_path":"<existing URL path>"}`, um Ansichten bestehender Storage-Dashboards zu übernehmen. Ein neues Storage-Dashboard legst du mit `ha_create_dashboard` `{"title":"Example test views","url_path":"test-views"}` an; danach speicherst du mit `ha_save_dashboard` `{"url_path":"test-views","config":{"views":[{"title":"Test","path":"test","cards":[]}]}}`. `url_path` muss einen Bindestrich enthalten; `ha_update_dashboard` und `ha_delete_dashboard` brauchen dagegen die **Sammlungs-`id`** aus `ha_list_dashboards`. Das Speichern ersetzt die Ansichten; das Werkzeug gibt `previous` für ein **manuelles** Zurücksetzen zurück, keine automatische Wiederherstellung. Verwende für einen ersten Test nicht das Standard-Dashboard.
- `ha_list_helpers` `{"domain":"input_boolean"}` → `ha_create_helper` `{"domain":"input_boolean","config":{"name":"Example test flag"}}` → erneut auflisten. Unterstützte Storage-Domains: `input_boolean`, `input_number`, `input_select`, `input_text`, `input_datetime`. `ha_update_helper` verwendet die zurückgegebene **Sammlungs-`id`** als `helper_id`, keine vermutete Entitäts-ID, und braucht eine vollständige Konfiguration einschließlich `name`; behalte andere wichtige bestehende Felder bei. `input_number` braucht `min`/`max`, `input_select` nicht leere `options`, `input_datetime` `has_date` oder `has_time`. Schick kein `id`, `entity_id` oder `type` innerhalb der `config` eines Helfers.

### Eine Szene oder ein Skript speichern und ausführen

Sieh dir `ha_list_scenes` / `ha_get_scene` und `ha_list_scripts` / `ha_get_script` an, bevor du ein in der Oberfläche bearbeitbares Element ersetzt. Beispiel **nur, nachdem du `light.example_lamp` gefunden hast**:

```json
{"scene_id":"example_scene","config":{"name":"Example scene","entities":{"light.example_lamp":{"state":"on","brightness":100}}}}
```

Übergib das mit Administrator-Schreibrecht an `ha_save_scene`; es prüft die Ziel-Entitäten, speichert die Szene der Oberfläche und gibt `previous` für ein manuelles Zurücksetzen zurück. Ein separates `ha_activate_scene` braucht die echte Entitäts-ID `scene.*`, die Steuer-Berechtigung und `scene` in den erlaubten Domains. Genauso kann `ha_save_script` `{"script_id":"example_script","config":{"alias":"Example script","sequence":[{"action":"light.turn_off","target":{"entity_id":"light.example_lamp"}}],"mode":"single"}}` entgegennehmen; prüfe zuerst die Aktion und vergewissere dich, dass Entität und Dienst existieren. `ha_run_script` braucht die echte ID `script.*` und `script` in der Liste erlaubter Steuer-Domains. Speichern und Ausführen von Skripten/Szenen sind **unterschiedliche** Berechtigungen; das Ausführen kann Geräte schalten. Diese Werkzeuge bearbeiten Konfigurationen, die hinter der Oberfläche liegen, keine beliebigen YAML-Pakete. Lösch-Werkzeuge erfordern die Lösch-Berechtigung.

### Integration mit Zugangsdaten-Verweisen hinzufügen oder ändern

1. `ha_list_integration_types` `{"query":"<integration domain>"}` prüft, welche Einrichtungs-Handler über die Oberfläche verfügbar sind; `ha_list_discovered` `{}` zeigt, was **HA selbst** gefunden hat, keine Netzwerksuche durch diesen MCP. `ha_list_integrations` `{}` zeigt vorhandene `entry_id`s und Unterstützungs-Merkmale.
2. Wenn ein Formular ein Passwort, Token oder eine PIN verlangt, speichere es im Reiter **Zugangsdaten** der Oberfläche unter einem lokalen Alias wie `example_device_login`; `ha_list_credentials` zeigt Alias und Feldnamen, **keine Werte**. Schreib niemals ein Geheimnis in einen Chat, in Freigabe-Daten, in Werkzeug-Argumente, in ein Issue oder in einen Beispielbefehl. Geheime Formularfelder akzeptieren statt Klartext einen Verweis wie `{"$credential":"example_device_login","field":"password"}`. Der lokale Server löst ihn unmittelbar vor dem Senden an HA auf. In einem beispielhaften Formularschritt ist `{"flow_id":"<flow_id from previous result>","data":{"password":{"$credential":"example_device_login","field":"password"}}}` **nur dann** gültig, wenn das zurückgegebene Schema tatsächlich ein Feld `password` hat; andere Formulare sehen anders aus.
3. `ha_start_integration_setup` verwendet einen Handler aus der Typen-Liste und gibt ein Formular und eine `flow_id` zurück; übermittle mit `ha_integration_setup_step` nur Felder aus dessen `data_schema`. Brich einen unfertigen Ablauf mit `ha_abort_integration_setup` ab. All das sind Administrator-Schreibzugriffe, auch der Abbruch. Für einen bestehenden Eintrag verwenden `ha_start_integration_options` / `ha_integration_options_step` eine `entry_id` mit `supports_options`; unveränderte Felder mit angezeigten `current`-Werten lässt du weg. Bei `supports_reconfigure` verwendest du `ha_start_integration_reconfigure`, gefolgt von Einrichtungsschritten. `ha_update_integration` kann umbenennen oder die Einstellungen für Abfrage und neue Entitäten ändern; `ha_set_integration_disabled` schaltet die Verfügbarkeit um, und `ha_reload_integration` lädt neu. Prüfe das Ergebnis mit `ha_list_integrations`. `ha_delete_integration` ist ein folgenreiches Löschen: Es kann die zugehörigen Geräte und Entitäten entfernen.

### Eine Konfigurationsänderung rückgängig machen

Jede Konfigurationsänderung über diesen MCP bewahrt den vorherigen Zustand lokal auf: Automationen, Skripte, Szenen,
Dashboards (Metadaten und Ansichten), Helfer, Bereiche, Etagen, Felder im Geräte- und Entitätsregister sowie
Titel, Systemoptionen und Deaktiviert-Status von Integrationen. Jedes Ergebnis eines solchen Werkzeugs enthält eine `change_id`.

- `ha_list_changes` `{}` listet die letzten Änderungen (neueste zuerst, 30 Tage aufbewahrt); `ha_get_change` zeigt den gespeicherten vorherigen
  Zustand (`before`; `null` heißt, das Element gab es vorher nicht).
- `ha_undo_change` `{"change_id":"<id>"}` schreibt den vorherigen Zustand zurück: Es entfernt ein angelegtes Element, legt ein
  gelöschtes wieder an (Bereiche, Etagen und Helfer bekommen eine neue ID) und setzt geänderte Felder zurück. Das Rückgängigmachen wird selbst protokolliert;
  machst du es rückgängig, wird die Änderung erneut angewendet.
- Wurde dasselbe Element später noch einmal geändert, verweigert das Rückgängigmachen und nennt die neueren Änderungen. Mach die neueste zuerst rückgängig, oder übergib
  `"force":true` nur, wenn du die späteren Änderungen wirklich verwerfen willst.
- In der Oberfläche listet der Reiter **Änderungen** dasselbe Protokoll mit einer Schaltfläche **Rückgängig** pro Eintrag. Im Chat sag
  z. B. „Mach die letzte Änderung rückgängig“.
- Rückgängigmachen braucht **Konfiguration ändern**; wenn dabei etwas entfernt wird, braucht es zusätzlich **Löschen erlauben**. Im Chat der Oberfläche
  wird ein Rückgängigmachen bei „ohne Freigabe“ wie ein Löschen behandelt: Es zeigt immer eine Freigabe-Karte, es sei denn, Löschen darf
  ohne Freigabe laufen.
- Nicht protokolliert werden: Gerätesteuerung (Dienstaufrufe), Hinzufügen oder Entfernen von Integrationen, Options- und Neukonfigurations-Dialoge,
  Backups und allgemeine REST-Schreibzugriffe. Ein Dashboard ohne früher gespeicherte Konfiguration (das automatisch erzeugte Standard-Dashboard von HA) kann
  auf diese Weise nicht zurückgesetzt werden.

### Konfigurationsdateien (YAML, Pakete, Custom Components)

Für alles, was die Oberfläche nicht ausdrücken kann: `configuration.yaml`, Pakete, Template-Sensoren, Custom Components.

- **Zugriff**: Unter HA OS / Supervised muss das offizielle Add-on **File editor** installiert und gestartet sein (sonst ist nichts
  einzurichten; der MCP spricht über den Supervisor-Ingress mit ihm). Bei einer Container-Installation setzt du `HA_CONFIG_DIR` in der
  Umgebung des MCP-Prozesses (z. B. in der systemd-Unit) auf das Konfigurationsverzeichnis; das ist absichtlich keine Einstellung in der
  Weboberfläche.
- `ha_list_config_files` (Ordnerinhalt) und `ha_read_config_file` sind Lese-Werkzeuge. `ha_edit_config_file`
  (ein eindeutiges Textstück ersetzen) und `ha_write_config_file` (eine Datei anlegen oder ersetzen) brauchen die Administrator-Stufe,
  `ha_delete_config_file` die Lösch-Stufe.
- **Nie zugänglich**, nicht einmal zum Lesen: `secrets.yaml`, versteckte Ordner (`.storage`, ...), Datenbanken, Logs,
  Schlüssel- und Zugangsdaten-Dateien, `deps/`, `tts/`, `backups/`. Pfade sind relativ zum Konfigurationsordner; kein `..`.
- **Zugangsdaten in Dateien** (`password: ...`, `token`, `api_key`, Passwörter in URLs) werden als `__REDACTED_n__` angezeigt
  und unverändert zurückgeschrieben; ein Modell sieht sie nie. Neue Zugangsdaten kommen (durch dich) in die `secrets.yaml` und werden
  mit `!secret name` referenziert.
- **Sicherheitsnetz**: YAML/JSON wird vor dem Schreiben geparst; bei YAML-Dateien läuft die Konfigurationsprüfung von Home Assistant
  vor und nach dem Schreiben. Bringt der Schreibvorgang einen Fehler oder eine Warnung hinzu (z. B. „Setup of package ... failed“), wird die
  vorherige Datei wiederhergestellt (eine neue Datei wird entfernt), und das Werkzeug nennt den Grund. Jeder Schreibvorgang wird protokolliert und kann
  mit `ha_undo_change` rückgängig gemacht werden.
- **Noch nicht aktiv**: Eine geschriebene Datei wirkt erst nach `ha_reload` (z. B. `automation`, `input_boolean`, `core`
  für Pakete, `all`) oder, bei Integrationen, die zum ersten Mal in YAML eingerichtet werden, nach `ha_restart`.

### Add-ons, System, HACS, Zigbee und Thread (nur lesen, außer dem HACS-Store)

- `ha_list_addons` (Zustand, Version, ausstehendes Update) und `ha_get_system_info` (Versionen von Core, Supervisor und OS,
  Supervisor-Zustand, Board, Speicherbelegung) brauchen eine Supervisor-Installation (HA OS / Supervised); ohne sie sagen sie das.
  Der Supervisor-Proxy ist auf diese Lese-Endpunkte beschränkt.
- `ha_list_hacs_repositories`: was über HACS installiert ist, mit installierter und verfügbarer Version.
- HACS-Store (schreibend): `ha_search_hacs` und `ha_get_hacs_repository` lesen; `ha_install_hacs_repository`
  (Admin, im Chat immer mit Freigabe-Karte, im Journal) installiert oder aktualisiert;
  `ha_add_hacs_custom_repository` (Admin, nur GitHub) fügt ein Repository außerhalb des Stores hinzu;
  `ha_remove_hacs_repository` (Löschen) entfernt eins. Karten trägt HACS selbst als Dashboard-Ressource ein;
  Integrationen brauchen `ha_restart`.
- `ha_list_zigbee_devices`: ZHA-Geräte mit Verfügbarkeit, Verbindungsqualität (`lqi`, schwach unter 80), `rssi`, zuletzt gesehen
  und Rolle; `problems_only: true` listet nur nicht verfügbare oder schwache Geräte.
- `ha_list_thread_networks`: Thread-Netzwerke (Name, Kanal, bevorzugt, Quelle).
- Es werden keine Geräteadressen, IP-Adressen, Hostnamen, PAN-IDs oder Netzwerkschlüssel zurückgegeben.

### Schaltergebnisse und Wetter

- **`ha_call_service` liest die Ziele zurück**, und zwar etwa 3 Sekunden lang nach dem Aufruf, und gibt `states_after` mit
  `confirmed` pro Entität zurück: true, wenn der erwartete Zustand erreicht wurde (an/aus, offen bzw. öffnet/geschlossen/schließt,
  verriegelt/entriegelt, der gewünschte HVAC-Modus, ...), false, wenn nicht (langsames, sich bewegendes oder offline befindliches Gerät: Die Antwort sollte
  das sagen, statt Erfolg zu behaupten), `null` für Aktionen ohne ein einzelnes erwartetes Ergebnis (Umschalten, Werte setzen).
  `all_confirmed` fasst sie zusammen. Mit `return_response: true` kommen die Daten von Diensten, die antworten (zum Beispiel
  `todo.get_items`), als `service_response` zurück.
- **`ha_fire_event`** (Administrator-Schreibzugriff) löst ein eigenes Ereignis wie `doorbell_pressed` mit optionalen `event_data` aus;
  Automationen mit einem Ereignis-Auslöser reagieren darauf. Ereignisse, die Home Assistant selbst erzeugt (`state_changed`,
  `homeassistant_start`, `call_service`, ...), werden abgelehnt, damit niemand Systemverhalten vortäuschen kann.
- **`ha_get_weather_forecast`**: aktuelles Wetter und die Vorhersage (`daily`, `hourly` oder `twice_daily`) einer Wetter-Entität,
  gelesen aus der Antwort des HA-Dienstes `weather.get_forecasts` (Vorhersagen sind keine Zustandsattribute mehr). Die Zeiten
  sind in der Zeitzone von HA, und jeder Eintrag trägt seinen `day` (`today`, `tomorrow`, Wochentag + Datum); `day:
  "tomorrow"` (oder `today`, `YYYY-MM-DD`) liefert nur diesen Tag, was kleine Modelle weit zuverlässiger hinbekommen, als
  aus einer Liste auszuwählen. Nur lesend.

### Blueprints, Themes und Dashboard-Ressourcen

- **Blueprints:** `ha_list_blueprints` (Automation, Skript oder Template) zeigt Pfad, Name und Eingaben.
  `ha_preview_blueprint` lässt Home Assistant einen Blueprint von einer https-Adresse holen (GitHub, Gist, Community-Forum) und zeigt
  Name, Eingaben, Prüffehler und das YAML, ohne zu speichern. `ha_save_blueprint` speichert ihn (nur neue Pfade, kein
  Überschreiben); verwende ihn in einer Automation mit `{"use_blueprint": {"path": "...", "input": {...}}}` über
  `ha_save_automation`. `ha_delete_blueprint` (Lösch-Stufe) wird von HA abgelehnt, solange etwas den Blueprint verwendet;
  das Rückgängigmachen importiert ihn erneut von seiner `source_url`.
- **Themes:** `ha_list_themes`, `ha_set_theme` (`mode` light oder dark; `default` setzt zurück, `none` entfernt das dunkle
  Theme). Themes selbst sind YAML-Dateien und können hier nicht angelegt werden.
- **Dashboard-Ressourcen** (eigene Karten): `ha_list_dashboard_resources`, `ha_add_dashboard_resource`,
  `ha_delete_dashboard_resource` (Lösch-Stufe). Ressourcen laufen als JavaScript im Browser jedes Benutzers, deshalb werden nur Dateien
  angenommen, die von diesem Home Assistant ausgeliefert werden (`/local/...`, `/hacsfiles/...`); externe Adressen werden abgelehnt.
- Alle Schreibzugriffe hier werden protokolliert und können rückgängig gemacht werden.

### Updates, Neuladen und Neustart

- **Lesen:** `ha_list_updates` (ausstehende Updates von Firmware, Integrationen, Add-ons und HA mit installierter und neuester
  Version; `pending_only:false` für alle), `ha_get_release_notes`, `ha_check_config` (prüft die Konfigurations-
  dateien, ändert nichts).
- **Administrator-Schreibzugriff:** `ha_reload` lädt die Konfiguration ohne Neustart neu: `all`, `core` oder eine Domain mit einem Neulade-
  Dienst (`automation`, `script`, `scene`, `template`, `group`, ...). `ha_skip_update` überspringt eine angebotene Version
  (`clear:true` bietet sie wieder an).
- **Lösch-Stufe (die höchste):** `ha_install_update` und `ha_restart`. Das sind die weitreichendsten Aktionen, deshalb
  brauchen sie dieselbe Stufe wie das Löschen; in der Oberfläche laufen sie nie ohne Freigabe-Karte, es sei denn, Löschen darf
  ohne Freigabe laufen. `ha_restart` führt zuerst die Konfigurationsprüfung aus und verweigert, solange sie Fehler meldet.

### Kalender und To-do-Listen

- **Lesen:** `ha_list_calendars`, `ha_get_calendar_events` (ein Kalender oder alle, ab jetzt oder ab `start`, 1–31 `days`,
  mit `uid`), `ha_list_todo_lists` (offene Einträge pro Liste), `ha_get_todo_items` (offen, erledigt oder alle).
- **Hinzufügen und ändern** wie beim Schalten eines Lichts (Steuer-Stufe, Schreiben an, Domain `calendar` oder `todo` in den erlaubten
  Domains): `ha_create_calendar_event` (`start`/`end` als `YYYY-MM-DDTHH:MM` in Ortszeit, oder Datumsangaben für ganztägige Termine,
  wobei `end` der Tag nach dem letzten Tag ist), `ha_update_calendar_event` (Titel, Start und Ende mitgeben, auch wenn
  unverändert; `recurrence_id` für ein einzelnes Vorkommen einer Serie), `ha_add_todo_item`, `ha_update_todo_item`
  (`status: completed` hakt einen Eintrag ab).
- **Löschen** braucht die Lösch-Stufe: `ha_delete_calendar_event`, `ha_remove_todo_items`. Termine und Einträge sind Daten,
  keine Konfiguration; deshalb stehen sie nicht im Änderungsprotokoll und können dort nicht rückgängig gemacht werden.
- Schreibzugriffe auf einen Kalender oder eine Liste, die es nicht gibt, werden abgelehnt (HA selbst würde sie stillschweigend ignorieren).

### Helfer: Zähler, Timer, Zeitpläne, Templates, Gruppen, Verbrauchszähler

`ha_list_helper_types` zeigt, welche Helfer-Typen dieses Home Assistant anbietet und wie man sie anlegt:

- **Storage-Helfer** mit `ha_create_helper`: `input_boolean`, `input_number`, `input_select`, `input_text`,
  `input_datetime`, `input_button`, `counter` (`initial`, `step`, `minimum`, `maximum`), `timer` (`duration`
  `"HH:MM:SS"`) und `schedule` (`monday` ... `sunday`: Listen von `{"from": "07:00:00", "to": "16:00:00"}`).
- **Config-Flow-Helfer** wie `template`, `group`, `utility_meter`, `derivative`, `threshold`, `tod`,
  `min_max`, `statistics`, `trend`, `switch_as_x`, `generic_thermostat`: Beginne mit `ha_start_integration_setup`
  (Handler = der Typ). Manche Typen antworten mit einem Menü (z. B. template: sensor, binary_sensor, switch, ...); wähle einen Punkt
  mit `ha_integration_setup_step` `{"next_step_id": "sensor"}` und fülle dann die Formularfelder aus `data_schema` aus. Ändern kannst du
  sie später mit `ha_start_integration_options` (die entry_id steht im Ergebnis und in `ha_list_helper_types`).
- Ein Helfer (oder eine Integration), der durch einen Einrichtungsablauf angelegt wurde, wird protokolliert: Rückgängigmachen entfernt den Eintrag wieder. Das lässt sich nicht
  wiederholen; leg ihn stattdessen neu an.

### Ordnen: Labels, Kategorien, Zonen, Entitätsnamen

Diese Werkzeuge ändern die Konfiguration von Home Assistant (Administrator-Schreibzugriff; Löschen braucht zusätzlich die Lösch-Stufe). Jede Änderung wird protokolliert
und kann im Reiter „Änderungen“ oder mit `ha_undo_change` rückgängig gemacht werden.

- **Labels** markieren Entitäten, Geräte und Bereiche raumübergreifend (z. B. „Batterie“, „Urlaub“). `ha_list_labels` zeigt sie
  mit der Anzahl ihrer Verwendungen, `ha_get_label` die Mitglieder. Lege sie mit `ha_create_label` an (`color` ist eine HA-Theme-Farbe wie
  `amber`, `teal`, `blue-grey` oder `#rrggbb`) und weise sie dann mit `labels` in `ha_update_entity_registry`,
  `ha_update_device` oder `ha_update_area` zu (immer die vollständige neue Liste). Das Löschen eines Labels entfernt es überall;
  das Rückgängigmachen setzt das Label wieder an dieselben Entitäten, Geräte und Bereiche.
- **Kategorien** sortieren die Listen in der HA-Oberfläche. Jede gehört zu einem `scope`: `automation`, `script`, `scene` oder
  `helpers`. Ein Element ordnest du mit `ha_update_entity_registry` `{"categories": {"automation": "<category_id>"}}` ein
  (`null` entfernt die Zuordnung). Wird ein Löschen rückgängig gemacht, entsteht die Kategorie neu (mit neuer ID), und die Elemente werden wieder eingeordnet.
- **Zonen:** `ha_list_zones` listet alle Zonen mit den Personen darin. In der Oberfläche angelegte Zonen können angelegt,
  geändert und gelöscht werden (`radius` in Metern; `passive` Zonen dienen nur Automationen). `zone.home` (Einstellungen > System >
  Allgemein) und YAML-Zonen werden als nicht bearbeitbar angezeigt.
- **Entitätsnamen und IDs:** `ha_get_entity_registry` zeigt den Registereintrag einer Entität einschließlich `aliases` (zusätzliche
  Namen für Sprachassistenten; ein Eintrag `null` steht für den eigenen Namen der Entität). `ha_update_entity_registry` ändert
  Name, Symbol, Bereich, Aliase, Labels und Kategorien und kann eine Entität ausblenden oder deaktivieren. `ha_rename_entity` ändert die
  Entitäts-ID innerhalb ihrer Domain; HA behält den Verlauf, aber Automationen, Skripte und Dashboards, die die alte ID verwenden,
  werden nicht angepasst. Das Ergebnis listet sie unter `references_to_old_id` (aus `ha_find_usages`).

### Fehlersuche: Warum ist etwas (nicht) passiert?

All diese Werkzeuge sind nur lesend (manche brauchen einen HA-Administrator, wie die Seiten der HA-Oberfläche, die sie abbilden):

- **Abläufe von Automationen oder Skripten:** `ha_list_traces` `{"domain":"automation","item":"automation.example"}` listet die
  letzten Durchläufe mit Zustand, Fehler und letztem Schritt; `ha_get_trace` mit einer `run_id` zeigt jeden Schritt (Auslöser,
  Bedingungen, Aktionen) mit seinem Ergebnis oder Fehler. `include_config:true` fügt die Konfiguration dieses Durchlaufs hinzu.
- **Was ist passiert und warum:** `ha_get_logbook` `{"entity_id":"light.example","hours":6}` (wer oder was es geändert hat,
  z. B. welche Automation oder welcher Dienst); `ha_get_history` `{"entity_ids":["sensor.example"],"hours":24}` für die
  Zustandsänderungen; `ha_get_statistics` (IDs aus `ha_list_statistic_ids`) für lange Zeiträume numerischer Sensoren, zusammengefasst
  pro `5minute`, `hour`, `day`, `week` oder `month`.
- **Fehler und Zustand:** `ha_get_error_log` (filtern nach `level` oder Text, z. B. dem Namen einer Integration),
  `ha_list_repairs`, `ha_get_system_health`.
- **Vor dem Speichern ausprobieren:** `ha_render_template` rendert ein Jinja-Template gegen den aktuellen Zustand;
  `ha_test_condition` wertet eine Automations-Bedingung genau jetzt aus.
- **Wo wird es verwendet?** `ha_find_usages` `{"needle":"light.example"}` durchsucht Automationen, Skripte, Szenen,
  Gruppen und Dashboards aus der Oberfläche (auch YAML-Dashboards) und gibt den Pfad innerhalb jeder Konfiguration zurück, z. B.
  `actions[0].target.entity_id[0]`. Verwende es, bevor du eine Entität umbenennst oder entfernst. YAML-Automationen ohne `id`
  können über die API nicht gelesen werden und werden als übersprungen aufgeführt.
- **Überblick:** `ha_get_overview` liefert Version, Zeitzone, Anzahl der Entitäten pro Domain (nicht verfügbar, an),
  Größe der Register, Automationen/Skripte/Szenen/Dashboards sowie fehlerhafte oder deaktivierte Integrationen.

Zeiten in diesen Ergebnissen werden in die in Home Assistant eingestellte Zeitzone umgerechnet. Lange Ergebnisse werden auf die
neuesten Einträge gekürzt (`limit`, `max_points`).

### Vor Konfigurationsänderungen sichern

Verwende `ha_list_backups` `{}` (HA kann schon für das Auflisten einen Administrator verlangen). Mit Administrator-Schreibrecht bittet `ha_create_backup` `{"name":"Before example change"}` HA um ein vollständiges Backup von Konfiguration und Datenbank auf seinem lokalen Backup-Agenten und wartet, bis es erscheint. Wenn eine Verschlüsselung nötig ist, füge `"password":{"$credential":"example_backup_password","field":"password"}` hinzu, nachdem du dieses Feld unter **Zugangsdaten** gespeichert hast. Prüfe das Anlegen mit `ha_list_backups`; meldet es, dass das Backup noch läuft, sieh später noch einmal nach, statt die Antwort als Abschluss zu werten. Der Reiter **Energie** der Oberfläche zeigt den Verbrauch pro Gerät und Quelle und kann Geräte ins Energie-Dashboard aufnehmen oder herausnehmen (im Änderungsjournal). Der Reiter **Backups** der Oberfläche kann Backups auflisten, anlegen, herunterladen und – mit Lösch-Berechtigung – wiederherstellen und löschen; ein Download wird direkt von HA übertragen und vom MCP nicht aufbewahrt. `ha_delete_backup` verwendet eine aufgelistete `backup_id` und ist kein Mechanismus zum Zurücksetzen.

### Ein Backup wiederherstellen

Beim Wiederherstellen wird die Konfiguration von Home Assistant (und, wenn du nicht `"restore_database": false` angibst, auch die Verlaufsdatenbank) auf den Stand des Backups gesetzt, danach startet HA neu. Dafür brauchst du die Stufe **Löschen**.

1. `ha_list_backups` `{}`, dann `ha_get_backup` `{"backup_id":"<id>"}`: Prüfe Name, Datum, HA-Version und die Zeilen in `restore_impact`. Benutzer und langlebige Tokens, die nach dem Backup angelegt wurden, funktionieren danach nicht mehr – unter Umständen auch der Token dieses MCP; dann trägst du danach in den Einstellungen der Oberfläche einen neuen ein.
2. `ha_restore_backup` `{"backup_id":"<id>"}` (verschlüsselte Backups: zusätzlich `"password":{"$credential":"<alias>","field":"password"}`). Im Chat der Oberfläche erscheint dafür immer eine Freigabekarte mit den Details des Backups, auch wenn Löschen auf „ohne Freigabe ausführen“ steht. Andere MCP-Clients müssen selbst bei dir nachfragen.
3. Der MCP legt zuerst ein **Sicherheits-Backup** des aktuellen Stands an (klappt das nicht, wird nichts wiederhergestellt), bittet dann HA um das Wiederherstellen und wartet den Neustart ab (bis zu 15 Minuten). Das Ergebnis nennt `restored` (true/false, aus dem eigenen Ergebnis von HA) und `safety_backup`.
4. Zum Rückgängigmachen stellst du das Sicherheits-Backup genauso wieder her.

Auf Home Assistant OS muss die Datenbank-Wahl zum Backup passen: Ein Backup mit Datenbank lässt sich nur zusammen mit ihr wiederherstellen (`ha_get_backup` zeigt `database_can_be_kept`). Add-ons und Ordner stellt der MCP nie wieder her; dafür nutzt du in HA **Einstellungen → System → Backups**.

## 4. Stolperfallen und Fehlerbehebung

| Anzeichen oder Risiko | Was du prüfen solltest |
|---|---|
| `HA_TOKEN is required`, HTTP 401 oder falsches HA-Ziel | Prüfe die private `.env`, das Arbeitsverzeichnis, die HA-Adresse (nur die Stamm-URL), Überschreibungen durch die Prozessumgebung und das Token. Widerrufe ein offengelegtes Token; füge es nicht in Fehlerberichte ein. `localhost` in einem Container oder entfernten Client bezeichnet **diesen** Container bzw. Rechner. |
| HA 403 / WebSocket unauthorized | Dem HA-Benutzer hinter dem Token fehlen eventuell Administrator- oder Endpunkt-Berechtigungen. MCP-Schalter können keine HA-Rechte verleihen. Manche Lese-Werkzeuge, darunter Backups, erfordern HA-Administratorrechte. |
| `writes disabled`, `admin write disabled`, `delete disabled` | Schalte nur genau die benötigte Stufe frei und starte dann einen externen MCP-Prozess neu; im Chat der Oberfläche hake außerdem **Aktionen erlauben** an. Prüfe `--read-only` / `--max-level` bei der Oberfläche. |
| Freigabe erschien nicht, oder Aktion lief ohne Freigabe | Prüfe in den Einstellungen **ohne Freigabe ausführen** auf der richtigen Stufe. Ist es eingeschaltet, entfällt die Prüfung; sonst gib jede Anfrage innerhalb von 120 Sekunden frei. Die Auto-Einstellungen der Oberfläche wirken sich weder auf das `YES` der Kommandozeile noch auf die Bestätigungsregeln deiner anderen MCP-Clients aus. |
| `domain not allowed`, falsches Ziel, fehlende Entität | Ermittle eine aktuelle ID, stimme ihre Domain auf den Dienst ab, prüfe `HA_ALLOWED_DOMAINS` und vermeide alternative Ziele in `service_data`. Kein Werkzeug kann erraten, dass eine erfundene ID wirklich existiert. |
| Raumbefehl trifft die falschen Dinge | Verwende `ha_list_area_entities` und dessen Liste `available`; ruf keine nicht verfügbaren IDs auf und nicht gleichzeitig eine Gruppe und ihre Mitglieder. Der Bereich eines Geräts und der eigene Bereich einer Entität können sich unterscheiden. |
| Automation/Dashboard/Helfer abgelehnt oder unerwartet verändert | Vergleiche Konfigurations-IDs, Entitäts-IDs, Dashboard-URL-Pfade gegenüber Sammlungs-IDs und vollständige Helfer-Konfigurationen. Speichere die vorherige Konfiguration, sieh dir die Prüfung von HA an und lies das Ergebnis erneut aus. Das Neuladen der Konfiguration kann verzögert sein. |
| Integrationsablauf schlägt fehl oder Geheimnis wird abgelehnt | Halte dich an das zurückgegebene Formularschema und die Flow-ID, verwende für geheime Felder Verweise auf gespeicherte Aliase und prüfe die Berechtigungen des HA-Benutzers. Die Gerätesuche hängt vom Netzwerk **von HA** ab, nicht davon, was dieser Adapter erreicht. Brich liegengebliebene Abläufe ab. |
| REST-Aufruf abgelehnt | Führe `ha_rest_catalog` aus; nur Paare aus Methode und Pfad, die im Katalog stehen, und routenspezifische Abfrageschlüssel werden angenommen. `ha_rest_query` erlaubt GET und nur die POSTs des Katalogs für Templates und Konfigurationsprüfung. Auch diese können HA-Ressourcen beanspruchen. `ha_rest_write` auf `/api/states/<entity_id>` setzt einen vorübergehenden Zustand, **keinen** dauerhaften Helfer und keine echte Geräteaktion. |
| Oberfläche nicht erreichbar oder falsches Modell | Öffne die Oberfläche auf demselben Rechner über `http://localhost:8765/`; prüfe den laufenden Prozess, den Ollama-Dienst und das Modell sowie die **Einstellungen** der Oberfläche. Ein fremder Host-Header wird abgelehnt. Verwende `--allow-remote` nicht in einem Netzwerk ohne Anmeldung. |
| Modell gibt eine veraltete oder nicht gestützte Antwort | Bitte es, mit einem namentlich genannten Lese-Werkzeug den *aktuellen* Zustand abzurufen, oder beginne einen neuen Chat. Kleine Ollama-Modelle bekommen eine Vorauswahl an Werkzeugen anhand von Stichwörtern plus die lokale Suche `find_tools` (und jedes echte Werkzeug, das sie beim Namen aufrufen, wird bei Bedarf nachgeladen); eine plausible Antwort ist keine Überprüfung. |

Das REST-Gateway ist eine freigegebene Teilmenge, **kein** beliebiger HTTP- oder WebSocket-Proxy. Es kann keine beliebigen HA-Dateien bearbeiten, keine Backups planen, keine Add-ons oder Ordner wiederherstellen und kein einzelnes Gerät aus dem Register entfernen. Das HA-Token behält außerhalb dieses Adapters seine eigentliche HA-Befugnis. Nutze am besten ein eigenes, weniger berechtigtes HA-Konto für alltägliches Lesen, mach Backups vor Administrator-Änderungen und prüfe nach folgenreichen Schreibzugriffen von Hand in HA.

## 5. Wo Daten gespeichert werden

| Daten | Standardort | Aufbewahrung / Umgang |
|---|---|---|
| HA-Einstellungen und Token | `.env` im Projektverzeichnis `ha-safe-mcp` oder die `--env-file` der Oberfläche | Die Oberfläche schreibt mit Rechten 0600; halte die Datei aus der Versionsverwaltung heraus. |
| Aliase für Zugangsdaten von Integrationen und Backups, verschlüsselte Werte **und lokaler Schlüssel** | `~/.config/ha-safe-mcp/credentials/` (oder entsprechend unter `XDG_CONFIG_HOME`) | Verzeichnis 0700, Dateien 0600; Werte werden weder an die Oberfläche noch an das Modell zurückgegeben. Der Schlüssel liegt neben den Daten: Die Verschlüsselung schützt nicht vor jemandem, der Zugriff auf dein Benutzerkonto hat. Sichere Schlüssel und verschlüsselte Daten **gemeinsam**, wenn du sie wiederherstellen können willst. |
| Erzeugte Pläne und Codeblöcke aus dem Chat der Oberfläche | `~/.local/share/ha-safe-mcp/files/` (oder entsprechend unter `XDG_DATA_HOME`) | Lokale Textdateien; **werden nie automatisch ausgeführt oder an HA gesendet**. Prüfe sie, bevor du sie verwendest. Bis zu 256 KB pro Datei und 500 Dateien; löschen über **Dateien**. |
| Änderungsprotokoll (vorheriger Zustand von Konfigurationsänderungen) | `~/.local/state/ha-safe-mcp/changes/` (oder entsprechend unter `XDG_STATE_HOME`; `HA_CHANGES_DIR` für einen separat gestarteten Server) | Eine JSON-Datei pro Änderung, Verzeichnis 0700, Dateien 0600, 30 Tage und höchstens 1000 Einträge. Enthält Konfiguration (Namen, Entitäts-IDs, Inhalte von Automationen), nie Tokens oder Werte von Zugangsdaten. |
| Protokoll-Metadaten | `~/.local/state/ha-safe-mcp/audit/` (oder entsprechend unter `XDG_STATE_HOME`) | UTC-Zeit, Werkzeug, Routen-Vorlage, Status, Dauer/Fehlerklasse; keine Prompts, Ziel-Entitäts-IDs, Daten oder Tokens. 30 Tage Aufbewahrung, ältere Einträge werden beim Lesen/Schreiben entfernt; leeren über **Protokoll**. Setze `HA_AUDIT=false` für einen separat gestarteten MCP-Server, um dessen Protokoll abzuschalten. |
| Gespräch in der Oberfläche | `localStorage` des Browsers | Von Haupt-Chat und Chat-Blase gemeinsam genutzt; **Neu** leert es. Die letzten Texte von dir und vom Assistenten gehen als Kontext an das gewählte lokale Ollama-Modell; tippe keine Geheimnisse oder sensiblen Daten in den Chat. |

Die Lösch-Funktionen unter **Dateien** und **Protokoll** in der Oberfläche betreffen nur die lokal vom MCP erzeugten Dateien und Protokolle, nicht die HA-Konfiguration oder HA-Backups. Heruntergeladene HA-Backup-Archive liegen dort, wo **dein Browser** Downloads speichert. Schütze auch lokale Backups und das Browser-Profil.
