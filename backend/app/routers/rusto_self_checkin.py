"""QR Self Check-In — v9.0.

Lodge admin generates a QR check-in token for a confirmed customer booking.
Customer scans the QR and checks in without visiting the front desk.

Endpoints:
  LODGE ADMIN:
    POST  /api/rusto/listing/self-checkin/{booking_id}/generate
          → creates/refreshes the token, returns QR data
    GET   /api/rusto/listing/self-checkin/{booking_id}
          → current token status

  CUSTOMER:
    POST  /api/rusto/self-checkin/validate
          → validate + mark used; returns room assignment
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..database import get_db
from ..models import (SelfCheckinToken, CustomerBooking, CustomerBookingStatus,
                       Lodge)
from ..auth import require_admin, resolve_lodge_scope
from ..rusto_auth import get_current_customer

logger = logging.getLogger(__name__)

admin_router   = APIRouter(prefix="/api/rusto/listing/self-checkin", tags=["rusto-self-checkin"])
customer_router = APIRouter(prefix="/api/rusto/self-checkin", tags=["rusto-self-checkin"])


def _token_dict(t: SelfCheckinToken) -> dict:
    return {
        "token_id":    t.token_id,
        "booking_id":  t.booking_id,
        "token":       t.token,
        "room_number": t.room_number,
        "valid_from":  t.valid_from.isoformat(),
        "valid_until": t.valid_until.isoformat(),
        "used_at":     t.used_at.isoformat() if t.used_at else None,
        "is_valid":    (t.used_at is None and
                        t.valid_from <= _utcnow() <= t.valid_until),
        "qr_data": f"rusto://self-checkin/{t.token}",
    }


class GenerateTokenBody(BaseModel):
    room_number: Optional[str] = None
    valid_hours_before: int = 2   # token active N hours before checkin
    valid_hours_after: int = 4    # token expires N hours after checkin window


@admin_router.post("/{booking_id}/generate")
def generate_token(
    booking_id: int,
    body: GenerateTokenBody,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    bk = db.query(CustomerBooking).filter(
        CustomerBooking.booking_id == booking_id,
        CustomerBooking.lodge_id == lodge_id,
        CustomerBooking.status == CustomerBookingStatus.confirmed.value,
    ).first()
    if not bk:
        raise HTTPException(404, "Confirmed booking not found for this lodge")

    # Expire any existing token
    existing = db.query(SelfCheckinToken).filter(
        SelfCheckinToken.booking_id == booking_id
    ).first()
    if existing:
        db.delete(existing)

    checkin_dt = datetime.combine(bk.checkin_date, datetime.min.time())
    valid_from  = checkin_dt - timedelta(hours=body.valid_hours_before)
    valid_until = checkin_dt + timedelta(hours=body.valid_hours_after)

    token_str = secrets.token_urlsafe(32)
    t = SelfCheckinToken(
        booking_id=booking_id,
        lodge_id=lodge_id,
        token=token_str,
        room_number=body.room_number,
        valid_from=valid_from,
        valid_until=valid_until,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _token_dict(t)


@admin_router.get("/{booking_id}")
def get_token(
    booking_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    t = db.query(SelfCheckinToken).filter(
        SelfCheckinToken.booking_id == booking_id,
        SelfCheckinToken.lodge_id == lodge_id,
    ).first()
    if not t:
        raise HTTPException(404, "No self check-in token found")
    return _token_dict(t)


class ValidateBody(BaseModel):
    token: str


@customer_router.post("/validate")
def validate_token(
    body: ValidateBody,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    t = db.query(SelfCheckinToken).filter(
        SelfCheckinToken.token == body.token
    ).first()
    if not t:
        raise HTTPException(400, "Invalid check-in code")
    if t.used_at:
        raise HTTPException(400, "This check-in code has already been used")
    now = _utcnow()
    if not (t.valid_from <= now <= t.valid_until):
        raise HTTPException(400, "Check-in code is not valid at this time")

    # Verify this booking belongs to the current customer
    bk = db.query(CustomerBooking).filter(
        CustomerBooking.booking_id == t.booking_id,
        CustomerBooking.customer_id == customer.customer_id,
    ).first()
    if not bk:
        raise HTTPException(403, "This check-in code is not for your booking")

    # Mark used + update booking status
    t.used_at = now
    bk.status = CustomerBookingStatus.checked_in.value
    db.commit()

    # Auto-create PMS Checkin record so lodge admin can see the self-check-in
    try:
        from ..models import (Checkin, CheckinStatus, Customer as PmsCustomer,
                               Room as PmsRoom)
        # Find or create a PMS customer record for this Rusto customer
        pms_cust = db.query(PmsCustomer).filter(
            PmsCustomer.lodge_id == t.lodge_id,
            PmsCustomer.phone == customer.phone,
        ).first()
        if not pms_cust:
            pms_cust = PmsCustomer(
                lodge_id=t.lodge_id,
                full_name=bk.contact_name or customer.full_name,
                phone=customer.phone,
                email=customer.email or "",
            )
            db.add(pms_cust)
            db.flush()

        # Find the room (if assigned by lodge)
        room = None
        if t.room_number:
            room = db.query(PmsRoom).filter(
                PmsRoom.lodge_id == t.lodge_id,
                PmsRoom.room_number == t.room_number,
            ).first()

        # Create checkin if not already exists for this booking
        existing_ci = db.query(Checkin).filter(
            Checkin.lodge_id == t.lodge_id,
            Checkin.customer_id == pms_cust.customer_id,
            Checkin.checkin_date == bk.checkin_date,
        ).first()
        if not existing_ci:
            ci = Checkin(
                lodge_id=t.lodge_id,
                customer_id=pms_cust.customer_id,
                room_id=room.room_id if room else None,
                checkin_date=bk.checkin_date,
                checkout_date=bk.checkout_date,
                adults=bk.adults or 1,
                children=bk.children or 0,
                tariff_per_night=float(bk.tariff_per_night),
                status=CheckinStatus.active.value,
                source="rusto_self_checkin",
                notes=f"Self-checked in via Rusto QR. Online booking ref: {bk.booking_ref}",
            )
            db.add(ci)
            db.commit()
    except Exception as _ci_err:
        import logging as _log
        _log.getLogger(__name__).warning("PMS checkin sync failed: %s", _ci_err)

    lodge = db.query(Lodge).filter(Lodge.lodge_id == t.lodge_id).first()
    return {
        "success": True,
        "message": "Welcome! You are now checked in.",
        "room_number": t.room_number or "Your room will be shown at reception",
        "lodge_name":  lodge.name if lodge else "",
        "checkin_date": bk.checkin_date.isoformat(),
        "checkout_date": bk.checkout_date.isoformat(),
        "booking_ref":   bk.booking_ref,
    }
