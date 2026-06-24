"""
plan_module_gates.py — SaaS RBAC: plan-level feature gating

Each plan unlocks a specific set of modules. No lodge admin can enable
a module their plan doesn't include, no matter what.

This is the SINGLE source of truth for what features each plan allows.
Sync any changes here with the frontend's planModules.js.

Hierarchy:
  super_admin  → can see everything, switch any lodge's plan
  admin        → can enable/disable modules within their plan's allowed set
  staff        → can only access modules the admin has explicitly enabled
                 AND has the fine-grained permissions for
"""
from typing import Set, Dict, List

# ── Plan → module set ─────────────────────────────────────────────────────────
# Keys match pricing_service.PLANS keys ('starter', 'growth', 'pro')
# and ALL_MODULES keys in moduleConfig.js.
PLAN_MODULE_GATES: Dict[str, Set[str]] = {
    "starter": {
        # Core (always)
        "front_desk",
        "rooms",
        # Basic operations
        "housekeeping",
        "maintenance",
        # Basic guest
        "guests",
        "feedback",
        "alerts",
        # Marketplace
        "rusto_marketplace",
    },
    "growth": {
        # Everything in starter
        "front_desk",
        "rooms",
        "housekeeping",
        "maintenance",
        "inventory",
        "shifts",
        "guests",
        "loyalty",
        "foreign_guests",
        "feedback",
        "alerts",
        # Marketing
        "marketing",
        "whatsapp",
        "ota",
        # Finance
        "expenses",
        "reports",
        "agencies",
        # Specialty
        "group_bookings",
        # Marketplace
        "rusto_marketplace",
    },
    "pro": {
        # Everything in growth
        "front_desk",
        "rooms",
        "housekeeping",
        "maintenance",
        "inventory",
        "shifts",
        "guests",
        "loyalty",
        "foreign_guests",
        "feedback",
        "alerts",
        "marketing",
        "whatsapp",
        "ota",
        "expenses",
        "reports",
        "agencies",
        "group_bookings",
        # Pro-exclusive
        "ai_agent",
        "conference_events",
        "restaurant",
        "spa_wellness",
        # Marketplace
        "rusto_marketplace",
    },
    # Trial / no subscription — minimal access, still usable for eval
    "trial": {
        "front_desk",
        "rooms",
        "housekeeping",
        "guests",
        "rusto_marketplace",
    },
}

# Super-admin sees everything. The set below is used for informational
# display only (to show them what "pro" offers, etc.)
ALL_MODULE_IDS = (
    PLAN_MODULE_GATES["pro"]
    | {"restaurant", "spa_wellness", "conference_events"}
)

# Modules that are ALWAYS enabled regardless of plan (cannot be disabled)
CORE_MODULES: Set[str] = {"front_desk", "rooms"}


def get_allowed_modules(plan_key: str) -> Set[str]:
    """Return the set of module IDs that this plan allows.
    
    Falls back to 'starter' if plan_key is unknown.
    Always includes CORE_MODULES.
    """
    allowed = PLAN_MODULE_GATES.get(plan_key, PLAN_MODULE_GATES["starter"])
    return allowed | CORE_MODULES


def filter_to_plan(enabled_set: Set[str], plan_key: str) -> Set[str]:
    """Intersect an admin's chosen module set with what their plan allows.
    
    This is called before writing enabled_modules to settings so an admin
    can never persist a module they haven't paid for.
    """
    return enabled_set & get_allowed_modules(plan_key)


def plan_allows_module(plan_key: str, module_id: str) -> bool:
    """Quick check: does this plan include this module?"""
    return module_id in get_allowed_modules(plan_key)


# ── Staff permission → module association ─────────────────────────────────────
# Maps permission group label → module IDs it belongs to.
# Used to auto-enable modules when an admin grants a staff permission.
PERMISSION_GROUP_TO_MODULES: Dict[str, List[str]] = {
    "Front Desk":  ["front_desk", "rooms"],
    "Operations":  ["housekeeping", "maintenance", "inventory", "shifts"],
    "Billing":     ["expenses", "reports"],
    "Insights":    ["reports"],
}
