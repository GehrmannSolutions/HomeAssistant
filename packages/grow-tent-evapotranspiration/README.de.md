# Pflanzen-Verdunstung fürs Growzelt

[English](README.md) · **Deutsch**

Ein Home-Assistant-Paket, das abschätzt, wie viel Wasser die Pflanzen in einem Growzelt (oder einem kleinen
Indoor-Gewächshaus) Stunde für Stunde verbrauchen und wann der Topf wieder Wasser braucht. Es überträgt die
FAO-56-Bewässerungsmethode, die in der Landwirtschaft mit einer Wetterstation genutzt wird, aufs Zelt: **die
Pflanzenlampe ist die Sonne, die Lüfter sind der Wind.** Außer einem Temperatur-/Feuchtesensor und einem PPFD-Sensor
(Lichtsensor) braucht es keine Hardware; ein Bodenfeuchtesensor macht den Gieß-Hinweis besser. Das Paket schaltet
nichts.

| Entität | Was sie zeigt |
|---|---|
| `sensor.grow_et_reference_evapotranspiration` | Referenz-Verdunstung ET0 jetzt (mm/h = Liter pro m² und Stunde) |
| `sensor.grow_et_water_use` | Wasserverbrauch der Pflanzen jetzt (ml/h) = Kc × ET0 × Kronenfläche |
| `sensor.grow_et_used_since_watering` | Summe davon seit dem letzten Druck auf *Grow ET watered* (L) |
| `sensor.grow_et_drip_since_watering` | Wasser, das eine optionale Tropfleitung seitdem gebracht hat (L) |
| `sensor.grow_et_depletion` | Wie viel vom nutzbaren Wasser im Topf verbraucht ist (L): + Verbrauch, − Tropf, − Gießen |
| `sensor.grow_et_pot_water` | Anteil des nutzbaren Wassers, der noch im Topf ist (%) |
| `binary_sensor.grow_et_water_hint` | An, wenn das Modell „nachfüllen“ sagt **und** der Bodenfeuchtesensor zustimmt (falls eine Marke gesetzt ist) |

## Was gerechnet wird

**1. Licht → Strahlung.** Ein PPFD-Sensor zählt Photonen (µmol/m²/s), die Formel braucht Energie (W/m²). Ein
Mikromol Photonen trägt umso weniger Energie, je länger die Wellenlänge ist: Photonen bei 450 nm ergeben 3,76 µmol
pro Joule, bei 660 nm 5,52 µmol pro Joule[5]. Ein Spektrum aus weißen und tiefroten LEDs liegt im Mittel bei etwa
600 nm, das ergibt rund **0,20 W/m² je µmol/m²/s** (Helfer `grow_et_w_per_umol`; 0,19–0,21 für die meisten
weiß-roten LEDs). Nicht den Sonnenlicht-Faktor nehmen: Für Sonnenlicht sind etwa 2,3 µmol pro Joule Globalstrahlung
der übliche Standardwert[6], weil die Hälfte der Sonnenenergie außerhalb des Photosynthese-Bereichs liegt. Im Zelt
ist die Lampe die einzige Quelle, daher ist die Nettostrahlung `Rn = (1 − 0,23) × PPFD × Faktor` mit der Albedo
0,23 der Referenzfläche[3]. Den Langwellen-Term von draußen (Wärmeverlust an den kalten Nachthimmel) lässt das
Paket bewusst weg: Zeltwände, Luft und Blätter liegen nur wenige Grad auseinander.

**2. Referenz-Verdunstung, stündlich.** Die FAO-56-Penman-Monteith-Gleichung für Stundenschritte[1] in der
standardisierten ASCE-Form:

```
ET0 = [0,408 Δ (Rn − G) + γ · 37/(T + 273) · u2 · (es − ea)] / [Δ + γ (1 + Cd · u2)]
```

