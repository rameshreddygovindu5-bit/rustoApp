"""RustoCustomer bookings + Razorpay payments.

Razorpay flow (sandbox-friendly):
  1. POST /api/rusto/bookings          → create booking + order
  2. Open Razorpay Checkout on the client with order_id
  3. POST /api/rusto/bookings/{id}/verify-payment with the signature
  4. Server verifies the HMAC-SHA256 signature and marks paid

We do NOT use Razorpay webhooks in this round — they add infrastructure
complexity (public endpoint, secret rotation). Signature verification on
the explicit verify call is the standard fallback and works fine for
sandbox + first-production rollout. We can add webhook receipt + idempotent
reconciliation in a later round.

Endpoints:
  GET    /api/rusto/bookings              — list my bookings
  POST   /api/rusto/bookings              — create + initiate payment
  GET    /api/rusto/bookings/{id}         — booking detail
  POST   /api/rusto/bookings/{id}/verify-payment   — finalize after Razorpay returns
  POST   /api/rusto/bookings/{id}/cancel  — cancel pre-checkin
"""
import os
import hmac
import hashlib
import secrets
import string
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import (CustomerBooking, RustoCustomer, Payment, Lodge, Setting,
                       CustomerBookingStatus, PaymentStatus)
from ..rusto_auth import get_current_customer
from ..routers.rusto_public import _available_inventory, _room_type_label
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rusto/bookings", tags=["rusto-bookings"])


# ── Razorpay config — pull from env. Sandbox keys are free + safe to
#    commit to your private repo's .env.example as placeholders.
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "rzp_test_DUMMY_KEY")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "DUMMY_SECRET_FOR_DEV")
# Sandbox flag — when no real key configured we go into a degraded
# "mock" mode where verification accepts any signature so dev can
# exercise the flow without a real Razorpay account.
RAZORPAY_LIVE = not RAZORPAY_KEY_ID.startswith("rzp_test_DUMMY")


def _generate_booking_ref() -> str:
    """RB-YYYYMMDD-XXXX — short, scannable. Collision-checked on insert."""
    suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"RB-{datetime.utcnow().strftime('%Y%m%d')}-{suffix}"


def _booking_to_dict(b: CustomerBooking, db: Session,
                      include_payment: bool = True,
                      include_lodge: bool = True) -> dict:
    out = {
        "booking_id": b.booking_id,
        "booking_ref": b.booking_ref,
        "lodge_id": b.lodge_id,
        "room_type": b.room_type,
        "room_type_label": _room_type_label(b.room_type),
        "rooms_count": b.rooms_count,
        "checkin_date": b.checkin_date.isoformat(),
        "checkout_date": b.checkout_date.isoformat(),
        "nights": b.nights,
        "adults": b.adults, "children": b.children,
        "tariff_per_night": float(b.tariff_per_night),
        "subtotal": float(b.subtotal),
        "gst_amount": float(b.gst_amount),
        "total_amount": float(b.total_amount),
        "contact_name": b.contact_name,
        "contact_phone": b.contact_phone,
        "contact_email": b.contact_email,
        "special_requests": b.special_requests,
        "status": b.status,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }
    if include_lodge:
        lodge = db.query(Lodge).filter(Lodge.lodge_id == b.lodge_id).first()
        if lodge:
            out["lodge"] = {
                "code": lodge.code, "name": lodge.name,
                "city": lodge.public_city, "state": lodge.public_state,
                "address": lodge.address, "phone": lodge.phone,
            }
    if include_payment:
        latest = (db.query(Payment)
                  .filter(Payment.customer_booking_id == b.booking_id)
                  .order_by(Payment.created_at.desc()).first())
        if latest:
            out["payment"] = {
                "payment_id": latest.payment_id,
                "amount": float(latest.amount),
                "status": latest.status,
                "razorpay_order_id": latest.razorpay_order_id,
                "razorpay_payment_id": latest.razorpay_payment_id,
                "method": latest.method,
                "paid_at": latest.paid_at.isoformat() if latest.paid_at else None,
            }
    return out


# ── Pricing helper ──────────────────────────────────────────────────

