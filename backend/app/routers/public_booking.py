"""Public direct-booking engine.

This is the no-auth surface a guest hits when they visit
   https://lodge.example.com/book/rk
to make a reservation directly without OTA commission.

We deliberately keep this VERY small and rate-limited:
  1. `GET /api/public-booking/availability?lodge_code=&from=&to=` — returns
     room types available + tariff for the dates
  2. `POST /api/public-booking/book` — accepts contact + dates + room type
     and creates a Booking row (status=pending), returns a booking ref

Bookings created here have `source=direct` and start as pending — the
lodge admin reviews and confirms in the regular Bookings page. We never
trust the public payload for status/pricing — server computes both.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime, timedelta
from collections import defaultdict
import secrets
import time

from ..database import get_db
from ..models import (Lodge, Room, RoomType, Booking, BookingSource, BookingStatus,
                      Customer, Setting)

router = APIRouter(prefix="/api/public-booking", tags=["public-booking"])

# ── Naive in-memory rate limit ────────────────────────────────────────
# Public endpoints get hammered. We track per-IP hits in a sliding window
# in process memory. This is intentionally simple — production-grade
# would use Redis or an upstream proxy, but for a small lodge deployment
# in-process is enough to stop casual scraping/spam.
_RATE_WINDOW_SEC = 60
_RATE_MAX_HITS = 12  # per IP per minute
_rate_hits: dict[str, list[float]] = defaultdict(list)


def _rate_limit(request: Request):
    if request is None or request.client is None:
        return
    ip = request.client.host or "unknown"
    now = time.time()
    bucket = _rate_hits[ip]
    # Drop hits older than the window
    cutoff = now - _RATE_WINDOW_SEC
    bucket[:] = [t for t in bucket if t > cutoff]
    if len(bucket) >= _RATE_MAX_HITS:
        raise HTTPException(status_code=429,
                            detail="Too many requests — try again in a minute")
    bucket.append(now)


def _resolve_lodge(db: Session, lodge_code: str) -> Lodge:
    """Look up a lodge by its short code. Public endpoints expose only
    minimum info — if the code is bogus we return 404, not a list of
    valid codes."""
    if not lodge_code:
        raise HTTPException(status_code=400, detail="lodge_code required")
    lodge = (db.query(Lodge)
             .filter(Lodge.code == lodge_code.lower().strip()).first())
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    if hasattr(lodge, "is_active") and not lodge.is_active:
        raise HTTPException(status_code=404, detail="Lodge not accepting bookings")
    return lodge


@router.get("/lodge-info")
def lodge_info(lodge_code: str, request: Request, db: Session = Depends(get_db)):
    """Public summary — hotel name, phone, address — for the booking page header."""
    _rate_limit(request)
    lodge = _resolve_lodge(db, lodge_code)

    def s(key, default=""):
        row = (db.query(Setting)
               .filter(Setting.lodge_id == lodge.lodge_id,
                       Setting.setting_key == key).first())
        return row.setting_value if row and row.setting_value else default

    return {
        "lodge_code": lodge.code,
        "hotel_name": s("hotel_name", lodge.name),
        "hotel_tagline": s("hotel_tagline", ""),
        "hotel_phone": s("hotel_phone", ""),
        "hotel_email": s("hotel_email", ""),
        "hotel_address": s("hotel_address", ""),
    }


@router.get("/availability")
def availability(lodge_code: str,
                  from_date: date = Query(..., alias="from"),
                  to_date: date = Query(..., alias="to"),
                  request: Request = None,
                  db: Session = Depends(get_db)):
    """How many rooms of each type are available for the requested window?

    A room is "available" for the window if it isn't currently blocked
    AND it has no confirmed bookings overlapping the window. We return
    counts per room_type plus the tariff — the actual room-number
    assignment happens at check-in time.
    """
    _rate_limit(request)
    if to_date <= from_date:
        raise HTTPException(status_code=400, detail="`to` must be after `from`")
    if (to_date - from_date).days > 60:
        raise HTTPException(status_code=400, detail="Maximum 60-night window")
    if from_date < date.today():
        raise HTTPException(status_code=400, detail="Past dates not bookable")
    lodge = _resolve_lodge(db, lodge_code)

    # Every room of every type. Group by type → count.
    rooms = (db.query(Room)
             .filter(Room.lodge_id == lodge.lodge_id)
             .all())
    # Bookings overlapping the window (any non-cancelled status counts).
    overlapping = (db.query(Booking.room_id, Booking.room_type_requested,
                             Booking.rooms_count)
                   .filter(Booking.lodge_id == lodge.lodge_id,
                           Booking.status.in_([BookingStatus.pending,
                                               BookingStatus.confirmed]),
                           Booking.checkin_date < to_date,
                           Booking.checkout_date > from_date)
                   .all())
    # Count occupied-per-type. If room_id is set, that's 1 of that
    # specific room's type; if not, use rooms_count of the requested type.
    occupied_by_type: dict[str, int] = defaultdict(int)
    room_type_lookup = {r.room_id: getattr(r.room_type, "value", r.room_type) for r in rooms}
    for room_id, rt_req, n in overlapping:
        if room_id and room_id in room_type_lookup:
            occupied_by_type[room_type_lookup[room_id]] += 1
        elif rt_req:
            occupied_by_type[getattr(rt_req, "value", rt_req)] += int(n or 1)

    # Tariff per type — read from settings (or fall back to first room's).
    def tariff_for(rt: str) -> float:
        key = f"tariff_{rt}"
        row = (db.query(Setting)
               .filter(Setting.lodge_id == lodge.lodge_id,
                       Setting.setting_key == key).first())
        if row and row.setting_value:
            try:
                return float(row.setting_value)
            except ValueError:
                pass
        # fall back to a room of that type
        sample = next((r for r in rooms
                       if getattr(r.room_type, "value", r.room_type) == rt
                       and r.tariff), None)
        return float(sample.tariff) if sample else 0.0

    by_type: dict[str, dict] = {}
    for r in rooms:
        rt = getattr(r.room_type, "value", r.room_type)
        if rt not in by_type:
            by_type[rt] = {"room_type": rt, "total": 0, "available": 0, "tariff": tariff_for(rt)}
        by_type[rt]["total"] += 1
    for rt, bucket in by_type.items():
        bucket["available"] = max(bucket["total"] - occupied_by_type.get(rt, 0), 0)

    nights = (to_date - from_date).days
    return {
        "lodge_code": lodge.code,
        "from": from_date.isoformat(),
        "to": to_date.isoformat(),
        "nights": nights,
        "room_types": list(by_type.values()),
    }


class BookingRequest(BaseModel):
    lodge_code: str
    from_date: date = Field(alias="from")
    to_date: date = Field(alias="to")
    room_type: str
    rooms_count: int = Field(default=1, ge=1, le=10)
    adults: int = Field(default=1, ge=1, le=10)
    children: int = Field(default=0, ge=0, le=10)
    guest_name: str = Field(min_length=2, max_length=120)
    guest_phone: str = Field(min_length=6, max_length=20)
    guest_email: Optional[str] = Field(default=None, max_length=160)
    special_requests: Optional[str] = Field(default=None, max_length=500)

    class Config:
        populate_by_name = True


@router.post("/book")
def book(body: BookingRequest, request: Request,
         db: Session = Depends(get_db)):
    """Create a pending booking. Server computes tariff + total — never
    trusts client-supplied pricing. Returns the booking ref the guest
    will receive in their confirmation."""
    _rate_limit(request)
    lodge = _resolve_lodge(db, body.lodge_code)
    if body.to_date <= body.from_date:
        raise HTTPException(status_code=400, detail="`to` must be after `from`")
    if (body.to_date - body.from_date).days > 60:
        raise HTTPException(status_code=400, detail="Maximum 60-night stay")
    if body.from_date < date.today():
        raise HTTPException(status_code=400, detail="Past dates not bookable")
    # Validate room_type.
    valid_types = {rt.value for rt in RoomType}
    if body.room_type not in valid_types:
        raise HTTPException(status_code=400,
                            detail=f"room_type must be one of {sorted(valid_types)}")

    # Re-check availability server-side (race protection).
    avail = availability(lodge_code=body.lodge_code,
                          from_date=body.from_date, to_date=body.to_date,
                          request=request, db=db)
    bucket = next((b for b in avail["room_types"] if b["room_type"] == body.room_type), None)
    if not bucket or bucket["available"] < body.rooms_count:
        raise HTTPException(status_code=409,
                            detail=f"Only {bucket['available'] if bucket else 0} room(s) "
                                   f"of type {body.room_type} available")

    nights = (body.to_date - body.from_date).days
    tariff = float(bucket["tariff"])
    total = tariff * nights * body.rooms_count

    # Generate a unique booking_ref scoped to this lodge.
    ref = _gen_booking_ref(db, lodge.lodge_id)

    booking = Booking(
        lodge_id=lodge.lodge_id,
        booking_ref=ref,
        source=BookingSource.direct,
        guest_name=body.guest_name.strip()[:120],
        guest_phone=body.guest_phone.strip()[:20],
        guest_email=(body.guest_email.strip()[:120] if body.guest_email else None),
        room_id=None,                                  # assigned at checkin
        room_type_requested=RoomType(body.room_type),
        rooms_count=body.rooms_count,
        checkin_date=body.from_date,
        checkout_date=body.to_date,
        nights=nights,
        adults=body.adults,
        children=body.children,
        tariff_per_night=tariff,
        total_amount=total,
        advance_amount=0,
        status=BookingStatus.pending,
        special_requests=body.special_requests,
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)

    # v2.6 — fire the booking-confirmation email template if the guest
    # gave an email. Non-fatal: a SMTP outage shouldn't block the
    # public booking flow.
    if booking.guest_email:
        try:
            from ..services.email_service import send_booking_confirmation
            send_booking_confirmation(db, booking)
        except Exception:
            pass

    return {
        "booking_ref": booking.booking_ref,
        "status": "pending",
        "message": "Booking received — the lodge will contact you to confirm.",
        "summary": {
            "from": body.from_date.isoformat(),
            "to": body.to_date.isoformat(),
            "nights": nights,
            "room_type": body.room_type,
            "rooms_count": body.rooms_count,
            "tariff_per_night": tariff,
            "total_amount": round(total, 2),
        },
    }


def _gen_booking_ref(db: Session, lodge_id: int) -> str:
    """Per-lodge unique reference like 'DIR-20260528-7F3A'."""
    for _ in range(10):
        ref = f"DIR-{datetime.utcnow().strftime('%Y%m%d')}-{secrets.token_hex(2).upper()}"
        exists = (db.query(Booking)
                  .filter(Booking.lodge_id == lodge_id,
                          Booking.booking_ref == ref).first())
        if not exists:
            return ref
    # Extreme edge — collision after 10 tries. Throw rather than loop forever.
    raise HTTPException(status_code=500, detail="Could not allocate booking ref")
