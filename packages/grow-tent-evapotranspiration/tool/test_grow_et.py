"""Tests for grow_et.py (standard library only): python3 -m unittest -v test_grow_et.py"""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grow_et as g  # noqa: E402


class FaoExample19(unittest.TestCase):
    """FAO-56 Chapter 4, Example 19 (hourly ETo, N'Diaye, 1 October): 0.63 mm/h at 14-15 h, 0.00 at 02-03 h,
    computed with the original FAO-56 hourly constants (Cn 37, Cd 0.34) and the example's own Rn and G."""

    def test_intermediate_values(self):
        self.assertAlmostEqual(g.sat_vapour_pressure(38), 6.625, places=3)
        self.assertAlmostEqual(g.sat_vapour_pressure(28), 3.780, places=3)
        self.assertAlmostEqual(g.slope_vapour_pressure(38), 0.358, places=3)
        self.assertAlmostEqual(g.slope_vapour_pressure(28), 0.220, places=3)
        self.assertAlmostEqual(g.psychrometric_constant(101.2), 0.0673, places=4)

    def test_daytime_hour(self):
        et0 = g.et0_hourly(38, 52, rn_mj=1.749, wind=3.3, pressure_kpa=101.2, cd=0.34, g=0.175)
        self.assertAlmostEqual(et0, 0.63, places=2)

    def test_night_hour(self):
        et0 = g.et0_hourly(28, 90, rn_mj=-0.100, wind=1.9, pressure_kpa=101.2, cd=0.34, g=-0.050)
        self.assertAlmostEqual(et0, 0.00, places=2)


class Radiation(unittest.TestCase):
    def test_planck(self):
        # Kusuma et al. 2020: 450 nm photons 3.76 umol/J, 660 nm photons 5.52 umol/J
        self.assertAlmostEqual(1 / g.joule_per_umol(450), 3.76, places=2)
        self.assertAlmostEqual(1 / g.joule_per_umol(660), 5.52, places=2)
        self.assertAlmostEqual(g.joule_per_umol(600), 0.20, places=2)

    def test_ppfd_to_shortwave(self):
        self.assertAlmostEqual(g.ppfd_to_shortwave(700, 0.20), 140.0)
        self.assertEqual(g.ppfd_to_shortwave(-5), 0.0)


class Tent(unittest.TestCase):
    def test_light_and_dark(self):
        lit = g.water_use_ml_h(25, 45, 700, kc=1.0, area=0.5)
        dark = g.water_use_ml_h(20, 50, 0, kc=1.0, area=0.5)
        self.assertGreater(lit, 5 * dark)       # the light drives the water use
        self.assertGreater(dark, 0)              # dry air still pulls a little at night
        self.assertAlmostEqual(lit, 62.3, delta=0.5)  # regression pin, also used for the template == Python check

    def test_scales_with_kc_and_area(self):
        a = g.water_use_ml_h(25, 45, 700, kc=1.0, area=0.5)
        self.assertAlmostEqual(g.water_use_ml_h(25, 45, 700, kc=0.5, area=0.5), a / 2)
        self.assertAlmostEqual(g.water_use_ml_h(25, 45, 700, kc=1.0, area=1.0), 2 * a)

    def test_never_negative(self):
        self.assertEqual(g.tent_et0(15, 100, 0), 0.0)

    def test_csv_and_calibration(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
            f.write("time,temp,rh,ppfd\n")
            for h in range(24):
                f.write(f"{h:02d}:00,{25 if 5 <= h < 23 else 20},{45 if 5 <= h < 23 else 50},{700 if 5 <= h < 23 else 0}\n")
        out = io.StringIO()
        with redirect_stdout(out):
            g.main(["--csv", f.name, "--area", "0.5", "--measured", "1.0"])
        os.unlink(f.name)
        text = out.getvalue()
        self.assertIn("24 hours", text)
        self.assertIn("Kc that matches 1.0 L", text)


if __name__ == "__main__":
    unittest.main()