def _calculate_pricing(db: Session, lodge_id: int, room_type: str,
                        rooms_count: int, nights: int) -> tuple:
    """Returns (tariff_per_night, subtotal, gst_amount, total_amount).

    Tariff = the lodge's lowest base_tariff for that room type. GST rate
    comes from the lodge's setting (default 12%). All Decimals — money
    arithmetic must never use float.
    """
    from ..models import Room
    from sqlalchemy import func as sf
    row = (db.query(sf.min(Room.base_tariff))
           .filter(Room.lodge_id == lodge_id,
                   Room.room_type == room_type,
                   Room.status != "blocked").scalar())
    if not row:
        raise HTTPException(status_code=400,
                            detail=f"No rooms of type '{room_type}' available at this lodge")
    tariff = Decimal(str(row))
    subtotal = tariff * rooms_count * nights

    # GST setting per lodge.
    gst_setting = (db.query(Setting)
                   .filter(Setting.lodge_id == lodge_id,
                           Setting.setting_key == "gst_rate").first())
    gst_rate = Decimal(gst_setting.setting_value) if gst_setting and gst_setting.setting_value else Decimal("12")
    gst_enabled_setting = (db.query(Setting)
                            .filter(Setting.lodge_id == lodge_id,
                                    Setting.setting_key == "gst_enabled").first())
    gst_enabled = (gst_enabled_setting.setting_value or "true").lower() == "true" if gst_enabled_setting else True
    gst_amount = (subtotal * gst_rate / Decimal("100")).quantize(Decimal("0.01")) if gst_enabled else Decimal("0.00")
    total = (subtotal + gst_amount).quantize(Decimal("0.01"))
    return tariff, subtotal.quantize(Decimal("0.01")), gst_amount, total


# ── Razorpay helpers ────────────────────────────────────────────────

def _razorpay_create_order(amount_in_paise: int, receipt: str) -> dict:
    """Create a Razorpay order. In dev (no key), returns a mock order
    so the flow is still testable end-to-end."""
    if not RAZORPAY_LIVE:
        # Mock order. Frontend renders a "Pay (test mode)" button that
        # immediately calls verify-payment with mock signature.
        return {
            "id": f"order_mock_{secrets.token_hex(8)}",
            "amount": amount_in_paise,
            "currency": "INR",
            "receipt": receipt,
            "_mock": True,
        }
    # Real Razorpay API call — kept inline to avoid pulling the razorpay
    # SDK as a dependency. The auth is HTTP basic with key_id:secret.
    import requests
    r = requests.post(
        "https://api.razorpay.com/v1/orders",
        auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
        json={"amount": amount_in_paise, "currency": "INR", "receipt": receipt},
        timeout=20,
    )
    if r.status_code >= 400:
        raise HTTPException(status_code=502,
                            detail=f"Razorpay order creation failed: {r.text[:200]}")
    return r.json()


