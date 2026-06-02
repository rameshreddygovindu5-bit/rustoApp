"""Lodge subscription + billing endpoints — v8.0.

Lodge admin (own lodge only):
  GET    /api/billing/subscription              current sub + status + next charge
  POST   /api/billing/subscription/cancel       cancel current sub
  POST   /api/billing/subscription/issue-trial-invoice
                                                  manually trigger first invoice
                                                  (handy for end-of-trial billing)
  GET    /api/billing/invoices                  paginated invoice history
  GET    /api/billing/invoices/{id}/pdf         download invoice PDF

Super-admin (cross-tenant):
  GET    /api/billing/admin/subscriptions       all subs with status filter
  POST   /api/billing/admin/subscriptions/{id}/regenerate
                                                  recreate Subscription at provider
                                                  (used if the lodge approval ran
                                                  before billing creds were configured)

Webhook (Razorpay → us):
  POST   /api/webhooks/razorpay-billing         subscription lifecycle events
"""
import logging
import hmac
import hashlib
import os
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import (Lodge, User, Subscription, SubscriptionStatus,
                       BillingInvoice, BillingInvoiceStatus)
from ..auth import require_admin, require_super_admin, resolve_lodge_scope
from ..services import billing_service, pricing_service
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["billing"])

RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")


# ── Serialization ─────────────────────────────────────────────────

def _sub_dict(sub: Subscription) -> dict:
    pending = None
    if sub.pending_plan_key:
        from ..services import pricing_service
        meta = pricing_service.PLANS_BY_KEY.get(sub.pending_plan_key, {})
        pending = {
            "plan_key":         sub.pending_plan_key,
            "plan_name":        meta.get("name", sub.pending_plan_key),
            "billing_cycle":    sub.pending_billing_cycle,
            "total_rooms":      sub.pending_total_rooms,
            "takes_effect_at":  sub.pending_change_takes_effect_at.isoformat()
                                  if sub.pending_change_takes_effect_at else None,
            "queued_at":        sub.pending_change_queued_at.isoformat()
                                  if sub.pending_change_queued_at else None,
        }
    return {
        "subscription_id":          sub.subscription_id,
        "lodge_id":                  sub.lodge_id,
        "plan_key":                  sub.plan_key,
        "plan_name":                 sub.plan_name,
        "billing_cycle":             sub.billing_cycle,
        "per_cycle_amount_inr":      float(sub.per_cycle_amount_inr),
        "base_amount_inr":           float(sub.base_amount_inr),
        "total_rooms_at_signup":     sub.total_rooms_at_signup,
        "status":                    sub.status,
        "trial_until":               sub.trial_until.isoformat() if sub.trial_until else None,
        "current_period_start":      sub.current_period_start.isoformat() if sub.current_period_start else None,
        "current_period_end":        sub.current_period_end.isoformat() if sub.current_period_end else None,
        "next_charge_date":          sub.next_charge_date.isoformat() if sub.next_charge_date else None,
        "provider":                  sub.provider,
        "provider_short_url":        sub.provider_short_url,
        "is_provider_linked":        bool(sub.provider_subscription_id),
        "cancelled_at":              sub.cancelled_at.isoformat() if sub.cancelled_at else None,
        "cancellation_reason":       sub.cancellation_reason,
        # v8.3 — if set, sub is cancelling at period end (still active until then)
        "service_ends_at":           sub.service_ends_at.isoformat() if sub.service_ends_at else None,
        "is_cancelling_at_period_end": bool(sub.service_ends_at and sub.status != SubscriptionStatus.cancelled.value),
        "last_failure_at":           sub.last_failure_at.isoformat() if sub.last_failure_at else None,
        "last_failure_reason":       sub.last_failure_reason,
        "created_at":                sub.created_at.isoformat() if sub.created_at else None,
        "pending_change":            pending,
    }


