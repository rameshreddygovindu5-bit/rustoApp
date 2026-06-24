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
from datetime import date, datetime, timezone
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
    return f"RB-{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y%m%d')}-{suffix}"


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
        "meal_plan": getattr(b, "meal_plan", None),
        "status": b.status,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }
    if include_lodge:
        lodge = db.query(Lodge).filter(Lodge.lodge_id == b.lodge_id).first()
        if lodge:
            # Try to get the branded name from settings
            hotel_name_setting = None
            try:
                from ..models import Setting
                hn = db.query(Setting).filter(
                    Setting.lodge_id == lodge.lodge_id,
                    Setting.setting_key == "hotel_name"
                ).first()
                hotel_name_setting = hn.setting_value if hn else None
            except Exception:
                pass
            out["lodge"] = {
                "code": lodge.code,
                "name": hotel_name_setting or lodge.name,
                "display_name": hotel_name_setting or lodge.name,
                "city": lodge.public_city, "state": lodge.public_state,
                "address": lodge.address, "phone": lodge.phone,
                "logo_url": None,  # Could add later
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
                        rooms_count: int, nights: int,
                        checkin_date=None) -> tuple:
    """Returns (tariff_per_night, subtotal, gst_amount, total_amount).

    Tariff = base_tariff resolved through active rate plans (seasonal /
    weekend pricing). GST rate comes from the lodge's setting (default 12%).
    All Decimals — money arithmetic must never use float.
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
    base_tariff = Decimal(str(row))
    # Apply active rate plans (dynamic pricing)
    try:
        from .rate_plans import resolve_tariff
        resolved = resolve_tariff(db, lodge_id, room_type,
                                   checkin_date or datetime.now(timezone.utc).replace(tzinfo=None).date())
        tariff = Decimal(str(resolved)) if resolved else base_tariff
    except Exception:
        tariff = base_tariff
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
    meal_plan:        Optional[str] = Field(default=None, max_length=20)   # ep/cp/map/ap
    promo_code:       Optional[str] = Field(default=None, max_length=40)   # validated promo code


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
        db, lodge.lodge_id, body.room_type, body.rooms_count, nights,
        checkin_date=body.checkin_date
    )

    # ── Promo discount ──────────────────────────────────────────────
    promo_discount = Decimal("0")
    promo_ref      = None
    if body.promo_code:
        try:
            from .promos import apply_promo_to_booking
            promo_res = apply_promo_to_booking(
                db, lodge.lodge_id, body.promo_code.upper().strip(), float(subtotal)
            )
            if promo_res:
                promo_discount = Decimal(str(promo_res.get("discount_amount", 0)))
                promo_ref = body.promo_code.upper().strip()
        except Exception as _pe:
            logger.warning("Promo apply failed: %s", _pe)

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
        meal_plan=body.meal_plan or None,
        promo_code=promo_ref,
        promo_discount=promo_discount,
        status=CustomerBookingStatus.payment_pending.value,
    )
    db.add(booking); db.flush()      # need booking_id for the Payment

    # Auto-confirm for lodges with instant_confirm=True (e.g. small lodges that trust direct bookings)
    # These lodges don't require payment upfront through the platform.
    lodge_obj = db.query(Lodge).filter(Lodge.lodge_id == lodge.lodge_id).first()
    is_instant = bool(getattr(lodge_obj, "instant_confirm", False))

    # Razorpay expects amount in PAISE (1/100th of a rupee).

    final_total = max(Decimal("0"), total - promo_discount)
    amount_paise = int(final_total * Decimal("100"))
    if amount_paise < 100:  # Razorpay minimum ₹1
        amount_paise = 100

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
    payment.paid_at = datetime.now(timezone.utc).replace(tzinfo=None)
    b.status = CustomerBookingStatus.confirmed.value

    # v10.2 — Auto-create a PMS Booking so lodge admin sees it immediately
    # in their Bookings list, Dashboard and Check-ins. Non-fatal if it fails.
    pms_booking = None
    try:
        pms_booking = _sync_customer_booking_to_pms(db, b)
        if pms_booking:
            logger.info("Auto-created PMS booking %s for customer booking %s",
                        pms_booking.booking_ref, b.booking_ref)
    except Exception as _sync_err:
        logger.error("PMS sync failed (non-fatal): %s", _sync_err)

    # v10.2 — Notify lodge admin via SMS/Alert about new online booking
    try:
        from ..services.alert_service import get_setting, send_sms, is_sms_enabled
        if is_sms_enabled(db, lodge_id=b.lodge_id):
            admin_phone = get_setting(db, "admin_phone", "", lodge_id=b.lodge_id)
            if admin_phone:
                ci = b.checkin_date.strftime("%d %b") if b.checkin_date else "?"
                msg = (
                    f"[Rusto] NEW Online Booking!\n"
                    f"Ref: {b.booking_ref}\n"
                    f"Guest: {b.contact_name} ({b.contact_phone})\n"
                    f"Check-in: {ci} | {b.rooms_count}x {b.room_type}\n"
                    f"Amount: Rs.{float(b.total_amount):,.0f} (Paid Online)\n"
                    f"View in PMS > Online Bookings"
                )
                send_sms(db, admin_phone, msg, lodge_id=b.lodge_id, event_type="custom")
    except Exception as _notif_err:
        logger.warning("Admin SMS notification failed (non-fatal): %s", _notif_err)

    # v10.2 — Create in-app alert for lodge admin
    try:
        from ..models import Alert, AlertType, AlertEvent, AlertStatus
        # Create in-app alert for lodge admin
        alert_msg = (
            f"New online booking {b.booking_ref}: {b.contact_name} checks in "
            f"{b.checkin_date.strftime('%d %b %Y') if b.checkin_date else '?'} "
            f"({b.rooms_count}x {b.room_type}, "
            f"Rs.{float(b.total_amount):,.0f} paid online)"
        )
        try:
            from ..services.alert_service import get_hotel_name as _ghn
            hotel_name = _ghn(db, b.lodge_id)
        except Exception:
            hotel_name = "Rusto"
        alert_kw = {
            "lodge_id":   b.lodge_id,
            "alert_type": getattr(AlertType,  "custom", AlertType.checkin).value,
            "event_type": getattr(AlertEvent, "custom", AlertEvent.custom).value
                          if hasattr(AlertEvent, "custom")
                          else AlertEvent.checkin_reminder.value,
            "status":     AlertStatus.sent.value,
        }
        # Try both field names used across schema versions
        for msg_field in ("body", "message_body", "message"):
            try:
                alert_kw[msg_field] = alert_msg
                alert = Alert(**alert_kw)
                db.add(alert)
                db.flush()
                db.commit()
                break
            except Exception:
                alert_kw.pop(msg_field, None)
    except Exception as _alert_err:
        logger.warning("In-app alert for new booking failed: %s", _alert_err)

    # Redeem promo if applied
    if b.promo_code:
        try:
            from .promos import redeem as _promo_redeem
            _promo_redeem(
                db,
                lodge_id=b.lodge_id,
                code=b.promo_code,
                subtotal=float(b.subtotal),
                customer_id=b.customer_id
            )
        except Exception as _pr_err:
            logger.warning("Promo redemption recording failed: %s", _pr_err)

    db.commit(); db.refresh(b); db.refresh(payment)

    # Award Rusto membership points
    try:
        from .rusto_membership import post_booking_points
        post_booking_points(db, b.customer_id, b.booking_id, float(str(b.total_amount or 0)))
    except Exception as _mp_err:
        logger.warning("Membership points: %s", _mp_err)

    # Send booking confirmation email and WhatsApp to customer
    try:
        _send_customer_confirmation_email(db, b, customer)
    except Exception as _email_err:
        logger.warning("Customer confirmation email failed: %s", _email_err)

    try:
        _wa_lodge = db.query(Lodge).filter(Lodge.lodge_id == b.lodge_id).first()
        _send_customer_whatsapp(db, b, _wa_lodge, customer)
    except Exception as _wa_err:
        logger.warning("Customer WhatsApp notification failed: %s", _wa_err)

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


class ApplyPromoBody(BaseModel):
    promo_code: Optional[str] = None


@router.post("/{booking_id}/apply-promo")
def apply_promo(booking_id: int, body: ApplyPromoBody, request: Request,
                customer: RustoCustomer = Depends(get_current_customer),
                db: Session = Depends(get_db)):
    """Validate a promo code, apply it to an active unpaid booking, and regenerate
    the Razorpay order/Payment session with the discounted amount.
    """
    b = (db.query(CustomerBooking)
         .filter(CustomerBooking.booking_id == booking_id,
                 CustomerBooking.customer_id == customer.customer_id).first())
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")

    if b.status not in (CustomerBookingStatus.payment_pending.value,
                        CustomerBookingStatus.initiated.value):
        raise HTTPException(status_code=400, detail="Cannot apply promo to this booking")

    if body.promo_code and body.promo_code.strip():
        # Validate the promo code using helper in promos.py
        from .promos import validate_and_compute_discount
        try:
            promo_info = validate_and_compute_discount(db, b.lodge_id, body.promo_code.strip().upper(), float(b.subtotal))
            b.promo_code = promo_info["code"]
            b.promo_discount = Decimal(str(promo_info["discount_amount"]))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Promo code validation error: {e}")
    else:
        b.promo_code = None
        b.promo_discount = Decimal("0")

    # Calculate new final amount
    final_total = max(Decimal("0"), b.total_amount - b.promo_discount)
    amount_paise = int(final_total * Decimal("100"))
    if amount_paise < 100:  # Razorpay minimum ₹1
        amount_paise = 100

    # Create new Razorpay order
    try:
        order = _razorpay_create_order(amount_paise, receipt=b.booking_ref)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Razorpay order recreate failed")
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {e}")

    # Mark existing unpaid payments for this booking as failed
    db.query(Payment).filter(
        Payment.customer_booking_id == b.booking_id,
        Payment.status == PaymentStatus.created.value
    ).update({"status": PaymentStatus.failed.value})

    # Create new Payment record
    payment = Payment(
        customer_booking_id=b.booking_id,
        amount=final_total, currency="INR", gateway="razorpay",
        razorpay_order_id=order["id"],
        status=PaymentStatus.created.value,
    )
    db.add(payment)
    db.commit()
    db.refresh(b)
    db.refresh(payment)

    # Resolve lodge info for response
    lodge = db.query(Lodge).filter(Lodge.lodge_id == b.lodge_id).first()

    return {
        "booking": _booking_to_dict(b, db),
        "razorpay": {
            "key_id": RAZORPAY_KEY_ID,
            "order_id": order["id"],
            "amount": amount_paise,
            "currency": "INR",
            "name": "Rusto",
            "description": f"Booking {b.booking_ref} at {lodge.name if lodge else 'Rusto'}",
            "prefill": {
                "name": customer.full_name,
                "email": customer.email or "",
                "contact": customer.phone,
            },
            "is_mock": order.get("_mock", False),
        },
    }



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
    b.cancelled_at = datetime.now(timezone.utc).replace(tzinfo=None)
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


# ── Customer booking confirmation email ──────────────────────────────

def _send_customer_confirmation_email(db, booking, customer) -> bool:
    """Send HTML booking confirmation to the customer's email.

    Falls back gracefully if SMTP is not configured or email is missing.
    """
    import os, smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    email_to = getattr(customer, "email", None)
    if not email_to:
        return False

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    if not smtp_host:
        return False

    # Build lodge name from settings or fallback
    from ..models import Setting, Lodge
    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    hotel_name_s = db.query(Setting).filter(
        Setting.lodge_id == booking.lodge_id,
        Setting.setting_key == "hotel_name"
    ).first()
    hotel_name = (hotel_name_s.setting_value if hotel_name_s else None) or (lodge.name if lodge else "The Property")

    ci  = booking.checkin_date.strftime("%d %b %Y") if booking.checkin_date else "—"
    co  = booking.checkout_date.strftime("%d %b %Y") if booking.checkout_date else "—"
    amt = f"₹{float(booking.total_amount):,.0f}" if booking.total_amount else "—"

    html = f"""
    <html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1B2A4A">
      <div style="background:#1B2A4A;padding:24px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:24px">Rusto</h1>
        <p style="color:#fff;margin:8px 0 0;font-size:14px">Your booking is confirmed! 🎉</p>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:none">
        <h2 style="color:#1B2A4A;font-size:20px;margin:0 0 16px">
          {hotel_name}
        </h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Booking Ref</td>
              <td style="padding:8px;font-family:monospace">{booking.booking_ref}</td></tr>
          <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Check-in</td>
              <td style="padding:8px">{ci}</td></tr>
          <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Check-out</td>
              <td style="padding:8px">{co}</td></tr>
          <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Room Type</td>
              <td style="padding:8px">{booking.room_type_label or booking.room_type}</td></tr>
          <tr><td style="padding:8px;background:#f9fafb;font-weight:600">Total Paid</td>
              <td style="padding:8px;font-weight:700;color:#C9A84C">{amt}</td></tr>
        </table>
        {f'<p style="margin:16px 0 4px;font-size:13px;color:#6b7280">Special requests: <em>{booking.special_requests}</em></p>' if booking.special_requests else ""}
        <p style="margin:20px 0 8px;font-size:13px">
          Need help? Reply to this email or visit rusto.in/support.
        </p>
        <a href="https://rusto.in/account/bookings"
           style="display:inline-block;background:#C9A84C;color:#1B2A4A;padding:12px 24px;
                  border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px">
          View My Booking
        </a>
      </div>
      <div style="padding:16px;text-align:center;font-size:11px;color:#9ca3af">
        © Rusto · Travel Anywhere. Rest Everywhere.
      </div>
    </body></html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"✅ Booking Confirmed — {hotel_name} | Ref {booking.booking_ref}"
    msg["From"]    = smtp_user
    msg["To"]      = email_to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as s:
        s.starttls()
        s.login(smtp_user, smtp_pass)
        s.sendmail(smtp_user, [email_to], msg.as_string())
    return True


