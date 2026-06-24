"""
Global Partner API — /api/global/v1/*
======================================

Platform-level API for global OTA partners (MakeMyTrip, Goibibo, Booking.com,
Expedia, etc.) who want to list ALL Rusto properties in one integration.

Unlike the per-lodge /api/partner/v1/* endpoints (which require per-lodge
Agency credentials), this API uses a single GlobalApiKey that covers:
  - All published lodges on the platform (or a configured subset)
  - Unified availability search across all properties
  - Booking creation at any lodge
  - Webhook for all booking events platform-wide

Authentication:
    X-Global-Api-Key:    rgk_live_xxxxxxxxxxxxxxxxxxxxxxxxxx
    X-Global-Api-Secret: rgs_live_xxxxxxxxxxxxxxxxxxxxxxxxxx

Endpoints:
    GET  /api/global/v1/me               — verify credentials, partner info
    GET  /api/global/v1/properties       — list all available lodges
    GET  /api/global/v1/availability     — search availability across lodges
    GET  /api/global/v1/rates            — get rates for a property
    POST /api/global/v1/bookings         — create booking at any lodge
    GET  /api/global/v1/bookings         — list bookings made via this key
    GET  /api/global/v1/bookings/{ref}   — get booking details
    POST /api/global/v1/bookings/{ref}/cancel
    GET  /api/global/v1/webhooks/test    — trigger a test webhook delivery

Super-admin management (requires staff token):
    GET  /api/global/admin/keys          — list all global api keys
    POST /api/global/admin/keys          — create a new global api key
    PATCH /api/global/admin/keys/{id}    — update key config
    POST /api/global/admin/keys/{id}/revoke
"""
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, and_, or_, distinct
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (GlobalApiKey, GlobalApiCall, Lodge, Room, RoomStatus,
                       Booking, BookingStatus, BookingSource, Customer,
                       Setting, LodgePhoto, CustomerBooking,
                       CustomerBookingStatus, RustoCustomer)
from ..auth import get_current_user, require_super_admin

logger = logging.getLogger(__name__)

partner_router = APIRouter(prefix="/api/global/v1", tags=["global-partner-api"])
admin_router   = APIRouter(prefix="/api/global/admin", tags=["global-admin"])


# ── Auth ─────────────────────────────────────────────────────────────

def _get_global_partner(
    db: Session = Depends(get_db),
    x_global_api_key: str = Header(None, alias="X-Global-Api-Key"),
    x_global_api_secret: str = Header(None, alias="X-Global-Api-Secret"),
    request: Request = None,
) -> GlobalApiKey:
    if not x_global_api_key or not x_global_api_secret:
        raise HTTPException(401, "Missing X-Global-Api-Key or X-Global-Api-Secret headers")

    partner = db.query(GlobalApiKey).filter(
        GlobalApiKey.api_key == x_global_api_key,
        GlobalApiKey.status == "active",
    ).first()
    if not partner:
        raise HTTPException(401, "Invalid or revoked API key")

    # Verify secret
    expected = hashlib.sha256(
        f"{x_global_api_key}:{partner.api_secret_hash}".encode()
    ).hexdigest()
    # Simple bcrypt-free check — secret is stored as SHA256(api_key + ":" + raw_secret)
    actual = hashlib.sha256(
        f"{x_global_api_key}:{x_global_api_secret}".encode()
    ).hexdigest()
    if not hmac.compare_digest(expected, actual):
        raise HTTPException(401, "Invalid API secret")

    # Log call
    t0 = time.time()
    call = GlobalApiCall(
        key_id=partner.key_id,
        method=request.method if request else "GET",
        path=str(request.url.path) if request else "",
        ip_address=request.client.host if request and request.client else None,
    )
    db.add(call)
    partner.total_calls = (partner.total_calls or 0) + 1
    partner.last_used_at = _utcnow()
    db.commit()
    return partner


def _allowed_lodge_ids(partner: GlobalApiKey, db: Session) -> Optional[List[int]]:
    """Return list of lodge IDs partner can access, or None = all."""
    if not partner.allowed_lodge_ids:
        return None  # all lodges
    try:
        return json.loads(partner.allowed_lodge_ids)
    except Exception:
        return None


