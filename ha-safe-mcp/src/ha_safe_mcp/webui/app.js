"use strict";
/* HA Safe MCP web UI: first-run setup, overview, settings and one shared chat that is shown
   both as a full section and as a floating bubble. No framework, no inline code (CSP-safe);
   all dynamic text goes through textContent. */

const STORE_KEY = "ha-mcp-chat-v1";
const MAX_ITEMS = 120;
const STARTERS = t(
  ["Which lights are there?", "Show me all sensors with their values", "Which dashboards are there?",
   "Which input_boolean helpers are there?"],
  ["Welche Lichter gibt es?", "Zeig mir alle Sensoren mit ihren Werten", "Welche Dashboards gibt es?",
   "Welche Helfer vom Typ input_boolean gibt es?"]);

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
  const options = { method, headers: { "X-UI-Language": LANG } };
  if (method !== "GET") {
    options.headers["X-HA-MCP-UI"] = "1";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body || {});
  }
  const response = await fetch(path, options);
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error || t(`Error ${response.status}`, `Fehler ${response.status}`));
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
    button.textContent = label || t("Please wait …", "Bitte warten …");
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
  fitTabs();
  const activeTab = $(`.tab[data-view="${name}"]`);
  if (activeTab && configured) activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
  $("#bubble").hidden = !configured || name === "chat";
  if (name !== "setup" && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  if (name === "chat") { chat.markSeen(); chat.focus("main"); }
  if (name === "home") renderHome();
  if (name === "settings") fillSettings();
  if (name === "credentials") credentials.load();
  if (name === "files") fileManager.load();
  if (name === "backups") backupPage.load();
  if (name === "energy") energyPage.load();
  if (name === "changes") changePage.load();
  if (name === "clients") clientPage.load();
  if (name === "audit") auditLog.load();
}

function fitTabs() {
  const bar = $(".topbar");
  const tabs = $(".tabs");
  if (!bar || !tabs) return;
  bar.classList.remove("wrap-tabs");
  if (!tabs.hidden && tabs.scrollWidth > tabs.clientWidth + 1) bar.classList.add("wrap-tabs");
}

