"""Tape chart router.

The "occupancy map" view every modern PMS shows the front desk: a grid
where rows are rooms and columns are dates. Cells are colored by status
so staff can see at a glance who's where and when rooms free up.

The endpoint returns a single flat matrix the React renderer can index
with O(1) lookups — no per-cell API calls.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import date, timedelta, datetime
from typing import Optional

from ..database import get_db
from ..models import (Room, Checkin, CheckinStatus,
                      Booking, BookingStatus, MaintenanceTicket,
                      MaintenanceStatus, Customer)
from ..auth import get_current_user, resolve_lodge_scope

router = APIRouter(prefix="/api/tape-chart", tags=["tape-chart"])

MAX_DAYS = 60


def _as_date(v):
    """Coerce a date or datetime to a date for grid arithmetic."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    return v


@router.get("")
def tape_chart(
    from_date: Optional[date] = Query(None, alias="from"),
    to_date: Optional[date] = Query(None, alias="to"),
    days: int = Query(14, ge=1, le=MAX_DAYS),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Return a rooms × dates matrix for the visible window. Defaults to
    today → today + 14 days. Cell priority (highest wins):
        occupied > booked > blocked > available
    """
    if from_date is None:
        from_date = date.today()
    if to_date is None:
        to_date = from_date + timedelta(days=days - 1)
    if to_date < from_date:
        raise HTTPException(status_code=400, detail="`to` must be >= `from`")
    span_days = (to_date - from_date).days + 1
    if span_days > MAX_DAYS:
        raise HTTPException(status_code=400,
                            detail=f"Window too large (max {MAX_DAYS} days)")

    dates = [from_date + timedelta(days=i) for i in range(span_days)]

    rooms = (db.query(Room)
             .filter(Room.lodge_id == lodge_id)
             .order_by(Room.room_number)
             .all())

    # Active + recently-checked-out check-ins overlapping the window.
    checkins = (db.query(Checkin)
                .filter(Checkin.lodge_id == lodge_id,
                        Checkin.status.in_(["active", "checked_out"]))
                .all())

    customer_ids = {c.customer_id for c in checkins if c.customer_id}
    customers = ({c.customer_id: c for c in
                  db.query(Customer).filter(Customer.customer_id.in_(customer_ids)).all()}
                 if customer_ids else {})

    bookings = (db.query(Booking)
                .filter(Booking.lodge_id == lodge_id,
                        Booking.status.in_([BookingStatus.pending,
                                            BookingStatus.confirmed]),
                        Booking.checkout_date >= from_date,
                        Booking.checkin_date <= to_date)
                .all())

    maintenance = (db.query(MaintenanceTicket)
                   .filter(MaintenanceTicket.lodge_id == lodge_id,
                           MaintenanceTicket.blocks_room_availability == True,
                           MaintenanceTicket.status.in_([MaintenanceStatus.open,
                                                          MaintenanceStatus.in_progress]))
                   .all())

    cells = {}
    PRIO = {"available": 0, "blocked": 1, "booked": 2, "occupied": 3}

    def _put(room_id, day, payload):
        key = f"{room_id}:{day.isoformat()}"
        existing = cells.get(key)
        if existing is None or PRIO[payload["status"]] > PRIO[existing["status"]]:
            cells[key] = payload

    # Default every cell to "available".
    for r in rooms:
        for d in dates:
            _put(r.room_id, d, {"status": "available"})

    # Maintenance blocks — no time bounds in the model, so they block from
    # "now" until they resolve. We paint the entire visible window.
    for m in maintenance:
        if not m.room_id:
            continue
        for d in dates:
            _put(m.room_id, d, {
                "status": "blocked",
                "title": m.title or "Maintenance",
                "ticket_id": m.ticket_id,
            })

    # Bookings (soft holds).
    for b in bookings:
        if not b.room_id:
            continue
        start = max(b.checkin_date, from_date)
        # Checkout is exclusive — guest leaves morning of checkout_date.
        finish = min(b.checkout_date - timedelta(days=1), to_date)
        if finish < start:
            continue
        for i in range((finish - start).days + 1):
            d = start + timedelta(days=i)
            _put(b.room_id, d, {
                "status": "booked",
                "guest_name": b.guest_name,
                "booking_id": b.booking_id,
                "booking_ref": b.booking_ref,
                "arrival": b.checkin_date.isoformat(),
                "departure": b.checkout_date.isoformat(),
            })

    # Active check-ins (highest priority).
    for ch in checkins:
        if not ch.room_id:
            continue
        s = _as_date(ch.checkin_datetime) or from_date
        # Use actual_checkout if set, else expected_checkout.
        end_raw = ch.actual_checkout or ch.expected_checkout
        e = _as_date(end_raw)
        if e is None:
            e = to_date + timedelta(days=1)  # open-ended → through window
        # Skip if entirely outside window.
        if e <= from_date or s > to_date:
            continue
        start = max(s, from_date)
        # Exclusive checkout — paint through the night before.
        finish = min(e - timedelta(days=1), to_date)
        if finish < start:
            continue
        cust = customers.get(ch.customer_id)
        guest_name = (f"{cust.first_name} {cust.last_name}".strip()
                      if cust else "Guest")
        is_overdue = bool(ch.expected_checkout
                          and ch.status == "active"
                          and _as_date(ch.expected_checkout) < date.today())
        for i in range((finish - start).days + 1):
            d = start + timedelta(days=i)
            _put(ch.room_id, d, {
                "status": "occupied",
                "guest_name": guest_name,
                "checkin_id": ch.checkin_id,
                "is_overdue": is_overdue,
            })

    return {
        "window": {"from": from_date.isoformat(), "to": to_date.isoformat(),
                   "days": span_days},
        "dates": [d.isoformat() for d in dates],
        "rooms": [{
            "room_id": r.room_id,
            "room_number": r.room_number,
            "room_type": r.room_type,
            "tariff": float(r.base_tariff or 0),
            "current_status": r.status,
        } for r in rooms],
        "cells": cells,
        "totals": {
            "rooms": len(rooms),
            "checkins_in_window": len(checkins),
            "bookings_in_window": len(bookings),
            "blocks_in_window": len(maintenance),
        },
    }


# ════════════════════════════════════════════════════════════════════
#  v2.6 — Drag-and-drop room reassignment
# ════════════════════════════════════════════════════════════════════

from pydantic import BaseModel as _BaseModel, Field as _Field
from fastapi import Request as _Request
from ..auth import require_admin as _require_admin
from ..services.audit_service import log_audit as _log_audit
from ..models import Room as _Room


class _MoveBody(_BaseModel):
    target_room_id: int = _Field(gt=0)


def _availability_check(db: Session, lodge_id: int, target_room_id: int,
                         from_date: date, to_date: date,
                         *, exclude_checkin_id: Optional[int] = None,
                         exclude_booking_id: Optional[int] = None) -> Optional[str]:
    """Returns None if target room is free for [from_date, to_date),
    else a human-readable conflict message.

    Used by both move endpoints below. Treats checkout as exclusive
    (matches the tape-chart paint rule) so two stays may share a date —
    one checking out the morning of, one checking in the afternoon.
    """
    # Target room must exist and belong to this lodge.
    target = (db.query(_Room).filter(_Room.room_id == target_room_id,
                                       _Room.lodge_id == lodge_id).first())
    if not target:
        return "Target room not found"

    # Conflict with any active or scheduled checkin in that room.
    q = (db.query(Checkin)
         .filter(Checkin.lodge_id == lodge_id,
                 Checkin.room_id == target_room_id,
                 Checkin.status == "active"))
    if exclude_checkin_id:
        q = q.filter(Checkin.checkin_id != exclude_checkin_id)
    for ch in q.all():
        s = _as_date(ch.checkin_datetime)
        e = _as_date(ch.actual_checkout or ch.expected_checkout)
        if s is None or e is None:
            continue
        # Overlap test with exclusive ends on both sides:
        # conflicts if NOT (e <= from_date OR s >= to_date)
        if not (e <= from_date or s >= to_date):
            return f"Room is occupied by an active stay ({s} → {e})"

    # Conflict with any pending/confirmed booking on the target room.
    q2 = (db.query(Booking)
          .filter(Booking.lodge_id == lodge_id,
                  Booking.room_id == target_room_id,
                  Booking.status.in_([BookingStatus.pending, BookingStatus.confirmed])))
    if exclude_booking_id:
        q2 = q2.filter(Booking.booking_id != exclude_booking_id)
    for b in q2.all():
        if not (b.checkout_date <= from_date or b.checkin_date >= to_date):
            return f"Room has a booking {b.booking_ref} ({b.checkin_date} → {b.checkout_date})"

    # Conflict with blocking maintenance.
    mt = (db.query(MaintenanceTicket)
          .filter(MaintenanceTicket.lodge_id == lodge_id,
                  MaintenanceTicket.room_id == target_room_id,
                  MaintenanceTicket.blocks_room_availability == True,
                  MaintenanceTicket.status.in_([MaintenanceStatus.open,
                                                 MaintenanceStatus.in_progress]))
          .first())
    if mt:
        return f"Room blocked by maintenance: {mt.title}"
    return None


@router.patch("/move-checkin/{checkin_id}")
def move_checkin(checkin_id: int, body: _MoveBody, request: _Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(_require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """Reassign an ACTIVE checkin to a different room. Used by the tape
    chart's drag-and-drop. Admin-only because mid-stay room moves affect
    folio / housekeeping records."""
    ch = (db.query(Checkin)
          .filter(Checkin.checkin_id == checkin_id,
                  Checkin.lodge_id == lodge_id,
                  Checkin.status == "active").first())
    if not ch:
        raise HTTPException(status_code=404, detail="Active checkin not found")
    if ch.room_id == body.target_room_id:
        return {"ok": True, "unchanged": True}

    # Window = from now (or today's date) → expected_checkout
    start = _as_date(ch.checkin_datetime) or date.today()
    end = _as_date(ch.expected_checkout) or (start + timedelta(days=1))
    conflict = _availability_check(db, lodge_id, body.target_room_id, start, end,
                                    exclude_checkin_id=checkin_id)
    if conflict:
        raise HTTPException(status_code=409, detail=conflict)

    old_room_id = ch.room_id
    ch.room_id = body.target_room_id
    # Update old + new room status — old goes available, new goes occupied.
    # Both room lookups are lodge-scoped: the availability check above
    # already verified target_room_id exists in this lodge, but use
    # defence-in-depth on the status flip itself.
    old_room = (db.query(_Room)
                  .filter(_Room.room_id == old_room_id,
                          _Room.lodge_id == lodge_id).first()
                if old_room_id else None)
    new_room = (db.query(_Room)
                  .filter(_Room.room_id == body.target_room_id,
                          _Room.lodge_id == lodge_id).first())
    if old_room: old_room.status = "available"
    if new_room: new_room.status = "occupied"
    db.commit()
    try:
        _log_audit(db, "checkin.room_moved",
                   actor_user_id=current_user.user_id,
                   actor_username=current_user.username,
                   entity_type="checkin", entity_id=ch.checkin_id, lodge_id=lodge_id,
                   details={"from_room_id": old_room_id, "to_room_id": body.target_room_id},
                   ip_address=request.client.host if request and request.client else None)
    except Exception: pass
    return {"ok": True, "checkin_id": ch.checkin_id,
            "from_room_id": old_room_id, "to_room_id": body.target_room_id}


@router.patch("/move-booking/{booking_id}")
def move_booking(booking_id: int, body: _MoveBody, request: _Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(_require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """Reassign a future booking to a different room. Admin-only."""
    b = (db.query(Booking)
         .filter(Booking.booking_id == booking_id,
                 Booking.lodge_id == lodge_id,
                 Booking.status.in_([BookingStatus.pending, BookingStatus.confirmed])).first())
    if not b:
        raise HTTPException(status_code=404, detail="Active booking not found")
    if b.room_id == body.target_room_id:
        return {"ok": True, "unchanged": True}
    conflict = _availability_check(db, lodge_id, body.target_room_id,
                                    b.checkin_date, b.checkout_date,
                                    exclude_booking_id=booking_id)
    if conflict:
        raise HTTPException(status_code=409, detail=conflict)
    old = b.room_id
    b.room_id = body.target_room_id
    db.commit()
    try:
        _log_audit(db, "booking.room_moved",
                   actor_user_id=current_user.user_id,
                   actor_username=current_user.username,
                   entity_type="booking", entity_id=b.booking_id, lodge_id=lodge_id,
                   details={"from_room_id": old, "to_room_id": body.target_room_id,
                            "booking_ref": b.booking_ref},
                   ip_address=request.client.host if request and request.client else None)
    except Exception: pass
    return {"ok": True, "booking_id": b.booking_id,
            "from_room_id": old, "to_room_id": body.target_room_id}