def _lodge_query(partner: GlobalApiKey, db: Session):
    """Base query filtered to partner's accessible published lodges."""
    q = db.query(Lodge).filter(Lodge.is_published == True,
                                Lodge.is_active == True,
                                Lodge.allow_online_booking != False)
    allowed = _allowed_lodge_ids(partner, db)
    if allowed:
        q = q.filter(Lodge.lodge_id.in_(allowed))
    return q


def _apply_markup(base: float, markup_pct: float) -> float:
    return round(base * (1 + markup_pct / 100), 2)


def _property_summary(l: Lodge, partner: GlobalApiKey, db: Session) -> dict:
    """Lean property info for availability / listing responses."""
    photo = db.query(LodgePhoto).filter(
        LodgePhoto.lodge_id == l.lodge_id
    ).order_by(LodgePhoto.sort_order).first()
    
    settings = {s.setting_key: s.setting_value for s in db.query(Setting).filter(
        Setting.lodge_id == l.lodge_id,
        Setting.setting_key.in_(["hotel_name", "property_category", "checkin_time_setting",
                                  "checkout_time_setting", "hotel_phone", "hotel_email"])
    ).all()}
    
    return {
        "property_id":       l.lodge_id,
        "property_code":     l.code,
        "name":              settings.get("hotel_name", l.name),
        "category":          settings.get("property_category", getattr(l, "property_type", "lodge")),
        "city":              l.public_city,
        "state":             l.public_state,
        "address":           l.address,
        "cover_image":       photo.url if photo else None,
        "star_category":     getattr(l, "star_category", 0),
        "starting_price":    float(l.starting_price) if l.starting_price else None,
        "amenities":         (l.amenities or "").split(",") if l.amenities else [],
        "instant_confirm":   bool(getattr(l, "instant_confirm", True)),
        "checkin_time":      settings.get("checkin_time_setting", "12:00"),
        "checkout_time":     settings.get("checkout_time_setting", "11:00"),
        "contact_phone":     settings.get("hotel_phone", l.phone or ""),
        "contact_email":     settings.get("hotel_email", l.email or ""),
        "is_active":         bool(l.is_active),
        "is_published":      bool(l.is_published),
    }


# ── Partner endpoints ─────────────────────────────────────────────────

@partner_router.get("/me")
def whoami(partner: GlobalApiKey = Depends(_get_global_partner),
            db: Session = Depends(get_db)):
    allowed = _allowed_lodge_ids(partner, db)
    prop_count = _lodge_query(partner, db).count()
    return {
        "partner_name":      partner.partner_name,
        "partner_code":      partner.partner_code,
        "api_key":           partner.api_key,
        "status":            partner.status,
        "scope":             "all_lodges" if not allowed else f"{len(allowed)}_lodges",
        "properties_count":  prop_count,
        "commission_pct":    float(partner.commission_pct or 0),
        "rate_markup_pct":   float(partner.rate_markup_pct or 0),
        "webhook_url":       partner.webhook_url,
        "last_used_at":      partner.last_used_at.isoformat() if partner.last_used_at else None,
        "total_api_calls":   partner.total_calls,
    }


@partner_router.get("/properties")
def list_properties(
    city:     Optional[str] = None,
    category: Optional[str] = None,
    limit:    int = Query(50, le=200),
    offset:   int = 0,
    partner: GlobalApiKey = Depends(_get_global_partner),
    db: Session = Depends(get_db),
):
    """List all properties accessible via this API key."""
    q = _lodge_query(partner, db)
    if city:
        q = q.filter(Lodge.public_city.ilike(f"%{city}%"))
    total = q.count()
    lodges = q.order_by(Lodge.lodge_id).offset(offset).limit(limit).all()
    markup = float(partner.rate_markup_pct or 0)
    props = []
    for l in lodges:
        p = _property_summary(l, partner, db)
        if p["starting_price"]:
            p["starting_price_with_markup"] = _apply_markup(p["starting_price"], markup)
        props.append(p)
    return {"total": total, "offset": offset, "limit": limit, "properties": props}