def _invoice_dict(inv: BillingInvoice) -> dict:
    return {
        "invoice_id":      inv.invoice_id,
        "invoice_number":  inv.invoice_number,
        "period_start":    inv.period_start.isoformat(),
        "period_end":      inv.period_end.isoformat(),
        "bill_to_name":    inv.bill_to_name,
        "subtotal_inr":    float(inv.subtotal_inr),
        "gst_rate_pct":    float(inv.gst_rate_pct),
        "gst_amount_inr":  float(inv.gst_amount_inr),
        "total_inr":       float(inv.total_inr),
        "status":          inv.status,
        "issued_at":       inv.issued_at.isoformat() if inv.issued_at else None,
        "paid_at":         inv.paid_at.isoformat() if inv.paid_at else None,
        "has_pdf":         bool(inv.pdf_blob),
    }


# ── Lodge admin: subscription ─────────────────────────────────────

@router.get("/api/billing/subscription")
def get_my_subscription(lodge_id: int = Depends(resolve_lodge_scope),
                          current_user: User = Depends(require_admin),
                          db: Session = Depends(get_db)):
    """Returns the lodge's current subscription. If somehow there isn't
    one (lodge created before billing existed), returns null + plan
    catalog so the lodge can self-subscribe."""
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        return {
            "subscription": None,
            "message": "No active subscription found. Contact support to set one up.",
            "available_plans": [pricing_service.serialize_plan(p)
                                 for p in pricing_service.PLANS],
        }
    return {"subscription": _sub_dict(sub)}


class CancelBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=2000)
    # v8.3 — cancel options
    at_period_end: bool = Field(default=True,
                                 description="Default True: keep service until period end, no refund. False: cancel immediately.")
    with_refund: bool = Field(default=False,
                                description="Only meaningful when at_period_end=False. If true, issue prorated refund for unused days.")