mit Cn = 37 und Cd = **0,24 am Tag / 0,96 in der Nacht** für Stundenschritte[2] (die Tagesform nutzt 900 und
0,34 – Tageskonstanten mit Stundenwerten zu mischen ist ein häufiger Fehler), „Tag“ = jede Stunde mit positiver
Nettostrahlung[2], G = 0,1 Rn am Tag und 0,5 Rn in der Nacht, T Lufttemperatur, es − ea das Sättigungsdefizit aus
Temperatur und Luftfeuchte, u2 die Luftgeschwindigkeit (Helfer `grow_et_air_speed`, siehe Grenzen), γ für
101,3 kPa. Die ursprüngliche FAO-56-Stundenform rechnet jede Stunde mit einem Oberflächenwiderstand von 70 s/m[1];
das Python-Werkzeug rechnet mit diesen Konstanten das FAO-Rechenbeispiel nach (0,63 mm/h am Tag, 0,00 mm/h
nachts[1]).

**3. Wasserverbrauch der Pflanzen.** `ETc = Kc × ET0` je m² Krone, mal Kronenfläche (Helfer
`grow_et_canopy_area`: die Bodenfläche, die die Blätter überdecken, nicht das ganze Zelt). Kc-Werte: Tabelle unten.

**4. Wasserbilanz des Topfs.** Wie die Wurzelraum-Erschöpfung in FAO-56, für einen Topf: Die Erschöpfung wächst
jede Minute um den Verbrauch, sinkt durch eine optionale Tropfleitung (`binary_sensor.grow_tent_drip_running` ×
`grow_et_drip_rate`) und um die Gießmenge (`grow_et_watering_amount`, gebucht beim Druck auf
`input_button.grow_et_watered`) und bleibt zwischen 0 und dem nutzbaren Wasser des Topfs
(`grow_et_pot_available_water`). Der Hinweis geht an, wenn die Erschöpfung p × nutzbares Wasser erreicht
(`grow_et_depletion_fraction`, in FAO-56 der „Erschöpfungsanteil ohne Stress“[4]).

## Pflanzenfaktoren (Beispiele)

Aus FAO-56 Rev.1 (2025)[4], Tabelle 6.1 (Gemüse und Kräuter) und Tabelle 6.2 (Gartenbohne); p aus den Tabellen
8.1/8.2, dort für ETc ≈ 5 mm/Tag angegeben[4]. Kc Anfang = junge Pflanzen, Kc Mitte = volle Bedeckung und Hauptwachstum,
Kc Ende = Saisonende.

| Kultur | Kc Anfang | Kc Mitte | Kc Ende | p |
|---|---|---|---|---|
| Tomate, Frischmarkt | 0,60 | 1,10 | 1,00 | 0,40 |
| Tomate, Frischmarkt am Spalier | 0,60 | 1,15 | 0,90 | 0,40 |
| Paprika | 0,60 | 1,10 | 1,00 | 0,40 |
| Chili (*Capsicum annuum*) | 0,60 | 1,10 | 0,80 | 0,40 |
| Chili, Habanero (*Capsicum chinense*) | 0,60 | 1,15 | 0,75 | – |
| Gartenbohne, grüne Hülsen | 0,50 | 1,05 | 0,95 | 0,45 |
| Gurke, Frischmarkt | 0,60 | 1,00 | 0,75 | 0,45 |
| Salat | 0,70 | 1,05 | 1,05 | 0,30 |
| Erdbeeren | 0,50 | 0,80 | 0,75 | 0,25 |
| Basilikum | 0,60 | 1,05 | 1,00 | 0,30 |
| Petersilie | 0,60 | 1,00 | 0,90 | – |
| Grüne Minze | 0,50 | 1,00 | 0,95 | – |
| Ingwer | 0,60 | 1,00 | 0,65 | 0,30 |

Bei fruchtenden und blühenden Kulturen liegen die Werte zur Saisonmitte meist zwischen 1,0 und 1,15 (Erdbeeren
darunter) und fallen zum Ende ab. „–“ = für diese Anleitung kein Wert geprüft. Pilze fehlen absichtlich: Ein Pilz
hat keine Blätter, die Wasser abgeben, das Modell passt dafür nicht. Die Werte gelten fürs Freiland in einem
mittleren Standardklima – im Zelt sind sie ein **Startwert**, kein Ergebnis (siehe Grenzen).

## Einbau

