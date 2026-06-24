"""Lodges router — multi-tenant management endpoints.

Visibility:
- Any authenticated user can call GET /lodges/me  → just their own lodge.
- super_admin can list/create/update lodges via the other endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import re

from ..database import get_db
from ..models import Lodge, User
from ..auth import get_current_user, require_super_admin
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/lodges", tags=["lodges"])


def _to_dict(l: Lodge, db: Session = None, rich: bool = False) -> dict:
    """Base lodge dict. If `db` is provided and `rich=True`, augments with
    live stats (room count, subscription plan, settings) for the super-admin views."""
    base = {
        "lodge_id":   l.lodge_id,
        "code":       l.code,
        "name":       l.name,
        "address":    l.address,
        "phone":      l.phone,
        "email":      l.email,
        "is_active":  bool(l.is_active),
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }
    if not (db and rich):
        return base

    # ── Rich data for super-admin dashboard ──────────────────────────
    from sqlalchemy import func
    from ..models import (Room, Checkin, CheckinStatus, Setting,
                           LodgeRegistrationRequest, RegistrationStatus,
                           CustomerBooking, CustomerBookingStatus)

    # Room count
    room_count = db.query(func.count(Room.room_id)).filter(
        Room.lodge_id == l.lodge_id).scalar() or 0

    # Current occupancy
    active_checkins = db.query(func.count(Checkin.checkin_id)).filter(
        Checkin.lodge_id == l.lodge_id,
        Checkin.status == CheckinStatus.active.value).scalar() or 0
    occupancy_pct = round(100 * active_checkins / room_count, 1) if room_count else 0

    # Key settings
    key_settings = ["hotel_name", "property_category", "enabled_modules",
                     "primary_color", "hotel_city", "hotel_email", "hotel_phone"]
    srow = db.query(Setting).filter(
        Setting.lodge_id == l.lodge_id,
        Setting.setting_key.in_(key_settings)).all()
    settings_map = {s.setting_key: s.setting_value for s in srow}

    # Subscription plan (from registration)
    reg = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.created_lodge_id == l.lodge_id).first()

    # Rusto marketplace status
    is_published = bool(getattr(l, "is_published", False))
    public_city  = getattr(l, "public_city", None)

    # Last booking activity
    last_bk = db.query(func.max(CustomerBooking.created_at)).filter(
        CustomerBooking.lodge_id == l.lodge_id).scalar()

    # Total online bookings
    online_bookings = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.lodge_id == l.lodge_id).scalar() or 0

    base.update({
        "room_count":       room_count,
        "active_checkins":  active_checkins,
        "occupancy_pct":    occupancy_pct,
        "is_published":     is_published,
        "public_city":      public_city or settings_map.get("hotel_city"),
        "property_category": settings_map.get("property_category", "lodge"),
        "hotel_name":       settings_map.get("hotel_name", l.name),
        "primary_color":    settings_map.get("primary_color", "#1B2A4A"),
        "plan":             reg.selected_plan if reg else None,
        "payment_status":   reg.payment_status if reg else None,
        "online_bookings":  online_bookings,
        "last_activity":    last_bk.isoformat() if last_bk else None,
        "modules_count":    len(__import__("json").loads(settings_map.get("enabled_modules","[]")))
                            if settings_map.get("enabled_modules") else None,
    })
    return base


@router.get("/me")
def get_my_lodge(current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """The lodge the currently-logged-in user belongs to."""
    if current_user.lodge_id is None:
        # super_admin without a current selection — no lodge to report.
        return None
    lodge = db.query(Lodge).filter(Lodge.lodge_id == current_user.lodge_id).first()
    return _to_dict(lodge) if lodge else None


@router.get("")
def list_lodges(current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    """List lodges visible to the caller.

    Regular users see only their own (so the lodge dropdown can show *that
    lodge and disable it* per requirement). super_admin and app_owner see all lodges,
    so the dropdown becomes a real selector for them.
    """
    role = getattr(current_user.role, "value", current_user.role)
    if role in ("super_admin", "app_owner"):
        rows = db.query(Lodge).order_by(Lodge.lodge_id).all()
    else:
        rows = (db.query(Lodge)
                .filter(Lodge.lodge_id == current_user.lodge_id)
                .all())
    use_rich = role in ("super_admin", "app_owner")
    return [_to_dict(l, db=db if use_rich else None, rich=use_rich) for l in rows]


class LodgeCreate(BaseModel):
    code: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@router.post("", status_code=201)
def create_lodge(body: LodgeCreate, request: Request,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_super_admin)):
    """Super-admin: create a new lodge."""
    code = (body.code or "").strip().lower()
    if not re.match(r"^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$", code):
        raise HTTPException(
            status_code=400,
            detail="code must be 3–40 chars, lowercase alphanumeric / underscore / hyphen",
        )
    if db.query(Lodge).filter(Lodge.code == code).first():
        raise HTTPException(status_code=409, detail=f"Lodge code '{code}' is already taken")
    if not body.name or len(body.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Lodge name is required")

    lodge = Lodge(
        code=code,
        name=body.name.strip(),
        address=body.address,
        phone=body.phone,
        email=body.email,
        is_active=True,
    )
    db.add(lodge)
    db.commit()
    db.refresh(lodge)

    # Seed a baseline set of settings for the new lodge by copying from the
    # first existing lodge (best available template).
    _copy_settings_template(db, lodge.lodge_id, new_name=body.name.strip())

    # Audit the lodge creation — for super_admin actions we stamp the
    # audit row with the NEW lodge's id, so it shows up in that lodge's
    # audit history (where you'd expect to find "lodge was created").
    try:
        log_audit(
            db, "lodge.created",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"code": lodge.code, "name": lodge.name},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return _to_dict(lodge)


class LodgeUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/{lodge_id}")
def update_lodge(lodge_id: int, body: LodgeUpdate, request: Request,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_super_admin)):
    """Super-admin: update lodge metadata. Code is immutable."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    changed = body.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(lodge, field, value)
    db.commit()
    db.refresh(lodge)
    try:
        log_audit(
            db, "lodge.updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"changed": list(changed.keys())},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return _to_dict(lodge)




class LodgePortalSettingsBody(BaseModel):
    """All the fields a super_admin can configure for a lodge's portal branding.
    Written to the Settings table under that lodge's lodge_id."""
    lodge_ip_ranges: Optional[str] = None   # newline-separated CIDR blocks
    hotel_name:      Optional[str] = None
    hotel_tagline:   Optional[str] = None
    hotel_phone:     Optional[str] = None
    hotel_email:     Optional[str] = None
    hotel_address:   Optional[str] = None
    hotel_city:      Optional[str] = None
    hotel_website:   Optional[str] = None
    primary_color:   Optional[str] = None   # hex e.g. "#07131C"
    accent_color:    Optional[str] = None   # hex e.g. "#E8A020"


@router.put("/{lodge_id}/portal-settings")
def set_lodge_portal_settings(
    lodge_id: int,
    body: LodgePortalSettingsBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Super-admin only: configure portal branding + IP routing for a lodge.

    Settings saved:
      lodge_ip_ranges  — CIDR/IP list; triggers portal detection to redirect to PMS
      hotel_name       — displayed on the lodge-branded login page
      hotel_tagline    — subtitle on the login page
      hotel_phone/email/address/city/website — shown on branded login
      primary_color    — left-panel background colour (hex)
      accent_color     — accent / button colour (hex)

    The logo is uploaded via the existing POST /api/settings/logo endpoint
    (super_admin passes X-Lodge-Id header to scope it to any lodge).
    """
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")

    from ..models import Setting

    def _upsert(key: str, value: Optional[str], group: str = "hotel"):
        if value is None:
            return  # not included in request — leave existing value unchanged
        existing = db.query(Setting).filter(
            Setting.lodge_id == lodge_id,
            Setting.setting_key == key,
        ).first()
        if existing:
            existing.setting_value = value
        else:
            db.add(Setting(
                lodge_id=lodge_id,
                setting_key=key,
                setting_value=value,
                setting_group=group,
                description=f"Portal: {key}",
            ))

    fields = body.model_dump(exclude_unset=True)
    for key, value in fields.items():
        group = "system" if key == "lodge_ip_ranges" else "hotel"
        _upsert(key, value, group)

    db.commit()

    try:
        from ..services.audit_service import log_audit
        log_audit(
            db, "lodge.portal_settings_updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge_id, lodge_id=lodge_id,
            details={"fields": list(fields.keys())},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass

    return {"success": True, "lodge_id": lodge_id, "updated_fields": list(fields.keys())}


@router.get("/{lodge_id}/portal-settings")
def get_lodge_portal_settings(
    lodge_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Return all portal-related settings for a lodge (for the edit modal)."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")

    from ..models import Setting

    PORTAL_KEYS = [
        "lodge_ip_ranges", "hotel_name", "hotel_tagline",
        "hotel_phone", "hotel_email", "hotel_address", "hotel_city",
        "hotel_website", "primary_color", "accent_color", "logo_path",
    ]
    rows = db.query(Setting).filter(
        Setting.lodge_id == lodge_id,
        Setting.setting_key.in_(PORTAL_KEYS),
    ).all()
    settings = {r.setting_key: r.setting_value for r in rows}

    # Defaults for colour pickers so the UI shows something sensible
    settings.setdefault("primary_color", "#07131C")
    settings.setdefault("accent_color",  "#E8A020")

    return {
        "lodge_id":   lodge_id,
        "lodge_name": lodge.name,
        "lodge_code": lodge.code,
        "settings":   settings,
    }

@router.delete("/{lodge_id}")
def archive_lodge(lodge_id: int, request: Request,
                  db: Session = Depends(get_db),
                  current_user: User = Depends(require_super_admin)):
    """Super-admin: archive (soft-delete) a lodge by setting is_active=False.
    The data stays in place (so historical bookings/invoices remain), but
    the lodge stops appearing in the active list. We don't hard-delete
    because too many other rows have foreign keys into it."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    # Refuse to archive the only remaining active lodge — that would
    # silently lock everyone out.
    other_active = (db.query(Lodge)
                    .filter(Lodge.is_active == True,
                            Lodge.lodge_id != lodge_id)
                    .count())
    if other_active == 0:
        raise HTTPException(status_code=400,
                            detail="Cannot archive the only active lodge")
    lodge.is_active = False
    db.commit()
    try:
        log_audit(
            db, "lodge.archived",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"code": lodge.code, "name": lodge.name},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": f"Lodge '{lodge.name}' archived"}


def _copy_settings_template(db: Session, new_lodge_id: int, new_name: str = ""):
    """Copy the first existing lodge's settings to a new lodge so it starts
    with sensible defaults (tariffs, GST flags, alert flags). Skips any key
    that already exists on the new lodge."""
    from ..models import Setting
    first = (db.query(Lodge)
             .filter(Lodge.lodge_id != new_lodge_id)
             .order_by(Lodge.lodge_id)
             .first())
    if not first:
        return
    template = db.query(Setting).filter(Setting.lodge_id == first.lodge_id).all()
    existing_keys = {
        r.setting_key for r in
        db.query(Setting).filter(Setting.lodge_id == new_lodge_id).all()
    }
    for s in template:
        if s.setting_key in existing_keys:
            continue
        # Override hotel_name with the new lodge's name; secrets are blanked
        # so the new lodge doesn't inherit Twilio credentials etc.
        sensitive_blank = bool(s.is_sensitive)
        val = ("" if sensitive_blank
               else (new_name if s.setting_key == "hotel_name" and new_name else s.setting_value))
        db.add(Setting(
            lodge_id=new_lodge_id,
            setting_key=s.setting_key,
            setting_value=val,
            setting_group=s.setting_group,
            description=s.description,
            is_sensitive=s.is_sensitive,
        ))
    db.commit()


# ── v11 — Super-admin: rich lodge detail + cross-lodge search ─────────

@router.get("/{lodge_id}/detail")
def get_lodge_detail(lodge_id: int,
                      db: Session = Depends(get_db),
                      current_user: User = Depends(require_super_admin)):
    """Full lodge detail for super-admin: all settings, subscription, health."""
    l = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not l:
        raise HTTPException(404, "Lodge not found")

    from sqlalchemy import func
    from ..models import (Room, Checkin, CheckinStatus, Setting, User as UserM,
                           Booking, CustomerBooking, CustomerBookingStatus,
                           LodgeRegistrationRequest)

    # All settings
    all_settings = {s.setting_key: s.setting_value
                    for s in db.query(Setting).filter(Setting.lodge_id == lodge_id).all()}

    # Staff count
    staff_count = db.query(func.count(UserM.user_id)).filter(
        UserM.lodge_id == lodge_id, UserM.is_active == True).scalar() or 0

    # Room stats
    room_total = db.query(func.count(Room.room_id)).filter(Room.lodge_id == lodge_id).scalar() or 0
    room_occupied = db.query(func.count(Checkin.checkin_id)).filter(
        Checkin.lodge_id == lodge_id, Checkin.status == CheckinStatus.active.value).scalar() or 0

    # PMS bookings (30 days)
    from datetime import datetime, timedelta, timezone
    since = _utcnow() - timedelta(days=30)
    pms_bk_30d = db.query(func.count(Booking.booking_id)).filter(
        Booking.lodge_id == lodge_id, Booking.created_at >= since).scalar() or 0

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

    # Online bookings
    online_bk_total = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.lodge_id == lodge_id).scalar() or 0
    online_bk_revenue = db.query(func.sum(CustomerBooking.total_amount)).filter(
        CustomerBooking.lodge_id == lodge_id,
        CustomerBooking.status.in_([
            CustomerBookingStatus.confirmed.value,
            CustomerBookingStatus.checked_in.value,
            CustomerBookingStatus.checked_out.value,
        ])).scalar() or 0

    # Registration
    reg = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.created_lodge_id == lodge_id).first()

    return {
        **_to_dict(l, db=db, rich=True),
        "all_settings":       all_settings,
        "staff_count":        staff_count,
        "room_total":         room_total,
        "room_occupied":      room_occupied,
        "pms_bookings_30d":   pms_bk_30d,
        "online_bk_total":    online_bk_total,
        "online_bk_revenue":  float(online_bk_revenue),
        "registration": {
            "request_id":     reg.request_id if reg else None,
            "plan":           reg.selected_plan if reg else None,
            "billing_cycle":  reg.billing_cycle if reg else None,
            "payment_status": reg.payment_status if reg else None,
            "payment_method": reg.payment_method if reg else None,
            "quoted_price":   float(reg.quoted_price_inr) if reg and reg.quoted_price_inr else None,
            "approved_at":    reg.reviewed_at.isoformat() if reg and reg.reviewed_at else None,
        } if reg else None,
    }


