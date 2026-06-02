"""OTA reservations — manually-logged bookings from Booking.com / Expedia / etc.

Full channel-manager sync needs commercial API contracts; until those
are in place, front-desk staff log OTA bookings here as they arrive
via the OTA's extranet/email. The row captures the OTA's confirmation
number + commission rate so finance can reconcile what's owed back.

Each OtaReservation can optionally link to a Booking — useful once the
room is assigned and the guest is in our regular reservation flow.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date

from ..database import get_db
from ..models import OtaReservation, OtaChannel
from ..auth import get_current_user, require_admin, resolve_lodge_scope

router = APIRouter(prefix="/api/ota", tags=["ota"])


def _to_dict(r: OtaReservation) -> dict:
    return {
        "ota_id": r.ota_id,
        "channel": getattr(r.channel, "value", r.channel),
        "external_id": r.external_id,
        "booking_id": r.booking_id,
        "guest_name": r.guest_name,
        "guest_phone": r.guest_phone,
        "guest_email": r.guest_email,
        "arrival_date": r.arrival_date.isoformat() if r.arrival_date else None,
        "departure_date": r.departure_date.isoformat() if r.departure_date else None,
        "rooms_count": r.rooms_count,
        "room_type_requested": r.room_type_requested,
        "total_amount": float(r.total_amount or 0),
        "commission_pct": float(r.commission_pct) if r.commission_pct is not None else None,
        "commission_amount": float(r.commission_amount) if r.commission_amount is not None else None,
        "status": r.status,
        "received_at": r.received_at.isoformat() if r.received_at else None,
    }


@router.get("")
def list_ota(channel: Optional[str] = None,
              status: Optional[str] = None,
              db: Session = Depends(get_db),
              current_user=Depends(get_current_user),
              lodge_id: int = Depends(resolve_lodge_scope)):
    q = db.query(OtaReservation).filter(OtaReservation.lodge_id == lodge_id)
    if channel:
        try:
            q = q.filter(OtaReservation.channel == OtaChannel(channel))
        except ValueError:
            raise HTTPException(status_code=400, detail="Unknown channel")
    if status:
        q = q.filter(OtaReservation.status == status)
    rows = q.order_by(OtaReservation.received_at.desc()).limit(500).all()
    return [_to_dict(r) for r in rows]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Counts + commission totals per channel — for the dashboard widget."""
    by_channel = {}
    for ch, n, total, commission in (
        db.query(OtaReservation.channel,
                 func.count(OtaReservation.ota_id),
                 func.coalesce(func.sum(OtaReservation.total_amount), 0),
                 func.coalesce(func.sum(OtaReservation.commission_amount), 0))
        .filter(OtaReservation.lodge_id == lodge_id)
        .group_by(OtaReservation.channel).all()
    ):
        by_channel[getattr(ch, "value", ch)] = {
            "count": int(n),
            "revenue": float(total),
            "commission": float(commission),
        }
    return {"by_channel": by_channel}


class OtaCreate(BaseModel):
    channel: str = "direct"
    external_id: Optional[str] = None
    guest_name: str = Field(min_length=2, max_length=160)
    guest_phone: Optional[str] = None
    guest_email: Optional[str] = None
    arrival_date: date
    departure_date: date
    rooms_count: int = Field(default=1, ge=1)
    room_type_requested: Optional[str] = None
    total_amount: float = Field(ge=0)
    commission_pct: Optional[float] = Field(default=None, ge=0, le=100)


class OtaUpdate(BaseModel):
    booking_id: Optional[int] = None
    status: Optional[str] = None


@router.post("")
def create_ota(body: OtaCreate,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    try:
        ch = OtaChannel(body.channel)
    except ValueError:
        valid = [e.value for e in OtaChannel]
        raise HTTPException(status_code=400, detail=f"channel must be one of {valid}")
    if body.departure_date <= body.arrival_date:
        raise HTTPException(status_code=400, detail="departure must be after arrival")
    # De-dupe by (channel, external_id) when an external_id is supplied.
    if body.external_id:
        dup = (db.query(OtaReservation)
               .filter(OtaReservation.lodge_id == lodge_id,
                       OtaReservation.channel == ch,
                       OtaReservation.external_id == body.external_id).first())
        if dup:
            raise HTTPException(status_code=409,
                                detail=f"Already logged ({ch.value} {body.external_id})")
    commission_amount = None
    if body.commission_pct is not None:
        commission_amount = round(body.total_amount * body.commission_pct / 100, 2)
    r = OtaReservation(
        lodge_id=lodge_id, channel=ch,
        external_id=body.external_id,
        guest_name=body.guest_name.strip(),
        guest_phone=body.guest_phone,
        guest_email=body.guest_email,
        arrival_date=body.arrival_date,
        departure_date=body.departure_date,
        rooms_count=body.rooms_count,
        room_type_requested=body.room_type_requested,
        total_amount=body.total_amount,
        commission_pct=body.commission_pct,
        commission_amount=commission_amount,
        status="confirmed",
        created_by=current_user.user_id,
    )
    db.add(r); db.commit(); db.refresh(r)
    return _to_dict(r)


@router.put("/{ota_id}")
def update_ota(ota_id: int,
               body: OtaUpdate,
               db: Session = Depends(get_db),
               current_user=Depends(require_admin),
               lodge_id: int = Depends(resolve_lodge_scope)):
    r = (db.query(OtaReservation)
         .filter(OtaReservation.ota_id == ota_id,
                 OtaReservation.lodge_id == lodge_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="OTA reservation not found")
    if body.booking_id is not None:
        r.booking_id = body.booking_id
    if body.status is not None:
        r.status = body.status
    db.commit()
    db.refresh(r)
    return _to_dict(r)


@router.delete("/{ota_id}")
def delete_ota(ota_id: int,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    r = (db.query(OtaReservation)
         .filter(OtaReservation.ota_id == ota_id,
                 OtaReservation.lodge_id == lodge_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="OTA reservation not found")
    db.delete(r); db.commit()
    return {"success": True}