1. Home Assistant muss Pakete laden, in der `configuration.yaml`:
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
2. `grow_tent_et.yaml` nach `config/packages/` kopieren und die fünf Platzhalter-Entitäten durch die eigenen
   ersetzen (Suchen und Ersetzen in der Datei):

   | Platzhalter | Dein Sensor | Nötig |
   |---|---|---|
   | `sensor.grow_tent_temperature` | Lufttemperatur im Zelt (°C) | ja |
   | `sensor.grow_tent_humidity` | relative Luftfeuchte im Zelt (%) | ja |
   | `sensor.grow_tent_ppfd` | PPFD an der Pflanze (µmol/m²/s), 0 bei Licht aus | ja |
   | `sensor.grow_tent_soil_moisture` | Bodenfeuchte (%) | für den Hinweis |
   | `binary_sensor.grow_tent_drip_running` | an, solange eine Tropfleitung den Topf versorgt | nur mit Tropf |

   Kein PPFD-Sensor? Ein Template-Sensor, der bei eingeschalteter Lampe deren PPFD an der Pflanze liefert und sonst
   0, geht auch (Wert aus der Lichtkarte im Datenblatt der Lampe für deine Hängehöhe).
3. *Entwicklerwerkzeuge → YAML → Konfiguration prüfen*, dann *Eingabe-Zahlen*, *Eingabe-Tasten* und
   *Template-Entitäten* neu laden (oder neu starten).
4. Die Helfer einstellen. Beispiel für ein Zelt mit 120 × 120 cm und einen 20-L-Topf unter einer weiß-roten LED:

   | Helfer | Beispiel | So findest du deinen Wert |
   |---|---|---|
   | `grow_et_canopy_area` | 0,5 m² | Bodenfläche unter den Blättern (Durchmesser² × 0,785 bei runder Krone); höchstens die 1,44 m² des Zelts |
   | `grow_et_kc` | 1,0 | Tabelle oben, je nach Stadium; später kalibrieren |
   | `grow_et_w_per_umol` | 0,20 | 0,19–0,21 für weiß-rote LEDs |
   | `grow_et_air_speed` | 0,4 m/s | leichte Brise eines Clip-Ventilators an den Blättern; 0,2 stille Luft, 1,0 kräftig |
   | `grow_et_pot_available_water` | 4,0 L | Topf direkt nach dem Gießen und Abtropfen wiegen und noch einmal, wenn er so trocken ist, wie du ihn höchstens werden lässt: Der Unterschied in kg ≈ Liter |
   | `grow_et_depletion_fraction` | 40 % | p aus der Tabelle (in %) |
   | `grow_et_watering_amount` | 2,0 L | was du üblicherweise gießt (was im Topf bleibt, ohne Ablauf) |
   | `grow_et_drip_rate` | 0 ml/h | nur mit Tropfleitung: messen, was sie in einer Stunde bringt |
   | `grow_et_soil_threshold` | 0 % (aus) | der Sensorwert, bei dem dein Fingertest „jetzt gießen“ sagt |

5. Einmal satt gießen und **Grow ET watered** drücken: ab dann läuft die Bilanz. Nach jedem Gießen drücken (eine
   Automation an deinem Gieß-Knopf oder Tagebuch kann das übernehmen).

Beispiel aus dem Python-Werkzeug: 25 °C, 45 % rF, 700 µmol/m²/s, Kc 1,0, 0,5 m², 0,4 m/s ergibt etwa **62 ml/h**
unter Licht und etwa 8 ml/h im Dunkeln bei 20 °C / 50 % – bei 18 Stunden Licht rund 1,2 L am Tag.

## Modell und Feuchtesensor zusammen

Beides nutzen. Das Modell kennt **Liter**, aber nicht, wo der Topf gestartet ist und wie weit die echte Pflanze vom
Lehrbuch-Kc abweicht. Ein Bodenfeuchtesensor weiß, **wie es um seine Sonde herum steht**, aber nicht, wie viele
Liter: Kapazitive Werte sind nicht linear, örtlich (eine Stelle im Topf) und verschieben sich mit der
Bodentemperatur. Ein steiler Abfall kann deshalb heißen, dass die Stelle an der Sonde austrocknet, während die
Pflanze so viel trinkt wie gestern. Der Hinweis braucht darum beides (sobald eine Sensormarke gesetzt ist); ohne
Marke entscheidet das Modell allein und das Attribut sagt das – dann von Hand prüfen.