# ── Customer invoice/receipt endpoint ───────────────────────────────

@router.get("/{booking_id}/receipt")
def get_receipt(booking_id: int,
                customer: RustoCustomer = Depends(get_current_customer),
                db: Session = Depends(get_db)):
    """Get booking receipt as JSON. Frontend renders to HTML/PDF."""
    b = db.query(CustomerBooking).filter(
        CustomerBooking.booking_id == booking_id,
        CustomerBooking.customer_id == customer.customer_id,
    ).first()
    if not b:
        raise HTTPException(404, "Booking not found")

    from ..models import Setting, Lodge
    lodge = db.query(Lodge).filter(Lodge.lodge_id == b.lodge_id).first()
    hn = db.query(Setting).filter(
        Setting.lodge_id == b.lodge_id, Setting.setting_key == "hotel_name"
    ).first()
    gstin_s = db.query(Setting).filter(
        Setting.lodge_id == b.lodge_id, Setting.setting_key == "gstin"
    ).first()
    addr_s = db.query(Setting).filter(
        Setting.lodge_id == b.lodge_id, Setting.setting_key == "hotel_address"
    ).first()

    return {
        "booking_ref":    b.booking_ref,
        "hotel_name":     (hn.setting_value if hn else None) or (lodge.name if lodge else ""),
        "hotel_address":  (addr_s.setting_value if addr_s else None) or (lodge.address if lodge else ""),
        "hotel_gstin":    gstin_s.setting_value if gstin_s else "",
        "hotel_phone":    lodge.phone if lodge else "",
        "hotel_email":    lodge.email if lodge else "",
        "guest_name":     b.contact_name,
        "guest_phone":    b.contact_phone,
        "guest_email":    b.contact_email,
        "checkin_date":   b.checkin_date.isoformat() if b.checkin_date else None,
        "checkout_date":  b.checkout_date.isoformat() if b.checkout_date else None,
        "nights":         b.nights,
        "room_type":      getattr(b, "room_type_label", None) or b.room_type,
                "rooms_count":    b.rooms_count,
        "adults":         b.adults,
        "children":       b.children,
        "meal_plan":      getattr(b, "meal_plan", None),
        "special_requests": b.special_requests,
        "tariff_per_night": float(b.tariff_per_night),
        "subtotal":         float(b.subtotal),
        "gst_amount":       float(b.gst_amount),
        "total_amount":     float(b.total_amount),
        "payment_method":   getattr(b, "payment_method", "Online"),
        "status":           b.status,
        "created_at":       b.created_at.isoformat() if b.created_at else None,
    }


