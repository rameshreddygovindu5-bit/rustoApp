"""Loyalty points router.

Public surface:
  GET    /api/loyalty/accounts             — list accounts
  GET    /api/loyalty/accounts/{cust_id}   — one account + history
  POST   /api/loyalty/adjust               — admin manual ± points
  POST   /api/loyalty/redeem               — redeem points for discount
  GET    /api/loyalty/transactions         — recent txns

Helpers (importable):
  earn_for_checkout(db, lodge_id, customer_id, invoice_total, checkin_id, invoice_id)
  recompute_tier(account)
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from ..database import get_db
from ..models import (LoyaltyAccount, LoyaltyTransaction, LoyaltyTxnType,
                      LoyaltyTier, Customer, Setting)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/loyalty", tags=["loyalty"])


# Tier thresholds (lifetime_points). Configurable via settings later.
TIER_THRESHOLDS = [
    (LoyaltyTier.platinum, 15000),
    (LoyaltyTier.gold, 5000),
    (LoyaltyTier.silver, 1000),
    (LoyaltyTier.bronze, 0),
]


def recompute_tier(account: LoyaltyAccount) -> LoyaltyTier:
    """Set account.tier based on lifetime_points. Returns the new tier."""
    for tier, threshold in TIER_THRESHOLDS:
        if (account.lifetime_points or 0) >= threshold:
            account.tier = tier
            return tier
    account.tier = LoyaltyTier.bronze
    return LoyaltyTier.bronze


def _get_or_create_account(db: Session, lodge_id: int, customer_id: int) -> LoyaltyAccount:
    acc = (db.query(LoyaltyAccount)
           .filter(LoyaltyAccount.lodge_id == lodge_id,
                   LoyaltyAccount.customer_id == customer_id).first())
    if not acc:
        acc = LoyaltyAccount(lodge_id=lodge_id, customer_id=customer_id)
        db.add(acc)
        db.flush()
    return acc


def _account_dict(acc: LoyaltyAccount, cust: Optional[Customer] = None) -> dict:
    return {
        "account_id": acc.account_id,
        "customer_id": acc.customer_id,
        "customer_name": (f"{cust.first_name} {cust.last_name}" if cust else None),
        "customer_phone": (cust.phone if cust else None),
        "current_balance": int(acc.current_balance or 0),
        "lifetime_points": int(acc.lifetime_points or 0),
        "tier": getattr(acc.tier, "value", acc.tier),
        "created_at": acc.created_at.isoformat() if acc.created_at else None,
    }


def _txn_dict(t: LoyaltyTransaction) -> dict:
    return {
        "txn_id": t.txn_id,
        "account_id": t.account_id,
        "txn_type": getattr(t.txn_type, "value", t.txn_type),
        "points": int(t.points),
        "reason": t.reason,
        "related_checkin_id": t.related_checkin_id,
        "related_invoice_id": t.related_invoice_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


# ── Read endpoints ─────────────────────────────────────────────────────

@router.get("/accounts")
def list_accounts(tier: Optional[str] = None,
                   min_balance: Optional[int] = None,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(LoyaltyAccount, Customer)
         .join(Customer, Customer.customer_id == LoyaltyAccount.customer_id)
         .filter(LoyaltyAccount.lodge_id == lodge_id)
         .order_by(LoyaltyAccount.lifetime_points.desc()))
    if tier:
        q = q.filter(LoyaltyAccount.tier == tier)
    if min_balance is not None:
        q = q.filter(LoyaltyAccount.current_balance >= min_balance)
    return [_account_dict(a, c) for a, c in q.limit(500).all()]


@router.get("/accounts/{customer_id}")
def get_account(customer_id: int,
                 db: Session = Depends(get_db),
                 current_user=Depends(get_current_user),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    cust = (db.query(Customer)
            .filter(Customer.customer_id == customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")
    acc = (db.query(LoyaltyAccount)
           .filter(LoyaltyAccount.lodge_id == lodge_id,
                   LoyaltyAccount.customer_id == customer_id).first())
    if not acc:
        # Return an empty account shape rather than 404 — guest just hasn't
        # earned anything yet. UI can offer to "open account".
        return {"account": None, "transactions": [], "exists": False}
    txns = (db.query(LoyaltyTransaction)
            .filter(LoyaltyTransaction.account_id == acc.account_id)
            .order_by(LoyaltyTransaction.created_at.desc())
            .limit(100).all())
    return {
        "account": _account_dict(acc, cust),
        "transactions": [_txn_dict(t) for t in txns],
        "exists": True,
    }


@router.get("/transactions")
def list_transactions(limit: int = 100,
                       db: Session = Depends(get_db),
                       current_user=Depends(get_current_user),
                       lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(LoyaltyTransaction)
            .filter(LoyaltyTransaction.lodge_id == lodge_id)
            .order_by(LoyaltyTransaction.created_at.desc())
            .limit(min(limit, 500)).all())
    return [_txn_dict(r) for r in rows]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Tier distribution + total points outstanding."""
    by_tier = {t.value: 0 for t in LoyaltyTier}
    for tier, n in (db.query(LoyaltyAccount.tier, func.count(LoyaltyAccount.account_id))
                     .filter(LoyaltyAccount.lodge_id == lodge_id)
                     .group_by(LoyaltyAccount.tier).all()):
        by_tier[getattr(tier, "value", tier)] = int(n)
    outstanding = int((db.query(func.coalesce(func.sum(LoyaltyAccount.current_balance), 0))
                       .filter(LoyaltyAccount.lodge_id == lodge_id)
                       .scalar()) or 0)
    total_accounts = sum(by_tier.values())
    return {"by_tier": by_tier, "total_accounts": total_accounts,
            "total_points_outstanding": outstanding}


