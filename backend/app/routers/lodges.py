"""Lodges router — multi-tenant management endpoints.

Visibility:
- Any authenticated user can call GET /lodges/me  → just their own lodge.
- super_admin can list/create/update lodges via the other endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import re

from ..database import get_db
from ..models import Lodge, User
from ..auth import get_current_user, require_super_admin
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/lodges", tags=["lodges"])


def _to_dict(l: Lodge) -> dict:
    return {
        "lodge_id": l.lodge_id,
        "code": l.code,
        "name": l.name,
        "address": l.address,
        "phone": l.phone,
        "email": l.email,
        "is_active": bool(l.is_active),
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }


@router.get("/me")
def get_my_lodge(current_user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """The lodge the currently-logged-in user belongs to."""
    if current_user.lodge_id is None:
        # super_admin without a current selection — no lodge to report.
        return None
    lodge = db.query(Lodge).filter(Lodge.lodge_id == current_user.lodge_id).first()
    return _to_dict(lodge) if lodge else None


@router.get("")
def list_lodges(current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    """List lodges visible to the caller.

    Regular users see only their own (so the lodge dropdown can show *that
    lodge and disable it* per requirement). super_admin sees all lodges,
    so the dropdown becomes a real selector for them.
    """
    role = getattr(current_user.role, "value", current_user.role)
    if role == "super_admin":
        rows = db.query(Lodge).order_by(Lodge.lodge_id).all()
    else:
        rows = (db.query(Lodge)
                .filter(Lodge.lodge_id == current_user.lodge_id)
                .all())
    return [_to_dict(l) for l in rows]


class LodgeCreate(BaseModel):
    code: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@router.post("", status_code=201)
def create_lodge(body: LodgeCreate, request: Request,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_super_admin)):
    """Super-admin: create a new lodge."""
    code = (body.code or "").strip().lower()
    if not re.match(r"^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$", code):
        raise HTTPException(
            status_code=400,
            detail="code must be 3–40 chars, lowercase alphanumeric / underscore / hyphen",
        )
    if db.query(Lodge).filter(Lodge.code == code).first():
        raise HTTPException(status_code=409, detail=f"Lodge code '{code}' is already taken")
    if not body.name or len(body.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Lodge name is required")

    lodge = Lodge(
        code=code,
        name=body.name.strip(),
        address=body.address,
        phone=body.phone,
        email=body.email,
        is_active=True,
    )
    db.add(lodge)
    db.commit()
    db.refresh(lodge)

    # Seed a baseline set of settings for the new lodge by copying from the
    # first existing lodge (best available template).
    _copy_settings_template(db, lodge.lodge_id, new_name=body.name.strip())

    # Audit the lodge creation — for super_admin actions we stamp the
    # audit row with the NEW lodge's id, so it shows up in that lodge's
    # audit history (where you'd expect to find "lodge was created").
    try:
        log_audit(
            db, "lodge.created",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"code": lodge.code, "name": lodge.name},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return _to_dict(lodge)


class LodgeUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/{lodge_id}")
def update_lodge(lodge_id: int, body: LodgeUpdate, request: Request,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(require_super_admin)):
    """Super-admin: update lodge metadata. Code is immutable."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    changed = body.dict(exclude_unset=True)
    for field, value in changed.items():
        setattr(lodge, field, value)
    db.commit()
    db.refresh(lodge)
    try:
        log_audit(
            db, "lodge.updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"changed": list(changed.keys())},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return _to_dict(lodge)


@router.delete("/{lodge_id}")
def archive_lodge(lodge_id: int, request: Request,
                  db: Session = Depends(get_db),
                  current_user: User = Depends(require_super_admin)):
    """Super-admin: archive (soft-delete) a lodge by setting is_active=False.
    The data stays in place (so historical bookings/invoices remain), but
    the lodge stops appearing in the active list. We don't hard-delete
    because too many other rows have foreign keys into it."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    # Refuse to archive the only remaining active lodge — that would
    # silently lock everyone out.
    other_active = (db.query(Lodge)
                    .filter(Lodge.is_active == True,
                            Lodge.lodge_id != lodge_id)
                    .count())
    if other_active == 0:
        raise HTTPException(status_code=400,
                            detail="Cannot archive the only active lodge")
    lodge.is_active = False
    db.commit()
    try:
        log_audit(
            db, "lodge.archived",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="lodge", entity_id=lodge.lodge_id,
            lodge_id=lodge.lodge_id,
            details={"code": lodge.code, "name": lodge.name},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": f"Lodge '{lodge.name}' archived"}


def _copy_settings_template(db: Session, new_lodge_id: int, new_name: str = ""):
    """Copy the first existing lodge's settings to a new lodge so it starts
    with sensible defaults (tariffs, GST flags, alert flags). Skips any key
    that already exists on the new lodge."""
    from ..models import Setting
    first = (db.query(Lodge)
             .filter(Lodge.lodge_id != new_lodge_id)
             .order_by(Lodge.lodge_id)
             .first())
    if not first:
        return
    template = db.query(Setting).filter(Setting.lodge_id == first.lodge_id).all()
    existing_keys = {
        r.setting_key for r in
        db.query(Setting).filter(Setting.lodge_id == new_lodge_id).all()
    }
    for s in template:
        if s.setting_key in existing_keys:
            continue
        # Override hotel_name with the new lodge's name; secrets are blanked
        # so the new lodge doesn't inherit Twilio credentials etc.
        sensitive_blank = bool(s.is_sensitive)
        val = ("" if sensitive_blank
               else (new_name if s.setting_key == "hotel_name" and new_name else s.setting_value))
        db.add(Setting(
            lodge_id=new_lodge_id,
            setting_key=s.setting_key,
            setting_value=val,
            setting_group=s.setting_group,
            description=s.description,
            is_sensitive=s.is_sensitive,
        ))
    db.commit()