def _send_customer_whatsapp(db, booking, lodge, customer) -> bool:
    """Send WhatsApp booking confirmation if lodge has WhatsApp configured.

    Uses the lodge's WhatsApp Business API credentials (stored in settings).
    Falls back gracefully if not configured.
    """
    import os, requests

    # Check if WhatsApp is configured (lodge setting)
    from ..models import Setting
    wa_token_s = db.query(Setting).filter(
        Setting.lodge_id == booking.lodge_id,
        Setting.setting_key == "wa_access_token",
    ).first()
    wa_phone_s = db.query(Setting).filter(
        Setting.lodge_id == booking.lodge_id,
        Setting.setting_key == "wa_phone_id",
    ).first()

    wa_token = wa_token_s.setting_value if wa_token_s else os.getenv("WA_ACCESS_TOKEN", "")
    wa_phone = wa_phone_s.setting_value if wa_phone_s else os.getenv("WA_PHONE_ID", "")

    if not wa_token or not wa_phone:
        return False

    to_phone = customer.phone
    if not to_phone:
        return False
    # Normalize to E.164 (add +91 if Indian and doesn't start with +)
    if not to_phone.startswith("+"):
        to_phone = "+91" + to_phone.lstrip("0")

    hotel_name = lodge.name if lodge else "The Property"
    ci  = booking.checkin_date.strftime("%d %b %Y") if booking.checkin_date else "—"
    ref = booking.booking_ref

    url = f"https://graph.facebook.com/v19.0/{wa_phone}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {
            "body": (
                f"✅ Booking Confirmed!\n\n"
                f"🏨 {hotel_name}\n"
                f"📅 Check-in: {ci}\n"
                f"🔖 Ref: {ref}\n\n"
                f"View your booking: https://rusto.in/account/bookings\n\n"
                f"Have a wonderful stay! 🌟 — Rusto"
            )
        },
    }
    resp = requests.post(url, headers={"Authorization": f"Bearer {wa_token}"}, json=payload, timeout=8)
    return resp.status_code == 200


