"""
sms_service.py — Multi-vendor SMS routing (Twilio / MSG91)
==========================================================

Super-admin configures which SMS vendor to use per lodge via:
  Settings key: sms_provider  → "twilio" | "msg91"

Vendor credentials stored in Settings:
  Twilio:
    twilio_account_sid    → Account SID (AC...)
    twilio_auth_token     → Auth token (sensitive)
    sms_from_number       → +E.164 number or MG... messaging service SID

  MSG91:
    msg91_auth_key        → API auth key (sensitive)
    msg91_sender_id       → 6-char DLT-registered sender ID (e.g. RUSTO1)
    msg91_template_id     → DLT template ID for each message type (optional)
    msg91_country_code    → default "91"

Indian phone numbers only (+91XXXXXXXXXX). All others rejected before
reaching the vendor.
"""
import re
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..models import Alert, AlertType, AlertEvent, AlertStatus, Setting

logger = logging.getLogger(__name__)

# ── Validation ────────────────────────────────────────────────────────────────
_INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_E164_RE          = re.compile(r"^\+[1-9]\d{6,14}$")


def normalize_phone_e164(raw: str, indian_only: bool = False) -> str:
    """Canonicalise a phone number to E.164 format (+XXXXXXXXXXX).

    When indian_only=True (MSG91), only +91 numbers are accepted.
    When indian_only=False (Twilio), any valid E.164 is accepted.
    Indian 10-digit numbers are auto-prefixed with +91.
    """
    if not raw:
        raise ValueError("Phone number is empty.")
    stripped = str(raw).strip()
    s = re.sub(r"[\s\-\(\)\.]", "", stripped)

    # Strip leading + for digit processing
    if s.startswith("+"):
        digits = s[1:]
    else:
        digits = s

    # Indian number detection
    if digits.startswith("91") and len(digits) == 12:
        bare = digits[2:]
        if _INDIAN_MOBILE_RE.match(bare):
            return f"+91{bare}"
    if digits.startswith("0") and len(digits) == 11:
        bare = digits[1:]
        if _INDIAN_MOBILE_RE.match(bare):
            return f"+91{bare}"
    if _INDIAN_MOBILE_RE.match(digits):
        return f"+91{digits}"

    # Non-Indian: require E.164 form (original had leading +)
    if s.startswith("+") and _E164_RE.match(s):
        if indian_only:
            raise ValueError(
                f"Only Indian (+91) numbers are supported for MSG91; got '{raw}'."
            )
        return s

    raise ValueError(
        f"Cannot parse '{raw}' as a valid phone number. "
        f"Use E.164 format: +CountryCodeNumber (e.g. +919876543210 or +12025551234)."
    )


def normalize_indian_phone(raw: str) -> str:
    """Backward-compatible wrapper — Indian numbers only."""
    return normalize_phone_e164(raw, indian_only=True)

# ── Settings helper ───────────────────────────────────────────────────────────

def _get(db: Session, key: str, lodge_id: Optional[int], default: str = "") -> str:
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    row = q.first()
    return (row.setting_value or default) if row else default


# ── Twilio driver ─────────────────────────────────────────────────────────────

