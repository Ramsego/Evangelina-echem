import pytest
from fastapi.testclient import TestClient

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app


@pytest.fixture
def client():
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ── Synthetic data fixtures ───────────────────────────────────────────────────

@pytest.fixture
def sine_curve():
    """One period of a sine wave as a CV-like I-V curve."""
    import math
    n = 200
    vf = [math.sin(2 * math.pi * i / n) for i in range(n)]
    im = [math.cos(2 * math.pi * i / n) * 1e-3 for i in range(n)]
    return {"vf": vf, "im": im}


@pytest.fixture
def tafel_curve():
    """Log-linear Tafel data with a slope of exactly 120 mV/dec."""
    import math
    # j = j0 * 10^(V / 0.120) → log10(j) = V/0.120 + log10(j0)
    j0 = 1e-6
    vs = [-0.5 + 0.01 * i for i in range(60)]  # -0.5 to 0.09 V
    im = [j0 * 10 ** (v / 0.120) for v in vs]
    return {"vf": vs, "im": im}


@pytest.fixture
def eis_data():
    """Simple RC-circuit EIS data."""
    import math
    freqs = [10 ** (i / 5) for i in range(25)]  # 1 Hz to ~316 Hz
    Rs, Rct, Cdl = 5.0, 50.0, 1e-4
    zreal, zimag, zmod, zphz = [], [], [], []
    for f in freqs:
        w = 2 * math.pi * f
        z_rc = Rct / (1 + (w * Rct * Cdl) ** 2)
        zi   = -w * Cdl * Rct ** 2 / (1 + (w * Rct * Cdl) ** 2)
        zr   = Rs + z_rc
        zreal.append(zr)
        zimag.append(zi)
        zmod.append(math.sqrt(zr**2 + zi**2))
        zphz.append(math.degrees(math.atan2(zi, zr)))
    return {"freq": freqs, "zreal": zreal, "zimag": zimag, "zmod": zmod, "zphz": zphz}


def _eis_payload_from_z(freqs, z, noise_frac=0.0, seed=42):
    """Build the EIS request payload from complex impedances, with optional seeded noise."""
    import math
    import random
    rng = random.Random(seed)
    zreal, zimag, zmod, zphz = [], [], [], []
    for zc in z:
        zr, zi = zc.real, zc.imag
        if noise_frac:
            mod = abs(zc)
            zr += rng.gauss(0, noise_frac * mod)
            zi += rng.gauss(0, noise_frac * mod)
        zreal.append(zr)
        zimag.append(zi)
        zmod.append(math.sqrt(zr**2 + zi**2))
        zphz.append(math.degrees(math.atan2(zi, zr)))
    return {"freq": list(freqs), "zreal": zreal, "zimag": zimag, "zmod": zmod, "zphz": zphz}


@pytest.fixture
def eis_cpe_data():
    """Randles-CPE circuit: α=0.85, Rs=5, Rct=50, Q=1e-4. Seeded 0.1% noise so AICc discriminates."""
    freqs = [10 ** (-1 + i * 5 / 29) for i in range(30)]  # 0.1 Hz to 10 kHz
    Rs, Rct, Q, alpha = 5.0, 50.0, 1e-4, 0.85
    z = [Rs + Rct / (1 + (2j * 3.141592653589793 * f) ** alpha * Q * Rct) for f in freqs]
    return _eis_payload_from_z(freqs, z, noise_frac=0.001)


@pytest.fixture
def eis_warburg_data():
    """Full Randles-CPE-Warburg: σ=20, down to 0.01 Hz so the 45° tail is present."""
    freqs = [10 ** (-2 + i * 6 / 34) for i in range(35)]  # 0.01 Hz to 10 kHz
    Rs, Rct, Q, alpha, sigma = 5.0, 50.0, 1e-4, 0.9, 20.0
    z = []
    for f in freqs:
        w = 2 * 3.141592653589793 * f
        z_w = sigma * (1 - 1j) / w ** 0.5
        z.append(Rs + 1 / ((1j * w) ** alpha * Q + 1 / (Rct + z_w)))
    return _eis_payload_from_z(freqs, z, noise_frac=0.001)


def dunn_entries(k1: float, k2: float, rates_mv=(10, 20, 50, 100), v_lo=0.0, v_hi=1.0, n=100):
    """Build synthetic Dunn CV entries obeying i(V, ν) = k1·ν + k2·√ν exactly.

    Current is constant across V (independent of potential) by design — the point
    is to test the k1/k2 separation regression itself, not a realistic V-dependence.
    im is returned in Amps: compute_dunn_analysis converts to mA internally, so k1
    is in mA per (V/s) and k2 in mA per √(V/s) once recovered.
    """
    entries = []
    for rate in rates_mv:
        nu = rate / 1000.0  # mV/s -> V/s
        v_up   = [v_lo + (v_hi - v_lo) * i / (n - 1) for i in range(n)]
        v_down = list(reversed(v_up))
        vf = v_up + v_down
        i_mA = k1 * nu + k2 * (nu ** 0.5)
        im_amps = [i_mA / 1000.0] * len(vf)
        entries.append({"vf": vf, "im": im_amps, "scan_rate_mv": float(rate)})
    return entries


def bvalue_entries(b_true: float, rates_mv=(5, 10, 20, 50, 100), v_lo=0.0, v_hi=1.0, n=100):
    """Build synthetic CV entries obeying i(V, ν) = (0.5 + V)·ν^b_true exactly, so
    the recovered b(V) should equal b_true everywhere and r2 should be ~1.

    The V-dependent prefactor (0.5 + V) matters, not its value — it is what
    forces the fit to be re-done independently at each voltage rather than
    collapsing to a single global b. Unlike dunn_entries, the vertex point is
    not duplicated between the up/down legs — a repeated point there gives
    _split_cv_sweeps a zero-slope sample that throws off its sign-change
    detection and collapses the cathodic branch to a couple of points, which
    is invisible for dunn_entries (constant current) but not here.
    """
    entries = []
    for rate in rates_mv:
        nu = rate / 1000.0  # mV/s -> V/s
        v_up   = [v_lo + (v_hi - v_lo) * i / (n - 1) for i in range(n)]
        v_down = list(reversed(v_up))[1:]
        vf = v_up + v_down
        im_amps = [(0.5 + v) * (nu ** b_true) / 1000.0 for v in vf]
        entries.append({"vf": vf, "im": im_amps, "scan_rate_mv": float(rate)})
    return entries
