"""Centralized environment configuration.

All backend env vars are read here once at import so production behavior is not
scattered across modules. Import the values you need; do not call os.getenv elsewhere.
"""

import os

# ── Environment ─────────────────────────────────────────────────────────────
ENV    = os.getenv("ENV", "production").lower()
IS_DEV = ENV == "development"

# ── CORS ──────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins. Empty → localhost-only fallback (see main.py).
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

# ── Rate limiting ───────────────────────────────────────────────────────────────
# Trust X-Forwarded-For for the client IP. Only enable behind a proxy you control.
TRUST_PROXY = os.getenv("TRUST_PROXY", "").lower() == "true"

# ── Upload limits ─────────────────────────────────────────────────────────────
MAX_FILES       = int(os.getenv("MAX_FILES",    "100"))
MAX_FILE_MB     = int(os.getenv("MAX_FILE_MB",  "20"))
MAX_TOTAL_MB    = int(os.getenv("MAX_TOTAL_MB", "100"))
UPLOADS_ENABLED = os.getenv("UPLOADS_ENABLED", "true").lower() != "false"
CACHE_TTL_S     = int(os.getenv("CACHE_TTL_S", "3600"))  # 1 h default
MAX_RANGE       = int(os.getenv("MAX_RANGE",   "500"))   # max curves/cycles per fetch
