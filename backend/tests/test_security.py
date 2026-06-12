"""Security-focused tests: filename sanitization, size limits, kill switch, cache TTL, DELETE."""
import io
import os
import time
import pytest
from fastapi.testclient import TestClient


def _dta_bytes(n_bytes: int = 64) -> bytes:
    """Minimal fake .dta content (not a real Gamry file — upload will parse it but may return an error entry)."""
    return b"EXPLAIN\tDTAFILE\n" + b"x" * n_bytes


def _upload(client: TestClient, filename: str, content: bytes = None):
    content = content or _dta_bytes()
    return client.post(
        "/api/upload",
        files=[("files", (filename, io.BytesIO(content), "application/octet-stream"))],
    )


# ── Filename sanitization ─────────────────────────────────────────────────────

def test_path_traversal_filename_sanitized(client):
    """A filename containing '../' must not pass through to disk unmodified."""
    import routers.files as fmod
    original = fmod._safe_filename("../../etc/passwd.dta")
    assert ".." not in original
    assert "/" not in original
    assert "\\" not in original


def test_safe_filename_strips_directory():
    from routers.files import _safe_filename
    # Path().name strips directory components entirely — "../../etc/passwd" → "passwd"
    result = _safe_filename("../../etc/passwd")
    assert ".." not in result
    assert "/" not in result
    assert result == "passwd"


def test_safe_filename_preserves_normal_name():
    from routers.files import _safe_filename
    assert _safe_filename("sample_cv.dta") == "sample_cv.dta"


def test_safe_filename_empty_falls_back():
    from routers.files import _safe_filename
    assert _safe_filename("") == "upload"


# ── Upload size limits ────────────────────────────────────────────────────────

def test_oversized_single_file_rejected(client):
    # Use exactly 1 byte over the limit to keep the test fast
    limit_bytes = int(os.getenv("MAX_FILE_MB", "20")) * 1024 * 1024
    big = b"x" * (limit_bytes + 1)
    r = _upload(client, "big.dta", big)
    assert r.status_code == 400
    assert "exceeds" in r.text.lower() or "limit" in r.text.lower()


def test_non_dta_file_skipped(client):
    """Non-.dta files are silently skipped — response is an empty list, not an error."""
    r = client.post(
        "/api/upload",
        files=[("files", ("data.csv", io.BytesIO(b"a,b,c"), "text/csv"))],
    )
    assert r.status_code == 200
    assert r.json() == []


# ── Kill switch ───────────────────────────────────────────────────────────────

def test_uploads_disabled_returns_503(client, monkeypatch):
    import routers.files as fmod
    monkeypatch.setattr(fmod, "UPLOADS_ENABLED", False)
    r = _upload(client, "test.dta")
    assert r.status_code == 503


# ── DELETE endpoint ───────────────────────────────────────────────────────────

def test_delete_unknown_id_returns_404(client):
    r = client.delete("/api/files/nonexistent-id-xyz")
    assert r.status_code == 404


def test_old_delete_route_does_not_exist(client):
    """Confirm the previously-broken DELETE /api/{id} route no longer exists."""
    r = client.delete("/api/nonexistent-id-xyz")
    assert r.status_code in (404, 405)  # route not registered at all


def test_delete_clears_cv_cache(client):
    import routers.files as fmod
    file_id = "test-cv-id"
    fmod._cache_set(fmod._cv_store, file_id, [{"vf": [0.0], "im": [0.0]}], 20)
    assert fmod._cv_get(file_id) is not None

    r = client.delete(f"/api/files/{file_id}")
    assert r.status_code == 200
    assert fmod._cv_get(file_id) is None


def test_delete_clears_gcd_cache(client):
    import routers.files as fmod
    file_id = "test-gcd-id"
    fmod._cache_set(fmod._gcd_store, file_id, {1: {"charge": {}, "discharge": {}}}, 20)
    assert fmod._gcd_get(file_id) is not None

    r = client.delete(f"/api/files/{file_id}")
    assert r.status_code == 200
    assert fmod._gcd_get(file_id) is None


def test_delete_clears_seesaw_cache(client):
    import routers.files as fmod
    file_id = "test-seesaw-id"
    fmod._cache_set(fmod._seesaw_store, file_id, {"all_cycles": [], "cycle_data": {}}, 20)
    assert fmod._seesaw_get(file_id) is not None

    r = client.delete(f"/api/files/{file_id}")
    assert r.status_code == 200
    assert fmod._seesaw_get(file_id) is None


# ── TTL expiry ────────────────────────────────────────────────────────────────

def test_cache_ttl_expires_old_entries(monkeypatch):
    """Entries older than _CACHE_TTL_S should be evicted on the next access."""
    import routers.files as fmod
    from collections import OrderedDict

    store: OrderedDict = OrderedDict()
    monkeypatch.setattr(fmod, "_CACHE_TTL_S", 0)

    fmod._cache_set(store, "key1", {"data": True}, maxsize=20)
    time.sleep(0.01)  # ensure timestamp is in the past relative to TTL=0
    result = fmod._cache_get(store, "key1")
    assert result is None


def test_cache_ttl_keeps_fresh_entries(monkeypatch):
    import routers.files as fmod
    from collections import OrderedDict

    store: OrderedDict = OrderedDict()
    monkeypatch.setattr(fmod, "_CACHE_TTL_S", 3600)

    fmod._cache_set(store, "key1", {"data": True}, maxsize=20)
    result = fmod._cache_get(store, "key1")
    assert result == {"data": True}


def test_get_curves_returns_404_after_expiry(client, monkeypatch):
    import routers.files as fmod
    monkeypatch.setattr(fmod, "_CACHE_TTL_S", 0)

    fmod._cache_set(fmod._cv_store, "expiry-test", [{"vf": [], "im": []}], 20)
    time.sleep(0.01)
    r = client.get("/api/files/expiry-test/curves")
    assert r.status_code == 404