function renderModePill() {
  const pill = $("#mode-pill");
  const settings = app.status && app.status.settings;
  if (!settings || !app.status.configured) { pill.hidden = true; return; }
  const capped = app.status.max_level && app.status.max_level !== "full";
  let text = app.status.read_only ? t("Read only (fixed)", "Nur lesen (fest)") : t("Read only", "Nur lesen");
  if (settings.allow_delete) text = t("Delete allowed", "Löschen erlaubt");
  else if (settings.allow_admin_write) text = t("Configuration allowed", "Konfiguration erlaubt");
  else if (settings.allow_write) text = capped ? t("Control allowed (max.)", "Steuern erlaubt (max.)") : t("Control allowed", "Steuern erlaubt");
  if (settings.auto_write || settings.auto_admin_write || settings.auto_delete) text += t(" · partly without approval", " · teils ohne Freigabe");
  pill.textContent = text;
  pill.classList.toggle("write", Boolean(settings.allow_write));
  pill.hidden = false;
  fitTabs();
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
    select.append(el("option", { value: selected }, t(`${selected} (not found)`, `${selected} (nicht gefunden)`)));
  }
  for (const model of models) {
    const label = `${model.name} · ${model.size_gb} GB` + (model.tools === false ? t(" · no tool support", " · ohne Tool-Unterstützung") : "");
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
  busy(button, true, t("Loading models …", "Lade Modelle …"));
  try {
    const data = await api("/api/setup/test-ollama", { method: "POST", body: { ollama_url: url } });
    app.models = data.models || [];
    const current = form.elements.ollama_model.value || (app.status && app.status.settings.ollama_model);
    fillModelSelect(form.elements.ollama_model, app.models, current);
    if (!data.ok) setResult(result, data.message, "err");
    else if (!app.models.length) setResult(result, t("Ollama is running, but no model is installed (e.g. \"ollama pull qwen2.5-coder:7b\").",
                                            "Ollama läuft, aber es ist kein Modell installiert (z. B. »ollama pull qwen2.5-coder:7b«)."), "warn");
    else setResult(result, `${data.message} · ${app.models.length} ${t("model(s)", "Modell(e)")}`, "ok");
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
      if (app.status && app.status.read_only) {
        for (const box of [write, admin, del]) { box.checked = false; box.disabled = true; }
        return;
      }
      if (app.status && app.status.max_level === "control") {
        for (const box of [admin, del]) { box.checked = false; box.disabled = true; }
        return;
      }
      admin.disabled = !write.checked; if (!write.checked) admin.checked = false;
      del.disabled = !admin.checked; if (!admin.checked) del.checked = false;
    };
    for (const box of [write, admin, del]) box.addEventListener("change", sync);
    this.syncSwitches = sync;
    sync();
  },

  start(settings) {
    if (this.syncSwitches) this.syncSwitches();
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
    if (!body.token) { setResult(result, t("Please enter the token.", "Bitte den Token eintragen."), "err"); return; }
    busy(button, true, t("Checking …", "Prüfe …"));
    try {
      const check = await api("/api/setup/test-ha", { method: "POST", body });
      if (!check.ok) { setResult(result, check.message, "err"); return; }
      let text = check.message;
      if (check.location_name) text += ` · ${check.location_name}`;
      if (check.user) text += t(` · signed in as ${check.user}`, ` · angemeldet als ${check.user}`);
      setResult(result, text, "ok");
      this.data = { ...body, is_admin: check.is_admin };
      const adminBox = $("#step-3").elements.allow_admin_write;
      adminBox.title = check.is_admin === false ? t("This token does not belong to an admin user", "Dieser Token gehört zu keinem Admin-Benutzer") : "";
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
    if (!model) { setResult($(".result", form), t("Please choose a model.", "Bitte ein Modell wählen."), "err"); return; }
    this.data.ollama_url = form.elements.ollama_url.value.trim();
    this.data.ollama_model = model;
    this.go(3);
  },

  async save() {
    const form = $("#step-3");
    const result = $(".result", form);
    const button = $("button[type='submit']", form);
    if (form.elements.allow_admin_write.checked && this.data.is_admin === false) {
      setResult(result, t("Changing configuration needs a token with admin rights.", "Für Konfigurationsänderungen braucht der Token Admin-Rechte."), "err");
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
    busy(button, true, t("Saving …", "Speichere …"));
    try {
      const saved = await api("/api/setup", { method: "POST", body });
      this.data = {};
      $("#step-1").elements.token.value = "";
      await refreshStatus();
      const settings = saved.settings;
      $("#done-summary").textContent = t(`Connected to ${settings.ha_url}. Model: ${settings.ollama_model}. `,
                                         `Verbunden mit ${settings.ha_url}. Modell: ${settings.ollama_model}. `) +
        (settings.allow_write ? t("Actions are allowed and must be confirmed one by one in the chat.", "Aktionen sind erlaubt und müssen im Chat einzeln bestätigt werden.")
                              : t("Mode: read only.", "Modus: nur lesen."));
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
  fact(haFacts, t("Address", "Adresse"), settings.ha_url);
  fact(haFacts, "Status", t("checking …", "prüfe …"));
  fact(modelFacts, t("Model", "Modell"), settings.ollama_model);
  fact(modelFacts, "Ollama", settings.ollama_url);
  const perms = $("#perm-list");
  perms.replaceChildren(
    el("li", { class: "read" }, t("✓ Read", "✓ Lesen")),
    el("li", { class: settings.allow_write ? "on" : "off" }, (settings.allow_write ? "✓ " : "– ") + t("Control", "Steuern")),
    el("li", { class: settings.allow_admin_write ? "on" : "off" }, (settings.allow_admin_write ? "✓ " : "– ") + t("Change configuration", "Konfiguration ändern")),
    el("li", { class: settings.allow_delete ? "on" : "off" }, (settings.allow_delete ? "✓ " : "– ") + t("Delete", "Löschen")),
    el("li", { class: "off" }, `Domains: ${settings.allowed_domains.join(", ") || t("none", "keine")}`),
  );
  const chips = $("#start-chips");
  chips.replaceChildren(...STARTERS.map((text) => el("button", { type: "button", class: "chip", onclick: () => { showView("chat"); chat.send(text, "main"); } }, text)));
  try {
    const check = await api("/api/setup/test-ha", { method: "POST", body: { ha_url: settings.ha_url, token: "" } });
    haFacts.replaceChildren();
    fact(haFacts, t("Address", "Adresse"), settings.ha_url);
    fact(haFacts, "Status", check.ok ? t(`connected (${check.version})`, `verbunden (${check.version})`) : check.message);
    if (check.location_name) fact(haFacts, t("Home", "Zuhause"), check.location_name);
    if (check.user) fact(haFacts, t("Token of", "Token von"), check.user + (check.is_admin ? " (Admin)" : ""));
  } catch (error) {
    haFacts.lastChild.textContent = error.message;
  }
  try {
    const ollama = await api("/api/setup/test-ollama", { method: "POST", body: { ollama_url: settings.ollama_url } });
    const model = (ollama.models || []).find((item) => item.name === settings.ollama_model);
    fact(modelFacts, "Status", !ollama.ok ? ollama.message : model ? t(`ready (${model.size_gb} GB${model.tools ? ", tools" : ""})`, `bereit (${model.size_gb} GB${model.tools ? ", Tools" : ""})`) : t("model not installed", "Modell nicht installiert"));
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
  form.elements.auto_write.checked = Boolean(settings.auto_write);
  form.elements.auto_admin_write.checked = Boolean(settings.auto_admin_write);
  form.elements.auto_delete.checked = Boolean(settings.auto_delete);
  form.elements.allowed_domains.value = settings.allowed_domains.join(", ");
  window.domainPicker.reset();
  window.domainPicker.attach(form.elements.allowed_domains, { scope: "all" });
  fillModelSelect(form.elements.ollama_model, app.models, settings.ollama_model);
  if (!app.models.length) loadModels(form, $("[data-action='load-models']", form));
  syncSettingsSwitches();
  setResult($(".result", form), "");
}

function syncSettingsSwitches() {
  const form = $("#settings-form");
  const { allow_write: write, allow_admin_write: admin, allow_delete: del } = form.elements;
  const autos = [[write, form.elements.auto_write], [admin, form.elements.auto_admin_write], [del, form.elements.auto_delete]];
  const syncAutos = () => { for (const [allow, auto] of autos) { auto.disabled = !allow.checked || allow.disabled; if (auto.disabled) auto.checked = false; } };
  if (app.status && app.status.read_only) {
    for (const box of [write, admin, del]) { box.checked = false; box.disabled = true; }
    syncAutos();
    return;
  }
  write.disabled = false;
  if (app.status && app.status.max_level === "control") {
    for (const box of [admin, del]) { box.checked = false; box.disabled = true; }
    syncAutos();
    return;
  }
  admin.disabled = !write.checked; if (!write.checked) admin.checked = false;
  del.disabled = !admin.checked; if (!admin.checked) del.checked = false;
  syncAutos();
}

function initSettings() {
  const form = $("#settings-form");
  for (const name of ["allow_write", "allow_admin_write", "allow_delete"]) form.elements[name].addEventListener("change", syncSettingsSwitches);
  for (const name of ["auto_write", "auto_admin_write", "auto_delete"]) {
    form.elements[name].addEventListener("change", (event) => {
      if (event.target.checked && !window.confirm(t("Actions of this level then run right away without an approval card. Turn on?", "Aktionen dieser Stufe werden dann ohne Freigabe-Karte sofort ausgeführt. Einschalten?"))) event.target.checked = false;
    });
  }
  $("[data-action='load-models']", form).addEventListener("click", (event) => loadModels(form, event.currentTarget));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button[type='submit']", form);
    const body = {
      ha_url: form.elements.ha_url.value.trim(), token: form.elements.token.value.trim(),
      ollama_url: form.elements.ollama_url.value.trim(), ollama_model: form.elements.ollama_model.value,
      allow_write: form.elements.allow_write.checked, allow_admin_write: form.elements.allow_admin_write.checked,
      allow_delete: form.elements.allow_delete.checked, allowed_domains: domainsFrom(form.elements.allowed_domains.value),
      auto_write: form.elements.auto_write.checked, auto_admin_write: form.elements.auto_admin_write.checked,
      auto_delete: form.elements.auto_delete.checked,
    };
    busy(button, true, t("Checking and saving …", "Prüfe und speichere …"));
    try {
      await api("/api/settings", { method: "POST", body });
      form.elements.token.value = "";
      await refreshStatus();
      setResult($(".result", form), t("Saved. New chat requests use the new settings.", "Gespeichert. Neue Chat-Anfragen nutzen die neuen Einstellungen."), "ok");
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
      el("td", {}, new Date(item.updated * 1000).toLocaleString(LOCALE)),
      el("td", { class: "row-actions" },
        el("button", { type: "button", class: "ghost small", onclick: () => this.edit(item) }, t("Change", "Ändern")),
        el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, t("Delete", "Löschen")))));
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
    $("#cred-form-title").textContent = t("New credentials", "Neue Zugangsdaten");
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
    $("#cred-form-title").textContent = t(`Change credentials: ${item.alias}`, `Zugangsdaten ändern: ${item.alias}`);
    $("#cred-password-hint").textContent = t("(leave empty to keep the stored one)", "(leer lassen, um das gespeicherte zu behalten)");
    form.elements.username.placeholder = item.fields.includes("username") ? t("(stored; empty = keep)", "(gespeichert; leer = behalten)") : "";
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
    if (!Object.keys(fields).length) { setResult(result, t("Enter at least a user name or a password.", "Mindestens Benutzername oder Passwort angeben."), "err"); return; }
    busy(button, true, t("Saving …", "Speichere …"));
    try {
      const saved = await api("/api/credentials", { method: "POST",
        body: { alias: form.elements.alias.value.trim(), label: form.elements.label.value.trim(), fields } });
      this.reset();
      setResult($(".result", form), t(`Saved. In the chat: "${saved.credential.alias}".`, `Gespeichert. Im Chat: »${saved.credential.alias}«.`), "ok");
      await this.load();
    } catch (error) {
      setResult(result, error.message, "err");
    } finally {
      form.elements.password.value = "";
      busy(button, false);
    }
  },

  async remove(item) {
    if (!window.confirm(t(`Delete credentials "${item.alias}"? Integrations in Home Assistant keep their copy.`, `Zugangsdaten »${item.alias}« löschen? Integrationen in Home Assistant behalten ihre Kopie.`))) return;
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
    this.typing = t("Sending …", "Sende …");
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
          this.add({ kind: "note", text: t("The running request is no longer available (UI server restarted?).", "Die laufende Anfrage ist nicht mehr verfügbar (UI-Server neu gestartet?).") });
          break;
        }
        failures += 1;
        if (failures >= 4) {
          this.running = null; this.typing = "";
          this.add({ kind: "error", text: t("Lost the connection to the UI server.", "Verbindung zum UI-Server verloren.") });
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
        this.typing = event.round > 1 ? t(`Model is evaluating results (round ${event.round})`, `Modell wertet Ergebnisse aus (Runde ${event.round})`) : t("Model is thinking", "Modell denkt nach");
        break;
      case "tool_call":
        this.typing = t(`Calling ${event.name}`, `Rufe ${event.name} auf`);
        this.add({ kind: "tool", name: event.name, args: event.arguments, write: event.write, status: "running" });
        return;
      case "tool_result": {
        const open = [...this.items].reverse().find((item) => item.kind === "tool" && item.name === event.name && item.status === "running");
        if (open) { open.status = event.ok ? "ok" : "failed"; open.preview = event.preview; }
        else this.items.push({ kind: "tool", name: event.name, args: {}, status: event.ok ? "ok" : "failed", preview: event.preview });
        this.typing = t("Model is thinking", "Modell denkt nach");
        break;
      }
      case "approval_required":
        this.typing = t("Waiting for your approval", "Wartet auf deine Freigabe");
        this.add({ kind: "approval", runId: this.running && this.running.runId, approvalId: event.approval_id,
                   name: event.name, args: event.arguments, details: event.details || null, state: "pending",
                   deadline: Date.now() + event.timeout * 1000 });
        if (app.view !== "chat") this.openBubble();
        return;
      case "auto_approved":
        this.typing = t("Running (without approval)", "Führe aus (ohne Freigabe)");
        this.add({ kind: "approval", name: event.name, args: event.arguments, state: "auto", level: event.level });
        return;
      case "approval_resolved": {
        const approval = this.items.find((item) => item.kind === "approval" && item.approvalId === event.approval_id);
        if (approval) approval.state = event.approved ? "approved" : event.reason === "timeout" ? "timeout" : "rejected";
        this.typing = event.approved ? t("Running", "Führe aus") : "";
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
        if (event.status === "cancelled") this.items.push({ kind: "note", text: t("Request cancelled.", "Anfrage abgebrochen.") });
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
      this.items.push({ kind: "error", text: t(`Approval not accepted: ${error.message}`, `Freigabe nicht übernommen: ${error.message}`) });
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
      node.textContent = seconds > 0 ? t(`expires in ${seconds} s`, `läuft ab in ${seconds} s`) : t("expired", "abgelaufen");
    }
  },

  renderItem(item) {
    if (item.kind === "user" || item.kind === "assistant") {
      return el("div", { class: `msg ${item.kind}` }, item.kind === "assistant" ? renderRichText(item.text) : item.text);
    }
    if (item.kind === "error") return el("div", { class: "msg error" }, item.text);
    if (item.kind === "note") return el("div", { class: "msg note" }, item.text);
    if (item.kind === "files") {
      return el("div", { class: "saved-files" }, t("📄 Saved under Files: ", "📄 Gespeichert unter Dateien: "),
        ...item.files.flatMap((file, index) => [index ? ", " : "",
          el("a", { href: "#files", onclick: (event) => { event.preventDefault(); showView("files"); } }, file.name)]));
    }
    if (item.kind === "tool") {
      const label = { running: t("running", "läuft"), ok: "ok", failed: t("failed", "fehlgeschlagen") }[item.status] || item.status;
      return el("div", { class: `tool${item.write ? " write" : ""}${item.status === "failed" ? " failed" : ""}` },
        el("details", {},
          el("summary", {}, `${item.write ? "✎" : "🔎"} ${item.name} – ${label}`),
          el("pre", {}, `${t("Arguments", "Argumente")}: ${argsText(item.args)}`),
          item.preview ? el("pre", {}, `${t("Result", "Ergebnis")}: ${item.preview}`) : null));
    }
    if (item.kind === "approval") {
      const pending = item.state === "pending";
      const stateText = {
        approved: t("✓ Approved", "✓ Freigegeben"), auto: t("⚡ Run without approval (setting)", "⚡ Ohne Freigabe ausgeführt (Einstellung)"),
        rejected: t("✕ Rejected", "✕ Abgelehnt"), timeout: t("⏱ Timed out – not run", "⏱ Zeit abgelaufen – nicht ausgeführt"),
        expired: t("No longer open", "Nicht mehr offen"), "sending-yes": t("Sending approval …", "Sende Freigabe …"),
        "sending-no": t("Sending rejection …", "Sende Ablehnung …"),
      }[item.state];
      const auto = item.state === "auto";
      return el("div", { class: `approval${auto ? " auto" : ""}` },
        el("h4", {}, auto ? t("Action without approval", "Aktion ohne Freigabe") : t("Approval required", "Freigabe erforderlich")),
        el("div", {}, auto ? t("The model runs this action:", "Das Modell führt diese Aktion aus:") : t("The model wants to run this action:", "Das Modell möchte folgende Aktion ausführen:")),
        el("pre", {}, `${item.name}\n${argsText(item.args)}`),
        item.details && item.details.backup ? restoreSummary(item.details.backup, (item.args || {}).restore_database !== false) : null,
        item.details && item.details.device ? removalSummary(item.details) : null,
        item.details && item.details.repository ? hacsSummary(item.details, (item.args || {}).version) : null,
        pending
          ? el("div", { class: "actions" },
              el("button", { type: "button", class: "danger small", onclick: () => this.decide(item, true) }, t("Run", "Ausführen")),
              el("button", { type: "button", class: "secondary small", onclick: () => this.decide(item, false) }, t("Reject", "Ablehnen")),
              el("span", { class: "countdown", dataset: { deadline: String(item.deadline) } }, ""))
          : el("div", { class: "muted" }, stateText));
    }
    return null;
  },

  renderEmpty(name) {
    return el("div", { class: "empty" },
      el("p", {}, t("Ask your local model about states, devices, automations or dashboards.", "Frag dein lokales Modell nach Zuständen, Geräten, Automationen oder Dashboards.")),
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
        ? t("The model may propose actions; you confirm each one", "Das Modell darf Aktionen vorschlagen; jede Aktion musst du einzeln bestätigen")
        : t("First enable 'Allow control' in the settings", "In den Einstellungen zuerst 'Steuern erlauben' aktivieren");
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
      el("td", {}, item.kind === "plan" ? "Plan" : t("Script", "Skript")),
      el("td", {}, formatSize(item.size)),
      el("td", {}, new Date(item.modified).toLocaleString(LOCALE)),
      el("td", { class: "row-actions" },
        el("button", { type: "button", class: "ghost small", onclick: () => this.open(item) }, t("Read", "Lesen")),
        el("a", { class: "button ghost small", href: fileUrl(item, true), download: item.name }, t("Download", "Herunterladen")),
        el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, t("Delete", "Löschen")))));
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
    if (!window.confirm(t(`Delete file "${item.name}" for good?`, `Datei »${item.name}« endgültig löschen?`))) return;
    try {
      await api(fileUrl(item), { method: "DELETE" });
      if ($("#file-viewer-title").textContent === item.name) $("#file-viewer").hidden = true;
      await this.load();
      setResult($("#file-result"), t(`"${item.name}" deleted.`, `»${item.name}« gelöscht.`), "ok");
    } catch (error) {
      setResult($("#file-result"), error.message, "err");
    }
  },
};

