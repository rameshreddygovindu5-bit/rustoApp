"""Platform-owner analytics — v9.0.

Super-admin only. Provides cross-tenant marketplace health metrics:
  - Booking funnel (impressions → bookings → confirmed → checked_in)
  - GMV by lodge, by city, by month
  - Customer growth & retention
  - Lodge onboarding health (published vs total, blockers)
  - Dispute/refund tracking
  - Review health
  - Cancellation rates

Endpoints:
  GET /api/platform/analytics/overview
  GET /api/platform/analytics/funnel
  GET /api/platform/analytics/lodges
  GET /api/platform/analytics/customers
  GET /api/platform/analytics/bookings-trend
  GET /api/platform/analytics/disputes
"""
import logging
from datetime import date, timedelta, timezone
from typing import Optional

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, and_, case, distinct, cast, Date
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (Lodge, CustomerBooking, CustomerBookingStatus,
                       RustoCustomer, Review, ReviewStatus)
from ..auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/platform/analytics", tags=["platform-analytics"])


def _require_super_admin(user=Depends(get_current_user)):
    if user.role != "super_admin":
        raise HTTPException(403, "Super-admin only")
    return user


# ── helpers ─────────────────────────────────────────────────────

def _date_range(days: int):
    end = date.today()
    start = end - timedelta(days=days - 1)
    return start, end


# ── endpoints ───────────────────────────────────────────────────

