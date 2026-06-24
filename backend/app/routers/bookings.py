"""
Internal bookings router. Staff/admin manage all bookings (walk-in + agency).
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, date, timezone

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..database import get_db
from ..models import (Booking, BookingStatus, BookingSource, Customer,
                      Room, RoomType, RoomStatus, Checkin, CheckinStatus)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..permissions import require_permission
from ..services.audit_service import log_audit
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/bookings", tags=["bookings"])


def _to_dict(b: Booking) -> dict:
    return {
        "booking_id": b.booking_id,
        "booking_ref": b.booking_ref,
        "source": b.source.value if hasattr(b.source, "value") else b.source,
        "agency_id": b.agency_id,
        "agency_name": b.agency.name if b.agency else None,
        "agency_booking_ref": b.agency_booking_ref,
        "customer_id": b.customer_id,
        "guest_name": b.guest_name,
        "guest_phone": b.guest_phone,
        "guest_email": b.guest_email,
        "room_id": b.room_id,
        "room_number": b.room.room_number if b.room else None,
        "room_type_requested": (b.room_type_requested.value
                                if hasattr(b.room_type_requested, "value")
                                else b.room_type_requested),
        "rooms_count": b.rooms_count or 1,
        "checkin_date": b.checkin_date.isoformat(),
        "checkout_date": b.checkout_date.isoformat(),
        "nights": b.nights,
        "adults": b.adults, "children": b.children,
        "tariff_per_night": float(b.tariff_per_night),
        "total_amount": float(b.total_amount),
        "advance_amount": float(b.advance_amount or 0),
        "advance_payment_mode": b.advance_payment_mode or "cash",
        "balance_due": float(b.total_amount) - float(b.advance_amount or 0),
        "commission_amount": float(b.commission_amount or 0),
        "payment_status": b.payment_status,
        "status": b.status.value if hasattr(b.status, "value") else b.status,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
        "cancellation_reason": b.cancellation_reason,
        "special_requests": b.special_requests,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "checkin_id": b.checkin.checkin_id if b.checkin else None,
    }


@router.get("", dependencies=[Depends(require_permission("bookings.read"))])
def list_bookings(
    status: Optional[str] = None,
    source: Optional[str] = None,
    agency_id: Optional[int] = None,
    search: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    page: int = 1, limit: int = 50,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    q = db.query(Booking).filter(Booking.lodge_id == lodge_id)
    if status:
        q = q.filter(Booking.status == status)
    if source:
        q = q.filter(Booking.source == source)
    if agency_id:
        q = q.filter(Booking.agency_id == agency_id)
    if from_date:
        q = q.filter(Booking.checkin_date >= from_date)
    if to_date:
        q = q.filter(Booking.checkin_date <= to_date)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            Booking.guest_name.ilike(like),
            Booking.guest_phone.like(like),
            Booking.booking_ref.like(like),
            Booking.agency_booking_ref.like(like),
        ))
    total = q.count()
    rows = (q.order_by(Booking.created_at.desc())
            .offset(max(0, page - 1) * limit)
            .limit(min(limit, 200))
            .all())
    return {"total": total, "page": page, "data": [_to_dict(b) for b in rows]}


@router.get("/upcoming-arrivals", dependencies=[Depends(require_permission("bookings.read"))])
def upcoming_arrivals(days: int = 7, db: Session = Depends(get_db),
                      current_user=Depends(get_current_user),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    today = date.today()
    from datetime import timedelta
    end = today + timedelta(days=max(1, min(days, 60)))
    rows = (db.query(Booking)
            .filter(Booking.lodge_id == lodge_id,
                    Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                    Booking.checkin_date >= today,
                    Booking.checkin_date <= end)
            .order_by(Booking.checkin_date)
            .all())
    return [_to_dict(b) for b in rows]


@router.get("/{booking_id}", dependencies=[Depends(require_permission("bookings.read"))])
def get_booking(booking_id: int, db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    b = db.query(Booking).filter(
        Booking.booking_id == booking_id,
        Booking.lodge_id == lodge_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return _to_dict(b)


class StaffBookingCreate(BaseModel):
    guest_name: str
    guest_phone: str
    guest_email: Optional[str] = None
    room_type: str
    rooms_count: int = Field(default=1, ge=1, le=20)
    checkin_date: date
    checkout_date: date
    adults: int = 1
    children: int = 0
    tariff_per_night: float
    advance_amount: float = 0
    advance_payment_mode: str = "cash"
    special_requests: Optional[str] = None
    payment_status: str = "unpaid"


@router.post("", status_code=201, dependencies=[Depends(require_permission("bookings.write"))])
def staff_create_booking(body: StaffBookingCreate, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    """Staff creates a direct booking (phone reservation, walk-in for tomorrow, etc.).

    Supports multi-room reservations: `rooms_count` rooms of the same type are
    held under one booking. The `total_amount` covers all rooms for all nights.
    """
    if body.checkout_date <= body.checkin_date:
        raise HTTPException(status_code=400, detail="checkout_date must be after checkin_date")
    if body.room_type not in [t.value for t in RoomType]:
        raise HTTPException(status_code=400, detail="Invalid room_type")
    if body.checkin_date < date.today():
        raise HTTPException(status_code=400, detail="checkin_date cannot be in the past")
    if body.tariff_per_night <= 0:
        raise HTTPException(status_code=400, detail="tariff_per_night must be positive")

    rooms_count = max(1, body.rooms_count)
    nights = (body.checkout_date - body.checkin_date).days
    # Total covers every room for every night.
    total = round(body.tariff_per_night * nights * rooms_count, 2)

    advance = round(max(0.0, body.advance_amount), 2)
    if advance > total:
        raise HTTPException(
            status_code=400,
            detail=f"Advance (₹{advance}) cannot exceed the booking total (₹{total}).",
        )

    # Booking ref prefix per-lodge: e.g. UDU-202605-0001 / RK-202605-0001.
    from ..models import Lodge
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    code_prefix = (lodge.code[:3].upper() if lodge and lodge.code else "UDM")
    today = _utcnow()
    prefix = f"{code_prefix}-{today.strftime('%Y%m')}-"
    last = (db.query(Booking)
            .filter(Booking.lodge_id == lodge_id,
                    Booking.booking_ref.like(prefix + "%"))
            .order_by(Booking.booking_id.desc()).first())
    seq = 1
    if last:
        try:
            seq = int(last.booking_ref.split("-")[-1]) + 1
        except Exception:
            seq = (last.booking_id or 0) + 1
    booking_ref = f"{prefix}{seq:04d}"

    b = Booking(
        lodge_id=lodge_id,
        booking_ref=booking_ref,
        source=BookingSource.direct,
        guest_name=body.guest_name,
        guest_phone=body.guest_phone,
        guest_email=body.guest_email,
        room_type_requested=RoomType(body.room_type),
        rooms_count=rooms_count,
        checkin_date=body.checkin_date,
        checkout_date=body.checkout_date,
        nights=nights,
        adults=body.adults, children=body.children,
        tariff_per_night=body.tariff_per_night,
        total_amount=total,
        advance_amount=advance,
        advance_payment_mode=body.advance_payment_mode or "cash",
        payment_status=("partial" if 0 < advance < total
                        else "paid" if advance >= total and total > 0
                        else body.payment_status),
        status=BookingStatus.confirmed,
        special_requests=body.special_requests,
        created_by_user_id=current_user.user_id,
    )
    db.add(b)
    db.commit()
    db.refresh(b)

    log_audit(db, "booking.created",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="booking", entity_id=b.booking_id,
              details={"ref": booking_ref, "rooms": rooms_count, "advance": advance},
              ip_address=request.client.host if request.client else None)

    # Send booking confirmation SMS + Email
    try:
        from ..services.alert_service import trigger_booking_alerts
        trigger_booking_alerts(db, b, body.guest_phone, body.guest_email)
    except Exception as e:
        logger.warning(f"Booking alert failed (non-fatal): {e}")
    # v2.6 — template-based confirmation (logs to EmailLog for browsing).
    # Runs in addition to the legacy hardcoded mail above; once an admin
    # disables the system template the new path will be skipped naturally.
    try:
        from ..services.email_service import send_booking_confirmation
        send_booking_confirmation(db, b)
    except Exception as e:
        logger.warning(f"Template email confirmation failed (non-fatal): {e}")

    return _to_dict(b)


@router.put("/{booking_id}/cancel", dependencies=[Depends(require_permission("bookings.delete"))])
def cancel_booking(booking_id: int, body: dict, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    b = db.query(Booking).filter(
        Booking.booking_id == booking_id,
        Booking.lodge_id == lodge_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status in [BookingStatus.cancelled, BookingStatus.completed,
                     BookingStatus.checked_in, BookingStatus.no_show]:
        raise HTTPException(status_code=400,
                            detail=f"Cannot cancel a booking in status: {b.status.value}")
    b.status = BookingStatus.cancelled
    b.cancelled_at = _utcnow()
    b.cancellation_reason = body.get("reason", "Cancelled by staff")
    db.commit()

    log_audit(db, "booking.cancelled",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="booking", entity_id=b.booking_id,
              details={"reason": b.cancellation_reason},
              ip_address=request.client.host if request.client else None)

    # If from agency, queue cancellation webhook
    if b.agency_id and b.agency:
        from ..services.webhook_service import queue_webhook
        queue_webhook(db, b.agency, b, "booking.cancelled")

    # Send cancellation SMS + Email to guest
    try:
        from ..services.alert_service import trigger_booking_cancelled_alerts
        trigger_booking_cancelled_alerts(db, b, b.cancellation_reason or "")
    except Exception as e:
        logger.warning(f"Booking cancellation alert failed (non-fatal): {e}")

    return _to_dict(b)


class BookingUpdate(BaseModel):
    guest_name: Optional[str] = None
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    room_type: Optional[str] = None
    rooms_count: Optional[int] = Field(default=None, ge=1, le=20)
    checkin_date: Optional[date] = None
    checkout_date: Optional[date] = None
    adults: Optional[int] = None
    children: Optional[int] = None
    tariff_per_night: Optional[float] = None
    advance_amount: Optional[float] = None
    advance_payment_mode: Optional[str] = None
    special_requests: Optional[str] = None


@router.put("/{booking_id}", dependencies=[Depends(require_permission("bookings.write"))])
def update_booking(booking_id: int, body: BookingUpdate, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Edit a pending/confirmed booking. Recomputes nights/total when dates,
    tariff or room count change."""
    b = db.query(Booking).filter(
        Booking.booking_id == booking_id,
        Booking.lodge_id == lodge_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status not in (BookingStatus.pending, BookingStatus.confirmed):
        raise HTTPException(
            status_code=400,
            detail=f"Only pending/confirmed bookings can be edited (this one is {b.status.value}).",
        )

    if body.guest_name is not None: b.guest_name = body.guest_name
    if body.guest_phone is not None: b.guest_phone = body.guest_phone
    if body.guest_email is not None: b.guest_email = body.guest_email or None
    if body.adults is not None: b.adults = body.adults
    if body.children is not None: b.children = body.children
    if body.special_requests is not None: b.special_requests = body.special_requests
    if body.advance_payment_mode is not None: b.advance_payment_mode = body.advance_payment_mode
    if body.room_type is not None:
        if body.room_type not in [t.value for t in RoomType]:
            raise HTTPException(status_code=400, detail="Invalid room_type")
        b.room_type_requested = RoomType(body.room_type)
    if body.rooms_count is not None:
        b.rooms_count = max(1, body.rooms_count)
    if body.checkin_date is not None: b.checkin_date = body.checkin_date
    if body.checkout_date is not None: b.checkout_date = body.checkout_date
    if body.tariff_per_night is not None:
        if body.tariff_per_night <= 0:
            raise HTTPException(status_code=400, detail="tariff_per_night must be positive")
        b.tariff_per_night = body.tariff_per_night

    if b.checkout_date <= b.checkin_date:
        raise HTTPException(status_code=400, detail="checkout_date must be after checkin_date")

    # Recompute derived figures.
    b.nights = (b.checkout_date - b.checkin_date).days
    b.total_amount = round(float(b.tariff_per_night) * b.nights * (b.rooms_count or 1), 2)

    if body.advance_amount is not None:
        adv = round(max(0.0, body.advance_amount), 2)
        if adv > float(b.total_amount):
            raise HTTPException(
                status_code=400,
                detail=f"Advance (₹{adv}) cannot exceed the booking total (₹{b.total_amount}).",
            )
        b.advance_amount = adv

    # Keep payment_status consistent with the advance.
    adv = float(b.advance_amount or 0)
    tot = float(b.total_amount or 0)
    b.payment_status = ("paid" if tot > 0 and adv >= tot
                        else "partial" if adv > 0 else "unpaid")

    db.commit()
    db.refresh(b)
    log_audit(db, "booking.updated",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="booking", entity_id=b.booking_id,
              ip_address=request.client.host if request.client else None)
    return _to_dict(b)


@router.get("/{booking_id}/checkin-prefill", dependencies=[Depends(require_permission("bookings.read"))])
def booking_checkin_prefill(booking_id: int, db: Session = Depends(get_db),
                            current_user=Depends(get_current_user),
                            lodge_id: int = Depends(resolve_lodge_scope)):
    """Return everything the New Check-in form needs to be pre-filled from a
    booking, plus the list of currently-available rooms of the booked type so
    reception can pick which physical room(s) to assign."""
    b = db.query(Booking).filter(
        Booking.booking_id == booking_id,
        Booking.lodge_id == lodge_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status == BookingStatus.checked_in or b.checkin:
        raise HTTPException(status_code=400, detail="This booking is already checked in.")
    if b.status in (BookingStatus.cancelled, BookingStatus.completed, BookingStatus.no_show):
        raise HTTPException(status_code=400,
                            detail=f"Cannot check in a {b.status.value} booking.")

    rtype = (b.room_type_requested.value
             if hasattr(b.room_type_requested, "value") else b.room_type_requested)
    # Available rooms must come from the SAME lodge — reception of RK Lodge
    # cannot accidentally pick up an empty Udumulas room.
    available = (db.query(Room)
                 .filter(Room.lodge_id == lodge_id,
                         Room.room_type == rtype,
                         Room.status == RoomStatus.available,
                         Room.is_active == True)
                 .order_by(Room.room_number)
                 .all())

    # Resolve a matching customer by phone within this lodge.
    customer = (db.query(Customer)
                .filter(Customer.phone == b.guest_phone,
                        Customer.lodge_id == lodge_id)
                .first())

    return {
        "booking": _to_dict(b),
        "available_rooms": [
            {"room_id": r.room_id, "room_number": r.room_number,
             "room_type": r.room_type, "base_tariff": float(r.base_tariff)}
            for r in available
        ],
        "matched_customer_id": customer.customer_id if customer else None,
        "rooms_needed": b.rooms_count or 1,
    }


@router.put("/{booking_id}/mark-checked-in", dependencies=[Depends(require_permission("checkins.write"))])
def mark_booking_checked_in(booking_id: int, body: dict, request: Request,
                            db: Session = Depends(get_db),
                            current_user=Depends(get_current_user),
                            lodge_id: int = Depends(resolve_lodge_scope)):
    """Mark a booking as checked-in and link it to the created check-in row(s).
    Called by the frontend right after it successfully creates the check-in(s)
    from a booking. `body` may contain {"checkin_id": <first checkin id>}."""
    b = db.query(Booking).filter(
        Booking.booking_id == booking_id,
        Booking.lodge_id == lodge_id,
    ).first()
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status == BookingStatus.checked_in:
        return _to_dict(b)  # idempotent

    b.status = BookingStatus.checked_in
    checkin_id = body.get("checkin_id")
    if checkin_id:
        ch = db.query(Checkin).filter(
            Checkin.checkin_id == checkin_id,
            Checkin.lodge_id == lodge_id,
        ).first()
        if ch and ch.booking_id is None:
            ch.booking_id = b.booking_id
    db.commit()
    db.refresh(b)

    log_audit(db, "booking.checked_in",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="booking", entity_id=b.booking_id,
              ip_address=request.client.host if request.client else None)
    return _to_dict(b)
