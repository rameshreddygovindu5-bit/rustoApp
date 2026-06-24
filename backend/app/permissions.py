"""
permissions.py — Enterprise RBAC Permission Catalog
=====================================================

Industry-standard, module-driven fine-grained permission system.

DESIGN PRINCIPLES:
  - Every module has explicit read / write / delete permissions
  - Admin always has all permissions (role-based override)
  - Staff gets only what admin explicitly grants — no implicit access
  - `require_permission(key)` FastAPI dep enforces at the route level
  - Zero implicit access: new staff start with an empty set; admin
    chooses a preset ("Receptionist", "Housekeeper", etc.) then fine-tunes

PERMISSION KEY STRUCTURE:
  <module>.<action>
  Actions: read, write, delete, manage
    - read   → view/list only (safe default, no data mutation)
    - write  → create and edit (but not delete)
    - delete → delete records (requires write too, typically)
    - manage → admin-level actions within the module (assign, close, etc.)

RESOLUTION ORDER (has_permission):
  1. super_admin → always True
  2. admin → always True
  3. staff with explicit permissions → check the set
  4. staff with NULL permissions → LEGACY_STAFF_DEFAULTS (backward compat)
"""
from __future__ import annotations
import json
import logging
from typing import Optional, List, Set, Iterable, Dict

from fastapi import Depends, HTTPException, status
from .models import User, UserRole
from .auth import get_current_user

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# PERMISSION CATALOG
# ══════════════════════════════════════════════════════════════════════════════
# Each entry: (key, module_id, group_label, human_label, description, risk_level)
# risk_level: "low" | "medium" | "high"
#   low    = read-only access, no data mutation
#   medium = create/edit, no destructive operations
#   high   = delete, financial, or sensitive operations

