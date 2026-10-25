"use strict";
/* Language and appearance preferences, shared by every page. Loaded synchronously in <head> so the theme is set
   before the first paint and t() exists before the deferred scripts run.

   Language: English is the source text everywhere; German sits next to it (t("Save", "Speichern") in scripts,
   data-de / data-de-html / data-de-placeholder / data-de-title / data-de-aria-label in HTML). The choice is
   stored in localStorage and sent to the server as X-UI-Language, so server messages follow it too.

   Appearance: without a stored choice the page follows the system (prefers-color-scheme); the header toggle
   stores "light" or "dark"; Settings can go back to "system". */

const PREFS_LANG_KEY = "ha-mcp-lang";
const PREFS_THEME_KEY = "ha-mcp-theme";
const LANGUAGES = ["en", "de"];

function storedPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storePref(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage disabled: the choice lasts for this page only */ }
}

const LANG = LANGUAGES.includes(storedPref(PREFS_LANG_KEY)) ? storedPref(PREFS_LANG_KEY) : "en";
const LOCALE = LANG === "de" ? "de-DE" : "en-GB";

/** The text in the current UI language; English is the default and the fallback. */
function t(en, de) {
  return LANG === "de" && de !== undefined ? de : en;
}

const I18N_ATTRIBUTES = ["placeholder", "title", "aria-label"];

/** Swap the German texts into static markup (the page itself or a <template>'s content). */
function applyI18n(root = document) {
  if (LANG !== "de") return;
  for (const node of root.querySelectorAll("[data-de]")) node.textContent = node.dataset.de;
  // data-de-html only ever comes from our own static HTML files, never from data
  for (const node of root.querySelectorAll("[data-de-html]")) node.innerHTML = node.dataset.deHtml;
  for (const attribute of I18N_ATTRIBUTES) {
    for (const node of root.querySelectorAll(`[data-de-${attribute}]`)) {
      node.setAttribute(attribute, node.getAttribute(`data-de-${attribute}`));
    }
  }
}

function setLanguage(lang) {
  if (!LANGUAGES.includes(lang) || lang === LANG) return;
  storePref(PREFS_LANG_KEY, lang);
  location.reload(); // every view re-renders in the new language; the chat is kept in localStorage
}

/* ---------------------------------------------------------------- appearance */

const systemDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function themeChoice() {
  const value = storedPref(PREFS_THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function effectiveTheme() {
  const choice = themeChoice();
  if (choice !== "system") return choice;
  return systemDark && systemDark.matches ? "dark" : "light";
}

function applyTheme() {
  const root = document.documentElement;
  const choice = themeChoice();
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  root.style.colorScheme = effectiveTheme();
  for (const toggle of document.querySelectorAll("[data-theme-toggle]")) {
    const dark = effectiveTheme() === "dark";
    toggle.setAttribute("aria-checked", String(dark));
    toggle.title = dark ? t("Switch to light mode", "Zum hellen Design wechseln")
                        : t("Switch to dark mode", "Zum dunklen Design wechseln");
  }
  for (const select of document.querySelectorAll("[data-theme-select]")) select.value = choice;
}

function setTheme(choice) {
  storePref(PREFS_THEME_KEY, choice === "light" || choice === "dark" ? choice : null);
  applyTheme();
}

function initPrefControls() {
  for (const button of document.querySelectorAll("[data-lang]")) {
    const active = button.dataset.lang === LANG;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => setLanguage(button.dataset.lang));
  }
  for (const toggle of document.querySelectorAll("[data-theme-toggle]")) {
    toggle.addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
  }
  for (const select of document.querySelectorAll("[data-theme-select]")) {
    select.addEventListener("change", () => setTheme(select.value));
  }
  applyTheme();
}

document.documentElement.lang = LANG;
applyTheme();
if (systemDark && systemDark.addEventListener) systemDark.addEventListener("change", applyTheme);
document.addEventListener("DOMContentLoaded", () => {
  applyI18n(document);
  for (const template of document.querySelectorAll("template")) applyI18n(template.content);
  initPrefControls();
});
