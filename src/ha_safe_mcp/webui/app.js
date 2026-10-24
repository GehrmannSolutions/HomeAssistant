"use strict";
/* HA Safe MCP web UI: first-run setup, overview, settings and one shared chat that is shown
   both as a full section and as a floating bubble. No framework, no inline code (CSP-safe);
   all dynamic text goes through textContent. */

const STORE_KEY = "ha-mcp-chat-v1";
const MAX_ITEMS = 120;
const STARTERS = [
  "Welche Lichter gibt es?",
  "Zeig mir alle Sensoren mit ihren Werten",
  "Welche Dashboards gibt es?",
  "Welche Helfer vom Typ input_boolean gibt es?",
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, { method = "GET", body } = {}) {
  const options = { method, headers: {} };
  if (method !== "GET") {
    options.headers["X-HA-MCP-UI"] = "1";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body || {});
  }
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || `Fehler ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setResult(node, text, kind = "") {
  if (!node) return;
  node.textContent = text || "";
  node.className = "result" + (kind ? " " + kind : "");
}

function busy(button, isBusy, label) {
  if (!button) return;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = label || "Bitte warten …";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

function domainsFrom(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

/* ---------------------------------------------------------------- state */

const app = {
  status: null,
  models: [],
  view: "loading",
};

/* ---------------------------------------------------------------- views */

function showView(name) {
  const configured = app.status && app.status.configured;
  if (!configured && name !== "setup") name = "setup";
  if (configured && name === "setup") name = "home";
  app.view = name;
  for (const section of $$(".view")) section.hidden = section.id !== `view-${name}`;
  for (const tab of $$(".tab")) tab.classList.toggle("active", tab.dataset.view === name);
  $(".tabs").hidden = !configured;
  $("#bubble").hidden = !configured || name === "chat";
  if (name !== "setup" && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  if (name === "chat") { chat.markSeen(); chat.focus("main"); }
  if (name === "home") renderHome();
  if (name === "settings") fillSettings();
  if (name === "credentials") credentials.load();
  if (name === "files") fileManager.load();
  if (name === "backups") backupPage.load();
  if (name === "audit") auditLog.load();
}

function renderModePill() {
  const pill = $("#mode-pill");
  const settings = app.status && app.status.settings;
  if (!settings || !app.status.configured) { pill.hidden = true; return; }
  let text = "Nur lesen";
  if (settings.allow_delete) text = "Löschen erlaubt";
  else if (settings.allow_admin_write) text = "Konfiguration erlaubt";
  else if (settings.allow_write) text = "Steuern erlaubt";
  pill.textContent = text;
  pill.classList.toggle("write", Boolean(settings.allow_write));
  pill.hidden = false;
}

async function refreshStatus() {
  app.status = await api("/api/status");
  renderModePill();
  chat.applySettings(app.status.settings);
  return app.status;
}

/* ---------------------------------------------------------------- models */

function fillModelSelect(select, models, selected) {
  select.replaceChildren();
  const names = models.map((model) => model.name);
  if (selected && !names.includes(selected)) {
    select.append(el("option", { value: selected }, `${selected} (nicht gefunden)`));
  }
  for (const model of models) {
    const label = `${model.name} · ${model.size_gb} GB` + (model.tools === false ? " · ohne Tool-Unterstützung" : "");
    select.append(el("option", { value: model.name, disabled: model.tools === false }, label));
  }
  if (selected) select.value = selected;
  if (!select.value) {
    const firstUsable = models.find((model) => model.tools !== false);
    if (firstUsable) select.value = firstUsable.name;
  }
}

async function loadModels(form, button) {
  const url = form.elements.ollama_url.value.trim();
  const result = $(".result", form);
  busy(button, true, "Lade Modelle …");
  try {
    const data = await api("/api/setup/test-ollama", { method: "POST", body: { ollama_url: url } });
    app.models = data.models || [];
    const current = form.elements.ollama_model.value || (app.status && app.status.settings.ollama_model);
    fillModelSelect(form.elements.ollama_model, app.models, current);
    if (!data.ok) setResult(result, data.message, "err");
    else if (!app.models.length) setResult(result, "Ollama läuft, aber es ist kein Modell installiert (z. B. »ollama pull qwen2.5-coder:7b«).", "warn");
    else setResult(result, `${data.message} · ${app.models.length} Modell(e)`, "ok");
    return data.ok && app.models.length > 0;
  } catch (error) {
    setResult(result, error.message, "err");
    return false;
  } finally {
    busy(button, false);
  }
}

/* ---------------------------------------------------------------- setup wizard */

const wizard = {
  step: 1,
  data: {},

  init() {
    $("#step-1").addEventListener("submit", (event) => { event.preventDefault(); this.checkHa(); });
    $("#step-2").addEventListener("submit", (event) => { event.preventDefault(); this.chooseModel(); });
    $("#step-3").addEventListener("submit", (event) => { event.preventDefault(); this.save(); });
    $("[data-action='load-models']", $("#step-2")).addEventListener("click", (event) => loadModels($("#step-2"), event.currentTarget));
    for (const back of $$("#view-setup [data-action='back']")) back.addEventListener("click", () => this.go(this.step - 1));
    $("#view-setup [data-action='open-chat']").addEventListener("click", () => showView("chat"));
    const write = $("#step-3").elements.allow_write;
    const admin = $("#step-3").elements.allow_admin_write;
    const del = $("#step-3").elements.allow_delete;
    const sync = () => {
      admin.disabled = !write.checked; if (!write.checked) admin.checked = false;
      del.disabled = !admin.checked; if (!admin.checked) del.checked = false;
    };
    for (const box of [write, admin, del]) box.addEventListener("change", sync);
    sync();
  },

  start(settings) {
    const form = $("#step-1");
    if (settings) {
      form.elements.ha_url.value = settings.ha_url;
      $("#step-2").elements.ollama_url.value = settings.ollama_url;
      $("#step-3").elements.allowed_domains.value = settings.allowed_domains.join(",");
    }
    this.go(1);
  },

  go(step) {
    this.step = Math.max(1, Math.min(4, step));
    for (const panel of $$("#view-setup .step")) panel.hidden = Number(panel.dataset.step) !== this.step;
    for (const item of $$("#view-setup .steps li")) {
      const number = Number(item.dataset.step);
      item.classList.toggle("active", number === this.step);
      item.classList.toggle("done", number < this.step);
    }
    if (this.step === 2 && !app.models.length) loadModels($("#step-2"), $("[data-action='load-models']", $("#step-2")));
    const focusable = $(`#step-${this.step} input, #step-${this.step} select, #step-${this.step} button.primary`);
    if (focusable) focusable.focus();
  },

  async checkHa() {
    const form = $("#step-1");
    const result = $(".result", form);
    const button = $("button[type='submit']", form);
    const body = { ha_url: form.elements.ha_url.value.trim(), token: form.elements.token.value.trim() };
    if (!body.token) { setResult(result, "Bitte den Token eintragen.", "err"); return; }
    busy(button, true, "Prüfe …");
    try {
      const check = await api("/api/setup/test-ha", { method: "POST", body });
      if (!check.ok) { setResult(result, check.message, "err"); return; }
      let text = check.message;
      if (check.location_name) text += ` · ${check.location_name}`;
      if (check.user) text += ` · angemeldet als ${check.user}`;
      setResult(result, text, "ok");
      this.data = { ...body, is_admin: check.is_admin };
      const adminBox = $("#step-3").elements.allow_admin_write;
      adminBox.title = check.is_admin === false ? "Dieser Token gehört zu keinem Admin-Benutzer" : "";
      setTimeout(() => this.go(2), 500);
    } catch (error) {
      setResult(result, error.message, "err");
    } finally {
      busy(button, false);
    }
  },

  chooseModel() {
    const form = $("#step-2");
    const model = form.elements.ollama_model.value;
    if (!model) { setResult($(".result", form), "Bitte ein Modell wählen.", "err"); return; }
    this.data.ollama_url = form.elements.ollama_url.value.trim();
    this.data.ollama_model = model;
    this.go(3);
  },

  async save() {
    const form = $("#step-3");
    const result = $(".result", form);
    const button = $("button[type='submit']", form);
    if (form.elements.allow_admin_write.checked && this.data.is_admin === false) {
      setResult(result, "Für Konfigurationsänderungen braucht der Token Admin-Rechte.", "err");
      return;
    }
    const body = {
      ha_url: this.data.ha_url, token: this.data.token,
      ollama_url: this.data.ollama_url, ollama_model: this.data.ollama_model,
      allow_write: form.elements.allow_write.checked,
      allow_admin_write: form.elements.allow_admin_write.checked,
      allow_delete: form.elements.allow_delete.checked,
      allowed_domains: domainsFrom(form.elements.allowed_domains.value),
    };
    busy(button, true, "Speichere …");
    try {
      const saved = await api("/api/setup", { method: "POST", body });
      this.data = {};
      $("#step-1").elements.token.value = "";
      await refreshStatus();
      const settings = saved.settings;
      $("#done-summary").textContent = `Verbunden mit ${settings.ha_url}. Modell: ${settings.ollama_model}. ` +
        (settings.allow_write ? "Aktionen sind erlaubt und müssen im Chat einzeln bestätigt werden." : "Modus: nur lesen.");
      this.go(4);
      $(".tabs").hidden = false;
    } catch (error) {
      setResult(result, error.message, "err");
    } finally {
      busy(button, false);
    }
  },
};

