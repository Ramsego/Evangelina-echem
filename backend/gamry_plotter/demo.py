# gamry_plotter/demo.py — synthetic sample data for the "Try with sample data" demo mode.
# Returns the same dict structure as load_files() so the rest of the app is unaware.

import numpy as np
import pandas as pd

# Fixed seed so the demo looks the same on every render
_RNG = np.random.default_rng(42)


# ─── CV ────────────────────────────────────────────────────────────────────────

def _cv_curves(n_curves: int = 5) -> list[pd.DataFrame]:
    """Capacitive background + one oxidation/reduction redox pair, slightly evolving per cycle."""
    curves = []
    n_pts  = 600
    v_min, v_max = -0.4, 0.8
    half   = n_pts // 2

    for k in range(n_curves):
        vf = np.concatenate([
            np.linspace(v_min, v_max, half),
            np.linspace(v_max, v_min, half),
        ])
        direction = np.concatenate([np.ones(half), -np.ones(half)])

        # Capacitive background
        i_cap = (1.5e-4 + k * 2e-6) * direction

        # Oxidation peak ~+0.45 V (anodic sweep only)
        ox_amp = 8.0e-4 * (1.0 - 0.015 * k)
        i_ox   = ox_amp * np.exp(-((vf - 0.45) ** 2) / (2 * 0.035 ** 2))
        i_ox  *= vf > 0.15

        # Reduction peak ~+0.38 V (cathodic sweep only, negative)
        red_amp = -7.5e-4 * (1.0 - 0.015 * k)
        i_red   = red_amp * np.exp(-((vf - 0.38) ** 2) / (2 * 0.035 ** 2))
        i_red  *= direction < 0

        noise = _RNG.normal(0, 4e-6, n_pts)
        curves.append(pd.DataFrame({"Vf": vf, "Im": i_cap + i_ox + i_red + noise}))

    return curves


# ─── EIS ───────────────────────────────────────────────────────────────────────

def _eis_spectrum() -> pd.DataFrame:
    """Randles circuit (R_s + R_ct||C_dl + Warburg) from 100 kHz to 10 mHz."""
    R_s, R_ct, C_dl, sigma = 5.0, 120.0, 45e-6, 8.0

    freqs = np.logspace(5, -2, 65)
    omega = 2 * np.pi * freqs

    Z_w  = sigma / np.sqrt(omega) * (1 - 1j)
    Z_ct = R_ct + Z_w
    Z_dl = 1.0 / (1j * omega * C_dl)
    Z    = R_s + (Z_ct * Z_dl) / (Z_ct + Z_dl)
    Z   += _RNG.normal(0, 0.05, len(freqs)) + 1j * _RNG.normal(0, 0.05, len(freqs))

    return pd.DataFrame({
        "Freq":  freqs,
        "Zreal": Z.real,
        "Zimag": Z.imag,
        "Zmod":  np.abs(Z),
        "Zphz":  np.degrees(np.angle(Z)),
    })


# ─── GCD ───────────────────────────────────────────────────────────────────────

def _gcd_data(n_cycles: int = 50):
    """Capacity fade (~0.4 %/cycle) with ~97–99 % Coulombic efficiency."""
    cycles = list(range(1, n_cycles + 1))

    base = 1.8 * 3600   # ~1.8 mAh in Coulombs
    noise = _RNG.normal(0, 0.008 * base, n_cycles)
    discharge_caps = [max(base * (1 - 0.004 * c) + noise[c - 1], 0.1 * base)
                      for c in cycles]

    ce_vals = _RNG.normal(0.975, 0.006, n_cycles)
    charge_by_cycle = {
        c: dc / max(0.85, ce)
        for c, dc, ce in zip(cycles, discharge_caps, ce_vals)
    }

    # Approximate discharge times: ~3600 s at cycle 1, shrinking with capacity
    base_t = 3600.0
    t_noise = _RNG.normal(0, 15.0, n_cycles)
    discharge_times = [max(base_t * (1 - 0.004 * c) + t_noise[c - 1], 300.0)
                       for c in cycles]
    charge_times = [dt / max(0.85, ce) for dt, ce in zip(discharge_times, ce_vals)]
    durations = {
        c: {"charge": ct, "discharge": dt}
        for c, ct, dt in zip(cycles, charge_times, discharge_times)
    }

    return cycles, discharge_caps, charge_by_cycle, durations


# ─── LSV ───────────────────────────────────────────────────────────────────────

def _lsv_curve() -> pd.DataFrame:
    """
    Synthetic HER-like cathodic LSV (0 → −0.6 V vs RHE).

    Uses the Tafel + mass-transport model:
        j_kin = −j0 · 10^(|η| / b)     [Tafel, b = 120 mV/dec]
        j = j_kin · j_lim / (j_kin + j_lim)   [mass-transport correction]
    Gives a clean linear Tafel region from ~−0.05 to ~−0.25 V.
    """
    v     = np.linspace(0.0, -0.6, 500)
    j0    = 1e-3    # mA/cm²  exchange current density
    b     = 0.12    # V/decade  Tafel slope (120 mV/dec)
    j_lim = -20.0   # mA/cm²  diffusion-limited current

    j_kin = -j0 * np.power(10.0, np.abs(v) / b)
    j     = j_kin * j_lim / (j_kin + j_lim)
    noise = _RNG.normal(0, 0.002, len(v))  # low noise → clean Tafel region

    return pd.DataFrame({"Vf": v, "Im": (j + noise) / 1000})  # Im in Amps


# ─── Public API ────────────────────────────────────────────────────────────────

def generate_sample_data() -> list[dict]:
    """Return pre-parsed file dicts in the same format as load_files()."""
    cycles, discharge_caps, charge_by_cycle, durations = _gcd_data()
    return [
        {
            "name":   "Sample_CV.dta",
            "etype":  "CV",
            "curves": _cv_curves(n_curves=5),
        },
        {
            "name":   "Sample_LSV.dta",
            "etype":  "LSV",
            "curves": [_lsv_curve()],
        },
        {
            "name":   "Sample_EIS.dta",
            "etype":  "EISPOT",
            "eis_df": _eis_spectrum(),
        },
        {
            "name":            "Sample_GCD.dta",
            "etype":           "CHRONOP",
            "cycles":          cycles,
            "discharge_caps":  discharge_caps,
            "charge_by_cycle": charge_by_cycle,
            "durations":       durations,
        },
    ]
