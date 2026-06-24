"""Rusto Customer Membership & Rewards — v12.

Membership tiers: Explorer → Silver → Gold → Elite
Points: 1 pt per ₹100 spent. 100 pts = ₹50 discount (min redemption).

Endpoints (all customer-authenticated):
  GET    /api/rusto/membership          — my membership card
  POST   /api/rusto/membership/redeem   — redeem points at checkout
  GET    /api/rusto/membership/ledger   — points history
  POST   /api/rusto/membership/referral — apply referral code at signup
  GET    /api/rusto/membership/perks    — tier perks catalogue

Internal helpers (called from rusto_bookings on checkout completion):
  post_booking_points(db, customer_id, booking_id, amount_inr)
"""
import logging
import secrets
import string
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..database import get_db
from ..models import (RustoMembership, RustoPointsLedger,
                       RustoCustomer, CustomerBooking, CustomerBookingStatus)
from ..rusto_auth import get_current_customer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rusto/membership", tags=["rusto-membership"])

# ── Tier configuration ──────────────────────────────────────────────

TIER_CFG = {
    "explorer": {
        "label":        "Explorer",
        "icon":         "🌱",
        "color":        "#7C8A9A",
        "min_stays":    0,
        "min_spent":    0,
        "perks": [
            "Access to all verified Rusto properties",
            "Instant booking confirmation",
            "Earn 1 point per ₹100 spent",
            "24/7 in-app support",
        ],
    },
    "silver": {
        "label":        "Silver",
        "icon":         "🥈",
        "color":        "#A0A8B0",
        "min_stays":    2,
        "min_spent":    5000,
        "perks": [
            "All Explorer perks",
            "Early access to new properties (48h ahead)",
            "5% bonus points on every stay",
            "Free cancellation window extended to 48h",
            "Complimentary late check-out (on request)",
        ],
    },
    "gold": {
        "label":        "Gold",
        "icon":         "🥇",
        "color":        "#C9A84C",
        "min_stays":    5,
        "min_spent":    15000,
        "perks": [
            "All Silver perks",
            "Early access to new properties (7 days ahead)",
            "10% bonus points on every stay",
            "Room upgrade on availability",
            "Dedicated WhatsApp concierge during stay",
            "Free breakfast on select properties",
        ],
    },
    "elite": {
        "label":        "Elite",
        "icon":         "👑",
        "color":        "#D4AF37",
        "min_stays":    10,
        "min_spent":    50000,
        "perks": [
            "All Gold perks",
            "Priority access to exclusive villa releases",
            "Guaranteed 20% off best available rate",
            "Personal travel curator (WhatsApp direct line)",
            "Complimentary room upgrades guaranteed",
            "Spa credits at premium partner properties",
            "Referral bonus: 500 pts per successful referral",
        ],
    },
}

POINTS_PER_100 = 1        # 1 point per ₹100 spent
POINT_VALUE    = 0.50     # 1 point = ₹0.50 (so 100 pts = ₹50)
MIN_REDEEM     = 100      # minimum points to redeem


def _compute_tier(stays: int, spent: float) -> str:
    """Compute tier from lifetime stats."""
    if stays >= TIER_CFG["elite"]["min_stays"] or spent >= TIER_CFG["elite"]["min_spent"]:
        return "elite"
    if stays >= TIER_CFG["gold"]["min_stays"] or spent >= TIER_CFG["gold"]["min_spent"]:
        return "gold"
    if stays >= TIER_CFG["silver"]["min_stays"] or spent >= TIER_CFG["silver"]["min_spent"]:
        return "silver"
    return "explorer"


def _gen_referral_code(db: Session) -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(20):
        code = "RUSTO-" + "".join(secrets.choice(chars) for _ in range(6))
        exists = db.query(RustoMembership).filter(
            RustoMembership.referral_code == code).first()
        if not exists:
            return code
    return "RUSTO-" + secrets.token_hex(4).upper()