/* ---------------------------------------------------------------- overview */

function fact(dl, label, value) {
  dl.append(el("dt", {}, label), el("dd", {}, value));
}

async function renderHome() {
  const settings = app.status.settings;
  const haFacts = $("#ha-facts");
  const modelFacts = $("#model-facts");
  haFacts.replaceChildren(); modelFacts.replaceChildren();
  fact(haFacts, "Adresse", settings.ha_url);
  fact(haFacts, "Status", "prüfe …");
  fact(modelFacts, "Modell", settings.ollama_model);
  fact(modelFacts, "Ollama", settings.ollama_url);
  const perms = $("#perm-list");
  perms.replaceChildren(
    el("li", { class: "read" }, "✓ Lesen"),
    el("li", { class: settings.allow_write ? "on" : "off" }, settings.allow_write ? "✓ Steuern" : "– Steuern"),
    el("li", { class: settings.allow_admin_write ? "on" : "off" }, settings.allow_admin_write ? "✓ Konfiguration ändern" : "– Konfiguration ändern"),
    el("li", { class: settings.allow_delete ? "on" : "off" }, settings.allow_delete ? "✓ Löschen" : "– Löschen"),
    el("li", { class: "off" }, `Domains: ${settings.allowed_domains.join(", ") || "keine"}`),
  );
  const chips = $("#start-chips");
  chips.replaceChildren(...STARTERS.map((text) => el("button", { type: "button", class: "chip", onclick: () => { showView("chat"); chat.send(text, "main"); } }, text)));
  try {
    const check = await api("/api/setup/test-ha", { method: "POST", body: { ha_url: settings.ha_url, token: "" } });
    haFacts.replaceChildren();
    fact(haFacts, "Adresse", settings.ha_url);
    fact(haFacts, "Status", check.ok ? `verbunden (${check.version})` : check.message);
    if (check.location_name) fact(haFacts, "Zuhause", check.location_name);
    if (check.user) fact(haFacts, "Token von", check.user + (check.is_admin ? " (Admin)" : ""));
  } catch (error) {
    haFacts.lastChild.textContent = error.message;
  }
  try {
    const ollama = await api("/api/setup/test-ollama", { method: "POST", body: { ollama_url: settings.ollama_url } });
    const model = (ollama.models || []).find((item) => item.name === settings.ollama_model);
    fact(modelFacts, "Status", !ollama.ok ? ollama.message : model ? `bereit (${model.size_gb} GB${model.tools ? ", Tools" : ""})` : "Modell nicht installiert");
  } catch (error) {
    fact(modelFacts, "Status", error.message);
  }
}

