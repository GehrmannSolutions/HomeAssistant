"""Screenshots for docs/FEATURES.md from a throwaway web UI on a test Home Assistant.

Start a separate UI without --public-host (loopback only) against a *test* instance that has the demo home from
docs_demo_home.py, e.g. on port 18765, then:

    python scripts/doc_screenshots.py [--url http://127.0.0.1:18765/] [--lang en|de] <scenario> ... | all

Needs Playwright (pip install playwright pillow; playwright install chromium). Images go to docs/images/<lang>/ (English UI and prompts for the English docs, German for the German ones),
chat transcripts to $TMPDIR/doc_screenshots.json so the answers can be checked against Home Assistant.
"""
import json
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

import os
import tempfile

URL = "http://127.0.0.1:18765/"
IMAGES = Path(__file__).resolve().parents[1] / "docs" / "images"
LOG = Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "doc_screenshots.json"
ROOT = '[data-chat-root="main"]'


class UI:
    def __init__(self, page):
        self.page = page

    def view(self, name):
        self.page.click(f'.tab[data-view="{name}"]')
        self.page.wait_for_timeout(1500)

    def state(self):
        return self.page.evaluate(f"""() => {{ const root = document.querySelector('{ROOT}');
            const stop = root.querySelector('[data-action="stop"]');
            return {{running: !!stop && !stop.hidden,
                     pending: root.querySelectorAll('.approval button.danger').length,
                     text: root.querySelector('.messages').innerText}}; }}""")

    def wait(self, timeout=300):
        self.page.wait_for_timeout(2500)
        start = time.time()
        while time.time() - start < timeout:
            st = self.state()
            if st["pending"] or not st["running"]:
                self.page.wait_for_timeout(800)
                return self.state()
            self.page.wait_for_timeout(1500)
        return self.state()

    def ask(self, prompt, allow_write=False):
        self.view("chat")
        self.page.click(f'{ROOT} [data-action="clear"]')
        self.page.wait_for_timeout(800)
        box = self.page.locator(f'{ROOT} input[name="allow_write"]')
        if box.is_checked() != allow_write:
            box.click()
        self.page.fill(f"{ROOT} textarea", prompt)
        self.page.click(f'{ROOT} button[type="submit"]')
        return self.wait()

    def approve(self):
        self.page.click(f"{ROOT} .approval button.danger")
        return self.wait()

    def chat_shot(self, name):
        box = self.page.evaluate(f"""() => {{ const root = document.querySelector('{ROOT}');
            const m = root.querySelector('.messages'); m.scrollTop = 0;
            const last = m.children[m.children.length - 1];
            const r = root.getBoundingClientRect(); const lr = last.getBoundingClientRect();
            return {{x: r.left, y: r.top, width: r.width, height: Math.min(lr.bottom, r.bottom) - r.top + 16}}; }}""")
        self.page.screenshot(path=str(IMAGES / LANG / f"{name}.png"), clip=box)
        print("saved", name, int(box["width"]), int(box["height"]))

    def element_shot(self, name, selector, max_height=None):
        # The sticky header would cover the top of elements taller than the viewport.
        self.page.evaluate("document.querySelector('.topbar').style.position = 'static'")  # CSP blocks style tags
        self.page.locator(selector).first.screenshot(path=str(IMAGES / LANG / f"{name}.png"))
        image = Image.open(IMAGES / LANG / f"{name}.png")
        if max_height and image.size[1] > max_height:  # very long lists (audit log): keep the head of the page
            image.crop((0, 0, image.size[0], max_height)).save(IMAGES / LANG / f"{name}.png", optimize=True)
        size = Image.open(IMAGES / LANG / f"{name}.png").size
        print("saved", name, size)


def log(name, prompt, state):
    data = json.loads(LOG.read_text()) if LOG.exists() else {}
    data[f"{LANG}/{name}"] = {"prompt": prompt, "text": state["text"]}
    LOG.write_text(json.dumps(data, ensure_ascii=False, indent=1))


def chat(ui, name, prompt, allow_write=False, approve=False, card_name=None):
    st = ui.ask(prompt, allow_write)
    if card_name and st["pending"]:
        ui.chat_shot(card_name)
    while approve and st["pending"]:
        st = ui.approve()
    ui.chat_shot(name)
    log(name, prompt, st)
    print(name, "->", st["text"][-300:].replace("\n", " | "))


