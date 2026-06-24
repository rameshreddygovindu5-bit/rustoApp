"""Support tickets — lodges raise issues, super-admin responds.

Endpoints:
  GET    /api/support/tickets               # list (scope: lodge sees own, super_admin sees all)
  POST   /api/support/tickets               # any logged-in lodge user can create
  GET    /api/support/tickets/{id}          # detail with messages
  POST   /api/support/tickets/{id}/messages # add reply (lodge or super-admin)
  PATCH  /api/support/tickets/{id}          # update status / assignee (super_admin or owning admin)
  GET    /api/support/stats                 # counts for badges
"""
import secrets
import string
import logging
from datetime import datetime, timezone
from typing import Optional

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import (SupportTicket, SupportTicketMessage, User, Lodge,
                       SupportTicketStatus, UserRole)
from ..auth import get_current_user, require_super_admin
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/support", tags=["support"])


# ── Constants / validation ──────────────────────────────────────────

CATEGORIES = {"technical", "billing", "feature_request", "account", "other"}
PRIORITIES = {"low", "normal", "high", "urgent"}
STATUSES = {s.value for s in SupportTicketStatus}


def _generate_ticket_ref() -> str:
    """TKT-YYYYMMDD-XXXX — short, scannable, unique enough at our scale.
    Not strictly globally unique but a daily collision is astronomically
    unlikely; we add a uniqueness check on insert."""
    suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"TKT-{_utcnow().strftime('%Y%m%d')}-{suffix}"


def _ticket_to_dict(t: SupportTicket, db: Session, include_messages: bool = False) -> dict:
    raiser = db.query(User).filter(User.user_id == t.raised_by_user_id).first()
    lodge = db.query(Lodge).filter(Lodge.lodge_id == t.lodge_id).first()
    out = {
        "ticket_id": t.ticket_id,
        "ticket_ref": t.ticket_ref,
        "lodge_id": t.lodge_id,
        "lodge_name": lodge.name if lodge else None,
        "lodge_code": lodge.code if lodge else None,
        "raised_by_user_id": t.raised_by_user_id,
        "raised_by_username": raiser.username if raiser else None,
        "raised_by_full_name": raiser.full_name if raiser else None,
        "category": t.category,
        "priority": t.priority,
        "subject": t.subject,
        "description": t.description,
        "status": t.status,
        "assigned_to_user_id": t.assigned_to_user_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
    }
    if include_messages:
        msgs = (db.query(SupportTicketMessage)
                .filter(SupportTicketMessage.ticket_id == t.ticket_id)
                .order_by(SupportTicketMessage.created_at.asc()).all())
        out["messages"] = [_message_to_dict(m, db) for m in msgs]
    return out


