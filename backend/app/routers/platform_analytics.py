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
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, and_, case, distinct
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (Lodge, CustomerBooking, CustomerBookingStatus,
                       Payment, PaymentStatus, RustoCustomer,
                       Review, ReviewStatus, UserRole)
from ..auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/platform/analytics", tags=["platform-analytics"])


def _require_super_admin(user=Depends(get_current_user)):
    if user.role != UserRole.super_admin:
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
    avg_rating = db.query(func.avg(Review.overall_rating)).filter(
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
        func.date(CustomerBooking.created_at).label("day"),
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
     .group_by(func.date(CustomerBooking.created_at))
     .order_by(func.date(CustomerBooking.created_at)).all())

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
        func.avg(Review.overall_rating).label("avg_rating"),
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
        func.date(RustoCustomer.created_at).label("day"),
        func.count(RustoCustomer.customer_id).label("signups"),
    ).filter(RustoCustomer.created_at >= start)
     .group_by(func.date(RustoCustomer.created_at))
     .order_by(func.date(RustoCustomer.created_at)).all())

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