/* ---------------------------------------------------------------- settings */

function fillSettings() {
  const form = $("#settings-form");
  const settings = app.status.settings;
  form.elements.ha_url.value = settings.ha_url;
  form.elements.token.value = "";
  form.elements.ollama_url.value = settings.ollama_url;
  form.elements.allow_write.checked = settings.allow_write;
  form.elements.allow_admin_write.checked = settings.allow_admin_write;
  form.elements.allow_delete.checked = settings.allow_delete;
  form.elements.allowed_domains.value = settings.allowed_domains.join(",");
  fillModelSelect(form.elements.ollama_model, app.models, settings.ollama_model);
  if (!app.models.length) loadModels(form, $("[data-action='load-models']", form));
  syncSettingsSwitches();
  setResult($(".result", form), "");
}

function syncSettingsSwitches() {
  const form = $("#settings-form");
  const { allow_write: write, allow_admin_write: admin, allow_delete: del } = form.elements;
  admin.disabled = !write.checked; if (!write.checked) admin.checked = false;
  del.disabled = !admin.checked; if (!admin.checked) del.checked = false;
}

function initSettings() {
  const form = $("#settings-form");
  for (const name of ["allow_write", "allow_admin_write", "allow_delete"]) form.elements[name].addEventListener("change", syncSettingsSwitches);
  $("[data-action='load-models']", form).addEventListener("click", (event) => loadModels(form, event.currentTarget));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button[type='submit']", form);
    const body = {
      ha_url: form.elements.ha_url.value.trim(), token: form.elements.token.value.trim(),
      ollama_url: form.elements.ollama_url.value.trim(), ollama_model: form.elements.ollama_model.value,
      allow_write: form.elements.allow_write.checked, allow_admin_write: form.elements.allow_admin_write.checked,
      allow_delete: form.elements.allow_delete.checked, allowed_domains: domainsFrom(form.elements.allowed_domains.value),
    };
    busy(button, true, "Prüfe und speichere …");
    try {
      await api("/api/settings", { method: "POST", body });
      form.elements.token.value = "";
      await refreshStatus();
      setResult($(".result", form), "Gespeichert. Neue Chat-Anfragen nutzen die neuen Einstellungen.", "ok");
    } catch (error) {
      setResult($(".result", form), error.message, "err");
    } finally {
      busy(button, false);
    }
  });
}

/* ---------------------------------------------------------------- chat */

/* ---------------------------------------------------------------- credentials */

