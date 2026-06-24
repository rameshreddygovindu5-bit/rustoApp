"""
plan_features.py — API endpoints for plan-level RBAC feature gating

GET  /api/plan/features          — what modules current lodge's plan allows
GET  /api/plan/enabled-modules   — which of those modules this lodge has turned on
POST /api/plan/enabled-modules   — admin saves their chosen module set (gated by plan)
GET  /api/plan/staff-context     — staff user's effective module+permission context
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import json

from ..database import get_db
from ..models import User, UserRole, Setting, Subscription
from ..auth import get_current_user, resolve_lodge_scope
from ..plan_module_gates import (
    get_allowed_modules, filter_to_plan, CORE_MODULES, PLAN_MODULE_GATES
)
from ..permissions import effective_permissions, parse_permissions

router = APIRouter(prefix="/api/plan", tags=["plan-features"])


def _get_lodge_plan(db: Session, lodge_id: int) -> str:
    """Return the plan key for this lodge. Defaults to 'starter'."""
    sub = db.query(Subscription).filter(
        Subscription.lodge_id == lodge_id
    ).first()
    if sub and sub.plan_key:
        return sub.plan_key
    return "starter"


def _get_enabled_modules(db: Session, lodge_id: int) -> Optional[set]:
    """Return the admin's chosen module set from settings, or None (= all plan modules)."""
    row = db.query(Setting).filter(
        Setting.lodge_id == lodge_id,
        Setting.setting_key == "enabled_modules"
    ).first()
    if not row or not row.setting_value:
        return None
    try:
        parsed = json.loads(row.setting_value)
        if isinstance(parsed, list):
            return set(parsed)
    except (ValueError, TypeError):
        pass
    return None


def _save_enabled_modules(db: Session, lodge_id: int, module_set: set):
    """Persist the admin's module choice to settings."""
    value = json.dumps(sorted(module_set))
    row = db.query(Setting).filter(
        Setting.lodge_id == lodge_id,
        Setting.setting_key == "enabled_modules"
    ).first()
    if row:
        row.setting_value = value
    else:
        db.add(Setting(
            lodge_id=lodge_id,
            setting_key="enabled_modules",
            setting_value=value,
            setting_group="modules",
            description="JSON array of enabled module IDs",
        ))
    db.commit()


# ── GET /api/plan/features ────────────────────────────────────────────────────
@router.get("/features")
def get_plan_features(
    lodge_id: int = Depends(resolve_lodge_scope),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return what modules the lodge's current plan allows.
    Accessible to admin and super_admin.
    Staff get a 403 since plan details are not for them.
    """
    role = getattr(current_user.role, "value", current_user.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Admin access required to view plan features")

    plan_key = _get_lodge_plan(db, lodge_id)
    allowed  = sorted(get_allowed_modules(plan_key))

    # Return all plan tiers for comparison display
    tiers = {
        pk: sorted(get_allowed_modules(pk))
        for pk in PLAN_MODULE_GATES
    }

    return {
        "plan_key": plan_key,
        "allowed_modules": allowed,
        "core_modules": sorted(CORE_MODULES),
        "plan_tiers": tiers,
    }


# ── GET /api/plan/enabled-modules ─────────────────────────────────────────────
@router.get("/enabled-modules")
def get_enabled_modules(
    lodge_id: int = Depends(resolve_lodge_scope),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return the lodge's currently-enabled module set — already gated by plan.
    This is what the SIDEBAR reads to decide which items to show.
    """
    plan_key       = _get_lodge_plan(db, lodge_id)
    plan_allowed   = get_allowed_modules(plan_key)
    chosen         = _get_enabled_modules(db, lodge_id)

    # If admin hasn't configured yet → default to all plan-allowed modules
    effective = (chosen & plan_allowed) if chosen is not None else plan_allowed

    return {
        "plan_key": plan_key,
        "plan_allowed": sorted(plan_allowed),
        "enabled": sorted(effective),
        "core_modules": sorted(CORE_MODULES),
    }


# ── POST /api/plan/enabled-modules ────────────────────────────────────────────
class EnableModulesBody(BaseModel):
    modules: List[str]   # the admin's chosen set


@router.post("/enabled-modules")
def save_enabled_modules(
    body: EnableModulesBody,
    lodge_id: int = Depends(resolve_lodge_scope),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin saves which modules they want enabled for their lodge.
    Modules outside the plan are silently dropped — the admin cannot
    persist features they haven't paid for.
    """
    role = getattr(current_user.role, "value", current_user.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Admin access required to change module settings")

    plan_key = _get_lodge_plan(db, lodge_id)
    requested = set(body.modules) | CORE_MODULES        # core always on
    gated     = filter_to_plan(requested, plan_key)     # drop out-of-plan modules

    _save_enabled_modules(db, lodge_id, gated)

    return {
        "saved": sorted(gated),
        "plan_key": plan_key,
        "dropped": sorted(requested - gated),  # modules that were stripped (not in plan)
    }


# ── GET /api/plan/staff-context ───────────────────────────────────────────────
@router.get("/staff-context")
def get_staff_context(
    lodge_id: int = Depends(resolve_lodge_scope),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    The COMPLETE access context for the logged-in user:
      - Which modules are enabled for their lodge (within plan)
      - Their own effective permissions
      - Their role
    
    Used by Layout and ProtectedRoute to gate sidebar items and pages.
    Called once on login and whenever the user object changes.
    """
    plan_key       = _get_lodge_plan(db, lodge_id)
    plan_allowed   = get_allowed_modules(plan_key)
    chosen         = _get_enabled_modules(db, lodge_id)
    lodge_modules  = (chosen & plan_allowed) if chosen is not None else plan_allowed

    role = getattr(current_user.role, "value", current_user.role)

    # admin/super_admin → full access within lodge modules
    if role in ("admin", "super_admin"):
        return {
            "role": role,
            "plan_key": plan_key,
            "lodge_modules": sorted(lodge_modules),
            "permissions": None,     # None = unrestricted
            "is_admin": True,
        }

    # staff → intersect their explicit permissions with what lodge has enabled
    staff_perms  = effective_permissions(current_user)

    # Only return the staff context for modules the lodge has enabled.
    # A staff member cannot access a module their lodge hasn't turned on,
    # even if an admin accidentally granted them a permission for it.
    return {
        "role": role,
        "plan_key": plan_key,
        "lodge_modules": sorted(lodge_modules),
        "permissions": sorted(staff_perms),
        "is_admin": False,
    }
