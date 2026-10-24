"""OAuth 2.1 for web connectors (ChatGPT, Claude): discovery, dynamic registration, consent behind the UI login,
PKCE code flow, refresh rotation; issued tokens are normal remote-client profiles."""
import base64
import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

from ha_safe_mcp.remote import ClientStore
from test_remote import MCP_HEADERS, http, make, rpc, running

PUBLIC = "https://ha.example.org"
JWT = {"cf-access-jwt-assertion": "good"}
UI = {**JWT, "X-HA-MCP-UI": "1", "Origin": PUBLIC}
REDIRECT = "https://chatgpt.example/connector/oauth/callback"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


def public(app):
    return http(app, host="ha.example.org")


async def register(h, **extra):
    body = {"client_name": "ChatGPT", "redirect_uris": [REDIRECT], "token_endpoint_auth_method": "none", **extra}
    return await h.post("/mcp/oauth/register", json=body)


def authorize_params(client_id_value, **extra):
    params = {"response_type": "code", "client_id": client_id_value, "redirect_uri": REDIRECT, "code_challenge": CHALLENGE,
              "code_challenge_method": "S256", "state": "xyz", "scope": "ha", "resource": f"{PUBLIC}/mcp"}
    return {**params, **extra}


async def authorize(h, client_id, level="control", **extra):
    params = authorize_params(client_id, **extra)
    approved = await h.post("/api/oauth/approve", headers=UI, json={"params": params, "level": level, "domains": []})
    assert approved.status_code == 200, approved.text
    query = parse_qs(urlsplit(approved.json()["redirect"]).query)
    return query["code"][0], query


async def exchange(h, client_id, code, verifier=VERIFIER):
    return await h.post("/mcp/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                                   "redirect_uri": REDIRECT, "client_id": client_id,
                                                   "code_verifier": verifier})


# ---------------------------------------------------------------- discovery (no Access login)
async def test_discovery_documents_are_public_and_point_to_the_right_endpoints(tmp_path):
    app, *_ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        challenge = await h.post("/mcp", headers=MCP_HEADERS, json=rpc("tools/list"))
        resource = await h.get("/.well-known/oauth-protected-resource/mcp")
        resource_root = await h.get("/.well-known/oauth-protected-resource")
        server = await h.get("/.well-known/oauth-authorization-server")
        preflight = await h.options("/mcp/oauth/token", headers={"Origin": "https://inspector.example",
                                                                 "Access-Control-Request-Method": "POST"})
    assert challenge.status_code == 401
    assert f'resource_metadata="{PUBLIC}/.well-known/oauth-protected-resource/mcp"' in \
        challenge.headers["www-authenticate"]
    assert resource.json()["resource"] == f"{PUBLIC}/mcp" and resource.json()["authorization_servers"] == [PUBLIC]
    assert resource_root.json() == resource.json()
    meta = server.json()
    assert meta["issuer"] == PUBLIC
    assert meta["authorization_endpoint"] == f"{PUBLIC}/oauth/authorize"
    assert meta["token_endpoint"] == f"{PUBLIC}/mcp/oauth/token"
    assert meta["registration_endpoint"] == f"{PUBLIC}/mcp/oauth/register"
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert preflight.status_code == 204 and preflight.headers["access-control-allow-origin"] == "*"


async def test_the_consent_page_stays_behind_the_ui_login(tmp_path):
    app, *_ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        anonymous = await h.get("/oauth/authorize")
        logged_in = await h.get("/oauth/authorize", headers=JWT)
        script = await h.get("/static/oauth.js", headers=JWT)
    assert anonymous.status_code == 403
    assert logged_in.status_code == 200 and "oauth.js" in logged_in.text
    assert script.status_code == 200


# ---------------------------------------------------------------- registration
async def test_registration_accepts_https_and_loopback_redirects_only(tmp_path):
    app, *_ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        ok = await register(h)
        loopback = await register(h, redirect_uris=["http://localhost:33418/callback"], client_name="Claude Code")
        plain_http = await register(h, redirect_uris=["http://evil.example/cb"])
        fragment = await register(h, redirect_uris=["https://x.example/cb#frag"])
        confidential = await register(h, token_endpoint_auth_method="client_secret_post")
    assert ok.status_code == 201 and ok.json()["client_id"] and "client_secret" not in ok.json()
    assert loopback.status_code == 201
    assert plain_http.status_code == 400 and plain_http.json()["error"] == "invalid_redirect_uri"
    assert fragment.status_code == 400
    assert confidential.status_code == 201 and confidential.json()["client_secret"]