PERMISSION_CATALOG_V2: List[Dict] = [

    # ── Front Desk ────────────────────────────────────────────────────────────
    {
        "key": "bookings.read",   "module": "front_desk", "group": "Bookings",
        "label": "View bookings",
        "description": "Browse bookings list and individual booking details",
        "risk": "low",
    },
    {
        "key": "bookings.write",  "module": "front_desk", "group": "Bookings",
        "label": "Create / edit bookings",
        "description": "Add new bookings, modify dates, rooms, pricing",
        "risk": "medium",
    },
    {
        "key": "bookings.delete", "module": "front_desk", "group": "Bookings",
        "label": "Cancel / delete bookings",
        "description": "Cancel or void existing bookings — irreversible",
        "risk": "high",
    },
    {
        "key": "checkins.read",   "module": "front_desk", "group": "Check-in / out",
        "label": "View check-ins",
        "description": "See active and historical guest check-ins",
        "risk": "low",
    },
    {
        "key": "checkins.write",  "module": "front_desk", "group": "Check-in / out",
        "label": "Check in guests",
        "description": "Perform guest check-in — creates a live stay",
        "risk": "medium",
    },
    {
        "key": "checkins.checkout", "module": "front_desk", "group": "Check-in / out",
        "label": "Check out guests",
        "description": "Perform guest checkout — closes the folio",
        "risk": "high",
    },
    {
        "key": "rooms.read",      "module": "rooms",       "group": "Rooms",
        "label": "View room status",
        "description": "Read-only access to rooms grid and tape chart",
        "risk": "low",
    },
    {
        "key": "rooms.write",     "module": "rooms",       "group": "Rooms",
        "label": "Edit room status",
        "description": "Block/unblock rooms, change status manually",
        "risk": "medium",
    },
    {
        "key": "customers.read",  "module": "front_desk",  "group": "Guests",
        "label": "View guest profiles",
        "description": "Browse the guest database (read PII)",
        "risk": "low",
    },
    {
        "key": "customers.write", "module": "front_desk",  "group": "Guests",
        "label": "Edit guest profiles",
        "description": "Create and update guest records, ID proofs",
        "risk": "medium",
    },
    {
        "key": "customers.delete","module": "front_desk",  "group": "Guests",
        "label": "Delete guest profiles",
        "description": "Permanently remove guest records — irreversible",
        "risk": "high",
    },

    # ── Operations ─────────────────────────────────────────────────────────────
    {
        "key": "housekeeping.read",   "module": "housekeeping", "group": "Housekeeping",
        "label": "View housekeeping tasks",
        "description": "See the housekeeping board and task list",
        "risk": "low",
    },
    {
        "key": "housekeeping.write",  "module": "housekeeping", "group": "Housekeeping",
        "label": "Update room status",
        "description": "Mark rooms clean/dirty, start / complete tasks",
        "risk": "medium",
    },
    {
        "key": "housekeeping.manage", "module": "housekeeping", "group": "Housekeeping",
        "label": "Assign & inspect rooms",
        "description": "Assign tasks to staff, mark as inspected",
        "risk": "medium",
    },
    {
        "key": "maintenance.read",    "module": "maintenance",  "group": "Maintenance",
        "label": "View maintenance tickets",
        "description": "Browse all maintenance issues and their status",
        "risk": "low",
    },
    {
        "key": "maintenance.write",   "module": "maintenance",  "group": "Maintenance",
        "label": "Create / edit tickets",
        "description": "Open new maintenance tickets, update details",
        "risk": "medium",
    },
    {
        "key": "maintenance.manage",  "module": "maintenance",  "group": "Maintenance",
        "label": "Close & assign tickets",
        "description": "Assign tickets, mark resolved, change priority",
        "risk": "medium",
    },
    {
        "key": "inventory.read",      "module": "inventory",    "group": "Inventory",
        "label": "View inventory",
        "description": "Read-only stock counts and item list",
        "risk": "low",
    },
    {
        "key": "inventory.write",     "module": "inventory",    "group": "Inventory",
        "label": "Manage inventory",
        "description": "Adjust stock, receive consumables, log movements",
        "risk": "medium",
    },

    # ── Billing / Finance ──────────────────────────────────────────────────────
    {
        "key": "billing.read",    "module": "front_desk",  "group": "Billing",
        "label": "View folios & invoices",
        "description": "Read folios, invoices and payment history",
        "risk": "low",
    },
    {
        "key": "billing.write",   "module": "front_desk",  "group": "Billing",
        "label": "Post charges & receive payments",
        "description": "Add charges to folios, record payments",
        "risk": "high",
    },
    {
        "key": "billing.delete",  "module": "front_desk",  "group": "Billing",
        "label": "Void charges",
        "description": "Void folio line items — financial impact",
        "risk": "high",
    },
    {
        "key": "expenses.read",   "module": "expenses",    "group": "Expenses",
        "label": "View expenses",
        "description": "See the expense ledger and individual entries",
        "risk": "low",
    },
    {
        "key": "expenses.write",  "module": "expenses",    "group": "Expenses",
        "label": "Record expenses",
        "description": "Log new expenses, edit existing entries",
        "risk": "medium",
    },
    {
        "key": "expenses.delete", "module": "expenses",    "group": "Expenses",
        "label": "Delete expense records",
        "description": "Remove expense entries — affects reconciliation",
        "risk": "high",
    },

    # ── Shifts ─────────────────────────────────────────────────────────────────
    {
        "key": "shifts.read",     "module": "shifts",      "group": "Shifts",
        "label": "View shifts",
        "description": "See current and past shift records",
        "risk": "low",
    },
    {
        "key": "shifts.write",    "module": "shifts",      "group": "Shifts",
        "label": "Open / close shifts",
        "description": "Start and end cash-drawer shifts",
        "risk": "high",
    },

    # ── Reports & Analytics ────────────────────────────────────────────────────
    {
        "key": "reports.view",    "module": "reports",     "group": "Reports",
        "label": "View reports & KPIs",
        "description": "Access analytics dashboards and operational reports",
        "risk": "low",
    },
    {
        "key": "reports.export",  "module": "reports",     "group": "Reports",
        "label": "Export reports",
        "description": "Download report data as CSV/Excel",
        "risk": "medium",
    },

    # ── Guest relations ────────────────────────────────────────────────────────
    {
        "key": "feedback.read",   "module": "feedback",    "group": "Guest Relations",
        "label": "View guest feedback",
        "description": "Read feedback submissions and ratings",
        "risk": "low",
    },
    {
        "key": "feedback.write",  "module": "feedback",    "group": "Guest Relations",
        "label": "Respond to feedback",
        "description": "Reply to and archive guest feedback",
        "risk": "medium",
    },
    {
        "key": "loyalty.read",    "module": "loyalty",     "group": "Guest Relations",
        "label": "View loyalty accounts",
        "description": "See customer loyalty points and tiers",
        "risk": "low",
    },
    {
        "key": "loyalty.write",   "module": "loyalty",     "group": "Guest Relations",
        "label": "Adjust loyalty points",
        "description": "Manually add or redeem loyalty points",
        "risk": "high",
    },

    # ── Alerts & Notifications ─────────────────────────────────────────────────
    {
        "key": "alerts.read",     "module": "alerts",      "group": "Alerts",
        "label": "View alert history",
        "description": "See sent SMS/email notification log",
        "risk": "low",
    },
    {
        "key": "alerts.write",    "module": "alerts",      "group": "Alerts",
        "label": "Send custom alerts",
        "description": "Trigger manual SMS or email notifications",
        "risk": "medium",
    },

    # ── Import / Export ────────────────────────────────────────────────────────
    {
        "key": "import.write",    "module": "front_desk",  "group": "Data",
        "label": "Import guest data",
        "description": "Upload Excel guest lists and bulk-import records",
        "risk": "high",
    },

    # ── Night Audit ────────────────────────────────────────────────────────────
    {
        "key": "night_audit.run", "module": "front_desk",  "group": "Night Audit",
        "label": "Run night audit",
        "description": "Execute end-of-day night audit — advances business date",
        "risk": "high",
    },

    # ── Foreign guests ─────────────────────────────────────────────────────────
    {
        "key": "foreign_guests.read",  "module": "foreign_guests", "group": "Foreign Guests",
        "label": "View C-Form registrations",
        "description": "See foreign guest registration records",
        "risk": "low",
    },
    {
        "key": "foreign_guests.write", "module": "foreign_guests", "group": "Foreign Guests",
        "label": "Manage C-Form registrations",
        "description": "Add and update foreign guest C-Form data",
        "risk": "medium",
    },
]