def _send_twilio(to_e164: str, message: str, db: Session, lodge_id: Optional[int]) -> Dict[str, Any]:
    """Send SMS via Twilio. Returns {ok, sid, error}."""
    account_sid = _get(db, "twilio_account_sid",  lodge_id)
    auth_token  = (
        _get(db, "twilio_auth_token",  lodge_id) or
        _get(db, "sms_api_key",        lodge_id)
    )
    sender = _get(db, "sms_from_number", lodge_id)

    if not account_sid or not auth_token:
        return {"ok": False, "error": "Twilio credentials not configured (missing Account SID or Auth Token)"}
    if not sender:
        return {"ok": False, "error": "Twilio sender not configured (set 'sms_from_number' in Settings)"}

    try:
        from twilio.rest import Client
        client = Client(account_sid, auth_token)
        kw = {"body": message, "to": to_e164}
        if sender.upper().startswith("MG"):
            kw["messaging_service_sid"] = sender
        else:
            kw["from_"] = sender

        msg = client.messages.create(**kw)
        status = (getattr(msg, "status", "") or "").lower()
        err_code = getattr(msg, "error_code", None)
        err_msg  = getattr(msg, "error_message", None)

        if status in ("failed", "undelivered") or err_code:
            return {
                "ok": False,
                "error": f"Twilio {status or 'error'} [code {err_code}]: {err_msg} (SID {msg.sid})"
            }
        return {"ok": True, "sid": msg.sid, "status": status}
    except ImportError:
        return {"ok": False, "error": "twilio package not installed — run: pip install twilio"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── MSG91 driver ──────────────────────────────────────────────────────────────

def _send_msg91(to_e164: str, message: str, db: Session, lodge_id: Optional[int]) -> Dict[str, Any]:
    """Send SMS via MSG91 (India-native, DLT-compliant).
    
    API docs: https://docs.msg91.com/reference/send-sms
    
    Required settings:
      msg91_auth_key   → API auth key from MSG91 dashboard
      msg91_sender_id  → 6-char DLT sender ID (e.g. RUSTO1)
    
    Optional:
      msg91_template_id → DLT template ID (required for transactional SMS in India)
    """
    auth_key    = _get(db, "msg91_auth_key",    lodge_id)
    sender_id   = _get(db, "msg91_sender_id",  lodge_id, "RUSTO1")
    template_id = _get(db, "msg91_template_id", lodge_id)

    if not auth_key:
        return {"ok": False, "error": "MSG91 auth key not configured"}
    if not sender_id:
        return {"ok": False, "error": "MSG91 sender ID not configured (6-char DLT sender)"}

    # MSG91 expects 10-digit or 12-digit (with 91) format
    phone_10 = to_e164.replace("+91", "")
    phone_91 = f"91{phone_10}"

    payload: Dict[str, Any] = {
        "sender":   sender_id[:6].upper(),
        "route":    "4",  # 4 = Transactional
        "country":  "91",
        "sms": [{
            "message": message,
            "to":      [phone_91],
        }],
    }
    if template_id:
        payload["sms"][0]["template_id"] = template_id

    try:
        import urllib.request
        import urllib.parse
        import json as _json

        url = "https://api.msg91.com/api/sendhttp.php"
        # Use the JSON endpoint
        req_url = "https://api.msg91.com/api/v5/flow/"
        headers = {
            "Content-Type": "application/json",
            "authkey":      auth_key,
        }
        # Simplified v5 flow payload
        flow_payload = {
            "flow_id":       template_id or "",
            "sender":        sender_id[:6].upper(),
            "mobiles":       phone_91,
            "VAR1":          message,  # default variable
        }
        if not template_id:
            # Fall back to legacy API for lodges without template IDs
            params = urllib.parse.urlencode({
                "authkey":  auth_key,
                "mobiles":  phone_91,
                "message":  message,
                "sender":   sender_id[:6].upper(),
                "route":    "4",
                "country":  "91",
            })
            resp = urllib.request.urlopen(
                urllib.request.Request(
                    f"https://api.msg91.com/api/sendhttp.php?{params}",
                    method="GET"
                ),
                timeout=15
            )
            body = resp.read().decode()
            if body.startswith("Message sent successfully") or "Success" in body:
                return {"ok": True, "sid": body.strip(), "status": "queued"}
            return {"ok": False, "error": f"MSG91: {body.strip()}"}

        # Template-based send (DLT compliant)
        data = _json.dumps(flow_payload).encode()
        req = urllib.request.Request(
            "https://api.msg91.com/api/v5/flow/",
            data=data,
            headers=headers,
            method="POST"
        )
        resp = urllib.request.urlopen(req, timeout=15)
        result = _json.loads(resp.read())
        if result.get("type") == "success":
            return {"ok": True, "sid": str(result.get("request_id", "")), "status": "queued"}
        return {"ok": False, "error": result.get("message", "MSG91 error")}

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Public API ────────────────────────────────────────────────────────────────

def send_sms(db: Session, phone: str, message: str,
             checkin_id: Optional[int] = None,
             customer_id: Optional[int] = None,
             event_type: str = "custom",
             lodge_id: Optional[int] = None) -> Alert:
    """Send SMS via the lodge's configured provider (Twilio or MSG91).
    Creates an Alert row regardless of outcome so every send attempt is logged.
    """
    from ..models import Checkin, Customer as CustomerModel

    # Resolve lodge from linked records if not given
    resolved = lodge_id
    if resolved is None and checkin_id:
        ch = db.query(Checkin).filter(Checkin.checkin_id == checkin_id).first()
        if ch: resolved = ch.lodge_id
    if resolved is None and customer_id:
        c = db.query(CustomerModel).filter(CustomerModel.customer_id == customer_id).first()
        if c: resolved = c.lodge_id
    if resolved is None:
        resolved = 1  # fallback for single-lodge installs

    alert = Alert(
        lodge_id=resolved,
        checkin_id=checkin_id,
        customer_id=customer_id,
        alert_type=AlertType.sms,
        event_type=event_type,
        recipient=phone,
        message_content=message,
        status=AlertStatus.pending,
    )
    db.add(alert)
    db.flush()

    # Validate phone — Twilio accepts international numbers, MSG91 is India-only
    provider_check = _get(db, "sms_provider", resolved, "twilio").lower().strip()
    indian_only = (provider_check == "msg91")
    try:
        to_e164 = normalize_phone_e164(phone, indian_only=indian_only)
    except ValueError as e:
        alert.status = AlertStatus.failed
        alert.error_message = str(e)
        db.commit()
        return alert

    # Check if SMS is globally enabled for this lodge
    sms_enabled = _get(db, "sms_enabled", resolved, "false").lower() == "true"
    if not sms_enabled:
        alert.status = AlertStatus.skipped
        alert.error_message = "SMS disabled for this lodge (enable in Settings → Alerts)"
        db.commit()
        return alert

    # Route to vendor
    provider = _get(db, "sms_provider", resolved, "twilio").lower().strip()

    if provider == "twilio":
        result = _send_twilio(to_e164, message, db, resolved)
    elif provider == "msg91":
        result = _send_msg91(to_e164, message, db, resolved)
    else:
        alert.status = AlertStatus.skipped
        alert.error_message = f"Unknown SMS provider: '{provider}'. Set sms_provider to 'twilio' or 'msg91'"
        db.commit()
        return alert

    if result["ok"]:
        alert.status = AlertStatus.sent
        alert.sent_at = _utcnow()
        alert.error_message = f"{provider.upper()} SID {result.get('sid', '')} ({result.get('status', 'queued')})"
        logger.info(f"SMS sent to {phone} via {provider}: {result.get('sid')}")
    else:
        alert.status = AlertStatus.failed
        alert.error_message = result["error"]
        logger.error(f"SMS failed to {phone} via {provider}: {result['error']}")

    db.commit()
    return alert


# ── Vendor config summary ─────────────────────────────────────────────────────

def get_sms_vendor_status(db: Session, lodge_id: Optional[int]) -> Dict[str, Any]:
    """Return SMS configuration status for the Settings page display."""
    provider  = _get(db, "sms_provider",  lodge_id, "twilio")
    enabled   = _get(db, "sms_enabled",   lodge_id, "false").lower() == "true"

    twilio_sid       = _get(db, "twilio_account_sid", lodge_id)
    twilio_token     = _get(db, "twilio_auth_token",  lodge_id)
    twilio_from      = _get(db, "sms_from_number",    lodge_id)
    msg91_key        = _get(db, "msg91_auth_key",      lodge_id)
    msg91_sender     = _get(db, "msg91_sender_id",    lodge_id)

    twilio_ready = bool(twilio_sid and twilio_token and twilio_from)
    msg91_ready  = bool(msg91_key and msg91_sender)

    return {
        "enabled":       enabled,
        "provider":      provider,
        "twilio": {
            "configured": twilio_ready,
            "account_sid": bool(twilio_sid),
            "auth_token":  bool(twilio_token),
            "from_number": bool(twilio_from),
        },
        "msg91": {
            "configured":  msg91_ready,
            "auth_key":    bool(msg91_key),
            "sender_id":   bool(msg91_sender),
            "sender_value": msg91_sender,
        },
        "active_vendor_ready": (
            twilio_ready if provider == "twilio" else msg91_ready
        ),
    }
