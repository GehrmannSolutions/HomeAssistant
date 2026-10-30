"""Home Assistant domains for the UI: labels and risk notes (English and German) for the domain pickers and the docs.

A domain is the part of an entity ID before the dot (``light`` in ``light.living_room``). The allowed-domain list
limits which entities the control tools (``ha_call_service``, scene activation, script start) may target. The
notes mark domains whose actions have physical or security consequences; they are hints, not a block.
"""
from __future__ import annotations

from .i18n import ui_language

# domain -> (label, risk note or None) in English and German
DOMAIN_INFO: dict[str, dict[str, tuple[str, str | None]]] = {
    "light": {"en": ("Lights", None), "de": ("Licht", None)},
    "switch": {"en": ("Switches and sockets", None), "de": ("Schalter und Steckdosen", None)},
    "fan": {"en": ("Fans", None), "de": ("Ventilatoren", None)},
    "climate": {"en": ("Heating and climate", None), "de": ("Heizung und Klima", None)},
    "cover": {"en": ("Covers, gates, garage doors", "opens and closes gates and garage doors"), "de": ("Rollläden, Tore, Garagentore", "öffnet und schließt Tore und Garagentore")},
    "media_player": {"en": ("Media players", None), "de": ("Mediaplayer", None)},
    "scene": {"en": ("Scenes", None), "de": ("Szenen", None)},
    "script": {"en": ("Scripts", "starts scripts that can contain any action"), "de": ("Skripte", "startet Skripte, die beliebige Aktionen enthalten können")},
    "automation": {"en": ("Automations", "turns automations on/off or triggers them"), "de": ("Automationen", "schaltet Automationen ein/aus oder löst sie aus")},
    "lock": {"en": ("Door locks", "opens doors"), "de": ("Türschlösser", "öffnet Türen")},
    "alarm_control_panel": {"en": ("Alarm system", "arms or disarms the alarm system"), "de": ("Alarmanlage", "schaltet die Alarmanlage scharf oder unscharf")},
    "valve": {"en": ("Valves", "opens and closes water or gas valves"), "de": ("Ventile", "öffnet und schließt Wasser- oder Gasventile")},
    "siren": {"en": ("Sirens", "sounds sirens"), "de": ("Sirenen", "löst Sirenen aus")},
    "update": {"en": ("Updates", "installs firmware and software updates"), "de": ("Updates", "installiert Firmware- und Software-Updates")},
    "button": {"en": ("Buttons", "triggers device functions, e.g. restart or factory reset"), "de": ("Tasten", "löst Gerätefunktionen aus, z. B. Neustart oder Werksreset")},
    "camera": {"en": ("Cameras", "switches cameras and recordings"), "de": ("Kameras", "schaltet Kameras und Aufnahmen")},
    "notify": {"en": ("Notifications", "sends messages"), "de": ("Benachrichtigungen", "verschickt Nachrichten")},
    "water_heater": {"en": ("Water heaters", None), "de": ("Warmwasser", None)},
    "vacuum": {"en": ("Robot vacuums", None), "de": ("Saugroboter", None)},
    "lawn_mower": {"en": ("Robot mowers", None), "de": ("Mähroboter", None)},
    "humidifier": {"en": ("Humidifiers", None), "de": ("Luftbefeuchter", None)},
    "remote": {"en": ("Remotes", None), "de": ("Fernbedienungen", None)},
    "number": {"en": ("Device number values", None), "de": ("Zahlenwerte von Geräten", None)},
    "select": {"en": ("Device selections", None), "de": ("Auswahlwerte von Geräten", None)},
    "text": {"en": ("Device text values", None), "de": ("Textwerte von Geräten", None)},
    "input_boolean": {"en": ("Helper: toggle", None), "de": ("Helfer: Schalter", None)},
    "input_number": {"en": ("Helper: number", None), "de": ("Helfer: Zahl", None)},
    "input_select": {"en": ("Helper: dropdown", None), "de": ("Helfer: Auswahl", None)},
    "input_text": {"en": ("Helper: text", None), "de": ("Helfer: Text", None)},
    "input_datetime": {"en": ("Helper: date/time", None), "de": ("Helfer: Datum/Zeit", None)},
    "input_button": {"en": ("Helper: button", None), "de": ("Helfer: Taste", None)},
    "counter": {"en": ("Counters", None), "de": ("Zähler", None)},
    "timer": {"en": ("Timers", None), "de": ("Timer", None)},
    "schedule": {"en": ("Schedules", None), "de": ("Zeitpläne", None)},
    "calendar": {"en": ("Calendars", None), "de": ("Kalender", None)},
    "todo": {"en": ("To-do lists", None), "de": ("To-do-Listen", None)},
    "sensor": {"en": ("Sensors", None), "de": ("Sensoren", None)},
    "binary_sensor": {"en": ("Binary sensors", None), "de": ("Binärsensoren", None)},
    "device_tracker": {"en": ("Device trackers", None), "de": ("Geräteortung", None)},
    "person": {"en": ("Persons", None), "de": ("Personen", None)},
    "zone": {"en": ("Zones", None), "de": ("Zonen", None)},
    "weather": {"en": ("Weather", None), "de": ("Wetter", None)},
    "sun": {"en": ("Sun", None), "de": ("Sonne", None)},
    "event": {"en": ("Events", None), "de": ("Ereignisse", None)},
    "image": {"en": ("Images", None), "de": ("Bilder", None)},
    "conversation": {"en": ("Voice assistant", None), "de": ("Sprachassistent", None)},
    "tts": {"en": ("Text to speech", None), "de": ("Sprachausgabe", None)},
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
        info = DOMAIN_INFO.get(domain)
        label, risk = (info[ui_language.get()] if info else (domain, None))
        items.append({"domain": domain, "label": label, "count": count, "actions": domain in with_actions,
                      "risk": risk, "allowed": domain in allowed})
    return sorted(items, key=lambda i: (not i["actions"], -i["count"], i["domain"]))


# Device classes by the words people use for them, English and German (stems, matched inside the question's words),
# so "power", "Stromverbrauch" or "windows" find "Fernseher Leistung" or "Fenster Bad" by their kind.
DEVICE_CLASS_WORDS: dict[str, tuple[str, ...]] = {
    "power": ("power", "leistung", "watt", "strom", "verbrauch", "consumption"),
    "energy": ("energy", "energie", "kwh"),
    "temperature": ("temperatur",),
    "humidity": ("humid", "feuchte", "feuchtigkeit"),
    "window": ("window", "fenster"),
    "door": ("door", "tür", "tuer"),
    "garage_door": ("garage",),
    "battery": ("battery", "batterie", "akku"),
    "motion": ("motion", "bewegung"),
    "occupancy": ("occupancy", "presence", "anwesen", "präsenz"),
    "smoke": ("smoke", "rauch"),
    "moisture": ("moisture", "leak", "leck"),
    "illuminance": ("illuminance", "helligkeit", "lux"),
    "carbon_dioxide": ("co2", "kohlendioxid"),
    "shutter": ("shutter", "rollladen", "rollläden", "rolladen"),
    "blind": ("blind", "jalousie"),
}
