from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from datetime import date, datetime

from ..database import get_db
from ..models import AuditLog, LoginEvent, Lodge
from ..auth import require_admin, require_super_admin, resolve_lodge_scope

router = APIRouter(prefix="/api/audit", tags=["audit"])

SUPER_ROLES = ("super_admin", "app_owner")


def _role(u) -> str:
    return getattr(u.role, "value", str(u.role))


def _audit_row(r: AuditLog, lodge_names: Optional[dict] = None) -> dict:
    d = {
        "id": r.id, "action": r.action,
        "actor_user_id": r.actor_user_id,
        "actor_username": r.actor_username,
        "actor_type": r.actor_type,
        "entity_type": r.entity_type, "entity_id": r.entity_id,
        "details": r.details, "ip_address": r.ip_address,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
    if lodge_names is not None:
        d["lodge_id"] = r.lodge_id
        d["lodge_name"] = lodge_names.get(r.lodge_id)
    return d


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
    return {"total": total, "page": page, "data": [_audit_row(r) for r in rows]}


# ── Super-admin cross-lodge audit console ───────────────────────────────

@router.get("/all")
def list_all_audit_logs(
    lodge_id: Optional[int] = None,
    action: Optional[str] = Query(None, description="Action prefix, e.g. 'auth.' or exact action"),
    actor: Optional[str] = Query(None, description="Actor username (partial match)"),
    ip: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    """Cross-lodge audit trail — super_admin/app_owner ONLY. No X-Lodge-Id
    scoping: this is the platform owner's forensic view."""
    q = db.query(AuditLog)
    if lodge_id is not None:
        q = q.filter(AuditLog.lodge_id == lodge_id)
    if action:
        q = q.filter(AuditLog.action.like(f"{action}%"))
    if actor:
        q = q.filter(AuditLog.actor_username.ilike(f"%{actor}%"))
    if ip:
        q = q.filter(AuditLog.ip_address == ip)
    if from_date:
        q = q.filter(AuditLog.created_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        q = q.filter(AuditLog.created_at <= datetime.combine(to_date, datetime.max.time()))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(AuditLog.action.ilike(like),
                         AuditLog.actor_username.ilike(like),
                         AuditLog.details.ilike(like),
                         AuditLog.ip_address.ilike(like),
                         AuditLog.entity_type.ilike(like)))
    total = q.count()
    rows = (q.order_by(AuditLog.created_at.desc())
            .offset((page - 1) * limit).limit(limit).all())
    lodge_names = dict(db.query(Lodge.lodge_id, Lodge.name).all())
    return {"total": total, "page": page, "limit": limit,
            "data": [_audit_row(r, lodge_names) for r in rows]}


# ── Login-event history (staff + customer) ──────────────────────────────

@router.get("/logins")
def list_login_events(
    actor_type: Optional[str] = Query(None, pattern="^(user|customer)$"),
    success: Optional[bool] = None,
    ip: Optional[str] = None,
    username: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Login activity. super_admin/app_owner: everything (staff + customer).
    Lodge admin: only their own lodge's STAFF logins."""
    q = db.query(LoginEvent)
    is_super = _role(current_user) in SUPER_ROLES
    if not is_super:
        q = q.filter(LoginEvent.actor_type == "user",
                     LoginEvent.lodge_id == current_user.lodge_id)
    if actor_type:
        q = q.filter(LoginEvent.actor_type == actor_type)
    if success is not None:
        q = q.filter(LoginEvent.success == success)
    if ip:
        q = q.filter(LoginEvent.ip_address == ip)
    if username:
        q = q.filter(LoginEvent.username.ilike(f"%{username}%"))
    if from_date:
        q = q.filter(LoginEvent.occurred_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        q = q.filter(LoginEvent.occurred_at <= datetime.combine(to_date, datetime.max.time()))
    total = q.count()
    rows = (q.order_by(LoginEvent.occurred_at.desc())
            .offset((page - 1) * limit).limit(limit).all())
    lodge_names = dict(db.query(Lodge.lodge_id, Lodge.name).all()) if is_super else {}
    return {"total": total, "page": page, "limit": limit, "data": [{
        "event_id": r.event_id,
        "actor_type": r.actor_type,
        "actor_id": r.actor_id,
        "username": r.username,
        "lodge_id": r.lodge_id,
        "lodge_name": lodge_names.get(r.lodge_id) if is_super else None,
        "success": bool(r.success),
        "method": r.method,
        "ip_address": r.ip_address,
        "user_agent": r.user_agent,
        "occurred_at": r.occurred_at.isoformat() if r.occurred_at else None,
    } for r in rows]}


# ── Activity feed — staff-visible recent-events stream ─────────────────
from ..auth import get_current_user as _get_current_user


@router.get("/activity")
def activity_feed(limit: int = 30,
                   include_security: bool = False,
                   db: Session = Depends(get_db),
                   current_user=Depends(_get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """A lightweight recent-events stream for the Dashboard widget.

    Unlike /api/audit (admin-only, deep audit log), this is visible to
    any authenticated user in the lodge — it's a quick "what's going on"
    summary, not a forensic tool. We filter to actions that staff care
    about and skip noise (logins, settings reads, etc.).

    Pass include_security=true to ALSO include the login/security events
    that the default dashboard feed hides as noise.
    """
    NOISY = {"auth.login", "setting.read", "auth.login_failed",
             "auth.login_blocked"}
    SECURITY = ("auth.login", "auth.login_failed", "auth.login_blocked",
                "auth.otp_sent", "auth.otp_wrong", "auth.otp_max_attempts",
                "customer.login", "customer.signup",
                "customer.password_reset", "customer.password_reset_failed")
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
    actions = INTERESTING + SECURITY if include_security else INTERESTING
    q = (db.query(AuditLog)
         .filter(AuditLog.lodge_id == lodge_id,
                 AuditLog.action.in_(actions))
         .order_by(AuditLog.created_at.desc())
         .limit(min(limit, 100)))
    return [{
        "id": r.id, "action": r.action,
        "actor_username": r.actor_username,
        "entity_type": r.entity_type, "entity_id": r.entity_id,
        "details": r.details,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in q.all()]