@router.post("/api/billing/subscription/cancel")
def cancel_my_subscription(body: CancelBody, request: Request,
                              lodge_id: int = Depends(resolve_lodge_scope),
                              current_user: User = Depends(require_admin),
                              db: Session = Depends(get_db)):
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription to cancel")
    if sub.status == SubscriptionStatus.cancelled.value:
        return {"subscription": _sub_dict(sub), "refund": None, "already_cancelled": True}

    result = billing_service.cancel_subscription_v2(
        db, sub,
        reason=body.reason or "Cancelled by lodge admin",
        at_period_end=body.at_period_end,
        with_refund=body.with_refund,
        actor=current_user,
    )
    try:
        log_audit(db, "billing.subscription_cancelled",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="subscription", entity_id=sub.subscription_id,
                  lodge_id=lodge_id,
                  details={"reason": body.reason,
                           "at_period_end": body.at_period_end,
                           "with_refund": body.with_refund,
                           "refund_amount": (float(result["refund"].total_refund_inr)
                                              if result.get("refund") else None)},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass

    return {
        "subscription": _sub_dict(result["sub"]),
        "refund": _refund_dict(result["refund"]) if result.get("refund") else None,
        "at_period_end": body.at_period_end,
        "with_refund": body.with_refund,
    }


@router.get("/api/billing/subscription/refund-preview")
def refund_preview(lodge_id: int = Depends(resolve_lodge_scope),
                     current_user: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    """Preview the refund amount BEFORE the lodge commits to cancellation
    with refund. Powers the cancel-confirmation modal."""
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found")
    calc = billing_service.calculate_refund_for_cancellation(db, sub)
    if not calc:
        return {"eligible": False,
                "reason": "No paid invoice for the current period, or the period has ended."}
    return calc


@router.get("/api/billing/refunds")
def list_refunds(page: int = Query(1, ge=1),
                   page_size: int = Query(50, ge=1, le=200),
                   lodge_id: int = Depends(resolve_lodge_scope),
                   current_user: User = Depends(require_admin),
                   db: Session = Depends(get_db)):
    """Lodge admin: refund history."""
    from ..models import BillingRefund
    q = db.query(BillingRefund).filter(BillingRefund.lodge_id == lodge_id)
    total = q.count()
    rows = (q.order_by(BillingRefund.created_at.desc())
              .offset((page - 1) * page_size).limit(page_size).all())
    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "refunds":   [_refund_dict(r) for r in rows],
    }


def _refund_dict(r) -> dict:
    """Serialize a BillingRefund row."""
    return {
        "refund_id":               r.refund_id,
        "refund_number":           r.refund_number,
        "original_invoice_id":     r.original_invoice_id,
        "period_start":            r.period_start.isoformat(),
        "period_end":              r.period_end.isoformat(),
        "unused_days":             r.unused_days,
        "total_period_days":       r.total_period_days,
        "subtotal_inr":            float(r.subtotal_inr),
        "gst_amount_inr":          float(r.gst_amount_inr),
        "total_refund_inr":        float(r.total_refund_inr),
        "status":                  r.status,
        "reason":                  r.reason,
        "failure_reason":          r.failure_reason,
        "razorpay_refund_id":      r.razorpay_refund_id,
        "requested_at":            r.requested_at.isoformat() if r.requested_at else None,
        "processed_at":            r.processed_at.isoformat() if r.processed_at else None,
    }


@router.post("/api/billing/subscription/issue-trial-invoice")
def issue_trial_invoice(request: Request,
                          lodge_id: int = Depends(resolve_lodge_scope),
                          current_user: User = Depends(require_admin),
                          db: Session = Depends(get_db)):
    """Manually issue the first invoice for a subscription that's still
    in trial. Useful in two cases:
      1. Lodge wants to pay immediately (skip trial).
      2. Mock-provider dev environments — the auto-charge webhook never
         fires, so this is how we exercise the invoice generation path.

    Generates one invoice for the trial period and rolls the subscription
    to its first paid cycle. Returns the new invoice."""
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found")
    if sub.status != SubscriptionStatus.trialing.value:
        raise HTTPException(status_code=400,
                            detail=f"Subscription is {sub.status!r}, not trialing")

    # Issue the invoice for the trial period + roll forward.
    invoice = billing_service.issue_invoice(
        db, sub,
        period_start=sub.current_period_start or date.today(),
        period_end=sub.current_period_end or (date.today() + timedelta(days=30)),
        mark_paid=True,    # dev mode: instantly settled
    )
    # Activate the subscription + roll forward.
    sub.status = SubscriptionStatus.active.value
    if sub.billing_cycle == "monthly":
        sub.current_period_start = sub.current_period_end
        sub.current_period_end = sub.current_period_start + timedelta(days=30)
    else:
        sub.current_period_start = sub.current_period_end
        sub.current_period_end = sub.current_period_start + timedelta(days=365)
    sub.next_charge_date = sub.current_period_end
    db.commit(); db.refresh(sub)

    try:
        log_audit(db, "billing.trial_invoice_issued",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="billing_invoice", entity_id=invoice.invoice_id,
                  lodge_id=lodge_id,
                  details={"invoice_number": invoice.invoice_number,
                           "total_inr": float(invoice.total_inr)},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return _invoice_dict(invoice)


# ── Lodge admin: invoices ─────────────────────────────────────────

@router.get("/api/billing/invoices")
def list_invoices(status: Optional[str] = None,
                    page: int = Query(1, ge=1),
                    page_size: int = Query(50, ge=1, le=200),
                    lodge_id: int = Depends(resolve_lodge_scope),
                    current_user: User = Depends(require_admin),
                    db: Session = Depends(get_db)):
    q = db.query(BillingInvoice).filter(BillingInvoice.lodge_id == lodge_id)
    if status:
        q = q.filter(BillingInvoice.status == status)
    total = q.count()
    rows = (q.order_by(BillingInvoice.issued_at.desc())
              .offset((page - 1) * page_size).limit(page_size).all())

    # Summary across all invoices (not just this page).
    paid_total = (db.query(func.coalesce(func.sum(BillingInvoice.total_inr), 0))
                    .filter(BillingInvoice.lodge_id == lodge_id,
                            BillingInvoice.status == BillingInvoiceStatus.paid.value)
                    .scalar())
    open_count = (db.query(func.count(BillingInvoice.invoice_id))
                    .filter(BillingInvoice.lodge_id == lodge_id,
                            BillingInvoice.status == BillingInvoiceStatus.open.value)
                    .scalar())
    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "invoices":  [_invoice_dict(i) for i in rows],
        "summary":   {
            "lifetime_paid_inr":  float(paid_total or 0),
            "open_invoice_count": int(open_count or 0),
        },
    }


@router.get("/api/billing/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int,
                            lodge_id: int = Depends(resolve_lodge_scope),
                            current_user: User = Depends(require_admin),
                            db: Session = Depends(get_db)):
    inv = (db.query(BillingInvoice)
              .filter(BillingInvoice.invoice_id == invoice_id,
                      BillingInvoice.lodge_id == lodge_id).first())
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not inv.pdf_blob:
        try:
            billing_service.regenerate_invoice_pdf(db, inv)
        except Exception as e:
            logger.exception("Failed to regenerate PDF: %s", e)
            raise HTTPException(status_code=500, detail="PDF unavailable")
    return Response(
        content=inv.pdf_blob,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'attachment; filename="{inv.invoice_number}.pdf"',
        },
    )


