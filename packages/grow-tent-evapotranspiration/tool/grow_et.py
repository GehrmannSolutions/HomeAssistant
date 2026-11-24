"""Hourly evapotranspiration for a grow tent (FAO-56 / ASCE standardized hourly Penman-Monteith).

The same math as the Home Assistant package next to this file, as plain Python (standard library only), so you can
check values, compute a day from logged data, or calibrate the crop coefficient against water you measured.

    python3 grow_et.py --temp 25 --rh 45 --ppfd 700 --kc 1.0 --area 0.5 --air 0.4
    python3 grow_et.py --csv log.csv --kc 1.0 --area 0.5        # columns: time,temp,rh,ppfd (one row per hour)
    python3 grow_et.py --csv log.csv --area 0.5 --measured 4.2   # Kc that would give 4.2 L over the logged span

Sources and limits: README.md.
"""
import argparse
import csv
import math
import sys

H_C_NA = 119.627   # Planck constant x speed of light x Avogadro, in J nm per umol (energy of 1 umol photons x nm)


def sat_vapour_pressure(t):
    """FAO-56 Eq. 11: saturation vapour pressure (kPa) at air temperature t (degC)."""
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def slope_vapour_pressure(t):
    """FAO-56 Eq. 13: slope of the saturation vapour pressure curve (kPa/degC)."""
    return 4098 * sat_vapour_pressure(t) / (t + 237.3) ** 2


def psychrometric_constant(pressure_kpa=101.3):
    """FAO-56 Eq. 8 (kPa/degC)."""
    return 0.000665 * pressure_kpa


def joule_per_umol(wavelength_nm):
    """Energy of one micromole of photons at a wavelength (Planck): 450 nm -> 0.266 J, 600 nm -> 0.199 J."""
    return H_C_NA / wavelength_nm


def ppfd_to_shortwave(ppfd, w_per_umol=0.20):
    """Radiation (W/m2) at the canopy from PPFD (umol/m2/s). 0.20 suits white + red LEDs (mean photon ~600 nm)."""
    return max(ppfd, 0.0) * w_per_umol


def et0_hourly(temp, rh, rn_mj, wind, pressure_kpa=101.3, cn=37.0, cd=None, g=None):
    """Hourly short reference ET (mm/h), FAO-56 Eq. 53 / ASCE 2005 Eq. 1.

    rn_mj: net radiation in MJ/m2/h. cd: None = ASCE standardized (0.24 by day, 0.96 by night, day = rn > 0);
    pass 0.34 for the original FAO-56 hourly form. g: soil heat flux in MJ/m2/h, None = 0.1 rn by day, 0.5 rn by
    night (ASCE 2005 Eq. 65)."""
    delta = slope_vapour_pressure(temp)
    gamma = psychrometric_constant(pressure_kpa)
    es = sat_vapour_pressure(temp)
    ea = es * rh / 100
    if cd is None:
        cd = 0.24 if rn_mj > 0 else 0.96
    if g is None:
        g = (0.1 if rn_mj > 0 else 0.5) * rn_mj
    num = 0.408 * delta * (rn_mj - g) + gamma * cn / (temp + 273) * wind * (es - ea)
    return num / (delta + gamma * (1 + cd * wind))


def tent_et0(temp, rh, ppfd, air=0.4, w_per_umol=0.20, albedo=0.23, pressure_kpa=101.3):
    """Reference ET (mm/h) inside a tent: the light is the only radiation source (no sky long-wave term)."""
    rn_mj = (1 - albedo) * ppfd_to_shortwave(ppfd, w_per_umol) * 0.0036
    return max(et0_hourly(temp, rh, rn_mj, air, pressure_kpa), 0.0)


def water_use_ml_h(temp, rh, ppfd, kc=1.0, area=0.5, **kw):
    """Plant water use (ml/h) = Kc x ET0 (mm/h = L/m2/h) x canopy area (m2) x 1000."""
    return tent_et0(temp, rh, ppfd, **kw) * kc * area * 1000


def minute_sum_l(rate_ml_h, minutes, decimals=6, start=0.0):
    """Twin of the package's per-minute trigger sums: each minute adds rate/60000 L and the state is rounded.
    With 3 decimals a minute step of 0.5-1 ml rounds to a whole millilitre (and below 0.5 ml to nothing), so the sum
    drifts; the package keeps 6 decimals (5 would still lose ~4 % of a 5 ml/h night)."""
    total = start
    for _ in range(minutes):
        total = round(total + rate_ml_h / 60000, decimals)
    return total


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return [{k: float(v) if k != "time" else v for k, v in row.items()} for row in csv.DictReader(f)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--temp", type=float, help="air temperature degC")
    ap.add_argument("--rh", type=float, help="relative humidity %%")
    ap.add_argument("--ppfd", type=float, default=0.0, help="PPFD umol/m2/s at the canopy")
    ap.add_argument("--csv", help="hourly log with columns time,temp,rh,ppfd")
    ap.add_argument("--kc", type=float, default=1.0)
    ap.add_argument("--area", type=float, default=0.5, help="canopy area m2")
    ap.add_argument("--air", type=float, default=0.4, help="air speed at the canopy m/s")
    ap.add_argument("--w-per-umol", type=float, default=0.20)
    ap.add_argument("--measured", type=float, help="litres really used over the CSV span: prints the matching Kc")
    a = ap.parse_args(argv)
    kw = dict(air=a.air, w_per_umol=a.w_per_umol)
    if a.csv:
        rows = read_csv(a.csv)
        lit = sum(water_use_ml_h(r["temp"], r["rh"], r["ppfd"], a.kc, a.area, **kw) for r in rows if r["ppfd"] > 0)
        dark = sum(water_use_ml_h(r["temp"], r["rh"], r["ppfd"], a.kc, a.area, **kw) for r in rows if r["ppfd"] <= 0)
        print(f"{len(rows)} hours: {(lit + dark) / 1000:.2f} L (light {lit / 1000:.2f} L, dark {dark / 1000:.2f} L)")
        if a.measured:
            print(f"Kc that matches {a.measured} L: {a.kc * a.measured * 1000 / (lit + dark):.2f}")
        return 0
    if a.temp is None or a.rh is None:
        ap.error("give --temp and --rh, or --csv")
    et0 = tent_et0(a.temp, a.rh, a.ppfd, **kw)
    print(f"ET0 {et0:.3f} mm/h -> water use {water_use_ml_h(a.temp, a.rh, a.ppfd, a.kc, a.area, **kw):.0f} ml/h")
    return 0


if __name__ == "__main__":
    sys.exit(main())