def _get_or_create_membership(db: Session, customer_id: int) -> RustoMembership:
    """Get or create the membership record for a customer."""
    m = db.query(RustoMembership).filter(
        RustoMembership.customer_id == customer_id).first()
    if not m:
        # Count existing bookings to seed stats
        stays = db.query(func.count(CustomerBooking.booking_id)).filter(
            CustomerBooking.customer_id == customer_id,
            CustomerBooking.status.in_([
                CustomerBookingStatus.checked_out.value,
                CustomerBookingStatus.checked_in.value,
            ])
        ).scalar() or 0

        spent_row = db.query(func.sum(CustomerBooking.total_amount)).filter(
            CustomerBooking.customer_id == customer_id,
            CustomerBooking.status.in_([
                CustomerBookingStatus.confirmed.value,
                CustomerBookingStatus.checked_in.value,
                CustomerBookingStatus.checked_out.value,
            ])
        ).scalar() or 0

        tier = _compute_tier(stays, float(spent_row))
        m = RustoMembership(
            customer_id=customer_id,
            tier=tier,
            rusto_points=stays * 50,     # seed legacy points
            lifetime_points=stays * 50,
            lifetime_spent_inr=float(spent_row),
            total_stays=stays,
            referral_code=_gen_referral_code(db),
        )
        db.add(m)
        db.commit()
        db.refresh(m)
    return m


def _membership_dict(m: RustoMembership, customer: RustoCustomer) -> dict:
    cfg = TIER_CFG.get(m.tier, TIER_CFG["explorer"])
    next_tier_key = {"explorer": "silver", "silver": "gold", "gold": "elite"}.get(m.tier)
    next_cfg = TIER_CFG.get(next_tier_key) if next_tier_key else None

    # Progress to next tier
    progress = None
    if next_cfg:
        stays_needed = max(0, next_cfg["min_stays"] - m.total_stays)
        spent_needed = max(0, next_cfg["min_spent"] - float(m.lifetime_spent_inr))
        progress = {
            "next_tier": next_tier_key,
            "next_tier_label": next_cfg["label"],
            "stays_needed": stays_needed,
            "spent_needed": spent_needed,
            "stays_pct": min(100, round(100 * m.total_stays / next_cfg["min_stays"])) if next_cfg["min_stays"] else 100,
            "spent_pct": min(100, round(100 * float(m.lifetime_spent_inr) / next_cfg["min_spent"])) if next_cfg["min_spent"] else 100,
        }

    return {
        "membership_id":      m.membership_id,
        "customer_id":        m.customer_id,
        "customer_name":      customer.full_name,
        "customer_phone":     customer.phone,
        "tier":               m.tier,
        "tier_label":         cfg["label"],
        "tier_icon":          cfg["icon"],
        "tier_color":         cfg["color"],
        "perks":              cfg["perks"],
        "rusto_points":       m.rusto_points,
        "lifetime_points":    m.lifetime_points,
        "lifetime_spent_inr": float(m.lifetime_spent_inr),
        "total_stays":        m.total_stays,
        "referral_code":      m.referral_code,
        "referral_credits":   m.referral_credits,
        "point_value_inr":    POINT_VALUE,
        "min_redeem_points":  MIN_REDEEM,
        "max_redeem_value":   round(m.rusto_points * POINT_VALUE, 2),
        "progress":           progress,
        "member_since":       m.created_at.isoformat() if m.created_at else None,
        "all_tiers":          [
            {"key": k, "label": v["label"], "icon": v["icon"], "color": v["color"],
             "min_stays": v["min_stays"], "min_spent": v["min_spent"]}
            for k, v in TIER_CFG.items()
        ],
    }


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("")
def get_my_membership(db: Session = Depends(get_db),
                       customer=Depends(get_current_customer)):
    m = _get_or_create_membership(db, customer.customer_id)
    return _membership_dict(m, customer)


