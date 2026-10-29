"""Collapsible sections for sections-view dashboards.

A section of a sections view is a grid ``{"type": "grid", "cards": [<heading card>, card, ...]}``. To make it
collapsible, its cards are moved into the HACS card *Expander Card* (MelleD/lovelace-expander-card,
``custom:expander-card``): the heading stays the visible title, a double-arrow button on the right toggles, and the
whole title line is clickable. ``expanded`` is the default state on every page load (no remembered state).

- open / closed: wrap the section (or change the default of an already wrapped one);
- off: unwrap again (heading + cards; plain horizontal stacks, as built for the expander, are split again).

Cards inside the expander are stacked vertically, so the sections grid is rebuilt: cards that share a row (by their
grid column width, 12 = full) become a horizontal stack; sections whose cards all have the same width (e.g. 15 room
cards) flow as a responsive CSS grid instead. A navigate tap action on the heading is removed, because the title line
toggles. Pure functions: the server reads the dashboard, calls :func:`set_collapsible` and saves through the change
journal (undo).
"""
from __future__ import annotations

import copy

EXPANDER = "custom:expander-card"
STATES = {"open": True, "closed": False, "off": None}
# default widths of cards in a sections view (12 = full width)
DEFAULT_COLUMNS = {"tile": 6, "gauge": 6, "button": 3, "entity": 6, "sensor": 6, "picture-entity": 6,
                   "custom:mushroom-template-card": 6, "custom:mushroom-entity-card": 6}
MIN_CELL = {"area": 300, "tile": 170}  # px per cell for uniform sections


def has_expander(resources: list[dict]) -> bool:
    """True when the Expander Card is registered as a dashboard resource."""
    return any("expander-card" in str((item or {}).get("url", "")) for item in resources or [])


def _width(card: dict) -> int:
    cols = (card.get("grid_options") or {}).get("columns")
    if isinstance(cols, (int, float)) and not isinstance(cols, bool):
        return max(1, min(int(cols), 12))
    if cols == "full":
        return 12
    return DEFAULT_COLUMNS.get(str(card.get("type")), 12)


def _rows(cards: list[dict]) -> list[dict]:
    rows, row, used = [], [], 0
    for card in cards:
        width = _width(card)
        if row and used + width > 12:
            rows.append(row)
            row, used = [], 0
        row.append(card)
        used += width
    if row:
        rows.append(row)
    return [r[0] if len(r) == 1 else {"type": "horizontal-stack", "cards": r} for r in rows]


def _unrows(cards: list[dict]) -> list[dict]:
    """Undo _rows: plain horizontal stacks (only type + cards, as _rows builds them) become single cards again."""
    out = []
    for card in copy.deepcopy(cards):
        if isinstance(card, dict) and card.get("type") == "horizontal-stack" and set(card) == {"type", "cards"}:
            out.extend(card["cards"])
        else:
            out.append(card)
    return out


def _uniform(cards: list[dict]) -> bool:
    widths = {_width(card) for card in cards}
    return len(cards) >= 4 and len(widths) == 1 and next(iter(widths)) < 12


def _wrap(head: dict, body: list[dict], expanded: bool) -> dict:
    head = {key: value for key, value in head.items() if key != "tap_action"}
    extra = {}
    if _uniform(body):
        cell = MIN_CELL.get(str(body[0].get("type")), 170)
        extra = {"expander-card-display": "grid",
                 "style": ".children-container { grid-template-columns: repeat(auto-fill, minmax(%dpx, 1fr)); "
                          "gap: 0.6em; }" % cell}
    return {"type": EXPANDER, "title-card": head, "title-card-button-overlay": True, "title-card-clickable": True,
            "expanded": expanded, "icon": "mdi:chevron-double-right", "icon-rotate-degree": "90deg",
            "clear": True, "padding": "0", "child-margin-top": "0.6em", "expanded-gap": "0.6em",
            "cards": copy.deepcopy(body) if extra else _rows(copy.deepcopy(body)),
            "grid_options": {"columns": "full"}, **extra}


def _section_state(section: dict) -> tuple[str | None, str | None]:
    """(heading text, 'open'|'closed'|'off') of a section; heading None when it has no heading card."""
    cards = section.get("cards") or []
    first = cards[0] if cards and isinstance(cards[0], dict) else {}
    if first.get("type") == EXPANDER and len(cards) == 1:
        title = first.get("title-card") or {}
        text = title.get("heading") if title.get("type") == "heading" else None
        return text, "open" if first.get("expanded") else "closed"
    if first.get("type") == "heading":
        return first.get("heading"), "off"
    return None, None


def _apply(section: dict, state: str) -> dict:
    cards = section.get("cards") or []
    first = cards[0]
    if first.get("type") == EXPANDER:
        if state == "off":
            return {**section, "cards": [copy.deepcopy(first["title-card"])] + _unrows(first.get("cards") or [])}
        return {**section, "cards": [{**copy.deepcopy(first), "expanded": STATES[state]}]}
    return {**section, "cards": [_wrap(first, cards[1:], STATES[state])]}


def _find_view(config: dict, view: str) -> tuple[int, dict]:
    views = config.get("views") if isinstance(config, dict) else None
    if not isinstance(views, list) or not views:
        raise ValueError("dashboard has no views")
    names = [str(v.get("path") or v.get("title") or i) for i, v in enumerate(views)]
    wanted = str(view if view is not None else "").strip()
    for i, item in enumerate(views):
        if wanted.casefold() in (str(item.get("path", "")).casefold(), str(item.get("title", "")).casefold()):
            return i, item
    if wanted.isdigit() and int(wanted) < len(views):
        return int(wanted), views[int(wanted)]
    raise ValueError(f"unknown view '{wanted}'; views: {', '.join(names)}")


def set_collapsible(config: dict, view: str, sections: dict) -> tuple[dict, dict]:
    """Return (new dashboard config, report). sections: {heading text: 'open' | 'closed' | 'off'}.

    Raises ValueError (and changes nothing) for an unknown view, a view that is not a sections view, an unknown
    heading or an unknown state."""
    if not isinstance(sections, dict) or not sections:
        raise ValueError("sections: {\"<heading text>\": \"open\" | \"closed\" | \"off\"}, at least one")
    for heading, state in sections.items():
        if state not in STATES:
            raise ValueError(f"state for '{heading}' must be open, closed or off")
    index, item = _find_view(config, view)
    if item.get("type") != "sections" or not isinstance(item.get("sections"), list):
        raise ValueError("only views of type 'sections' have sections; this view is a masonry/panel view")
    present = {}
    for pos, section in enumerate(item["sections"]):
        heading, state = _section_state(section if isinstance(section, dict) else {})
        if isinstance(heading, str) and heading.strip():
            present.setdefault(heading.strip().casefold(), (pos, heading, state))
    unknown = [h for h in sections if str(h).strip().casefold() not in present]
    if unknown:
        available = ", ".join(h for _, h, _ in present.values()) or "none (sections need a heading card)"
        raise ValueError(f"no section with heading {', '.join(map(str, unknown))}; available: {available}")
    new = copy.deepcopy(config)
    target = new["views"][index]
    changed, unchanged = [], []
    for heading, state in sections.items():
        pos, title, was = present[str(heading).strip().casefold()]
        if was == state:
            unchanged.append(title)
            continue
        target["sections"][pos] = _apply(target["sections"][pos], state)
        changed.append({"heading": title, "now": state, "was": was})
    report = {"view": str(item.get("path") or item.get("title") or index), "changed": changed, "unchanged": unchanged}
    return new, report