@partner_router.get("/availability")
def global_availability(
    checkin:  str  = Query(..., description="YYYY-MM-DD"),
    checkout: str  = Query(..., description="YYYY-MM-DD"),
    guests:   int  = Query(1, ge=1, le=20),
    rooms:    int  = Query(1, ge=1, le=20),
    city:     Optional[str] = None,
    category: Optional[str] = None,
    property_id: Optional[int] = None,
    partner: GlobalApiKey = Depends(_get_global_partner),
    db: Session = Depends(get_db),
):
    """Cross-lodge availability search.

    Returns properties with available room types matching the request.
    This is the key endpoint OTAs use to populate their search results.
    """
    try:
        ci = date.fromisoformat(checkin)
        co = date.fromisoformat(checkout)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    if co <= ci:
        raise HTTPException(400, "checkout must be after checkin")

    nights = (co - ci).days
    q = _lodge_query(partner, db)
    if city:
        q = q.filter(Lodge.public_city.ilike(f"%{city}%"))
    if property_id:
        q = q.filter(Lodge.lodge_id == property_id)

    markup = float(partner.rate_markup_pct or 0)
    results = []

    for lodge in q.order_by(Lodge.lodge_id).limit(100).all():
        rooms_q = db.query(Room).filter(
            Room.lodge_id == lodge.lodge_id,
            Room.status == RoomStatus.available.value,
        ).all()

        available_types = {}
        for room in rooms_q:
            # Check for conflicting bookings
            conflict = db.query(Booking).filter(
                Booking.lodge_id == lodge.lodge_id,
                Booking.room_id == room.room_id,
                Booking.status.in_([BookingStatus.confirmed.value,
                                      BookingStatus.checked_in.value]),
                Booking.checkin_date < co,
                Booking.checkout_date > ci,
            ).count()
            if conflict == 0:
                rt = room.room_type
                if rt not in available_types:
                    tariff_key = {"deluxe_ac":"tariff_deluxe_ac","ac":"tariff_ac",
                                   "non_ac":"tariff_non_ac","house":"tariff_house"}.get(rt)
                    tariff_s = db.query(Setting).filter(
                        Setting.lodge_id == lodge.lodge_id,
                        Setting.setting_key == tariff_key
                    ).first() if tariff_key else None
                    base_rate = float(tariff_s.setting_value) if tariff_s else (lodge.starting_price or 0)
                    available_types[rt] = {"count": 0, "base_rate": float(base_rate)}
                available_types[rt]["count"] += 1

        if available_types and any(v["count"] >= rooms for v in available_types.values()):
            prop = _property_summary(lodge, partner, db)
            prop["available_room_types"] = [
                {
                    "room_type":         rt,
                    "rooms_available":   v["count"],
                    "rate_per_night":    _apply_markup(v["base_rate"], markup),
                    "total_for_stay":    round(_apply_markup(v["base_rate"], markup) * nights * rooms, 2),
                    "nights":            nights,
                }
                for rt, v in available_types.items()
                if v["count"] >= rooms
            ]
            results.append(prop)

    return {
        "checkin":        checkin,
        "checkout":       checkout,
        "nights":         nights,
        "guests":         guests,
        "rooms_requested": rooms,
        "properties_available": len(results),
        "results":        results,
    }


class GlobalBookingBody(BaseModel):
    property_id:   int
    property_code: Optional[str] = None
    room_type:     str
    rooms_count:   int = Field(1, ge=1, le=20)
    checkin_date:  str
    checkout_date: str
    adults:        int = Field(1, ge=1, le=20)
    children:      int = Field(0, ge=0, le=20)
    # Guest info
    guest_name:    str = Field(..., min_length=2, max_length=120)
    guest_phone:   str = Field(..., min_length=8, max_length=20)
    guest_email:   Optional[str] = None
    special_requests: Optional[str] = Field(None, max_length=2000)
    # Partner's own reference
    partner_reference: Optional[str] = Field(None, max_length=80)


