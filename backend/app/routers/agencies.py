"""
Admin endpoints for managing agency partners.
Only admins can create / regenerate / suspend agencies.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, timedelta

from ..database import get_db
from ..models import Agency, AgencyApiCall, AgencyStatus, Booking, BookingStatus
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..partner_auth import (generate_api_key, generate_api_secret,
                            generate_webhook_secret, hash_secret)
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/agencies", tags=["agencies-admin"])


# ─── Schemas ──────────────────────────────────────────────────────────
class AgencyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    code: str = Field(..., min_length=2, max_length=30,
                      pattern=r"^[a-z0-9_-]+$",
                      description="Slug, lowercase alphanumeric/underscore/dash")
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    contact_person: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    webhook_url: Optional[str] = None
    commission_pct: float = 10.0
    rate_markup_pct: float = 0.0
    allowed_room_types: str = "deluxe_ac,ac,non_ac,house"
    daily_booking_limit: int = 0
    max_advance_days: int = 180


class AgencyUpdate(BaseModel):
    name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    contact_person: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    webhook_url: Optional[str] = None
    commission_pct: Optional[float] = None
    rate_markup_pct: Optional[float] = None
    allowed_room_types: Optional[str] = None
    daily_booking_limit: Optional[int] = None
    max_advance_days: Optional[int] = None


def _agency_dict(a: Agency, include_secret_preview: bool = False) -> dict:
    return {
        "agency_id": a.agency_id,
        "name": a.name,
        "code": a.code,
        "contact_email": a.contact_email,
        "contact_phone": a.contact_phone,
        "contact_person": a.contact_person,
        "address": a.address,
        "website": a.website,
        "api_key": a.api_key,                    # safe to show; secret is what's hidden
        "api_secret": "••••••••••••••••",       # never show real secret
        "webhook_url": a.webhook_url,
        "webhook_secret_set": bool(a.webhook_secret),
        "commission_pct": float(a.commission_pct or 0),
        "rate_markup_pct": float(a.rate_markup_pct or 0),
        "allowed_room_types": a.allowed_room_types,
        "daily_booking_limit": a.daily_booking_limit,
        "max_advance_days": a.max_advance_days,
        "total_bookings": a.total_bookings,
        "total_revenue": float(a.total_revenue or 0),
        "status": a.status.value if hasattr(a.status, "value") else a.status,
        "last_used_at": a.last_used_at.isoformat() if a.last_used_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ─── Routes ───────────────────────────────────────────────────────────
@router.get("")
def list_agencies(db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(Agency)
            .filter(Agency.lodge_id == lodge_id)
            .order_by(Agency.created_at.desc()).all())
    return [_agency_dict(a) for a in rows]


@router.get("/{agency_id}")
def get_agency_detail(agency_id: int, db: Session = Depends(get_db),
                      current_user=Depends(get_current_user),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    a = db.query(Agency).filter(
        Agency.agency_id == agency_id,
        Agency.lodge_id == lodge_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Agency not found")

    # Stats (lodge-scoped — bookings/api_calls inherit lodge from agency)
    bookings_total = (db.query(Booking)
                      .filter(Booking.agency_id == agency_id,
                              Booking.lodge_id == lodge_id).count())
    bookings_active = (db.query(Booking)
                       .filter(Booking.agency_id == agency_id,
                               Booking.lodge_id == lodge_id,
                               Booking.status.in_([BookingStatus.confirmed,
                                                   BookingStatus.checked_in,
                                                   BookingStatus.pending]))
                       .count())
    last24h = datetime.utcnow() - timedelta(hours=24)
    api_calls_24h = (db.query(AgencyApiCall)
                     .filter(AgencyApiCall.agency_id == agency_id,
                             AgencyApiCall.lodge_id == lodge_id,
                             AgencyApiCall.called_at >= last24h)
                     .count())

    return {
        **_agency_dict(a),
        "stats": {
            "bookings_total": bookings_total,
            "bookings_active": bookings_active,
            "api_calls_24h": api_calls_24h,
        },
    }


@router.post("", status_code=201)
def create_agency(body: AgencyCreate, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """Create a new agency partner. Each lodge has its own set of partners —
    code uniqueness is per-lodge."""
    # Agency code uniqueness scoped to lodge: two lodges can each have a
    # partner code like "makemytrip" because they're separate businesses.
    if db.query(Agency).filter(
        Agency.code == body.code,
        Agency.lodge_id == lodge_id,
    ).first():
        raise HTTPException(status_code=400, detail=f"Agency code '{body.code}' already exists")

    api_key = generate_api_key()
    api_secret = generate_api_secret()
    webhook_secret = generate_webhook_secret()

    agency = Agency(
        lodge_id=lodge_id,
        name=body.name,
        code=body.code,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        contact_person=body.contact_person,
        address=body.address,
        website=body.website,
        webhook_url=body.webhook_url,
        api_key=api_key,
        api_secret_hash=hash_secret(api_secret),
        webhook_secret=webhook_secret,
        commission_pct=body.commission_pct,
        rate_markup_pct=body.rate_markup_pct,
        allowed_room_types=body.allowed_room_types,
        daily_booking_limit=body.daily_booking_limit,
        max_advance_days=body.max_advance_days,
        status=AgencyStatus.active,
        created_by=current_user.user_id,
    )
    db.add(agency)
    db.commit()
    db.refresh(agency)

    log_audit(db, "agency.created",
              actor_user_id=current_user.user_id,
              actor_username=current_user.username,
              entity_type="agency", entity_id=agency.agency_id,
              details={"name": body.name, "code": body.code},
              ip_address=request.client.host if request.client else None)

    return {
        "agency": _agency_dict(agency),
        "credentials": {
            "api_key": api_key,
            "api_secret": api_secret,
            "webhook_secret": webhook_secret,
            "warning": ("Save these now. The api_secret cannot be retrieved later. "
                        "If lost, regenerate it (which invalidates the old one)."),
            "base_url_hint": "POST your X-API-Key + X-API-Secret to /api/partner/v1/...",
        },
    }


@router.put("/{agency_id}")
def update_agency(agency_id: int, body: AgencyUpdate, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    a = db.query(Agency).filter(
        Agency.agency_id == agency_id,
        Agency.lodge_id == lodge_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Agency not found")

    for k, v in body.dict(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit()

    log_audit(db, "agency.updated",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="agency", entity_id=agency_id,
              details=body.dict(exclude_unset=True),
              ip_address=request.client.host if request.client else None)
    return _agency_dict(a)


@router.post("/{agency_id}/regenerate-secret")
def regenerate_secret(agency_id: int, request: Request,
                      db: Session = Depends(get_db),
                      current_user=Depends(require_admin),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    """Regenerate api_secret. Old secret stops working immediately."""
    a = db.query(Agency).filter(
        Agency.agency_id == agency_id,
        Agency.lodge_id == lodge_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Agency not found")
    new_secret = generate_api_secret()
    a.api_secret_hash = hash_secret(new_secret)
    db.commit()

    log_audit(db, "agency.secret_regenerated",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="agency", entity_id=agency_id,
              ip_address=request.client.host if request.client else None)
    return {"api_key": a.api_key, "api_secret": new_secret,
            "message": "Secret regenerated. Update partner immediately — old secret no longer works."}


@router.post("/{agency_id}/regenerate-webhook-secret")
def regenerate_webhook_secret_route(agency_id: int, request: Request,
                                    db: Session = Depends(get_db),
                                    current_user=Depends(require_admin),
                                    lodge_id: int = Depends(resolve_lodge_scope)):
    a = db.query(Agency).filter(
        Agency.agency_id == agency_id,
        Agency.lodge_id == lodge_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Agency not found")
    a.webhook_secret = generate_webhook_secret()
    db.commit()
    log_audit(db, "agency.webhook_secret_regenerated",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="agency", entity_id=agency_id,
              ip_address=request.client.host if request.client else None)
    return {"webhook_secret": a.webhook_secret}


@router.put("/{agency_id}/status")
def set_status(agency_id: int, body: dict, request: Request,
               db: Session = Depends(get_db),
               current_user=Depends(require_admin),
               lodge_id: int = Depends(resolve_lodge_scope)):
    new_status = body.get("status")
    if new_status not in [s.value for s in AgencyStatus]:
        raise HTTPException(status_code=400, detail="status must be active/suspended/revoked")
    a = db.query(Agency).filter(
        Agency.agency_id == agency_id,
        Agency.lodge_id == lodge_id,
    ).first()
    if not a:
        raise HTTPException(status_code=404, detail="Agency not found")
    a.status = new_status
    db.commit()
    log_audit(db, f"agency.status_{new_status}",
              actor_user_id=current_user.user_id, actor_username=current_user.username,
              entity_type="agency", entity_id=agency_id,
              ip_address=request.client.host if request.client else None)
    return _agency_dict(a)


@router.get("/{agency_id}/api-calls")
def list_api_calls(agency_id: int, limit: int = 100,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(AgencyApiCall)
            .filter(AgencyApiCall.agency_id == agency_id,
                    AgencyApiCall.lodge_id == lodge_id)
            .order_by(AgencyApiCall.called_at.desc())
            .limit(min(limit, 500))
            .all())
    return [{
        "id": r.id, "method": r.method, "path": r.path,
        "status_code": r.status_code, "response_ms": r.response_ms,
        "ip_address": r.ip_address, "error_message": r.error_message,
        "called_at": r.called_at.isoformat() if r.called_at else None,
    } for r in rows]


@router.get("/{agency_id}/bookings")
def list_agency_bookings(agency_id: int, limit: int = 100,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(Booking)
            .filter(Booking.agency_id == agency_id,
                    Booking.lodge_id == lodge_id)
            .order_by(Booking.created_at.desc())
            .limit(min(limit, 500))
            .all())
    return [{
        "booking_id": b.booking_id, "booking_ref": b.booking_ref,
        "agency_booking_ref": b.agency_booking_ref,
        "guest_name": b.guest_name, "guest_phone": b.guest_phone,
        "checkin_date": b.checkin_date.isoformat(),
        "checkout_date": b.checkout_date.isoformat(),
        "nights": b.nights, "total_amount": float(b.total_amount),
        "commission_amount": float(b.commission_amount or 0),
        "status": b.status.value if hasattr(b.status, "value") else b.status,
        "room_number": b.room.room_number if b.room else None,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    } for b in rows]
