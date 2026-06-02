"""Public pricing API — read-only catalog + live quotes.

These endpoints power the onboarding wizard's pricing step. No auth —
prospective lodges browse plans before they have any account.
"""
import logging
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services import pricing_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/public/pricing", tags=["public-pricing"])


@router.get("/plans")
def list_plans():
    """Returns the full plan catalog with features + pricing rules.

    The wizard renders this directly on the pricing step. Plans don't
    change often enough to require pagination."""
    return {"plans": [pricing_service.serialize_plan(p) for p in pricing_service.PLANS]}


@router.get("/quote")
def get_quote(
    plan: Optional[str] = Query(None, description="Plan key (auto-recommended from room count if omitted)"),
    rooms: int = Query(..., ge=1, le=10000),
    cycle: str = Query("monthly", pattern="^(monthly|annual)$"),
):
    """Live quote for a given room count + plan + billing cycle.

    If `plan` is omitted we recommend one based on the room count, so the
    wizard can give a "before you pick" estimate right from the rooms step.
    """
    plan_key = plan or pricing_service.recommend_plan(rooms)
    q = pricing_service.calculate_quote(plan_key, rooms, cycle)
    if not q:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {plan!r}")
    # Decimal → float for JSON.
    return {
        "plan_key":               q["plan"]["key"],
        "plan_name":              q["plan"]["name"],
        "plan":                   pricing_service.serialize_plan(q["plan"]),
        "total_rooms":            q["total_rooms"],
        "included_rooms":         q["included_rooms"],
        "extra_rooms":            q["extra_rooms"],
        "monthly_inr":            float(q["monthly_inr"]),
        "annual_inr":             float(q["annual_inr"]),
        "billing_cycle":          q["billing_cycle"],
        "price_now_inr":          float(q["price_now_inr"]),
        "savings_vs_monthly_inr": float(q["savings_vs_monthly_inr"]),
        "warnings":               q["warnings"],
        "is_recommended":         (plan is None),
    }
