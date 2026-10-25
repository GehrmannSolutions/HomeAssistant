"""The feature guide describes every tool, and its screenshots exist."""
import asyncio
import re
from pathlib import Path

from ha_safe_mcp.server import HAClient, create_server

DOCS = Path(__file__).resolve().parents[1] / "docs"


def test_every_tool_is_described_in_the_feature_guide():
    guide = (DOCS / "FEATURES.md").read_text(encoding="utf-8")
    names = {t.name for t in asyncio.run(create_server(HAClient("http://ha:8123", "t")).list_tools())}
    described = set(re.findall(r"^\| `(ha_[a-z_]+)` \|", guide, re.MULTILINE))
    assert names - described == set(), "add these tools to docs/FEATURES.md"
    assert described - names == set(), "these tools no longer exist"


def test_screenshots_exist_and_are_used():
    guide = (DOCS / "FEATURES.md").read_text(encoding="utf-8")
    referenced = set(re.findall(r"\]\((images/[^)]+\.png)\)", guide))
    on_disk = {f"images/{p.name}" for p in (DOCS / "images").glob("*.png")}
    assert referenced and referenced <= on_disk, sorted(referenced - on_disk)
    assert on_disk <= referenced, f"unused screenshots: {sorted(on_disk - referenced)}"