@partner_router.post("/bookings", status_code=201)
def create_global_booking(
    body: GlobalBookingBody,
    partner: GlobalApiKey = Depends(_get_global_partner),
    db: Session = Depends(get_db),
):
    """Create a booking at any lodge via the global API key."""
    # Validate lodge access
    lodge = _lodge_query(partner, db).filter(Lodge.lodge_id == body.property_id).first()
    if not lodge:
        raise HTTPException(404, "Property not found or not accessible via this API key")

    try:
        ci = date.fromisoformat(body.checkin_date)
        co = date.fromisoformat(body.checkout_date)
    except ValueError:
        raise HTTPException(400, "Dates must be YYYY-MM-DD")
    if co <= ci:
        raise HTTPException(400, "checkout must be after checkin")

    nights = (co - ci).days

    # Get tariff
    tariff_key = {"deluxe_ac":"tariff_deluxe_ac","ac":"tariff_ac",
                   "non_ac":"tariff_non_ac","house":"tariff_house"}.get(body.room_type)
    tariff_s = db.query(Setting).filter(
        Setting.lodge_id == lodge.lodge_id,
        Setting.setting_key == tariff_key
    ).first() if tariff_key else None
    base_rate = float(tariff_s.setting_value) if tariff_s else (float(lodge.starting_price or 2500))
    markup = float(partner.rate_markup_pct or 0)
    rate = _apply_markup(base_rate, markup)
    subtotal = round(rate * nights * body.rooms_count, 2)
    commission = round(subtotal * float(partner.commission_pct or 0) / 100, 2)

    # Find or create customer
    customer = db.query(Customer).filter(
        Customer.lodge_id == lodge.lodge_id,
        Customer.phone == body.guest_phone,
    ).first()
    if not customer:
        customer = Customer(
            lodge_id=lodge.lodge_id,
            full_name=body.guest_name,
            phone=body.guest_phone,
            email=body.guest_email or "",
        )
        db.add(customer)
        db.flush()

    # Create booking
    ref = f"GLOB-{secrets.token_hex(4).upper()}"
    bk = Booking(
        lodge_id=lodge.lodge_id,
        customer_id=customer.customer_id,
        booking_ref=ref,
        room_type=body.room_type,
        rooms_count=body.rooms_count,
        checkin_date=ci, checkout_date=co,
        adults=body.adults, children=body.children,
        total_amount=subtotal,
        special_requests=body.special_requests,
        source=BookingSource.online.value,
        status=BookingStatus.confirmed.value,
        notes=f"Global API booking via {partner.partner_name} | Partner ref: {body.partner_reference or 'N/A'} | Commission: ₹{commission}",
    )
    db.add(bk)
    # Update partner stats
    partner.total_calls = (partner.total_calls or 0) + 1
    db.commit()
    db.refresh(bk)

    return {
        "booking_id":        bk.booking_id,
        "booking_ref":       bk.booking_ref,
        "partner_reference": body.partner_reference,
        "property_id":       lodge.lodge_id,
        "property_name":     lodge.name,
        "status":            bk.status,
        "checkin_date":      body.checkin_date,
        "checkout_date":     body.checkout_date,
        "nights":            nights,
        "rooms":             body.rooms_count,
        "room_type":         body.room_type,
        "rate_per_night":    rate,
        "total_amount":      subtotal,
        "commission":        commission,
        "guest_name":        body.guest_name,
        "guest_phone":       body.guest_phone,
    }


@partner_router.get("/bookings")
def list_global_bookings(
    from_date:   Optional[str] = None,
    to_date:     Optional[str] = None,
    property_id: Optional[int] = None,
    limit:       int = Query(50, le=200),
    offset:      int = 0,
    partner: GlobalApiKey = Depends(_get_global_partner),
    db: Session = Depends(get_db),
):
    """List bookings made via this global API key."""
    q = db.query(Booking).filter(
        Booking.notes.like(f"%{partner.partner_name}%")
    )
    if property_id:
        q = q.filter(Booking.lodge_id == property_id)
    if from_date:
        q = q.filter(Booking.checkin_date >= date.fromisoformat(from_date))
    if to_date:
        q = q.filter(Booking.checkin_date <= date.fromisoformat(to_date))
    total = q.count()
    bookings = q.order_by(Booking.created_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "bookings": [
            {
                "booking_id":   b.booking_id,
                "booking_ref":  b.booking_ref,
                "property_id":  b.lodge_id,
                "status":       b.status,
                "checkin_date": b.checkin_date.isoformat() if b.checkin_date else None,
                "checkout_date":b.checkout_date.isoformat() if b.checkout_date else None,
                "room_type":    b.room_type,
                "total_amount": float(b.total_amount or 0),
            }
            for b in bookings
        ],
    }


