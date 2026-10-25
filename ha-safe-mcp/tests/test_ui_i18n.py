"""The web UI is bilingual: English text, German next to it (data-de attributes in HTML, t(en, de) in scripts)."""
import re
from pathlib import Path

from ha_safe_mcp.web import STATIC

WEBUI = Path(__file__).resolve().parents[1] / "src" / "ha_safe_mcp" / "webui"
GERMAN = re.compile(r"[äöüÄÖÜß»«„“]")


def test_html_pages_are_english_with_german_only_in_data_de_attributes():
    for name in ("index.html", "oauth.html"):
        html = (WEBUI / name).read_text(encoding="utf-8")
        without_german = re.sub(r'\sdata-de(?:-[a-z-]+)?="[^"]*"', "", html)
        assert not GERMAN.search(without_german), (name, GERMAN.search(without_german))
        assert '<html lang="en">' in html
        assert html.index("/static/prefs.js") < html.index("/static/domains.js")  # t() exists before the others
        assert "data-lang=\"de\"" in html and "data-theme-toggle" in html


def test_scripts_keep_german_inside_t_calls():
    for name in ("app.js", "domains.js", "oauth.js"):
        lines = (WEBUI / name).read_text(encoding="utf-8").split("\n")
        for number, line in enumerate(lines):
            if GERMAN.search(line) and not line.lstrip().startswith(("//", "/*", "*")):
                context = "\n".join(lines[max(0, number - 8):number + 1])
                assert "t(" in context, f"{name}:{number + 1}: German text outside t(): {line.strip()}"


def test_prefs_script_is_served_and_english_is_the_default():
    assert "prefs.js" in STATIC
    prefs = (WEBUI / "prefs.js").read_text(encoding="utf-8")
    assert ': "en";' in prefs and "X-UI-Language" in prefs and "prefers-color-scheme" in prefs
