"""WhatsApp Business API integration — v7.0.

Why this module exists:
  India runs on WhatsApp. Email open rates hover near 20% even for
  transactional mail; WhatsApp gets 90%+ within minutes. For a booking
  marketplace this is the single highest-leverage channel for
  confirmations, payment nudges, pre-arrival reminders, and the
  post-checkout review request that closes the loop with v6's reviews.

Architecture:
  - `WhatsAppProvider` abstract base: send_template(...) → result dict
  - `MockProvider` (default, used unless explicit config exists): logs
    the would-be send to DB with status='sent' so dev/test flows work
    end-to-end without a live Meta account
  - `MetaCloudProvider`: calls graph.facebook.com using the lodge's own
    Meta credentials. Each lodge brings their own access token + phone
    number ID (multi-tenant separation of sender identity)

  - `MessageReason` enum: documented set of why-we-sent-this strings
  - `TEMPLATES` dict: catalog of template metadata that mirrors what
    the lodge has registered with Meta. Body text is illustrative only;
    Meta enforces the actual body from its own server-side approval.

Lifecycle integration points (called from other code):
  - `send_booking_confirmation(db, booking)`     — inline, after pay verify
  - `send_payment_pending_nudge(db, booking)`    — scheduled, 1h after init
  - `send_checkin_reminder(db, booking)`         — scheduled, 24h pre-arrival
  - `send_review_request(db, booking)`           — scheduled, 4h post-checkout

Status callbacks:
  Meta posts to /api/webhooks/whatsapp/{lodge_id} when messages move
  through sent→delivered→read or fail. Handled by routers/whatsapp.py.
"""
from __future__ import annotations
import os
import re
import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from sqlalchemy.orm import Session

from ..models import (Lodge, RustoCustomer, CustomerBooking, Review,
                       WhatsAppMessage, WhatsAppMessageStatus)

logger = logging.getLogger(__name__)


# ── Configuration ─────────────────────────────────────────────────

# Global env overrides: when set, used as fallback if a lodge doesn't
# have its own credentials. Mostly useful for dev (one shared sandbox
# WABA across all test lodges).
GLOBAL_ACCESS_TOKEN     = os.getenv("WHATSAPP_ACCESS_TOKEN") or None
GLOBAL_PHONE_NUMBER_ID  = os.getenv("WHATSAPP_PHONE_NUMBER_ID") or None
# Set this to your own webhook verify token when wiring up Meta callbacks.
WEBHOOK_VERIFY_TOKEN    = os.getenv("WHATSAPP_VERIFY_TOKEN", "rusto-wa-verify")
META_GRAPH_VERSION      = os.getenv("WHATSAPP_GRAPH_VERSION", "v20.0")
# Force-mock toggle for development. When True, NO real API calls are
# made regardless of how credentials are configured. Default False.
FORCE_MOCK = os.getenv("WHATSAPP_FORCE_MOCK", "").lower() in ("1", "true", "yes")


# ── Template catalog ──────────────────────────────────────────────

class MessageReason:
    """Why we're sending this WhatsApp message — pre-defined for analytics
    and lifecycle dedup (don't send the same reminder twice)."""
    booking_confirmation = "booking_confirmation"
    payment_pending      = "payment_pending_nudge"
    checkin_reminder     = "checkin_reminder"
    review_request       = "review_request"
    cancellation         = "cancellation_notice"


