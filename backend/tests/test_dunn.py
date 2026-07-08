"""Analytical-recovery and invariance tests for the Dunn capacitive/diffusion
separation endpoint — the one analysis with zero prior coverage.
"""
import random

from .conftest import dunn_entries


def _dunn_request(entries, target_scan_rate_mv=50.0, im_divisor=1.0):
    return {
        "entries": entries,
        "target_scan_rate_mv": target_scan_rate_mv,
        "im_divisor": im_divisor,
    }


def test_dunn_pure_capacitive_recovers_full_cap_fraction(client):
    entries = dunn_entries(k1=5.0, k2=0.0)
    r = client.post("/api/analyze/dunn", json=_dunn_request(entries))
    assert r.status_code == 200
    data = r.json()
    assert data["cap_fraction"] >= 0.95
    assert data["r2_mean"] > 0.99


def test_dunn_pure_diffusion_recovers_near_zero_cap_fraction(client):
    entries = dunn_entries(k1=0.0, k2=5.0)
    r = client.post("/api/analyze/dunn", json=_dunn_request(entries))
    assert r.status_code == 200
    data = r.json()
    assert data["cap_fraction"] <= 0.05
    assert data["r2_mean"] > 0.99


def test_dunn_mixed_contribution_falls_strictly_between(client):
    entries = dunn_entries(k1=3.0, k2=3.0)
    r = client.post("/api/analyze/dunn", json=_dunn_request(entries))
    assert r.status_code == 200
    data = r.json()
    assert 0.05 < data["cap_fraction"] < 0.95
    assert data["r2_mean"] > 0.99
    assert abs(data["cap_fraction"] + data["diff_fraction"] - 1.0) < 1e-9


def test_dunn_result_invariant_to_entry_order(client):
    entries = dunn_entries(k1=3.0, k2=3.0)
    r1 = client.post("/api/analyze/dunn", json=_dunn_request(entries))
    shuffled = entries[:]
    random.Random(7).shuffle(shuffled)
    r2 = client.post("/api/analyze/dunn", json=_dunn_request(shuffled))
    assert r1.status_code == 200 and r2.status_code == 200
    d1, d2 = r1.json(), r2.json()
    # Reordering changes float summation order — allow float64-precision noise only.
    assert abs(d1["cap_fraction"] - d2["cap_fraction"]) < 1e-9
    assert abs(d1["r2_mean"] - d2["r2_mean"]) < 1e-9


def test_dunn_cap_fraction_invariant_to_current_scale(client):
    entries = dunn_entries(k1=3.0, k2=3.0)
    r1 = client.post("/api/analyze/dunn", json=_dunn_request(entries, im_divisor=1.0))
    r2 = client.post("/api/analyze/dunn", json=_dunn_request(entries, im_divisor=0.5))  # doubles effective current
    assert r1.status_code == 200 and r2.status_code == 200
    assert abs(r1.json()["cap_fraction"] - r2.json()["cap_fraction"]) < 1e-6


def test_dunn_cap_fraction_always_in_unit_bounds(client):
    rng = random.Random(42)
    for _ in range(15):
        k1 = rng.uniform(-5, 5)
        k2 = rng.uniform(-5, 5)
        entries = dunn_entries(k1=k1, k2=k2)
        r = client.post("/api/analyze/dunn", json=_dunn_request(entries))
        assert r.status_code == 200
        data = r.json()
        assert 0.0 <= data["cap_fraction"] <= 1.0
        assert 0.0 <= data["diff_fraction"] <= 1.0
        assert data["r2_mean"] > 0.99  # noiseless linear model — should fit almost exactly
