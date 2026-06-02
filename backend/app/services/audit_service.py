"""Tiny helper to write audit-log rows from anywhere in the app."""
import json, logging
from typing import Optional, Any
from sqlalchemy.orm import Session
from ..models import AuditLog, User

logger = logging.getLogger(__name__)


def log_audit(db: Session,
              action: str,
              actor_user_id: Optional[int] = None,
              actor_username: Optional[str] = None,
              actor_type: str = "user",
              entity_type: Optional[str] = None,
              entity_id: Optional[int] = None,
              details: Optional[Any] = None,
              ip_address: Optional[str] = None,
              lodge_id: Optional[int] = None,
              commit: bool = True):
    """Write one audit-log row. `lodge_id` is required (multi-tenant);
    if not supplied we infer it from the acting user. As a last resort we
    default to lodge 1 so we never silently drop the row."""
    try:
        resolved_lodge_id = lodge_id
        if resolved_lodge_id is None and actor_user_id is not None:
            u = db.query(User).filter(User.user_id == actor_user_id).first()
            if u and u.lodge_id is not None:
                resolved_lodge_id = u.lodge_id
        if resolved_lodge_id is None:
            resolved_lodge_id = 1

        row = AuditLog(
            lodge_id=resolved_lodge_id,
            actor_user_id=actor_user_id,
            actor_username=actor_username,
            actor_type=actor_type,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=json.dumps(details) if details is not None and not isinstance(details, str) else details,
            ip_address=ip_address,
        )
        db.add(row)
        if commit:
            db.commit()
    except Exception as e:
        logger.warning(f"Audit log write failed for action={action}: {e}")
