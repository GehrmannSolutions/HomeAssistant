"use strict";
/* Domain picker shared by settings, MCP clients and the OAuth consent page. The text input stays the source of
   truth (and the fallback when Home Assistant is unreachable); the chips only read and write its value. */

window.domainPicker = (() => {
  let cache = null;

  function load() {
    if (!cache) {
      cache = fetch("/api/domains", { credentials: "same-origin", headers: { "X-UI-Language": LANG } }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || t(`Error ${response.status}`, `Fehler ${response.status}`));
        return data;
      });
      cache.catch(() => { cache = null; });
    }
    return cache;
  }

  const parse = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  /* scope "all": every domain of this HA that has actions (plus the allowed ones);
     scope "allowed": only the instance's allowed domains (clients can only narrow them). */
  async function attach(input, { scope = "all" } = {}) {
    const anchor = input.closest("label") || input;
    if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains("domain-picker")) {
      anchor.nextElementSibling.remove();
    }
    const box = node("div", "domain-picker");
    anchor.after(box);
    box.append(node("span", "muted small", t("Loading domains from Home Assistant …", "Lade Domains aus Home Assistant …")));
    let data;
    try {
      data = await load();
    } catch (error) {
      box.replaceChildren(node("span", "muted small", t(`Domains not available (${error.message}); please type them as text.`, `Domains nicht abrufbar (${error.message}); bitte als Text eintragen.`)));
      return;
    }
    let items = data.domains.filter((item) => item.actions || item.allowed);
    if (scope === "allowed") items = items.filter((item) => data.allowed.includes(item.domain));
    const known = new Set(items.map((item) => item.domain));
    for (const domain of parse(input.value)) {
      if (!known.has(domain)) items.push({ domain, label: domain, count: 0, actions: false, risk: null, missing: true });
    }
    const selected = new Set(parse(input.value));
    items.sort((a, b) => Number(selected.has(b.domain)) - Number(selected.has(a.domain)));
    if (!items.length) {
      box.replaceChildren(node("span", "muted small", scope === "allowed"
        ? t("No domains are allowed in the settings.", "In den Einstellungen sind keine Domains erlaubt.")
        : t("No controllable domains found.", "Keine schaltbaren Domains gefunden.")));
      return;
    }
    const boxes = [];
    const chips = items.map((item) => {
      const chip = node("label", `domain-chip${item.risk ? " risky" : ""}${item.missing ? " missing" : ""}`);
      const check = node("input");
      check.type = "checkbox";
      check.value = item.domain;
      boxes.push(check);
      chip.append(check, node("span", "", item.label));
      if (item.label !== item.domain) chip.append(node("code", "", item.domain));
      chip.append(node("span", "muted small", item.missing || !item.count ? t("no entities", "keine Entitäten") : String(item.count)));
      if (item.risk) {
        chip.title = t(`Caution: ${item.risk}`, `Achtung: ${item.risk}`);
        chip.append(node("span", "risk-note", `⚠ ${item.risk}`));
      }
      check.addEventListener("change", () => {
        const chosen = new Set(boxes.filter((b) => b.checked).map((b) => b.value));
        const kept = parse(input.value).filter((d) => chosen.has(d) || !boxes.some((b) => b.value === d));
        const added = boxes.filter((b) => b.checked && !kept.includes(b.value)).map((b) => b.value);
        input.value = [...kept, ...added].join(", ");
      });
      return chip;
    });
    const sync = () => {
      const current = new Set(parse(input.value));
      for (const check of boxes) check.checked = current.has(check.value);
    };
    input.addEventListener("input", sync);
    sync();
    const hint = node("p", "muted small domain-hint", scope === "allowed"
      ? t("No selection = all domains allowed in the settings.", "Keine Auswahl = alle in den Einstellungen erlaubten Domains.")
      : t("Number = entities in Home Assistant. ⚠ = actions with consequences for safety or the building, allow them consciously.",
          "Zahl = Entitäten in Home Assistant. ⚠ = Aktionen mit Folgen für Sicherheit oder Gebäude, nur bewusst freigeben."));
    box.replaceChildren(...chips, hint);
  }

  return { attach, reset() { cache = null; } };
})();
