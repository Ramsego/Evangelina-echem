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


def test_health_returns_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_get_curves_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/curves")
    assert r.status_code == 404


def test_get_gcd_cycle_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/gcd-cycle")
    assert r.status_code == 404


def test_get_cycles_unknown_file_returns_404(client):
    r = client.get("/api/files/does-not-exist/cycles")
    assert r.status_code == 404


def test_get_cycles_returns_labeled_segments(client):
    """/cycles exposes ground-truth charge/discharge boundaries as segments."""
    import routers.files as fmod
    file_id = "test-cycles-segments"
    cycle_data = {
        c: {
            "charge":    ([0.0, 1.0, 2.0], [3.0, 3.5, 4.0]),
            "discharge": ([0.0, 1.0, 2.0], [4.0, 3.5, 3.0]),
        }
        for c in (1, 2)
    }
    fmod._cache_set(
        fmod._seesaw_store, file_id,
        {"all_cycles": [1, 2], "cycle_data": cycle_data}, 20,
    )

    r = client.get(f"/api/files/{file_id}/cycles?start=1&end=2")
    assert r.status_code == 200
    data = r.json()
    segs = data["segments"]
    # 2 cycles × (charge + discharge)
    assert [s["label"] for s in segs] == ["Charge", "Discharge", "Charge", "Discharge"]
    # indices slice back to the original per-step lengths
    for s in segs:
        assert s["end"] - s["start"] + 1 == 3
    assert segs[-1]["end"] == len(data["times"]) - 1


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


# ── Upload endpoint ───────────────────────────────────────────────────────────

def test_upload_no_files_returns_422(client):
    """POST with no files field → 422 (FastAPI required param missing); not a 500."""
    r = client.post("/api/upload", files=[])
    assert r.status_code == 422


def test_upload_non_dta_extension_is_skipped(client):
    """Files without .dta extension are silently skipped."""
    r = client.post("/api/upload", files={"files": ("note.txt", b"hello", "text/plain")})
    assert r.status_code == 200
    assert r.json() == []


def test_upload_unparseable_dta_returns_error_field(client):
    """A .dta file that gamry_parser can't parse returns an error field, not a 500."""
    content = b"GARBAGE DATA\tNOT A REAL DTA FILE\n"
    r = client.post("/api/upload", files={"files": ("bad.dta", content, "application/octet-stream")})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert "error" in data[0]


def test_upload_returns_list(client):
    """Upload endpoint always returns a list, never a dict or 500."""
    r = client.post("/api/upload", files={"files": ("fake.dta", b"\x00\x01", "application/octet-stream")})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_upload_allows_127_frontend_origin(client):
    """Local dev CORS should allow Vite opened from 127.0.0.1, not only localhost."""
    r = client.post(
        "/api/upload",
        files={"files": ("fake.dta", b"\x00\x01", "application/octet-stream")},
        headers={"Origin": "http://127.0.0.1:5173"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_upload_too_many_files_returns_400(client):
    """Uploading more than _MAX_FILES files returns 400."""
    import routers.files as fmod
    limit = fmod._MAX_FILES
    files = [("files", (f"f{i}.dta", b"x", "application/octet-stream")) for i in range(limit + 1)]
    r = client.post("/api/upload", files=files)
    assert r.status_code == 400


def test_upload_oversize_file_returns_400_with_message(client):
    """A file over MAX_FILE_MB gets a clean 400, not a connection reset or 500.
    (Verified manually via curl during diagnosis — this pins it in CI.)"""
    import routers.files as fmod
    big = b"X" * (fmod._MAX_FILE_MB * 1024 * 1024 + 1)
    r = client.post("/api/upload", files={"files": ("big.dta", big, "application/octet-stream")})
    assert r.status_code == 400
    assert "exceeds" in r.json()["detail"]


def test_upload_total_size_limit_returns_400(client):
    """Multiple files whose sum exceeds MAX_TOTAL_MB → 400."""
    import routers.files as fmod
    per_file = fmod._MAX_FILE_MB * 1024 * 1024 - 1024
    n = fmod._MAX_TOTAL_MB // fmod._MAX_FILE_MB + 1
    files = [("files", (f"f{i}.dta", b"X" * per_file, "application/octet-stream")) for i in range(n)]
    r = client.post("/api/upload", files=files)
    assert r.status_code == 400
    assert "Total upload" in r.json()["detail"]