# ── Flat lookup structures ─────────────────────────────────────────────────────
PERMISSION_KEYS: List[str]  = [p["key"] for p in PERMISSION_CATALOG_V2]
PERMISSION_KEY_SET: Set[str] = set(PERMISSION_KEYS)

# Backward-compat alias for code that imports the old tuple-based catalog
PERMISSION_CATALOG: List[tuple] = [
    (p["key"], p["group"], p["label"], p["description"])
    for p in PERMISSION_CATALOG_V2
]

# ── Role Presets ──────────────────────────────────────────────────────────────
# Named permission bundles admin can one-click apply to a staff member.
# Based on real hotel industry job roles.
ROLE_PRESETS: Dict[str, Dict] = {
    "receptionist": {
        "label": "Receptionist",
        "icon": "🏨",
        "description": "Front desk — check-in, checkout, bookings, guest management",
        "permissions": {
            "bookings.read", "bookings.write",
            "checkins.read", "checkins.write", "checkins.checkout",
            "rooms.read",
            "customers.read", "customers.write",
            "billing.read", "billing.write",
            "alerts.read", "alerts.write",
            "feedback.read",
        },
    },
    "housekeeper": {
        "label": "Housekeeper",
        "icon": "🧹",
        "description": "Housekeeping tasks only — no financial or guest PII access",
        "permissions": {
            "housekeeping.read", "housekeeping.write",
            "rooms.read",
        },
    },
    "housekeeping_supervisor": {
        "label": "Housekeeping Supervisor",
        "icon": "🏠",
        "description": "Assign, inspect and manage all housekeeping tasks",
        "permissions": {
            "housekeeping.read", "housekeeping.write", "housekeeping.manage",
            "rooms.read", "rooms.write",
            "maintenance.read",
        },
    },
    "maintenance_staff": {
        "label": "Maintenance Staff",
        "icon": "🔧",
        "description": "View and update maintenance tickets",
        "permissions": {
            "maintenance.read", "maintenance.write",
            "rooms.read",
        },
    },
    "night_auditor": {
        "label": "Night Auditor",
        "icon": "🌙",
        "description": "Full front-desk access plus ability to run night audit",
        "permissions": {
            "bookings.read", "bookings.write",
            "checkins.read", "checkins.write", "checkins.checkout",
            "rooms.read", "rooms.write",
            "customers.read",
            "billing.read", "billing.write",
            "shifts.read", "shifts.write",
            "reports.view",
            "night_audit.run",
        },
    },
    "accounts": {
        "label": "Accounts / Finance",
        "icon": "💰",
        "description": "Billing, expenses, reports — no check-in/out access",
        "permissions": {
            "billing.read", "billing.write",
            "expenses.read", "expenses.write",
            "shifts.read", "shifts.write",
            "reports.view", "reports.export",
            "bookings.read",
            "checkins.read",
        },
    },
    "manager": {
        "label": "Duty Manager",
        "icon": "👔",
        "description": "Full operational access except admin settings",
        "permissions": {
            "bookings.read",    "bookings.write",    "bookings.delete",
            "checkins.read",    "checkins.write",    "checkins.checkout",
            "rooms.read",       "rooms.write",
            "customers.read",   "customers.write",
            "billing.read",     "billing.write",     "billing.delete",
            "expenses.read",    "expenses.write",
            "housekeeping.read","housekeeping.write","housekeeping.manage",
            "maintenance.read", "maintenance.write", "maintenance.manage",
            "inventory.read",   "inventory.write",
            "shifts.read",      "shifts.write",
            "reports.view",     "reports.export",
            "alerts.read",      "alerts.write",
            "feedback.read",    "feedback.write",
            "loyalty.read",
            "foreign_guests.read", "foreign_guests.write",
        },
    },
    "read_only": {
        "label": "Read-Only Observer",
        "icon": "👁️",
        "description": "View-only access to everything — cannot modify any data",
        "permissions": {
            "bookings.read", "checkins.read", "rooms.read",
            "customers.read", "billing.read", "expenses.read",
            "housekeeping.read", "maintenance.read", "inventory.read",
            "shifts.read", "reports.view", "alerts.read", "feedback.read",
            "loyalty.read", "foreign_guests.read",
        },
    },
}

