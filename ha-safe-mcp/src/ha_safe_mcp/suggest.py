"""Names to suggest when a search or an entity_id matches nothing. Small models guess IDs (light.garage,
light.bathroom_light) and mistype names; a suggestion names what exists instead of leaving an empty answer.
A suggestion is never a licence to act on it: the hints around it say so."""
import difflib
import re

from .domains import translations

MIN_SCORE = 0.6         # difflib ratio; "garage" ~ "garten" 0.67, "stelampe" ~ "stehlampe" 0.94
MIN_WORD_SCORE = 0.75   # stricter for a translated word against a name ("bathroom" -> "bad" ~ "Bad")


def _ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def similar_entities(states, wanted: str, domain: str = "", n: int = 5) -> list[dict]:
    """Up to n entities whose ID or friendly name is close to `wanted` (a name or an entity_id), best first."""
    wanted = " ".join(str(wanted or "").casefold().split())
    if "." in wanted:
        given_domain, wanted = wanted.split(".", 1)
        domain = domain or given_domain
    phrase = wanted.replace("_", " ")
    words = [word for word in re.split(r"[\s_]+", phrase) if len(word) >= 3]
    translated = {t for w in [phrase, *words] for t in translations(w)}
    scored = []
    for item in states if isinstance(states, list) else []:
        entity_id = item.get("entity_id") if isinstance(item, dict) else None
        if not isinstance(entity_id, str) or "." not in entity_id or (domain and not entity_id.startswith(domain + ".")):
            continue
        attributes = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
        name = str(attributes.get("friendly_name") or "")
        object_id = entity_id.split(".", 1)[1]
        score = max(_ratio(wanted, object_id), _ratio(phrase, object_id.replace("_", " ")),
                    _ratio(phrase, name.casefold()))
        word_score = max((_ratio(t, name.casefold()) for t in translated), default=0.0)
        if score >= MIN_SCORE or word_score >= MIN_WORD_SCORE:
            scored.append((max(score, word_score), entity_id, name))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return [{"entity_id": entity_id, "friendly_name": name} for _, entity_id, name in scored[:n]]


def describe(suggestions: list[dict]) -> str:
    return ", ".join(f"{s['entity_id']} ({s['friendly_name']})" if s.get("friendly_name") else s["entity_id"]
                     for s in suggestions)