@router.get("/overview")
def platform_overview(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Headline KPIs for the platform owner."""
    start, end = _date_range(days)

    total_lodges     = db.query(func.count(Lodge.lodge_id)).filter(Lodge.is_active == True).scalar() or 0
    published_lodges = db.query(func.count(Lodge.lodge_id)).filter(
        Lodge.is_active == True, Lodge.is_published == True).scalar() or 0

    total_customers  = db.query(func.count(RustoCustomer.customer_id)).filter(
        RustoCustomer.is_active == True).scalar() or 0
    new_customers    = db.query(func.count(RustoCustomer.customer_id)).filter(
        RustoCustomer.created_at >= start).scalar() or 0

    all_bk = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.created_at >= start).scalar() or 0
    confirmed_bk = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.created_at >= start,
        CustomerBooking.status.in_([
            CustomerBookingStatus.confirmed.value,
            CustomerBookingStatus.checked_in.value,
            CustomerBookingStatus.checked_out.value,
        ])).scalar() or 0
    cancelled_bk = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.created_at >= start,
        CustomerBooking.status == CustomerBookingStatus.cancelled.value).scalar() or 0

    # GMV = sum of total_amount for confirmed+ bookings
    gmv = db.query(func.sum(CustomerBooking.total_amount)).filter(
        CustomerBooking.created_at >= start,
        CustomerBooking.status.in_([
            CustomerBookingStatus.confirmed.value,
            CustomerBookingStatus.checked_in.value,
            CustomerBookingStatus.checked_out.value,
        ])).scalar() or 0

    total_reviews = db.query(func.count(Review.review_id)).filter(
        Review.created_at >= start,
        Review.status == ReviewStatus.published.value).scalar() or 0
    avg_rating = db.query(func.avg(Review.rating)).filter(
        Review.status == ReviewStatus.published.value).scalar()

    return {
        "period_days": days,
        "lodges": {
            "total": total_lodges,
            "published": published_lodges,
            "unpublished": total_lodges - published_lodges,
            "publish_rate_pct": round(100 * published_lodges / total_lodges, 1) if total_lodges else 0,
        },
        "customers": {
            "total": total_customers,
            "new_in_period": new_customers,
        },
        "bookings": {
            "total": all_bk,
            "confirmed": confirmed_bk,
            "cancelled": cancelled_bk,
            "conversion_rate_pct": round(100 * confirmed_bk / all_bk, 1) if all_bk else 0,
            "cancellation_rate_pct": round(100 * cancelled_bk / all_bk, 1) if all_bk else 0,
        },
        "revenue": {
            "gmv": float(gmv),
            "currency": "INR",
        },
        "reviews": {
            "total_in_period": total_reviews,
            "platform_avg_rating": round(float(avg_rating), 2) if avg_rating else None,
        },
    }


@router.get("/bookings-trend")
def bookings_trend(
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Daily bookings + GMV over the period."""
    start, end = _date_range(days)

    rows = (db.query(
        cast(CustomerBooking.created_at, Date).label("day"),
        func.count(CustomerBooking.booking_id).label("bookings"),
        func.sum(case(
            (CustomerBooking.status.in_([
                CustomerBookingStatus.confirmed.value,
                CustomerBookingStatus.checked_in.value,
                CustomerBookingStatus.checked_out.value,
            ]), CustomerBooking.total_amount),
            else_=0
        )).label("gmv"),
    ).filter(CustomerBooking.created_at >= start)
     .group_by(cast(CustomerBooking.created_at, Date))
     .order_by(cast(CustomerBooking.created_at, Date)).all())

    return {
        "trend": [
            {"date": str(r.day), "bookings": r.bookings, "gmv": float(r.gmv or 0)}
            for r in rows
        ]
    }

@router.get("/lodges")
def lodge_leaderboard(
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Per-lodge booking counts + GMV, sorted by GMV desc."""
    rows = (db.query(
        Lodge.lodge_id,
        Lodge.name,
        Lodge.public_city,
        Lodge.is_published,
        func.count(CustomerBooking.booking_id).label("total_bk"),
        func.sum(case(
            (CustomerBooking.status.in_([
                CustomerBookingStatus.confirmed.value,
                CustomerBookingStatus.checked_in.value,
                CustomerBookingStatus.checked_out.value,
            ]), CustomerBooking.total_amount),
            else_=0
        )).label("gmv"),
        func.avg(Review.rating).label("avg_rating"),
    ).outerjoin(CustomerBooking, CustomerBooking.lodge_id == Lodge.lodge_id)
     .outerjoin(Review, and_(
         Review.lodge_id == Lodge.lodge_id,
         Review.status == ReviewStatus.published.value,
     ))
     .filter(Lodge.is_active == True)
     .group_by(Lodge.lodge_id, Lodge.name, Lodge.public_city, Lodge.is_published)
     .order_by(func.sum(case(
         (CustomerBooking.status.in_([
             CustomerBookingStatus.confirmed.value,
             CustomerBookingStatus.checked_in.value,
             CustomerBookingStatus.checked_out.value,
         ]), CustomerBooking.total_amount), else_=0)).desc().nullslast())
     .limit(limit).all())

    return {
        "lodges": [
            {
                "lodge_id": r.lodge_id,
                "name": r.name,
                "city": r.public_city,
                "is_published": bool(r.is_published),
                "bookings": r.total_bk or 0,
                "gmv": float(r.gmv or 0),
                "avg_rating": round(float(r.avg_rating), 2) if r.avg_rating else None,
            }
            for r in rows
        ]
    }

@router.get("/customers")
def customer_growth(
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Customer signups by day + repeat booker rate."""
    start, end = _date_range(days)

    # Daily signups
    daily = (db.query(
        cast(RustoCustomer.created_at, Date).label("day"),
        func.count(RustoCustomer.customer_id).label("signups"),
    ).filter(RustoCustomer.created_at >= start)
     .group_by(cast(RustoCustomer.created_at, Date))
     .order_by(cast(RustoCustomer.created_at, Date)).all())

    # Repeat bookers
    bk_counts = (db.query(
        CustomerBooking.customer_id,
        func.count(CustomerBooking.booking_id).label("cnt"),
    ).filter(
        CustomerBooking.status.in_([
            CustomerBookingStatus.confirmed.value,
            CustomerBookingStatus.checked_in.value,
            CustomerBookingStatus.checked_out.value,
        ])
    ).group_by(CustomerBooking.customer_id).all())

    repeat = sum(1 for r in bk_counts if r.cnt > 1)
    total_with_bk = len(bk_counts)

    return {
        "daily_signups": [{"date": str(r.day), "signups": r.signups} for r in daily],
        "retention": {
            "customers_with_bookings": total_with_bk,
            "repeat_bookers": repeat,
            "repeat_rate_pct": round(100 * repeat / total_with_bk, 1) if total_with_bk else 0,
        }
    }


@router.get("/onboarding-health")
def onboarding_health(
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Show which lodges are active but not published and what's blocking them."""
    lodges = db.query(Lodge).filter(
        Lodge.is_active == True,
        Lodge.is_published == False
    ).order_by(Lodge.created_at.desc()).all()

    from ..models import LodgePhoto
    result = []
    for l in lodges:
        blockers = []
        if not l.public_city:
            blockers.append("missing_city")
        if not l.public_description or len((l.public_description or "").strip()) < 30:
            blockers.append("missing_description")
        photos = db.query(LodgePhoto).filter(LodgePhoto.lodge_id == l.lodge_id).count()
        if photos == 0:
            blockers.append("no_photos")
        if not l.starting_price:
            blockers.append("no_starting_price")
        result.append({
            "lodge_id": l.lodge_id,
            "name": l.name,
            "city": l.public_city,
            "created_at": l.created_at.isoformat() if l.created_at else None,
            "blockers": blockers,
        })

    return {"unpublished_lodges": result, "total": len(result)}


# ── v11.1 — Extended platform analytics ─────────────────────────────

@router.get("/registrations")
def registration_funnel(
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Registration pipeline health for the super-admin command centre."""
    from ..models import LodgeRegistrationRequest, RegistrationStatus

    total    = db.query(func.count(LodgeRegistrationRequest.request_id)).scalar() or 0
    pending  = db.query(func.count(LodgeRegistrationRequest.request_id)).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value).scalar() or 0
    approved = db.query(func.count(LodgeRegistrationRequest.request_id)).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.approved.value).scalar() or 0
    rejected = db.query(func.count(LodgeRegistrationRequest.request_id)).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.rejected.value).scalar() or 0

    # Payment breakdown (pending-status regs only)
    from sqlalchemy import case
    pay_rows = db.query(
        LodgeRegistrationRequest.payment_status,
        func.count(LodgeRegistrationRequest.request_id).label("cnt"),
    ).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value
    ).group_by(LodgeRegistrationRequest.payment_status).all()
    pay_breakdown = {(r.payment_status or "pending"): r.cnt for r in pay_rows}

    # Recent 10 registrations
    recent = db.query(LodgeRegistrationRequest).order_by(
        LodgeRegistrationRequest.created_at.desc()
    ).limit(10).all()

    return {
        "funnel": {
            "total": total, "pending": pending,
            "approved": approved, "rejected": rejected,
            "approval_rate_pct": round(100 * approved / total, 1) if total else 0,
        },
        "payment_breakdown": pay_breakdown,
        "recent": [
            {
                "request_id":      r.request_id,
                "lodge_name":      r.lodge_name,
                "owner_name":      r.owner_full_name,
                "city":            r.city,
                "property_category": r.property_category,
                "plan":            r.selected_plan,
                "payment_status":  r.payment_status or "pending",
                "status":          r.status,
                "created_at":      r.created_at.isoformat() if r.created_at else None,
            }
            for r in recent
        ],
    }


@router.get("/system-health")
def system_health(
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Platform system health snapshot."""
    import os
    from ..models import Alert, AlertStatus, SupportTicket
    from datetime import datetime, timedelta

    now = _utcnow()
    since_24h = now - timedelta(hours=24)
    since_7d  = now - timedelta(days=7)

    # Failed email/SMS alerts in last 24h
    failed_alerts = db.query(func.count(Alert.alert_id)).filter(
        Alert.status == AlertStatus.failed.value,
        Alert.created_at >= since_24h,
    ).scalar() or 0

    sent_alerts = db.query(func.count(Alert.alert_id)).filter(
        Alert.status == AlertStatus.sent.value,
        Alert.created_at >= since_24h,
    ).scalar() or 0

    # Open support tickets
    try:
        open_tickets = db.query(func.count(SupportTicket.ticket_id)).filter(
            SupportTicket.status == "open"
        ).scalar() or 0
        urgent_tickets = db.query(func.count(SupportTicket.ticket_id)).filter(
            SupportTicket.status == "open",
            SupportTicket.priority == "urgent",
        ).scalar() or 0
    except Exception:
        open_tickets = 0
        urgent_tickets = 0

    # DB file size (SQLite only)
    db_size_mb = None
    db_path = os.getenv("DATABASE_URL", "")
    if "sqlite" in db_path:
        path = db_path.replace("sqlite:///", "").replace("sqlite://", "")
        if os.path.exists(path):
            db_size_mb = round(os.path.getsize(path) / (1024 * 1024), 2)

    # Stale lodges — active but no checkin in 7 days
    from ..models import Checkin, CheckinStatus
    all_active_lodges = db.query(func.count(Lodge.lodge_id)).filter(
        Lodge.is_active == True).scalar() or 0
    lodges_with_recent_activity = db.query(
        func.count(distinct(Checkin.lodge_id))
    ).filter(Checkin.created_at >= since_7d).scalar() or 0

    return {
        "alerts_24h": {
            "sent": sent_alerts,
            "failed": failed_alerts,
            "delivery_rate_pct": round(100 * sent_alerts / (sent_alerts + failed_alerts), 1)
                                 if (sent_alerts + failed_alerts) > 0 else 100,
        },
        "support": {
            "open_tickets": open_tickets,
            "urgent_tickets": urgent_tickets,
        },
        "lodges": {
            "active": all_active_lodges,
            "with_activity_7d": lodges_with_recent_activity,
            "stale": all_active_lodges - lodges_with_recent_activity,
        },
        "database": {
            "size_mb": db_size_mb,
        },
        "timestamp": now.isoformat(),
    }


@router.get("/notifications")
def platform_notifications(
    db: Session = Depends(get_db),
    user=Depends(_require_super_admin),
):
    """Recent platform-level events requiring super-admin attention."""
    from ..models import LodgeRegistrationRequest, RegistrationStatus
    from datetime import datetime, timedelta

    now   = _utcnow()
    since = now - timedelta(days=7)
    items = []

    # New pending registrations (last 7 days)
    new_regs = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.created_at >= since,
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
    ).order_by(LodgeRegistrationRequest.created_at.desc()).all()
    for r in new_regs:
        items.append({
            "type":      "new_registration",
            "priority":  "high",
            "title":     f"New registration: {r.lodge_name}",
            "body":      f"{r.owner_full_name} · {r.city} · {r.selected_plan or 'No plan'}",
            "action_url": "/registrations",
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "meta": {"payment_status": r.payment_status or "pending",
                     "request_id": r.request_id},
        })

    # Payment confirmed but not yet approved
    paid_not_approved = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
        LodgeRegistrationRequest.payment_status.in_(["paid", "offline_collected"]),
    ).all()
    for r in paid_not_approved:
        items.append({
            "type":      "payment_confirmed",
            "priority":  "urgent",
            "title":     f"Payment received — ready to approve: {r.lodge_name}",
            "body":      f"₹{float(r.payment_amount or 0):,.0f} via {r.payment_method or 'unknown'} · Ref: {r.payment_ref or '—'}",
            "action_url": "/registrations",
            "created_at": r.payment_date.isoformat() if r.payment_date else now.isoformat(),
            "meta": {"request_id": r.request_id, "amount": float(r.payment_amount or 0)},
        })

    # Follow-ups overdue
    from sqlalchemy import and_
    overdue = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
        LodgeRegistrationRequest.follow_up_at <= now,
        LodgeRegistrationRequest.payment_status.in_(["pending", "failed"]),
    ).all()
    for r in overdue:
        items.append({
            "type":      "followup_overdue",
            "priority":  "normal",
            "title":     f"Overdue follow-up: {r.lodge_name}",
            "body":      f"Scheduled for {r.follow_up_at.strftime('%d %b') if r.follow_up_at else '?'} · Assigned: {r.assigned_to or 'unassigned'}",
            "action_url": "/registrations",
            "created_at": now.isoformat(),
            "meta": {"request_id": r.request_id},
        })

    # Sort: urgent first, then by created_at desc
    priority_order = {"urgent": 0, "high": 1, "normal": 2}
    items.sort(key=lambda x: (priority_order.get(x["priority"], 9),
                               x.get("created_at","") or ""), reverse=False)
    items.sort(key=lambda x: priority_order.get(x["priority"], 9))

    return {"notifications": items, "total": len(items),
            "urgent_count": sum(1 for i in items if i["priority"] == "urgent")}
