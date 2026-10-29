"""Collapsible sections (expander-card) for sections-view dashboards: wrap, change default, unwrap."""
import copy

import pytest

from ha_safe_mcp.collapsible import has_expander, set_collapsible


def heading(text, **extra):
    return {"type": "heading", "heading": text, **extra}


def tile(entity, cols=None):
    card = {"type": "tile", "entity": entity}
    if cols:
        card["grid_options"] = {"columns": cols}
    return card


def dashboard():
    return {"views": [
        {"title": "Start", "path": "start", "type": "sections", "sections": [
            {"type": "grid", "cards": [heading("Raumklima", tap_action={"action": "navigate"}),
                                       tile("sensor.a"), tile("sensor.b"), tile("sensor.c", 12)]},
            {"type": "grid", "cards": [heading("Licht")] + [tile(f"light.l{i}") for i in range(4)]},
            {"type": "grid", "cards": [tile("sensor.no_heading")]},
        ]},
        {"title": "Alt", "path": "alt", "cards": [tile("sensor.x")]},
    ]}


def test_wraps_section_closed_and_keeps_heading_as_title():
    config, report = set_collapsible(dashboard(), "start", {"Raumklima": "closed"})
    section = config["views"][0]["sections"][0]
    assert len(section["cards"]) == 1
    exp = section["cards"][0]
    assert exp["type"] == "custom:expander-card" and exp["expanded"] is False
    assert exp["title-card"]["heading"] == "Raumklima" and "tap_action" not in exp["title-card"]
    # two half-width tiles share one row, the full-width tile stays alone
    assert exp["cards"][0] == {"type": "horizontal-stack", "cards": [tile("sensor.a"), tile("sensor.b")]}
    assert exp["cards"][1] == tile("sensor.c", 12)
    assert report["changed"] == [{"heading": "Raumklima", "now": "closed", "was": "off"}]


def test_uniform_section_flows_as_responsive_grid():
    config, _ = set_collapsible(dashboard(), "start", {"licht": "open"})  # heading match ignores case
    exp = config["views"][0]["sections"][1]["cards"][0]
    assert exp["expanded"] is True and exp["expander-card-display"] == "grid"
    assert [c["entity"] for c in exp["cards"]] == [f"light.l{i}" for i in range(4)]


def test_change_default_of_wrapped_section_and_unwrap_again():
    wrapped, _ = set_collapsible(dashboard(), "start", {"Raumklima": "closed"})
    opened, report = set_collapsible(wrapped, "start", {"Raumklima": "open"})
    assert opened["views"][0]["sections"][0]["cards"][0]["expanded"] is True
    assert report["changed"] == [{"heading": "Raumklima", "now": "open", "was": "closed"}]
    plain, report = set_collapsible(opened, "start", {"Raumklima": "off"})
    cards = plain["views"][0]["sections"][0]["cards"]
    assert cards[0] == heading("Raumklima")
    assert [c["entity"] for c in cards[1:]] == ["sensor.a", "sensor.b", "sensor.c"]
    assert report["changed"][0]["now"] == "off"


def test_unchanged_sections_are_reported_and_input_is_not_mutated():
    original = dashboard()
    before = copy.deepcopy(original)
    config, report = set_collapsible(original, "start", {"Raumklima": "off"})
    assert original == before and config == before
    assert report["changed"] == [] and report["unchanged"] == ["Raumklima"]


def test_unknown_heading_lists_available_ones_and_changes_nothing():
    with pytest.raises(ValueError) as exc:
        set_collapsible(dashboard(), "start", {"Raumklima": "closed", "Heizung": "closed"})
    assert "Heizung" in str(exc.value) and "Raumklima" in str(exc.value) and "Licht" in str(exc.value)


def test_view_by_title_or_index_and_errors():
    assert set_collapsible(dashboard(), "Start", {"Licht": "closed"})[1]["view"] == "start"
    assert set_collapsible(dashboard(), "0", {"Licht": "closed"})[1]["view"] == "start"
    with pytest.raises(ValueError, match="views: start, alt"):
        set_collapsible(dashboard(), "keller", {"Licht": "closed"})
    with pytest.raises(ValueError, match="sections"):
        set_collapsible(dashboard(), "alt", {"X": "closed"})
    with pytest.raises(ValueError, match="open, closed or off"):
        set_collapsible(dashboard(), "start", {"Licht": "zu"})
    with pytest.raises(ValueError):
        set_collapsible(dashboard(), "start", {})


def test_has_expander_checks_resources():
    assert has_expander([{"url": "/hacsfiles/lovelace-expander-card/expander-card.js"}])
    assert not has_expander([{"url": "/hacsfiles/mini-graph-card/mini-graph-card-bundle.js"}])
