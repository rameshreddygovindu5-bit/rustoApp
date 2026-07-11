"""
═══════════════════════════════════════════════════════════════════════
  PARTNER PUBLIC API — /api/partner/v1/*
═══════════════════════════════════════════════════════════════════════

Once an admin creates an agency in /api/agencies, that agency receives an
api_key + api_secret. They send those on EVERY request as headers:

    X-API-Key:    lms_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    X-API-Secret: lms_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

Endpoints exposed to partners:

    GET    /api/partner/v1/me                  - Verify creds, see config
    GET    /api/partner/v1/availability        - Check available rooms by date+type
    GET    /api/partner/v1/rates               - Get current rates (with their markup)
    POST   /api/partner/v1/bookings            - Create a new booking
    GET    /api/partner/v1/bookings            - List THIS agency's bookings
    GET    /api/partner/v1/bookings/{ref}      - Get one booking
    POST   /api/partner/v1/bookings/{ref}/cancel - Cancel a booking

All responses include:
    X-Request-Id (echoed if sent, else generated) for correlation.

Rate limiting & quotas honored from agency config (daily_booking_limit, etc.).
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, field_validator, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
import re, uuid

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..database import get_db
from ..models import (Agency, AgencyApiCall, Booking, BookingStatus, BookingSource,
                      Customer, Room, RoomType, RoomStatus, IDType, Setting)
from ..partner_auth import get_agency, log_agency_response
from ..services.audit_service import log_audit
from ..services.webhook_service import queue_webhook

router = APIRouter(prefix="/api/partner/v1", tags=["partner-api"])


# ─── Helpers ───────────────────────────────────────────────────────────
def _get_setting(db: Session, key: str, default: str = "", lodge_id: int = None) -> str:
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    s = q.first()
    return s.setting_value if s else default


def _tariff_for_room_type(db: Session, room_type: str, lodge_id: int = None) -> float:
    key_map = {
        "deluxe_ac": "tariff_deluxe_ac",
        "ac": "tariff_ac",
        "non_ac": "tariff_non_ac",
        "house": "tariff_house",
    }
    raw = _get_setting(db, key_map.get(room_type, ""), "0", lodge_id=lodge_id)
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _apply_markup(base: float, markup_pct: float) -> float:
    return round(base * (1 + (markup_pct or 0) / 100), 2)


def _rooms_available_for_dates(db: Session, room_type: str,
                               checkin_dt: date, checkout_dt: date,
                               lodge_id: int) -> List[Room]:
    """Return rooms of given type IN THIS LODGE with no conflicting booking."""
    rooms = (db.query(Room)
             .filter(Room.lodge_id == lodge_id,
                     Room.room_type == room_type,
                     Room.is_active == True)
             .all())
    if not rooms:
        return []

    busy_room_ids = {
        r[0] for r in db.query(Booking.room_id).filter(
            Booking.lodge_id == lodge_id,
            Booking.room_id.isnot(None),
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.checked_in, BookingStatus.pending]),
            Booking.checkin_date < checkout_dt,
            Booking.checkout_date > checkin_dt,
        ).all() if r[0] is not None
    }
    return [r for r in rooms if r.room_id not in busy_room_ids and r.status != RoomStatus.maintenance]


def _next_booking_ref(db: Session, lodge_id: int, lodge_code: str = "udu") -> str:
    """Per-lodge ref like UDU-202605-0001 / RK-202605-0001."""
    today = _utcnow()
    code_prefix = (lodge_code[:3].upper() if lodge_code else "UDU")
    prefix = f"{code_prefix}-{today.strftime('%Y%m')}-"
    last = (db.query(Booking)
            .filter(Booking.lodge_id == lodge_id,
                    Booking.booking_ref.like(prefix + "%"))
            .order_by(Booking.booking_id.desc())
            .first())
    seq = 1
    if last:
        try:
            seq = int(last.booking_ref.split("-")[-1]) + 1
        except (ValueError, IndexError):
            seq = (last.booking_id or 0) + 1
    return f"{prefix}{seq:04d}"


def _booking_response(b: Booking) -> dict:
    return {
        "booking_ref": b.booking_ref,
        "agency_booking_ref": b.agency_booking_ref,
        "status": b.status.value if hasattr(b.status, "value") else b.status,
        "guest": {
            "name": b.guest_name,
            "phone": b.guest_phone,
            "email": b.guest_email,
        },
        "stay": {
            "checkin_date": b.checkin_date.isoformat(),
            "checkout_date": b.checkout_date.isoformat(),
            "nights": b.nights,
            "adults": b.adults,
            "children": b.children,
            "room_type": (b.room_type_requested.value
                          if hasattr(b.room_type_requested, "value")
                          else b.room_type_requested),
            "room_number": b.room.room_number if b.room else None,
        },
        "pricing": {
            "tariff_per_night": float(b.tariff_per_night),
            "total_amount": float(b.total_amount),
            "commission_amount": float(b.commission_amount or 0),
            "currency": "INR",
            "payment_status": b.payment_status,
        },
        "special_requests": b.special_requests,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


# ─── Schemas ───────────────────────────────────────────────────────────
class GuestInfo(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    phone: str
    email: Optional[EmailStr] = None
    id_type: Optional[str] = "aadhar"
    id_number: Optional[str] = None

    @field_validator("phone", mode="before")
    def _phone_check(cls, v):
        v = re.sub(r"\D", "", v)
        if len(v) < 10:
            raise ValueError("phone must contain at least 10 digits")
        return v[-10:]  # use last 10


class CreateBookingRequest(BaseModel):
    agency_booking_ref: str = Field(..., min_length=1, max_length=60,
                                    description="Your own ref id; must be unique per agency")
    room_type: str = Field(..., description="deluxe_ac | ac | non_ac | house")
    checkin_date: date
    checkout_date: date
    adults: int = Field(default=1, ge=1, le=10)
    children: int = Field(default=0, ge=0, le=10)
    guest: GuestInfo
    special_requests: Optional[str] = None
    payment_status: str = Field(default="unpaid",
                                description="unpaid | prepaid | partial")

    @field_validator("room_type", mode="before")
    @classmethod
    def _rt(cls, v):
        if v not in ("deluxe_ac", "ac", "non_ac", "house"):
            raise ValueError("invalid room_type")
        return v

    @field_validator("checkout_date", mode="before")
    @classmethod
    def _co(cls, v):
        # Note: cross-field validation (checkin vs checkout) is done at endpoint level
        # since Pydantic V2 field validators don't receive other fields by default
        if isinstance(v, str):
            from datetime import date as _date
            try:
                v = _date.fromisoformat(v)
            except ValueError:
                raise ValueError(f"Invalid date format: {v}")
        return v

    @field_validator("checkin_date", mode="before")
    @classmethod
    def _ci(cls, v):
        if isinstance(v, str):
            from datetime import date as _date
            try:
                v = _date.fromisoformat(v)
            except ValueError:
                raise ValueError(f"Invalid date format: {v}")
        # Past date check
        from datetime import date as _date
        today = _date.today()
        if isinstance(v, _date) and v < today:
            raise ValueError("checkin_date cannot be in the past")
        return v


class CancelBookingRequest(BaseModel):
    reason: Optional[str] = "Cancelled by partner"


# ─── Endpoints ─────────────────────────────────────────────────────────
@router.get("/me")
def whoami(request: Request, db: Session = Depends(get_db),
           agency: Agency = Depends(get_agency)):
    res = {
        "agency_id": agency.agency_id,
        "name": agency.name,
        "code": agency.code,
        "status": agency.status.value if hasattr(agency.status, "value") else agency.status,
        "config": {
            "commission_pct": float(agency.commission_pct or 0),
            "rate_markup_pct": float(agency.rate_markup_pct or 0),
            "allowed_room_types": (agency.allowed_room_types or "").split(","),
            "max_advance_days": agency.max_advance_days,
            "daily_booking_limit": agency.daily_booking_limit,
        },
        "stats": {
            "total_bookings": agency.total_bookings,
            "total_revenue": float(agency.total_revenue or 0),
        },
    }
    log_agency_response(request, db, 200)
    return res


@router.get("/availability")
def check_availability(request: Request,
                       checkin_date: date = Query(...),
                       checkout_date: date = Query(...),
                       room_type: Optional[str] = None,
                       db: Session = Depends(get_db),
                       agency: Agency = Depends(get_agency)):
    """Check available room counts by type for a date range."""
    if checkout_date <= checkin_date:
        log_agency_response(request, db, 400, "checkout_date <= checkin_date")
        raise HTTPException(status_code=400, detail="checkout_date must be after checkin_date")

    if (checkin_date - date.today()).days > agency.max_advance_days:
        log_agency_response(request, db, 400, "Beyond max_advance_days")
        raise HTTPException(status_code=400,
                            detail=f"Bookings allowed up to {agency.max_advance_days} days in advance")

    allowed = set((agency.allowed_room_types or "").split(","))
    types_to_check = [room_type] if room_type else list(allowed)

    result = {}
    for rt in types_to_check:
        if rt not in allowed:
            continue
        avail_rooms = _rooms_available_for_dates(db, rt, checkin_date, checkout_date,
                                                  lodge_id=agency.lodge_id)
        base = _tariff_for_room_type(db, rt, lodge_id=agency.lodge_id)
        result[rt] = {
            "available_rooms": len(avail_rooms),
            "base_tariff_per_night": base,
            "your_rate_per_night": _apply_markup(base, float(agency.rate_markup_pct or 0)),
            "max_occupancy_per_room": max((r.max_occupancy or 2) for r in avail_rooms) if avail_rooms else 0,
        }

    nights = (checkout_date - checkin_date).days
    response = {
        "checkin_date": checkin_date.isoformat(),
        "checkout_date": checkout_date.isoformat(),
        "nights": nights,
        "currency": "INR",
        "rates_include_markup_pct": float(agency.rate_markup_pct or 0),
        "by_room_type": result,
    }
    log_agency_response(request, db, 200)
    return response


@router.get("/rates")
def get_rates(request: Request, db: Session = Depends(get_db),
              agency: Agency = Depends(get_agency)):
    """Current rate card for this agency (with their markup applied)."""
    allowed = (agency.allowed_room_types or "").split(",")
    rates = {}
    for rt in allowed:
        base = _tariff_for_room_type(db, rt, lodge_id=agency.lodge_id)
        rates[rt] = {
            "base_tariff": base,
            "your_rate": _apply_markup(base, float(agency.rate_markup_pct or 0)),
        }
    log_agency_response(request, db, 200)
    return {"currency": "INR", "rates": rates,
            "markup_pct": float(agency.rate_markup_pct or 0)}


@router.post("/bookings", status_code=201)
def create_booking(body: CreateBookingRequest, request: Request,
                   db: Session = Depends(get_db),
                   agency: Agency = Depends(get_agency)):
    """Create a confirmed booking."""
    # Allowed room type?
    allowed = set((agency.allowed_room_types or "").split(","))
    if body.room_type not in allowed:
        log_agency_response(request, db, 403, f"Room type {body.room_type} not allowed")
        raise HTTPException(status_code=403,
                            detail=f"Your account is not allowed to book {body.room_type}")

    # Date sanity
    if body.checkin_date < date.today():
        log_agency_response(request, db, 400, "checkin_date in past")
        raise HTTPException(status_code=400, detail="checkin_date cannot be in the past")
    if (body.checkin_date - date.today()).days > agency.max_advance_days:
        log_agency_response(request, db, 400, "Beyond max_advance_days")
        raise HTTPException(status_code=400,
                            detail=f"Cannot book more than {agency.max_advance_days} days in advance")

    # Idempotency: same agency_booking_ref → return existing (within this lodge)
    existing = (db.query(Booking)
                .filter(Booking.agency_id == agency.agency_id,
                        Booking.lodge_id == agency.lodge_id,
                        Booking.agency_booking_ref == body.agency_booking_ref)
                .first())
    if existing:
        log_agency_response(request, db, 200, "Idempotent reuse")
        return _booking_response(existing)

    # Daily limit?
    if agency.daily_booking_limit and agency.daily_booking_limit > 0:
        from sqlalchemy import cast, Date as SqlDate
        today = _utcnow().date()
        today_count = (db.query(Booking)
                       .filter(Booking.agency_id == agency.agency_id,
                               Booking.lodge_id == agency.lodge_id,
                               cast(Booking.created_at, SqlDate) == today)
                       .count())
        if today_count >= agency.daily_booking_limit:
            log_agency_response(request, db, 429, "Daily limit reached")
            raise HTTPException(status_code=429,
                                detail=f"Daily booking limit ({agency.daily_booking_limit}) reached")

    # Inventory (lodge-scoped via the helper)
    avail = _rooms_available_for_dates(db, body.room_type, body.checkin_date, body.checkout_date,
                                        lodge_id=agency.lodge_id)
    if not avail:
        log_agency_response(request, db, 409, "No rooms available")
        raise HTTPException(status_code=409,
                            detail=f"No {body.room_type} rooms available for these dates")
    chosen_room = avail[0]

    # Pricing — uses lodge's settings for the base tariff.
    base = _tariff_for_room_type(db, body.room_type, lodge_id=agency.lodge_id)
    nightly = _apply_markup(base, float(agency.rate_markup_pct or 0))
    nights = (body.checkout_date - body.checkin_date).days
    total = round(nightly * nights, 2)
    commission = round(total * float(agency.commission_pct or 0) / 100, 2)

    # Customer (find/create by phone, within this lodge — same phone may
    # be a different guest at a different lodge).
    existing_customer = (db.query(Customer)
                         .filter(Customer.phone == body.guest.phone,
                                 Customer.lodge_id == agency.lodge_id)
                         .first())
    if existing_customer and existing_customer.blacklisted:
        log_agency_response(request, db, 403, "Guest blacklisted")
        raise HTTPException(status_code=403, detail="Guest is blacklisted")

    def _get_or_create_customer() -> Customer:
        c = (db.query(Customer)
             .filter(Customer.phone == body.guest.phone,
                     Customer.lodge_id == agency.lodge_id)
             .first())
        if not c:
            # We don't yet have full ID validation here — agency may not collect Aadhar.
            # We create a minimal record; upon physical check-in staff will complete it.
            c = Customer(
                lodge_id=agency.lodge_id,
                first_name=body.guest.name.split(" ")[0][:50],
                last_name=" ".join(body.guest.name.split(" ")[1:])[:50] or "Guest",
                phone=body.guest.phone,
                email=body.guest.email,
                id_type=IDType(body.guest.id_type) if body.guest.id_type in [t.value for t in IDType] else IDType.aadhar,
                id_number=body.guest.id_number or "PENDING",
            )
            db.add(c)
            db.flush()
        return c

    # Per-lodge booking ref. Pull the lodge code so prefix matches the
    # manual / agent flows ("UDU-..." vs "RK-...").
    from ..models import Lodge as _Lodge
    lodge_row = db.query(_Lodge).filter(_Lodge.lodge_id == agency.lodge_id).first()
    lodge_code = lodge_row.code if lodge_row else "udu"

    # Ref generation reads max-sequence then inserts, so two concurrent
    # creates can race onto the same ref. On the unique-constraint clash,
    # rollback (which also undoes the customer flush and agency counters),
    # regenerate from the now-committed max, and retry.
    booking = None
    for attempt in range(5):
        customer = _get_or_create_customer()
        booking_ref = _next_booking_ref(db, lodge_id=agency.lodge_id,
                                         lodge_code=lodge_code)
        booking = Booking(
            lodge_id=agency.lodge_id,
            booking_ref=booking_ref,
            source=BookingSource.agency,
            agency_id=agency.agency_id,
            agency_booking_ref=body.agency_booking_ref,
            customer_id=customer.customer_id,
            guest_name=body.guest.name,
            guest_phone=body.guest.phone,
            guest_email=body.guest.email,
            room_id=chosen_room.room_id,
            room_type_requested=RoomType(body.room_type),
            checkin_date=body.checkin_date,
            checkout_date=body.checkout_date,
            nights=nights,
            adults=body.adults,
            children=body.children,
            tariff_per_night=Decimal(str(nightly)),
            total_amount=Decimal(str(total)),
            commission_amount=Decimal(str(commission)),
            payment_status=body.payment_status,
            status=BookingStatus.confirmed,
            special_requests=body.special_requests,
        )
        db.add(booking)
        agency.total_bookings = (agency.total_bookings or 0) + 1
        agency.total_revenue = (agency.total_revenue or 0) + Decimal(str(total))
        try:
            db.commit()
            break
        except IntegrityError as e:
            db.rollback()
            if "booking_ref" not in str(getattr(e, "orig", e)):
                raise
            if attempt == 4:
                log_agency_response(request, db, 409, "Booking ref allocation conflict")
                raise HTTPException(status_code=409,
                                    detail="Could not allocate a unique booking reference; please retry")
    db.refresh(booking)

    log_audit(db, "booking.created",
              actor_username=agency.code, actor_type="agency",
              entity_type="booking", entity_id=booking.booking_id,
              lodge_id=agency.lodge_id,
              details={"agency_code": agency.code, "ref": booking.booking_ref,
                       "agency_ref": body.agency_booking_ref})

    queue_webhook(db, agency, booking, "booking.confirmed")

    log_agency_response(request, db, 201)
    return _booking_response(booking)


@router.get("/bookings")
def list_partner_bookings(request: Request,
                          status: Optional[str] = None,
                          from_date: Optional[date] = None,
                          to_date: Optional[date] = None,
                          page: int = 1, limit: int = 50,
                          db: Session = Depends(get_db),
                          agency: Agency = Depends(get_agency)):
    # An agency only ever sees bookings tagged to its own lodge AND its own
    # agency_id. The agency_id alone is enough, but the lodge_id filter is
    # defensive — if anyone ever cross-wired agencies between lodges, this
    # still keeps tenants isolated.
    q = (db.query(Booking)
         .filter(Booking.agency_id == agency.agency_id,
                 Booking.lodge_id == agency.lodge_id))
    if status:
        q = q.filter(Booking.status == status)
    if from_date:
        q = q.filter(Booking.checkin_date >= from_date)
    if to_date:
        q = q.filter(Booking.checkin_date <= to_date)
    total = q.count()
    rows = (q.order_by(Booking.created_at.desc())
            .offset(max(0, (page - 1)) * limit)
            .limit(min(limit, 200))
            .all())
    log_agency_response(request, db, 200)
    return {"total": total, "page": page, "limit": limit,
            "data": [_booking_response(b) for b in rows]}


@router.get("/bookings/{booking_ref}")
def get_partner_booking(booking_ref: str, request: Request,
                        db: Session = Depends(get_db),
                        agency: Agency = Depends(get_agency)):
    b = (db.query(Booking)
         .filter(Booking.agency_id == agency.agency_id,
                 Booking.lodge_id == agency.lodge_id,
                 or_(Booking.booking_ref == booking_ref,
                     Booking.agency_booking_ref == booking_ref))
         .first())
    if not b:
        log_agency_response(request, db, 404)
        raise HTTPException(status_code=404, detail="Booking not found")
    log_agency_response(request, db, 200)
    return _booking_response(b)


@router.post("/bookings/{booking_ref}/cancel")
def cancel_partner_booking(booking_ref: str, body: CancelBookingRequest,
                           request: Request,
                           db: Session = Depends(get_db),
                           agency: Agency = Depends(get_agency)):
    b = (db.query(Booking)
         .filter(Booking.agency_id == agency.agency_id,
                 Booking.lodge_id == agency.lodge_id,
                 or_(Booking.booking_ref == booking_ref,
                     Booking.agency_booking_ref == booking_ref))
         .first())
    if not b:
        log_agency_response(request, db, 404)
        raise HTTPException(status_code=404, detail="Booking not found")

    if b.status in [BookingStatus.cancelled, BookingStatus.completed,
                     BookingStatus.checked_in, BookingStatus.no_show]:
        log_agency_response(request, db, 400, f"Cannot cancel: {b.status}")
        raise HTTPException(status_code=400,
                            detail=f"Cannot cancel a booking in status: {b.status.value}")

    b.status = BookingStatus.cancelled
    b.cancelled_at = _utcnow()
    b.cancellation_reason = body.reason
    db.commit()
    db.refresh(b)

    log_audit(db, "booking.cancelled",
              actor_username=agency.code, actor_type="agency",
              entity_type="booking", entity_id=b.booking_id,
              lodge_id=agency.lodge_id,
              details={"reason": body.reason})

    queue_webhook(db, agency, b, "booking.cancelled")

    log_agency_response(request, db, 200)
    return _booking_response(b)
