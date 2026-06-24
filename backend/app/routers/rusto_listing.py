"""Lodge-admin-side listing management (the seller side of Rusto).

Lodge admin can:
  - Publish / unpublish their lodge on the Rusto consumer site
  - Set public description, city, state, lat/lng, amenities
  - Manage gallery photos
  - View incoming customer bookings (read-only here; lodge already has
    full booking workflows in the operational tape chart)

Tenant-scoped: a lodge admin only sees / edits their own lodge.
Super-admin can edit any lodge via X-Lodge-Id header.

Endpoints:
  GET   /api/rusto/listing                — my lodge's public listing
  PATCH /api/rusto/listing                — update publishable fields
  GET   /api/rusto/listing/photos
  POST  /api/rusto/listing/photos
  PATCH /api/rusto/listing/photos/{id}
  DELETE /api/rusto/listing/photos/{id}
  GET   /api/rusto/listing/bookings       — incoming customer bookings
"""
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import Lodge, LodgePhoto, CustomerBooking, CustomerBookingStatus, RustoCustomer
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rusto/listing", tags=["rusto-listing"])


# ── Read / update listing ────────────────────────────────────────────

def _lodge_to_listing(l: Lodge, db: Session) -> dict:
    photos = (db.query(LodgePhoto)
              .filter(LodgePhoto.lodge_id == l.lodge_id)
              .order_by(LodgePhoto.sort_order.asc()).all())
    return {
        "lodge_id": l.lodge_id,
        "code": l.code,
        "name": l.name,
        "address": l.address,
        "phone": l.phone,
        "email": l.email,
        "is_published": bool(l.is_published),
        "public_description": l.public_description,
        "public_city": l.public_city,
        "public_town": l.public_town,
        "public_area": l.public_area,
        "public_landmark": l.public_landmark,
        "public_pincode": l.public_pincode,
        "public_state": l.public_state,
        "public_country": l.public_country,
        "latitude": float(l.latitude) if l.latitude else None,
        "longitude": float(l.longitude) if l.longitude else None,
        "starting_price": float(l.starting_price) if l.starting_price else None,
        "amenities": (l.amenities or "").split(",") if l.amenities else [],
        "photo_count": len(photos),
        "photos": [{"photo_id": p.photo_id, "url": p.url, "caption": p.caption,
                    "sort_order": p.sort_order} for p in photos],
        # Surface guidance about what's missing before they can publish.
        "publish_blockers": _publish_blockers(l, photos),
        # v9 fields
        "power_backup":        bool(getattr(l, "power_backup", False)),
        "hot_water_24h":       bool(getattr(l, "hot_water_24h", False)),
        "parking_available":   bool(getattr(l, "parking_available", False)),
        "bus_stand_km":        float(l.bus_stand_km) if getattr(l, "bus_stand_km", None) else None,
        "railway_station_km":  float(l.railway_station_km) if getattr(l, "railway_station_km", None) else None,
        "temple_nearby":       bool(getattr(l, "temple_nearby", False)),
        "checkin_time":        getattr(l, "checkin_time", "12:00"),
        "checkout_time":       getattr(l, "checkout_time", "11:00"),
        "property_type":       getattr(l, "property_type", "lodge"),
        "star_category":       getattr(l, "star_category", 0),
        "cancellation_policy": getattr(l, "cancellation_policy", "flexible"),
        "cancellation_hours":  getattr(l, "cancellation_hours", 24),
        "max_online_rooms_pct": getattr(l, "max_online_rooms_pct", 100),
        "instant_confirm":     bool(getattr(l, "instant_confirm", True)),
        "allow_online_booking": bool(getattr(l, "allow_online_booking", True)),
    }


def _publish_blockers(l: Lodge, photos: List[LodgePhoto]) -> List[str]:
    """A lodge is "ready to publish" when it has city + description + at
    least one photo + a starting price. Returns the list of missing
    items so the UI can show a checklist."""
    missing = []
    if not l.public_city: missing.append("public_city")
    if not l.public_description or len(l.public_description.strip()) < 30:
        missing.append("public_description (min 30 chars)")
    if not photos: missing.append("photos (at least 1)")
    if not l.starting_price or float(l.starting_price) <= 0:
        missing.append("starting_price")
    return missing