# ── Super-admin: cross-tenant view ────────────────────────────────

@router.get("/api/billing/admin/metrics")
def billing_metrics(current_user: User = Depends(require_super_admin),
                       db: Session = Depends(get_db)):
    """Aggregated SaaS metrics across all lodges. Powers the super-admin
    billing dashboard.

    MRR convention: annual subs contribute (per_cycle / 10) — matches our
    pricing where annual = 10× monthly. Cancelled/paused don't count.

    All money fields are floats (JSON-friendly) in INR.
    """
    from datetime import date, timedelta
    from decimal import Decimal
    today = date.today()

    # ── Headline: MRR / ARR ──────────────────────────────────────
    # Sum normalized monthly contribution from active subscriptions.
    active_subs = (db.query(Subscription)
                     .filter(Subscription.status.in_([
                         SubscriptionStatus.active.value,
                         SubscriptionStatus.trialing.value,
                     ]))
                     .all())
    mrr = Decimal(0)
    for s in active_subs:
        per_cycle = s.per_cycle_amount_inr or Decimal(0)
        if s.billing_cycle == "annual":
            mrr += per_cycle / Decimal(10)   # annual = 10× monthly
        else:
            mrr += per_cycle
    arr = mrr * Decimal(12)

    # ── Lifetime revenue (sum of all paid invoices) ──────────────
    lifetime_revenue = (db.query(func.coalesce(func.sum(BillingInvoice.total_inr), 0))
                          .filter(BillingInvoice.status == BillingInvoiceStatus.paid.value)
                          .scalar()) or 0

    # ── Status / plan / cycle breakdowns ─────────────────────────
    by_status = dict((s.value, 0) for s in SubscriptionStatus)
    for s, c in (db.query(Subscription.status, func.count(Subscription.subscription_id))
                   .group_by(Subscription.status).all()):
        if s in by_status: by_status[s] = c

    # MRR per plan key (so super-admin sees which tier drives revenue)
    plan_mrr = {}
    plan_count = {}
    for s in active_subs:
        per_month = (s.per_cycle_amount_inr / Decimal(10)) if s.billing_cycle == "annual" else s.per_cycle_amount_inr
        plan_mrr[s.plan_key] = plan_mrr.get(s.plan_key, Decimal(0)) + per_month
        plan_count[s.plan_key] = plan_count.get(s.plan_key, 0) + 1
    plan_breakdown = [
        {"plan_key": k, "active_count": plan_count[k], "mrr_inr": float(plan_mrr[k])}
        for k in plan_mrr
    ]

    # Cycle mix among active subs
    cycle_count = {"monthly": 0, "annual": 0}
    for s in active_subs:
        cycle_count[s.billing_cycle] = cycle_count.get(s.billing_cycle, 0) + 1

    # ── Trial expiring soon (7 days, conversion candidates) ─────
    expiring_threshold = today + timedelta(days=7)
    expiring_trials = (db.query(Subscription)
                         .filter(Subscription.status == SubscriptionStatus.trialing.value,
                                 Subscription.trial_until.isnot(None),
                                 Subscription.trial_until <= expiring_threshold)
                         .order_by(Subscription.trial_until.asc())
                         .all())

    # ── Past-due (need attention) ────────────────────────────────
    past_due = (db.query(Subscription)
                  .filter(Subscription.status == SubscriptionStatus.past_due.value)
                  .order_by(Subscription.last_failure_at.desc().nullslast())
                  .all())

    # Resolve lodge names in one query for both above lists.
    attention_ids = {s.lodge_id for s in expiring_trials + past_due}
    lodges_map = {l.lodge_id: l for l in
                   db.query(Lodge).filter(Lodge.lodge_id.in_(attention_ids)).all()
                  } if attention_ids else {}

    def _attention_row(s, days_field=None):
        lodge = lodges_map.get(s.lodge_id)
        days = None
        if days_field and getattr(s, days_field):
            days = max(0, (getattr(s, days_field) - today).days)
        return {
            "subscription_id":  s.subscription_id,
            "lodge_id":         s.lodge_id,
            "lodge_name":       lodge.name if lodge else "(deleted)",
            "lodge_code":       lodge.code if lodge else None,
            "plan_name":        s.plan_name,
            "plan_key":         s.plan_key,
            "billing_cycle":    s.billing_cycle,
            "per_cycle_amount_inr": float(s.per_cycle_amount_inr or 0),
            "trial_until":      s.trial_until.isoformat() if s.trial_until else None,
            "trial_days_left":  days if days_field == "trial_until" else None,
            "last_failure_at":  s.last_failure_at.isoformat() if s.last_failure_at else None,
            "last_failure_reason": s.last_failure_reason,
        }

    # ── Cohort: new + cancelled this month ──────────────────────
    month_start = today.replace(day=1)
    new_this_month = (db.query(func.count(Subscription.subscription_id))
                        .filter(Subscription.created_at >= month_start)
                        .scalar()) or 0
    cancelled_this_month = (db.query(func.count(Subscription.subscription_id))
                              .filter(Subscription.cancelled_at >= month_start)
                              .scalar()) or 0

    # ── Monthly revenue series (last 6 months from paid invoices) ─
    # Group by YYYY-MM. SQLite + Postgres both handle strftime/to_char
    # differently, so we do it Python-side off a single query.
    six_months_ago = (today.replace(day=1) - timedelta(days=180)).replace(day=1)
    invoices = (db.query(BillingInvoice.issued_at, BillingInvoice.total_inr)
                  .filter(BillingInvoice.status == BillingInvoiceStatus.paid.value,
                          BillingInvoice.issued_at >= six_months_ago)
                  .all())
    monthly_revenue = {}
    for issued_at, total in invoices:
        key = issued_at.strftime("%Y-%m") if issued_at else "unknown"
        monthly_revenue[key] = monthly_revenue.get(key, Decimal(0)) + (total or Decimal(0))
    # Build the last 6 months explicitly so the chart has zeros for empty months
    series = []
    cursor = today.replace(day=1)
    for _ in range(6):
        key = cursor.strftime("%Y-%m")
        series.insert(0, {
            "month":       key,
            "label":       cursor.strftime("%b %Y"),
            "revenue_inr": float(monthly_revenue.get(key, Decimal(0))),
        })
        # Step back one month (calendar-safe)
        prev = cursor - timedelta(days=1)
        cursor = prev.replace(day=1)

    return {
        "headline": {
            "mrr_inr":              float(mrr),
            "arr_inr":              float(arr),
            "lifetime_revenue_inr": float(lifetime_revenue),
            "active_subscriptions": by_status.get("active", 0)
                                      + by_status.get("trialing", 0),
        },
        "breakdowns": {
            "by_status":  by_status,
            "by_plan":    sorted(plan_breakdown,
                                  key=lambda p: -p["mrr_inr"]),
            "by_cycle":   cycle_count,
        },
        "cohort_this_month": {
            "new_subscriptions":  new_this_month,
            "cancellations":      cancelled_this_month,
        },
        "attention": {
            "expiring_trials":   [_attention_row(s, "trial_until") for s in expiring_trials],
            "past_due_subs":     [_attention_row(s) for s in past_due],
        },
        "monthly_revenue_series": series,
    }


