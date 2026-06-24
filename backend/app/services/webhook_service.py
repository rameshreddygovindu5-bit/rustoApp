"""
Webhook dispatcher.

When a booking changes state, we POST a JSON payload to the partner's webhook_url.
Each request is signed with HMAC-SHA256 using the partner's webhook_secret so they
can verify it actually came from us.

Headers we send:
  Content-Type:        application/json
  X-LMS-Event:         booking.confirmed
  X-LMS-Signature:     sha256=<hex digest>
  X-LMS-Delivery-Id:   <delivery row id>
"""
import json, hmac, hashlib, logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..models import Agency, Booking, WebhookDelivery, WebhookStatus

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
TIMEOUT_SECONDS = 8


def _booking_payload(booking: Booking) -> dict:
    return {
        "booking_ref": booking.booking_ref,
        "agency_booking_ref": booking.agency_booking_ref,
        "status": booking.status.value if hasattr(booking.status, "value") else booking.status,
        "guest_name": booking.guest_name,
        "guest_phone": booking.guest_phone,
        "guest_email": booking.guest_email,
        "checkin_date": booking.checkin_date.isoformat() if booking.checkin_date else None,
        "checkout_date": booking.checkout_date.isoformat() if booking.checkout_date else None,
        "nights": booking.nights,
        "room_type": (booking.room_type_requested.value
                      if hasattr(booking.room_type_requested, "value")
                      else booking.room_type_requested),
        "room_number": booking.room.room_number if booking.room else None,
        "tariff_per_night": float(booking.tariff_per_night),
        "total_amount": float(booking.total_amount),
        "commission_amount": float(booking.commission_amount or 0),
        "payment_status": booking.payment_status,
        "cancellation_reason": booking.cancellation_reason,
        "updated_at": booking.updated_at.isoformat() if booking.updated_at else None,
    }


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def queue_webhook(db: Session, agency: Agency, booking: Booking, event_type: str):
    """Queue a webhook delivery (created in pending state, then dispatched)."""
    if not agency or not agency.webhook_url:
        return None

    payload = {
        "event": event_type,
        "delivered_at": _utcnow().isoformat() + "Z",
        "data": _booking_payload(booking),
    }
    delivery = WebhookDelivery(
        lodge_id=booking.lodge_id,
        agency_id=agency.agency_id,
        booking_id=booking.booking_id,
        event_type=event_type,
        payload=json.dumps(payload),
        status=WebhookStatus.pending,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)

    # Best-effort sync attempt; the scheduler will retry failed ones.
    try:
        _attempt(db, agency, delivery)
    except Exception as e:
        logger.warning(f"Initial webhook attempt failed: {e}")
    return delivery


def _attempt(db: Session, agency: Agency, delivery: WebhookDelivery):
    """One delivery attempt. Marks delivery row with result."""
    try:
        import requests  # imported lazily so the rest of the app works without it
    except ImportError:
        logger.error("requests not installed; cannot dispatch webhook")
        delivery.status = WebhookStatus.failed
        delivery.response_body = "requests library not installed"
        db.commit()
        return

    body = delivery.payload.encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Rusto-Webhook/1.0",
        "X-LMS-Event": delivery.event_type,
        "X-LMS-Delivery-Id": str(delivery.id),
        "X-LMS-Signature": _sign(agency.webhook_secret or "", body),
    }
    delivery.attempt_count = (delivery.attempt_count or 0) + 1
    delivery.last_attempt_at = _utcnow()

    try:
        resp = requests.post(agency.webhook_url, data=body, headers=headers, timeout=TIMEOUT_SECONDS)
        delivery.response_code = resp.status_code
        delivery.response_body = (resp.text or "")[:1000]
        if 200 <= resp.status_code < 300:
            delivery.status = WebhookStatus.delivered
            logger.info(f"Webhook delivered to {agency.code}: {delivery.event_type}")
        elif delivery.attempt_count >= MAX_ATTEMPTS:
            delivery.status = WebhookStatus.failed
        else:
            delivery.status = WebhookStatus.pending
    except Exception as e:
        delivery.response_body = str(e)[:1000]
        if delivery.attempt_count >= MAX_ATTEMPTS:
            delivery.status = WebhookStatus.failed
        else:
            delivery.status = WebhookStatus.pending
        logger.warning(f"Webhook dispatch error (attempt {delivery.attempt_count}): {e}")

    db.commit()


def retry_pending_webhooks(db: Session, max_to_process: int = 50):
    """Called by the scheduler every few minutes."""
    pending = (db.query(WebhookDelivery)
               .filter(WebhookDelivery.status == WebhookStatus.pending,
                       WebhookDelivery.attempt_count < MAX_ATTEMPTS)
               .order_by(WebhookDelivery.created_at)
               .limit(max_to_process)
               .all())
    for delivery in pending:
        agency = db.query(Agency).filter(Agency.agency_id == delivery.agency_id).first()
        if agency and agency.webhook_url:
            _attempt(db, agency, delivery)
    return len(pending)
