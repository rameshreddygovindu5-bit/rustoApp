"""Inventory router — supplies/consumables stock tracking.

Two tables:
  inventory_items   — one row per SKU (name, unit, current_stock, threshold)
  stock_movements   — immutable history (+purchase, -consumption, ±adjustment)

Stock changes ONLY happen via POST /movements which atomically inserts a
movement row AND updates the denormalized current_stock counter.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal

from ..database import get_db
from ..models import (InventoryItem, InventoryUnit, InventoryCategory,
                      StockMovement, StockMovementType)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..permissions import require_permission
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _item_to_dict(i: InventoryItem) -> dict:
    return {
        "item_id": i.item_id,
        "sku": i.sku,
        "name": i.name,
        "category": getattr(i.category, "value", i.category),
        "unit": getattr(i.unit, "value", i.unit),
        "current_stock": float(i.current_stock or 0),
        "reorder_threshold": float(i.reorder_threshold or 0),
        "unit_price": float(i.unit_price) if i.unit_price is not None else None,
        "notes": i.notes,
        "is_active": bool(i.is_active),
        "below_threshold": float(i.current_stock or 0) <= float(i.reorder_threshold or 0),
        "stock_value": (float(i.current_stock or 0) * float(i.unit_price or 0)),
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _move_to_dict(m: StockMovement) -> dict:
    return {
        "movement_id": m.movement_id,
        "item_id": m.item_id,
        "movement_type": getattr(m.movement_type, "value", m.movement_type),
        "change": float(m.change),
        "reason": m.reason,
        "related_room_id": m.related_room_id,
        "related_checkin_id": m.related_checkin_id,
        "created_by": m.created_by,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/items")
def list_items(category: Optional[str] = None,
                low_stock_only: bool = False,
                active_only: bool = True,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(InventoryItem)
         .filter(InventoryItem.lodge_id == lodge_id)
         .order_by(InventoryItem.name.asc()))
    if active_only:
        q = q.filter(InventoryItem.is_active == True)
    if category:
        q = q.filter(InventoryItem.category == category)
    rows = q.limit(500).all()
    out = [_item_to_dict(r) for r in rows]
    if low_stock_only:
        out = [r for r in out if r["below_threshold"]]
    return out


@router.get("/summary")
def summary(db: Session = Depends(get_db),
            current_user=Depends(get_current_user),
            lodge_id: int = Depends(resolve_lodge_scope)):
    """Aggregate stats for the dashboard widget."""
    rows = (db.query(InventoryItem)
            .filter(InventoryItem.lodge_id == lodge_id,
                    InventoryItem.is_active == True).all())
    total_items = len(rows)
    total_value = sum(float(i.current_stock or 0) * float(i.unit_price or 0) for i in rows)
    low_stock = sum(1 for i in rows
                    if float(i.current_stock or 0) <= float(i.reorder_threshold or 0))
    return {
        "total_active_items": total_items,
        "total_stock_value": round(total_value, 2),
        "low_stock_count": low_stock,
    }


class ItemCreate(BaseModel):
    name: str
    category: str = "consumables"
    unit: str = "piece"
    sku: Optional[str] = None
    initial_stock: float = 0
    reorder_threshold: float = 0
    unit_price: Optional[float] = None
    notes: Optional[str] = None


@router.post("/items")
def create_item(body: ItemCreate, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_permission("inventory.write")),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    if body.category not in {c.value for c in InventoryCategory}:
        raise HTTPException(status_code=400, detail="Invalid category")
    if body.unit not in {u.value for u in InventoryUnit}:
        raise HTTPException(status_code=400, detail="Invalid unit")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    if body.initial_stock < 0 or body.reorder_threshold < 0:
        raise HTTPException(status_code=400, detail="Stock/threshold must be >= 0")

    sku = (body.sku or "").strip().upper()[:40] or None
    if sku:
        # Per-lodge SKU uniqueness — index already enforces but we want a
        # friendly error rather than an IntegrityError trace.
        clash = (db.query(InventoryItem)
                 .filter(InventoryItem.lodge_id == lodge_id,
                         InventoryItem.sku == sku).first())
        if clash:
            raise HTTPException(status_code=400, detail=f"SKU '{sku}' already exists")

    item = InventoryItem(
        lodge_id=lodge_id,
        sku=sku, name=body.name.strip()[:160],
        category=body.category, unit=body.unit,
        current_stock=Decimal(str(body.initial_stock)),
        reorder_threshold=Decimal(str(body.reorder_threshold)),
        unit_price=(Decimal(str(body.unit_price)) if body.unit_price is not None else None),
        notes=body.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # If initial_stock > 0, log it as an opening 'adjustment' movement so
    # the history shows where that stock came from.
    if body.initial_stock > 0:
        db.add(StockMovement(
            lodge_id=lodge_id, item_id=item.item_id,
            movement_type=StockMovementType.adjustment,
            change=Decimal(str(body.initial_stock)),
            reason="Opening stock",
            created_by=current_user.user_id,
        ))
        db.commit()
    try:
        log_audit(db, "inventory.item_created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="inventory_item", entity_id=item.item_id,
                  lodge_id=lodge_id,
                  details={"name": item.name, "category": body.category},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _item_to_dict(item)


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    unit: Optional[str] = None
    reorder_threshold: Optional[float] = None
    unit_price: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: ItemUpdate, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(require_permission("inventory.write")),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    item = (db.query(InventoryItem)
            .filter(InventoryItem.item_id == item_id,
                    InventoryItem.lodge_id == lodge_id).first())
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    fields = body.dict(exclude_unset=True)
    # current_stock is NOT editable here — use a movement.
    if "name" in fields:
        item.name = fields["name"].strip()[:160]
    if "category" in fields:
        if fields["category"] not in {c.value for c in InventoryCategory}:
            raise HTTPException(status_code=400, detail="Invalid category")
        item.category = fields["category"]
    if "unit" in fields:
        if fields["unit"] not in {u.value for u in InventoryUnit}:
            raise HTTPException(status_code=400, detail="Invalid unit")
        item.unit = fields["unit"]
    if "reorder_threshold" in fields:
        item.reorder_threshold = Decimal(str(max(0, fields["reorder_threshold"])))
    if "unit_price" in fields:
        item.unit_price = (Decimal(str(fields["unit_price"]))
                            if fields["unit_price"] is not None else None)
    if "notes" in fields:
        item.notes = fields["notes"]
    if "is_active" in fields:
        item.is_active = bool(fields["is_active"])
    db.commit()
    db.refresh(item)
    try:
        log_audit(db, "inventory.item_updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="inventory_item", entity_id=item.item_id,
                  lodge_id=lodge_id, details={"changed": list(fields.keys())},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _item_to_dict(item)


class MovementCreate(BaseModel):
    item_id: int
    movement_type: str            # purchase | consumption | adjustment | damage | transfer | return_
    quantity: float               # always positive; sign derived from type
    reason: Optional[str] = None
    related_room_id: Optional[int] = None
    related_checkin_id: Optional[int] = None


@router.post("/movements")
def create_movement(body: MovementCreate, request: Request,
                     db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    """Record a stock movement and atomically update current_stock.

    Sign convention by type:
      purchase   → +quantity
      adjustment → ± (caller controls; we negate if reason starts with '-')
      transfer   → -quantity (out of this lodge)
      consumption / damage / return_ → -quantity
    """
    if body.movement_type not in {m.value for m in StockMovementType}:
        raise HTTPException(status_code=400, detail="Invalid movement_type")
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")

    item = (db.query(InventoryItem)
            .filter(InventoryItem.item_id == body.item_id,
                    InventoryItem.lodge_id == lodge_id).first())
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    POSITIVE = {"purchase"}
    NEGATIVE = {"consumption", "damage", "return_", "transfer"}
    if body.movement_type in POSITIVE:
        delta = Decimal(str(body.quantity))
    elif body.movement_type in NEGATIVE:
        delta = -Decimal(str(body.quantity))
    else:
        # adjustment — if reason starts with '-' or 'remove', go negative
        rsn = (body.reason or "").lower()
        if rsn.startswith("-") or rsn.startswith("remove") or rsn.startswith("write"):
            delta = -Decimal(str(body.quantity))
        else:
            delta = Decimal(str(body.quantity))

    new_stock = Decimal(str(item.current_stock or 0)) + delta
    if new_stock < 0:
        raise HTTPException(
            status_code=400,
            detail=f"Movement would make stock negative ({item.current_stock} + {delta}). "
                   f"Use a smaller quantity.",
        )

    mv = StockMovement(
        lodge_id=lodge_id, item_id=item.item_id,
        movement_type=body.movement_type, change=delta,
        reason=(body.reason or "").strip()[:300] or None,
        related_room_id=body.related_room_id,
        related_checkin_id=body.related_checkin_id,
        created_by=current_user.user_id,
    )
    item.current_stock = new_stock
    db.add(mv)
    db.commit()
    db.refresh(mv)
    db.refresh(item)
    try:
        log_audit(db, "inventory.movement",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="stock_movement", entity_id=mv.movement_id,
                  lodge_id=lodge_id,
                  details={"item_id": item.item_id, "item_name": item.name,
                           "type": body.movement_type, "change": float(delta),
                           "new_stock": float(new_stock)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"movement": _move_to_dict(mv), "item": _item_to_dict(item)}


@router.get("/movements")
def list_movements(item_id: Optional[int] = None,
                    limit: int = 100,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(StockMovement)
         .filter(StockMovement.lodge_id == lodge_id)
         .order_by(StockMovement.created_at.desc()))
    if item_id:
        q = q.filter(StockMovement.item_id == item_id)
    return [_move_to_dict(m) for m in q.limit(min(limit, 500)).all()]
