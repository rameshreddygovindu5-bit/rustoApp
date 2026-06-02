"""Night audit router — end-of-day close-out.

The night auditor (typically a staff user working the night shift) clicks
"Run audit" at end of business day. The endpoint:
  1. Totals revenue (room + folio + GST + discounts) for the business date
  2. Counts checkins / checkouts / cancellations
  3. Computes occupancy %, ARR, RevPAR
  4. Lists "issues" — pending charges, unposted folios, overdue guests
  5. Stores everything in `night_audit_runs` immutably

Once an audit is closed for a business date, the row is the source of
truth for that day's KPIs — historical reports read from here rather
than re-aggregating live tables (which keep evolving).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from datetime import date, datetime, timedelta
from typing import Optional
from decimal import Decimal
import json

from ..database import get_db
from ..models import (NightAuditRun, Invoice, Checkin, CheckinStatus, Room,
                      FolioCharge, Expense, Booking, BookingStatus,
                      MaintenanceTicket, MaintenanceStatus)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/night-audit", tags=["night-audit"])


def _to_dict(r: NightAuditRun) -> dict:
    return {
        "run_id": r.run_id,
        "business_date": r.business_date.isoformat(),
        "run_at": r.run_at.isoformat() if r.run_at else None,
        "checkins_count": int(r.checkins_count or 0),
        "checkouts_count": int(r.checkouts_count or 0),
        "cancellations_count": int(r.cancellations_count or 0),
        "rooms_occupied": int(r.rooms_occupied or 0),
        "rooms_available": int(r.rooms_available or 0),
        "room_revenue": float(r.room_revenue or 0),
        "folio_revenue": float(r.folio_revenue or 0),
        "other_revenue": float(r.other_revenue or 0),
        "gst_collected": float(r.gst_collected or 0),
        "discounts_given": float(r.discounts_given or 0),
        "total_revenue": float(r.total_revenue or 0),
        "expenses_total": float(r.expenses_total or 0),
        "net_revenue": float(r.net_revenue or 0),
        "occupancy_pct": float(r.occupancy_pct or 0),
        "arr": float(r.arr or 0),
        "revpar": float(r.revpar or 0),
        "issues": json.loads(r.issues_json) if r.issues_json else [],
        "notes": r.notes,
    }


@router.get("/current-business-date")
def current_business_date(db: Session = Depends(get_db),
                          current_user=Depends(get_current_user),
                          lodge_id: int = Depends(resolve_lodge_scope)):
    """The next business date to audit. If the last audit closed
    2026-05-27, the current business date is 2026-05-28. If no audits
    have ever run, default to yesterday (you typically audit yesterday
    at midnight)."""
    last = (db.query(NightAuditRun)
            .filter(NightAuditRun.lodge_id == lodge_id)
            .order_by(NightAuditRun.business_date.desc()).first())
    if last:
        return {"business_date": (last.business_date + timedelta(days=1)).isoformat(),
                "last_audited": last.business_date.isoformat()}
    return {"business_date": (date.today() - timedelta(days=1)).isoformat(),
            "last_audited": None}


@router.get("/preview")
def preview(business_date: Optional[date] = Query(None),
            db: Session = Depends(get_db),
            current_user=Depends(get_current_user),
            lodge_id: int = Depends(resolve_lodge_scope)):
    """Compute what the audit WOULD record for a given business date,
    without persisting. The UI shows this on the night-audit page so the
    auditor can sanity-check before pressing "Close day"."""
    if business_date is None:
        business_date = date.today() - timedelta(days=1)
    return _compute_audit(db, lodge_id, business_date)


def _compute_audit(db: Session, lodge_id: int, business_date: date) -> dict:
    """Pure computation — no writes. Reusable by /preview and /run."""
    # All invoices issued ON this business date (one per checkout).
    invoices = (db.query(Invoice)
                .filter(Invoice.lodge_id == lodge_id,
                        cast(Invoice.created_at, Date) == business_date).all())
    # Checkins / checkouts / cancellations counted by their event date.
    checkins_today = (db.query(Checkin)
                      .filter(Checkin.lodge_id == lodge_id,
                              cast(Checkin.checkin_datetime, Date) == business_date).count())
    checkouts_today = (db.query(Checkin)
                       .filter(Checkin.lodge_id == lodge_id,
                               cast(Checkin.actual_checkout, Date) == business_date).count())
    cancellations_today = (db.query(Booking)
                           .filter(Booking.lodge_id == lodge_id,
                                   Booking.status == BookingStatus.cancelled,
                                   cast(Booking.updated_at, Date) == business_date).count()
                           if hasattr(Booking, "updated_at") else 0)

    # Current room state — used for occupancy %.
    rooms_total = db.query(Room).filter(Room.lodge_id == lodge_id).count()
    rooms_occ = (db.query(Room)
                 .filter(Room.lodge_id == lodge_id,
                         Room.status == "occupied").count())

    # Revenue breakdown — from the closed invoices on this date.
    room_rev = sum(float(i.total_amount or 0) - float(i.additional_charges or 0)
                   - float(i.gst_amount or 0) + float(i.discount_amount or 0)
                   for i in invoices)
    folio_rev = sum(float(i.additional_charges or 0) for i in invoices)
    gst_total = sum(float(i.gst_amount or 0) for i in invoices)
    discount_total = sum(float(i.discount_amount or 0) for i in invoices)
    total_rev = sum(float(i.total_amount or 0) for i in invoices)

    # Expenses booked for the business date.
    exp_total = (db.query(func.coalesce(func.sum(Expense.amount), 0))
                 .filter(Expense.lodge_id == lodge_id,
                         cast(Expense.expense_date, Date) == business_date)
                 .scalar()) or 0
    exp_total = float(exp_total)

    net = total_rev - exp_total
    occupancy_pct = (rooms_occ / rooms_total * 100) if rooms_total > 0 else 0
    arr = (room_rev / len(invoices)) if invoices else 0
    revpar = (room_rev / rooms_total) if rooms_total > 0 else 0

    # Issues — things the auditor should know about before closing.
    issues = []
    overdue = (db.query(Checkin)
               .filter(Checkin.lodge_id == lodge_id,
                       Checkin.status == "active",
                       Checkin.expected_checkout < datetime.combine(business_date,
                                                                     datetime.min.time())).count())
    if overdue:
        issues.append({"level": "warn", "type": "overdue_checkins",
                       "count": overdue,
                       "message": f"{overdue} guest(s) overdue for checkout"})
    # Folio charges with no invoice yet (means a checkin hasn't been
    # closed). Shouldn't be common but worth flagging.
    unposted = (db.query(FolioCharge)
                .join(Checkin, Checkin.checkin_id == FolioCharge.checkin_id)
                .filter(FolioCharge.lodge_id == lodge_id,
                        Checkin.status == "active",
                        FolioCharge.voided == False,
                        cast(FolioCharge.created_at, Date) <= business_date).count())
    if unposted:
        issues.append({"level": "info", "type": "open_folios",
                       "count": unposted,
                       "message": f"{unposted} folio charge(s) on stays still open"})
    mt_blocking = (db.query(MaintenanceTicket)
                   .filter(MaintenanceTicket.lodge_id == lodge_id,
                           MaintenanceTicket.blocks_room_availability == True,
                           MaintenanceTicket.status.in_([MaintenanceStatus.open,
                                                          MaintenanceStatus.in_progress]))
                   .count())
    if mt_blocking:
        issues.append({"level": "info", "type": "blocking_maintenance",
                       "count": mt_blocking,
                       "message": f"{mt_blocking} room(s) blocked by open maintenance"})

    return {
        "business_date": business_date.isoformat(),
        "checkins_count": checkins_today,
        "checkouts_count": checkouts_today,
        "cancellations_count": cancellations_today,
        "rooms_occupied": rooms_occ,
        "rooms_available": max(rooms_total - rooms_occ, 0),
        "rooms_total": rooms_total,
        "room_revenue": round(room_rev, 2),
        "folio_revenue": round(folio_rev, 2),
        "other_revenue": 0.0,
        "gst_collected": round(gst_total, 2),
        "discounts_given": round(discount_total, 2),
        "total_revenue": round(total_rev, 2),
        "expenses_total": round(exp_total, 2),
        "net_revenue": round(net, 2),
        "occupancy_pct": round(occupancy_pct, 2),
        "arr": round(arr, 2),
        "revpar": round(revpar, 2),
        "invoices_count": len(invoices),
        "issues": issues,
    }


@router.post("/run")
def run_audit(business_date: Optional[date] = None,
              notes: Optional[str] = None,
              request: Request = None,
              db: Session = Depends(get_db),
              current_user=Depends(require_admin),
              lodge_id: int = Depends(resolve_lodge_scope)):
    """Close out a business day. Idempotent — calling twice for the same
    date returns the existing run instead of duplicating.

    Admin-only because closing the day affects historical reporting; we
    don't want every front-desk clerk able to do this.
    """
    if business_date is None:
        business_date = date.today() - timedelta(days=1)
    # Already closed?
    existing = (db.query(NightAuditRun)
                .filter(NightAuditRun.lodge_id == lodge_id,
                        NightAuditRun.business_date == business_date).first())
    if existing:
        return {"already_closed": True, **_to_dict(existing)}

    snap = _compute_audit(db, lodge_id, business_date)
    run = NightAuditRun(
        lodge_id=lodge_id,
        business_date=business_date,
        checkins_count=snap["checkins_count"],
        checkouts_count=snap["checkouts_count"],
        cancellations_count=snap["cancellations_count"],
        rooms_occupied=snap["rooms_occupied"],
        rooms_available=snap["rooms_available"],
        room_revenue=snap["room_revenue"],
        folio_revenue=snap["folio_revenue"],
        other_revenue=snap["other_revenue"],
        gst_collected=snap["gst_collected"],
        discounts_given=snap["discounts_given"],
        total_revenue=snap["total_revenue"],
        expenses_total=snap["expenses_total"],
        net_revenue=snap["net_revenue"],
        occupancy_pct=snap["occupancy_pct"],
        arr=snap["arr"],
        revpar=snap["revpar"],
        issues_json=json.dumps(snap["issues"]),
        notes=notes,
        run_by=current_user.user_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        log_audit(db, "night_audit.closed",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="night_audit_run", entity_id=run.run_id,
                  lodge_id=lodge_id,
                  details={"business_date": business_date.isoformat(),
                           "total_revenue": snap["total_revenue"]},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"already_closed": False, **_to_dict(run)}


@router.get("/history")
def history(limit: int = 30,
            db: Session = Depends(get_db),
            current_user=Depends(get_current_user),
            lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(NightAuditRun)
            .filter(NightAuditRun.lodge_id == lodge_id)
            .order_by(NightAuditRun.business_date.desc())
            .limit(min(limit, 365)).all())
    return [_to_dict(r) for r in rows]