# Template metadata. The `name` and `lang` MUST match what's registered
# with Meta. The `body_preview` is for our own UI/logs — Meta serves the
# actual body from its server, we just supply params.
#
# Category drives Meta's pricing: utility messages (transactional like
# booking confirmation) are cheaper than marketing (review request can
# qualify as utility too, since it relates to a recent transaction).
TEMPLATES: Dict[str, Dict[str, Any]] = {
    "rusto_booking_confirmed": {
        "name":          "rusto_booking_confirmed",
        "lang":          "en",
        "category":      "utility",
        "body_preview": ("Your Rusto booking {{booking_ref}} at {{lodge_name}} is "
                         "CONFIRMED for {{checkin_date}}. Total paid ₹{{total}}. "
                         "See you soon!"),
        # Param order MUST match the {{1}}, {{2}}, ... placeholders in
        # the approved Meta template. We document that mapping here for
        # the lodge admin who's setting up templates on Meta's side.
        "params":        ["booking_ref", "lodge_name", "checkin_date", "total"],
    },
    "rusto_payment_pending": {
        "name":          "rusto_payment_pending",
        "lang":          "en",
        "category":      "utility",
        "body_preview": ("Your Rusto booking {{booking_ref}} at {{lodge_name}} is "
                         "almost done — complete your ₹{{total}} payment to lock "
                         "it in: {{payment_link}}"),
        "params":        ["booking_ref", "lodge_name", "total", "payment_link"],
    },
    "rusto_checkin_reminder": {
        "name":          "rusto_checkin_reminder",
        "lang":          "en",
        "category":      "utility",
        "body_preview": ("Reminder: check-in at {{lodge_name}} tomorrow "
                         "({{checkin_date}}). Address: {{address}}. Phone: "
                         "{{lodge_phone}}. Safe travels!"),
        "params":        ["lodge_name", "checkin_date", "address", "lodge_phone"],
    },
    "rusto_review_request": {
        "name":          "rusto_review_request",
        "lang":          "en",
        "category":      "utility",
        "body_preview": ("Thanks for staying at {{lodge_name}}! Mind sharing how "
                         "it went? Tap to leave a quick review: {{review_link}}"),
        "params":        ["lodge_name", "review_link"],
    },
}


# ── Phone normalization ───────────────────────────────────────────

def normalize_phone_in(raw: str) -> Optional[str]:
    """Return an E.164-style phone string suitable for Meta's API.

    Meta wants: digits only, with country code, no '+'. e.g., '919123456789'.

    Our DB stores phones in various formats from years of legacy: '+91-91234-56789',
    '9123456789', '91 91234 56789'. Normalize them all to a canonical form.

    For Indian numbers (10 digits, starting with 6-9) we prepend '91' if
    not already present. Anything else we accept as-is provided it's
    10+ digits — multi-country handling is a future-Rusto concern.
    """
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    # Trim leading zeros that some forms have
    digits = digits.lstrip("0") or digits
    # Indian 10-digit case — prepend country code
    if len(digits) == 10 and digits[0] in "6789":
        return "91" + digits
    if len(digits) >= 11:
        return digits
    return None


# ── Provider abstraction ──────────────────────────────────────────

class WhatsAppProvider(ABC):
    """Pluggable transport for outbound WhatsApp messages."""

    @abstractmethod
    def send_template(self, *, to_phone: str, template_name: str,
                       template_lang: str, params: List[str]) -> Dict[str, Any]:
        """Send a templated message. Returns a result dict:
            {ok: bool, provider_message_id: str|None, error_code: str|None,
             error_detail: str|None}
        """

    @property
    @abstractmethod
    def provider_name(self) -> str: ...


class MockProvider(WhatsAppProvider):
    """No-op provider that just logs. Used in dev + when a lodge has not
    configured real WhatsApp credentials. Always returns ok=True so the
    rest of the lifecycle (DB rows, status transitions) exercises end-to-end.

    The returned provider_message_id is a deterministic fake based on the
    current timestamp so duplicate sends within the same second collide
    (which is fine — our caller-side dedup handles that)."""

    provider_name = "mock"

    def send_template(self, *, to_phone, template_name, template_lang, params):
        fake_id = f"mock.{int(_utcnow().timestamp() * 1000)}.{to_phone[-4:]}"
        logger.info("WhatsApp[mock] → %s template=%s params=%s",
                    to_phone, template_name, params)
        return {
            "ok": True,
            "provider_message_id": fake_id,
            "error_code": None,
            "error_detail": None,
        }