@router.get("/ledger")
def get_ledger(limit: int = 50, db: Session = Depends(get_db),
               customer=Depends(get_current_customer)):
    m = _get_or_create_membership(db, customer.customer_id)
    rows = db.query(RustoPointsLedger).filter(
        RustoPointsLedger.membership_id == m.membership_id
    ).order_by(RustoPointsLedger.created_at.desc()).limit(limit).all()
    return {
        "balance": m.rusto_points,
        "ledger": [
            {
                "ledger_id":   r.ledger_id,
                "points":      r.points,
                "txn_type":    r.txn_type,
                "description": r.description,
                "booking_id":  r.booking_id,
                "created_at":  r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


class RedeemBody(BaseModel):
    points: int = Field(..., ge=MIN_REDEEM, description="Points to redeem (min 100)")
    booking_id: Optional[int] = None


@router.post("/redeem")
def redeem_points(body: RedeemBody, db: Session = Depends(get_db),
                  customer=Depends(get_current_customer)):
    m = _get_or_create_membership(db, customer.customer_id)
    if m.rusto_points < body.points:
        raise HTTPException(400, f"Insufficient points. You have {m.rusto_points} pts.")
    if body.points < MIN_REDEEM:
        raise HTTPException(400, f"Minimum redemption is {MIN_REDEEM} points.")

    discount_inr = round(body.points * POINT_VALUE, 2)
    m.rusto_points -= body.points
    db.add(RustoPointsLedger(
        membership_id=m.membership_id,
        customer_id=customer.customer_id,
        points=-body.points,
        txn_type="redeem",
        booking_id=body.booking_id,
        description=f"Redeemed {body.points} pts = ₹{discount_inr} discount",
    ))
    db.commit()
    return {"redeemed_points": body.points, "discount_inr": discount_inr,
            "remaining_points": m.rusto_points}


class ReferralBody(BaseModel):
    referral_code: str = Field(..., min_length=5, max_length=20)


@router.post("/apply-referral")
def apply_referral(body: ReferralBody, db: Session = Depends(get_db),
                   customer=Depends(get_current_customer)):
    m = _get_or_create_membership(db, customer.customer_id)
    if m.referred_by_code:
        raise HTTPException(400, "You have already used a referral code.")

    # Find referrer
    referrer = db.query(RustoMembership).filter(
        RustoMembership.referral_code == body.referral_code.upper().strip()
    ).first()
    if not referrer:
        raise HTTPException(404, "Invalid referral code.")
    if referrer.customer_id == customer.customer_id:
        raise HTTPException(400, "You cannot use your own referral code.")

    REFERRAL_BONUS_NEW      = 200   # new customer gets 200 pts
    REFERRAL_BONUS_REFERRER = 500   # referrer gets 500 pts (elite gives more)
    if referrer.tier == "elite":
        REFERRAL_BONUS_REFERRER = 750

    # Credit new customer
    m.rusto_points    += REFERRAL_BONUS_NEW
    m.lifetime_points += REFERRAL_BONUS_NEW
    m.referred_by_code = body.referral_code.upper().strip()
    db.add(RustoPointsLedger(
        membership_id=m.membership_id, customer_id=customer.customer_id,
        points=REFERRAL_BONUS_NEW, txn_type="referral",
        description=f"Referral bonus — welcome gift from code {m.referred_by_code}",
    ))

    # Credit referrer
    referrer.rusto_points    += REFERRAL_BONUS_REFERRER
    referrer.lifetime_points += REFERRAL_BONUS_REFERRER
    referrer.referral_credits += 1
    db.add(RustoPointsLedger(
        membership_id=referrer.membership_id, customer_id=referrer.customer_id,
        points=REFERRAL_BONUS_REFERRER, txn_type="referral",
        description=f"Referral reward — your friend joined Rusto!",
    ))
    db.commit()
    return {
        "success": True,
        "bonus_points": REFERRAL_BONUS_NEW,
        "message": f"Referral applied! You received {REFERRAL_BONUS_NEW} bonus points.",
    }


@router.get("/perks")
def all_tier_perks():
    """Full perks catalogue for all tiers — public, no auth needed."""
    return {"tiers": TIER_CFG}


# ── Internal: called on booking completion ───────────────────────────

def post_booking_points(db: Session, customer_id: int, booking_id: int,
                         amount_inr: float) -> dict:
    """Award points after a booking is confirmed/paid.

    Called by rusto_bookings.py after payment verification.
    Returns points awarded.
    """
    m = _get_or_create_membership(db, customer_id)

    # Base points
    base_pts = int(amount_inr / 100) * POINTS_PER_100

    # Tier bonus
    tier_bonus = {"silver": 0.05, "gold": 0.10, "elite": 0.15}.get(m.tier, 0)
    bonus_pts  = int(base_pts * tier_bonus)
    total_pts  = base_pts + bonus_pts

    # Update membership
    m.rusto_points       += total_pts
    m.lifetime_points    += total_pts
    m.lifetime_spent_inr += amount_inr
    m.total_stays        += 1

    # Re-evaluate tier
    new_tier = _compute_tier(m.total_stays, float(m.lifetime_spent_inr))
    tier_upgraded = new_tier != m.tier
    m.tier = new_tier

    db.add(RustoPointsLedger(
        membership_id=m.membership_id,
        customer_id=customer_id,
        points=total_pts,
        txn_type="earn",
        booking_id=booking_id,
        description=(f"Stay reward: {base_pts} pts"
                     + (f" + {bonus_pts} {m.tier} bonus" if bonus_pts else "")),
    ))
    db.commit()
    return {
        "points_awarded": total_pts,
        "new_balance":    m.rusto_points,
        "tier":           m.tier,
        "tier_upgraded":  tier_upgraded,
    }
