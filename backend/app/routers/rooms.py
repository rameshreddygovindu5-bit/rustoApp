from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from ..database import get_db
from ..models import Room, RoomStatus, Checkin, CheckinStatus, Customer
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit
from pydantic import BaseModel
from datetime import date, datetime

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


# Sentinel so callers can pass active_checkin=None ("I looked it up in bulk,
# this room has no active check-in") and we can still tell that apart from
# "caller didn't pass anything — fall back to lazy-loading r.checkins".
_UNSET = object()


def _bulk_active_checkins(db: Session, lodge_id: int):
    """One query → {room_id: [active Checkins]} for a lodge, with customers
    eager-loaded. Kills the per-room r.checkins N+1 in list endpoints."""
    rows = (db.query(Checkin)
              .options(joinedload(Checkin.customer))
              .filter(Checkin.lodge_id == lodge_id,
                      Checkin.status == CheckinStatus.active)
              .order_by(Checkin.checkin_id)
              .all())
    by_room = {}
    for ch in rows:
        by_room.setdefault(ch.room_id, []).append(ch)
    return by_room


def room_to_dict(r: Room, include_active_checkin: bool = True,
                 active_checkin=_UNSET):
    active_checkin_out = None
    ac = None
    if include_active_checkin:
        if active_checkin is not _UNSET:
            # Pre-fetched by the caller (bulk query) — avoids iterating the
            # room's FULL check-in history per room (N+1).
            ac = active_checkin
        else:
            # Backward-compatible fallback for single-room callers.
            ac = next((ch for ch in r.checkins if ch.status == CheckinStatus.active), None)
        if ac:
            active_checkin_out = {
                "checkin_id": ac.checkin_id,
                "customer_id": ac.customer_id,
                "customer_name": f"{ac.customer.first_name} {ac.customer.last_name}" if ac.customer else "Unknown",
                "customer_phone": ac.customer.phone if ac.customer else "N/A",
                "checkin_datetime": ac.checkin_datetime.isoformat(),
                "expected_checkout": ac.expected_checkout.isoformat() if ac.expected_checkout else None,
                "deposit_amount": float(ac.deposit_amount),
                "members_count": ac.members_count,
                "tariff_per_night": float(ac.tariff_per_night),
            }

    # Determine effective status. expected_checkout is a DateTime, so compare
    # against datetime.now() — a 10:30 AM checkout should only flip to
    # "checkout_due" once 10:30 has actually passed.
    effective_status = r.status
    if ac and r.status == "occupied":
        exp_checkout = ac.expected_checkout
        if exp_checkout:
            if not isinstance(exp_checkout, datetime) and isinstance(exp_checkout, date):
                exp_checkout = datetime.combine(exp_checkout, datetime.min.time())
            if isinstance(exp_checkout, datetime) and exp_checkout.tzinfo is not None:
                exp_checkout = exp_checkout.replace(tzinfo=None)
            if exp_checkout <= datetime.now():
                effective_status = "checkout_due"

    return {
        "room_id": r.room_id,
        "lodge_id": r.lodge_id,
        "room_number": r.room_number,
        "floor": r.floor,
        "room_type": r.room_type,
        "has_ac": r.has_ac,
        "base_tariff": float(r.base_tariff),
        "max_occupancy": r.max_occupancy,
        "amenities": r.amenities,
        "status": effective_status,
        "is_active": r.is_active,
        "description": r.description,
        "active_checkin": active_checkin_out,
    }


