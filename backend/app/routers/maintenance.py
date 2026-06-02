"""Maintenance tickets router — building/equipment work orders.

Distinct from housekeeping. A housekeeping task is "clean the room";
a maintenance ticket is "the AC is broken" — needs a vendor, often
blocks the room from sale, may have a real cost.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal

from ..database import get_db
from ..models import (MaintenanceTicket, MaintenanceStatus, MaintenancePriority,
                      MaintenanceCategory, Room, User, RoomStatus)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


def _to_dict(t: MaintenanceTicket) -> dict:
    return {
        "ticket_id": t.ticket_id,
        "room_id": t.room_id,
        "room_number": t.room.room_number if t.room else None,
        "location": t.location,
        "category": getattr(t.category, "value", t.category),
        "priority": getattr(t.priority, "value", t.priority),
        "status": getattr(t.status, "value", t.status),
        "title": t.title,
        "description": t.description,
        "blocks_room_availability": bool(t.blocks_room_availability),
        "reported_by": t.reported_by,
        "assigned_to": t.assigned_to,
        "assignee_name": t.assignee.full_name if t.assignee else None,
        "vendor_name": t.vendor_name,
        "estimated_cost": float(t.estimated_cost) if t.estimated_cost is not None else None,
        "actual_cost": float(t.actual_cost) if t.actual_cost is not None else None,
        "resolution_notes": t.resolution_notes,
        "reported_at": t.reported_at.isoformat() if t.reported_at else None,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
    }


@router.get("/tickets")
def list_tickets(status: Optional[str] = Query(None),
                  priority: Optional[str] = None,
                  room_id: Optional[int] = None,
                  db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(MaintenanceTicket)
         .filter(MaintenanceTicket.lodge_id == lodge_id)
         .order_by(MaintenanceTicket.reported_at.desc()))
    if status:
        q = q.filter(MaintenanceTicket.status == status)
    if priority:
        q = q.filter(MaintenanceTicket.priority == priority)
    if room_id:
        q = q.filter(MaintenanceTicket.room_id == room_id)
    return [_to_dict(t) for t in q.limit(500).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Counts grouped by status, plus open-by-priority — for dashboard."""
    rows = (db.query(MaintenanceTicket.status, func.count(MaintenanceTicket.ticket_id))
            .filter(MaintenanceTicket.lodge_id == lodge_id)
            .group_by(MaintenanceTicket.status).all())
    by_status = {s.value: 0 for s in MaintenanceStatus}
    for s, n in rows:
        by_status[getattr(s, "value", s)] = n

    open_priority = (db.query(MaintenanceTicket.priority, func.count(MaintenanceTicket.ticket_id))
                     .filter(MaintenanceTicket.lodge_id == lodge_id,
                             MaintenanceTicket.status.in_([MaintenanceStatus.open,
                                                           MaintenanceStatus.in_progress,
                                                           MaintenanceStatus.awaiting_parts]))
                     .group_by(MaintenanceTicket.priority).all())
    by_priority = {p.value: 0 for p in MaintenancePriority}
    for p, n in open_priority:
        by_priority[getattr(p, "value", p)] = n

    return {"by_status": by_status, "open_by_priority": by_priority}


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(MaintenanceTicket)
         .filter(MaintenanceTicket.ticket_id == ticket_id,
                 MaintenanceTicket.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _to_dict(t)


class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    category: str = "other"
    priority: str = "medium"
    room_id: Optional[int] = None
    location: Optional[str] = None
    blocks_room_availability: bool = False
    estimated_cost: Optional[float] = None
    assigned_to: Optional[int] = None
    vendor_name: Optional[str] = None


@router.post("/tickets")
def create_ticket(body: TicketCreate, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    if body.category not in {c.value for c in MaintenanceCategory}:
        raise HTTPException(status_code=400, detail="Invalid category")
    if body.priority not in {p.value for p in MaintenancePriority}:
        raise HTTPException(status_code=400, detail="Invalid priority")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    if body.room_id:
        room = (db.query(Room).filter(Room.room_id == body.room_id,
                                       Room.lodge_id == lodge_id).first())
        if not room:
            raise HTTPException(status_code=404, detail="Room not in this lodge")
    if body.assigned_to:
        u = (db.query(User).filter(User.user_id == body.assigned_to,
                                    User.lodge_id == lodge_id).first())
        if not u:
            raise HTTPException(status_code=400, detail="Assignee not in this lodge")

    t = MaintenanceTicket(
        lodge_id=lodge_id, room_id=body.room_id,
        location=(body.location or "").strip()[:100] or None,
        category=body.category, priority=body.priority,
        title=body.title.strip()[:200],
        description=body.description,
        blocks_room_availability=bool(body.blocks_room_availability),
        reported_by=current_user.user_id,
        assigned_to=body.assigned_to,
        vendor_name=(body.vendor_name or "").strip()[:120] or None,
        estimated_cost=(Decimal(str(body.estimated_cost))
                         if body.estimated_cost is not None else None),
    )
    db.add(t)
    # If this ticket blocks the room, mark the room maintenance immediately.
    # We re-fetch with lodge_id guard for defence-in-depth even though we
    # already validated `body.room_id` above.
    if body.blocks_room_availability and body.room_id:
        room = (db.query(Room)
                  .filter(Room.room_id == body.room_id,
                          Room.lodge_id == lodge_id).first())
        if room and room.status == RoomStatus.available:
            room.status = RoomStatus.maintenance
    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "maintenance.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="maintenance_ticket", entity_id=t.ticket_id,
                  lodge_id=lodge_id,
                  details={"title": t.title, "priority": body.priority,
                           "room_id": body.room_id,
                           "blocks_availability": bool(body.blocks_room_availability)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None
    vendor_name: Optional[str] = None
    estimated_cost: Optional[float] = None
    actual_cost: Optional[float] = None
    resolution_notes: Optional[str] = None
    blocks_room_availability: Optional[bool] = None


@router.patch("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, body: TicketUpdate, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(MaintenanceTicket)
         .filter(MaintenanceTicket.ticket_id == ticket_id,
                 MaintenanceTicket.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")

    prev_status = t.status
    fields = body.dict(exclude_unset=True)
    if "status" in fields:
        if fields["status"] not in {s.value for s in MaintenanceStatus}:
            raise HTTPException(status_code=400, detail="Invalid status")
        t.status = fields["status"]
        # Status-change side effects.
        if fields["status"] == "in_progress" and not t.started_at:
            t.started_at = datetime.utcnow()
        if fields["status"] == "resolved":
            t.resolved_at = datetime.utcnow()
            # Free up the room if this ticket was blocking it.
            if t.blocks_room_availability and t.room_id:
                room = db.query(Room).filter(Room.room_id == t.room_id).first()
                if room and room.status == RoomStatus.maintenance:
                    room.status = RoomStatus.available
    if "priority" in fields:
        if fields["priority"] not in {p.value for p in MaintenancePriority}:
            raise HTTPException(status_code=400, detail="Invalid priority")
        t.priority = fields["priority"]
    if "assigned_to" in fields:
        if fields["assigned_to"]:
            u = (db.query(User).filter(User.user_id == fields["assigned_to"],
                                        User.lodge_id == lodge_id).first())
            if not u:
                raise HTTPException(status_code=400, detail="Assignee not in this lodge")
        t.assigned_to = fields["assigned_to"]
    if "vendor_name" in fields:
        t.vendor_name = (fields["vendor_name"] or "").strip()[:120] or None
    if "estimated_cost" in fields:
        t.estimated_cost = (Decimal(str(fields["estimated_cost"]))
                             if fields["estimated_cost"] is not None else None)
    if "actual_cost" in fields:
        t.actual_cost = (Decimal(str(fields["actual_cost"]))
                          if fields["actual_cost"] is not None else None)
    if "resolution_notes" in fields:
        t.resolution_notes = fields["resolution_notes"]
    if "blocks_room_availability" in fields:
        t.blocks_room_availability = bool(fields["blocks_room_availability"])

    db.commit()
    db.refresh(t)
    try:
        log_audit(db, "maintenance.updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="maintenance_ticket", entity_id=t.ticket_id,
                  lodge_id=lodge_id,
                  details={"changed": list(fields.keys()),
                           "prev_status": getattr(prev_status, "value", prev_status),
                           "new_status": getattr(t.status, "value", t.status)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(t)
