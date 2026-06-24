"""Rate plans router — seasonal / weekend / promotional pricing.

Exposes a `resolve_tariff(room_type, base_tariff, date)` helper used by
bookings + check-ins at create time to compute the effective room price
after all active rate plans are applied.

The CRUD here lets admins manage rate plans. The Bookings/Check-ins code
imports `resolve_tariff` for live pricing.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from pydantic import BaseModel
from typing import Optional, List
from datetime import date
from decimal import Decimal

from ..database import get_db
from ..models import RatePlan, RatePlanAdjustmentType
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/rate-plans", tags=["rate-plans"])


def _to_dict(p: RatePlan) -> dict:
    return {
        "plan_id": p.plan_id,
        "name": p.name,
        "description": p.description,
        "room_type": p.room_type,
        "day_of_week_mask": int(p.day_of_week_mask) if p.day_of_week_mask is not None else None,
        "valid_from": p.valid_from.isoformat() if p.valid_from else None,
        "valid_to": p.valid_to.isoformat() if p.valid_to else None,
        "adjustment_type": getattr(p.adjustment_type, "value", p.adjustment_type),
        "adjustment_value": float(p.adjustment_value),
        "priority": int(p.priority or 10),
        "is_active": bool(p.is_active),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("")
def list_plans(active_only: bool = False,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(RatePlan)
         .filter(RatePlan.lodge_id == lodge_id)
         .order_by(RatePlan.priority.asc(), RatePlan.plan_id.asc()))
    if active_only:
        q = q.filter(RatePlan.is_active == True)
    return [_to_dict(p) for p in q.all()]


class PlanCreate(BaseModel):
    name: str
    description: Optional[str] = None
    room_type: Optional[str] = None
    day_of_week_mask: Optional[int] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    adjustment_type: str = "percent"
    adjustment_value: float
    priority: int = 10
    is_active: bool = True


@router.post("")
def create_plan(body: PlanCreate, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_admin),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    if body.adjustment_type not in {t.value for t in RatePlanAdjustmentType}:
        raise HTTPException(status_code=400, detail="Invalid adjustment_type")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    if body.day_of_week_mask is not None and (body.day_of_week_mask < 0 or body.day_of_week_mask > 127):
        raise HTTPException(status_code=400, detail="day_of_week_mask must be 0-127")
    if body.valid_from and body.valid_to and body.valid_to < body.valid_from:
        raise HTTPException(status_code=400, detail="valid_to must be >= valid_from")

    p = RatePlan(
        lodge_id=lodge_id, name=body.name.strip()[:120],
        description=body.description,
        room_type=(body.room_type or None),
        day_of_week_mask=body.day_of_week_mask,
        valid_from=body.valid_from, valid_to=body.valid_to,
        adjustment_type=body.adjustment_type,
        adjustment_value=Decimal(str(body.adjustment_value)),
        priority=int(body.priority),
        is_active=bool(body.is_active),
        created_by=current_user.user_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    try:
        log_audit(db, "rate_plan.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="rate_plan", entity_id=p.plan_id,
                  lodge_id=lodge_id,
                  details={"name": p.name, "type": body.adjustment_type,
                           "value": float(body.adjustment_value)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(p)


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    room_type: Optional[str] = None
    day_of_week_mask: Optional[int] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    adjustment_type: Optional[str] = None
    adjustment_value: Optional[float] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


@router.patch("/{plan_id}")
def update_plan(plan_id: int, body: PlanUpdate, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_admin),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    p = (db.query(RatePlan)
         .filter(RatePlan.plan_id == plan_id,
                 RatePlan.lodge_id == lodge_id).first())
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    fields = body.model_dump(exclude_unset=True)
    if "adjustment_type" in fields:
        if fields["adjustment_type"] not in {t.value for t in RatePlanAdjustmentType}:
            raise HTTPException(status_code=400, detail="Invalid adjustment_type")
        p.adjustment_type = fields["adjustment_type"]
    if "adjustment_value" in fields:
        p.adjustment_value = Decimal(str(fields["adjustment_value"]))
    for k in ("name", "description", "room_type", "day_of_week_mask",
              "valid_from", "valid_to", "priority", "is_active"):
        if k in fields:
            setattr(p, k, fields[k])
    db.commit()
    db.refresh(p)
    try:
        log_audit(db, "rate_plan.updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="rate_plan", entity_id=p.plan_id,
                  lodge_id=lodge_id, details={"changed": list(fields.keys())},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(p)


@router.delete("/{plan_id}")
def delete_plan(plan_id: int, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_admin),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    p = (db.query(RatePlan)
         .filter(RatePlan.plan_id == plan_id,
                 RatePlan.lodge_id == lodge_id).first())
    if not p:
        raise HTTPException(status_code=404, detail="Plan not found")
    name = p.name
    db.delete(p)
    db.commit()
    try:
        log_audit(db, "rate_plan.deleted",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="rate_plan", entity_id=plan_id,
                  lodge_id=lodge_id, details={"name": name},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True}


# ── Pricing resolver ────────────────────────────────────────────────────
# Used both by the preview endpoint below and (via direct import) by
# booking/check-in code that wants to honour rate plans automatically.

def resolve_tariff(db: Session, lodge_id: int, room_type: Optional[str],
                    base_tariff: float, target_date: date) -> dict:
    """Apply every active rate plan that matches `(room_type, target_date)`
    to `base_tariff`. Returns a dict with the resolved price + breakdown
    of which plans contributed."""
    # Pull active plans for this lodge, ordered by priority (low first).
    plans = (db.query(RatePlan)
             .filter(RatePlan.lodge_id == lodge_id,
                     RatePlan.is_active == True)
             .order_by(RatePlan.priority.asc()).all())
    applied = []
    final = float(base_tariff)
    weekday = target_date.weekday()                 # Mon=0..Sun=6
    bit = 1 << weekday                              # Mon=1, Tue=2, ... Sun=64
    for p in plans:
        # Scope filters.
        if p.room_type and room_type and p.room_type != room_type:
            continue
        if p.day_of_week_mask:
            if (int(p.day_of_week_mask) & bit) == 0:
                continue
        if p.valid_from and target_date < p.valid_from:
            continue
        if p.valid_to and target_date > p.valid_to:
            continue
        # Apply the adjustment.
        value = float(p.adjustment_value)
        before = final
        if p.adjustment_type == RatePlanAdjustmentType.percent or \
           getattr(p.adjustment_type, "value", p.adjustment_type) == "percent":
            final = final * (1 + value / 100.0)
        else:
            final = final + value
        applied.append({
            "plan_id": p.plan_id,
            "name": p.name,
            "type": getattr(p.adjustment_type, "value", p.adjustment_type),
            "value": value,
            "tariff_before": round(before, 2),
            "tariff_after": round(final, 2),
        })
    return {
        "base_tariff": round(float(base_tariff), 2),
        "effective_tariff": round(max(0, final), 2),
        "applied_plans": applied,
        "for_date": target_date.isoformat(),
        "for_room_type": room_type,
    }


@router.get("/preview")
def preview_tariff(room_type: Optional[str] = Query(None),
                    base_tariff: float = Query(...),
                    for_date: Optional[date] = Query(None),
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    """Preview the price after rate-plan resolution — drives the Rate
    Plans page's 'try-it' panel."""
    return resolve_tariff(db, lodge_id, room_type, base_tariff,
                           for_date or date.today())
