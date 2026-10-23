"""Small test double for the documented HA REST endpoints. Never use as real HA."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

STATES = [{"entity_id": "light.desk", "state": "off", "attributes": {"friendly_name": "Desk Lamp"}},
          {"entity_id": "sensor.temperature", "state": "21", "attributes": {"friendly_name": "Temperature"}}]


class Handler(BaseHTTPRequestHandler):
    def _respond(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _auth(self):
        if self.headers.get("Authorization") != "Bearer test-token":
            self._respond(401, {"message": "Unauthorized"})
            return False
        return True

    def do_GET(self):
        if not self._auth():
            return
        if self.path == "/api/config":
            return self._respond(200, {"version": "test-double"})
        if self.path == "/api/states":
            return self._respond(200, STATES)
        if self.path.startswith("/api/states/"):
            entity = self.path.removeprefix("/api/states/")
            return self._respond(200, next((s for s in STATES if s["entity_id"] == entity), {}))
        if self.path == "/api/services":
            return self._respond(200, [{"domain": "light", "services": {"turn_on": {}}}])
        self._respond(404, {"message": "Not found"})

    def do_POST(self):
        if not self._auth():
            return
        if self.path == "/api/services/light/turn_on":
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            return self._respond(200, [{"entity_id": body["entity_id"], "state": "on"}])
        self._respond(404, {"message": "Not found"})


HTTPServer(("0.0.0.0", 8123), Handler).serve_forever()
