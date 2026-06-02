"""Promo / discount codes router.

Exposes a `validate_and_compute_discount(code, subtotal)` helper used by
the checkout flow to apply the discount automatically. Also surfaces the
admin-facing CRUD.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal

from ..database import get_db
from ..models import PromoCode, PromoRedemption, PromoDiscountType
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/promos", tags=["promos"])


def _to_dict(p: PromoCode) -> dict:
    return {
        "promo_id": p.promo_id,
        "code": p.code,
        "description": p.description,
        "discount_type": getattr(p.discount_type, "value", p.discount_type),
        "discount_value": float(p.discount_value),
        "max_discount_amount": float(p.max_discount_amount) if p.max_discount_amount is not None else None,
        "amount_min": float(p.amount_min or 0),
        "valid_from": p.valid_from.isoformat() if p.valid_from else None,
        "valid_to": p.valid_to.isoformat() if p.valid_to else None,
        "max_uses": p.max_uses,
        "times_used": int(p.times_used or 0),
        "is_active": bool(p.is_active),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("")
def list_promos(active_only: bool = False,
                 db: Session = Depends(get_db),
                 current_user=Depends(get_current_user),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(PromoCode)
         .filter(PromoCode.lodge_id == lodge_id)
         .order_by(PromoCode.created_at.desc()))
    if active_only:
        q = q.filter(PromoCode.is_active == True)
    return [_to_dict(p) for p in q.all()]


class PromoCreate(BaseModel):
    code: str
    description: Optional[str] = None
    discount_type: str = "percent"
    discount_value: float
    max_discount_amount: Optional[float] = None
    amount_min: float = 0
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: Optional[int] = None
    is_active: bool = True


@router.post("")
def create_promo(body: PromoCreate, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    if body.discount_type not in {t.value for t in PromoDiscountType}:
        raise HTTPException(status_code=400, detail="Invalid discount_type")
    if body.discount_value <= 0:
        raise HTTPException(status_code=400, detail="discount_value must be > 0")
    code = body.code.strip().upper()
    if not code or len(code) < 2:
        raise HTTPException(status_code=400, detail="code too short")
    # Per-lodge unique code — the index enforces this but we want a nice error.
    clash = (db.query(PromoCode)
             .filter(PromoCode.lodge_id == lodge_id,
                     PromoCode.code == code).first())
    if clash:
        raise HTTPException(status_code=400, detail=f"Code '{code}' already exists")

    p = PromoCode(
        lodge_id=lodge_id, code=code,
        description=body.description,
        discount_type=body.discount_type,
        discount_value=Decimal(str(body.discount_value)),
        max_discount_amount=(Decimal(str(body.max_discount_amount))
                              if body.max_discount_amount is not None else None),
        amount_min=Decimal(str(body.amount_min or 0)),
        valid_from=body.valid_from, valid_to=body.valid_to,
        max_uses=body.max_uses, is_active=body.is_active,
        created_by=current_user.user_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    try:
        log_audit(db, "promo.created",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="promo_code", entity_id=p.promo_id, lodge_id=lodge_id,
                  details={"code": code, "type": body.discount_type, "value": float(body.discount_value)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(p)


class PromoUpdate(BaseModel):
    description: Optional[str] = None
    discount_value: Optional[float] = None
    max_discount_amount: Optional[float] = None
    amount_min: Optional[float] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: Optional[int] = None
    is_active: Optional[bool] = None


@router.patch("/{promo_id}")
def update_promo(promo_id: int, body: PromoUpdate, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    p = (db.query(PromoCode)
         .filter(PromoCode.promo_id == promo_id,
                 PromoCode.lodge_id == lodge_id).first())
    if not p:
        raise HTTPException(status_code=404, detail="Promo not found")
    fields = body.dict(exclude_unset=True)
    for k, v in fields.items():
        if k in ("discount_value", "max_discount_amount", "amount_min") and v is not None:
            setattr(p, k, Decimal(str(v)))
        else:
            setattr(p, k, v)
    db.commit()
    db.refresh(p)
    try:
        log_audit(db, "promo.updated",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="promo_code", entity_id=p.promo_id, lodge_id=lodge_id,
                  details={"changed": list(fields.keys())},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(p)


@router.delete("/{promo_id}")
def delete_promo(promo_id: int, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(require_admin),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    p = (db.query(PromoCode)
         .filter(PromoCode.promo_id == promo_id,
                 PromoCode.lodge_id == lodge_id).first())
    if not p:
        raise HTTPException(status_code=404, detail="Promo not found")
    code = p.code
    db.delete(p)
    db.commit()
    try:
        log_audit(db, "promo.deleted",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="promo_code", entity_id=promo_id, lodge_id=lodge_id,
                  details={"code": code},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True}


# ── Validation / redemption ────────────────────────────────────────────

def validate_and_compute_discount(db: Session, lodge_id: int, code: str,
                                    subtotal: float) -> dict:
    """Validate a promo code against the current state and compute the
    discount amount. Raises HTTPException on any validation failure.
    Returns dict with `promo_id`, `discount_amount`, `code`.

    Importable from checkins.py to apply codes at checkout.
    """
    code = (code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Promo code is required")
    p = (db.query(PromoCode)
         .filter(PromoCode.lodge_id == lodge_id,
                 PromoCode.code == code,
                 PromoCode.is_active == True).first())
    if not p:
        raise HTTPException(status_code=404, detail="Promo code not found or inactive")
    today = date.today()
    if p.valid_from and today < p.valid_from:
        raise HTTPException(status_code=400, detail="Promo code not yet valid")
    if p.valid_to and today > p.valid_to:
        raise HTTPException(status_code=400, detail="Promo code has expired")
    if p.max_uses is not None and (p.times_used or 0) >= p.max_uses:
        raise HTTPException(status_code=400, detail="Promo code usage limit reached")
    if float(p.amount_min or 0) > subtotal:
        raise HTTPException(
            status_code=400,
            detail=f"Promo requires minimum bill of ₹{float(p.amount_min):.2f}")

    # Compute the discount amount.
    if p.discount_type == PromoDiscountType.percent or \
       getattr(p.discount_type, "value", p.discount_type) == "percent":
        discount = subtotal * float(p.discount_value) / 100
        if p.max_discount_amount is not None:
            discount = min(discount, float(p.max_discount_amount))
    else:
        discount = float(p.discount_value)
    discount = min(discount, subtotal)               # never exceed subtotal
    return {
        "promo_id": p.promo_id,
        "code": p.code,
        "discount_amount": round(discount, 2),
    }


class ValidateRequest(BaseModel):
    code: str
    subtotal: float


@router.post("/validate")
def validate(body: ValidateRequest,
              db: Session = Depends(get_db),
              current_user=Depends(get_current_user),
              lodge_id: int = Depends(resolve_lodge_scope)):
    """Preview a code's discount without redeeming it — used by the
    checkout dialog as the user types a code."""
    return validate_and_compute_discount(db, lodge_id, body.code, body.subtotal)


def redeem(db: Session, *, lodge_id: int, code: str, subtotal: float,
            checkin_id: Optional[int] = None,
            invoice_id: Optional[int] = None,
            customer_id: Optional[int] = None) -> dict:
    """Validate, then atomically: bump times_used + log a PromoRedemption.
    Caller is responsible for `db.commit()` (we add to the session but
    don't commit here so this can run inside the checkout transaction).
    """
    info = validate_and_compute_discount(db, lodge_id, code, subtotal)
    p = (db.query(PromoCode)
         .filter(PromoCode.promo_id == info["promo_id"]).first())
    p.times_used = (p.times_used or 0) + 1
    db.add(PromoRedemption(
        lodge_id=lodge_id, promo_id=p.promo_id,
        checkin_id=checkin_id, invoice_id=invoice_id,
        customer_id=customer_id,
        discount_amount=Decimal(str(info["discount_amount"])),
        code_snapshot=p.code,
    ))
    return info
