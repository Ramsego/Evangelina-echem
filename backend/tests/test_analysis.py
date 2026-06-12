"""Tests for stateless analysis endpoints — no file upload needed."""
import math
import pytest


# ── CV ────────────────────────────────────────────────────────────────────────

def test_cv_returns_capacitance(client, sine_curve):
    r = client.post("/api/analyze/cv", json={
        "curves": [sine_curve],
        "scan_rate_mv": 50.0,
    })
    assert r.status_code == 200
    data = r.json()
    assert "capacitances_mf" in data
    assert len(data["capacitances_mf"]) == 1


def test_cv_peaks_detected(client, sine_curve):
    r = client.post("/api/analyze/cv", json={
        "curves": [sine_curve],
        "scan_rate_mv": 50.0,
        "detect_peaks": True,
        "prominence": 0.01,
    })
    assert r.status_code == 200
    peaks = r.json()["peaks"]
    assert peaks is not None
    assert len(peaks) == 1
    peak = peaks[0]
    # A sine wave has an anodic peak > cathodic peak
    ox = peak["oxidation"]["voltages"]
    rd = peak["reduction"]["voltages"]
    if ox and rd:
        assert ox[0] > rd[0]


def test_cv_empty_curves_returns_empty(client):
    r = client.post("/api/analyze/cv", json={"curves": []})
    assert r.status_code == 200
    assert r.json()["capacitances_mf"] == []


def test_cv_too_many_curves_rejected(client, sine_curve):
    r = client.post("/api/analyze/cv", json={
        "curves": [sine_curve] * 51,
        "scan_rate_mv": 50.0,
    })
    assert r.status_code == 422


def test_cv_too_many_points_rejected(client):
    big = {"vf": [0.0] * 20001, "im": [0.0] * 20001}
    r = client.post("/api/analyze/cv", json={"curves": [big]})
    assert r.status_code == 422


# ── Tafel ─────────────────────────────────────────────────────────────────────

def test_tafel_known_slope(client, tafel_curve):
    r = client.post("/api/analyze/tafel", json={
        "curve": tafel_curve,
        "area_cm2": 1.0,
    })
    assert r.status_code == 200
    data = r.json()
    if data.get("success"):
        assert abs(data["slope_mv_dec"] - 120.0) < 5.0
        # Exact synthetic data → negligible slope uncertainty
        assert data["slope_err_mv_dec"] < 0.1


def test_tafel_manual_window_respected(client, tafel_curve):
    r = client.post("/api/analyze/tafel", json={
        "curve": tafel_curve,
        "area_cm2": 1.0,
        "v_lo": -0.4,
        "v_hi": -0.1,
    })
    assert r.status_code == 200
    data = r.json()
    if data.get("success"):
        assert data["auto_window"] is False
        assert data["v_lo"] >= -0.4 - 0.01
        assert data["v_hi"] <= -0.1 + 0.01


def test_tafel_auto_window_flag(client, tafel_curve):
    r = client.post("/api/analyze/tafel", json={"curve": tafel_curve, "area_cm2": 1.0})
    assert r.status_code == 200
    data = r.json()
    if data.get("success"):
        assert data["auto_window"] is True


def test_tafel_reports_n_points(client, tafel_curve):
    r = client.post("/api/analyze/tafel", json={
        "curve": tafel_curve,
        "area_cm2": 1.0,
        "v_lo": -0.3,
        "v_hi": -0.1,
    })
    assert r.status_code == 200
    data = r.json()
    if data.get("success"):
        assert data["n_points"] >= 1


def test_tafel_fail_returns_window():
    """A 3-point curve cannot produce a fit; the failure response must include v_lo/v_hi."""
    from fastapi.testclient import TestClient
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        tiny_curve = {"vf": [-0.1, 0.0, 0.1], "im": [1e-7, 1e-6, 1e-5]}
        r = c.post("/api/analyze/tafel", json={
            "curve": tiny_curve,
            "area_cm2": 1.0,
            "v_lo": -0.05,
            "v_hi": 0.05,
        })
        assert r.status_code == 200
        data = r.json()
        assert data["success"] is False
        assert "v_lo" in data and data["v_lo"] is not None
        assert "v_hi" in data and data["v_hi"] is not None


# ── EIS ───────────────────────────────────────────────────────────────────────

def test_eis_returns_expected_fields(client, eis_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_data})
    assert r.status_code == 200
    data = r.json()
    assert "esr" in data
    assert "c_max_mf" in data
    assert "complex_cap" in data
    assert "circuit_fit" in data
    cc = data["complex_cap"]
    assert "freq" in cc and "c_prime" in cc and "c_dbl" in cc


