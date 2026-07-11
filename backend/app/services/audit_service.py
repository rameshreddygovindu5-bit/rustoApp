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
    if not supplied we infer it from the acting user.

    Platform/customer-level events (customer logins, super-admin actions)
    have no natural lodge. AuditLog.lodge_id is NOT NULL in the schema, so
    we cannot store NULL without a migration — instead we keep the lodge-1
    sentinel as a last resort BUT stamp `scope: platform` into the details
    so consumers (e.g. the super-admin audit console) can tell a real
    lodge-1 event from a platform-level one."""
    try:
        resolved_lodge_id = lodge_id
        if resolved_lodge_id is None and actor_user_id is not None and actor_type == "user":
            u = db.query(User).filter(User.user_id == actor_user_id).first()
            if u and u.lodge_id is not None:
                resolved_lodge_id = u.lodge_id
        if resolved_lodge_id is None:
            # Sentinel (column is NOT NULL) — mark the row as platform-scoped.
            resolved_lodge_id = 1
            if details is None:
                details = {"scope": "platform"}
            elif isinstance(details, dict):
                details.setdefault("scope", "platform")

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


def log_login_event(db: Session,
                    actor_type: str,                 # "user" | "customer"
                    actor_id: Optional[int] = None,
                    username: Optional[str] = None,  # username or phone
                    lodge_id: Optional[int] = None,  # staff only; None for customers
                    success: bool = True,
                    method: str = "password",        # password | otp | pin | totp | signup
                    ip_address: Optional[str] = None,
                    user_agent: Optional[str] = None,
                    commit: bool = True):
    """Write one LoginEvent row (unified staff + customer login history).
    Never raises — login must not fail because history couldn't be written."""
    try:
        from ..models import LoginEvent
        db.add(LoginEvent(
            actor_type=actor_type,
            actor_id=actor_id,
            username=username,
            lodge_id=lodge_id,
            success=success,
            method=method,
            ip_address=ip_address,
            user_agent=(user_agent or "")[:400] or None,
        ))
        if commit:
            db.commit()
    except Exception as e:
        logger.warning(f"LoginEvent write failed (actor={username}): {e}")
