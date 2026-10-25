"""The feature guide (English and German) describes every tool, and its screenshots exist."""
import asyncio
import re
from pathlib import Path

import pytest

from ha_safe_mcp.server import HAClient, create_server

DOCS = Path(__file__).resolve().parents[1] / "docs"
GUIDES = {"en": "FEATURES.md", "de": "FEATURES.de.md"}


@pytest.mark.parametrize("lang", GUIDES)
def test_every_tool_is_described_in_the_feature_guide(lang):
    guide = (DOCS / GUIDES[lang]).read_text(encoding="utf-8")
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    described = set(re.findall(r"^\| `(ha_[a-z_]+)` \|", guide, re.MULTILINE))
    assert names - described == set(), f"add these tools to docs/{GUIDES[lang]}"
    assert described - names == set(), "these tools no longer exist"


@pytest.mark.parametrize("lang", GUIDES)
def test_screenshots_exist_and_are_used(lang):
    guide = (DOCS / GUIDES[lang]).read_text(encoding="utf-8")
    referenced = set(re.findall(r"\]\((images/[^)]+\.png)\)", guide))
    on_disk = {f"images/{lang}/{p.name}" for p in (DOCS / "images" / lang).glob("*.png")}
    assert referenced and referenced <= on_disk, sorted(referenced - on_disk)
    assert on_disk <= referenced, f"unused screenshots: {sorted(on_disk - referenced)}"
    assert not list((DOCS / "images").glob("*.png")), "screenshots belong in images/en or images/de"


def test_every_document_links_its_other_language():
    pairs = [(DOCS.parent / "README.md", DOCS.parent / "README.de.md")]
    pairs += [(DOCS / f"{n}.md", DOCS / f"{n}.de.md") for n in ("USER_GUIDE", "INSTALL", "TECHNICAL", "FEATURES")]
    for english, german in pairs:
        assert f"**English** · [Deutsch]({german.name})" in english.read_text(encoding="utf-8")[:400], english.name
        assert f"**Deutsch** · [English]({english.name})" in german.read_text(encoding="utf-8")[:400], german.name
