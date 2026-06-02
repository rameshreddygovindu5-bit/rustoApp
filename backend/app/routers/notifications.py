"""In-app notifications router — the bell icon dropdown.

Distinct from `alerts` (outbound SMS/email to guests). These are inbound
messages for staff: failed alerts, overdue checkouts, new bookings,
agency activity, system events.

Notifications are scoped per-lodge. A row with `target_user_id` set is
visible only to that user; NULL means lodge-wide (all staff).
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from ..database import get_db
from ..models import Notification, NotificationLevel
from ..auth import get_current_user, require_admin, resolve_lodge_scope

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _to_dict(n: Notification) -> dict:
    return {
        "notification_id": n.notification_id,
        "level": getattr(n.level, "value", n.level),
        "title": n.title,
        "message": n.message,
        "action_url": n.action_url,
        "is_read": bool(n.is_read),
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "target_user_id": n.target_user_id,
    }


def _visible_to_user_filter(user_id: int):
    """SQLAlchemy filter for 'visible to this user'.
    Either targeted at this user OR lodge-wide (NULL target)."""
    return or_(Notification.target_user_id == user_id,
               Notification.target_user_id.is_(None))


@router.get("")
def list_notifications(unread_only: bool = Query(False),
                        limit: int = 50,
                        db: Session = Depends(get_db),
                        current_user=Depends(get_current_user),
                        lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(Notification)
         .filter(Notification.lodge_id == lodge_id,
                 _visible_to_user_filter(current_user.user_id))
         .order_by(Notification.created_at.desc()))
    if unread_only:
        q = q.filter(Notification.is_read == False)
    rows = q.limit(min(limit, 200)).all()
    return [_to_dict(r) for r in rows]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """Cheap endpoint the bell icon polls. Returns a single integer."""
    n = (db.query(func.count(Notification.notification_id))
         .filter(Notification.lodge_id == lodge_id,
                 _visible_to_user_filter(current_user.user_id),
                 Notification.is_read == False).scalar())
    return {"unread": int(n or 0)}


class NotificationCreate(BaseModel):
    title: str
    message: Optional[str] = None
    level: str = "info"
    target_user_id: Optional[int] = None
    action_url: Optional[str] = None


@router.post("")
def create_notification(body: NotificationCreate, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(require_admin),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    """Admin sends a notification to everyone in the lodge (or a specific user)."""
    if body.level not in {l.value for l in NotificationLevel}:
        raise HTTPException(status_code=400, detail="Invalid level")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    n = Notification(
        lodge_id=lodge_id,
        target_user_id=body.target_user_id,
        level=body.level,
        title=body.title.strip()[:160],
        message=(body.message or "").strip() or None,
        action_url=body.action_url,
    )
    db.add(n)
    db.commit()
    db.refresh(n)
    return _to_dict(n)


@router.patch("/{notification_id}/read")
def mark_read(notification_id: int,
              db: Session = Depends(get_db),
              current_user=Depends(get_current_user),
              lodge_id: int = Depends(resolve_lodge_scope)):
    n = (db.query(Notification)
         .filter(Notification.notification_id == notification_id,
                 Notification.lodge_id == lodge_id,
                 _visible_to_user_filter(current_user.user_id)).first())
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.utcnow()
        db.commit()
        db.refresh(n)
    return _to_dict(n)


@router.post("/mark-all-read")
def mark_all_read(db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Bulk mark every unread notification visible to this user as read."""
    now = datetime.utcnow()
    rows = (db.query(Notification)
            .filter(Notification.lodge_id == lodge_id,
                    _visible_to_user_filter(current_user.user_id),
                    Notification.is_read == False).all())
    for n in rows:
        n.is_read = True
        n.read_at = now
    if rows:
        db.commit()
    return {"success": True, "marked_read": len(rows)}


# Helper for other backend services to fire notifications.
def push_notification(db: Session, lodge_id: int, *, title: str,
                      message: str = "", level: str = "info",
                      target_user_id: Optional[int] = None,
                      action_url: Optional[str] = None) -> Optional[Notification]:
    """Internal-only — services call this to drop something in the bell icon.
    Failures are swallowed so notification trouble can't break the
    real action that triggered the notification."""
    try:
        n = Notification(
            lodge_id=lodge_id,
            target_user_id=target_user_id,
            level=level if level in {l.value for l in NotificationLevel} else "info",
            title=title[:160] if title else "Notification",
            message=message or None,
            action_url=action_url,
        )
        db.add(n)
        db.commit()
        return n
    except Exception:
        return None
