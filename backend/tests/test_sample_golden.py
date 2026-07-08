"""Regression ('golden number') tests on the real bundled sample data.

Unlike the analytical-recovery tests elsewhere (synthetic data with a known
ground truth), these pin the *actual* output for the real files shipped in
backend/sample_data/ — the same files served by /api/sample and shown in the
app's "Try with sample data" demo. A future refactor that silently shifts one
of these numbers should fail here even though it can't fail an analytical test
(there's no independent ground truth for real measured data, only "did the
answer change"). Tolerances were set from the values already validated by eye
in the running app; see VALIDATION.md.
"""
from pathlib import Path

import pytest

from routers.files import _parse_regular, _SAMPLE_IDS

_SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"


@pytest.fixture(scope="module")
def parsed_samples():
    return {
        name: _parse_regular(name, _SAMPLE_DIR / name, file_id=sid)
        for name, sid in _SAMPLE_IDS.items()
    }


def test_sample_cv_shape(parsed_samples):
    cv = parsed_samples["Sample_CV.dta"]
    assert cv["etype"] == "CV"
    assert len(cv["curves"]) == 5
    assert len(cv["curves"][0]["vf"]) == 3200
    vfs = [v for c in cv["curves"] for v in c["vf"]]
    assert min(vfs) == pytest.approx(0.2, abs=1e-6)
    assert max(vfs) == pytest.approx(1.8, abs=1e-6)


def test_sample_lsv_tafel_golden(client, parsed_samples):
    lsv = parsed_samples["Sample_LSV.dta"]
    assert lsv["etype"] == "LSV"
    r = client.post("/api/analyze/tafel", json={"curve": lsv["curves"][0], "area_cm2": 1.0})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["slope_mv_dec"] == pytest.approx(121.4, abs=3.0)
    assert data["r2"] > 0.99


def test_sample_eis_golden(client, parsed_samples):
    eis = parsed_samples["Sample_EIS.dta"]
    assert eis["etype"] == "EISPOT"
    r = client.post("/api/analyze/eis", json={"eis": eis["eis"], "model": "auto"})
    assert r.status_code == 200
    data = r.json()
    assert data["esr"] == pytest.approx(1.49, abs=0.15)
    fit = data["circuit_fit"]
    assert fit is not None
    assert fit["model"] == "randles_cpe_warburg"
    assert fit["R_s"] == pytest.approx(1.41, abs=0.15)
    assert fit["R_ct"] == pytest.approx(14.2, abs=1.5)


def test_sample_gcd_golden(parsed_samples):
    gcd = parsed_samples["Sample_GCD.dta"]
    assert gcd["etype"] == "CHRONOP"
    assert len(gcd["gcd"]["cycles"]) == 95
    assert gcd["gcd"]["discharge_caps"][0] == pytest.approx(313.3, abs=0.5)
    assert gcd["total_gcd_cycles"] == 1
