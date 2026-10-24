"use strict";
/* Consent page for OAuth clients (ChatGPT, Claude, ...). Runs behind the UI login; the server re-validates every
   parameter on approve/deny, this page only shows the request and sends the decision. */

const PARAM_NAMES = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method",
  "state", "scope", "resource"];

function oauthParams() {
  const query = new URLSearchParams(location.search);
  const params = {};
  for (const name of PARAM_NAMES) if (query.has(name)) params[name] = query.get(name);
  return params;
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-HA-MCP-UI": "1" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Fehler ${response.status}`);
  return data;
}

function show(message, kind) {
  const box = document.querySelector("#oauth-result");
  box.textContent = message;
  box.className = `result ${kind || ""}`;
}

async function start() {
  const params = oauthParams();
  const form = document.querySelector("#oauth-form");
  try {
    const info = await post("/api/oauth/check", { params });
    document.querySelector("#oauth-client").textContent = info.client_name;
    document.querySelector("#oauth-host").textContent = info.redirect_host;
    document.querySelector("#oauth-intro").hidden = true;
    form.hidden = false;
  } catch (error) {
    document.querySelector("#oauth-intro").textContent = "Diese Anfrage kann nicht freigegeben werden.";
    show(error.message, "err");
    return;
  }
  const decide = async (action) => {
    for (const button of form.querySelectorAll("button")) button.disabled = true;
    const data = new FormData(form);
    const domains = String(data.get("domains") || "").split(",").map((d) => d.trim()).filter(Boolean);
    try {
      const result = await post(`/api/oauth/${action}`, { params, level: data.get("level"), domains });
      show(action === "approve" ? "Freigegeben, du wirst zurückgeleitet …" : "Abgelehnt, du wirst zurückgeleitet …", "ok");
      location.assign(result.redirect);
    } catch (error) {
      show(error.message, "err");
      for (const button of form.querySelectorAll("button")) button.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); decide("approve"); });
  form.querySelector("[data-action='deny']").addEventListener("click", () => decide("deny"));
}

document.addEventListener("DOMContentLoaded", start);
