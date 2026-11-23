# Grow tent evapotranspiration

**English** · [Deutsch](README.de.md)

A Home Assistant package that estimates how much water the plants in a grow tent (or a small indoor greenhouse)
use, hour by hour, and when the pot is due for water. It adapts the FAO-56 irrigation method, which farmers use with
a weather station, to a tent: **the grow light is the sun, the fans are the wind.** It needs no extra hardware
beyond a temperature/humidity sensor and a PPFD (light) sensor; a soil moisture sensor makes the watering hint
better. Nothing in the package switches anything.

| Entity | What it shows |
|---|---|
| `sensor.grow_et_reference_evapotranspiration` | Reference evapotranspiration ET0 right now (mm/h = litres per m² and hour) |
| `sensor.grow_et_water_use` | Water the plants use right now (ml/h) = Kc × ET0 × canopy area |
| `sensor.grow_et_used_since_watering` | Sum of the above since you last pressed *watered* (L) |
| `sensor.grow_et_drip_since_watering` | Water an optional drip line added since then (L) |
| `sensor.grow_et_depletion` | How much of the pot's available water is used up (L): + use, − drip, − watering |
| `sensor.grow_et_pot_water` | Share of the available water still in the pot (%) |
| `binary_sensor.grow_et_water_hint` | On when the model says "refill" **and** the soil moisture sensor agrees (if you set a mark) |

## What it calculates

**1. Light → radiation.** A PPFD sensor counts photons (µmol/m²/s), the equation needs energy (W/m²). One micromole
of photons carries less energy the longer its wavelength: photons at 450 nm give 3.76 µmol per joule, photons at
660 nm give 5.52 µmol per joule[5]. A white + deep-red LED spectrum averages around 600 nm, which gives about
**0.20 W/m² per µmol/m²/s** (helper `grow_et_w_per_umol`; 0.19–0.21 for most white + red LEDs). Do not use the
sunlight factor: for sunlight about 2.3 µmol per joule of global radiation is the usual default[6], because half of
the sun's energy is outside the photosynthetic range. In a tent the light is the only source, so net radiation is
`Rn = (1 − 0.23) × PPFD × factor` with the reference surface's albedo of 0.23[3]. The outdoor long-wave term
(heat lost to a cold night sky) is left out on purpose: tent walls, air and leaves are within a few degrees.

**2. Reference evapotranspiration, hourly.** The FAO-56 Penman-Monteith equation for hourly time steps[1] in the
standardized ASCE form:

```
ET0 = [0.408 Δ (Rn − G) + γ · 37/(T + 273) · u2 · (es − ea)] / [Δ + γ (1 + Cd · u2)]
```

with Cn = 37 and Cd = **0.24 by day / 0.96 by night** for hourly steps[2] (the daily form uses 900 and 0.34 - mixing
daily constants with hourly data is a common mistake), "day" = any hour with positive net radiation[2], G = 0.1 Rn
by day and 0.5 Rn at night, T air temperature, es − ea the vapour pressure deficit from temperature and humidity,
u2 the air speed (helper `grow_et_air_speed`, see limits), γ for 101.3 kPa. The original FAO-56 hourly form keeps
one surface resistance of 70 s/m for every hour[1]; the Python tool reproduces FAO's worked example (0.63 mm/h by
day, 0.00 mm/h at night[1]) with those constants.

**3. Crop water use.** `ETc = Kc × ET0` per m² of canopy, times the canopy area (helper `grow_et_canopy_area`,
the floor area the leaves cover, not the whole tent). Kc values: table below.