class MetaCloudProvider(WhatsAppProvider):
    """Real Meta Cloud API provider. Each instance is bound to one
    lodge's credentials (token + phone_number_id)."""

    provider_name = "meta_cloud"

    def __init__(self, access_token: str, phone_number_id: str):
        self.access_token = access_token
        self.phone_number_id = phone_number_id

    def send_template(self, *, to_phone, template_name, template_lang, params):
        # Import requests lazily so the rest of the app doesn't have a
        # hard dep on it unless live WhatsApp is actually used.
        import requests
        url = (f"https://graph.facebook.com/{META_GRAPH_VERSION}"
               f"/{self.phone_number_id}/messages")
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type":  "application/json",
        }
        body = {
            "messaging_product": "whatsapp",
            "recipient_type":    "individual",
            "to":                to_phone,
            "type":              "template",
            "template": {
                "name":     template_name,
                "language": {"code": template_lang},
                "components": ([{
                    "type": "body",
                    "parameters": [{"type": "text", "text": str(p)} for p in params],
                }] if params else []),
            },
        }
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            data = resp.json() if resp.content else {}
        except Exception as e:
            return {"ok": False, "provider_message_id": None,
                    "error_code": "network_error", "error_detail": str(e)}

        if resp.status_code >= 400:
            err = data.get("error", {})
            return {
                "ok": False, "provider_message_id": None,
                "error_code": str(err.get("code", resp.status_code)),
                "error_detail": err.get("message") or resp.text[:300],
            }
        msg_id = (data.get("messages") or [{}])[0].get("id")
        return {
            "ok": True,
            "provider_message_id": msg_id,
            "error_code": None,
            "error_detail": None,
        }


def get_provider_for_lodge(lodge: Lodge) -> WhatsAppProvider:
    """Pick the provider implementation to use for this lodge.

    Resolution order:
      1. WHATSAPP_FORCE_MOCK env → MockProvider (overrides everything; for tests)
      2. Lodge has its own access_token + phone_number_id → MetaCloudProvider
      3. Global env credentials present → MetaCloudProvider (shared dev sandbox)
      4. Otherwise → MockProvider
    """
    if FORCE_MOCK:
        return MockProvider()
    if lodge.whatsapp_access_token and lodge.whatsapp_phone_number_id:
        return MetaCloudProvider(lodge.whatsapp_access_token,
                                  lodge.whatsapp_phone_number_id)
    if GLOBAL_ACCESS_TOKEN and GLOBAL_PHONE_NUMBER_ID:
        return MetaCloudProvider(GLOBAL_ACCESS_TOKEN, GLOBAL_PHONE_NUMBER_ID)
    return MockProvider()


# ── Core send + logging ───────────────────────────────────────────

def _enabled_for_lodge(lodge: Optional[Lodge]) -> bool:
    """Per-lodge feature gate. False if WhatsApp not enabled on the lodge.

    Note: when running under FORCE_MOCK we still respect this flag, so
    a lodge with WhatsApp off doesn't see fake outbound messages either.
    """
    return bool(lodge and lodge.whatsapp_enabled)


def _already_sent_for_reason(db: Session, *, booking_id: int, reason: str) -> bool:
    """De-dup gate: returns True if we've already sent (or are queued to
    send) a message with this reason for this booking, in any non-failed
    status. Prevents the scheduled jobs from sending the same reminder
    twice if a previous run crashed mid-loop.

    Allows retries when the previous attempt failed (status=failed) — admin
    intent there is usually "try again", not "leave it alone".
    """
    q = (db.query(WhatsAppMessage)
            .filter(WhatsAppMessage.related_booking_id == booking_id,
                    WhatsAppMessage.reason == reason,
                    WhatsAppMessage.status != WhatsAppMessageStatus.failed.value))
    return db.query(q.exists()).scalar()