def _razorpay_verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Razorpay's signature scheme: HMAC-SHA256 over 'order_id|payment_id'.
    In mock mode we accept signature == 'mock_signature' for testability."""
    if not RAZORPAY_LIVE:
        return signature == "mock_signature"
    payload = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Endpoints ───────────────────────────────────────────────────────

class CreateBookingBody(BaseModel):
    lodge_code: str = Field(min_length=2, max_length=40)
    room_type: str = Field(min_length=2, max_length=30)
    rooms_count: int = Field(ge=1, le=20)
    checkin_date: str          # YYYY-MM-DD
    checkout_date: str
    adults: int = Field(ge=1, le=20)
    children: int = Field(ge=0, le=20)
    # Snapshot fields — defaults pulled from customer profile but caller
    # may override (booking on behalf of someone else).
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    special_requests: Optional[str] = Field(default=None, max_length=2000)


@router.get("")
def list_my_bookings(customer: RustoCustomer = Depends(get_current_customer),
                      db: Session = Depends(get_db),
                      status: Optional[str] = None):
    q = db.query(CustomerBooking).filter(CustomerBooking.customer_id == customer.customer_id)
    if status:
        q = q.filter(CustomerBooking.status == status)
    rows = q.order_by(CustomerBooking.created_at.desc()).limit(200).all()
    return [_booking_to_dict(b, db, include_payment=True) for b in rows]


@router.get("/{booking_id}")
def get_my_booking(booking_id: int,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    b = (db.query(CustomerBooking)
         .filter(CustomerBooking.booking_id == booking_id,
                 CustomerBooking.customer_id == customer.customer_id).first())
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return _booking_to_dict(b, db, include_payment=True)


@router.post("", status_code=201)
def create_booking(body: CreateBookingBody, request: Request,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    """Create a booking + initiate Razorpay order in one transaction.

    Capacity check is re-done here (not just at search) — between the
    customer seeing availability and pressing 'pay', someone else may
    have booked the same room. We reject with 409 if so.
    """
    lodge = (db.query(Lodge)
             .filter(Lodge.code == body.lodge_code.lower(),
                     Lodge.is_published == True).first())
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found or not bookable")

    try:
        from_d = date.fromisoformat(body.checkin_date)
        to_d = date.fromisoformat(body.checkout_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if to_d <= from_d:
        raise HTTPException(status_code=400, detail="checkout must be after checkin")
    if from_d < date.today():
        raise HTTPException(status_code=400, detail="Cannot book past dates")
    nights = (to_d - from_d).days
    if nights > 90:
        raise HTTPException(status_code=400, detail="Maximum 90-night stay")

    # Capacity re-check.
    avail = _available_inventory(db, lodge.lodge_id, from_d, to_d)
    if avail.get(body.room_type, 0) < body.rooms_count:
        raise HTTPException(
            status_code=409,
            detail=f"Only {avail.get(body.room_type, 0)} {_room_type_label(body.room_type)} room(s) available for these dates. Try a different date or room type.",
        )

    # Pricing.
    tariff, subtotal, gst, total = _calculate_pricing(
        db, lodge.lodge_id, body.room_type, body.rooms_count, nights
    )

    # Generate unique ref (retry on collision).
    for _ in range(5):
        ref = _generate_booking_ref()
        if not db.query(CustomerBooking).filter(CustomerBooking.booking_ref == ref).first():
            break
    else:
        raise HTTPException(status_code=500, detail="Could not allocate booking ref; please retry")

    booking = CustomerBooking(
        booking_ref=ref,
        customer_id=customer.customer_id,
        lodge_id=lodge.lodge_id,
        room_type=body.room_type,
        rooms_count=body.rooms_count,
        checkin_date=from_d, checkout_date=to_d, nights=nights,
        adults=body.adults, children=body.children,
        tariff_per_night=tariff, subtotal=subtotal, gst_amount=gst, total_amount=total,
        contact_name=(body.contact_name or customer.full_name).strip(),
        contact_phone=(body.contact_phone or customer.phone).strip(),
        contact_email=(body.contact_email or customer.email or "").strip() or None,
        special_requests=(body.special_requests or "").strip() or None,
        status=CustomerBookingStatus.payment_pending.value,
    )
    db.add(booking); db.flush()      # need booking_id for the Payment

    # Razorpay expects amount in PAISE (1/100th of a rupee).
    amount_paise = int(total * Decimal("100"))
    try:
        order = _razorpay_create_order(amount_paise, receipt=ref)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Razorpay order create failed")
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {e}")

    payment = Payment(
        customer_booking_id=booking.booking_id,
        amount=total, currency="INR", gateway="razorpay",
        razorpay_order_id=order["id"],
        status=PaymentStatus.created.value,
    )
    db.add(payment); db.commit(); db.refresh(booking); db.refresh(payment)

    # Audit for the lodge admin's activity feed.
    try:
        log_audit(db, "rusto_booking.initiated",
                  actor_user_id=None, actor_username=f"customer:{customer.phone}",
                  entity_type="rusto_customer_booking", entity_id=booking.booking_id,
                  lodge_id=lodge.lodge_id,
                  details={"ref": ref, "room_type": body.room_type,
                            "rooms": body.rooms_count, "amount": float(total)},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass

    return {
        "booking": _booking_to_dict(booking, db),
        "razorpay": {
            "key_id": RAZORPAY_KEY_ID,
            "order_id": order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "name": "Rusto",
            "description": f"Booking {ref} at {lodge.name}",
            "prefill": {
                "name": customer.full_name,
                "email": customer.email or "",
                "contact": customer.phone,
            },
            "is_mock": order.get("_mock", False),
        },
    }


class VerifyPaymentBody(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/{booking_id}/verify-payment")
def verify_payment(booking_id: int, body: VerifyPaymentBody, request: Request,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    """Verify Razorpay signature + finalize the booking.

    Called by the Rusto frontend after the Razorpay Checkout completes.
    We verify the HMAC signature; on success we mark Payment.paid and
    flip CustomerBooking.confirmed. On signature mismatch we log a
    `fraud_attempt` audit event and refuse.
    """
    b = (db.query(CustomerBooking)
         .filter(CustomerBooking.booking_id == booking_id,
                 CustomerBooking.customer_id == customer.customer_id).first())
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status not in (CustomerBookingStatus.payment_pending.value,
                         CustomerBookingStatus.initiated.value):
        # Idempotent: already confirmed → just return the booking.
        if b.status == CustomerBookingStatus.confirmed.value:
            return {"already_confirmed": True, "booking": _booking_to_dict(b, db)}
        raise HTTPException(status_code=400,
                            detail=f"Cannot verify payment for a {b.status} booking")

    payment = (db.query(Payment)
               .filter(Payment.customer_booking_id == b.booking_id,
                       Payment.razorpay_order_id == body.razorpay_order_id).first())
    if not payment:
        raise HTTPException(status_code=404, detail="Payment record not found for this order_id")

    ok = _razorpay_verify_signature(body.razorpay_order_id,
                                      body.razorpay_payment_id,
                                      body.razorpay_signature)
    if not ok:
        payment.status = PaymentStatus.failed.value
        payment.error_payload = json.dumps({"reason": "signature_mismatch"})
        b.status = CustomerBookingStatus.payment_failed.value
        db.commit()
        try:
            log_audit(db, "rusto_payment.signature_failure",
                      actor_user_id=None, actor_username=f"customer:{customer.phone}",
                      entity_type="rusto_payment", entity_id=payment.payment_id,
                      lodge_id=b.lodge_id,
                      details={"booking_ref": b.booking_ref,
                                "razorpay_payment_id": body.razorpay_payment_id},
                      ip_address=request.client.host if request.client else None)
        except Exception: pass
        raise HTTPException(status_code=400, detail="Payment signature verification failed")

    payment.razorpay_payment_id = body.razorpay_payment_id
    payment.razorpay_signature = body.razorpay_signature
    payment.status = PaymentStatus.paid.value
    payment.paid_at = datetime.utcnow()
    b.status = CustomerBookingStatus.confirmed.value
    db.commit(); db.refresh(b); db.refresh(payment)

    try:
        log_audit(db, "rusto_booking.confirmed",
                  actor_user_id=None, actor_username=f"customer:{customer.phone}",
                  entity_type="rusto_customer_booking", entity_id=b.booking_id,
                  lodge_id=b.lodge_id,
                  details={"ref": b.booking_ref, "amount": float(payment.amount),
                            "razorpay_payment_id": body.razorpay_payment_id},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass

    # v7.0 — fire-and-forget WhatsApp confirmation. Catches all exceptions
    # because a WhatsApp outage must NOT break the payment confirmation
    # response (the customer's money is already in our account).
    try:
        from ..services import whatsapp_service as wa
        wa.send_booking_confirmation(db, b)
    except Exception:
        logger.exception("WhatsApp booking confirmation failed (non-fatal)")

    return {"verified": True, "booking": _booking_to_dict(b, db)}


class CancelBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)


@router.post("/{booking_id}/cancel")
def cancel_booking(booking_id: int, body: CancelBody,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    """RustoCustomer-side cancellation. Allowed only before checked_in.
    Refund handling is OUT OF SCOPE for this round — we just mark the
    booking cancelled and free up the inventory hold.

    Future round: integrate Razorpay refunds via the /refunds API."""
    b = (db.query(CustomerBooking)
         .filter(CustomerBooking.booking_id == booking_id,
                 CustomerBooking.customer_id == customer.customer_id).first())
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status in (CustomerBookingStatus.checked_in.value,
                     CustomerBookingStatus.checked_out.value,
                     CustomerBookingStatus.cancelled.value):
        raise HTTPException(status_code=400,
                            detail=f"Cannot cancel a {b.status} booking")
    b.status = CustomerBookingStatus.cancelled.value
    b.cancelled_at = datetime.utcnow()
    b.cancellation_reason = (body.reason or "Cancelled by customer")[:2000]
    db.commit(); db.refresh(b)
    try:
        log_audit(db, "rusto_booking.cancelled",
                  actor_user_id=None, actor_username=f"customer:{customer.phone}",
                  entity_type="rusto_customer_booking", entity_id=b.booking_id,
                  lodge_id=b.lodge_id,
                  details={"ref": b.booking_ref, "reason": (body.reason or "")[:200]})
    except Exception: pass
    return _booking_to_dict(b, db)
