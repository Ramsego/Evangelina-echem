"""Tests for file-serving endpoints: /sample, /curves, /gcd-cycle, /cycles."""
import pytest


def test_sample_returns_list(client):
    r = client.get("/api/sample")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0


def test_sample_contains_expected_etypes(client):
    r = client.get("/api/sample")
    assert r.status_code == 200
    etypes = {item["etype"] for item in r.json()}
    assert "CV" in etypes
    assert "EISPOT" in etypes
    assert "CHRONOP" in etypes


def test_sample_has_required_fields(client):
    r = client.get("/api/sample")
    assert r.status_code == 200
    for item in r.json():
        assert "id" in item
        assert "name" in item
        assert "etype" in item


def test_get_curves_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/curves")
    assert r.status_code == 404


def test_get_gcd_cycle_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/gcd-cycle")
    assert r.status_code == 404


def test_get_cycles_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/cycles")
    assert r.status_code == 404


def test_get_curves_returns_expected_shape(client):
    import routers.files as fmod
    file_id = "test-curves-shape"
    curves = [{"vf": [0.0, 0.5, 1.0], "im": [0.0, 1e-3, 0.0]} for _ in range(5)]
    fmod._cache_set(fmod._cv_store, file_id, curves, 20)

    r = client.get(f"/api/files/{file_id}/curves?start=1&end=3")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 5
    assert len(data["curves"]) == 3


def test_get_gcd_cycle_returns_charge_and_discharge(client):
    import routers.files as fmod
    file_id = "test-gcd-shape"
    waveforms = {
        1: {
            "charge":    {"times": [0.0, 1.0], "voltages": [3.0, 4.0], "currents": [1e-3, 1e-3], "energy_mwh": 0.01},
            "discharge": {"times": [0.0, 1.0], "voltages": [4.0, 3.0], "currents": [-1e-3, -1e-3], "energy_mwh": 0.009},
        }
    }
    fmod._cache_set(fmod._gcd_store, file_id, waveforms, 20)

    r = client.get(f"/api/files/{file_id}/gcd-cycle?cycle=1")
    assert r.status_code == 200
    data = r.json()
    assert "charge" in data
    assert "discharge" in data
    assert data["cycle"] == 1


def test_get_gcd_cycle_missing_cycle_returns_404(client):
    import routers.files as fmod
    file_id = "test-gcd-missing-cycle"
    fmod._cache_set(fmod._gcd_store, file_id, {1: {}}, 20)

    r = client.get(f"/api/files/{file_id}/gcd-cycle?cycle=99")
    assert r.status_code == 404