# ── Admin endpoints — manage global keys ────────────────────────────

class GlobalKeyCreate(BaseModel):
    partner_name:        str = Field(..., min_length=2, max_length=120)
    partner_code:        str = Field(..., min_length=2, max_length=40)
    contact_email:       Optional[str] = None
    contact_person:      Optional[str] = None
    webhook_url:         Optional[str] = None
    allowed_lodge_ids:   Optional[List[int]] = None  # None = all lodges
    commission_pct:      float = 10.0
    rate_markup_pct:     float = 0.0
    daily_booking_limit: int = 0


def _key_dict(k: GlobalApiKey, include_secret: bool = False) -> dict:
    return {
        "key_id":             k.key_id,
        "partner_name":       k.partner_name,
        "partner_code":       k.partner_code,
        "api_key":            k.api_key,
        "api_secret":         k.api_secret_hash if include_secret else "•••",
        "status":             k.status,
        "webhook_url":        k.webhook_url,
        "allowed_lodge_ids":  json.loads(k.allowed_lodge_ids) if k.allowed_lodge_ids else None,
        "commission_pct":     float(k.commission_pct or 0),
        "rate_markup_pct":    float(k.rate_markup_pct or 0),
        "daily_booking_limit": k.daily_booking_limit,
        "total_calls":        k.total_calls,
        "last_used_at":       k.last_used_at.isoformat() if k.last_used_at else None,
        "created_at":         k.created_at.isoformat() if k.created_at else None,
    }


@admin_router.get("/keys")
def list_keys(db: Session = Depends(get_db),
               user=Depends(require_super_admin)):
    keys = db.query(GlobalApiKey).order_by(GlobalApiKey.created_at.desc()).all()
    return {"keys": [_key_dict(k) for k in keys], "total": len(keys)}


@admin_router.post("/keys", status_code=201)
def create_key(body: GlobalKeyCreate,
                db: Session = Depends(get_db),
                user=Depends(require_super_admin)):
    raw_key    = "rgk_live_" + secrets.token_hex(20)
    raw_secret = "rgs_live_" + secrets.token_hex(20)
    secret_hash = hashlib.sha256(f"{raw_key}:{raw_secret}".encode()).hexdigest()

    k = GlobalApiKey(
        partner_name=body.partner_name,
        partner_code=body.partner_code.lower().strip(),
        contact_email=body.contact_email,
        contact_person=body.contact_person,
        api_key=raw_key,
        api_secret_hash=secret_hash,
        webhook_url=body.webhook_url,
        allowed_lodge_ids=json.dumps(body.allowed_lodge_ids) if body.allowed_lodge_ids else None,
        commission_pct=body.commission_pct,
        rate_markup_pct=body.rate_markup_pct,
        daily_booking_limit=body.daily_booking_limit,
        created_by=user.user_id,
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    result = _key_dict(k)
    result["api_secret"] = raw_secret  # shown ONCE
    result["note"] = "Store the api_secret securely — it will not be shown again."
    return result


@admin_router.patch("/keys/{key_id}")
def update_key(key_id: int, body: GlobalKeyCreate,
                db: Session = Depends(get_db),
                user=Depends(require_super_admin)):
    k = db.query(GlobalApiKey).filter(GlobalApiKey.key_id == key_id).first()
    if not k:
        raise HTTPException(404, "Key not found")
    k.partner_name   = body.partner_name
    k.contact_email  = body.contact_email
    k.webhook_url    = body.webhook_url
    k.commission_pct = body.commission_pct
    k.rate_markup_pct = body.rate_markup_pct
    k.allowed_lodge_ids = json.dumps(body.allowed_lodge_ids) if body.allowed_lodge_ids else None
    k.daily_booking_limit = body.daily_booking_limit
    db.commit()
    return _key_dict(k)


@admin_router.post("/keys/{key_id}/revoke")
def revoke_key(key_id: int, db: Session = Depends(get_db),
                user=Depends(require_super_admin)):
    k = db.query(GlobalApiKey).filter(GlobalApiKey.key_id == key_id).first()
    if not k:
        raise HTTPException(404, "Key not found")
    k.status = "revoked"
    db.commit()
    return {"revoked": True, "key_id": key_id, "partner_name": k.partner_name}