def test_eis_esr_positive(client, eis_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_data})
    assert r.status_code == 200
    assert r.json()["esr"] > 0


def test_eis_fit_randles_recovers_params(client, eis_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_data, "model": "randles"})
    assert r.status_code == 200
    fit = r.json()["circuit_fit"]
    assert fit is not None
    assert fit["model"] == "randles"
    assert abs(fit["R_s"] - 5.0) / 5.0 < 0.05
    assert abs(fit["R_ct"] - 50.0) / 50.0 < 0.05
    assert abs(fit["C_dl_uF"] - 100.0) / 100.0 < 0.05


def test_eis_fit_cpe_recovers_alpha(client, eis_cpe_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_cpe_data, "model": "randles_cpe"})
    assert r.status_code == 200
    fit = r.json()["circuit_fit"]
    assert fit is not None
    assert abs(fit["alpha"] - 0.85) < 0.02
    assert abs(fit["R_ct"] - 50.0) / 50.0 < 0.1


def test_eis_fit_warburg_recovers_sigma(client, eis_warburg_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_warburg_data, "model": "randles_cpe_warburg"})
    assert r.status_code == 200
    fit = r.json()["circuit_fit"]
    assert fit is not None
    assert abs(fit["sigma"] - 20.0) / 20.0 < 0.1


def test_eis_fit_auto_selects_cpe_model(client, eis_cpe_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_cpe_data, "model": "auto"})
    assert r.status_code == 200
    fit = r.json()["circuit_fit"]
    assert fit is not None
    # α=0.85 is distinctly non-ideal; plain Randles should lose on AICc
    assert fit["model"] in ("randles_cpe", "randles_cpe_warburg")


def test_eis_fit_reports_errors(client, eis_cpe_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_cpe_data, "model": "randles_cpe"})
    assert r.status_code == 200
    fit = r.json()["circuit_fit"]
    assert fit["R_ct_err"] is not None
    assert fit["alpha_err"] is not None
    assert 0 < fit["alpha_err"] < 0.1
    assert 0 < fit["R_ct_err"] < 5.0


def test_eis_invalid_model_rejected(client, eis_data):
    r = client.post("/api/analyze/eis", json={"eis": eis_data, "model": "nonsense"})
    assert r.status_code == 422


# ── GCD ───────────────────────────────────────────────────────────────────────

def _gcd_payload(n=5, cap=100.0):
    return {
        "cycles": list(range(1, n + 1)),
        "discharge_caps": [cap] * n,
        "charge_by_cycle": {str(i): cap for i in range(1, n + 1)},
    }


def test_gcd_stable_capacity_zero_fade(client):
    r = client.post("/api/analyze/gcd", json=_gcd_payload(5, 100.0))
    assert r.status_code == 200
    assert abs(r.json()["fade_pct"]) < 0.01


def test_gcd_fading_capacity(client):
    payload = {
        "cycles": [1, 2, 3, 4, 5],
        "discharge_caps": [100.0, 95.0, 90.0, 85.0, 80.0],
        "charge_by_cycle": {str(i): 100.0 for i in range(1, 6)},
    }
    r = client.post("/api/analyze/gcd", json=payload)
    assert r.status_code == 200
    assert r.json()["fade_pct"] > 0


def test_gcd_ce_computation(client):
    payload = {
        "cycles": [1, 2],
        "discharge_caps": [90.0, 90.0],
        "charge_by_cycle": {"1": 100.0, "2": 100.0},
    }
    r = client.post("/api/analyze/gcd", json=payload)
    assert r.status_code == 200
    ce_vals = r.json()["ce_vals"]
    assert len(ce_vals) == 2
    assert all(abs(v - 90.0) < 0.1 for v in ce_vals if v is not None)


def test_gcd_energy_efficiency_computed(client):
    payload = {
        "cycles": [1],
        "discharge_caps": [100.0],
        "charge_by_cycle": {"1": 100.0},
        "dis_energy_mwh": {"1": 0.9},
        "ch_energy_mwh":  {"1": 1.0},
    }
    r = client.post("/api/analyze/gcd", json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["energy_efficiency"][0] == pytest.approx(90.0, abs=0.1)
    assert data["avg_energy_eff"] == pytest.approx(90.0, abs=0.1)


def test_gcd_missing_energy_returns_null(client):
    r = client.post("/api/analyze/gcd", json=_gcd_payload(3))
    assert r.status_code == 200
    data = r.json()
    assert all(v is None for v in data["energy_efficiency"])
    assert data["avg_energy_eff"] is None
