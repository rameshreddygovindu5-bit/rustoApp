"""TOTP (RFC 6238) implementation in pure Python.

Used for two-factor authentication of user logins. Implemented inline
rather than depending on `pyotp` to avoid adding a runtime dependency
to a stable codebase. RFC compliance is straightforward — TOTP is just
HMAC-SHA1 over a counter derived from the current time.

Compatible with Google Authenticator, Authy, 1Password, Microsoft
Authenticator, and every other RFC-6238-compliant app.
"""
import hmac
import hashlib
import base64
import secrets
import struct
import time
from urllib.parse import quote


def generate_secret() -> str:
    """Generate a fresh base32-encoded secret. 20 bytes (160 bits) is the
    RFC 6238 recommended size."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _b32_decode_padded(secret: str) -> bytes:
    """Decode a base32 secret, tolerating missing padding. RFC 4648
    requires padding to a multiple of 8 chars; many authenticator apps
    and QR codes strip it."""
    s = secret.upper().replace(" ", "").replace("-", "")
    pad = (-len(s)) % 8
    return base64.b32decode(s + "=" * pad)


def generate_totp(secret: str, for_time: int | None = None, *, step: int = 30, digits: int = 6) -> str:
    """Compute the current TOTP code for `secret`.

    `for_time` is a Unix timestamp; defaults to NOW. Caller can pass a
    fixed value for testing.
    """
    if for_time is None:
        for_time = int(time.time())
    counter = for_time // step
    key = _b32_decode_padded(secret)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    # Dynamic truncation — RFC 4226 §5.3.
    offset = digest[-1] & 0x0F
    code_int = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code_int % (10 ** digits)).zfill(digits)


def verify_totp(secret: str, code: str, *, step: int = 30, digits: int = 6,
                window: int = 1) -> bool:
    """Verify a user-supplied code. Accepts codes from the current
    30-second window AND the immediately preceding/following window
    (default `window=1` → ±30s tolerance) so clock drift between the
    server and the user's phone doesn't lock them out.

    Constant-time compare via `hmac.compare_digest`.
    """
    if not secret or not code:
        return False
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != digits:
        return False
    now = int(time.time())
    for offset in range(-window, window + 1):
        candidate = generate_totp(secret, for_time=now + offset * step,
                                   step=step, digits=digits)
        if hmac.compare_digest(candidate, code):
            return True
    return False


def provisioning_uri(secret: str, account_name: str, issuer: str = "Rusto") -> str:
    """Build an `otpauth://` URI that authenticator apps can scan as a
    QR code to enrol the user.

    Format defined here: https://github.com/google/google-authenticator/wiki/Key-Uri-Format
    """
    label = f"{quote(issuer)}:{quote(account_name)}"
    params = f"secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"
    return f"otpauth://totp/{label}?{params}"