@router.get("")
@router.get("/info")
def get_my_listing(db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    return _lodge_to_listing(lodge, db)


class ListingPatch(BaseModel):
    is_published: Optional[bool] = None
    public_description: Optional[str] = Field(default=None, max_length=5000)
    public_city: Optional[str] = Field(default=None, max_length=80)
    public_town: Optional[str] = Field(default=None, max_length=80)
    public_area: Optional[str] = Field(default=None, max_length=80)
    public_landmark: Optional[str] = Field(default=None, max_length=80)
    public_pincode: Optional[str] = Field(default=None, max_length=20)
    public_state: Optional[str] = Field(default=None, max_length=80)
    public_country: Optional[str] = Field(default=None, max_length=80)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    starting_price: Optional[float] = Field(default=None, ge=0)
    # Comma-separated string from UI ("WiFi,Parking,AC,Pool")
    amenities: Optional[str] = Field(default=None, max_length=500)
    # v9 — enhanced amenity + policy fields
    power_backup: Optional[bool] = None
    hot_water_24h: Optional[bool] = None
    parking_available: Optional[bool] = None
    bus_stand_km: Optional[float] = Field(default=None, ge=0)
    railway_station_km: Optional[float] = Field(default=None, ge=0)
    temple_nearby: Optional[bool] = None
    checkin_time: Optional[str] = Field(default=None, max_length=10)
    checkout_time: Optional[str] = Field(default=None, max_length=10)
    property_type: Optional[str] = Field(default=None, max_length=40)
    star_category: Optional[int] = Field(default=None, ge=0, le=5)
    cancellation_policy: Optional[str] = Field(default=None, max_length=40)
    cancellation_hours: Optional[int] = Field(default=None, ge=0, le=168)
    max_online_rooms_pct: Optional[int] = Field(default=None, ge=0, le=100)
    instant_confirm: Optional[bool] = None
    allow_online_booking: Optional[bool] = None


@router.patch("")
def update_my_listing(body: ListingPatch, request: Request,
                       db: Session = Depends(get_db),
                       current_user=Depends(require_admin),
                       lodge_id: int = Depends(resolve_lodge_scope)):
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")

    data = body.model_dump(exclude_unset=True)

    # If they're trying to publish, check blockers FIRST.
    if data.get("is_published") is True and not lodge.is_published:
        photos = db.query(LodgePhoto).filter(LodgePhoto.lodge_id == lodge_id).all()
        # Apply the patch in-memory first so we evaluate the about-to-be state.
        tmp = type("T", (), {})()
        for attr in ["public_city", "public_description", "starting_price"]:
            setattr(tmp, attr, data.get(attr, getattr(lodge, attr)))
        blockers = _publish_blockers(tmp, photos)
        if blockers:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot publish — please fill: {', '.join(blockers)}",
            )

    for k, v in data.items():
        setattr(lodge, k, v)
    db.commit(); db.refresh(lodge)

    try:
        log_audit(db, "rusto_listing.updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="lodge", entity_id=lodge.lodge_id,
                  lodge_id=lodge.lodge_id,
                  details={"fields": list(data.keys())},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return _lodge_to_listing(lodge, db)


# ── Photos ───────────────────────────────────────────────────────────

class PhotoCreate(BaseModel):
    url: str = Field(min_length=4, max_length=500)
    caption: Optional[str] = Field(default=None, max_length=200)
    sort_order: int = 0


@router.post("/photos", status_code=201)
def add_photo(body: PhotoCreate,
               db: Session = Depends(get_db),
               current_user=Depends(require_admin),
               lodge_id: int = Depends(resolve_lodge_scope)):
    p = LodgePhoto(lodge_id=lodge_id, url=body.url.strip(),
                    caption=(body.caption or "").strip() or None,
                    sort_order=body.sort_order)
    db.add(p); db.commit(); db.refresh(p)
    return {"photo_id": p.photo_id, "url": p.url, "caption": p.caption,
            "sort_order": p.sort_order}


class PhotoPatch(BaseModel):
    caption: Optional[str] = Field(default=None, max_length=200)
    sort_order: Optional[int] = None


@router.patch("/photos/{photo_id}")
def update_photo(photo_id: int, body: PhotoPatch,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    p = db.query(LodgePhoto).filter(LodgePhoto.photo_id == photo_id,
                                       LodgePhoto.lodge_id == lodge_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    db.commit(); db.refresh(p)
    return {"photo_id": p.photo_id, "url": p.url, "caption": p.caption,
            "sort_order": p.sort_order}


@router.delete("/photos/{photo_id}")
def delete_photo(photo_id: int,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    p = db.query(LodgePhoto).filter(LodgePhoto.photo_id == photo_id,
                                       LodgePhoto.lodge_id == lodge_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Photo not found")
    db.delete(p); db.commit()
    return {"success": True}


# ── Incoming customer bookings ──────────────────────────────────────

@router.get("/bookings")
def list_incoming_bookings(status: Optional[str] = None,
                            db: Session = Depends(get_db),
                            current_user=Depends(get_current_user),
                            lodge_id: int = Depends(resolve_lodge_scope)):
    """RustoCustomer-side bookings flowing INTO this lodge from Rusto. Lodge
    admins see who's coming, when, contact details."""
    q = db.query(CustomerBooking).filter(CustomerBooking.lodge_id == lodge_id)
    if status:
        q = q.filter(CustomerBooking.status == status)
    rows = q.order_by(CustomerBooking.created_at.desc()).limit(200).all()

    out = []
    for b in rows:
        cust = db.query(RustoCustomer).filter(RustoCustomer.customer_id == b.customer_id).first()
        out.append({
            "booking_id": b.booking_id,
            "booking_ref": b.booking_ref,
            "room_type": b.room_type,
            "rooms_count": b.rooms_count,
            "checkin_date": b.checkin_date.isoformat(),
            "checkout_date": b.checkout_date.isoformat(),
            "nights": b.nights,
            "adults": b.adults, "children": b.children,
            "total_amount": float(b.total_amount),
            "status": b.status,
            "contact_name": b.contact_name,
            "contact_phone": b.contact_phone,
            "contact_email": b.contact_email,
            "special_requests": b.special_requests,
            "customer_phone": cust.phone if cust else None,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return out


# ── Lodge-side booking actions ───────────────────────────────────────

class BookingActionBody(BaseModel):
    note: Optional[str] = None


@router.post("/bookings/{booking_id}/confirm")
def confirm_booking(booking_id: int,
                    body: BookingActionBody,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    """Lodge admin confirms a pending customer booking.
    Also creates a PMS Booking record so it appears in the operational system."""
    bk = db.query(CustomerBooking).filter(
        CustomerBooking.booking_id == booking_id,
        CustomerBooking.lodge_id == lodge_id,
    ).filter(
        CustomerBooking.status.in_([
            CustomerBookingStatus.payment_pending.value,
            CustomerBookingStatus.confirmed.value,
        ])
    ).first()
    if not bk:
        raise HTTPException(404, "Booking not found for this lodge")
    bk.status = CustomerBookingStatus.confirmed.value
    db.commit()

    # v10.2 — sync to PMS Booking table so lodge admin can check-in from PMS
    try:
        from .rusto_bookings import _sync_customer_booking_to_pms
        pms_bk = _sync_customer_booking_to_pms(db, bk)
        pms_ref = pms_bk.booking_ref if pms_bk else None
    except Exception as _e:
        import logging
        logging.getLogger(__name__).error("PMS sync on confirm failed: %s", _e)
        pms_ref = None

    return {"booking_id": bk.booking_id, "status": bk.status,
            "booking_ref": bk.booking_ref, "pms_booking_ref": pms_ref}


@router.post("/bookings/{booking_id}/reject")
def reject_booking(booking_id: int,
                   body: BookingActionBody,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Lodge admin rejects a pending customer booking."""
    bk = db.query(CustomerBooking).filter(
        CustomerBooking.booking_id == booking_id,
        CustomerBooking.lodge_id == lodge_id,
        CustomerBooking.status == CustomerBookingStatus.payment_pending.value,
    ).first()
    if not bk:
        raise HTTPException(404, "Pending booking not found for this lodge")
    bk.status = CustomerBookingStatus.cancelled.value
    db.commit()
    return {"booking_id": bk.booking_id, "status": bk.status, "booking_ref": bk.booking_ref}
