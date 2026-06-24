"""Staff management — lodge admin provisions / manages their own team.

Distinct from the legacy POST /api/users in auth.py: that endpoint is
generic (admin can create users at any role, picks the username, sets
the password). This module is purpose-built for the common case of a
lodge admin onboarding a front-desk hire:

  - Auto-generates the username as `<lodge_code>_staff<N>` where N is the
    next free integer for this lodge (staff1, staff2, ...). The admin
    only types the staff's full name + optional email/phone.
  - Auto-generates a 12-char password from an unambiguous alphabet,
    returned once for the admin to share out-of-band.
  - Granular permissions: the admin picks specific capability keys
    rather than relying on the coarse 'staff' role default.
  - Reset password: regenerate + return once. No email flow.
  - Deactivate (soft delete): preserves audit trail; can be reactivated.

Tenant-scoped: lodge admin only operates on their own lodge's users.
Super-admin can operate cross-tenant via the legacy /api/users endpoints
(this router stays focused on the lodge-admin experience).

Endpoints:
  GET    /api/staff                  — list this lodge's staff users
  GET    /api/staff/permissions       — permission catalog (for the UI)
  POST   /api/staff                  — create staff (auto-username + password)
  GET    /api/staff/{user_id}         — detail
  PATCH  /api/staff/{user_id}         — update name/email/phone/permissions/active
  POST   /api/staff/{user_id}/reset-password   — regenerate password
"""
import re
import json
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, EmailStr

from ..database import get_db
from ..models import User, UserRole, Lodge
from ..auth import (get_current_user, require_admin, get_password_hash,
                     verify_password)
from ..permissions import (PERMISSION_CATALOG, PERMISSION_CATALOG_V2, ROLE_PRESETS,
                             PERMISSION_KEYS, PERMISSION_KEY_SET, LEGACY_STAFF_DEFAULTS,
                             parse_permissions, serialize_permissions,
                             effective_permissions, apply_preset)
# Reuse the unambiguous-alphabet password generator from registration.
from .lodge_registration import _generate_password
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/staff", tags=["staff"])


# ── Serialization ──────────────────────────────────────────────────

def _user_to_dict(u: User, include_permissions_detail: bool = True) -> dict:
    out = {
        "user_id":      u.user_id,
        "username":     u.username,
        "full_name":    u.full_name,
        "email":        u.email,
        "phone":        u.phone,
        "role":         getattr(u.role, "value", u.role),
        "is_active":    bool(u.is_active),
        "last_login":   u.last_login.isoformat() if u.last_login else None,
        "created_at":   u.created_at.isoformat() if u.created_at else None,
        "totp_enabled": bool(u.totp_enabled),
        "require_login_otp": bool(getattr(u, "require_login_otp", False)),
    }
    if include_permissions_detail:
        parsed = parse_permissions(u.permissions)
        # `permissions_explicit` differs from `permissions_effective` in
        # one critical way: a NULL column means "use legacy defaults"
        # (rendered checked in the UI), whereas an empty list [] means
        # "explicitly nothing" (rendered unchecked).
        out["permissions_explicit"] = sorted(parsed) if parsed is not None else None
        out["permissions_effective"] = sorted(effective_permissions(u))
        out["uses_legacy_defaults"] = (parsed is None) and (u.role == UserRole.staff)
    return out


def _enforce_lodge_scope(target_user: User, current_user: User):
    """Lodge admin may only act on staff in their own lodge. Super-admin
    can act on any staff but is generally directed to /api/users for
    cross-tenant work."""
    if current_user.role == UserRole.super_admin:
        return
    if target_user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=404, detail="Staff member not found")


def _resolve_lodge_id(current_user: User, db: Session,
                       requested_lodge_id: Optional[int] = None) -> int:
    """Pick the lodge to operate on. For tenant admins it's locked to
    their own; for super-admin we accept an explicit lodge_id (via header
    or query) and default to 1 if unset (consistent with rest of the app).
    """
    if current_user.role == UserRole.super_admin:
        # Super-admin: explicit lodge_id beats header beats fallback.
        if requested_lodge_id:
            if not db.query(Lodge).filter(Lodge.lodge_id == requested_lodge_id).first():
                raise HTTPException(status_code=404, detail=f"Lodge {requested_lodge_id} not found")
            return requested_lodge_id
        # No explicit value: super-admin acting "as themselves" has no
        # particular lodge — return None to force them to set X-Lodge-Id.
        # In practice they'll use /api/users for cross-tenant ops.
        if current_user.lodge_id:
            return current_user.lodge_id
        raise HTTPException(status_code=400,
                            detail="Super-admin must specify a target lodge_id (or X-Lodge-Id header)")
    return current_user.lodge_id


# ── Catalog ────────────────────────────────────────────────────────