const credentials = {
  items: [],
  editing: null,

  init() {
    const form = $("#cred-form");
    form.addEventListener("submit", (event) => { event.preventDefault(); this.save(); });
    $("[data-action='cred-reset']", form).addEventListener("click", () => this.reset());
    this.reset();
  },

  async load() {
    const result = $("#cred-list-result");
    try {
      this.items = (await api("/api/credentials")).credentials || [];
      setResult(result, "");
    } catch (error) {
      this.items = [];
      setResult(result, error.message, "err");
    }
    this.render();
  },

  render() {
    const rows = this.items.map((item) => el("tr", {},
      el("td", {}, el("code", {}, item.alias)),
      el("td", {}, item.label),
      el("td", {}, item.fields.join(", ")),
      el("td", {}, new Date(item.updated * 1000).toLocaleString("de-DE")),
      el("td", { class: "row-actions" },
        el("button", { type: "button", class: "ghost small", onclick: () => this.edit(item) }, "Ändern"),
        el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, "Löschen"))));
    $("#cred-rows").replaceChildren(...rows);
    $("#cred-empty").hidden = this.items.length > 0;
    $(".cred-table").hidden = this.items.length === 0;
  },

  reset() {
    const form = $("#cred-form");
    form.reset();
    this.editing = null;
    form.elements.alias.readOnly = false;
    form.elements.username.placeholder = "";
    form.elements.password.required = true;
    $("#cred-form-title").textContent = "Neue Zugangsdaten";
    $("#cred-password-hint").textContent = "";
    setResult($(".result", form), "");
  },

  edit(item) {
    const form = $("#cred-form");
    this.reset();
    this.editing = item;
    form.elements.alias.value = item.alias;
    form.elements.alias.readOnly = true;
    form.elements.label.value = item.label;
    form.elements.password.required = false;
    $("#cred-form-title").textContent = `Zugangsdaten ändern: ${item.alias}`;
    $("#cred-password-hint").textContent = "(leer lassen, um das gespeicherte zu behalten)";
    form.elements.username.placeholder = item.fields.includes("username") ? "(gespeichert; leer = behalten)" : "";
    form.elements.label.focus();
  },

  async save() {
    const form = $("#cred-form");
    const result = $(".result", form);
    const button = $("button[type='submit']", form);
    const fields = {};
    const username = form.elements.username.value;
    const password = form.elements.password.value;
    const known = this.editing ? this.editing.fields : [];
    if (username || known.includes("username")) fields.username = username;
    if (password || known.includes("password")) fields.password = password;
    if (!Object.keys(fields).length) { setResult(result, "Mindestens Benutzername oder Passwort angeben.", "err"); return; }
    busy(button, true, "Speichere …");
    try {
      const saved = await api("/api/credentials", { method: "POST",
        body: { alias: form.elements.alias.value.trim(), label: form.elements.label.value.trim(), fields } });
      this.reset();
      setResult($(".result", form), `Gespeichert. Im Chat: »${saved.credential.alias}«.`, "ok");
      await this.load();
    } catch (error) {
      setResult(result, error.message, "err");
    } finally {
      form.elements.password.value = "";
      busy(button, false);
    }
  },

  async remove(item) {
    if (!window.confirm(`Zugangsdaten »${item.alias}« löschen? Integrationen in Home Assistant behalten ihre Kopie.`)) return;
    try {
      await api(`/api/credentials/${encodeURIComponent(item.alias)}`, { method: "DELETE" });
      if (this.editing && this.editing.alias === item.alias) this.reset();
      await this.load();
    } catch (error) {
      setResult($("#cred-list-result"), error.message, "err");
    }
  },
};

/* ---------------------------------------------------------------- chat renderer */

