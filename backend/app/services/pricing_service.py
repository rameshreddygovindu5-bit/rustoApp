"""Pricing tiers + quote calculator for Rusto subscriptions — v7.1.

Three tiers, all priced in INR. The model is:
  - Fixed base fee per month (covers up to the tier's room cap)
  - Per-room fee for rooms above the base allocation
  - Annual billing = 10x monthly (2 months free, equivalent to a 16.7% discount)

A lodge's quote = base + max(0, total_rooms - included_rooms) * per_room_fee.

Plans are intentionally simple so the marketing page is easy to read; we
can introduce custom-quote tiers above 100 rooms later if needed.

The catalog also includes per-tier feature lists for the wizard UI.
"""
from typing import List, Dict, Any
from decimal import Decimal

# Plan catalog. Each entry has:
#   key             — used in DB and API (don't rename casually)
#   name, tagline   — for the UI
#   base_monthly    — fixed monthly fee in INR, covers `included_rooms`
#   included_rooms  — rooms up to this are free under the base fee
#   per_room        — INR/month for each room above included
#   max_rooms       — hard cap. None = no cap (Pro tier).
#   features        — list of feature strings shown in the comparison
#   highlighted     — UI tag for the recommended tier
PLANS: List[Dict[str, Any]] = [
    {
        "key":            "starter",
        "name":           "Starter",
        "tagline":        "For small lodges getting their first taste of digital ops",
        "base_monthly":   1499,
        "included_rooms": 10,
        "per_room":       99,
        "max_rooms":      25,
        "highlighted":    False,
        "features": [
            "Front-desk operations (checkin/checkout, tape chart)",
            "Up to 25 rooms",
            "Customer marketplace listing on Rusto.app",
            "Online bookings with Razorpay payments",
            "Up to 3 staff users",
            "Guest reviews + lodge responses",
            "Email + WhatsApp message log",
            "Daily backups",
            "Email support (24h response)",
        ],
    },
    {
        "key":            "growth",
        "name":           "Growth",
        "tagline":        "For established lodges scaling their operations",
        "base_monthly":   3499,
        "included_rooms": 30,
        "per_room":       79,
        "max_rooms":      75,
        "highlighted":    True,
        "features": [
            "Everything in Starter, plus:",
            "Up to 75 rooms",
            "Unlimited staff users with granular permissions",
            "WhatsApp Business notifications (auto-send confirmations, reminders)",
            "OTA channel manager (Booking.com, MakeMyTrip, Goibibo)",
            "Foreign-guest C-Form automation",
            "GST returns + invoicing",
            "Loyalty program",
            "Custom rate plans + promo codes",
            "Email + chat support (4h response)",
        ],
    },
    {
        "key":            "pro",
        "name":           "Pro",
        "tagline":        "For larger properties and small chains",
        "base_monthly":   6999,
        "included_rooms": 75,
        "per_room":       59,
        "max_rooms":      None,
        "highlighted":    False,
        "features": [
            "Everything in Growth, plus:",
            "Unlimited rooms",
            "AI Operations Agent (natural-language commands)",
            "Multi-property management",
            "Advanced analytics + occupancy forecasting",
            "Custom branded customer site (rusto.app/your-lodge)",
            "API access + webhook integrations",
            "Dedicated onboarding manager",
            "Phone + chat + email support (1h response)",
            "99.9% uptime SLA",
        ],
    },
]

PLANS_BY_KEY: Dict[str, Dict[str, Any]] = {p["key"]: p for p in PLANS}


def calculate_quote(plan_key: str, total_rooms: int,
                     billing_cycle: str = "monthly") -> Dict[str, Any]:
    """Compute a quote for a given plan + room count + billing cycle.

    Returns a dict the frontend can render directly:
      {
        plan: {...catalog entry...},
        total_rooms: int,
        included_rooms: int,
        extra_rooms: int,            # rooms above the included allocation
        monthly_inr: Decimal,         # base + extras
        annual_inr: Decimal,          # monthly × 10  (2 months free)
        billing_cycle: str,
        price_now_inr: Decimal,       # what they'll pay today (annual OR first month)
        savings_vs_monthly_inr: Decimal,  # only meaningful for annual cycle
        warnings: [str],              # human-readable issues (over cap, etc.)
      }

    Returns None if plan_key is invalid.
    """
    plan = PLANS_BY_KEY.get(plan_key)
    if not plan:
        return None
    if total_rooms < 1:
        total_rooms = 1

    warnings = []
    cap = plan["max_rooms"]
    if cap is not None and total_rooms > cap:
        warnings.append(
            f"This lodge has more rooms ({total_rooms}) than the {plan['name']} "
            f"tier supports ({cap} max). Consider upgrading to a higher plan."
        )

    included = plan["included_rooms"]
    extra = max(0, total_rooms - included)
    base = Decimal(plan["base_monthly"])
    per_room = Decimal(plan["per_room"])
    monthly = base + (extra * per_room)
    # Annual = 10 × monthly. So a lodge paying ₹1,499/mo pays ₹14,990/yr
    # (saving 2 months = ₹2,998 vs paying monthly).
    annual = monthly * Decimal(10)

    if billing_cycle == "annual":
        price_now = annual
        savings = (monthly * Decimal(12)) - annual
    else:
        price_now = monthly
        savings = Decimal(0)

    return {
        "plan":           plan,
        "total_rooms":    total_rooms,
        "included_rooms": included,
        "extra_rooms":    extra,
        "monthly_inr":    monthly,
        "annual_inr":     annual,
        "billing_cycle":  billing_cycle,
        "price_now_inr":  price_now,
        "savings_vs_monthly_inr": savings,
        "warnings":       warnings,
    }


def recommend_plan(total_rooms: int) -> str:
    """Suggest a plan based purely on room count. Used by the wizard to
    pre-select a sensible default when the user lands on the plan step."""
    if total_rooms <= 25:
        return "starter"
    if total_rooms <= 75:
        return "growth"
    return "pro"


def serialize_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Public-safe plan dict (no sensitive fields, but currently all
    fields are public so this just normalizes types)."""
    return {
        "key":            plan["key"],
        "name":           plan["name"],
        "tagline":        plan["tagline"],
        "base_monthly":   plan["base_monthly"],
        "included_rooms": plan["included_rooms"],
        "per_room":       plan["per_room"],
        "max_rooms":      plan["max_rooms"],
        "highlighted":    plan["highlighted"],
        "features":       plan["features"],
    }
