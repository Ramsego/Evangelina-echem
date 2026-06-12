import os

from slowapi import Limiter
from slowapi.util import get_remote_address


def _get_ip(request):
    # Behind a reverse proxy (Render, Fly, Railway, nginx) the raw socket IP is
    # the proxy's internal address — all users would share one rate-limit bucket.
    # Set TRUST_PROXY=true in production to read the real client IP from
    # X-Forwarded-For instead. Only enable this when the proxy is controlled by
    # you; a public-facing app without a proxy should leave it unset.
    if os.getenv("TRUST_PROXY", "").lower() == "true":
        forwarded = request.headers.get("X-Forwarded-For", "")
        ip = forwarded.split(",")[0].strip()
        if ip:
            return ip
    return get_remote_address(request)


limiter = Limiter(key_func=_get_ip)