function renderRichText(text) {
  // Safe tiny formatter: ``` fences, `code` and **bold**; everything else is plain text.
  const fragment = document.createDocumentFragment();
  const parts = String(text).split(/```(?:[a-zA-Z0-9_-]*)\n?/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) { fragment.append(el("pre", { class: "code" }, part.replace(/\n$/, ""))); return; }
    const tokens = part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/);
    for (const token of tokens) {
      if (!token) continue;
      if (token.startsWith("`") && token.endsWith("`") && token.length > 2) fragment.append(el("code", {}, token.slice(1, -1)));
      else if (token.startsWith("**") && token.endsWith("**") && token.length > 4) fragment.append(el("strong", {}, token.slice(2, -2)));
      else fragment.append(document.createTextNode(token));
    }
  });
  return fragment;
}

function argsText(args) {
  try { return JSON.stringify(args, null, 2); } catch { return String(args); }
}

const chat = {
  items: [],
  running: null,      // { runId, after }
  typing: "",
  allowWrite: false,
  writePermitted: false,
  unseen: 0,
  roots: {},
  timer: null,

  init() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      this.items = Array.isArray(saved.items) ? saved.items.slice(-MAX_ITEMS) : [];
      this.running = saved.running && typeof saved.running.runId === "string" ? saved.running : null;
    } catch { this.items = []; }
    for (const approval of this.items.filter((item) => item.kind === "approval" && item.state === "pending")) approval.state = "expired";
    const template = $("#chat-template");
    for (const root of $$("[data-chat-root]")) {
      root.append(template.content.cloneNode(true));
      const name = root.dataset.chatRoot;
      const form = $(".composer", root);
      const textarea = form.elements.message;
      this.roots[name] = { root, messages: $(".messages", root), form, textarea };
      form.addEventListener("submit", (event) => { event.preventDefault(); this.send(textarea.value, name); });
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
      });
      textarea.addEventListener("input", () => { textarea.style.height = "auto"; textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px"; });
      form.elements.allow_write.addEventListener("change", (event) => { this.allowWrite = event.target.checked; this.renderControls(); });
      $("[data-action='clear']", form).addEventListener("click", () => this.clear());
      $("[data-action='stop']", form).addEventListener("click", () => this.stop());
    }
    this.timer = setInterval(() => this.tickCountdowns(), 1000);
    this.render();
    if (this.running) this.poll();
  },

  applySettings(settings) {
    this.writePermitted = Boolean(settings && settings.allow_write);
    if (!this.writePermitted) this.allowWrite = false;
    this.renderControls();
  },

  persist() {
    const items = this.items.slice(-MAX_ITEMS);
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ items, running: this.running })); } catch { /* storage full or disabled */ }
  },

  history() {
    return this.items.filter((item) => item.kind === "user" || item.kind === "assistant")
      .slice(-12).map((item) => ({ role: item.kind, content: item.text }));
  },

  add(item) {
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    const visible = app.view === "chat" || !$("#bubble-panel").hidden;
    if (!visible && (item.kind === "assistant" || item.kind === "approval" || item.kind === "error")) this.unseen += 1;
    this.persist();
    this.render();
  },

  markSeen() { this.unseen = 0; this.renderBadge(); },

  focus(name) { const target = this.roots[name]; if (target) setTimeout(() => target.textarea.focus(), 50); },

  async send(text, from) {
    text = String(text || "").trim();
    if (!text || this.running) return;
    const history = this.history();
    const source = this.roots[from];
    this.typing = "Sende …";
    this.render();
    try {
      const started = await api("/api/chat", { method: "POST", body: { message: text, history, allow_write: this.allowWrite } });
      // Only an accepted message enters the visible and persisted history: a refused one may contain a secret.
      this.add({ kind: "user", text });
      for (const root of Object.values(this.roots)) { root.textarea.value = ""; root.textarea.style.height = "auto"; }
      this.running = { runId: started.run_id, after: 0 };
      this.persist();
      this.poll();
    } catch (error) {
      this.typing = "";
      if (source && !source.textarea.value) source.textarea.value = text;
      this.add({ kind: "error", text: error.message });
    }
    this.focus(from);
  },

  async poll() {
    let failures = 0;
    while (this.running) {
      const { runId, after } = this.running;
      try {
        const data = await api(`/api/chat/${encodeURIComponent(runId)}/events?after=${after}&wait=20`);
        failures = 0;
        for (const event of data.events) this.handle(event);
        if (this.running && data.events.length) this.running.after = data.events[data.events.length - 1].seq;
        this.persist();
      } catch (error) {
        if (error.status === 404) {
          this.running = null; this.typing = "";
          this.add({ kind: "note", text: "Die laufende Anfrage ist nicht mehr verfügbar (UI-Server neu gestartet?)." });
          break;
        }
        failures += 1;
        if (failures >= 4) {
          this.running = null; this.typing = "";
          this.add({ kind: "error", text: "Verbindung zum UI-Server verloren." });
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500 * failures));
      }
    }
    this.renderControls();
  },

  handle(event) {
    switch (event.type) {
      case "thinking":
        this.typing = event.round > 1 ? `Modell wertet Ergebnisse aus (Runde ${event.round})` : "Modell denkt nach";
        break;
      case "tool_call":
        this.typing = `Rufe ${event.name} auf`;
        this.add({ kind: "tool", name: event.name, args: event.arguments, write: event.write, status: "running" });
        return;
      case "tool_result": {
        const open = [...this.items].reverse().find((item) => item.kind === "tool" && item.name === event.name && item.status === "running");
        if (open) { open.status = event.ok ? "ok" : "failed"; open.preview = event.preview; }
        else this.items.push({ kind: "tool", name: event.name, args: {}, status: event.ok ? "ok" : "failed", preview: event.preview });
        this.typing = "Modell denkt nach";
        break;
      }
      case "approval_required":
        this.typing = "Wartet auf deine Freigabe";
        this.add({ kind: "approval", runId: this.running && this.running.runId, approvalId: event.approval_id,
                   name: event.name, args: event.arguments, state: "pending", deadline: Date.now() + event.timeout * 1000 });
        if (app.view !== "chat") this.openBubble();
        return;
      case "approval_resolved": {
        const approval = this.items.find((item) => item.kind === "approval" && item.approvalId === event.approval_id);
        if (approval) approval.state = event.approved ? "approved" : event.reason === "timeout" ? "timeout" : "rejected";
        this.typing = event.approved ? "Führe aus" : "";
        break;
      }
      case "files_saved":
        this.add({ kind: "files", files: event.files || [] });
        return;
      case "answer":
        this.typing = "";
        this.add({ kind: "assistant", text: event.content });
        return;
      case "error":
        this.typing = "";
        this.add({ kind: "error", text: event.message });
        return;
      case "done":
        this.typing = "";
        if (event.status === "cancelled") this.items.push({ kind: "note", text: "Anfrage abgebrochen." });
        this.running = null;
        break;
      default:
        return;
    }
    this.persist();
    this.render();
  },

  async decide(item, approved) {
    if (item.state !== "pending") return;
    item.state = approved ? "sending-yes" : "sending-no";
    this.render();
    try {
      await api(`/api/chat/${encodeURIComponent(item.runId)}/approve`, { method: "POST", body: { approval_id: item.approvalId, approved } });
    } catch (error) {
      item.state = "expired";
      this.items.push({ kind: "error", text: `Freigabe nicht übernommen: ${error.message}` });
    }
    this.persist();
    this.render();
  },

  async stop() {
    if (!this.running) return;
    try { await api(`/api/chat/${encodeURIComponent(this.running.runId)}/cancel`, { method: "POST" }); }
    catch (error) { this.add({ kind: "error", text: error.message }); }
  },

  clear() {
    if (this.running) return;
    this.items = [];
    this.persist();
    this.render();
  },

  openBubble() {
    $("#bubble-panel").hidden = false;
    $("#bubble-button").setAttribute("aria-expanded", "true");
    this.markSeen();
    this.scrollDown();
    this.focus("bubble");
  },

  closeBubble() {
    $("#bubble-panel").hidden = true;
    $("#bubble-button").setAttribute("aria-expanded", "false");
  },

  tickCountdowns() {
    for (const node of $$(".countdown[data-deadline]")) {
      const seconds = Math.max(0, Math.round((Number(node.dataset.deadline) - Date.now()) / 1000));
      node.textContent = seconds > 0 ? `läuft ab in ${seconds} s` : "abgelaufen";
    }
  },

  renderItem(item) {
    if (item.kind === "user" || item.kind === "assistant") {
      return el("div", { class: `msg ${item.kind}` }, item.kind === "assistant" ? renderRichText(item.text) : item.text);
    }
    if (item.kind === "error") return el("div", { class: "msg error" }, item.text);
    if (item.kind === "note") return el("div", { class: "msg note" }, item.text);
    if (item.kind === "files") {
      return el("div", { class: "saved-files" }, "📄 Gespeichert unter Dateien: ",
        ...item.files.flatMap((file, index) => [index ? ", " : "",
          el("a", { href: "#files", onclick: (event) => { event.preventDefault(); showView("files"); } }, file.name)]));
    }
    if (item.kind === "tool") {
      const label = { running: "läuft", ok: "ok", failed: "fehlgeschlagen" }[item.status] || item.status;
      return el("div", { class: `tool${item.write ? " write" : ""}${item.status === "failed" ? " failed" : ""}` },
        el("details", {},
          el("summary", {}, `${item.write ? "✎" : "🔎"} ${item.name} – ${label}`),
          el("pre", {}, `Argumente: ${argsText(item.args)}`),
          item.preview ? el("pre", {}, `Ergebnis: ${item.preview}`) : null));
    }
    if (item.kind === "approval") {
      const pending = item.state === "pending";
      const stateText = {
        approved: "✓ Freigegeben", rejected: "✕ Abgelehnt", timeout: "⏱ Zeit abgelaufen – nicht ausgeführt",
        expired: "Nicht mehr offen", "sending-yes": "Sende Freigabe …", "sending-no": "Sende Ablehnung …",
      }[item.state];
      return el("div", { class: "approval" },
        el("h4", {}, "Freigabe erforderlich"),
        el("div", {}, "Das Modell möchte folgende Aktion ausführen:"),
        el("pre", {}, `${item.name}\n${argsText(item.args)}`),
        pending
          ? el("div", { class: "actions" },
              el("button", { type: "button", class: "danger small", onclick: () => this.decide(item, true) }, "Ausführen"),
              el("button", { type: "button", class: "secondary small", onclick: () => this.decide(item, false) }, "Ablehnen"),
              el("span", { class: "countdown", dataset: { deadline: String(item.deadline) } }, ""))
          : el("div", { class: "muted" }, stateText));
    }
    return null;
  },

  renderEmpty(name) {
    return el("div", { class: "empty" },
      el("p", {}, "Frag dein lokales Modell nach Zuständen, Geräten, Automationen oder Dashboards."),
      el("div", { class: "chips" }, ...STARTERS.slice(0, name === "bubble" ? 2 : 4)
        .map((text) => el("button", { type: "button", class: "chip", onclick: () => this.send(text, name) }, text))));
  },

  render() {
    for (const [name, view] of Object.entries(this.roots)) {
      const nodes = this.items.map((item) => this.renderItem(item)).filter(Boolean);
      if (!nodes.length && !this.typing) nodes.push(this.renderEmpty(name));
      if (this.typing) nodes.push(el("div", { class: "typing" }, this.typing));
      view.messages.replaceChildren(...nodes);
    }
    this.tickCountdowns();
    this.renderControls();
    this.renderBadge();
    this.scrollDown();
  },

  renderControls() {
    for (const view of Object.values(this.roots)) {
      const form = view.form;
      const toggle = form.elements.allow_write;
      toggle.checked = this.allowWrite;
      toggle.disabled = !this.writePermitted || Boolean(this.running);
      toggle.parentElement.classList.toggle("disabled", !this.writePermitted);
      toggle.parentElement.title = this.writePermitted
        ? "Das Modell darf Aktionen vorschlagen; jede Aktion musst du einzeln bestätigen"
        : "In den Einstellungen zuerst 'Steuern erlauben' aktivieren";
      $("button[type='submit']", form).disabled = Boolean(this.running);
      $("[data-action='stop']", form).hidden = !this.running;
      $("[data-action='clear']", form).disabled = Boolean(this.running);
    }
  },

  renderBadge() {
    const badge = $("#bubble-badge");
    const pending = this.items.some((item) => item.kind === "approval" && item.state === "pending");
    badge.hidden = !(this.unseen > 0 || pending);
    badge.textContent = pending ? "!" : String(this.unseen);
  },

  scrollDown() {
    for (const view of Object.values(this.roots)) view.messages.scrollTop = view.messages.scrollHeight;
  },
};

/* ---------------------------------------------------------------- boot */


/* ---------------------------------------------------------------- files */

function formatSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function fileUrl(item, download = false) {
  return `/api/files/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.name)}` + (download ? "?download=1" : "");
}

const fileManager = {
  items: [],

  init() {
    $("#file-viewer [data-action='file-close']").addEventListener("click", () => { $("#file-viewer").hidden = true; });
  },

  async load() {
    try {
      this.items = (await api("/api/files")).files || [];
      setResult($("#file-result"), "");
    } catch (error) {
      this.items = [];
      setResult($("#file-result"), error.message, "err");
    }
    this.render();
  },

  render() {
    const rows = this.items.map((item) => el("tr", {},
      el("td", {}, el("code", {}, item.name)),
      el("td", {}, item.kind === "plan" ? "Plan" : "Skript"),
      el("td", {}, formatSize(item.size)),
      el("td", {}, new Date(item.modified).toLocaleString("de-DE")),
      el("td", { class: "row-actions" },
        el("button", { type: "button", class: "ghost small", onclick: () => this.open(item) }, "Lesen"),
        el("a", { class: "button ghost small", href: fileUrl(item, true), download: item.name }, "Herunterladen"),
        el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, "Löschen"))));
    $("#file-rows").replaceChildren(...rows);
    $("#file-empty").hidden = this.items.length > 0;
    $("#file-table").hidden = this.items.length === 0;
  },

  async open(item) {
    try {
      const data = await api(fileUrl(item));
      $("#file-viewer-title").textContent = item.name;
      $("#file-content").textContent = data.content;
      $("#file-viewer").hidden = false;
      $("#file-viewer").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setResult($("#file-result"), error.message, "err");
    }
  },

  async remove(item) {
    if (!window.confirm(`Datei »${item.name}« endgültig löschen?`)) return;
    try {
      await api(fileUrl(item), { method: "DELETE" });
      if ($("#file-viewer-title").textContent === item.name) $("#file-viewer").hidden = true;
      await this.load();
      setResult($("#file-result"), `»${item.name}« gelöscht.`, "ok");
    } catch (error) {
      setResult($("#file-result"), error.message, "err");
    }
  },
};

/* ---------------------------------------------------------------- backups */

const backupPage = {
  init() {
    $("#view-backups [data-action='backups-reload']").addEventListener("click", () => this.load());
    $("#view-backups [data-action='backups-create']").addEventListener("click", (event) => this.create(event.currentTarget));
  },

  settings() {
    return (app.status && app.status.settings) || {};
  },

  async load() {
    const settings = this.settings();
    const createButton = $("#view-backups [data-action='backups-create']");
    createButton.disabled = !(settings.allow_write && settings.allow_admin_write);
    createButton.title = createButton.disabled ? "Braucht in den Einstellungen „Konfiguration ändern“" : "";
    setResult($("#backup-result"), "Lade …");
    try {
      const data = await api("/api/backups");
      this.render(data.backups || []);
      setResult($("#backup-result"), data.state && data.state !== "idle" ? `Home Assistant meldet: ${data.state}` : "");
    } catch (error) {
      this.render([]);
      setResult($("#backup-result"), error.message, "err");
    }
  },

  render(items) {
    const canDelete = Boolean(this.settings().allow_delete);
    const rows = items.map((item) => el("tr", {},
      el("td", {}, item.name || item.backup_id, item.protected ? " 🔒" : ""),
      el("td", {}, item.date ? new Date(item.date).toLocaleString("de-DE") : "–"),
      el("td", {}, typeof item.size === "number" ? formatBackupSize(item.size) : "–"),
      el("td", {}, (item.agents || []).join(", ")),
      el("td", { class: "row-actions" },
        el("a", { class: "button ghost small", href: `/api/backups/${encodeURIComponent(item.backup_id)}/download`,
                  download: "" }, "Herunterladen"),
        canDelete ? el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, "Löschen") : null)));
    $("#backup-rows").replaceChildren(...rows);
    $("#backup-empty").hidden = items.length > 0;
    $("#backup-table").hidden = items.length === 0;
  },

  async create(button) {
    const name = window.prompt("Name für das Backup:", `MCP ${new Date().toLocaleString("de-DE")}`);
    if (name === null) return;
    busy(button, true, "Erstelle Backup …");
    setResult($("#backup-result"), "Backup läuft, das kann einige Minuten dauern …");
    try {
      const result = await api("/api/backups", { method: "POST", body: { name } });
      if (result.completed) setResult($("#backup-result"), `Backup »${result.backup.name}« erstellt.`, "ok");
      else setResult($("#backup-result"), result.note || `Backup fehlgeschlagen (${result.reason || "unbekannt"}).`, "err");
      await this.load();
      if (result.completed) setResult($("#backup-result"), `Backup »${result.backup.name}« erstellt.`, "ok");
    } catch (error) {
      setResult($("#backup-result"), error.message, "err");
    } finally {
      busy(button, false);
    }
  },

  async remove(item) {
    if (!window.confirm(`Backup »${item.name}« endgültig löschen?`)) return;
    try {
      await api(`/api/backups/${encodeURIComponent(item.backup_id)}`, { method: "DELETE" });
      await this.load();
      setResult($("#backup-result"), `Backup »${item.name}« gelöscht.`, "ok");
    } catch (error) {
      setResult($("#backup-result"), error.message, "err");
    }
  },
};

function formatBackupSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return formatSize(bytes);
}

/* ---------------------------------------------------------------- audit log */

const auditLog = {
  init() {
    $("#view-audit [data-action='audit-reload']").addEventListener("click", () => this.load());
    $("#view-audit [data-action='audit-clear']").addEventListener("click", () => this.clear());
  },

  async load() {
    try {
      const data = await api("/api/audit");
      $("#audit-days").textContent = String(data.retention_days);
      this.render(data.entries || []);
      setResult($("#audit-result"), "");
    } catch (error) {
      this.render([]);
      setResult($("#audit-result"), error.message, "err");
    }
  },

  render(entries) {
    const rows = entries.map((entry) => el("tr", { class: entry.ok ? "" : "failed" },
      el("td", {}, new Date(entry.ts).toLocaleString("de-DE")),
      el("td", {}, entry.tool || "–"),
      el("td", {}, entry.kind === "tool" ? "Tool" : (entry.channel || "").toUpperCase()),
      el("td", {}, entry.route ? el("code", {}, `${entry.method || ""} ${entry.route}`.trim()) : "–"),
      el("td", {}, entry.status ? String(entry.status) : (entry.ok ? "ok" : (entry.error || "Fehler"))),
      el("td", {}, `${entry.ms} ms`)));
    $("#audit-rows").replaceChildren(...rows);
    $("#audit-empty").hidden = entries.length > 0;
    $("#audit-table").hidden = entries.length === 0;
  },

  async clear() {
    if (!window.confirm("Gesamtes Protokoll endgültig löschen?")) return;
    try {
      const result = await api("/api/audit", { method: "DELETE" });
      await this.load();
      setResult($("#audit-result"), `${result.deleted} Einträge gelöscht.`, "ok");
    } catch (error) {
      setResult($("#audit-result"), error.message, "err");
    }
  },
};

function initShell() {
  for (const tab of $$(".tab")) tab.addEventListener("click", () => showView(tab.dataset.view));
  for (const link of $$("[data-view-link]")) link.addEventListener("click", () => showView(link.dataset.viewLink));
  $("#view-home [data-action='recheck']").addEventListener("click", () => renderHome());
  $("#bubble-button").addEventListener("click", () => ($("#bubble-panel").hidden ? chat.openBubble() : chat.closeBubble()));
  $("#bubble [data-action='close-bubble']").addEventListener("click", () => chat.closeBubble());
  $("#bubble [data-action='expand']").addEventListener("click", () => { chat.closeBubble(); showView("chat"); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#bubble-panel").hidden) chat.closeBubble(); });
  window.addEventListener("hashchange", () => { const view = location.hash.slice(1); if (view) showView(view); });
}

async function boot() {
  initShell();
  wizard.init();
  initSettings();
  credentials.init();
  fileManager.init();
  backupPage.init();
  auditLog.init();
  chat.init();
  try {
    await refreshStatus();
  } catch (error) {
    $("#view-loading").replaceChildren(el("p", { class: "result err" }, `UI-Server nicht erreichbar: ${error.message}`));
    return;
  }
  if (!app.status.configured) {
    wizard.start(app.status.settings);
    showView("setup");
  } else {
    const wanted = location.hash.slice(1);
    showView(["home", "chat", "credentials", "backups", "files", "audit", "settings"].includes(wanted) ? wanted : "home");
  }
}

document.addEventListener("DOMContentLoaded", boot);