@router.get("/permissions")
def get_permission_catalog(current_user: User = Depends(require_admin)):
    """Return the enriched permission catalog + role presets for the
    staff access control UI. Presets give admins one-click starting points."""
    return {
        # Full catalog with module, risk level, and group
        "permissions": PERMISSION_CATALOG_V2,
        # Named role presets — admin picks a template, then fine-tunes
        "presets": {
            key: {
                "key":         key,
                "label":       p["label"],
                "icon":        p["icon"],
                "description": p["description"],
                "permissions": sorted(p["permissions"]),
                "count":       len(p["permissions"]),
            }
            for key, p in ROLE_PRESETS.items()
        },
        "default_keys": sorted(LEGACY_STAFF_DEFAULTS),
    }


@router.post("/{user_id}/apply-preset")
def apply_staff_preset(user_id: int, body: dict, request: Request,
                        current_user: User = Depends(require_admin),
                        db: Session = Depends(get_db)):
    """One-click apply a named role preset to a staff member.
    Admin can then further customize individual toggles."""
    preset_key = body.get("preset")
    if not preset_key or preset_key not in ROLE_PRESETS:
        from fastapi import HTTPException
        raise HTTPException(400, f"Unknown preset '{preset_key}'. Valid: {list(ROLE_PRESETS.keys())}")
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        from fastapi import HTTPException
        raise HTTPException(404, "Staff member not found")
    _enforce_lodge_scope(u, current_user)
    if u.role != UserRole.staff:
        from fastapi import HTTPException
        raise HTTPException(400, "Presets only apply to staff users")
    perm_set = apply_preset(preset_key)
    u.permissions = serialize_permissions(perm_set)
    db.commit(); db.refresh(u)
    try:
        log_audit(db, "staff.preset_applied",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="user", entity_id=u.user_id,
                  lodge_id=u.lodge_id,
                  details={"preset": preset_key, "permissions_count": len(perm_set)},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return {**_user_to_dict(u), "preset_applied": preset_key}


# ── List ───────────────────────────────────────────────────────────

@router.get("")
def list_staff(include_inactive: bool = False,
                lodge_id: Optional[int] = None,
                current_user: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    """All staff (and admins) in the current lodge. Super-admin can pass
    `?lodge_id=` to filter; tenant admin's scope is locked."""
    target_lodge = _resolve_lodge_id(current_user, db, lodge_id)
    q = db.query(User).filter(User.lodge_id == target_lodge)
    if not include_inactive:
        q = q.filter(User.is_active == True)
    rows = q.order_by(User.role.asc(), User.username.asc()).all()
    return [_user_to_dict(u) for u in rows]


@router.get("/{user_id}")
def get_staff(user_id: int,
               current_user: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Staff member not found")
    _enforce_lodge_scope(u, current_user)
    return _user_to_dict(u)


# ── Create ─────────────────────────────────────────────────────────

class CreateStaffBody(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    # Optional explicit permission grant. If None, we seed with the legacy
    # defaults — least surprising for admins who want "a normal staff user".
    permissions: Optional[List[str]] = None
    # Allow promoting to admin in the same call? Deliberately disallowed —
    # this router is for STAFF onboarding. Admin promotion requires the
    # legacy /api/users endpoint, which has stricter auditing.


def _next_staff_username(db: Session, lodge_id: int) -> str:
    """Pick the next `<code>_staffN` slot. Scans existing usernames in
    this lodge matching `<code>_staff<digits>`, returns N+1. If there's
    a gap we re-use it — keeps the numbering tight for human readability.

    The lodge code may itself contain digits (e.g. "rk2024"), so we anchor
    on the literal "_staff" suffix when extracting N.
    """
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=500, detail="Lodge not found")
    code = lodge.code
    prefix = f"{code}_staff"
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    used: set[int] = set()
    for u in db.query(User).filter(User.lodge_id == lodge_id,
                                     User.username.like(f"{prefix}%")).all():
        m = pattern.match(u.username)
        if m:
            used.add(int(m.group(1)))
    n = 1
    while n in used:
        n += 1
    return f"{prefix}{n}"


@router.post("", status_code=201)
def create_staff(body: CreateStaffBody, request: Request,
                  lodge_id: Optional[int] = None,
                  current_user: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    target_lodge = _resolve_lodge_id(current_user, db, lodge_id)

    # Pick a fresh username + password.
    username = _next_staff_username(db, target_lodge)
    password = _generate_password()

    # Permissions: validate against the catalog. None → use legacy defaults
    # so the user can immediately operate normally without further setup.
    if body.permissions is None:
        perm_list = sorted(LEGACY_STAFF_DEFAULTS)
    else:
        # Filter unknown keys silently — keep the create call forgiving of
        # stale UI sending deprecated keys. Audit log the cleaned-up set.
        perm_list = sorted({k for k in body.permissions if k in PERMISSION_KEY_SET})

    user = User(
        lodge_id=target_lodge,
        username=username,
        password_hash=get_password_hash(password),
        full_name=body.full_name.strip(),
        email=body.email,
        phone=(body.phone or "").strip() or None,
        role=UserRole.staff,
        is_active=True,
        permissions=serialize_permissions(perm_list),
    )
    db.add(user); db.commit(); db.refresh(user)

    try:
        log_audit(db, "staff.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="user", entity_id=user.user_id,
                  lodge_id=target_lodge,
                  details={"username": username, "permissions_count": len(perm_list)},
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass

    return {
        **_user_to_dict(user),
        # Plaintext password — shown once. Admin must capture this now.
        "password": password,
        "message": (f"Staff account created: {username}. "
                    f"Share these credentials securely; the password won't be shown again."),
    }


# ── Update (name / email / phone / permissions / active) ────────────

class UpdateStaffBody(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    is_active: Optional[bool] = None
    # When provided, REPLACES the permission set wholesale. To clear all
    # permissions (deny everything) send []. To restore legacy defaults
    # use the `reset_to_defaults: true` field instead.
    permissions: Optional[List[str]] = None
    reset_to_defaults: Optional[bool] = None


@router.patch("/{user_id}")
def update_staff(user_id: int, body: UpdateStaffBody, request: Request,
                  current_user: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Staff member not found")
    _enforce_lodge_scope(u, current_user)

    # Permissions can only be edited on staff. Touching admin/super_admin
    # permissions is a no-op (role grants full access regardless) — refuse
    # to silently mislead the admin.
    if (body.permissions is not None or body.reset_to_defaults) and u.role != UserRole.staff:
        raise HTTPException(status_code=400,
                            detail="Permissions only apply to staff users; admins have full access by role")

    # Prevent self-deactivation (admin lockout).
    if body.is_active is False and u.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")

    changes = {}
    if body.full_name is not None:
        u.full_name = body.full_name.strip(); changes["full_name"] = u.full_name
    if body.email is not None:
        u.email = body.email; changes["email"] = u.email
    if body.phone is not None:
        u.phone = (body.phone or "").strip() or None; changes["phone"] = u.phone
    if body.is_active is not None:
        u.is_active = body.is_active; changes["is_active"] = u.is_active
    if body.reset_to_defaults:
        u.permissions = serialize_permissions(LEGACY_STAFF_DEFAULTS)
        changes["permissions"] = "reset_to_defaults"
    elif body.permissions is not None:
        cleaned = sorted({k for k in body.permissions if k in PERMISSION_KEY_SET})
        u.permissions = serialize_permissions(cleaned)
        changes["permissions"] = f"set_to:{len(cleaned)}_keys"

    db.commit(); db.refresh(u)

    if changes:
        try:
            log_audit(db, "staff.updated",
                      actor_user_id=current_user.user_id,
                      actor_username=current_user.username,
                      entity_type="user", entity_id=u.user_id,
                      lodge_id=u.lodge_id,
                      details={"username": u.username, "changes": list(changes.keys())},
                      ip_address=request.client.host if request.client else None)
        except Exception:
            pass

    return _user_to_dict(u)


# ── Reset password ─────────────────────────────────────────────────

@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, request: Request,
                    current_user: User = Depends(require_admin),
                    db: Session = Depends(get_db)):
    """Generate a new random password. Admin captures it once, shares
    out-of-band with the staff member.

    Refusing to let an admin reset their OWN password through this endpoint
    is intentional: they should use the self-service Security page, which
    requires the old password — preventing a stolen JWT from locking the
    admin out of their own account."""
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Staff member not found")
    _enforce_lodge_scope(u, current_user)
    if u.user_id == current_user.user_id:
        raise HTTPException(status_code=400,
                            detail="To change your own password, use the Security page")

    # Never reset another admin's password through this route — they're
    # peers, and a captured admin token should not pivot to take over
    # another admin account. Super-admin can do it via /api/users.
    if u.role != UserRole.staff and current_user.role != UserRole.super_admin:
        raise HTTPException(status_code=403,
                            detail="Cannot reset another admin's password from here")

    new_password = _generate_password()
    u.password_hash = get_password_hash(new_password)
    # Clear any lockout / failed-attempt counters too.
    u.failed_attempts = 0
    u.locked_until = None
    db.commit()

    try:
        log_audit(db, "staff.password_reset",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="user", entity_id=u.user_id,
                  lodge_id=u.lodge_id,
                  details={"username": u.username},
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass

    return {
        "user_id": u.user_id,
        "username": u.username,
        "password": new_password,
        "message": ("Password reset. Capture and share securely — "
                    "the new password won't be shown again."),
    }
