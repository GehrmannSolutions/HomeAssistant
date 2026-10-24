"""Home Assistant domains for the UI: German labels and risk notes for the domain pickers and the docs.

A domain is the part of an entity ID before the dot (``light`` in ``light.living_room``). The allowed-domain list
limits which entities the control tools (``ha_call_service``, scene activation, script start) may target. The
notes mark domains whose actions have physical or security consequences; they are hints, not a block.
"""
from __future__ import annotations

# domain -> (label, risk note or None)
DOMAIN_INFO: dict[str, tuple[str, str | None]] = {
    "light": ("Licht", None),
    "switch": ("Schalter und Steckdosen", None),
    "fan": ("Ventilatoren", None),
    "climate": ("Heizung und Klima", None),
    "cover": ("Rollläden, Tore, Garagentore", "öffnet und schließt Tore und Garagentore"),
    "media_player": ("Mediaplayer", None),
    "scene": ("Szenen", None),
    "script": ("Skripte", "startet Skripte, die beliebige Aktionen enthalten können"),
    "automation": ("Automationen", "schaltet Automationen ein/aus oder löst sie aus"),
    "lock": ("Türschlösser", "öffnet Türen"),
    "alarm_control_panel": ("Alarmanlage", "schaltet die Alarmanlage scharf oder unscharf"),
    "valve": ("Ventile", "öffnet und schließt Wasser- oder Gasventile"),
    "siren": ("Sirenen", "löst Sirenen aus"),
    "update": ("Updates", "installiert Firmware- und Software-Updates"),
    "button": ("Tasten", "löst Gerätefunktionen aus, z. B. Neustart oder Werksreset"),
    "camera": ("Kameras", "schaltet Kameras und Aufnahmen"),
    "notify": ("Benachrichtigungen", "verschickt Nachrichten"),
    "water_heater": ("Warmwasser", None),
    "vacuum": ("Saugroboter", None),
    "lawn_mower": ("Mähroboter", None),
    "humidifier": ("Luftbefeuchter", None),
    "remote": ("Fernbedienungen", None),
    "number": ("Zahlenwerte von Geräten", None),
    "select": ("Auswahlwerte von Geräten", None),
    "text": ("Textwerte von Geräten", None),
    "input_boolean": ("Helfer: Schalter", None),
    "input_number": ("Helfer: Zahl", None),
    "input_select": ("Helfer: Auswahl", None),
    "input_text": ("Helfer: Text", None),
    "input_datetime": ("Helfer: Datum/Zeit", None),
    "input_button": ("Helfer: Taste", None),
    "counter": ("Zähler", None),
    "timer": ("Timer", None),
    "schedule": ("Zeitpläne", None),
    "calendar": ("Kalender", None),
    "todo": ("To-do-Listen", None),
    "sensor": ("Sensoren", None),
    "binary_sensor": ("Binärsensoren", None),
    "device_tracker": ("Geräteortung", None),
    "person": ("Personen", None),
    "zone": ("Zonen", None),
    "weather": ("Wetter", None),
    "sun": ("Sonne", None),
    "event": ("Ereignisse", None),
    "image": ("Bilder", None),
    "conversation": ("Sprachassistent", None),
    "tts": ("Sprachausgabe", None),
}


def summarize(states: list, services: list, allowed) -> list[dict]:
    """Entity domains of this HA (plus allowed ones that are missing), domains with actions first."""
    counts: dict[str, int] = {}
    for state in states if isinstance(states, list) else []:
        entity_id = state.get("entity_id") if isinstance(state, dict) else None
        if isinstance(entity_id, str) and "." in entity_id:
            domain = entity_id.split(".", 1)[0]
            counts[domain] = counts.get(domain, 0) + 1
    with_actions = {s.get("domain") for s in services if isinstance(s, dict)} if isinstance(services, list) else set()
    allowed = list(allowed or [])
    for domain in allowed:
        counts.setdefault(domain, 0)
    items = []
    for domain, count in counts.items():
        label, risk = DOMAIN_INFO.get(domain, (domain, None))
        items.append({"domain": domain, "label": label, "count": count, "actions": domain in with_actions,
                      "risk": risk, "allowed": domain in allowed})
    return sorted(items, key=lambda i: (not i["actions"], -i["count"], i["domain"]))
