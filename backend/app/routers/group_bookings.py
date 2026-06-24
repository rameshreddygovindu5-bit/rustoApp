"""Group bookings — umbrella reservations spanning multiple rooms.

A wedding party reserves 8 rooms; a corporate group books 12 rooms for a
training. The GroupBooking row owns shared contact + special-rate +
bill-to. Individual Booking rows can be linked later for finer control,
but the simple path used by most lodges is: create a GroupBooking, then
multiple Bookings flow as one party at check-in.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime

from ..database import get_db
from ..models import GroupBooking, Booking
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/group-bookings", tags=["group-bookings"])


def _to_dict(g: GroupBooking, bookings_count: int = 0) -> dict:
    return {
        "group_id": g.group_id,
        "group_code": g.group_code,
        "group_name": g.group_name,
        "contact_name": g.contact_name,
        "contact_phone": g.contact_phone,
        "contact_email": g.contact_email,
        "arrival_date": g.arrival_date.isoformat() if g.arrival_date else None,
        "departure_date": g.departure_date.isoformat() if g.departure_date else None,
        "rooms_blocked": int(g.rooms_blocked or 0),
        "bill_to": g.bill_to,
        "special_rate": float(g.special_rate) if g.special_rate is not None else None,
        "status": g.status,
        "notes": g.notes,
        "linked_bookings": bookings_count,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


@router.get("")
def list_groups(status: Optional[str] = None,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    q = db.query(GroupBooking).filter(GroupBooking.lodge_id == lodge_id)
    if status:
        q = q.filter(GroupBooking.status == status)
    rows = q.order_by(GroupBooking.created_at.desc()).limit(200).all()
    # Booking → GroupBooking linkage is currently denormalized on the
    # GroupBooking row (rooms_blocked). When we add a FK column on Booking
    # in a future iteration we can count linked rows here; for now we
    # return 0 (the rooms_blocked counter is what the UI shows).
    return [_to_dict(g, 0) for g in rows]


class GroupCreate(BaseModel):
    group_code: str = Field(min_length=3, max_length=40)
    group_name: str = Field(min_length=2, max_length=160)
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    arrival_date: Optional[date] = None
    departure_date: Optional[date] = None
    rooms_blocked: int = Field(default=0, ge=0, le=200)
    bill_to: str = Field(default="single_invoice")
    special_rate: Optional[float] = None
    notes: Optional[str] = None


@router.post("")
def create_group(body: GroupCreate, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    if body.bill_to not in ("single_invoice", "individual_invoices"):
        raise HTTPException(status_code=400, detail="bill_to must be 'single_invoice' or 'individual_invoices'")
    # Uniqueness of group_code per lodge.
    dup = (db.query(GroupBooking)
           .filter(GroupBooking.lodge_id == lodge_id,
                   GroupBooking.group_code == body.group_code).first())
    if dup:
        raise HTTPException(status_code=409, detail="group_code already exists")
    g = GroupBooking(
        lodge_id=lodge_id,
        group_code=body.group_code.strip().upper(),
        group_name=body.group_name.strip(),
        contact_name=body.contact_name,
        contact_phone=body.contact_phone,
        contact_email=body.contact_email,
        arrival_date=body.arrival_date,
        departure_date=body.departure_date,
        rooms_blocked=body.rooms_blocked,
        bill_to=body.bill_to,
        special_rate=body.special_rate,
        notes=body.notes,
        status="confirmed",
        created_by=current_user.user_id,
    )
    db.add(g); db.commit(); db.refresh(g)
    try:
        log_audit(db, "group_booking.created",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="group_booking", entity_id=g.group_id, lodge_id=lodge_id,
                  details={"group_code": g.group_code, "rooms_blocked": g.rooms_blocked})
    except Exception:
        pass
    return _to_dict(g)


class GroupUpdate(BaseModel):
    group_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    arrival_date: Optional[date] = None
    departure_date: Optional[date] = None
    rooms_blocked: Optional[int] = None
    bill_to: Optional[str] = None
    special_rate: Optional[float] = None
    notes: Optional[str] = None
    status: Optional[str] = None


@router.patch("/{group_id}")
def update_group(group_id: int, body: GroupUpdate,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    g = (db.query(GroupBooking)
         .filter(GroupBooking.group_id == group_id,
                 GroupBooking.lodge_id == lodge_id).first())
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    fields = body.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] not in ("confirmed", "cancelled", "completed"):
        raise HTTPException(status_code=400, detail="status must be confirmed|cancelled|completed")
    for k, v in fields.items():
        setattr(g, k, v)
    db.commit(); db.refresh(g)
    return _to_dict(g)


@router.delete("/{group_id}")
def delete_group(group_id: int,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    g = (db.query(GroupBooking)
         .filter(GroupBooking.group_id == group_id,
                 GroupBooking.lodge_id == lodge_id).first())
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    db.delete(g); db.commit()
    return {"success": True}
