"""Per-lodge analytics endpoint — v8.4.

Returns the operational metrics a lodge admin wants on their daily
dashboard: revenue trend, occupancy %, ADR/RevPAR, reviews + ratings
trend, booking source mix, WhatsApp deliverability.

All data already exists across the legacy tables; this just aggregates
it into one tenant-scoped payload so the frontend can render quickly
without firing 12 separate requests.
"""
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date

from ..database import get_db
from ..models import (Room, RoomStatus, Checkin, CheckinStatus, Booking,
                       BookingStatus, BookingSource, Invoice, Customer,
                       Review, ReviewStatus, WhatsAppMessage,
                       WhatsAppMessageStatus, CustomerBooking,
                       CustomerBookingStatus)
from ..auth import require_admin, resolve_lodge_scope

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/lodge")
def lodge_analytics(days: int = Query(30, ge=1, le=365,
                                          description="Trend window (default 30 days)"),
                       lodge_id: int = Depends(resolve_lodge_scope),
                       current_user = Depends(require_admin),
                       db: Session = Depends(get_db)):
    """All-in-one analytics payload for the lodge dashboard.

    Returns a dict with five top-level keys: headline, revenue_trend,
    occupancy_trend, reviews, booking_sources, whatsapp.
    """
    today = date.today()
    window_start = today - timedelta(days=days - 1)
    window_end = today

    # ── Headline tiles ─────────────────────────────────────────
    total_rooms = (db.query(func.count(Room.room_id))
                     .filter(Room.lodge_id == lodge_id,
                             Room.is_active == True).scalar()) or 0
    occupied_now = (db.query(func.count(Checkin.checkin_id))
                      .filter(Checkin.lodge_id == lodge_id,
                              Checkin.status == CheckinStatus.active).scalar()) or 0
    occupancy_pct_now = (occupied_now / total_rooms * 100) if total_rooms else 0

    # Today's revenue (from stay invoices, not subscription billing)
    today_revenue = (db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
                       .filter(Invoice.lodge_id == lodge_id,
                               cast(Invoice.created_at, Date) == today).scalar()) or 0
    # Window revenue
    window_revenue = (db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
                        .filter(Invoice.lodge_id == lodge_id,
                                cast(Invoice.created_at, Date) >= window_start,
                                cast(Invoice.created_at, Date) <= window_end).scalar()) or 0
    invoice_count = (db.query(func.count(Invoice.invoice_id))
                       .filter(Invoice.lodge_id == lodge_id,
                               cast(Invoice.created_at, Date) >= window_start,
                               cast(Invoice.created_at, Date) <= window_end).scalar()) or 0
    adr = float(window_revenue) / invoice_count if invoice_count else 0
    # RevPAR = revenue / (rooms × days)
    room_days = total_rooms * days
    revpar = float(window_revenue) / room_days if room_days else 0

    # ── Previous-period baseline for "vs last period" deltas ─────
    # The same length of time, immediately preceding the current window.
    prev_end = window_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    prev_revenue = (db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
                      .filter(Invoice.lodge_id == lodge_id,
                              cast(Invoice.created_at, Date) >= prev_start,
                              cast(Invoice.created_at, Date) <= prev_end).scalar()) or 0
    prev_invoice_count = (db.query(func.count(Invoice.invoice_id))
                            .filter(Invoice.lodge_id == lodge_id,
                                    cast(Invoice.created_at, Date) >= prev_start,
                                    cast(Invoice.created_at, Date) <= prev_end).scalar()) or 0
    # Pct deltas — Infinity gets clamped to a sentinel value so the
    # frontend can render "↑ new" rather than blowing up.
    def pct_delta(curr, prev):
        if prev == 0:
            return 100.0 if curr > 0 else 0.0
        return ((float(curr) - float(prev)) / float(prev)) * 100

    # ── Revenue + occupancy time series (per day) ───────────────
    # Python-side grouping for cross-DB compatibility.
    invoices = (db.query(Invoice.created_at, Invoice.total_amount)
                  .filter(Invoice.lodge_id == lodge_id,
                          cast(Invoice.created_at, Date) >= window_start,
                          cast(Invoice.created_at, Date) <= window_end).all())
    revenue_by_day = {}
    for created_at, amt in invoices:
        if not created_at: continue
        key = (created_at.date() if hasattr(created_at, "date") else created_at).isoformat()
        revenue_by_day[key] = revenue_by_day.get(key, Decimal(0)) + (amt or Decimal(0))

    # Occupancy by day: count of active checkins overlapping each day.
    # Cheap proxy: query checkins whose actual_checkin/expected_checkout overlap
    # the window, then bucket.
    checkin_rows = (db.query(Checkin.checkin_datetime, Checkin.actual_checkout,
                                Checkin.expected_checkout)
                      .filter(Checkin.lodge_id == lodge_id,
                              Checkin.checkin_datetime != None,
                              # Anything that overlaps the window
                              (Checkin.actual_checkout >= datetime.combine(window_start, datetime.min.time()))
                                | (Checkin.actual_checkout == None)).all())
    occupied_by_day = {}
    for c_in, c_out, exp_out in checkin_rows:
        if not c_in: continue
        start = c_in.date() if hasattr(c_in, "date") else c_in
        end_dt = c_out or exp_out
        if not end_dt:
            end = today
        else:
            end = end_dt.date() if hasattr(end_dt, "date") else end_dt
        # Clip to window
        s = max(start, window_start)
        e = min(end, window_end)
        d = s
        while d <= e:
            key = d.isoformat()
            occupied_by_day[key] = occupied_by_day.get(key, 0) + 1
            d += timedelta(days=1)

    revenue_trend = []
    occupancy_trend = []
    cursor = window_start
    while cursor <= window_end:
        key = cursor.isoformat()
        rev = float(revenue_by_day.get(key, 0))
        occ = occupied_by_day.get(key, 0)
        occ_pct = (occ / total_rooms * 100) if total_rooms else 0
        revenue_trend.append({"date": key, "revenue_inr": rev})
        occupancy_trend.append({"date": key, "occupied": occ,
                                  "total_rooms": total_rooms,
                                  "occupancy_pct": round(occ_pct, 1)})
        cursor += timedelta(days=1)

    # ── Reviews ─────────────────────────────────────────────────
    review_q = db.query(Review).filter(Review.lodge_id == lodge_id,
                                          Review.status == ReviewStatus.published.value)
    total_reviews = review_q.count()
    if total_reviews:
        avg_rating = float(db.query(func.avg(Review.rating))
                              .filter(Review.lodge_id == lodge_id,
                                      Review.status == ReviewStatus.published.value).scalar() or 0)
    else:
        avg_rating = 0
    # Rating histogram (1-5)
    rating_histogram = {str(i): 0 for i in range(1, 6)}
    for rating, cnt in (db.query(Review.rating, func.count(Review.review_id))
                          .filter(Review.lodge_id == lodge_id,
                                  Review.status == ReviewStatus.published.value)
                          .group_by(Review.rating).all()):
        if 1 <= rating <= 5:
            rating_histogram[str(rating)] = cnt
    # Recent reviews (last 5) for the dashboard
    recent = (review_q.order_by(Review.created_at.desc()).limit(5).all())
    recent_reviews = [{
        "review_id":  r.review_id,
        "rating":     r.rating,
        "title":      r.title,
        "body":       (r.body or "")[:160],
        "author":     r.author_display_name or "Guest",
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in recent]

    # ── Booking source mix (windowed) ───────────────────────────
    # Both the legacy direct Booking table and the CustomerBooking (marketplace) flow.
    source_mix = []
    for src, cnt in (db.query(Booking.source, func.count(Booking.booking_id))
                       .filter(Booking.lodge_id == lodge_id,
                               cast(Booking.created_at, Date) >= window_start,
                               cast(Booking.created_at, Date) <= window_end)
                       .group_by(Booking.source).all()):
        # Source can be enum value or string depending on dialect
        src_str = src.value if hasattr(src, "value") else str(src)
        source_mix.append({"source": src_str, "count": cnt})
    # Add marketplace bookings as a separate "source"
    marketplace_count = (db.query(func.count(CustomerBooking.booking_id))
                           .filter(CustomerBooking.lodge_id == lodge_id,
                                   cast(CustomerBooking.created_at, Date) >= window_start,
                                   cast(CustomerBooking.created_at, Date) <= window_end).scalar()) or 0
    if marketplace_count > 0:
        source_mix.append({"source": "marketplace", "count": marketplace_count})

    # ── WhatsApp deliverability (windowed) ──────────────────────
    wa_total = (db.query(func.count(WhatsAppMessage.message_id))
                  .filter(WhatsAppMessage.lodge_id == lodge_id,
                          cast(WhatsAppMessage.created_at, Date) >= window_start,
                          cast(WhatsAppMessage.created_at, Date) <= window_end).scalar()) or 0
    wa_by_status = {s.value: 0 for s in WhatsAppMessageStatus}
    for s, cnt in (db.query(WhatsAppMessage.status,
                              func.count(WhatsAppMessage.message_id))
                     .filter(WhatsAppMessage.lodge_id == lodge_id,
                             cast(WhatsAppMessage.created_at, Date) >= window_start,
                             cast(WhatsAppMessage.created_at, Date) <= window_end)
                     .group_by(WhatsAppMessage.status).all()):
        if s in wa_by_status:
            wa_by_status[s] = cnt
    # Delivery rate
    delivered = wa_by_status.get("delivered", 0) + wa_by_status.get("read", 0)
    wa_delivery_pct = (delivered / wa_total * 100) if wa_total else 0

    return {
        "window": {
            "days":  days,
            "start": window_start.isoformat(),
            "end":   window_end.isoformat(),
        },
        "headline": {
            "today_revenue_inr":    float(today_revenue),
            "window_revenue_inr":   float(window_revenue),
            "occupancy_now_pct":    round(occupancy_pct_now, 1),
            "occupied_now":         occupied_now,
            "total_rooms":          total_rooms,
            "adr_inr":              round(adr, 2),
            "revpar_inr":           round(revpar, 2),
            "invoice_count":        invoice_count,
        },
        # v8.4.1 — previous-period baseline + pct deltas for "vs last period" UI
        "vs_previous_period": {
            "prev_window_start":         prev_start.isoformat(),
            "prev_window_end":           prev_end.isoformat(),
            "prev_window_revenue_inr":   float(prev_revenue),
            "prev_window_invoice_count": int(prev_invoice_count),
            "revenue_delta_pct":         round(pct_delta(window_revenue, prev_revenue), 1),
            "invoice_delta_pct":         round(pct_delta(invoice_count, prev_invoice_count), 1),
        },
        "revenue_trend":   revenue_trend,
        "occupancy_trend": occupancy_trend,
        "reviews": {
            "total":            total_reviews,
            "avg_rating":       round(avg_rating, 2),
            "histogram":        rating_histogram,
            "recent":           recent_reviews,
        },
        "booking_sources": source_mix,
        "whatsapp": {
            "total":         wa_total,
            "delivered_pct": round(wa_delivery_pct, 1),
            "by_status":     wa_by_status,
        },
    }