@router.get("/search/cross-tenant")
def cross_tenant_search(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Search customers, bookings, and users across ALL lodges."""
    if len(q.strip()) < 2:
        raise HTTPException(400, "Query must be at least 2 characters")

    from sqlalchemy import or_
    from ..models import RustoCustomer, CustomerBooking, User as UserM

    like = f"%{q}%"
    results = {"query": q, "customers": [], "bookings": [], "staff": []}

    # Customer search
    customers = db.query(RustoCustomer).filter(or_(
        RustoCustomer.full_name.ilike(like),
        RustoCustomer.phone.ilike(like),
        RustoCustomer.email.ilike(like),
    )).limit(10).all()
    results["customers"] = [
        {"customer_id": c.customer_id, "name": c.full_name,
         "phone": c.phone, "email": c.email}
        for c in customers
    ]

    # Booking search by ref
    bookings = db.query(CustomerBooking).filter(
        CustomerBooking.booking_ref.ilike(like)
    ).limit(10).all()
    results["bookings"] = [
        {"booking_id": b.booking_id, "booking_ref": b.booking_ref,
         "lodge_id": b.lodge_id, "status": b.status,
         "total_amount": float(b.total_amount) if b.total_amount else 0}
        for b in bookings
    ]

    # Staff search
    staff = db.query(UserM).filter(or_(
        UserM.username.ilike(like),
        UserM.full_name.ilike(like),
        UserM.email.ilike(like),
    )).limit(10).all()
    results["staff"] = [
        {"user_id": u.user_id, "username": u.username,
         "full_name": u.full_name, "lodge_id": u.lodge_id, "role": u.role}
        for u in staff
    ]

    return results