# ── v10.2: Bridge function — creates PMS Booking from confirmed CustomerBooking ──

def _sync_customer_booking_to_pms(db, customer_booking: "CustomerBooking") -> "Booking | None":
    """
    After a customer's online payment is confirmed, create (or update) a PMS
    Booking record so the lodge admin sees it in their Bookings list, Dashboard
    stats, and can perform check-in from the PMS without any manual re-entry.

    Returns the created/updated PMS Booking, or None if something goes wrong
    (we log and continue — never let this break the payment confirmation).

    Strategy:
    - If CustomerBooking.linked_checkin_id is already set, the lodge admin has
      already assigned the booking → skip.
    - Otherwise create a new PMS Booking with source='online' and advance_amount
      set to total_amount (payment already received online).
    - Link CustomerBooking.linked_pms_booking_id so we can find it later.
    """
    from ..models import Booking, BookingSource, BookingStatus, RoomType
    import secrets, string

    try:
        # Guard: already linked
        if getattr(customer_booking, "linked_checkin_id", None):
            return None  # Checkin already created by lodge staff

        # Guard: already has a PMS booking for this customer_booking
        if getattr(customer_booking, "linked_pms_booking_id", None):
            existing = db.query(Booking).filter(
                Booking.booking_id == customer_booking.linked_pms_booking_id
            ).first()
            if existing:
                return existing  # already synced

        # Generate a short PMS booking ref (different format from RB-... customer ref)
        def _gen_pms_ref():
            suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
            from datetime import datetime
            return f"ONL-{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y%m%d')}-{suffix}"

        for _ in range(5):
            pms_ref = _gen_pms_ref()
            if not db.query(Booking).filter(Booking.booking_ref == pms_ref).first():
                break

        # Map room_type string to RoomType enum (graceful fallback to non_ac)
        try:
            room_type_enum = RoomType(customer_booking.room_type)
        except ValueError:
            # room_type doesn't match enum exactly — use the closest available
            rt_map = {rt.value: rt for rt in RoomType}
            room_type_enum = rt_map.get(customer_booking.room_type, RoomType.non_ac)

        pms_booking = Booking(
            lodge_id=customer_booking.lodge_id,
            booking_ref=pms_ref,
            source=BookingSource.online,
            # Guest details from customer booking snapshot
            guest_name=customer_booking.contact_name,
            guest_phone=customer_booking.contact_phone,
            guest_email=customer_booking.contact_email,
            # Room details
            room_type_requested=room_type_enum,
            rooms_count=customer_booking.rooms_count,
            checkin_date=customer_booking.checkin_date,
            checkout_date=customer_booking.checkout_date,
            nights=customer_booking.nights,
            adults=customer_booking.adults,
            children=customer_booking.children,
            # Pricing
            tariff_per_night=customer_booking.tariff_per_night,
            total_amount=customer_booking.total_amount,
            # Mark as fully pre-paid (online payment collected)
            advance_amount=customer_booking.total_amount,
            advance_payment_mode="online",
            payment_status="paid",
            # Misc
            special_requests=customer_booking.special_requests,
            meal_plan=getattr(customer_booking, "meal_plan", None),
            promo_code=getattr(customer_booking, "promo_code", None),
            promo_discount=getattr(customer_booking, "promo_discount", 0),
            status=BookingStatus.confirmed,  # Auto-confirmed (payment received)
            # No created_by_user_id — this was a marketplace booking
        )
        db.add(pms_booking)
        db.flush()  # get booking_id

        # Link back to the CustomerBooking so the lodge can find it
        try:
            customer_booking.linked_pms_booking_id = pms_booking.booking_id
        except AttributeError:
            pass  # column may not exist yet on old schema

        db.commit()
        db.refresh(pms_booking)
        logger.info(
            "Synced CustomerBooking %s → PMS Booking %s (ref %s) for lodge %s",
            customer_booking.booking_id, pms_booking.booking_id,
            pms_ref, customer_booking.lodge_id
        )
        return pms_booking

    except Exception as _e:
        db.rollback()
        logger.error("Failed to sync CustomerBooking %s to PMS: %s",
                     getattr(customer_booking, "booking_id", "?"), _e)
        return None
