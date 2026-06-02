"""Permission catalog + FastAPI dependency for granular RBAC.

Roles vs permissions:
  - ROLE is coarse: staff / admin / super_admin. Used for things like
    "can manage other users" or "can edit lodge settings".
  - PERMISSIONS are fine-grained capability keys ("bookings.write",
    "housekeeping.read") that a lodge admin can selectively grant to
    individual STAFF users.

Resolution rules (in `has_permission`):
  1. super_admin → always True (cross-tenant operator)
  2. admin       → always True (full access within their lodge)
  3. staff with a populated `permissions` list → only those keys grant access
  4. staff with NULL/empty `permissions` → legacy default (LEGACY_STAFF_DEFAULTS)
     — preserves the historical behaviour where a "staff" user could do
     everything operational. Existing deployments won't break.

Why JSON-in-TEXT rather than a separate UserPermissions table?
  - Permission lists are tiny (10-20 keys) and always read together.
  - One-shot read with the User row; no extra joins on every request.
  - Editing is wholesale (UI shows toggles; submit replaces the whole list).
  - Trivial migration: just an ALTER ADD COLUMN.
"""
from __future__ import annotations
import json
import logging
from typing import Optional, List, Set, Iterable

from fastapi import Depends, HTTPException, status

from .models import User, UserRole
from .auth import get_current_user

logger = logging.getLogger(__name__)


# ── The catalog ───────────────────────────────────────────────────────
# Each entry: (key, group_label, human_label, description).
# Groups are used by the UI to render permission toggles in sections.
PERMISSION_CATALOG: List[tuple] = [
    # Front-desk operations
    ("bookings.read",       "Front Desk",  "View bookings",        "Browse the bookings list and individual booking details"),
    ("bookings.write",      "Front Desk",  "Create / edit bookings", "Add new bookings, modify dates/rooms, cancel"),
    ("checkins.read",       "Front Desk",  "View checkins",        "See current and historical guest checkins"),
    ("checkins.write",      "Front Desk",  "Check in / out guests", "Perform checkin and checkout"),
    ("customers.read",      "Front Desk",  "View guest profiles",   "Browse the guest database"),
    ("customers.write",     "Front Desk",  "Edit guest profiles",   "Create/update guest records, ID proofs"),
    ("rooms.read",          "Front Desk",  "View room status",      "Read-only access to rooms grid + tape chart"),
    ("rooms.write",         "Front Desk",  "Update room status",    "Block/unblock rooms, change status manually"),

    # Operational
    ("housekeeping.read",   "Operations", "View housekeeping",     "See housekeeping board"),
    ("housekeeping.write",  "Operations", "Update housekeeping",   "Mark rooms clean/dirty, assign tasks"),
    ("maintenance.read",    "Operations", "View maintenance",      "Browse maintenance tickets"),
    ("maintenance.write",   "Operations", "Manage maintenance",    "Open/close maintenance tickets"),
    ("inventory.read",      "Operations", "View inventory",        "Read-only access to inventory page"),
    ("inventory.write",     "Operations", "Manage inventory",      "Adjust stock counts, receive consumables"),

    # Money
    ("billing.read",        "Billing",    "View folios & invoices", "Read folios, invoices, payment history"),
    ("billing.write",       "Billing",    "Create folios & charges","Post charges, create invoices, receive payments"),
    ("expenses.read",       "Billing",    "View expenses",         "See the expense ledger"),
    ("expenses.write",      "Billing",    "Record expenses",       "Log new expenses, modify entries"),

    # Reporting & misc
    ("reports.view",        "Insights",   "View reports",          "Access reports + KPIs dashboard"),
    ("feedback.read",       "Insights",   "View guest feedback",   "See guest feedback submissions"),
    ("feedback.write",      "Insights",   "Manage feedback",       "Respond to / archive feedback"),
    ("shifts.write",        "Insights",   "Open / close shifts",   "Run cash-drawer shifts"),
]

# Convenience: just the keys, ordered.
PERMISSION_KEYS: List[str] = [p[0] for p in PERMISSION_CATALOG]
PERMISSION_KEY_SET: Set[str] = set(PERMISSION_KEYS)

# Default permission set for legacy staff (NULL `permissions` column).
# Generous — what staff could already do before v3.2 shipped. New staff
# created via the lodge-admin UI start with this set selected, then the
# admin can prune.
LEGACY_STAFF_DEFAULTS: Set[str] = {
    "bookings.read", "bookings.write",
    "checkins.read", "checkins.write",
    "customers.read", "customers.write",
    "rooms.read", "rooms.write",
    "housekeeping.read", "housekeeping.write",
    "maintenance.read", "maintenance.write",
    "billing.read", "billing.write",
    "feedback.read", "feedback.write",
    "shifts.write",
    "reports.view",
}


def parse_permissions(raw: Optional[str]) -> Optional[Set[str]]:
    """Parse the JSON-encoded permissions list from the DB.

    Returns:
      - None when the column is NULL (caller should fall back to defaults)
      - A set of permission keys otherwise (may be empty for explicitly
        zero-permission users)
    """
    if raw is None or raw == "":
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            # Filter to known keys — silently drop stale ones from old releases
            # so removing a permission from the catalog doesn't leave dangling
            # grants that the UI can't manage.
            return {k for k in parsed if isinstance(k, str) and k in PERMISSION_KEY_SET}
    except (ValueError, TypeError):
        logger.warning("Invalid permissions JSON on user; treating as legacy default")
    return None


def serialize_permissions(keys: Iterable[str]) -> str:
    """Validate + JSON-encode for storage. Drops unknown keys."""
    valid = sorted({k for k in keys if isinstance(k, str) and k in PERMISSION_KEY_SET})
    return json.dumps(valid)


def effective_permissions(user: User) -> Set[str]:
    """The full set of permission keys the user effectively has, after
    applying role overrides and legacy defaults. Use for UI display
    (e.g., "what can this user do") rather than per-request checks."""
    if user.role in (UserRole.admin, UserRole.super_admin):
        return set(PERMISSION_KEYS)
    parsed = parse_permissions(user.permissions)
    if parsed is None:
        return set(LEGACY_STAFF_DEFAULTS)
    return parsed


def has_permission(user: User, key: str) -> bool:
    """Single check used by request dependencies."""
    if user.role in (UserRole.admin, UserRole.super_admin):
        return True
    parsed = parse_permissions(user.permissions)
    grants = parsed if parsed is not None else LEGACY_STAFF_DEFAULTS
    return key in grants


def require_permission(key: str):
    """FastAPI dependency factory. Use it like:

        @router.get("/foo", dependencies=[Depends(require_permission("foo.read"))])
        def foo(...): ...

    Or with current_user when the handler needs the user object too:

        @router.post("/foo")
        def foo(current_user = Depends(require_permission("foo.write")), ...):
            ...
    """
    if key not in PERMISSION_KEY_SET:
        # Programmer error — fail loud at import time, not at first request.
        raise ValueError(f"Unknown permission key: {key!r}. "
                         f"Add it to PERMISSION_CATALOG.")

    def _dep(current_user: User = Depends(get_current_user)) -> User:
        if not has_permission(current_user, key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {key}",
            )
        return current_user
    # Give the dep a stable name so OpenAPI / debugging output stays readable.
    _dep.__name__ = f"require_permission__{key.replace('.', '_')}"
    return _dep
