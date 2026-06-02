from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, datetime

from ..database import get_db
from ..models import AuditLog
from ..auth import require_admin, resolve_lodge_scope

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def list_audit_logs(
    action: Optional[str] = None,
    actor_username: Optional[str] = None,
    entity_type: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    page: int = 1, limit: int = 100,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    q = db.query(AuditLog).filter(AuditLog.lodge_id == lodge_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if actor_username:
        q = q.filter(AuditLog.actor_username == actor_username)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if from_date:
        q = q.filter(AuditLog.created_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        q = q.filter(AuditLog.created_at <= datetime.combine(to_date, datetime.max.time()))
    total = q.count()
    rows = (q.order_by(AuditLog.created_at.desc())
            .offset(max(0, page - 1) * limit)
            .limit(min(limit, 500))
            .all())
    return {"total": total, "page": page, "data": [{
        "id": r.id, "action": r.action,
        "actor_user_id": r.actor_user_id,
        "actor_username": r.actor_username,
        "actor_type": r.actor_type,
        "entity_type": r.entity_type, "entity_id": r.entity_id,
        "details": r.details, "ip_address": r.ip_address,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]}


# ── Activity feed — staff-visible recent-events stream ─────────────────
from ..auth import get_current_user as _get_current_user


@router.get("/activity")
def activity_feed(limit: int = 30,
                   db: Session = Depends(get_db),
                   current_user=Depends(_get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """A lightweight recent-events stream for the Dashboard widget.

    Unlike /api/audit (admin-only, deep audit log), this is visible to
    any authenticated user in the lodge — it's a quick "what's going on"
    summary, not a forensic tool. We filter to actions that staff care
    about and skip noise (logins, settings reads, etc.).
    """
    NOISY = {"auth.login", "setting.read", "auth.login_failed",
             "auth.login_blocked"}
    INTERESTING = (
        "checkin.created", "checkin.checked_out",
        "booking.created", "booking.cancelled",
        "housekeeping.completed", "housekeeping.inspected",
        "maintenance.created", "maintenance.updated",
        "expense.created",
        "promo.created", "loyalty.adjusted",
        "feedback.staff_entered",
        "shift.opened", "shift.closed",
        "room.created", "room.status_changed",
        "customer.vip_changed",
    )
    q = (db.query(AuditLog)
         .filter(AuditLog.lodge_id == lodge_id,
                 AuditLog.action.in_(INTERESTING))
         .order_by(AuditLog.created_at.desc())
         .limit(min(limit, 100)))
    return [{
        "id": r.id, "action": r.action,
        "actor_username": r.actor_username,
        "entity_type": r.entity_type, "entity_id": r.entity_id,
        "details": r.details,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in q.all()]