@router.get("/api/billing/admin/lodges/{lodge_id}/invoices")
def admin_list_lodge_invoices(lodge_id: int,
                                 page: int = Query(1, ge=1),
                                 page_size: int = Query(50, ge=1, le=200),
                                 current_user: User = Depends(require_super_admin),
                                 db: Session = Depends(get_db)):
    """Super-admin drilldown: invoices for ANY lodge (bypasses the
    tenant scope that lodge-side `/billing/invoices` enforces)."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    q = db.query(BillingInvoice).filter(BillingInvoice.lodge_id == lodge_id)
    total = q.count()
    rows = (q.order_by(BillingInvoice.issued_at.desc())
              .offset((page - 1) * page_size).limit(page_size).all())
    return {
        "lodge":     {"lodge_id": lodge.lodge_id, "code": lodge.code, "name": lodge.name},
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "invoices":  [_invoice_dict(i) for i in rows],
    }


@router.post("/api/billing/admin/subscriptions/{subscription_id}/force-cancel")
def admin_force_cancel(subscription_id: int, body: CancelBody, request: Request,
                          current_user: User = Depends(require_super_admin),
                          db: Session = Depends(get_db)):
    """Super-admin emergency cancel — for fraud, abuse, billing errors, etc.
    Skips the per-lodge auth check so super-admin can cancel any sub.
    Audit-logged separately from the lodge-side cancel."""
    sub = (db.query(Subscription)
              .filter(Subscription.subscription_id == subscription_id).first())
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if sub.status == SubscriptionStatus.cancelled.value:
        return _sub_dict(sub)
    sub = billing_service.cancel_subscription(
        db, sub, reason=body.reason or "Cancelled by super-admin", actor=current_user)
    try:
        log_audit(db, "billing.admin_force_cancelled",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="subscription", entity_id=sub.subscription_id,
                  lodge_id=sub.lodge_id,
                  details={"reason": body.reason},
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return _sub_dict(sub)


@router.get("/api/billing/admin/subscriptions")
def list_all_subscriptions(status: Optional[str] = None,
                              plan: Optional[str] = None,
                              current_user: User = Depends(require_super_admin),
                              db: Session = Depends(get_db)):
    """Super-admin overview: all lodge subscriptions + lifetime revenue."""
    q = db.query(Subscription)
    if status: q = q.filter(Subscription.status == status)
    if plan:   q = q.filter(Subscription.plan_key == plan)
    subs = q.order_by(Subscription.created_at.desc()).all()

    # Enrich with lodge name for the table.
    lodge_ids = {s.lodge_id for s in subs}
    lodge_map = {l.lodge_id: l for l in
                  db.query(Lodge).filter(Lodge.lodge_id.in_(lodge_ids)).all()
                 } if lodge_ids else {}

    # Revenue summary.
    revenue = (db.query(func.coalesce(func.sum(BillingInvoice.total_inr), 0))
                  .filter(BillingInvoice.status == BillingInvoiceStatus.paid.value)
                  .scalar()) or 0
    by_status = (db.query(Subscription.status, func.count(Subscription.subscription_id))
                  .group_by(Subscription.status).all())
    status_counts = {s.value: 0 for s in SubscriptionStatus}
    for s, c in by_status:
        if s in status_counts:
            status_counts[s] = c

    return {
        "subscriptions": [
            {**_sub_dict(s),
             "lodge_name": lodge_map.get(s.lodge_id).name if lodge_map.get(s.lodge_id) else None,
             "lodge_code": lodge_map.get(s.lodge_id).code if lodge_map.get(s.lodge_id) else None}
            for s in subs
        ],
        "summary": {
            "total_subscriptions":  len(subs),
            "lifetime_revenue_inr": float(revenue),
            "status_counts":        status_counts,
        },
    }


# ── Lodge admin: plan changes ─────────────────────────────────────

class PlanChangeBody(BaseModel):
    new_plan_key: str = Field(min_length=1, max_length=20)
    new_billing_cycle: Optional[str] = Field(default=None, pattern="^(monthly|annual)$")
    new_total_rooms: Optional[int] = Field(default=None, ge=1, le=10000)


@router.post("/api/billing/subscription/preview-change")
def preview_change(body: PlanChangeBody,
                     lodge_id: int = Depends(resolve_lodge_scope),
                     current_user: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    """Show what changing the plan would cost — no mutation. Powers the
    "review change" step of the plan-change wizard so the lodge admin
    sees the prorated charge or "takes effect on X date" copy before
    committing."""
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found")
    try:
        return billing_service.preview_plan_change(
            db, sub,
            new_plan_key=body.new_plan_key,
            new_billing_cycle=body.new_billing_cycle,
            new_total_rooms=body.new_total_rooms,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/billing/subscription/change-plan")
def change_plan(body: PlanChangeBody, request: Request,
                  lodge_id: int = Depends(resolve_lodge_scope),
                  current_user: User = Depends(require_admin),
                  db: Session = Depends(get_db)):
    """Commit a plan change. Upgrades go through immediately with a
    prorated charge; downgrades / cycle changes / room reductions schedule
    for end-of-period.
    """
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found")
    try:
        result = billing_service.apply_plan_change(
            db, sub,
            new_plan_key=body.new_plan_key,
            new_billing_cycle=body.new_billing_cycle,
            new_total_rooms=body.new_total_rooms,
            actor_user_id=current_user.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        log_audit(db, "billing.plan_changed",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="subscription", entity_id=sub.subscription_id,
                  lodge_id=lodge_id,
                  details={
                      "from": {"plan": result["current"]["plan_key"],
                                "cycle": result["current"]["billing_cycle"]},
                      "to":   {"plan": result["next"]["plan_key"],
                                "cycle": result["next"]["billing_cycle"]},
                      "rooms": result["next"]["total_rooms"],
                      "took_effect": result["change_takes_effect"],
                      "immediate_charge_inr": result["immediate_charge_inr"],
                  },
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return result


@router.post("/api/billing/subscription/cancel-pending-change")
def cancel_pending(request: Request,
                     lodge_id: int = Depends(resolve_lodge_scope),
                     current_user: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    """Undo a scheduled plan change. The lodge keeps their current plan
    + cycle as if the change had never been queued. Idempotent."""
    sub = db.query(Subscription).filter(Subscription.lodge_id == lodge_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found")
    if not sub.pending_plan_key:
        return _sub_dict(sub)
    sub = billing_service.cancel_pending_plan_change(db, sub)
    try:
        log_audit(db, "billing.pending_change_cancelled",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="subscription", entity_id=sub.subscription_id,
                  lodge_id=lodge_id,
                  ip_address=request.client.host if request.client else None)
    except Exception: pass
    return _sub_dict(sub)


# ── Admin: ops actions ────────────────────────────────────────────

@router.post("/api/billing/admin/run-renewal-reminders")
def run_renewal_reminders_now(days_ahead: int = Query(3, ge=0, le=30),
                                current_user: User = Depends(require_super_admin),
                                db: Session = Depends(get_db)):
    """Manually trigger the daily renewal-reminder batch. Useful for
    on-demand catchup if the scheduled job missed a run, and for
    exercising the email pathway in dev/staging."""
    summary = billing_service.send_renewal_reminders_due(db, days_ahead=days_ahead)
    return {"days_ahead": days_ahead, **summary}


@router.post("/api/billing/admin/realize-pending-changes")
def realize_pending_changes_now(current_user: User = Depends(require_super_admin),
                                   db: Session = Depends(get_db)):
    """Manually apply any pending plan changes whose effective date has
    arrived (or is in the past). Also realizes at-period-end cancellations
    that are due. Same logic as the daily scheduled job."""
    plan_changes = billing_service.realize_due_plan_changes(db)
    cancellations = billing_service.realize_due_cancellations(db)
    return {"plan_changes": plan_changes, "cancellations": cancellations}


@router.post("/api/billing/invoices/{invoice_id}/resend-email")
def resend_invoice_email(invoice_id: int,
                            lodge_id: int = Depends(resolve_lodge_scope),
                            current_user: User = Depends(require_admin),
                            db: Session = Depends(get_db)):
    """Re-trigger the invoice email. Resets `email_sent_at` first so the
    idempotency check inside `send_invoice_email` doesn't block the resend."""
    inv = (db.query(BillingInvoice)
              .filter(BillingInvoice.invoice_id == invoice_id,
                      BillingInvoice.lodge_id == lodge_id).first())
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    sub = db.query(Subscription).filter(Subscription.subscription_id == inv.subscription_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    inv.email_sent_at = None
    db.commit()
    ok = billing_service.send_invoice_email(db, inv, sub)
    return {"sent": ok,
            "bill_to_email": inv.bill_to_email,
            "message": "Invoice emailed" if ok
                       else "Email send failed — check SMTP settings"}


# ── Razorpay webhook ──────────────────────────────────────────────

def _verify_razorpay_webhook_signature(body: bytes, signature: str) -> bool:
    """Razorpay signs each webhook with the webhook secret. Skip
    verification entirely when no secret is configured (dev mode) — the
    payload is still accepted but logged."""
    if not RAZORPAY_WEBHOOK_SECRET:
        return True
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(),
                        body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


# Map Razorpay event names → our internal status transitions.
EVENT_TO_STATUS = {
    "subscription.activated": "active",
    "subscription.charged":   "active",
    "subscription.halted":    "past_due",
    "subscription.paused":    "paused",
    "subscription.cancelled": "cancelled",
    "subscription.completed": "cancelled",
}


@router.post("/api/webhooks/razorpay-billing")
async def razorpay_billing_webhook(request: Request,
                                       db: Session = Depends(get_db)):
    """Razorpay posts here for subscription lifecycle events. We validate
    the signature (when secret is configured), look up the subscription
    by provider ID, and apply the status transition.

    Charge events also trigger invoice issuance via apply_subscription_status."""
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    if not _verify_razorpay_webhook_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "note": "empty body"}

    event = payload.get("event")
    new_status = EVENT_TO_STATUS.get(event)
    if not new_status:
        # Not a subscription event we care about (e.g., payment.captured
        # for one-off booking payments). Acknowledge silently.
        return {"ok": True, "ignored": event}

    # Razorpay payload structure:
    #   payload.subscription.entity = the Subscription resource
    #   payload.payment.entity      = the Payment (on charged events)
    sub_entity = (payload.get("payload") or {}).get("subscription", {}).get("entity") or {}
    payment_entity = (payload.get("payload") or {}).get("payment", {}).get("entity") or {}
    sub_id = sub_entity.get("id")
    payment_id = payment_entity.get("id")
    failure_reason = payment_entity.get("error_description")

    if not sub_id:
        return {"ok": True, "note": "no subscription id in payload"}

    ok = billing_service.apply_subscription_status(
        db, provider_subscription_id=sub_id,
        new_status=new_status, payment_id=payment_id,
        failure_reason=failure_reason,
    )
    return {"ok": True, "event": event, "applied": ok}