**4. Pot water balance.** Like FAO-56's root zone depletion, for one pot: depletion grows by the water use every
minute, shrinks by an optional drip line (`binary_sensor.grow_tent_drip_running` × `grow_et_drip_rate`) and by the
amount you water (`grow_et_watering_amount`, booked when you press `input_button.grow_et_watered`), and stays
between 0 and the pot's available water (`grow_et_pot_available_water`). The hint turns on when depletion reaches
p × available water (`grow_et_depletion_fraction`, FAO-56's "depletion fraction for no stress"[4]).

## Crop coefficients (examples)

From FAO-56 Rev.1 (2025)[4], Table 6.1 (vegetables and herbs) and Table 6.2 (common bean); p from Tables 8.1/8.2,
given there for ETc ≈ 5 mm/day[4]. Kc ini = young plants, Kc mid = full cover and main growth,
Kc end = end of the season.

| Crop | Kc ini | Kc mid | Kc end | p |
|---|---|---|---|---|
| Tomato, fresh market | 0.60 | 1.10 | 1.00 | 0.40 |
| Tomato, fresh market on a trellis | 0.60 | 1.15 | 0.90 | 0.40 |
| Bell pepper | 0.60 | 1.10 | 1.00 | 0.40 |
| Chili pepper (*Capsicum annuum*) | 0.60 | 1.10 | 0.80 | 0.40 |
| Chili, habanero (*Capsicum chinense*) | 0.60 | 1.15 | 0.75 | – |
| Common bean, green | 0.50 | 1.05 | 0.95 | 0.45 |
| Cucumber, fresh market | 0.60 | 1.00 | 0.75 | 0.45 |
| Lettuce | 0.70 | 1.05 | 1.05 | 0.30 |
| Strawberries | 0.50 | 0.80 | 0.75 | 0.25 |
| Basil | 0.60 | 1.05 | 1.00 | 0.30 |
| Parsley | 0.60 | 1.00 | 0.90 | – |
| Spearmint | 0.50 | 1.00 | 0.95 | – |
| Ginger | 0.60 | 1.00 | 0.65 | 0.30 |

For fruiting and flowering crops the table's mid-season values lie mostly between 1.0 and 1.15 (strawberries are
lower) and drop towards the end of the season. "–" = no value checked for this README. Mushrooms are not in the table on purpose: a fungus has no
leaves that transpire, so this model does not fit it. These are open-field values for a standard sub-humid climate
- in a tent they are a **starting point**, not a result (see limits).

## Installation