@router.get("")
def list_rooms(
    type: Optional[str] = None,
    status: Optional[str] = None,
    floor: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    query = db.query(Room).filter(Room.lodge_id == lodge_id, Room.is_active == True)

    if type:
        if type == "deluxe":
            query = query.filter(Room.room_type == "deluxe_ac")
        else:
            query = query.filter(Room.room_type == type)

    if status and status != "all":
        if status == "checkout_due":
            now = datetime.now()
            rooms = db.query(Room).filter(
                Room.lodge_id == lodge_id,
                Room.status == RoomStatus.occupied,
                Room.is_active == True,
            ).all()
            # Bulk-fetch active check-ins (one query) instead of lazily
            # iterating each room's full check-in history.
            active_by_room = _bulk_active_checkins(db, lodge_id)

            def _due(ch):
                exp = ch.expected_checkout
                if not exp:
                    return False
                if isinstance(exp, date) and not isinstance(exp, datetime):
                    exp = datetime.combine(exp, datetime.min.time())
                return exp <= now

            return [room_to_dict(r, active_checkin=next(iter(active_by_room.get(r.room_id, [])), None))
                    for r in rooms
                    if any(_due(ch) for ch in active_by_room.get(r.room_id, []))]
        else:
            query = query.filter(Room.status == status)

    if floor:
        query = query.filter(Room.floor == floor)

    rooms = query.order_by(Room.room_number).all()
    # ONE query for all active check-ins of this lodge (customer eager-loaded),
    # passed into room_to_dict — previously each room lazily loaded its entire
    # check-in HISTORY just to find the active one (~2 queries per row).
    active_by_room = _bulk_active_checkins(db, lodge_id)
    return [room_to_dict(r, active_checkin=next(iter(active_by_room.get(r.room_id, [])), None))
            for r in rooms]


@router.get("/available")
def get_available_rooms(type: Optional[str] = None, db: Session = Depends(get_db),
                        current_user=Depends(get_current_user),
                        lodge_id: int = Depends(resolve_lodge_scope)):
    query = db.query(Room).filter(
        Room.lodge_id == lodge_id,
        Room.status == RoomStatus.available,
        Room.is_active == True,
    )
    if type:
        if type == "ac":
            query = query.filter(Room.has_ac == True)
        elif type == "non_ac":
            query = query.filter(Room.has_ac == False)
        elif type == "deluxe":
            query = query.filter(Room.room_type == "deluxe_ac")
    return [room_to_dict(r) for r in query.order_by(Room.room_number).all()]


@router.get("/{room_id}")
def get_room(room_id: int, db: Session = Depends(get_db),
             current_user=Depends(get_current_user),
             lodge_id: int = Depends(resolve_lodge_scope)):
    room = db.query(Room).filter(
        Room.room_id == room_id,
        Room.lodge_id == lodge_id,
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room_to_dict(room, include_active_checkin=True)


class RoomStatusUpdate(BaseModel):
    status: str
    description: Optional[str] = None


@router.put("/{room_id}/status")
def update_room_status(room_id: int, body: RoomStatusUpdate, request: Request,
                       db: Session = Depends(get_db),
                       current_user=Depends(require_admin),
                       lodge_id: int = Depends(resolve_lodge_scope)):
    room = db.query(Room).filter(
        Room.room_id == room_id,
        Room.lodge_id == lodge_id,
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    old_status = room.status
    room.status = body.status
    if body.description:
        room.description = body.description
    db.commit()
    try:
        log_audit(
            db, "room.status_changed",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="room", entity_id=room.room_id,
            lodge_id=lodge_id,
            details={"room_number": room.room_number,
                     "old_status": str(old_status), "new_status": body.status},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "room_number": room.room_number, "status": room.status}


class RoomCreate(BaseModel):
    room_number: str
    floor: int
    room_type: str
    base_tariff: float
    max_occupancy: int = 2
    has_ac: bool = False
    amenities: Optional[str] = None
    description: Optional[str] = None


@router.post("")
def create_room(body: RoomCreate, request: Request,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    # Room-number uniqueness is per-lodge — two lodges can each have a "Room 101".
    existing = db.query(Room).filter(
        Room.room_number == body.room_number,
        Room.lodge_id == lodge_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Room number already exists in this lodge")
    room = Room(lodge_id=lodge_id, **body.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    try:
        log_audit(
            db, "room.created",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="room", entity_id=room.room_id,
            lodge_id=lodge_id,
            details={"room_number": room.room_number,
                     "type": body.room_type,
                     "base_tariff": float(body.base_tariff)},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return room_to_dict(room)


class RoomTariffUpdate(BaseModel):
    base_tariff: float
    max_occupancy: Optional[int] = None
    amenities: Optional[str] = None


@router.put("/{room_id}/tariff")
def update_room_tariff(room_id: int, body: RoomTariffUpdate, request: Request,
                       db: Session = Depends(get_db),
                       current_user=Depends(require_admin),
                       lodge_id: int = Depends(resolve_lodge_scope)):
    room = db.query(Room).filter(
        Room.room_id == room_id,
        Room.lodge_id == lodge_id,
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    old_tariff = float(room.base_tariff or 0)
    room.base_tariff = body.base_tariff
    if body.max_occupancy:
        room.max_occupancy = body.max_occupancy
    if body.amenities is not None:
        room.amenities = body.amenities
    db.commit()
    try:
        log_audit(
            db, "room.tariff_updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="room", entity_id=room.room_id,
            lodge_id=lodge_id,
            details={"room_number": room.room_number,
                     "old_tariff": old_tariff, "new_tariff": float(body.base_tariff)},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": "Room updated"}
