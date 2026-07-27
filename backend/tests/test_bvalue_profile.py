"""Coverage for compute_bvalue_profile (new endpoint) and the _split_cv_sweeps
direction fix — both had zero prior coverage. The direction fix is exercised
against the exact pattern found in the real NaCl sample data (cycle starts on
the descending/cathodic sweep, not the ascending one).
"""
import numpy as np

from gamry_plotter.data import _split_cv_sweeps

from .conftest import bvalue_entries


def _bvalue_request(entries, n_points=50):
    return {"entries": entries, "n_points": n_points}


def test_bvalue_profile_recovers_known_exponent(client):
    entries = bvalue_entries(b_true=0.73)
    r = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(entries))
    assert r.status_code == 200
    data = r.json()

    for branch in ("anodic", "cathodic"):
        assert data[branch] is not None
        b_vals = [x for x in data[branch]["b"] if x is not None]
        r2_vals = [x for x in data[branch]["r2"] if x is not None]
        assert len(b_vals) > 40  # nearly every grid point should fit cleanly
        assert all(abs(b - 0.73) < 1e-6 for b in b_vals)
        assert all(r2 > 0.999 for r2 in r2_vals)


def test_bvalue_profile_tracks_exponent_changes(client):
    lo = bvalue_entries(b_true=0.5)
    hi = bvalue_entries(b_true=1.0)
    r_lo = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(lo))
    r_hi = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(hi))
    assert r_lo.status_code == 200 and r_hi.status_code == 200

    b_lo = [x for x in r_lo.json()["anodic"]["b"] if x is not None]
    b_hi = [x for x in r_hi.json()["anodic"]["b"] if x is not None]
    assert sum(b_lo) / len(b_lo) < sum(b_hi) / len(b_hi)


def test_bvalue_profile_requires_at_least_two_entries(client):
    entries = bvalue_entries(b_true=0.8, rates_mv=(10,))
    r = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(entries))
    assert r.status_code == 422


def test_bvalue_profile_result_invariant_to_entry_order(client):
    import random
    entries = bvalue_entries(b_true=0.65)
    shuffled = entries[:]
    random.Random(3).shuffle(shuffled)

    r1 = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(entries))
    r2 = client.post("/api/analyze/bvalue-profile", json=_bvalue_request(shuffled))
    assert r1.status_code == 200 and r2.status_code == 200
    b1 = [x for x in r1.json()["anodic"]["b"] if x is not None]
    b2 = [x for x in r2.json()["anodic"]["b"] if x is not None]
    assert len(b1) == len(b2)
    # Reordering changes float summation order in polyfit — allow float64-precision noise only.
    assert all(abs(x - y) < 1e-9 for x, y in zip(b1, b2))


# ── _split_cv_sweeps direction fix ────────────────────────────────────────────

def test_split_cv_sweeps_labels_by_voltage_direction_when_descending_first():
    """Regression test for the fix: a cycle that sweeps DOWN first, then UP
    (the pattern in the real NaCl sample data) must still have its ascending
    half labelled anodic and its descending half labelled cathodic — not
    whichever half happened to come first in time.
    """
    n = 50
    v_down = [1.0 - 2.0 * i / (n - 1) for i in range(n)]        # +1 -> -1
    v_up   = [-1.0 + 2.0 * i / (n - 1) for i in range(1, n)]    # -1 -> +1 (skip shared vertex)
    vf = np.array(v_down + v_up)
    im = np.array([-5.0] * n + [5.0] * (n - 1))  # descending leg carries -5, ascending leg carries +5

    (an_v, an_i), (cat_v, cat_i) = _split_cv_sweeps(vf, im)

    # allow the single shared boundary point to disagree; every other point must not.
    assert (an_i > 0).sum() >= len(an_i) - 1
    assert (cat_i < 0).sum() >= len(cat_i) - 1
    assert an_v[-1] > an_v[0]
    assert cat_v[-1] > cat_v[0]  # both returned sorted ascending, by contract


def test_split_cv_sweeps_labels_by_voltage_direction_when_ascending_first():
    """Same physical cycle, opposite starting phase (+1 -> ... ascending first).
    The old time-order-based code happened to get this case right already —
    verify the direction-based fix didn't regress it.
    """
    n = 50
    v_up   = [-1.0 + 2.0 * i / (n - 1) for i in range(n)]       # -1 -> +1
    v_down = [1.0 - 2.0 * i / (n - 1) for i in range(1, n)]     # +1 -> -1 (skip shared vertex)
    vf = np.array(v_up + v_down)
    im = np.array([5.0] * n + [-5.0] * (n - 1))

    (an_v, an_i), (cat_v, cat_i) = _split_cv_sweeps(vf, im)

    assert (an_i > 0).sum() >= len(an_i) - 1
    assert (cat_i < 0).sum() >= len(cat_i) - 1