1. Your Home Assistant must load packages: in `configuration.yaml`
   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```
2. Copy `grow_tent_et.yaml` into `config/packages/` and replace the five placeholder entity ids with your own
   (search and replace in the file):

   | Placeholder | Your sensor | Needed |
   |---|---|---|
   | `sensor.grow_tent_temperature` | air temperature in the tent (°C) | yes |
   | `sensor.grow_tent_humidity` | relative humidity in the tent (%) | yes |
   | `sensor.grow_tent_ppfd` | PPFD at the canopy (µmol/m²/s), 0 when the light is off | yes |
   | `sensor.grow_tent_soil_moisture` | soil moisture (%) | for the hint |
   | `binary_sensor.grow_tent_drip_running` | on while a drip line feeds the pot | only with a drip |

   No PPFD sensor? A template sensor that gives your light's PPFD at the canopy while it is on and 0 when it is off
   also works (take the value from the light's datasheet map at your hanging height).
3. *Developer tools → YAML → Check configuration*, then reload *Input numbers*, *Input buttons* and *Template
   entities* (or restart).
4. Set the helpers. Example for a 120 × 120 cm tent with one 20 L pot under a white + red LED:

   | Helper | Example | How to find yours |
   |---|---|---|
   | `grow_et_canopy_area` | 0.5 m² | floor area under the leaves (diameter² × 0.785 for a round canopy); at most the tent's 1.44 m² |
   | `grow_et_kc` | 1.0 | table above, stage of the plants; later: calibrate |
   | `grow_et_w_per_umol` | 0.20 | 0.19–0.21 for white + red LEDs |
   | `grow_et_air_speed` | 0.4 m/s | gentle breeze from a clip fan at the leaves; 0.2 still air, 1.0 strong |
   | `grow_et_pot_available_water` | 4.0 L | weigh the pot right after watering and draining, and again when it is as dry as you ever let it get: the difference in kg ≈ litres |
   | `grow_et_depletion_fraction` | 40 % | p from the table (as %) |
   | `grow_et_watering_amount` | 2.0 L | what you usually pour in (what stays in the pot, not the run-off) |
   | `grow_et_drip_rate` | 0 ml/h | only with a drip line: measure what it delivers in an hour |
   | `grow_et_soil_threshold` | 0 % (off) | the sensor reading at which your finger test says "water now" |

5. Water fully once and press **Grow ET watered**: from then on the balance runs. Press it after every watering
   (an automation on your watering button or diary can press it for you).

Example from the Python tool: 25 °C, 45 % RH, 700 µmol/m²/s, Kc 1.0, 0.5 m², 0.4 m/s gives about **62 ml/h**
under the light and about 8 ml/h in the dark at 20 °C / 50 % - roughly 1.2 L for an 18/6 light day.

## Model and moisture sensor together

Use both. The model knows **litres**, but not where the pot started and how far the real plant differs from the
textbook Kc. A soil moisture sensor knows **where the soil around its probe stands**, but not litres: capacitive
readings are non-linear, local (one spot in the pot) and shift with soil temperature, so a steep fall can be the
probe's spot drying out while the plant drinks as much as yesterday. The hint therefore needs both (once you set a
sensor mark); while no mark is set the model decides alone and the attribute says so - check by hand then.

## Calibrating Kc

Pick a span from one watering to the next in which the pot ends as dry as it started (same weight, or the same
sensor reading at the same soil temperature). All water you gave in that span (plus a drip line) is what the plants
used. Log temperature, humidity and PPFD hourly (Home Assistant's long-term statistics keep hourly means) and run:

```bash
python3 tool/grow_et.py --csv log.csv --area 0.5 --measured 4.2
```

It prints the Kc that matches the measured litres. Test it on a second span before you trust it.

## Limits

- **FAO-56 is made for open fields.** The FAO says its method, especially the reference ET, does not apply to
  greenhouses and other protected cultivation where aerodynamic and energy exchange differ[4]. Indoors the absolute
  value needs the calibration above; the shape (more under the light, more with dry air, little at night) holds.
- **Air speed is an assumption.** Fans usually report only on/off; the equation needs air speed at the leaves.
- **The PPFD sensor measures one spot.** Use a value that represents the canopy.
- **Night:** with the light off there is no radiation; only dry air drives a little water use. Real plants close most
  stomata at night, so the model's night value is an upper bound.
- **Drainage** (water that runs out of the pot) is not seen: book only what stays in the pot.
- **One model, one pot, one probe:** good for "about how much, and when roughly", not for ±0.1 L.

## Files

| File | Content |
|---|---|
| [`grow_tent_et.yaml`](grow_tent_et.yaml) | The Home Assistant package (helpers, template sensors, the hint) |
| [`tool/grow_et.py`](tool/grow_et.py) | The same math in Python (standard library): single values, a day from a CSV log, Kc calibration |
| [`tool/test_grow_et.py`](tool/test_grow_et.py) | Tests incl. FAO-56 Example 19: `cd tool && python3 -m unittest -v test_grow_et.py` |

Tested on Home Assistant 2026.11.2: configuration check valid, the template gives the same 62 ml/h as the Python tool
for the example, the *watered* button resets the sums, no log entries.

## Sources

- [1] https://www.fao.org/4/x0490e/x0490e08.htm — FAO Irrigation and Drainage Paper 56 (1998), Chapter 4: Determination of ETo
- [2] https://mesonet.org/images/site/ASCE_Evapotranspiration_Formula.pdf — ASCE-EWRI (2005): The ASCE Standardized Reference Evapotranspiration Equation
- [3] https://www.fao.org/4/x0490e/x0490e06.htm — FAO Irrigation and Drainage Paper 56 (1998), Chapter 2: FAO Penman-Monteith equation
- [4] https://doi.org/10.4060/cd6621en — FAO (2025): Crop evapotranspiration, FAO Irrigation and Drainage Paper 56 Rev.1
- [5] https://www.nature.com/articles/s41438-020-0283-7 — Kusuma, Pattison, Bugbee (2020): From physics to fixtures to food: current and potential LED efficacy. Horticulture Research 7:56
- [6] https://search.r-project.org/CRAN/refmans/bigleaf/html/Rg.to.PPFD.html — bigleaf (R package): Rg.to.PPFD