LANG = "en"


def P(en, de):  # noqa: N802 - prompt in the language of the run
    return de if LANG == "de" else en


SCENARIOS = {
    "overview": lambda ui: (ui.view("home"), ui.element_shot("01-overview", "#view-home")),
    "settings": lambda ui: (ui.view("settings"), ui.element_shot("02-settings", "#view-settings")),
    "read": lambda ui: chat(ui, "03-chat-read", P("Which lamps are in the living room (Wohnzimmer) and which are on?",
                                                  "Welche Lampen gibt es im Wohnzimmer und welche sind an?")),
    "switch": lambda ui: chat(ui, "05-chat-confirmed", P("Turn on the Stehlampe in the living room",
                                                        "Schalte die Stehlampe im Wohnzimmer aus"),
                              allow_write=True, approve=True, card_name="04-chat-approval"),
    "debug": lambda ui: chat(ui, "06-chat-debug", P("When and why did the automation Abendlicht last run?",
                                                   "Wann und warum ist die Automation Abendlicht zuletzt gelaufen?")),
    "files": lambda ui: chat(ui, "07-chat-config-file", P("Which files does configuration.yaml include?",
                                                         "Welche Dateien bindet die configuration.yaml ein?")),
    "label": lambda ui: chat(ui, "08-chat-label", P("Create a blue label 'Docs demo'", "Lege ein Label 'Doku-Demo' in Blau an"),
                             allow_write=True, approve=True, card_name="08a-chat-label-card"),
    "changes": lambda ui: (ui.view("changes"), ui.element_shot("09-changes", "#view-changes")),
    "weather": lambda ui: chat(ui, "10-chat-weather", P("What will the weather be like tomorrow?", "Wie wird das Wetter morgen?")),
    "history": lambda ui: chat(ui, "11-chat-history", P("When was the Stehlampe in the living room on today? Check the history.",
                                                       "Wann war die Stehlampe im Wohnzimmer heute an? Schau im Verlauf nach.")),
    "usages": lambda ui: chat(ui, "12-chat-usages", P("Which automations, scripts or dashboards use the Stehlampe?", "Wo wird die Stehlampe verwendet?")),
    "blocked": lambda ui: chat(ui, "13-chat-domain-blocked", P("Put milk on the shopping list", "Setze Milch auf die Einkaufsliste"),
                               allow_write=True, approve=True),
    "summary": lambda ui: chat(ui, "14-chat-summary", P("Give me a short overview of my Home Assistant.",
                                                       "Gib mir einen kurzen Überblick über mein Home Assistant.")),
    "credentials": lambda ui: (ui.view("credentials"), ui.element_shot("15-credentials", "#view-credentials")),
    "backups": lambda ui: (ui.view("backups"), ui.element_shot("16-backups", "#view-backups")),
    "clients": lambda ui: (ui.view("clients"), ui.element_shot("17-clients", "#view-clients")),
    "filemanager": lambda ui: (ui.view("files"), ui.element_shot("18-file-manager", "#view-files")),
    "audit": lambda ui: (ui.view("audit"), ui.element_shot("19-audit", "#view-audit", max_height=760)),
}


def main(names):
    (IMAGES / LANG).mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 1200},
                                      locale="de-DE" if LANG == "de" else "en-GB")
        context.add_init_script(f"localStorage.setItem('ha-mcp-lang', '{LANG}'); localStorage.setItem('ha-mcp-theme', 'light');")
        page = context.new_page()
        page.goto(URL)  # noqa: F821 - module global, may be set from --url
        page.wait_for_timeout(2500)
        ui = UI(page)
        for name in (SCENARIOS if names == ["all"] else names):
            try:
                SCENARIOS[name](ui)
            except Exception as exc:  # keep going, report
                print("FAILED", name, type(exc).__name__, str(exc)[:200])
        browser.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    while args[:1] in (["--url"], ["--lang"]):
        if args[0] == "--url":
            URL = args[1]
        else:
            LANG = args[1] if args[1] in ("en", "de") else "en"
        args = args[2:]
    main(args)
