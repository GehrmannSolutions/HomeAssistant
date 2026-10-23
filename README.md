# ha-safe-mcp

Eigenständiger, bewusst kleiner **Home-Assistant-MCP-Server** (stdio). Orientiert sich am Funktionsansatz von [ha-mcp](https://github.com/homeassistant-ai/ha-mcp), nutzt aber direkt die [offizielle Home-Assistant-REST-API](https://developers.home-assistant.io/docs/api/rest/) und übernimmt **nicht** dessen vollständigen Funktionsumfang oder Quellcode.

## Funktionen

- `ha_search_entities`: aktuelle Entitäten nach ID/Anzeigename und Domain filtern
- `ha_get_state`: Zustand einer Entität lesen
- `ha_list_services`: verfügbare Aktionen lesen
- `ha_call_service`: Dienst für **genau eine Entität** aufrufen, standardmäßig **deaktiviert**

Kein Zugriff auf Dateien, Konfigurations-YAML, Backups, Registries oder Automationsverwaltung. Kein HTTP-MCP-Endpunkt; der Server kommuniziert lokal via stdio mit einem MCP-Client.

## Einrichtung

```bash
cd /home/user/projects/ha-mcp-local
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[test]'
```

In `.env` die URL und einen **Home-Assistant Long-Lived Access Token** (`HA_TOKEN`) eintragen; der bereits lokal vorhandene GitHub-PAT in `.github.env` ist davon unabhängig und für den Betrieb **nicht nötig**. Beide Dateien sind git-ignoriert; **nicht committen**. Für reine Lesezugriffe `HA_ALLOW_WRITE=false` beibehalten. Schreibzugriffe nur bewusst mit `HA_ALLOW_WRITE=true` freischalten und `HA_ALLOWED_DOMAINS` einschränken. Wer umfassendere Aktionen benötigt, sollte den Berechtigungsumfang eines gesonderten HA-Benutzers sorgfältig prüfen.

MCP-Client-Konfiguration (Beispiel; `cwd` muss auf das Projekt zeigen, damit `.env` gefunden wird):

```json
{
  "mcpServers": {
    "home-assistant-local": {
      "command": "/home/user/projects/ha-mcp-local/.venv/bin/ha-safe-mcp",
      "cwd": "/home/user/projects/ha-mcp-local"
    }
  }
}
```

Falls der Client kein `cwd` unterstützt, `HA_URL`, `HA_TOKEN`, `HA_ALLOW_WRITE` und ggf. `HA_ALLOWED_DOMAINS` als Prozess-Umgebungsvariablen konfigurieren. Token nie als Kommandozeilenargument, in Git oder in einen Debug-Log schreiben. Bei TLS über HTTPS wird das Zertifikat normal geprüft; keine `verify=false`-Option.

## Docker-Test (ohne echtes Smart Home)

```bash
sudo docker compose -f compose.test.yaml up -d
sudo docker build -t ha-safe-mcp:local .
.venv/bin/python tests/docker_smoke.py
TEST_ALLOW_WRITE=true .venv/bin/python tests/docker_smoke.py
.venv/bin/python -m pytest -q
sudo docker compose -f compose.test.yaml down
```

Der Container `ha-test-double` simuliert nur drei dokumentierte REST-Endpunkte; **kein echter Home-Assistant-Core-Test**. `tests/docker_smoke.py` verifiziert den echten MCP-Handshake, Tool-Aufrufe und standardmäßig gesperrte sowie explizit freigegebene Schreibzugriffe via Docker-Image. Dieser Test nutzt `sudo -n docker`; bei eigenem Docker-Zugriff entsprechend anpassen.

Für einen produktiven Docker-MCP-Client das Image mit interaktivem stdin starten und **nur** HA-Variablen übergeben (nicht `--env-file .github.env` und nicht den GitHub-PAT). Der HA-Host muss aus dem Container erreichbar sein; `127.0.0.1` referenziert sonst den Container.

## Sicherheit und Grenzen

`ha_call_service` erlaubt standardmäßig nur `light`, `switch`, `fan`, `climate`, `cover`, `media_player`, sofern Schreiben überhaupt eingeschaltet ist. Es validiert Service-/Entitätsnamen, verlangt passende Entity-Domain und verbietet zusätzliche Zielangaben (`entity_id`, `area_id`, `device_id`) in `service_data`. Das ist **keine vollständige HA-Autorisierungsgrenze**: Die effektiven Rechte des HA-Tokens gelten weiterhin. Exponiere den stdio-Prozess nicht ungeschützt im Netzwerk. Fehlerantworten geben weder Token noch Response-Bodies wieder.

Quellen: [Home Assistant Organisation](https://github.com/home-assistant), [offizielle REST-Dokumentation](https://developers.home-assistant.io/docs/api/rest/), [ha-mcp als Funktionsreferenz](https://github.com/homeassistant-ai/ha-mcp).