def _message_to_dict(m: SupportTicketMessage, db: Session) -> dict:
    author = db.query(User).filter(User.user_id == m.author_user_id).first()
    return {
        "message_id": m.message_id,
        "ticket_id": m.ticket_id,
        "author_user_id": m.author_user_id,
        "author_username": author.username if author else None,
        "author_full_name": author.full_name if author else None,
        "author_role": m.author_role,
        "body": m.body,
        "status_change": m.status_change,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ── List + detail ─────────────────────────────────────────────────────

@router.get("/tickets")
def list_tickets(status: Optional[str] = None,
                  category: Optional[str] = None,
                  priority: Optional[str] = None,
                  limit: int = Query(100, ge=1, le=500),
                  db: Session = Depends(get_db),
                  current_user=Depends(get_current_user)):
    """Lodges see their own tickets. Super-admin sees all."""
    q = db.query(SupportTicket)
    if current_user.role != UserRole.super_admin:
        # Tenant scope. Staff users only see tickets THEY raised — privacy.
        if current_user.role == UserRole.staff:
            q = q.filter(SupportTicket.raised_by_user_id == current_user.user_id)
        else:
            # Admin: all tickets for their lodge.
            q = q.filter(SupportTicket.lodge_id == current_user.lodge_id)
    if status:
        if status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
        q = q.filter(SupportTicket.status == status)
    if category:
        q = q.filter(SupportTicket.category == category)
    if priority:
        q = q.filter(SupportTicket.priority == priority)
    rows = q.order_by(SupportTicket.created_at.desc()).limit(limit).all()
    return [_ticket_to_dict(t, db) for t in rows]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
           current_user=Depends(get_current_user)):
    """Counts by status. For super-admin: across all lodges. For lodge:
    just their own."""
    from sqlalchemy import func as sql_func
    q = db.query(SupportTicket.status, sql_func.count(SupportTicket.ticket_id))
    if current_user.role != UserRole.super_admin:
        if current_user.role == UserRole.staff:
            q = q.filter(SupportTicket.raised_by_user_id == current_user.user_id)
        else:
            q = q.filter(SupportTicket.lodge_id == current_user.lodge_id)
    rows = q.group_by(SupportTicket.status).all()
    return {status: int(count) for status, count in rows}


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user)):
    t = db.query(SupportTicket).filter(SupportTicket.ticket_id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Authorization.
    if current_user.role == UserRole.super_admin:
        pass    # full access
    elif current_user.role == UserRole.staff:
        if t.raised_by_user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="You can only view tickets you raised")
    elif current_user.role == UserRole.admin:
        if t.lodge_id != current_user.lodge_id:
            raise HTTPException(status_code=403, detail="Not your lodge's ticket")
    else:
        raise HTTPException(status_code=403, detail="Forbidden")
    return _ticket_to_dict(t, db, include_messages=True)


# ── Create ──────────────────────────────────────────────────────────

class TicketCreateBody(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=10000)
    category: str = Field(default="technical")
    priority: str = Field(default="normal")


@router.post("/tickets", status_code=201)
def create_ticket(body: TicketCreateBody, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user)):
    """Any logged-in lodge user can raise a ticket. Super-admin cannot
    raise tickets here — they create them in the lodges they administer
    (which they don't have, by design)."""
    if current_user.role == UserRole.super_admin:
        raise HTTPException(status_code=400,
                            detail="Super-admin cannot raise support tickets — only lodge users can")
    if not current_user.lodge_id:
        raise HTTPException(status_code=400, detail="User is not assigned to a lodge")
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"Invalid category. Must be one of: {sorted(CATEGORIES)}")
    if body.priority not in PRIORITIES:
        raise HTTPException(status_code=400,
                            detail=f"Invalid priority. Must be one of: {sorted(PRIORITIES)}")

    # Generate a unique ref, retrying if we hit a collision (extremely
    # unlikely but defensively handled).
    for _ in range(5):
        ref = _generate_ticket_ref()
        if not db.query(SupportTicket).filter(SupportTicket.ticket_ref == ref).first():
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique ticket ref; please retry")

    t = SupportTicket(
        ticket_ref=ref,
        lodge_id=current_user.lodge_id,
        raised_by_user_id=current_user.user_id,
        category=body.category, priority=body.priority,
        subject=body.subject.strip(),
        description=body.description.strip(),
        status=SupportTicketStatus.open.value,
    )
    db.add(t); db.commit(); db.refresh(t)

    # The opening message is the description itself (so the thread reads
    # naturally as a chat).
    msg = SupportTicketMessage(
        ticket_id=t.ticket_id, author_user_id=current_user.user_id,
        author_role="lodge", body=body.description.strip(),
    )
    db.add(msg); db.commit()

    try:
        log_audit(db, "support_ticket.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="support_ticket", entity_id=t.ticket_id,
                  lodge_id=t.lodge_id,
                  details={"ref": ref, "category": body.category,
                            "priority": body.priority, "subject": body.subject[:120]},
                  ip_address=request.client.host if request and request.client else None)
    except Exception: pass

    return _ticket_to_dict(t, db, include_messages=True)


# ── Reply ───────────────────────────────────────────────────────────

class MessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    # Optional status transition the reply implies. Useful so the
    # responder can resolve a ticket in one round-trip.
    status_change: Optional[str] = Field(default=None)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
def add_message(ticket_id: int, body: MessageBody, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(get_current_user)):
    t = db.query(SupportTicket).filter(SupportTicket.ticket_id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Authz.
    is_super = current_user.role == UserRole.super_admin
    if not is_super:
        if current_user.lodge_id != t.lodge_id:
            raise HTTPException(status_code=403, detail="Not your lodge's ticket")
        # Staff can only reply to tickets THEY raised.
        if current_user.role == UserRole.staff and t.raised_by_user_id != current_user.user_id:
            raise HTTPException(status_code=403, detail="You can only reply to tickets you raised")

    author_role = "super_admin" if is_super else "lodge"
    new_status = None
    if body.status_change:
        if body.status_change not in STATUSES:
            raise HTTPException(status_code=400,
                                detail=f"Invalid status: {body.status_change}")
        new_status = body.status_change
    else:
        # Auto-flip: super-admin reply moves to 'awaiting_lodge';
        # lodge reply on awaiting_lodge moves back to 'open'.
        if is_super and t.status == SupportTicketStatus.open.value:
            new_status = SupportTicketStatus.awaiting_lodge.value
        elif (not is_super) and t.status == SupportTicketStatus.awaiting_lodge.value:
            new_status = SupportTicketStatus.open.value

    msg = SupportTicketMessage(
        ticket_id=t.ticket_id, author_user_id=current_user.user_id,
        author_role=author_role, body=body.body.strip(),
        status_change=new_status,
    )
    db.add(msg)

    if new_status:
        t.status = new_status
        if new_status == SupportTicketStatus.resolved.value:
            t.resolved_at = _utcnow()
    db.commit(); db.refresh(t)

    try:
        log_audit(db, "support_ticket.replied",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="support_ticket", entity_id=t.ticket_id,
                  lodge_id=t.lodge_id,
                  details={"ref": t.ticket_ref, "author_role": author_role,
                            "status_change": new_status},
                  ip_address=request.client.host if request and request.client else None)
    except Exception: pass

    return _ticket_to_dict(t, db, include_messages=True)


# ── Status / assignment update ──────────────────────────────────────

class PatchBody(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to_user_id: Optional[int] = None


@router.patch("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, body: PatchBody, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user)):
    t = db.query(SupportTicket).filter(SupportTicket.ticket_id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    is_super = current_user.role == UserRole.super_admin
    # Only super-admin or the lodge's admin may patch.
    if not is_super and (current_user.role != UserRole.admin or current_user.lodge_id != t.lodge_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    # Only super-admin can change priority or assignee.
    if (body.priority or body.assigned_to_user_id) and not is_super:
        raise HTTPException(status_code=403,
                            detail="Only super-admin can change priority / assignee")

    changes = {}
    if body.status:
        if body.status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
        t.status = body.status
        if body.status == SupportTicketStatus.resolved.value:
            t.resolved_at = _utcnow()
        changes["status"] = body.status
    if body.priority:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")
        t.priority = body.priority
        changes["priority"] = body.priority
    if body.assigned_to_user_id is not None:
        if body.assigned_to_user_id and not db.query(User).filter(
                User.user_id == body.assigned_to_user_id,
                User.role == UserRole.super_admin).first():
            raise HTTPException(status_code=400,
                                detail="Assignee must be an existing super-admin")
        t.assigned_to_user_id = body.assigned_to_user_id or None
        changes["assigned_to_user_id"] = body.assigned_to_user_id

    db.commit(); db.refresh(t)
    try:
        log_audit(db, "support_ticket.updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="support_ticket", entity_id=t.ticket_id,
                  lodge_id=t.lodge_id,
                  details={"ref": t.ticket_ref, "changes": changes},
                  ip_address=request.client.host if request and request.client else None)
    except Exception: pass
    return _ticket_to_dict(t, db)