# ── Write endpoints ────────────────────────────────────────────────────

class AdjustRequest(BaseModel):
    customer_id: int
    points: int             # signed: +grant, -clawback
    reason: str


@router.post("/adjust")
def adjust(body: AdjustRequest, request: Request,
            db: Session = Depends(get_db),
            current_user=Depends(require_admin),
            lodge_id: int = Depends(resolve_lodge_scope)):
    if body.points == 0:
        raise HTTPException(status_code=400, detail="points must be non-zero")
    if not body.reason.strip():
        raise HTTPException(status_code=400, detail="reason is required")
    cust = (db.query(Customer)
            .filter(Customer.customer_id == body.customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")

    acc = _get_or_create_account(db, lodge_id, body.customer_id)
    if (acc.current_balance or 0) + body.points < 0:
        raise HTTPException(status_code=400, detail="Adjustment would make balance negative")
    acc.current_balance = (acc.current_balance or 0) + body.points
    # Lifetime only grows from grants (+), not from clawbacks (-).
    if body.points > 0:
        acc.lifetime_points = (acc.lifetime_points or 0) + body.points
        recompute_tier(acc)
    db.add(LoyaltyTransaction(
        lodge_id=lodge_id, account_id=acc.account_id,
        txn_type=LoyaltyTxnType.adjust,
        points=body.points, reason=body.reason.strip()[:300],
        created_by=current_user.user_id,
    ))
    db.commit()
    db.refresh(acc)
    try:
        log_audit(db, "loyalty.adjusted",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="loyalty_account", entity_id=acc.account_id, lodge_id=lodge_id,
                  details={"customer_id": cust.customer_id, "points": body.points,
                           "reason": body.reason, "new_balance": int(acc.current_balance)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _account_dict(acc, cust)


class RedeemRequest(BaseModel):
    customer_id: int
    points: int          # always positive in the request
    reason: Optional[str] = "Redeemed at checkout"


@router.post("/redeem")
def redeem_points(body: RedeemRequest, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Redeem points (caller specifies an integer). 1 point = ₹1 by default.
    Use a setting `loyalty_point_value_rupees` to override."""
    if body.points <= 0:
        raise HTTPException(status_code=400, detail="points must be > 0")
    acc = (db.query(LoyaltyAccount)
           .filter(LoyaltyAccount.lodge_id == lodge_id,
                   LoyaltyAccount.customer_id == body.customer_id).first())
    if not acc:
        raise HTTPException(status_code=404, detail="No loyalty account")
    if (acc.current_balance or 0) < body.points:
        raise HTTPException(status_code=400,
                            detail=f"Insufficient balance ({acc.current_balance} available)")
    acc.current_balance = (acc.current_balance or 0) - body.points
    # Lifetime points are not touched by redemption — they reflect total earned.
    db.add(LoyaltyTransaction(
        lodge_id=lodge_id, account_id=acc.account_id,
        txn_type=LoyaltyTxnType.redeem,
        points=-body.points, reason=body.reason or "Redeemed",
        created_by=current_user.user_id,
    ))
    db.commit()
    db.refresh(acc)

    # Compute the rupee value of the redemption from settings.
    val = (db.query(Setting)
           .filter(Setting.lodge_id == lodge_id,
                   Setting.setting_key == "loyalty_point_value_rupees").first())
    point_value = float(val.setting_value) if val and val.setting_value else 1.0
    return {
        "account": _account_dict(acc),
        "rupees_redeemed": round(body.points * point_value, 2),
    }


# ── Helper for checkout integration ────────────────────────────────────

def earn_for_checkout(db: Session, *, lodge_id: int, customer_id: int,
                       invoice_total: float, checkin_id: int, invoice_id: int) -> Optional[dict]:
    """Auto-award points based on the invoice total. Called from the
    checkout flow. Returns the txn dict or None on failure.

    Default rate: 1 point per ₹100 spent (configurable via setting
    `loyalty_earn_rate_per_100`).
    """
    rate_row = (db.query(Setting)
                .filter(Setting.lodge_id == lodge_id,
                        Setting.setting_key == "loyalty_earn_rate_per_100").first())
    rate = float(rate_row.setting_value) if rate_row and rate_row.setting_value else 1.0
    points = int((invoice_total // 100) * rate)
    if points <= 0:
        return None
    acc = _get_or_create_account(db, lodge_id, customer_id)
    acc.current_balance = (acc.current_balance or 0) + points
    acc.lifetime_points = (acc.lifetime_points or 0) + points
    recompute_tier(acc)
    txn = LoyaltyTransaction(
        lodge_id=lodge_id, account_id=acc.account_id,
        txn_type=LoyaltyTxnType.earn,
        points=points, reason=f"Stay #{checkin_id} (₹{invoice_total:.0f})",
        related_checkin_id=checkin_id, related_invoice_id=invoice_id,
    )
    db.add(txn)
    db.flush()
    return {"points": points, "new_balance": int(acc.current_balance),
            "new_tier": getattr(acc.tier, "value", acc.tier)}
