"""Shared network helpers.

get_client_ip() is THE canonical way to read the real client IP.
Behind nginx/docker the socket peer is the reverse-proxy container, so
we honour X-Forwarded-For — but only the FIRST hop, and only when the
request actually came through a proxy we consider trusted.

Trusted proxies default to private/loopback ranges (the nginx container
sits on the docker bridge network). Override with the TRUSTED_PROXIES
env var (comma-separated CIDRs) for exotic deployments.
"""

import ipaddress
import os

_DEFAULT_TRUSTED = [
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128",
]


def _trusted_networks():
    raw = os.getenv("TRUSTED_PROXIES", "")
    cidrs = [c.strip() for c in raw.split(",") if c.strip()] or _DEFAULT_TRUSTED
    nets = []
    for c in cidrs:
        try:
            nets.append(ipaddress.ip_network(c, strict=False))
        except ValueError:
            continue
    return nets


_TRUSTED = _trusted_networks()


def _is_trusted(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED)


def get_client_ip(request) -> str:
    """Best-effort real client IP for a FastAPI/Starlette Request.

    - If the socket peer is a trusted proxy, use the first entry of
      X-Forwarded-For (the original client as stamped by our nginx).
    - Otherwise use the socket peer directly (direct connection —
      an XFF header from an untrusted peer is spoofable, ignore it).
    Always returns a string (may be "unknown" when no peer info).
    """
    peer = None
    try:
        peer = request.client.host if request.client else None
    except Exception:
        peer = None

    if peer and _is_trusted(peer):
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            first = xff.split(",")[0].strip()
            try:
                ipaddress.ip_address(first)
                return first
            except ValueError:
                pass
        real = request.headers.get("x-real-ip", "")
        if real:
            try:
                ipaddress.ip_address(real.strip())
                return real.strip()
            except ValueError:
                pass
    return peer or "unknown"
