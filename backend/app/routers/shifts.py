"""Shift handover router — cash drawer reconciliation.

Flow:
  POST /open   — staffer counts cash, enters opening_balance
  GET  /current — UI polls this to know if a shift is open + live totals
  POST /close  — staffer counts cash again, system computes expected vs actual

`expected_closing_balance` = opening_balance + cash_in - cash_out, where:
  cash_in  = sum of Invoice.total_amount for invoices generated in this
             shift's window where payment_mode='cash'
  cash_out = sum of Expense.amount where shift_id == this shift and
             payment_method='cash'
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal

from ..database import get_db
from ..models import (ShiftSession, ShiftStatus, Expense, Invoice, PaymentMethod)
from ..auth import get_current_user, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/shifts", tags=["shifts"])


def _to_dict(s: ShiftSession) -> dict:
    return {
        "shift_id": s.shift_id,
        "user_id": s.user_id,
        "staff_name": s.user.full_name if s.user else None,
        "status": getattr(s.status, "value", s.status),
        "opened_at": s.opened_at.isoformat() if s.opened_at else None,
        "closed_at": s.closed_at.isoformat() if s.closed_at else None,
        "opening_balance": float(s.opening_balance or 0),
        "closing_balance": float(s.closing_balance) if s.closing_balance is not None else None,
        "expected_closing_balance": (float(s.expected_closing_balance)
                                     if s.expected_closing_balance is not None else None),
        "discrepancy": float(s.discrepancy) if s.discrepancy is not None else None,
        "handover_notes": s.handover_notes,
    }


def _compute_cash_in_out(db: Session, shift: ShiftSession) -> tuple[float, float]:
    """Sum cash invoices and cash expenses within the shift window.
    For an open shift, the window runs from `opened_at` to NOW.
    For a closed shift, from `opened_at` to `closed_at`.

    Invoices are matched by `payment_mode`; that's a free-text string in
    the Checkin (no PaymentMethod enum), so we case-insensitively match
    'cash'.
    """
    end_time = shift.closed_at or datetime.utcnow()
    cash_in_q = (db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
                 .filter(Invoice.lodge_id == shift.lodge_id,
                         Invoice.created_at >= shift.opened_at,
                         Invoice.created_at <= end_time))
    # The Invoice table doesn't carry payment_mode directly — it lives on
    # the Checkin. Join through.
    from ..models import Checkin
    cash_in_q = (cash_in_q.join(Checkin, Checkin.checkin_id == Invoice.checkin_id)
                 .filter(func.lower(Checkin.payment_mode) == "cash"))
    cash_in = float(cash_in_q.scalar() or 0)

    cash_out = float((db.query(func.coalesce(func.sum(Expense.amount), 0))
                      .filter(Expense.lodge_id == shift.lodge_id,
                              Expense.shift_id == shift.shift_id,
                              Expense.payment_method == PaymentMethod.cash)
                      .scalar()) or 0)
    return cash_in, cash_out


@router.get("/current")
def current_shift(db: Session = Depends(get_db),
                  current_user=Depends(get_current_user),
                  lodge_id: int = Depends(resolve_lodge_scope)):
    """The currently-open shift for this user (if any), with live totals.
    Returns None if no shift is open."""
    shift = (db.query(ShiftSession)
             .filter(ShiftSession.lodge_id == lodge_id,
                     ShiftSession.user_id == current_user.user_id,
                     ShiftSession.status == ShiftStatus.open)
             .order_by(ShiftSession.shift_id.desc()).first())
    if not shift:
        return None
    cash_in, cash_out = _compute_cash_in_out(db, shift)
    expected = float(shift.opening_balance or 0) + cash_in - cash_out
    out = _to_dict(shift)
    out.update({
        "live_cash_in": cash_in,
        "live_cash_out": cash_out,
        "live_expected_closing": expected,
    })
    return out


@router.get("")
def list_shifts(limit: int = 50,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    """Recent shifts in this lodge — for the handover history page."""
    rows = (db.query(ShiftSession)
            .filter(ShiftSession.lodge_id == lodge_id)
            .order_by(ShiftSession.shift_id.desc())
            .limit(min(limit, 200)).all())
    return [_to_dict(r) for r in rows]


class OpenRequest(BaseModel):
    opening_balance: float


@router.post("/open")
def open_shift(body: OpenRequest, request: Request,
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    # Block opening if THIS user already has an open shift somewhere in
    # this lodge — they have to close it first.
    existing = (db.query(ShiftSession)
                .filter(ShiftSession.lodge_id == lodge_id,
                        ShiftSession.user_id == current_user.user_id,
                        ShiftSession.status == ShiftStatus.open).first())
    if existing:
        raise HTTPException(status_code=400,
                            detail="You already have an open shift — close it before opening a new one")
    if body.opening_balance < 0:
        raise HTTPException(status_code=400, detail="opening_balance must be >= 0")
    shift = ShiftSession(
        lodge_id=lodge_id,
        user_id=current_user.user_id,
        opening_balance=Decimal(str(body.opening_balance)),
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    try:
        log_audit(db, "shift.opened",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="shift", entity_id=shift.shift_id,
                  lodge_id=lodge_id,
                  details={"opening_balance": float(body.opening_balance)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(shift)


class CloseRequest(BaseModel):
    closing_balance: float
    handover_notes: Optional[str] = None


@router.post("/close")
def close_shift(body: CloseRequest, request: Request,
                db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    shift = (db.query(ShiftSession)
             .filter(ShiftSession.lodge_id == lodge_id,
                     ShiftSession.user_id == current_user.user_id,
                     ShiftSession.status == ShiftStatus.open)
             .order_by(ShiftSession.shift_id.desc()).first())
    if not shift:
        raise HTTPException(status_code=400, detail="No open shift to close")
    if body.closing_balance < 0:
        raise HTTPException(status_code=400, detail="closing_balance must be >= 0")

    cash_in, cash_out = _compute_cash_in_out(db, shift)
    expected = float(shift.opening_balance or 0) + cash_in - cash_out
    discrepancy = body.closing_balance - expected

    shift.status = ShiftStatus.closed
    shift.closed_at = datetime.utcnow()
    shift.closing_balance = Decimal(str(body.closing_balance))
    shift.expected_closing_balance = Decimal(str(round(expected, 2)))
    shift.discrepancy = Decimal(str(round(discrepancy, 2)))
    shift.handover_notes = (body.handover_notes or "").strip() or None
    db.commit()
    db.refresh(shift)
    try:
        log_audit(db, "shift.closed",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="shift", entity_id=shift.shift_id,
                  lodge_id=lodge_id,
                  details={"opening_balance": float(shift.opening_balance or 0),
                           "expected_closing": expected,
                           "actual_closing": float(body.closing_balance),
                           "discrepancy": float(discrepancy),
                           "cash_in": cash_in, "cash_out": cash_out},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    out = _to_dict(shift)
    out["cash_in"] = cash_in
    out["cash_out"] = cash_out
    return out