/* ---------------------------------------------------------------- energy */

const SOURCE_LABELS = {
  grid_import: () => t("From the grid", "Aus dem Netz"), grid_export: () => t("To the grid", "Ins Netz"),
  solar: () => t("Solar", "Solar"), battery_charge: () => t("Battery charged", "Akku geladen"),
  battery_discharge: () => t("Battery discharged", "Akku entladen"), gas: () => t("Gas", "Gas"),
  water: () => t("Water", "Wasser"),
};

function energyBar(percent) {
  // the CSP blocks style attributes; setting the width through the CSSOM is allowed
  const bar = el("div", { class: "energy-bar" });
  bar.style.width = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  return bar;
}

const energyPage = {
  period: "today",

  init() {
    $$("#view-energy [data-period]").forEach((button) => button.addEventListener("click", () => {
      this.period = button.dataset.period;
      this.load();
    }));
  },

  settings() {
    return (app.status && app.status.settings) || {};
  },

  async load() {
    $$("#view-energy [data-period]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === this.period)));
    setResult($("#energy-result"), t("Loading …", "Lade …"));
    try {
      const data = await api(`/api/energy?period=${encodeURIComponent(this.period)}`);
      this.render(data);
      setResult($("#energy-result"), "");
    } catch (error) {
      this.render({ usage: { devices: [], sources: {} }, config: {}, candidates: [] });
      setResult($("#energy-result"), error.message, "err");
    }
  },

  render(data) {
    const usage = data.usage || {};
    const settings = this.settings();
    const canAdd = Boolean(settings.allow_write && settings.allow_admin_write);
    const canRemove = canAdd && Boolean(settings.allow_delete);
    const fmt = (value) => Number(value || 0).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
    const sources = Object.entries(usage.sources || {});
    $("#energy-sources").replaceChildren(...sources.map(([key, value]) => el("div", { class: "energy-source" },
      el("span", { class: "muted" }, (SOURCE_LABELS[key] || (() => key))()), el("strong", {}, `${fmt(value)} kWh`))));
    const configured = new Set(((data.config || {}).device_consumption || []).map((d) => d.stat_consumption));
    const devices = usage.devices || [];
    const top = Math.max(...devices.map((d) => d.kwh || 0), 0.001);
    $("#energy-rows").replaceChildren(...devices.map((device) => el("tr", {},
      el("td", {}, device.name, el("div", { class: "muted small" }, device.statistic)),
      el("td", { class: "num" }, fmt(device.kwh)),
      el("td", { class: "bar-col" }, energyBar(100 * (device.kwh || 0) / top)),
      el("td", { class: "row-actions" }, canRemove && configured.has(device.statistic)
        ? el("button", { type: "button", class: "secondary small", onclick: () => this.remove(device) }, t("Remove", "Herausnehmen"))
        : null))));
    $("#energy-table").hidden = devices.length === 0;
    const empty = $("#energy-empty");
    empty.hidden = devices.length > 0 && !usage.hint;
    empty.textContent = usage.hint
      ? t("The energy dashboard has no devices yet, so this shows every energy sensor with statistics.",
          "Im Energie-Dashboard sind noch keine Geräte, deshalb stehen hier alle Energiesensoren mit Statistik.")
      : t("No energy sensors with statistics found.", "Keine Energiesensoren mit Statistik gefunden.");
    if (devices.length === 0 && !usage.hint) empty.hidden = false;
    const broken = [];
    for (const key of ["energy_sources", "device_consumption", "device_consumption_water"]) {
      for (const item of (data.config || {})[key] || []) {
        for (const problem of item.problems || []) {
          broken.push(el("li", {}, el("strong", {}, item.name || item.stat_consumption || item.stat_energy_from || item.type || key), ": ",
            problem.hint || problem.type, problem.entities && problem.entities.length ? ` (${problem.entities.join(", ")})` : ""));
        }
      }
    }
    $("#energy-problems").replaceChildren(...(broken.length ? [
      el("h3", {}, t("Problems Home Assistant reports", "Probleme, die Home Assistant meldet")), el("ul", { class: "energy-problem-list" }, ...broken)] : []));
    const candidates = data.candidates || [];
    $("#energy-candidates-box").hidden = candidates.length === 0;
    $("#energy-candidates").replaceChildren(...candidates.map((sensor) => el("tr", {},
      el("td", {}, sensor.name || sensor.entity_id, el("div", { class: "muted small" }, sensor.entity_id)),
      el("td", { class: "num" }, `${sensor.state} ${sensor.unit || ""}`),
      el("td", { class: "row-actions" }, el("button", { type: "button", class: "primary small", disabled: canAdd ? null : "",
        title: canAdd ? "" : t("Needs \"Change configuration\" in the settings", "Braucht in den Einstellungen „Konfiguration ändern“"),
        onclick: () => this.add(sensor) }, t("Add", "Hinzufügen"))))));
  },

  async add(sensor) {
    const name = window.prompt(t("Name in the energy dashboard:", "Name im Energie-Dashboard:"), sensor.name || sensor.entity_id);
    if (name === null) return;
    try {
      const result = await api("/api/energy/devices", { method: "POST", body: { stat_consumption: sensor.entity_id, name } });
      await this.load();
      setResult($("#energy-result"), t(`Added. Undo on the Changes page (${result.change_id}).`,
                                       `Hinzugefügt. Rückgängig auf der Seite Änderungen (${result.change_id}).`), "ok");
    } catch (error) {
      setResult($("#energy-result"), error.message, "err");
    }
  },

  async remove(device) {
    if (!window.confirm(t(`Remove "${device.name}" from the energy dashboard? Its history stays.`,
                          `„${device.name}“ aus dem Energie-Dashboard nehmen? Der Verlauf bleibt erhalten.`))) return;
    try {
      const result = await api(`/api/energy/devices/${encodeURIComponent(device.statistic)}`, { method: "DELETE" });
      await this.load();
      setResult($("#energy-result"), t(`Removed. Undo on the Changes page (${result.change_id}).`,
                                       `Herausgenommen. Rückgängig auf der Seite Änderungen (${result.change_id}).`), "ok");
    } catch (error) {
      setResult($("#energy-result"), error.message, "err");
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
    createButton.title = createButton.disabled ? t("Needs \"Change configuration\" in the settings", "Braucht in den Einstellungen „Konfiguration ändern“") : "";
    setResult($("#backup-result"), t("Loading …", "Lade …"));
    try {
      const data = await api("/api/backups");
      this.render(data.backups || []);
      setResult($("#backup-result"), data.state && data.state !== "idle" ? t(`Home Assistant reports: ${data.state}`, `Home Assistant meldet: ${data.state}`) : "");
    } catch (error) {
      this.render([]);
      setResult($("#backup-result"), error.message, "err");
    }
  },

  render(items) {
    const canDelete = Boolean(this.settings().allow_delete);
    const rows = items.map((item) => el("tr", {},
      el("td", {}, item.name || item.backup_id, item.protected ? " 🔒" : ""),
      el("td", {}, item.date ? new Date(item.date).toLocaleString(LOCALE) : "–"),
      el("td", {}, typeof item.size === "number" ? formatBackupSize(item.size) : "–"),
      el("td", {}, (item.agents || []).join(", ")),
      el("td", { class: "row-actions" },
        el("a", { class: "button ghost small", href: `/api/backups/${encodeURIComponent(item.backup_id)}/download`,
                  download: "" }, t("Download", "Herunterladen")),
        canDelete ? el("button", { type: "button", class: "secondary small", disabled: item.protected ? "" : null,
                                   title: item.protected ? t("Encrypted: restore it in the chat with a stored password, or in Home Assistant",
                                                             "Verschlüsselt: im Chat mit gespeichertem Passwort oder in Home Assistant wiederherstellen") : "",
                                   onclick: (event) => this.restore(item, event.currentTarget) }, t("Restore", "Wiederherstellen")) : null,
        canDelete ? el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, t("Delete", "Löschen")) : null)));
    $("#backup-rows").replaceChildren(...rows);
    $("#backup-empty").hidden = items.length > 0;
    $("#backup-table").hidden = items.length === 0;
  },

  async create(button) {
    const name = window.prompt(t("Name of the backup:", "Name für das Backup:"), `MCP ${new Date().toLocaleString(LOCALE)}`);
    if (name === null) return;
    busy(button, true, t("Creating backup …", "Erstelle Backup …"));
    setResult($("#backup-result"), t("Backup running, this can take a few minutes …", "Backup läuft, das kann einige Minuten dauern …"));
    try {
      const result = await api("/api/backups", { method: "POST", body: { name } });
      if (result.completed) setResult($("#backup-result"), t(`Backup "${result.backup.name}" created.`, `Backup »${result.backup.name}« erstellt.`), "ok");
      else setResult($("#backup-result"), result.note || t(`Backup failed (${result.reason || "unknown"}).`, `Backup fehlgeschlagen (${result.reason || "unbekannt"}).`), "err");
      await this.load();
      if (result.completed) setResult($("#backup-result"), t(`Backup "${result.backup.name}" created.`, `Backup »${result.backup.name}« erstellt.`), "ok");
    } catch (error) {
      setResult($("#backup-result"), error.message, "err");
    } finally {
      busy(button, false);
    }
  },

  async restore(item, button) {
    const date = item.date ? new Date(item.date).toLocaleString(LOCALE) : "?";
    const question = [t(`Restore backup "${item.name}" from ${date}?`, `Backup »${item.name}« vom ${date} wiederherstellen?`), "",
                      ...restoreImpact(item, true).map((line) => `• ${line}`)].join("\n");
    if (!window.confirm(question)) return;
    busy(button, true, t("Restoring …", "Stelle wieder her …"));
    setResult($("#backup-result"), t("Safety backup, restore and restart are running; this can take several minutes …",
                                     "Sicherheits-Backup, Wiederherstellung und Neustart laufen; das kann einige Minuten dauern …"));
    try {
      const result = await api(`/api/backups/${encodeURIComponent(item.backup_id)}/restore`, { method: "POST", body: { restore_database: true } });
      const safety = result.safety_backup ? result.safety_backup.name || result.safety_backup.backup_id : "–";
      if (result.restored === true) {
        await this.load();
        setResult($("#backup-result"), t(`Restored "${item.name}". Safety backup of the previous state: "${safety}".`,
                                         `»${item.name}« wiederhergestellt. Sicherheits-Backup des vorherigen Stands: »${safety}«.`), "ok");
      } else {
        await this.load();
        setResult($("#backup-result"), result.note || result.reason || t("Restore failed.", "Wiederherstellung fehlgeschlagen."),
                  result.restored === null ? "warn" : "err");
      }
    } catch (error) {
      setResult($("#backup-result"), error.message, "err");
    } finally {
      busy(button, false);
    }
  },

  async remove(item) {
    if (!window.confirm(t(`Delete backup "${item.name}" for good?`, `Backup »${item.name}« endgültig löschen?`))) return;
    try {
      await api(`/api/backups/${encodeURIComponent(item.backup_id)}`, { method: "DELETE" });
      await this.load();
      setResult($("#backup-result"), t(`Backup "${item.name}" deleted.`, `Backup »${item.name}« gelöscht.`), "ok");
    } catch (error) {
      setResult($("#backup-result"), error.message, "err");
    }
  },
};

/* ---------------------------------------------------------------- change journal */

const CHANGE_KINDS = t({
  automation: "Automation", script: "Script", scene: "Scene", dashboard: "Dashboard",
  dashboard_config: "Dashboard views", helper: "Helper", entity: "Entity", area: "Area", floor: "Floor",
  device: "Device", integration: "Integration", label: "Label", category: "Category", zone: "Zone", file: "File",
  blueprint: "Blueprint", theme: "Theme", resource: "Dashboard resource",
}, {
  automation: "Automation", script: "Skript", scene: "Szene", dashboard: "Dashboard",
  dashboard_config: "Dashboard-Ansichten", helper: "Helfer", entity: "Entität", area: "Bereich", floor: "Etage",
  device: "Gerät", integration: "Integration", label: "Label", category: "Kategorie", zone: "Zone", file: "Datei",
  blueprint: "Blueprint", theme: "Theme", resource: "Dashboard-Ressource",
});

const changePage = {
  init() {
    $("#view-changes [data-action='changes-reload']").addEventListener("click", () => this.load());
  },

  async load() {
    setResult($("#change-result"), t("Loading …", "Lade …"));
    try {
      const data = await api("/api/changes");
      this.render(data.entries || []);
      setResult($("#change-result"), "");
    } catch (error) {
      this.render([]);
      setResult($("#change-result"), error.message, "err");
    }
  },

  render(items) {
    const settings = (app.status && app.status.settings) || {};
    const canUndo = Boolean(settings.allow_write && settings.allow_admin_write);
    const rows = items.map((item) => el("tr", {},
      el("td", {}, item.ts ? new Date(item.ts).toLocaleString(LOCALE) : "–"),
      el("td", {}, CHANGE_KINDS[item.kind] || item.kind, " · ", el("code", {}, item.tool || "")),
      el("td", {}, el("code", {}, item.target || "–")),
      el("td", {}, item.existed_before ? t("existed", "vorhanden") : t("newly created", "neu angelegt")),
      el("td", {}, item.undone_by ? t("undone", "rückgängig gemacht") : (item.undoes ? t("undo", "Rücknahme") : t("active", "aktiv"))),
      el("td", { class: "row-actions" },
        !item.undone_by && canUndo
          ? el("button", { type: "button", class: "ghost small", onclick: (event) => this.undo(item, event.currentTarget) }, t("Undo", "Rückgängig"))
          : null)));
    $("#change-rows").replaceChildren(...rows);
    $("#change-empty").hidden = items.length > 0;
    $("#change-table").hidden = items.length === 0;
  },

  async undo(item, button) {
    const label = t(`${CHANGE_KINDS[item.kind] || item.kind} "${item.target}"`, `${CHANGE_KINDS[item.kind] || item.kind} »${item.target}«`);
    if (!window.confirm(t(`${label}: undo the change of ${new Date(item.ts).toLocaleString(LOCALE)}?`,
                          `${label}: Änderung vom ${new Date(item.ts).toLocaleString(LOCALE)} rückgängig machen?`))) return;
    busy(button, true, "…");
    try {
      try {
        await api(`/api/changes/${encodeURIComponent(item.id)}/undo`, { method: "POST", body: {} });
      } catch (error) {
        if (!String(error.message).startsWith("newer changes")) throw error;
        if (!window.confirm(t(`${label} was changed again afterwards. Reset it to the state before this change anyway? `
                                + "The later changes are lost (they stay in the list).",
                              `${label} wurde danach noch einmal geändert. Trotzdem auf den Stand vor dieser Änderung `
                                + "zurücksetzen? Die späteren Änderungen gehen dabei verloren (sie bleiben in der Liste)."))) return;
        await api(`/api/changes/${encodeURIComponent(item.id)}/undo`, { method: "POST", body: { force: true } });
      }
      await this.load();
      setResult($("#change-result"), t(`${label}: previous state restored.`, `${label}: vorheriger Stand wiederhergestellt.`), "ok");
    } catch (error) {
      setResult($("#change-result"), error.message, "err");
    } finally {
      busy(button, false);
    }
  },
};

/* ---------------------------------------------------------------- remote MCP clients */

const CLIENT_LEVELS = t({ read: "Read only", control: "Control", admin: "Change configuration", delete: "Delete" },
                        { read: "Nur lesen", control: "Steuern", admin: "Konfiguration ändern", delete: "Löschen" });

const clientPage = {
  init() {
    $("#view-clients [data-action='clients-reload']").addEventListener("click", () => this.load());
    $("#client-form").addEventListener("submit", (event) => { event.preventDefault(); this.create(event.currentTarget); });
  },

  async load() {
    setResult($("#client-result"), t("Loading …", "Lade …"));
    try {
      const data = await api("/api/clients");
      this.endpoint = data.endpoint;
      $("#client-endpoint").textContent = data.endpoint;
      $("#client-instance-level").textContent = t(`currently at most ${CLIENT_LEVELS[data.instance_level] || data.instance_level}`, `zurzeit höchstens ${CLIENT_LEVELS[data.instance_level] || data.instance_level}`);
      this.render(data.clients || []);
      window.domainPicker.reset();
      window.domainPicker.attach($("#client-form").elements.domains, { scope: "allowed" });
      setResult($("#client-result"), "");
    } catch (error) {
      this.render([]);
      setResult($("#client-result"), error.message, "err");
    }
  },

  render(items) {
    const rows = items.map((item) => {
      const select = el("select", { "aria-label": t(`Level of ${item.name}`, `Stufe für ${item.name}`) },
        ...Object.entries(CLIENT_LEVELS).map(([value, label]) => el("option", { value, ...(value === item.level ? { selected: "" } : {}) }, label)));
      select.addEventListener("change", () => this.update(item, select.value));
      return el("tr", {},
        el("td", {}, item.name),
        el("td", {}, select),
        el("td", {}, CLIENT_LEVELS[item.effective_level] || item.effective_level),
        el("td", {}, (item.domains || []).length ? item.domains.join(", ") : t("all allowed", "alle erlaubten")),
        el("td", {}, item.last_used ? new Date(item.last_used).toLocaleString(LOCALE) : t("never", "noch nie")),
        el("td", { class: "row-actions" },
          el("button", { type: "button", class: "danger small", onclick: () => this.remove(item) }, t("Remove", "Entfernen"))));
    });
    $("#client-rows").replaceChildren(...rows);
    $("#client-empty").hidden = items.length > 0;
    $("#client-table").hidden = items.length === 0;
  },

  async create(form) {
    const data = new FormData(form);
    const domains = String(data.get("domains") || "").split(",").map((d) => d.trim()).filter(Boolean);
    try {
      const result = await api("/api/clients", { method: "POST", body: { name: data.get("name"), level: data.get("level"), domains } });
      form.reset();
      form.elements.domains.dispatchEvent(new Event("input"));
      const name = result.client.name;
      const slug = "ha-safe-mcp";
      $("#client-token-name").textContent = name;
      $("#client-token-value").textContent = result.token;
      $("#client-snippet-claude").textContent =
        `claude mcp add --transport http ${slug} ${result.endpoint} --header "Authorization: Bearer ${result.token}"`;
      $("#client-snippet-codex").textContent =
        `export HA_SAFE_MCP_TOKEN='${result.token}'\ncodex mcp add ${slug} --url ${result.endpoint} --bearer-token-env-var HA_SAFE_MCP_TOKEN`;
      $("#client-token").hidden = false;
      await this.load();
      setResult($("#client-result"), t(`Client "${name}" created. Copy the token now, it is not shown again.`, `Client »${name}« angelegt. Token jetzt kopieren, er wird nicht wieder angezeigt.`), "ok");
    } catch (error) {
      setResult($("#client-result"), error.message, "err");
    }
  },

  async update(item, level) {
    try {
      await api(`/api/clients/${encodeURIComponent(item.id)}`, { method: "POST", body: { level } });
      await this.load();
      setResult($("#client-result"), t(`"${item.name}": level ${CLIENT_LEVELS[level]}.`, `»${item.name}«: Stufe ${CLIENT_LEVELS[level]}.`), "ok");
    } catch (error) {
      setResult($("#client-result"), error.message, "err");
    }
  },

  async remove(item) {
    if (!window.confirm(t(`Remove client "${item.name}"? Its token stops working.`, `Client »${item.name}« entfernen? Sein Token funktioniert danach nicht mehr.`))) return;
    try {
      await api(`/api/clients/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      $("#client-token").hidden = true;
      await this.load();
      setResult($("#client-result"), t(`Client "${item.name}" removed.`, `Client »${item.name}« entfernt.`), "ok");
    } catch (error) {
      setResult($("#client-result"), error.message, "err");
    }
  },
};

/* What restoring a backup changes, in the UI language (approval card and backup page). */
function restoreImpact(backup, restoreDatabase) {
  const date = backup.date ? new Date(backup.date).toLocaleString(LOCALE) : "?";
  const database = restoreDatabase && backup.database_included !== false;
  return [
    t(`Home Assistant's configuration is replaced by the state of ${date}; every change since then is lost.`,
      `Die Konfiguration von Home Assistant wird auf den Stand vom ${date} zurückgesetzt; alle Änderungen seitdem gehen verloren.`),
    database ? t("The history database is replaced too.", "Die Verlaufsdatenbank wird ebenfalls ersetzt.")
             : t("The history database stays as it is.", "Die Verlaufsdatenbank bleibt, wie sie ist."),
    t("Users and access tokens created after the backup stop working.",
      "Benutzer und Zugriffstoken, die nach dem Backup angelegt wurden, funktionieren danach nicht mehr."),
    t("A safety backup of the current state is created first; restoring it undoes this.",
      "Vorher wird ein Sicherheits-Backup des aktuellen Stands angelegt; damit lässt sich das rückgängig machen."),
    t("Home Assistant restarts and is unavailable for a while.", "Home Assistant startet neu und ist eine Weile nicht erreichbar."),
  ];
}

function restoreSummary(backup, restoreDatabase) {
  const facts = [
    `${t("Backup", "Backup")}: ${backup.name || backup.backup_id}${backup.protected ? " 🔒" : ""}`,
    `${t("Date", "Datum")}: ${backup.date ? new Date(backup.date).toLocaleString(LOCALE) : "–"}`,
    `${t("Home Assistant version", "Home-Assistant-Version")}: ${backup.homeassistant_version || "–"}`,
    `${t("Contents", "Inhalt")}: ${[backup.homeassistant_included !== false ? t("configuration", "Konfiguration") : null,
                                   backup.database_included ? t("database", "Datenbank") : null].filter(Boolean).join(", ")}`
      + (typeof backup.size === "number" ? ` · ${formatBackupSize(backup.size)}` : ""),
  ];
  return el("div", { class: "restore-summary" },
    el("div", { class: "restore-facts" }, ...facts.map((line) => el("div", {}, line))),
    el("ul", {}, ...restoreImpact(backup, restoreDatabase).map((line) => el("li", {}, line))));
}

function removalSummary(preview) {
  // the card's plain-words preview for ha_remove_device (details read with ha_get_device_removal)
  const device = preview.device || {};
  const integration = preview.integration || {};
  const entities = preview.entities || [];
  const usedIn = preview.used_in || [];
  const connected = preview.connected_devices || [];
  const facts = [
    `${t("Device", "Gerät")}: ${device.name || device.device_id}${device.manufacturer ? ` (${device.manufacturer}${device.model ? ` ${device.model}` : ""})` : ""}`,
    `${t("Integration", "Integration")}: ${integration.title || integration.domain || "–"}`,
    `${t("Area", "Bereich")}: ${device.area_id || "–"}`,
  ];
  const impact = [
    entities.length === 1
      ? t(`This entity is removed with it: ${entities[0]}`, `Diese Entität wird mit entfernt: ${entities[0]}`)
      : entities.length
      ? t(`These ${entities.length} entities are removed with it: ${entities.join(", ")}`,
          `Diese ${entities.length} Entitäten werden mit entfernt: ${entities.join(", ")}`)
      : t("The device has no entities.", "Das Gerät hat keine Entitäten."),
    usedIn.length
      ? t(`Still used in: ${usedIn.map((u) => `${u.kind} "${u.name || u.id}" (${u.entity_id})`).join(", ")}; these stop working.`,
          `Noch verwendet in: ${usedIn.map((u) => `${u.kind} „${u.name || u.id}“ (${u.entity_id})`).join(", ")}; das funktioniert danach nicht mehr.`)
      : t("Its entities are not used in automations, scripts, scenes or dashboards.",
          "Seine Entitäten werden in keiner Automation, keinem Skript, keiner Szene und keinem Dashboard verwendet."),
    connected.length
      ? t(`Devices connected through it: ${connected.map((d) => d.name).join(", ")}`,
          `Darüber verbundene Geräte: ${connected.map((d) => d.name).join(", ")}`)
      : null,
    preview.can_remove === false ? `⚠ ${preview.reason}` : null,
    t("This cannot be undone by the MCP; names, areas and settings are lost, the history stays. The integration may add the device again when it finds it.",
      "Das lässt sich über den MCP nicht rückgängig machen; Namen, Bereiche und Einstellungen gehen verloren, der Verlauf bleibt. Die Integration kann das Gerät wieder anlegen, wenn sie es erneut findet."),
  ].filter(Boolean);
  return el("div", { class: "restore-summary" },
    el("div", { class: "restore-facts" }, ...facts.map((line) => el("div", {}, line))),
    el("ul", {}, ...impact.map((line) => el("li", {}, line))));
}

function hacsSummary(details, version) {
  // the card's plain-words preview for ha_install_hacs_repository (details read with ha_get_hacs_repository)
  const repo = details.repository || {};
  const kind = { plugin: t("dashboard card", "Dashboard-Karte"), integration: t("custom integration", "eigene Integration"),
                 theme: t("theme", "Theme") }[repo.category] || repo.category || "–";
  const target = version || repo.available_version || "–";
  const updated = repo.last_updated ? new Date(repo.last_updated).toLocaleDateString(LOCALE) : "–";
  const facts = [
    `${t("Repository", "Repository")}: ${repo.full_name || "–"} (${kind})`,
    `${t("Version", "Version")}: ${repo.installed ? `${repo.installed_version || "?"} → ${target}` : target}`
      + (repo.installed ? ` · ${t("update", "Update")}` : ` · ${t("new install", "neue Installation")}`),
    `${t("GitHub stars", "GitHub-Sterne")}: ${repo.stars ?? "–"} · ${t("last update", "zuletzt aktualisiert")}: ${updated}`,
  ];
  const impact = [
    t("Third-party code from GitHub; it runs with Home Assistant's rights.",
      "Code von Dritten aus GitHub; er läuft mit den Rechten von Home Assistant."),
    repo.category === "plugin"
      ? t("HACS registers the card as dashboard resource; reload the browser to use it.",
          "HACS trägt die Karte als Dashboard-Ressource ein; nach einem Neuladen des Browsers ist sie nutzbar.")
      : repo.category === "integration"
      ? t("Home Assistant must restart before the integration can be set up.",
          "Home Assistant muss neu starten, bevor die Integration eingerichtet werden kann.")
      : null,
    repo.can_download === false ? `⚠ ${t("HACS cannot download it for this Home Assistant version.",
                                         "HACS kann es für diese Home-Assistant-Version nicht herunterladen.")}` : null,
    repo.installed
      ? t("Undo goes back to the previous version.", "Rückgängig geht auf die vorige Version zurück.")
      : t("Undo removes it again (needs the Delete level).",
          "Rückgängig entfernt es wieder (braucht die Stufe Löschen)."),
  ].filter(Boolean);
  return el("div", { class: "restore-summary" },
    el("div", { class: "restore-facts" }, ...facts.map((line) => el("div", {}, line))),
    el("ul", {}, ...impact.map((line) => el("li", {}, line))));
}

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
      el("td", {}, new Date(entry.ts).toLocaleString(LOCALE)),
      el("td", {}, entry.tool || "–"),
      el("td", {}, entry.kind === "tool" ? "Tool" : (entry.channel || "").toUpperCase()),
      el("td", {}, entry.route ? el("code", {}, `${entry.method || ""} ${entry.route}`.trim()) : "–"),
      el("td", {}, entry.status ? String(entry.status) : (entry.ok ? "ok" : (entry.error || t("error", "Fehler")))),
      el("td", {}, `${entry.ms} ms`)));
    $("#audit-rows").replaceChildren(...rows);
    $("#audit-empty").hidden = entries.length > 0;
    $("#audit-table").hidden = entries.length === 0;
  },

  async clear() {
    if (!window.confirm(t("Delete the whole audit log for good?", "Gesamtes Protokoll endgültig löschen?"))) return;
    try {
      const result = await api("/api/audit", { method: "DELETE" });
      await this.load();
      setResult($("#audit-result"), t(`${result.deleted} entries deleted.`, `${result.deleted} Einträge gelöscht.`), "ok");
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
  window.addEventListener("resize", fitTabs);
  window.addEventListener("hashchange", () => { const view = location.hash.slice(1); if (view) showView(view); });
}

async function boot() {
  initShell();
  wizard.init();
  initSettings();
  credentials.init();
  fileManager.init();
  backupPage.init();
  energyPage.init();
  changePage.init();
  clientPage.init();
  auditLog.init();
  chat.init();
  try {
    await refreshStatus();
  } catch (error) {
    $("#view-loading").replaceChildren(el("p", { class: "result err" }, t(`UI server not reachable: ${error.message}`, `UI-Server nicht erreichbar: ${error.message}`)));
    return;
  }
  if (!app.status.configured) {
    wizard.start(app.status.settings);
    showView("setup");
  } else {
    const wanted = location.hash.slice(1);
    showView(["home", "chat", "credentials", "energy", "backups", "changes", "clients", "files", "audit", "settings"].includes(wanted) ? wanted : "home");
  }
}

document.addEventListener("DOMContentLoaded", boot);