def _send_template(db: Session, *, lodge: Lodge, customer: Optional[RustoCustomer],
                    to_phone: str, template_key: str, params: List[Any],
                    reason: str,
                    booking_id: Optional[int] = None,
                    review_id: Optional[int] = None) -> WhatsAppMessage:
    """Single-shot send helper. Creates the WhatsAppMessage row, picks
    the provider, dispatches, updates the row with the result. Returns
    the persisted row (caller can inspect status to know if it worked).

    Exceptions from the provider are caught and recorded — we never
    raise out of here, because we don't want a WhatsApp outage to break
    booking confirmation flows.
    """
    tmpl = TEMPLATES.get(template_key)
    if not tmpl:
        raise ValueError(f"Unknown WhatsApp template: {template_key}")
    # Stringify params with care — Decimal → str without scientific notation,
    # dates → ISO. Meta requires strings.
    str_params = [_param_to_str(p) for p in params]

    msg = WhatsAppMessage(
        lodge_id=lodge.lodge_id,
        customer_id=customer.customer_id if customer else None,
        to_phone=to_phone,
        template_name=tmpl["name"],
        template_lang=tmpl["lang"],
        template_category=tmpl["category"],
        template_params=json.dumps(str_params),
        reason=reason,
        related_booking_id=booking_id,
        related_review_id=review_id,
        status=WhatsAppMessageStatus.queued.value,
    )
    db.add(msg); db.flush()   # get an ID without committing

    provider = get_provider_for_lodge(lodge)
    msg.provider = provider.provider_name
    try:
        result = provider.send_template(
            to_phone=to_phone, template_name=tmpl["name"],
            template_lang=tmpl["lang"], params=str_params,
        )
    except Exception as e:
        # Should never happen — providers return error dicts — but defensive.
        logger.exception("WhatsApp provider raised unexpectedly")
        result = {"ok": False, "provider_message_id": None,
                  "error_code": "provider_exception", "error_detail": str(e)}

    if result["ok"]:
        msg.status = WhatsAppMessageStatus.sent.value
        msg.sent_at = _utcnow()
        msg.provider_message_id = result["provider_message_id"]
    else:
        msg.status = WhatsAppMessageStatus.failed.value
        msg.failed_at = _utcnow()
        msg.error_code = result.get("error_code")
        msg.error_detail = result.get("error_detail")
        logger.warning("WhatsApp send failed lodge=%s phone=%s reason=%s: %s",
                       lodge.lodge_id, to_phone, reason, msg.error_detail)

    db.commit(); db.refresh(msg)
    return msg


def _param_to_str(p: Any) -> str:
    if p is None:
        return ""
    if isinstance(p, Decimal):
        # Indian rupee amounts — strip trailing zeros from the decimal.
        # Drop ".00" but keep "₹1,500.50" precision.
        return ("{:.2f}".format(p)).rstrip("0").rstrip(".") or "0"
    if hasattr(p, "isoformat"):
        return p.isoformat()
    return str(p)


# ── Lifecycle entry points ────────────────────────────────────────

def send_booking_confirmation(db: Session, booking: CustomerBooking) -> Optional[WhatsAppMessage]:
    """Called inline after a booking transitions to status='confirmed'.

    Idempotent — calling twice for the same booking will skip the second
    send via the dedup gate.
    """
    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    if not _enabled_for_lodge(lodge):
        return None
    if _already_sent_for_reason(db, booking_id=booking.booking_id,
                                  reason=MessageReason.booking_confirmation):
        return None
    phone = normalize_phone_in(booking.contact_phone)
    if not phone:
        return None
    customer = (db.query(RustoCustomer)
                  .filter(RustoCustomer.customer_id == booking.customer_id).first())
    return _send_template(
        db, lodge=lodge, customer=customer, to_phone=phone,
        template_key="rusto_booking_confirmed",
        params=[booking.booking_ref, lodge.name, booking.checkin_date,
                int(booking.total_amount)],
        reason=MessageReason.booking_confirmation,
        booking_id=booking.booking_id,
    )