## Kc kalibrieren

Einen Zeitraum von einem Gießen zum nächsten nehmen, an dessen Ende der Topf so trocken ist wie am Anfang (gleiches
Gewicht oder gleicher Sensorwert bei gleicher Bodentemperatur). Alles Wasser, das du in dieser Zeit gegeben hast
(plus Tropfleitung), haben die Pflanzen verbraucht. Temperatur, Luftfeuchte und PPFD stündlich mitschreiben (die
Langzeitstatistik von Home Assistant hält Stundenmittel) und rechnen:

```bash
python3 tool/grow_et.py --csv log.csv --area 0.5 --measured 4.2
```

Es gibt den Kc aus, der die gemessenen Liter trifft. An einem zweiten Zeitraum prüfen, bevor du ihm traust.

## Grenzen

- **FAO-56 ist fürs Freiland gemacht.** Laut FAO gilt die Methode, besonders die Referenz-Verdunstung, nicht für
  Gewächshäuser und anderen geschützten Anbau, weil Luftaustausch und Energiehaushalt dort anders sind[4]. Drinnen
  braucht der absolute Wert die Kalibrierung oben; der Verlauf (mehr unter Licht, mehr bei trockener Luft, wenig
  nachts) stimmt.
- **Die Luftgeschwindigkeit ist eine Annahme.** Lüfter melden meist nur an/aus; die Formel braucht die
  Luftbewegung an den Blättern.
- **Der PPFD-Sensor misst an einer Stelle.** Einen Wert nehmen, der für die ganze Krone steht.
- **Nacht:** Bei Licht aus gibt es keine Strahlung; nur trockene Luft treibt etwas Verdunstung an. Echte Pflanzen
  schließen nachts die meisten Spaltöffnungen, der Nachtwert des Modells ist eine Obergrenze.
- **Ablauf** (Wasser, das unten aus dem Topf läuft) sieht das Modell nicht: nur buchen, was im Topf bleibt.
- **Ein Modell, ein Topf, eine Sonde:** gut für „ungefähr wie viel und wann ungefähr“, nicht für ±0,1 L.

## Dateien

| Datei | Inhalt |
|---|---|
| [`grow_tent_et.yaml`](grow_tent_et.yaml) | Das Home-Assistant-Paket (Helfer, Template-Sensoren, Hinweis) |
| [`tool/grow_et.py`](tool/grow_et.py) | Dieselbe Rechnung in Python (nur Standardbibliothek): Einzelwerte, ein Tag aus einem CSV-Protokoll, Kc-Kalibrierung |
| [`tool/test_grow_et.py`](tool/test_grow_et.py) | Tests inkl. FAO-56-Beispiel 19: `cd tool && python3 -m unittest -v test_grow_et.py` |

Getestet mit Home Assistant 2026.11.2: Konfigurationsprüfung gültig, die Vorlage liefert für das Beispiel dieselben
62 ml/h wie das Python-Werkzeug, die Taste *Grow ET watered* setzt die Summen zurück, keine Log-Einträge.

## Quellen

- [1] https://www.fao.org/4/x0490e/x0490e08.htm — FAO Irrigation and Drainage Paper 56 (1998), Kapitel 4: Determination of ETo
- [2] https://mesonet.org/images/site/ASCE_Evapotranspiration_Formula.pdf — ASCE-EWRI (2005): The ASCE Standardized Reference Evapotranspiration Equation
- [3] https://www.fao.org/4/x0490e/x0490e06.htm — FAO Irrigation and Drainage Paper 56 (1998), Kapitel 2: FAO Penman-Monteith equation
- [4] https://doi.org/10.4060/cd6621en — FAO (2025): Crop evapotranspiration, FAO Irrigation and Drainage Paper 56 Rev.1
- [5] https://www.nature.com/articles/s41438-020-0283-7 — Kusuma, Pattison, Bugbee (2020): From physics to fixtures to food: current and potential LED efficacy. Horticulture Research 7:56
- [6] https://search.r-project.org/CRAN/refmans/bigleaf/html/Rg.to.PPFD.html — bigleaf (R-Paket): Rg.to.PPFD
