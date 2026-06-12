import logging
import os
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from limiter import limiter
from routers import analysis, export, files

logger = logging.getLogger(__name__)

# Disable interactive API docs outside local development.
_dev = os.getenv("ENV", "production").lower() == "development"

app = FastAPI(
    title="EChem Studio API",
    docs_url="/docs"  if _dev else None,
    redoc_url="/redoc" if _dev else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Stamp every request with a short correlation ID for log tracing.
class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

app.add_middleware(RequestIdMiddleware)


# CORS: set ALLOWED_ORIGINS env var to a comma-separated list for production.
# Falls back to any localhost port when running locally (Vite may auto-assign).
_origins_env = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip() for o in _origins_env.split(",") if o.strip()]

if not allowed_origins:
    import warnings
    warnings.warn(
        "ALLOWED_ORIGINS not set — CORS falling back to localhost only. Set this env var in production.",
        stacklevel=1,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    **({} if allowed_origins else {"allow_origin_regex": r"http://localhost:\d+"}),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


# Hide internal details from error responses — full tracebacks are logged server-side only.
@app.exception_handler(Exception)
async def _generic_error(request: Request, exc: Exception) -> JSONResponse:
    req_id = getattr(request.state, "request_id", "?")
    logger.exception("Unhandled exception [%s] on %s %s", req_id, request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": req_id},
    )

app.include_router(files.router,    prefix="/api")
app.include_router(analysis.router, prefix="/api/analyze")
app.include_router(export.router,   prefix="/api/export")