# ---------------------------------------------------------------- full flow
async def test_code_flow_with_pkce_issues_a_capped_client_profile(tmp_path):
    app, clients, pool = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        client_id = (await register(h)).json()["client_id"]
        checked = await h.post("/api/oauth/check", headers=UI, json={"params": authorize_params(client_id)})
        code, query = await authorize(h, client_id, level="control")
        bad_verifier = await exchange(h, client_id, code, verifier="w" * 64)
        code, _ = await authorize(h, client_id, level="control")
        tokens = await exchange(h, client_id, code)
        replay = await exchange(h, client_id, code)
        access = tokens.json()["access_token"]
        listed = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {access}"},
                              json=rpc("tools/list"))
        overview = (await h.get("/api/clients", headers=JWT)).json()["clients"]
    assert checked.json()["client_name"] == "ChatGPT" and checked.json()["redirect_host"] == "chatgpt.example"
    assert query["state"] == ["xyz"]
    assert bad_verifier.status_code == 400 and bad_verifier.json()["error"] == "invalid_grant"
    assert tokens.status_code == 200 and access.startswith("hsm_") and tokens.json()["token_type"] == "Bearer"
    assert tokens.json()["refresh_token"].startswith("hsr_") and tokens.json()["expires_in"] == 3600
    assert replay.status_code == 400 and replay.json()["error"] == "invalid_grant"
    assert listed.status_code == 200
    assert len(overview) == 1 and overview[0]["kind"] == "oauth" and overview[0]["level"] == "control"
    assert overview[0]["name"] == "ChatGPT (OAuth)"


async def test_refresh_rotates_both_tokens_and_reauthorizing_replaces_the_profile(tmp_path):
    app, clients, _ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        client_id = (await register(h)).json()["client_id"]
        code, _ = await authorize(h, client_id)
        first = (await exchange(h, client_id, code)).json()
        refreshed = await h.post("/mcp/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id,
                                                            "refresh_token": first["refresh_token"]})
        reused = await h.post("/mcp/oauth/token", data={"grant_type": "refresh_token", "client_id": client_id,
                                                         "refresh_token": first["refresh_token"]})
        old_access = await h.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {first['access_token']}"},
                                  json=rpc("tools/list"))
        code, _ = await authorize(h, client_id, level="read")
        await exchange(h, client_id, code)
    assert refreshed.status_code == 200 and refreshed.json()["refresh_token"] != first["refresh_token"]
    assert reused.status_code == 400 and reused.json()["error"] == "invalid_grant"
    assert old_access.status_code == 401
    profiles = clients.list()
    assert len(profiles) == 1 and profiles[0]["level"] == "read"


async def test_wrong_requests_are_refused_before_a_code_is_issued(tmp_path):
    app, *_ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        client_id = (await register(h)).json()["client_id"]
        bad = {}
        for name, extra in {"redirect": {"redirect_uri": "https://other.example/cb"},
                            "plain_pkce": {"code_challenge_method": "plain"},
                            "no_pkce": {"code_challenge": ""},
                            "resource": {"resource": "https://elsewhere.example/mcp"},
                            "client": {"client_id": "unknown"},
                            "type": {"response_type": "token"}}.items():
            response = await h.post("/api/oauth/approve", headers=UI,
                                    json={"params": authorize_params(client_id, **extra), "level": "read"})
            bad[name] = response.status_code
        denied = await h.post("/api/oauth/deny", headers=UI, json={"params": authorize_params(client_id)})
        forged = await h.post("/api/oauth/approve", headers=JWT,
                              json={"params": authorize_params(client_id), "level": "delete"})
    assert set(bad.values()) == {400}, bad
    assert parse_qs(urlsplit(denied.json()["redirect"]).query)["error"] == ["access_denied"]
    assert forged.status_code == 403


async def test_confidential_clients_must_send_their_secret(tmp_path):
    app, *_ = make(tmp_path, public=True)
    async with running(app), public(app) as h:
        reg = (await register(h, token_endpoint_auth_method="client_secret_post")).json()
        code, _ = await authorize(h, reg["client_id"])
        missing = await exchange(h, reg["client_id"], code)
        code, _ = await authorize(h, reg["client_id"])
        ok = await h.post("/mcp/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                                     "redirect_uri": REDIRECT, "client_id": reg["client_id"],
                                                     "client_secret": reg["client_secret"], "code_verifier": VERIFIER})
    assert missing.status_code == 401 and missing.json()["error"] == "invalid_client"
    assert ok.status_code == 200


def test_expired_access_tokens_are_rejected(tmp_path):
    clock = [datetime(2026, 10, 24, 20, 0, tzinfo=timezone.utc)]
    store = ClientStore(tmp_path / "c", now=lambda: clock[0])
    _, access, refresh = store.issue_oauth("ChatGPT", "read", [], oauth_client_id="abc")
    assert store.authenticate(access)
    clock[0] += timedelta(hours=2)
    assert store.authenticate(access) is None
    assert store.refresh_oauth(refresh, "abc") is not None
    assert store.refresh_oauth(refresh, "abc") is None