# ── Legacy defaults ───────────────────────────────────────────────────────────
# Preserved for backward compatibility — staff created before v4.0 keep
# their existing access without any migration work.
LEGACY_STAFF_DEFAULTS: Set[str] = {
    "bookings.read", "bookings.write",
    "checkins.read", "checkins.write", "checkins.checkout",
    "customers.read", "customers.write",
    "rooms.read", "rooms.write",
    "housekeeping.read", "housekeeping.write",
    "maintenance.read", "maintenance.write",
    "billing.read", "billing.write",
    "feedback.read", "feedback.write",
    "shifts.read", "shifts.write",
    "reports.view",
    "alerts.read",
}

# ── Core functions ────────────────────────────────────────────────────────────

def parse_permissions(raw: Optional[str]) -> Optional[Set[str]]:
    if raw is None or raw == "":
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return {k for k in parsed if isinstance(k, str) and k in PERMISSION_KEY_SET}
    except (ValueError, TypeError):
        logger.warning("Invalid permissions JSON on user; treating as legacy default")
    return None


def serialize_permissions(keys: Iterable[str]) -> str:
    valid = sorted({k for k in keys if isinstance(k, str) and k in PERMISSION_KEY_SET})
    return json.dumps(valid)


def effective_permissions(user: User) -> Set[str]:
    if user.role in (UserRole.admin, UserRole.super_admin):
        return set(PERMISSION_KEYS)
    parsed = parse_permissions(user.permissions)
    return parsed if parsed is not None else set(LEGACY_STAFF_DEFAULTS)


def has_permission(user: User, key: str) -> bool:
    if user.role in (UserRole.admin, UserRole.super_admin):
        return True
    parsed = parse_permissions(user.permissions)
    grants = parsed if parsed is not None else LEGACY_STAFF_DEFAULTS
    return key in grants


def require_permission(key: str):
    """FastAPI dependency factory — enforces a permission key at route level.

    Usage:
        @router.get("/foo", dependencies=[Depends(require_permission("foo.read"))])
        def foo(...): ...

    Or with user object in handler:
        @router.post("/bar")
        def bar(user = Depends(require_permission("bar.write"))): ...
    """
    if key not in PERMISSION_KEY_SET:
        raise ValueError(
            f"Unknown permission key: {key!r}. "
            f"Valid keys: {sorted(PERMISSION_KEY_SET)}"
        )

    def _dep(current_user: User = Depends(get_current_user)) -> User:
        if not has_permission(current_user, key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: you need the '{key}' permission to perform this action.",
            )
        return current_user

    _dep.__name__ = f"require_permission__{key.replace('.', '_')}"
    return _dep


def apply_preset(preset_key: str) -> Set[str]:
    """Return the permission set for a named preset, or empty set if unknown."""
    preset = ROLE_PRESETS.get(preset_key)
    return preset["permissions"] if preset else set()