def send_payment_pending_nudge(db: Session, booking: CustomerBooking,
                                 payment_link: str) -> Optional[WhatsAppMessage]:
    """Scheduled — 1h after a booking enters payment_pending without
    progressing. Skips if already confirmed/cancelled in the meantime."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    if not _enabled_for_lodge(lodge):
        return None
    if booking.status != "payment_pending":
        return None
    if _already_sent_for_reason(db, booking_id=booking.booking_id,
                                  reason=MessageReason.payment_pending):
        return None
    phone = normalize_phone_in(booking.contact_phone)
    if not phone:
        return None
    customer = (db.query(RustoCustomer)
                  .filter(RustoCustomer.customer_id == booking.customer_id).first())
    return _send_template(
        db, lodge=lodge, customer=customer, to_phone=phone,
        template_key="rusto_payment_pending",
        params=[booking.booking_ref, lodge.name, int(booking.total_amount), payment_link],
        reason=MessageReason.payment_pending,
        booking_id=booking.booking_id,
    )


def send_checkin_reminder(db: Session, booking: CustomerBooking) -> Optional[WhatsAppMessage]:
    """Scheduled — 24h before checkin date on confirmed bookings."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    if not _enabled_for_lodge(lodge):
        return None
    if booking.status not in ("confirmed",):
        return None
    if _already_sent_for_reason(db, booking_id=booking.booking_id,
                                  reason=MessageReason.checkin_reminder):
        return None
    phone = normalize_phone_in(booking.contact_phone)
    if not phone:
        return None
    customer = (db.query(RustoCustomer)
                  .filter(RustoCustomer.customer_id == booking.customer_id).first())
    return _send_template(
        db, lodge=lodge, customer=customer, to_phone=phone,
        template_key="rusto_checkin_reminder",
        params=[lodge.name, booking.checkin_date,
                lodge.address or "Contact lodge for directions",
                lodge.phone or ""],
        reason=MessageReason.checkin_reminder,
        booking_id=booking.booking_id,
    )


def send_review_request(db: Session, booking: CustomerBooking,
                          review_link: str) -> Optional[WhatsAppMessage]:
    """Scheduled — 4h after checkout. Skips if the customer already
    reviewed this booking."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    if not _enabled_for_lodge(lodge):
        return None
    if booking.status != "checked_out":
        return None
    existing_review = (db.query(Review)
                         .filter(Review.booking_id == booking.booking_id).first())
    if existing_review:
        return None
    if _already_sent_for_reason(db, booking_id=booking.booking_id,
                                  reason=MessageReason.review_request):
        return None
    phone = normalize_phone_in(booking.contact_phone)
    if not phone:
        return None
    customer = (db.query(RustoCustomer)
                  .filter(RustoCustomer.customer_id == booking.customer_id).first())
    return _send_template(
        db, lodge=lodge, customer=customer, to_phone=phone,
        template_key="rusto_review_request",
        params=[lodge.name, review_link],
        reason=MessageReason.review_request,
        booking_id=booking.booking_id,
    )


# ── Inbound status callback (from Meta webhook) ───────────────────

def apply_status_update(db: Session, *, provider_message_id: str,
                          new_status: str, timestamp: Optional[datetime] = None,
                          error_code: Optional[str] = None,
                          error_detail: Optional[str] = None) -> bool:
    """Apply a delivery status callback from Meta. Returns True if the
    row was found + updated.

    Status transitions are monotonic: we never downgrade from 'read' back
    to 'delivered', etc. This protects against out-of-order webhook delivery.
    """
    STATUS_ORDER = [
        WhatsAppMessageStatus.queued.value,
        WhatsAppMessageStatus.sent.value,
        WhatsAppMessageStatus.delivered.value,
        WhatsAppMessageStatus.read.value,
    ]
    msg = (db.query(WhatsAppMessage)
             .filter(WhatsAppMessage.provider_message_id == provider_message_id)
             .first())
    if not msg:
        logger.warning("WhatsApp status webhook: unknown message id %s",
                       provider_message_id)
        return False
    now = timestamp or _utcnow()

    if new_status == WhatsAppMessageStatus.failed.value:
        # Failure is always honoured regardless of monotonic order — a
        # message that delivered then bounced (rare but possible) flips
        # to failed so the admin notices.
        msg.status = new_status
        msg.failed_at = now
        msg.error_code = error_code
        msg.error_detail = error_detail
    elif new_status in STATUS_ORDER:
        try:
            current_idx = STATUS_ORDER.index(msg.status)
            new_idx = STATUS_ORDER.index(new_status)
            if new_idx > current_idx:
                msg.status = new_status
                if new_status == WhatsAppMessageStatus.delivered.value:
                    msg.delivered_at = now
                elif new_status == WhatsAppMessageStatus.read.value:
                    msg.read_at = now
        except ValueError:
            pass  # current status not in normal flow (e.g., failed) — ignore
    else:
        # Unknown status string from Meta — log + ignore
        logger.warning("WhatsApp status: unknown new_status=%r", new_status)
        return False

    db.commit()
    return True
