"""Expenses router — daily operational expense tracking per lodge.

Used in two places downstream:
  1. Reports — true profit = (revenue - expenses) over a date range.
  2. Shift handover — cash expenses linked to the open shift are deducted
     from the expected closing balance.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal
import os, uuid

from ..database import get_db
from ..models import (Expense, ExpenseCategory, PaymentMethod, ShiftSession,
                      ShiftStatus)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..permissions import require_permission
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


def _to_dict(e: Expense) -> dict:
    return {
        "expense_id": e.expense_id,
        "expense_date": e.expense_date.isoformat() if e.expense_date else None,
        "category": getattr(e.category, "value", e.category),
        "description": e.description,
        "vendor": e.vendor,
        "amount": float(e.amount),
        "payment_method": getattr(e.payment_method, "value", e.payment_method),
        "receipt_path": e.receipt_path,
        "shift_id": e.shift_id,
        "notes": e.notes,
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }


@router.get("")
def list_expenses(from_date: Optional[date] = None,
                  to_date: Optional[date] = None,
                  category: Optional[str] = None,
                  page: int = 1, limit: int = 50,
                  db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(Expense)
         .filter(Expense.lodge_id == lodge_id)
         .order_by(Expense.expense_date.desc(), Expense.expense_id.desc()))
    if from_date:
        q = q.filter(Expense.expense_date >= from_date)
    if to_date:
        q = q.filter(Expense.expense_date <= to_date)
    if category:
        q = q.filter(Expense.category == category)

    total_amount = float(q.with_entities(func.coalesce(func.sum(Expense.amount), 0)).scalar() or 0)
    total_rows = q.count()
    rows = (q.offset(max(0, page - 1) * limit).limit(min(limit, 200)).all())
    return {
        "total": total_rows,
        "total_amount": total_amount,
        "page": page,
        "limit": limit,
        "data": [_to_dict(r) for r in rows],
    }


@router.get("/summary")
def summary_by_category(from_date: Optional[date] = None,
                         to_date: Optional[date] = None,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    """Per-category totals for the date range — feeds the Expenses chart."""
    q = (db.query(Expense.category, func.coalesce(func.sum(Expense.amount), 0))
         .filter(Expense.lodge_id == lodge_id)
         .group_by(Expense.category))
    if from_date:
        q = q.filter(Expense.expense_date >= from_date)
    if to_date:
        q = q.filter(Expense.expense_date <= to_date)
    out = []
    for cat, amt in q.all():
        out.append({"category": getattr(cat, "value", cat), "amount": float(amt or 0)})
    return {"by_category": out,
            "total": float(sum(r["amount"] for r in out))}


class ExpenseCreate(BaseModel):
    expense_date: date
    category: str
    description: str
    vendor: Optional[str] = None
    amount: float
    payment_method: str = "cash"
    notes: Optional[str] = None


@router.post("")
def create_expense(body: ExpenseCreate, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(require_permission("expenses.write")),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    if body.category not in {c.value for c in ExpenseCategory}:
        raise HTTPException(status_code=400, detail="Invalid category")
    if body.payment_method not in {m.value for m in PaymentMethod}:
        raise HTTPException(status_code=400, detail="Invalid payment_method")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="description is required")

    # If a shift is open for this user AND this is a cash expense, attach
    # it to the shift so the closing balance reconciles correctly.
    shift_id = None
    if body.payment_method == "cash":
        shift = (db.query(ShiftSession)
                 .filter(ShiftSession.lodge_id == lodge_id,
                         ShiftSession.user_id == current_user.user_id,
                         ShiftSession.status == ShiftStatus.open)
                 .order_by(ShiftSession.shift_id.desc())
                 .first())
        if shift:
            shift_id = shift.shift_id

    row = Expense(
        lodge_id=lodge_id,
        expense_date=body.expense_date,
        category=body.category,
        description=body.description.strip()[:300],
        vendor=(body.vendor or "").strip()[:120] or None,
        amount=Decimal(str(body.amount)),
        payment_method=body.payment_method,
        notes=body.notes,
        shift_id=shift_id,
        created_by=current_user.user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    try:
        log_audit(db, "expense.created",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="expense", entity_id=row.expense_id,
                  lodge_id=lodge_id,
                  details={"category": body.category, "amount": float(body.amount),
                           "vendor": row.vendor, "shift_id": shift_id},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(row)


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(require_permission("expenses.write")),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Hard-delete an expense — for correcting data-entry errors. Audit
    log retains the action."""
    row = (db.query(Expense)
           .filter(Expense.expense_id == expense_id,
                   Expense.lodge_id == lodge_id).first())
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    details = {"category": getattr(row.category, "value", row.category),
               "amount": float(row.amount), "vendor": row.vendor,
               "description": row.description}
    db.delete(row)
    db.commit()
    try:
        log_audit(db, "expense.deleted",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="expense", entity_id=expense_id,
                  lodge_id=lodge_id, details=details,
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True}


@router.post("/{expense_id}/receipt")
async def upload_receipt(expense_id: int, request: Request,
                          file: UploadFile = File(...),
                          db: Session = Depends(get_db),
                          current_user=Depends(require_permission("expenses.write")),
                          lodge_id: int = Depends(resolve_lodge_scope)):
    row = (db.query(Expense)
           .filter(Expense.expense_id == expense_id,
                   Expense.lodge_id == lodge_id).first())
    if not row:
        raise HTTPException(status_code=404, detail="Expense not found")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (5MB max)")
    ext = (os.path.splitext(file.filename or "")[1] or ".bin").lower()
    fname = f"{uuid.uuid4().hex}{ext}"
    save_dir = os.path.join("uploads", "receipts")
    os.makedirs(save_dir, exist_ok=True)
    with open(os.path.join(save_dir, fname), "wb") as f:
        f.write(content)
    row.receipt_path = f"receipts/{fname}"
    db.commit()
    return {"success": True, "receipt_path": row.receipt_path}
