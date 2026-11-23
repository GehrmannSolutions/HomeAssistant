# Changelog

Grow tent evapotranspiration package. Entries in German, like the other changelogs of this repository.

## 0.1.0 – 2026-11-23

- **Neu:** Home-Assistant-Paket `grow_tent_et.yaml`, das den Wasserverbrauch von Pflanzen im Growzelt stündlich nach
  FAO-56/ASCE (Penman-Monteith, Stundenform: Cn 37, Cd 0,24 Tag / 0,96 Nacht) abschätzt. Die Pflanzenlampe ersetzt
  die Sonne (PPFD × 0,20 W/m² je µmol, einstellbar), eine angenommene Luftgeschwindigkeit den Wind. Dazu eine
  Wasserbilanz des Topfs (Erschöpfung in Litern, Tropfleitung optional, Taste „Grow ET watered“) und ein Gieß-Hinweis, der
  Modell und Bodenfeuchtesensor verknüpft. Eingaben über fünf Platzhalter-Entitäten und neun Helfer; nichts wird
  geschaltet.
- **Werkzeug:** `tool/grow_et.py` rechnet dasselbe in Python (Einzelwerte, Tagessumme aus einem CSV-Protokoll,
  Kc-Kalibrierung gegen gemessene Liter); `tool/test_grow_et.py` prüft u. a. das FAO-56-Rechenbeispiel 19.
- **Doku:** README auf Englisch und Deutsch mit Formeln, Pflanzenfaktoren aus FAO-56 Rev.1 (2025), Einbau,
  Kalibrierung, Grenzen und Quellen.
