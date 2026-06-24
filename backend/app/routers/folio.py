"""Folio charges router — itemized extras on a live check-in.

Lifecycle: while a check-in is `active`, staff can POST line items
("Food — 2 plates @ ₹250"). At checkout, the sum of non-voided folio
charges is rolled into `Checkin.additional_charges` so the existing
checkout/invoice flow stays correct.

Voiding a charge keeps the row (for audit) but excludes it from the total.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal

from ..database import get_db
from ..models import FolioCharge, FolioChargeCategory, Checkin, CheckinStatus
from ..auth import get_current_user, resolve_lodge_scope
from ..permissions import require_permission
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/folio", tags=["folio"])


def _to_dict(c: FolioCharge) -> dict:
    return {
        "charge_id": c.charge_id,
        "checkin_id": c.checkin_id,
        "category": getattr(c.category, "value", c.category),
        "description": c.description,
        "quantity": float(c.quantity) if c.quantity is not None else 1,
        "unit_price": float(c.unit_price),
        "amount": float(c.amount),
        "voided": bool(c.voided),
        "voided_reason": c.voided_reason,
        "created_by": c.created_by,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _ensure_active_checkin(db: Session, checkin_id: int, lodge_id: int) -> Checkin:
    ch = (db.query(Checkin)
          .filter(Checkin.checkin_id == checkin_id,
                  Checkin.lodge_id == lodge_id).first())
    if not ch:
        raise HTTPException(status_code=404, detail="Check-in not found")
    if ch.status != CheckinStatus.active:
        raise HTTPException(status_code=400,
                            detail="Cannot modify folio for a checked-out stay")
    return ch


@router.get("/checkin/{checkin_id}", dependencies=[Depends(require_permission("billing.read"))])
def list_for_checkin(checkin_id: int,
                     db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    """All folio rows (including voided) for a check-in, plus the live total."""
    ch = (db.query(Checkin)
          .filter(Checkin.checkin_id == checkin_id,
                  Checkin.lodge_id == lodge_id).first())
    if not ch:
        raise HTTPException(status_code=404, detail="Check-in not found")
    rows = (db.query(FolioCharge)
            .filter(FolioCharge.checkin_id == checkin_id,
                    FolioCharge.lodge_id == lodge_id)
            .order_by(FolioCharge.created_at.asc()).all())
    total = sum(float(r.amount) for r in rows if not r.voided)
    return {"checkin_id": checkin_id, "total": total, "items": [_to_dict(r) for r in rows]}


class ChargeCreate(BaseModel):
    category: str = "other"
    description: str
    quantity: float = 1
    unit_price: float


@router.post("/checkin/{checkin_id}", dependencies=[Depends(require_permission("billing.write"))])
def add_charge(checkin_id: int, body: ChargeCreate, request: Request,
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    ch = _ensure_active_checkin(db, checkin_id, lodge_id)
    if body.category not in {c.value for c in FolioChargeCategory}:
        raise HTTPException(status_code=400, detail="Invalid category")
    if body.unit_price < 0 or body.quantity <= 0:
        raise HTTPException(status_code=400,
                            detail="quantity > 0 and unit_price >= 0")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="description is required")

    # amount is server-computed to prevent client tampering.
    amount = Decimal(str(round(body.quantity * body.unit_price, 2)))
    row = FolioCharge(
        lodge_id=lodge_id, checkin_id=checkin_id,
        category=body.category,
        description=body.description.strip()[:200],
        quantity=Decimal(str(body.quantity)),
        unit_price=Decimal(str(body.unit_price)),
        amount=amount,
        created_by=current_user.user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    try:
        log_audit(db, "folio.added",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="folio_charge", entity_id=row.charge_id,
                  lodge_id=lodge_id,
                  details={"checkin_id": checkin_id,
                           "category": body.category,
                           "amount": float(amount),
                           "description": row.description},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(row)


class VoidRequest(BaseModel):
    reason: str


@router.patch("/{charge_id}/void", dependencies=[Depends(require_permission("billing.delete"))])
def void_charge(charge_id: int, body: VoidRequest, request: Request,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    row = (db.query(FolioCharge)
           .filter(FolioCharge.charge_id == charge_id,
                   FolioCharge.lodge_id == lodge_id).first())
    if not row:
        raise HTTPException(status_code=404, detail="Charge not found")
    if row.voided:
        raise HTTPException(status_code=400, detail="Charge already voided")
    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="A void reason is required")
    # Only allow voiding while the check-in is still active; once checked out
    # the totals are frozen on the invoice and we shouldn't silently change them.
    ch = db.query(Checkin).filter(Checkin.checkin_id == row.checkin_id).first()
    if ch and ch.status != CheckinStatus.active:
        raise HTTPException(status_code=400,
                            detail="Cannot void a charge after checkout — issue a credit note instead")
    row.voided = True
    row.voided_reason = body.reason.strip()[:200]
    db.commit()
    db.refresh(row)
    try:
        log_audit(db, "folio.voided",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="folio_charge", entity_id=row.charge_id,
                  lodge_id=lodge_id,
                  details={"reason": row.voided_reason,
                           "amount": float(row.amount)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(row)


# Helper used by the checkout flow to roll up the folio total into the
# legacy `Checkin.additional_charges` field. Importable from checkins.py.
def total_for_checkin(db: Session, checkin_id: int, lodge_id: int) -> float:
    val = (db.query(func.coalesce(func.sum(FolioCharge.amount), 0))
           .filter(FolioCharge.checkin_id == checkin_id,
                   FolioCharge.lodge_id == lodge_id,
                   FolioCharge.voided == False)
           .scalar())
    return float(val or 0)
