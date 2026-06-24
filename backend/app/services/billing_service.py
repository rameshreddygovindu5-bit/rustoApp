"""Lodge subscription + billing service — v8.0.

Provider abstraction:
  - `MockBillingProvider` — default. Returns fake subscription + payment
    IDs so the wizard → approval → billing → invoice loop is exercisable
    end-to-end without a live Razorpay account. Charges "succeed"
    instantly so dev can flip status to active manually.
  - `RazorpayBillingProvider` — real provider. Calls Razorpay's Plans +
    Subscriptions + Invoices REST APIs. No SDK dependency; we use the
    same inline `requests` pattern as the existing booking-side Razorpay
    integration in rusto_bookings.

Subscription lifecycle:
  approve_registration → create_subscription_for_lodge() → status=trialing
  customer authorises → webhook subscription.activated → status=active
  each cycle:           → webhook subscription.charged → BillingInvoice.paid
  charge fails:         → webhook subscription.halted → status=past_due
  customer cancels:     → webhook subscription.cancelled → status=cancelled

Invoice numbering:
  RST-INV-YYYYMM-NNNN where NNNN is per-month sequence across all lodges.
  Stable, sortable, accountant-friendly. Generated inside `_next_invoice_number`
  with a SELECT-then-INSERT pattern (good enough at our scale; a real
  monotonic sequence would need DB-level support).

PDF generation:
  Uses reportlab (already a top-level requirement). Generated on issue
  + cached in `pdf_blob` column. Regenerated on demand if missing.
"""
from __future__ import annotations
import io
import os
import re
import logging
from abc import ABC, abstractmethod
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from sqlalchemy.orm import Session
from sqlalchemy import func

from ..models import (Lodge, User, Subscription, SubscriptionStatus,
                       BillingInvoice, BillingInvoiceStatus)
from . import pricing_service

logger = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────────

# Reuse the same env vars + dev-detection logic as the booking-side
# Razorpay integration so the test-mode behaviour is consistent.
RAZORPAY_KEY_ID     = os.getenv("RAZORPAY_KEY_ID", "rzp_test_DUMMY_KEY")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "DUMMY_SECRET_FOR_DEV")
RAZORPAY_LIVE = not RAZORPAY_KEY_ID.startswith("rzp_test_DUMMY")
# Force-mock flag for tests, even when other Razorpay calls are live.
FORCE_MOCK = os.getenv("BILLING_FORCE_MOCK", "").lower() in ("1", "true", "yes")

# Trial window for new subscriptions (no charges in this period).
DEFAULT_TRIAL_DAYS = int(os.getenv("BILLING_TRIAL_DAYS", "14"))

# India SaaS GST. 18% standard. Settable per environment if needed.
DEFAULT_GST_PCT = Decimal(os.getenv("BILLING_GST_PCT", "18"))


# ── Provider abstraction ──────────────────────────────────────────

class BillingProvider(ABC):
    """Subscription billing provider. Each method returns a dict the
    caller logs onto the Subscription / BillingInvoice rows."""

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @abstractmethod
    def ensure_plan(self, *, plan_key: str, plan_name: str,
                    amount_inr: Decimal, billing_cycle: str) -> str:
        """Create-or-reuse a provider Plan resource. Returns the provider's
        plan ID. Idempotent — callable on every subscription creation."""

    @abstractmethod
    def create_subscription(self, *, provider_plan_id: str,
                             customer_email: str, customer_name: str,
                             customer_phone: str, total_count: int) -> Dict[str, Any]:
        """Returns {id: str, short_url: str, customer_id: str|None}.

        `total_count` is how many billing cycles to schedule (e.g., 12 for
        a year of monthly billing). Razorpay requires this up-front.
        """

    @abstractmethod
    def cancel_subscription(self, provider_subscription_id: str,
                              cancel_at_cycle_end: bool = False) -> bool:
        """Cancel the subscription at the provider. Returns True on success.

        cancel_at_cycle_end: if True, the provider should let the current
          billing cycle complete (don't refund, don't stop service mid-cycle)
          and then stop. If False, cancel immediately.
        """


class MockBillingProvider(BillingProvider):
    provider_name = "mock"

    def ensure_plan(self, *, plan_key, plan_name, amount_inr, billing_cycle):
        # Deterministic per-config so re-runs collide (idempotent).
        return f"plan_mock_{plan_key}_{billing_cycle}"

    def create_subscription(self, *, provider_plan_id, customer_email,
                              customer_name, customer_phone, total_count):
        import secrets
        sid = f"sub_mock_{secrets.token_hex(8)}"
        cid = f"cust_mock_{secrets.token_hex(8)}"
        logger.info("Billing[mock] subscription %s for %s (%d cycles)",
                    sid, customer_email, total_count)
        return {
            "id":          sid,
            "customer_id": cid,
            "short_url":   f"https://rzp.io/mock/i/{sid}",
        }

    def cancel_subscription(self, provider_subscription_id,
                              cancel_at_cycle_end=False):
        logger.info("Billing[mock] cancel %s (cycle_end=%s)",
                    provider_subscription_id, cancel_at_cycle_end)
        return True


class RazorpayBillingProvider(BillingProvider):
    provider_name = "razorpay"

    def __init__(self, key_id: str, key_secret: str):
        self.key_id = key_id
        self.key_secret = key_secret

    def _post(self, path: str, json_body: dict) -> dict:
        import requests
        r = requests.post(
            f"https://api.razorpay.com{path}",
            auth=(self.key_id, self.key_secret),
            json=json_body, timeout=20,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Razorpay {path} failed [{r.status_code}]: {r.text[:300]}")
        return r.json()

    def ensure_plan(self, *, plan_key, plan_name, amount_inr, billing_cycle):
        # Razorpay's plan model:
        #   period: 'monthly' | 'yearly'
        #   interval: 1
        #   item.amount in paise
        body = {
            "period": "monthly" if billing_cycle == "monthly" else "yearly",
            "interval": 1,
            "item": {
                "name": f"Rusto {plan_name} ({billing_cycle})",
                "amount": int(amount_inr * 100),  # paise
                "currency": "INR",
                "description": f"Rusto {plan_name} subscription, {billing_cycle} billing",
            },
            "notes": {"plan_key": plan_key, "billing_cycle": billing_cycle},
        }
        return self._post("/v1/plans", body)["id"]

    def create_subscription(self, *, provider_plan_id, customer_email,
                              customer_name, customer_phone, total_count):
        body = {
            "plan_id":        provider_plan_id,
            "total_count":    total_count,
            "customer_notify": 1,
            "notes": {"source": "rusto_onboarding"},
            "notify_info": {
                "notify_phone": customer_phone or "",
                "notify_email": customer_email or "",
            },
        }
        resp = self._post("/v1/subscriptions", body)
        return {
            "id":          resp["id"],
            "customer_id": resp.get("customer_id"),
            "short_url":   resp.get("short_url"),
        }

    def cancel_subscription(self, provider_subscription_id,
                              cancel_at_cycle_end=False):
        try:
            # Razorpay's subscription cancel API supports cancel_at_cycle_end
            # in the request body. Without it (= 0) it cancels immediately;
            # with it (= 1) the current cycle completes first.
            self._post(f"/v1/subscriptions/{provider_subscription_id}/cancel",
                        {"cancel_at_cycle_end": 1 if cancel_at_cycle_end else 0})
            return True
        except RuntimeError as e:
            logger.warning("Razorpay cancel failed: %s", e)
            return False


def get_provider() -> BillingProvider:
    """Pick the active provider based on env config."""
    if FORCE_MOCK or not RAZORPAY_LIVE:
        return MockBillingProvider()
    return RazorpayBillingProvider(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)


# ── Subscription creation ─────────────────────────────────────────

def create_subscription_for_lodge(db: Session, *, lodge: Lodge, plan_key: str,
                                    billing_cycle: str, total_rooms: int,
                                    owner_email: str, owner_name: str,
                                    owner_phone: str,
                                    trial_days: int = DEFAULT_TRIAL_DAYS
                                    ) -> Subscription:
    """Create a Subscription row + register the Plan + Subscription with
    the provider. Idempotent — if a Subscription already exists for the
    lodge, returns it unchanged.

    `total_count` for Razorpay: we set 12 (one year of cycles) by default
    for both monthly and annual billing — easy to renew via the
    'recurring renewal' webhook later. A future round can extend this to
    perpetual / auto-renewal logic.
    """
    existing = (db.query(Subscription)
                  .filter(Subscription.lodge_id == lodge.lodge_id).first())
    if existing:
        return existing

    quote = pricing_service.calculate_quote(plan_key, total_rooms, billing_cycle)
    if not quote:
        raise ValueError(f"Unknown plan {plan_key!r}")

    provider = get_provider()
    plan_meta = quote["plan"]

    try:
        provider_plan_id = provider.ensure_plan(
            plan_key=plan_key,
            plan_name=plan_meta["name"],
            amount_inr=quote["price_now_inr"],
            billing_cycle=billing_cycle,
        )
        # 12 cycles for monthly, 3 for annual (= 3 years; renew later).
        total_count = 12 if billing_cycle == "monthly" else 3
        sub_resp = provider.create_subscription(
            provider_plan_id=provider_plan_id,
            customer_email=owner_email,
            customer_name=owner_name,
            customer_phone=owner_phone,
            total_count=total_count,
        )
    except Exception as e:
        # Don't block the lodge approval if billing provider is misconfigured;
        # super-admin can re-trigger subscription creation later.
        logger.exception("Billing provider error during subscription create: %s", e)
        provider_plan_id = None
        sub_resp = {"id": None, "customer_id": None, "short_url": None}

    today = date.today()
    trial_end = today + timedelta(days=trial_days)
    sub = Subscription(
        lodge_id=lodge.lodge_id,
        plan_key=plan_key,
        plan_name=plan_meta["name"],
        billing_cycle=billing_cycle,
        base_amount_inr=Decimal(plan_meta["base_monthly"]) *
                          (Decimal(10) if billing_cycle == "annual" else Decimal(1)),
        per_cycle_amount_inr=quote["price_now_inr"],
        total_rooms_at_signup=total_rooms,
        trial_until=trial_end,
        current_period_start=today,
        current_period_end=trial_end,
        next_charge_date=trial_end,
        status=SubscriptionStatus.trialing.value,
        provider=provider.provider_name,
        provider_plan_id=provider_plan_id,
        provider_subscription_id=sub_resp.get("id"),
        provider_customer_id=sub_resp.get("customer_id"),
        provider_short_url=sub_resp.get("short_url"),
    )
    db.add(sub); db.commit(); db.refresh(sub)
    return sub


def cancel_subscription(db: Session, sub: Subscription, *, reason: str,
                          actor: Optional[User] = None) -> Subscription:
    """Cancel at the provider AND mark local row. Idempotent."""
    if sub.status == SubscriptionStatus.cancelled.value:
        return sub
    if sub.provider_subscription_id:
        get_provider().cancel_subscription(sub.provider_subscription_id)
    sub.status = SubscriptionStatus.cancelled.value
    sub.cancelled_at = _utcnow()
    sub.cancellation_reason = (reason or "").strip()[:2000] or "Cancelled by admin"
    sub.next_charge_date = None
    db.commit(); db.refresh(sub)
    return sub


# ── Invoice number sequencing ─────────────────────────────────────

def _next_invoice_number(db: Session, when: Optional[date] = None) -> str:
    """RST-INV-YYYYMM-NNNN. NNNN is the per-month sequence.

    Uses MAX(invoice_number)+1 scoped to the month. Good enough at our
    scale; a row-level lock + sequence table would be the next iteration.
    """
    when = when or date.today()
    prefix = f"RST-INV-{when.strftime('%Y%m')}-"
    latest = (db.query(BillingInvoice)
                .filter(BillingInvoice.invoice_number.like(f"{prefix}%"))
                .order_by(BillingInvoice.invoice_number.desc())
                .first())
    if latest:
        try:
            n = int(latest.invoice_number.split("-")[-1]) + 1
        except (ValueError, IndexError):
            n = 1
    else:
        n = 1
    return f"{prefix}{n:04d}"


# ── Invoice issue / regenerate ────────────────────────────────────

def issue_invoice(db: Session, sub: Subscription, *,
                    period_start: date, period_end: date,
                    mark_paid: bool = False) -> BillingInvoice:
    """Create a new BillingInvoice for one cycle of this subscription.

    Computes GST = subtotal × gst_rate. `mark_paid=True` is used by the
    mock provider's "instant settlement" path. Real Razorpay would
    mark_paid via the webhook after the charge fires.
    """
    lodge = db.query(Lodge).filter(Lodge.lodge_id == sub.lodge_id).first()
    if not lodge:
        raise ValueError(f"Lodge {sub.lodge_id} not found")

    subtotal = sub.per_cycle_amount_inr
    gst_rate = DEFAULT_GST_PCT
    gst_amount = (subtotal * gst_rate / Decimal(100)).quantize(Decimal("0.01"))
    total = subtotal + gst_amount

    invoice = BillingInvoice(
        lodge_id=sub.lodge_id,
        subscription_id=sub.subscription_id,
        invoice_number=_next_invoice_number(db, period_start),
        period_start=period_start,
        period_end=period_end,
        bill_to_name=lodge.name,
        bill_to_email=lodge.email,
        bill_to_address=lodge.address,
        bill_to_gstin=None,    # lodge GSTIN not stored on Lodge yet; pull from registration if needed
        subtotal_inr=subtotal,
        gst_rate_pct=gst_rate,
        gst_amount_inr=gst_amount,
        total_inr=total,
        status=(BillingInvoiceStatus.paid.value if mark_paid
                else BillingInvoiceStatus.open.value),
        paid_at=(_utcnow() if mark_paid else None),
    )
    db.add(invoice); db.flush()

    # Generate + cache PDF.
    try:
        invoice.pdf_blob = render_invoice_pdf(db, invoice, sub, lodge)
    except Exception:
        logger.exception("PDF rendering failed for invoice %s", invoice.invoice_number)

    db.commit(); db.refresh(invoice)

    # v8.0.1 — fire-and-forget invoice email. send_invoice_email is
    # idempotent (checks email_sent_at) and never raises out — so a
    # flaky SMTP can't break invoice generation. Skipped silently if
    # SMTP isn't configured (returns False with a "SMTP not configured"
    # message that the helper logs internally).
    try:
        send_invoice_email(db, invoice, sub)
    except Exception:
        logger.exception("Invoice email send failed (non-fatal)")

    return invoice


def regenerate_invoice_pdf(db: Session, invoice: BillingInvoice) -> bytes:
    """Render-and-store the PDF for an existing invoice. Used when a
    legacy invoice doesn't have a cached blob."""
    sub = db.query(Subscription).filter(Subscription.subscription_id == invoice.subscription_id).first()
    lodge = db.query(Lodge).filter(Lodge.lodge_id == invoice.lodge_id).first()
    blob = render_invoice_pdf(db, invoice, sub, lodge)
    invoice.pdf_blob = blob
    db.commit()
    return blob


def render_invoice_pdf(db: Session, invoice: BillingInvoice,
                         sub: Subscription, lodge: Lodge) -> bytes:
    """Render an invoice PDF using reportlab. Returns bytes suitable for
    DB storage + Content-Disposition download responses."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                       Table, TableStyle)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib.enums import TA_RIGHT, TA_LEFT, TA_CENTER

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                              rightMargin=18 * mm, leftMargin=18 * mm,
                              topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title", parent=styles["Title"],
                                    fontSize=22, alignment=TA_LEFT,
                                    textColor=colors.HexColor("#1e3a5f"))
    eyebrow_style = ParagraphStyle("Eyebrow", parent=styles["Normal"],
                                     fontSize=8, textColor=colors.HexColor("#b8860b"),
                                     alignment=TA_LEFT, spaceAfter=2)
    label_style = ParagraphStyle("Label", parent=styles["Normal"],
                                    fontSize=8, textColor=colors.HexColor("#8b8b8b"),
                                    alignment=TA_LEFT, spaceAfter=2)
    body_style = styles["Normal"]
    right_style = ParagraphStyle("Right", parent=styles["Normal"], alignment=TA_RIGHT)
    bold_right = ParagraphStyle("BoldRight", parent=right_style,
                                   fontName="Helvetica-Bold", fontSize=11)

    elements = []
    # Header
    elements.append(Paragraph("RUSTO", title_style))
    elements.append(Paragraph("Travel Anywhere. Rest Everywhere.", eyebrow_style))
    elements.append(Spacer(1, 12 * mm))

    # Invoice meta row
    meta = [
        [Paragraph("INVOICE", ParagraphStyle("h", parent=styles["Heading2"],
                                                fontSize=14, textColor=colors.HexColor("#1e3a5f"))),
         Paragraph(f"<b>{invoice.invoice_number}</b>", bold_right)],
        [Paragraph("Issue date", label_style),
         Paragraph(invoice.issued_at.strftime("%d %b %Y") if invoice.issued_at else "—",
                   right_style)],
        [Paragraph("Billing period", label_style),
         Paragraph(f"{invoice.period_start.strftime('%d %b %Y')} – "
                   f"{invoice.period_end.strftime('%d %b %Y')}", right_style)],
        [Paragraph("Status", label_style),
         Paragraph(invoice.status.upper(), right_style)],
    ]
    meta_table = Table(meta, colWidths=[100 * mm, 75 * mm])
    meta_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(meta_table)
    elements.append(Spacer(1, 8 * mm))

    # Bill-to + From blocks
    bill_to_html = (
        f"<b>{invoice.bill_to_name}</b><br/>"
        f"{(invoice.bill_to_address or '').replace(chr(10), '<br/>')}<br/>"
        f"{invoice.bill_to_email or ''}"
    )
    if invoice.bill_to_gstin:
        bill_to_html += f"<br/>GSTIN: {invoice.bill_to_gstin}"
    from_html = (
        "<b>Rusto Technologies Pvt Ltd</b><br/>"
        "Hyderabad, Telangana, India<br/>"
        "billing@rusto.app<br/>"
        "GSTIN: 36AAAAA0000A1Z5"
    )
    addr_table = Table([
        [Paragraph("BILLED TO", label_style),
         Paragraph("FROM", label_style)],
        [Paragraph(bill_to_html, body_style),
         Paragraph(from_html, body_style)],
    ], colWidths=[90 * mm, 85 * mm])
    addr_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(addr_table)
    elements.append(Spacer(1, 12 * mm))

    # Line item
    line_desc = (f"Rusto {sub.plan_name} subscription "
                 f"({sub.billing_cycle.title()} billing)<br/>"
                 f"<font size=8 color='#888888'>{invoice.period_start.strftime('%d %b')} – "
                 f"{invoice.period_end.strftime('%d %b %Y')}, "
                 f"{sub.total_rooms_at_signup} rooms</font>")
    items = [
        [Paragraph("<b>Description</b>", body_style),
         Paragraph("<b>Amount</b>", bold_right)],
        [Paragraph(line_desc, body_style),
         Paragraph(_fmt_inr(invoice.subtotal_inr), right_style)],
    ]
    items_table = Table(items, colWidths=[125 * mm, 50 * mm])
    items_table.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.HexColor("#1e3a5f")),
        ("LINEBELOW", (0, 1), (-1, 1), 0.5, colors.HexColor("#e5e5e5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(items_table)

    # Totals
    totals = [
        ["Subtotal", _fmt_inr(invoice.subtotal_inr)],
        [f"GST @ {invoice.gst_rate_pct}%", _fmt_inr(invoice.gst_amount_inr)],
        ["Total due", _fmt_inr(invoice.total_inr)],
    ]
    totals_table = Table(totals, colWidths=[125 * mm, 50 * mm])
    totals_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor("#1e3a5f")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, -1), (-1, -1), 12),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor("#1e3a5f")),
    ]))
    elements.append(totals_table)
    elements.append(Spacer(1, 18 * mm))

    # Footer
    footer = ("Thank you for choosing Rusto. For questions about this invoice, "
              "email billing@rusto.app or visit Settings → Billing in your dashboard.")
    elements.append(Paragraph(footer, ParagraphStyle("Footer", parent=styles["Normal"],
                                                          fontSize=8, alignment=TA_CENTER,
                                                          textColor=colors.HexColor("#8b8b8b"))))

    doc.build(elements)
    return buf.getvalue()


def _fmt_inr(amount: Decimal) -> str:
    """Indian rupee format: ₹1,23,456.78 with the Indian thousands grouping."""
    if amount is None:
        return "—"
    # Indian grouping: last 3 digits, then 2 at a time
    a = Decimal(amount).quantize(Decimal("0.01"))
    sign = "-" if a < 0 else ""
    a = abs(a)
    int_part, _, dec_part = f"{a:.2f}".partition(".")
    if len(int_part) > 3:
        head, tail = int_part[:-3], int_part[-3:]
        # Insert commas every 2 digits in head
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:]); head = head[:-2]
        if head: groups.insert(0, head)
        int_part = ",".join(groups) + "," + tail
    return f"{sign}₹{int_part}.{dec_part}"


# ── Webhook status application ────────────────────────────────────

def apply_subscription_status(db: Session, *, provider_subscription_id: str,
                                new_status: str,
                                payment_id: Optional[str] = None,
                                failure_reason: Optional[str] = None) -> bool:
    """Apply a webhook status update. Returns True if found + updated.

    Mapping from Razorpay event names → our SubscriptionStatus:
      subscription.activated → active
      subscription.charged   → active (+ issue invoice)
      subscription.halted    → past_due
      subscription.paused    → paused
      subscription.cancelled → cancelled
      subscription.completed → cancelled (natural end)
    """
    sub = (db.query(Subscription)
             .filter(Subscription.provider_subscription_id == provider_subscription_id)
             .first())
    if not sub:
        logger.warning("Subscription webhook: unknown id %s", provider_subscription_id)
        return False

    if new_status == "active":
        sub.status = SubscriptionStatus.active.value
        sub.last_failure_at = None
        sub.last_failure_reason = None
    elif new_status == "past_due":
        sub.status = SubscriptionStatus.past_due.value
        sub.last_failure_at = _utcnow()
        sub.last_failure_reason = failure_reason or "Charge failed"
    elif new_status == "paused":
        sub.status = SubscriptionStatus.paused.value
    elif new_status == "cancelled":
        sub.status = SubscriptionStatus.cancelled.value
        sub.cancelled_at = _utcnow()
        sub.cancellation_reason = sub.cancellation_reason or "Cancelled via provider"
        sub.next_charge_date = None
    else:
        logger.warning("Subscription webhook: unknown new_status %r", new_status)
        return False

    db.commit()

    # On a successful charge: also create the invoice + roll forward periods.
    if new_status == "active" and payment_id:
        try:
            _roll_to_next_period(db, sub, payment_id)
        except Exception:
            logger.exception("Failed to roll subscription %s forward", sub.subscription_id)

    return True


def _roll_to_next_period(db: Session, sub: Subscription, payment_id: str):
    """After a successful charge: issue invoice for the just-completed
    period, advance current_period_* to the next cycle."""
    if not sub.current_period_end:
        return
    invoice = issue_invoice(db, sub,
                              period_start=sub.current_period_start or date.today(),
                              period_end=sub.current_period_end,
                              mark_paid=True)
    invoice.razorpay_payment_id = payment_id
    # Roll forward
    next_start = sub.current_period_end
    if sub.billing_cycle == "monthly":
        # Same day next month (simple offset; calendar drift handled by Razorpay)
        next_end = next_start + timedelta(days=30)
    else:
        next_end = next_start + timedelta(days=365)
    sub.current_period_start = next_start
    sub.current_period_end = next_end
    sub.next_charge_date = next_end
    db.commit()


# ──────────────────────────────────────────────────────────────────
# v8.0.1 — Invoice + renewal-reminder email
# ──────────────────────────────────────────────────────────────────

def _send_billing_email(db: Session, lodge_id: int, to_email: str, *,
                          subject: str, html_body: str, text_body: str,
                          attachments=None) -> bool:
    """Send a billing-related email with system-SMTP fallback.

    Billing emails (invoice, renewal reminder, refund confirmation) are
    sent from RUSTO to the lodge — they're system-level, not per-lodge
    operational. So if the lodge hasn't configured SMTP yet, fall back
    to lodge 1's SMTP context as the system sender.

    Returns True if either send succeeded. Logs internally on failure.
    """
    from .smtp_service import send_email_with_attachments
    ok, msg = send_email_with_attachments(
        db, lodge_id, to_email, subject=subject, html_body=html_body,
        text_body=text_body, attachments=attachments,
    )
    if not ok and lodge_id != 1:
        # Fallback to the system SMTP context (lodge 1).
        ok, msg = send_email_with_attachments(
            db, 1, to_email, subject=subject, html_body=html_body,
            text_body=text_body, attachments=attachments,
        )
    if not ok:
        logger.warning("Billing email failed → %s: %s", to_email, msg)
    return bool(ok)


def send_invoice_email(db: Session, invoice: BillingInvoice,
                         sub: Subscription) -> bool:
    """Email a paid/issued invoice to the lodge with the PDF attached.

    Idempotent — checks `invoice.email_sent_at` to avoid double-send if
    the issuance pathway runs twice (e.g., webhook retry).

    Returns True on successful send, False otherwise. Failure is
    non-fatal to the caller (we never want a flaky SMTP to block
    invoice generation itself).
    """
    if invoice.email_sent_at:
        logger.info("Invoice %s already emailed at %s — skipping",
                    invoice.invoice_number, invoice.email_sent_at)
        return False
    if not invoice.bill_to_email:
        logger.info("Invoice %s has no bill-to email — skipping",
                    invoice.invoice_number)
        return False

    # Ensure we have a PDF to attach. Regenerate if missing.
    pdf_blob = invoice.pdf_blob
    if not pdf_blob:
        try:
            pdf_blob = regenerate_invoice_pdf(db, invoice)
        except Exception:
            logger.exception("Could not regenerate PDF for %s", invoice.invoice_number)
            return False

    lodge_name = invoice.bill_to_name or "your lodge"
    subject = f"Your Rusto invoice — {invoice.invoice_number}"

    # HTML body. Kept inline because templated email is per-lodge and
    # this is a system-level email (Rusto → the lodge).
    period_label = (f"{invoice.period_start.strftime('%d %b %Y')} – "
                    f"{invoice.period_end.strftime('%d %b %Y')}")
    paid_or_due = ("This invoice has been <strong>paid</strong>."
                   if invoice.status == BillingInvoiceStatus.paid.value
                   else "Payment will be collected by Razorpay shortly.")
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                 max-width:560px;margin:0 auto;color:#1f2937;">
      <div style="background:#0a2540;padding:24px;text-align:center;color:#fff;">
        <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">RUSTO</div>
        <div style="font-size:11px;color:#f5d76e;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">
          Travel Anywhere. Rest Everywhere.
        </div>
      </div>
      <div style="padding:24px;background:#fff;">
        <h2 style="margin:0 0 12px;color:#0a2540;">Hi {lodge_name},</h2>
        <p style="line-height:1.6;">
          Your Rusto invoice <strong>{invoice.invoice_number}</strong>
          for the billing period <strong>{period_label}</strong> is ready.
          {paid_or_due}
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;
                       background:#f9fafb;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Plan</td>
              <td style="padding:10px 16px;text-align:right;font-weight:600;">{sub.plan_name} ({sub.billing_cycle})</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Subtotal</td>
              <td style="padding:10px 16px;text-align:right;">{_fmt_inr(invoice.subtotal_inr)}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">GST @ {invoice.gst_rate_pct}%</td>
              <td style="padding:10px 16px;text-align:right;">{_fmt_inr(invoice.gst_amount_inr)}</td></tr>
          <tr style="background:#0a2540;color:#fff;">
              <td style="padding:12px 16px;font-weight:600;">Total</td>
              <td style="padding:12px 16px;text-align:right;font-weight:700;font-size:16px;">{_fmt_inr(invoice.total_inr)}</td></tr>
        </table>
        <p style="line-height:1.6;font-size:13px;color:#4b5563;">
          The full invoice is attached to this email as a PDF.
          You can also access all your invoices anytime from <strong>Billing</strong>
          in your Rusto dashboard.
        </p>
      </div>
      <div style="background:#f3f4f6;padding:16px;text-align:center;color:#6b7280;font-size:11px;">
        Rusto Technologies Pvt Ltd · Hyderabad, India · billing@rusto.app
      </div>
    </div>
    """
    text_body = (
        f"Hi {lodge_name},\n\n"
        f"Your Rusto invoice {invoice.invoice_number} for the period "
        f"{period_label} is ready.\n\n"
        f"  Plan:     {sub.plan_name} ({sub.billing_cycle})\n"
        f"  Subtotal: {_fmt_inr(invoice.subtotal_inr)}\n"
        f"  GST:      {_fmt_inr(invoice.gst_amount_inr)}\n"
        f"  Total:    {_fmt_inr(invoice.total_inr)}\n\n"
        f"Status: {invoice.status.upper()}\n\n"
        f"The PDF is attached. You can view all invoices in your Rusto dashboard "
        f"under Billing.\n\n"
        f"— The Rusto Team"
    )

    ok = _send_billing_email(
        db, invoice.lodge_id, invoice.bill_to_email,
        subject=subject, html_body=html_body, text_body=text_body,
        attachments=[{
            "filename": f"{invoice.invoice_number}.pdf",
            "content":  pdf_blob,
            "mime":     "application/pdf",
        }],
    )
    if ok:
        invoice.email_sent_at = _utcnow()
        db.commit()
        logger.info("Invoice email sent: %s → %s",
                    invoice.invoice_number, invoice.bill_to_email)
    return ok


def send_renewal_reminder(db: Session, sub: Subscription) -> bool:
    """Email a 'your next charge is coming up' reminder.

    Dedup: only sends if `sub.last_reminder_sent_for_date != sub.next_charge_date`.
    The scheduled job calls this for every subscription whose next charge
    is N days out (default 3). When status flips back to past_due → active
    on a new period, next_charge_date moves forward, so we'll re-remind.

    Returns True on successful send.
    """
    if not sub.next_charge_date:
        return False
    if sub.last_reminder_sent_for_date == sub.next_charge_date:
        return False    # already reminded for this charge
    if sub.status not in (SubscriptionStatus.active.value,
                            SubscriptionStatus.trialing.value):
        return False

    lodge = db.query(Lodge).filter(Lodge.lodge_id == sub.lodge_id).first()
    if not lodge or not lodge.email:
        return False

    days_until = (sub.next_charge_date - date.today()).days
    when_phrase = ("today"      if days_until == 0
                   else "tomorrow" if days_until == 1
                   else f"in {days_until} days")
    charge_label = sub.next_charge_date.strftime("%d %b %Y")

    subject = (f"Heads up: your Rusto {sub.plan_name} renewal is {when_phrase}")
    html_body = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                 max-width:560px;margin:0 auto;color:#1f2937;">
      <div style="background:#0a2540;padding:24px;text-align:center;color:#fff;">
        <div style="font-size:24px;font-weight:bold;">RUSTO</div>
        <div style="font-size:11px;color:#f5d76e;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">
          Renewal reminder
        </div>
      </div>
      <div style="padding:24px;background:#fff;">
        <h2 style="margin:0 0 12px;color:#0a2540;">Hi {lodge.name},</h2>
        <p style="line-height:1.6;">
          Just a heads up — your Rusto <strong>{sub.plan_name}</strong>
          subscription will renew {when_phrase} on <strong>{charge_label}</strong>.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;
                       background:#f9fafb;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Plan</td>
              <td style="padding:10px 16px;text-align:right;font-weight:600;">{sub.plan_name} ({sub.billing_cycle})</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Amount</td>
              <td style="padding:10px 16px;text-align:right;font-weight:700;font-size:16px;color:#0a2540;">{_fmt_inr(sub.per_cycle_amount_inr)} + GST</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Charge date</td>
              <td style="padding:10px 16px;text-align:right;font-weight:600;">{charge_label}</td></tr>
        </table>
        <p style="line-height:1.6;font-size:13px;color:#4b5563;">
          Razorpay will auto-debit your registered payment method.
          If you need to update your card or UPI ID, visit{" "}
          <strong>Billing → Update payment method</strong> in your dashboard.
        </p>
        <p style="line-height:1.6;font-size:13px;color:#4b5563;">
          Plans can be changed or cancelled anytime from the same page —
          your current billing cycle still completes.
        </p>
      </div>
      <div style="background:#f3f4f6;padding:16px;text-align:center;color:#6b7280;font-size:11px;">
        Rusto Technologies Pvt Ltd · billing@rusto.app
      </div>
    </div>
    """
    text_body = (
        f"Hi {lodge.name},\n\n"
        f"Your Rusto {sub.plan_name} ({sub.billing_cycle}) subscription will "
        f"renew {when_phrase} on {charge_label}.\n\n"
        f"  Amount: {_fmt_inr(sub.per_cycle_amount_inr)} + GST\n\n"
        f"Razorpay will auto-debit your saved payment method. To update card "
        f"or UPI, visit Billing → Update payment method in your Rusto dashboard.\n\n"
        f"— The Rusto Team"
    )

    ok = _send_billing_email(
        db, sub.lodge_id, lodge.email,
        subject=subject, html_body=html_body, text_body=text_body,
        attachments=None,
    )
    if ok:
        sub.last_reminder_sent_for_date = sub.next_charge_date
        db.commit()
    return ok


def send_renewal_reminders_due(db: Session, days_ahead: int = 3) -> Dict[str, int]:
    """Find all subscriptions whose next_charge_date == today + N days,
    send reminders, return a summary. Called by the daily scheduler job.

    Returns {checked, sent, skipped} counts."""
    target = date.today() + timedelta(days=days_ahead)
    subs = (db.query(Subscription)
              .filter(Subscription.next_charge_date == target,
                      Subscription.status.in_([
                          SubscriptionStatus.active.value,
                          SubscriptionStatus.trialing.value,
                      ]))
              .all())
    sent = 0; skipped = 0
    for sub in subs:
        try:
            if send_renewal_reminder(db, sub):
                sent += 1
            else:
                skipped += 1
        except Exception:
            logger.exception("Renewal reminder failed for sub %s", sub.subscription_id)
            skipped += 1
    logger.info("Renewal reminders: %d checked, %d sent, %d skipped",
                len(subs), sent, skipped)
    return {"checked": len(subs), "sent": sent, "skipped": skipped}


# ──────────────────────────────────────────────────────────────────
# v8.2 — Plan upgrades / downgrades with proration
# ──────────────────────────────────────────────────────────────────

def preview_plan_change(db: Session, sub: Subscription, *,
                          new_plan_key: str,
                          new_billing_cycle: Optional[str] = None,
                          new_total_rooms: Optional[int] = None
                         ) -> Dict[str, Any]:
    """Compute what changing this subscription's plan would cost, WITHOUT
    mutating anything.

    Returns a dict the wizard renders directly:
      {
        is_upgrade: bool,
        is_downgrade: bool,
        is_cycle_change: bool,
        is_no_op: bool,
        effective_at: ISO date,
        immediate_charge_inr: float,    # 0 for scheduled changes
        prorated_credit_inr: float,      # 0 for scheduled changes
        current: {plan_name, billing_cycle, per_cycle_inr, monthly_equivalent_inr},
        next:    {plan_name, billing_cycle, per_cycle_inr, monthly_equivalent_inr},
        change_takes_effect: 'immediate' | 'end_of_period',
        proration_explanation: str,      # human-readable copy
        warnings: [str]                  # plan-cap exceeded etc.
      }

    Rules:
      - Upgrade (higher monthly_equivalent): immediate, prorated charge for
        the remaining days of the current period at the price delta.
      - Downgrade (lower monthly_equivalent), or cycle change, or room-count
        change at SAME plan: scheduled to end of current period. No refund.
      - Same plan + same cycle + same rooms: returns is_no_op=True.
      - Trialing subs: change takes effect immediately + cleanly (no proration
        — no charge happened yet). They become a new trial under the new plan.
    """
    # Validate inputs
    new_plan = pricing_service.PLANS_BY_KEY.get(new_plan_key)
    if not new_plan:
        raise ValueError(f"Unknown plan: {new_plan_key!r}")
    new_cycle = (new_billing_cycle or sub.billing_cycle or "monthly").lower()
    if new_cycle not in ("monthly", "annual"):
        raise ValueError(f"Invalid cycle: {new_cycle!r}")
    new_rooms = new_total_rooms or sub.total_rooms_at_signup or 1
    if new_rooms < 1:
        new_rooms = 1

    # Quote the new state.
    new_quote = pricing_service.calculate_quote(new_plan_key, new_rooms, new_cycle)
    if not new_quote:
        raise ValueError("Could not compute quote for new plan")

    # Normalize to a monthly-equivalent so we can compare across cycles
    # (which lets us decide upgrade vs downgrade correctly).
    def monthly_eq(per_cycle: Decimal, cycle: str) -> Decimal:
        if cycle == "annual":
            return per_cycle / Decimal(10)
        return per_cycle
    old_monthly_eq = monthly_eq(sub.per_cycle_amount_inr or Decimal(0), sub.billing_cycle)
    new_monthly_eq = monthly_eq(new_quote["price_now_inr"], new_cycle)

    is_no_op = (sub.plan_key == new_plan_key
                  and sub.billing_cycle == new_cycle
                  and (sub.total_rooms_at_signup or 0) == new_rooms)
    is_cycle_change = (sub.billing_cycle != new_cycle)
    is_upgrade = (not is_no_op and not is_cycle_change
                    and new_monthly_eq > old_monthly_eq)
    is_downgrade = (not is_no_op and not is_cycle_change
                      and new_monthly_eq < old_monthly_eq)
    is_room_change_only = (sub.plan_key == new_plan_key
                             and sub.billing_cycle == new_cycle
                             and not is_no_op)

    today = date.today()
    immediate_charge = Decimal(0)
    proration_explanation = ""

    # Trialing subscriptions: free pivot, no money changes hands.
    if sub.status == SubscriptionStatus.trialing.value:
        change_takes_effect = "immediate"
        effective_at = today
        proration_explanation = ("You're in your trial — switching plans is "
                                  "free and instant. The trial continues "
                                  "with no charge until the trial ends.")
    elif is_no_op:
        change_takes_effect = "immediate"
        effective_at = today
        proration_explanation = ("This selection matches your current plan exactly.")
    elif is_upgrade:
        # Immediate, prorated charge.
        period_start = sub.current_period_start or today
        period_end = sub.current_period_end or (today + timedelta(days=30))
        days_in_period = max(1, (period_end - period_start).days)
        days_remaining = max(0, (period_end - today).days)
        ratio = Decimal(days_remaining) / Decimal(days_in_period)
        # Charge is the proportional difference (monthly-equivalent basis,
        # then converted to the NEW cycle's billing currency).
        # For a monthly→monthly upgrade: (new_monthly - old_monthly) × ratio
        # For a monthly→annual upgrade we treat the cycle change separately.
        if not is_cycle_change:
            delta_per_period = (new_quote["price_now_inr"] -
                                 (sub.per_cycle_amount_inr or Decimal(0)))
            immediate_charge = (delta_per_period * ratio).quantize(Decimal("0.01"))
        else:
            # Cycle changes are scheduled (avoids hairy mid-cycle conversions).
            immediate_charge = Decimal(0)
        change_takes_effect = "immediate"
        effective_at = today
        proration_explanation = (
            f"Upgrade takes effect today. You'll be charged a one-time "
            f"prorated amount of ₹{_fmt_inr(immediate_charge)[1:]} to cover "
            f"the {days_remaining}-day balance of your current period at the "
            f"new tier's pricing. Your next renewal on "
            f"{period_end.strftime('%d %b %Y')} will charge the full "
            f"{new_cycle} rate for {new_plan['name']}."
        )
    else:
        # Downgrades, cycle changes, room reductions — schedule for end of cycle.
        # Lodge keeps current plan until period end, no refund.
        change_takes_effect = "end_of_period"
        effective_at = sub.current_period_end or (today + timedelta(days=30))
        days_until = max(0, (effective_at - today).days)
        if is_cycle_change:
            why = (f"Switching from {sub.billing_cycle} to {new_cycle} billing "
                   f"takes effect at the end of your current period")
        elif is_downgrade:
            why = "Downgrade takes effect at the end of your current period"
        elif is_room_change_only:
            why = "Room-count change takes effect at the end of your current period"
        else:
            why = "Change takes effect at the end of your current period"
        proration_explanation = (
            f"{why} on {effective_at.strftime('%d %b %Y')} "
            f"({days_until} day{'s' if days_until != 1 else ''} away). "
            f"You keep your current {sub.plan_name} access until then, with "
            f"no immediate charge or refund."
        )

    return {
        "is_no_op":             is_no_op,
        "is_upgrade":           is_upgrade,
        "is_downgrade":         is_downgrade,
        "is_cycle_change":      is_cycle_change,
        "is_room_change_only":  is_room_change_only,
        "change_takes_effect":  change_takes_effect,
        "effective_at":         effective_at.isoformat(),
        "immediate_charge_inr": float(immediate_charge),
        "current": {
            "plan_key":     sub.plan_key,
            "plan_name":    sub.plan_name,
            "billing_cycle": sub.billing_cycle,
            "per_cycle_inr": float(sub.per_cycle_amount_inr or 0),
            "monthly_equivalent_inr": float(old_monthly_eq),
            "total_rooms": sub.total_rooms_at_signup,
        },
        "next": {
            "plan_key":     new_plan_key,
            "plan_name":    new_plan["name"],
            "billing_cycle": new_cycle,
            "per_cycle_inr": float(new_quote["price_now_inr"]),
            "monthly_equivalent_inr": float(new_monthly_eq),
            "total_rooms": new_rooms,
        },
        "proration_explanation": proration_explanation,
        "warnings": new_quote["warnings"],
    }


def apply_plan_change(db: Session, sub: Subscription, *,
                       new_plan_key: str,
                       new_billing_cycle: Optional[str] = None,
                       new_total_rooms: Optional[int] = None,
                       actor_user_id: Optional[int] = None) -> Dict[str, Any]:
    """Apply a plan change. Internally calls preview to decide between
    immediate vs scheduled, then takes the appropriate action.

    Returns the same shape as preview() plus `applied: True` and (for
    immediate changes) `prorated_invoice_id` of the one-off proration
    invoice we generated.
    """
    if sub.status in (SubscriptionStatus.cancelled.value,
                        SubscriptionStatus.paused.value):
        raise ValueError(f"Cannot change plan on a {sub.status} subscription")

    preview = preview_plan_change(
        db, sub, new_plan_key=new_plan_key,
        new_billing_cycle=new_billing_cycle,
        new_total_rooms=new_total_rooms,
    )
    if preview["is_no_op"]:
        return {**preview, "applied": False, "reason": "no-op (nothing to change)"}

    new_cycle = preview["next"]["billing_cycle"]
    new_rooms = preview["next"]["total_rooms"]

    # Trial + immediate-upgrade path: mutate the subscription in place.
    if preview["change_takes_effect"] == "immediate":
        # Issue prorated charge invoice ONLY if there's something to charge
        # (trialing subs and free no-ops have zero).
        prorated_invoice = None
        if preview["immediate_charge_inr"] > 0.001:
            today = date.today()
            inv = BillingInvoice(
                lodge_id=sub.lodge_id,
                subscription_id=sub.subscription_id,
                invoice_number=_next_invoice_number(db, today),
                period_start=today,
                period_end=sub.current_period_end or today,
                bill_to_name=(db.query(Lodge).filter(Lodge.lodge_id == sub.lodge_id).first().name),
                bill_to_email=(db.query(Lodge).filter(Lodge.lodge_id == sub.lodge_id).first().email),
                bill_to_address=None,
                bill_to_gstin=None,
                subtotal_inr=Decimal(str(preview["immediate_charge_inr"])),
                gst_rate_pct=DEFAULT_GST_PCT,
                gst_amount_inr=(Decimal(str(preview["immediate_charge_inr"])) *
                                  DEFAULT_GST_PCT / Decimal(100)).quantize(Decimal("0.01")),
                total_inr=(Decimal(str(preview["immediate_charge_inr"])) *
                           (Decimal(1) + DEFAULT_GST_PCT / Decimal(100))
                          ).quantize(Decimal("0.01")),
                status=BillingInvoiceStatus.paid.value,
                paid_at=_utcnow(),
            )
            db.add(inv); db.flush()
            # Replace the description-derived render call by re-rendering.
            try:
                lodge = db.query(Lodge).filter(Lodge.lodge_id == sub.lodge_id).first()
                # Use the subscription snapshot BEFORE we mutate it below,
                # so the rendered PDF describes the upgrade-from clearly.
                inv.pdf_blob = render_invoice_pdf(db, inv, sub, lodge)
            except Exception:
                logger.exception("Proration invoice PDF render failed")
            prorated_invoice = inv
            try:
                send_invoice_email(db, inv, sub)
            except Exception:
                logger.exception("Proration invoice email failed")

        # Update the subscription with the new tier.
        new_quote = pricing_service.calculate_quote(new_plan_key, new_rooms, new_cycle)
        new_plan_meta = new_quote["plan"]
        sub.plan_key = new_plan_key
        sub.plan_name = new_plan_meta["name"]
        sub.billing_cycle = new_cycle
        sub.per_cycle_amount_inr = new_quote["price_now_inr"]
        sub.base_amount_inr = (Decimal(new_plan_meta["base_monthly"]) *
                                  (Decimal(10) if new_cycle == "annual" else Decimal(1)))
        sub.total_rooms_at_signup = new_rooms
        # Pending fields cleared (the change has been realized).
        sub.pending_plan_key = None
        sub.pending_billing_cycle = None
        sub.pending_total_rooms = None
        sub.pending_change_takes_effect_at = None
        sub.pending_change_queued_at = None
        db.commit(); db.refresh(sub)
        return {
            **preview,
            "applied": True,
            "prorated_invoice_id": prorated_invoice.invoice_id if prorated_invoice else None,
        }

    # Scheduled (end-of-period) path: just record the intent.
    sub.pending_plan_key = new_plan_key
    sub.pending_billing_cycle = new_cycle
    sub.pending_total_rooms = new_rooms
    sub.pending_change_takes_effect_at = date.fromisoformat(preview["effective_at"])
    sub.pending_change_queued_at = _utcnow()
    db.commit(); db.refresh(sub)
    return {**preview, "applied": True, "scheduled": True}


def cancel_pending_plan_change(db: Session, sub: Subscription) -> Subscription:
    """Clear any pending plan change. Idempotent."""
    sub.pending_plan_key = None
    sub.pending_billing_cycle = None
    sub.pending_total_rooms = None
    sub.pending_change_takes_effect_at = None
    sub.pending_change_queued_at = None
    db.commit(); db.refresh(sub)
    return sub


def realize_due_plan_changes(db: Session) -> Dict[str, int]:
    """Find subscriptions whose pending change has come due (effective
    date <= today) and apply them. Called from the daily scheduler so
    end-of-period changes actually take effect.

    Doesn't issue invoices — the next regular billing cycle picks up
    the new rate and charges as normal.
    """
    today = date.today()
    due = (db.query(Subscription)
             .filter(Subscription.pending_change_takes_effect_at != None,
                     Subscription.pending_change_takes_effect_at <= today,
                     Subscription.status.in_([
                         SubscriptionStatus.active.value,
                         SubscriptionStatus.trialing.value,
                         SubscriptionStatus.past_due.value,
                     ])).all())
    realized = 0
    for sub in due:
        try:
            new_plan_meta = pricing_service.PLANS_BY_KEY.get(sub.pending_plan_key)
            if not new_plan_meta:
                logger.warning("Sub %s has unknown pending plan %r — clearing",
                                sub.subscription_id, sub.pending_plan_key)
                cancel_pending_plan_change(db, sub)
                continue
            new_quote = pricing_service.calculate_quote(
                sub.pending_plan_key,
                sub.pending_total_rooms or sub.total_rooms_at_signup or 1,
                sub.pending_billing_cycle or sub.billing_cycle,
            )
            sub.plan_key = sub.pending_plan_key
            sub.plan_name = new_plan_meta["name"]
            sub.billing_cycle = sub.pending_billing_cycle
            sub.per_cycle_amount_inr = new_quote["price_now_inr"]
            sub.base_amount_inr = (Decimal(new_plan_meta["base_monthly"]) *
                                       (Decimal(10) if sub.billing_cycle == "annual" else Decimal(1)))
            sub.total_rooms_at_signup = sub.pending_total_rooms or sub.total_rooms_at_signup
            sub.pending_plan_key = None
            sub.pending_billing_cycle = None
            sub.pending_total_rooms = None
            sub.pending_change_takes_effect_at = None
            sub.pending_change_queued_at = None
            db.commit()
            realized += 1
            logger.info("Realized pending plan change for sub %s → %s/%s",
                        sub.subscription_id, sub.plan_key, sub.billing_cycle)
        except Exception:
            logger.exception("Failed to realize pending change for sub %s",
                             sub.subscription_id)
    return {"checked": len(due), "realized": realized}


# ──────────────────────────────────────────────────────────────────
# v8.3 — Refunds on cancellation
# ──────────────────────────────────────────────────────────────────

def _next_refund_number(db: Session, when: Optional[date] = None) -> str:
    """RST-REF-YYYYMM-NNNN sequencing, mirrors invoice numbers."""
    from ..models import BillingRefund
    when = when or date.today()
    prefix = f"RST-REF-{when.strftime('%Y%m')}-"
    latest = (db.query(BillingRefund)
                .filter(BillingRefund.refund_number.like(f"{prefix}%"))
                .order_by(BillingRefund.refund_number.desc()).first())
    if latest:
        try:    n = int(latest.refund_number.split("-")[-1]) + 1
        except (ValueError, IndexError): n = 1
    else:    n = 1
    return f"{prefix}{n:04d}"


def calculate_refund_for_cancellation(db: Session, sub: Subscription
                                          ) -> Optional[Dict[str, Any]]:
    """Compute the refund amount if a lodge cancels immediately.

    Logic: refund the unused portion of the most-recent paid invoice
    for the current period. Days used = today - period_start.
    Days unused = period_end - today.
    Refund amount = original_total × (unused / total_days).

    Returns None if there's nothing to refund (no paid invoice for
    current period, or sub is trialing/cancelled, or period already
    ended). Otherwise returns dict with breakdown for the preview UI.
    """
    from ..models import BillingRefund
    if sub.status in (SubscriptionStatus.cancelled.value,
                        SubscriptionStatus.trialing.value):
        return None
    if not sub.current_period_start or not sub.current_period_end:
        return None
    today = date.today()
    if today >= sub.current_period_end:
        return None    # period already over; nothing to refund

    # Find the most-recent paid invoice for THIS period.
    invoice = (db.query(BillingInvoice)
                 .filter(BillingInvoice.subscription_id == sub.subscription_id,
                         BillingInvoice.status == BillingInvoiceStatus.paid.value,
                         BillingInvoice.period_start <= sub.current_period_start,
                         BillingInvoice.period_end >= sub.current_period_end)
                 .order_by(BillingInvoice.issued_at.desc()).first())
    if not invoice:
        # No invoice covers this period — likely still in trial gap.
        return None

    # Check if already refunded
    from ..models import BillingRefundStatus
    existing_refund = (db.query(BillingRefund)
                         .filter(BillingRefund.original_invoice_id == invoice.invoice_id,
                                 BillingRefund.status.in_([
                                     BillingRefundStatus.pending.value,
                                     BillingRefundStatus.processed.value,
                                 ])).first())
    if existing_refund:
        return None    # don't double-refund

    total_days = max(1, (sub.current_period_end - sub.current_period_start).days)
    unused_days = max(0, (sub.current_period_end - today).days)
    if unused_days == 0:
        return None    # nothing left to refund

    ratio = Decimal(unused_days) / Decimal(total_days)
    refund_subtotal = (invoice.subtotal_inr * ratio).quantize(Decimal("0.01"))
    refund_gst = (invoice.gst_amount_inr * ratio).quantize(Decimal("0.01"))
    refund_total = refund_subtotal + refund_gst

    return {
        "eligible":             True,
        "original_invoice_id":  invoice.invoice_id,
        "original_invoice_number": invoice.invoice_number,
        "original_total_inr":   float(invoice.total_inr),
        "period_start":         sub.current_period_start.isoformat(),
        "period_end":           sub.current_period_end.isoformat(),
        "total_period_days":    total_days,
        "unused_days":          unused_days,
        "refund_subtotal_inr":  float(refund_subtotal),
        "refund_gst_inr":       float(refund_gst),
        "refund_total_inr":     float(refund_total),
        "explanation": (
            f"You've used {total_days - unused_days} of {total_days} days "
            f"in this billing period. We'll refund the unused {unused_days} "
            f"days — ₹{_fmt_inr(refund_total)[1:]} (incl. GST) back to your "
            f"original payment method via Razorpay within 5-7 business days."
        ),
    }


def issue_refund(db: Session, sub: Subscription, *,
                   reason: Optional[str] = None,
                   actor_user_id: Optional[int] = None
                  ) -> Optional["BillingRefund"]:
    """Issue a prorated refund for the unused portion of the current
    period. Creates a BillingRefund row + calls the Razorpay refund API
    (or mock equivalent). Returns the BillingRefund row or None if not
    eligible.

    The caller (cancel endpoint) decides whether to also flip the sub
    status to cancelled; this function only handles the refund itself.
    """
    from ..models import BillingRefund, BillingRefundStatus
    calc = calculate_refund_for_cancellation(db, sub)
    if not calc:
        return None

    refund = BillingRefund(
        lodge_id=sub.lodge_id,
        subscription_id=sub.subscription_id,
        original_invoice_id=calc["original_invoice_id"],
        refund_number=_next_refund_number(db),
        period_start=date.fromisoformat(calc["period_start"]),
        period_end=date.fromisoformat(calc["period_end"]),
        unused_days=calc["unused_days"],
        total_period_days=calc["total_period_days"],
        subtotal_inr=Decimal(str(calc["refund_subtotal_inr"])),
        gst_amount_inr=Decimal(str(calc["refund_gst_inr"])),
        total_refund_inr=Decimal(str(calc["refund_total_inr"])),
        reason=(reason or "").strip()[:2000] or None,
        status=BillingRefundStatus.pending.value,
    )
    db.add(refund); db.flush()

    # Look up the original Razorpay payment ID from the invoice.
    invoice = (db.query(BillingInvoice)
                 .filter(BillingInvoice.invoice_id == calc["original_invoice_id"])
                 .first())
    razorpay_payment_id = invoice.razorpay_payment_id if invoice else None
    refund.razorpay_payment_id = razorpay_payment_id

    # Process via the provider.
    try:
        provider = get_provider()
        if provider.provider_name == "mock" or not razorpay_payment_id:
            # Mock: instant success with a fake refund ID.
            import secrets
            refund.razorpay_refund_id = f"rfnd_mock_{secrets.token_hex(8)}"
            refund.status = BillingRefundStatus.processed.value
            refund.processed_at = _utcnow()
            logger.info("Billing[mock] refund %s ₹%s for sub %s",
                        refund.refund_number, refund.total_refund_inr,
                        sub.subscription_id)
        else:
            # Real Razorpay refund API call
            import requests
            r = requests.post(
                f"https://api.razorpay.com/v1/payments/{razorpay_payment_id}/refund",
                auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
                json={"amount": int(refund.total_refund_inr * 100),
                       "speed": "normal",
                       "notes": {"refund_number": refund.refund_number,
                                  "reason": refund.reason or ""}},
                timeout=20,
            )
            if r.status_code >= 400:
                refund.status = BillingRefundStatus.failed.value
                refund.failure_reason = f"Razorpay rejected: {r.text[:300]}"
            else:
                refund.razorpay_refund_id = r.json().get("id")
                refund.status = BillingRefundStatus.processed.value
                refund.processed_at = _utcnow()
    except Exception as e:
        logger.exception("Refund processing failed: %s", e)
        refund.status = BillingRefundStatus.failed.value
        refund.failure_reason = str(e)[:500]

    db.commit(); db.refresh(refund)

    # Fire-and-forget refund confirmation email.
    if refund.status == BillingRefundStatus.processed.value:
        try:
            send_refund_email(db, refund, sub)
        except Exception:
            logger.exception("Refund email send failed (non-fatal)")
    return refund


def send_refund_email(db: Session, refund: "BillingRefund",
                        sub: Subscription) -> bool:
    """Email refund confirmation to the lodge owner."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == refund.lodge_id).first()
    if not lodge or not lodge.email:
        return False
    subject = (f"Refund processed: {_fmt_inr(refund.total_refund_inr)} "
               f"({refund.refund_number})")
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;
                max-width:560px;margin:0 auto;color:#1f2937;">
      <div style="background:#0a2540;padding:24px;text-align:center;color:#fff;">
        <div style="font-size:24px;font-weight:bold;letter-spacing:0.5px;">RUSTO</div>
        <div style="font-size:11px;color:#f5d76e;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">
          Refund processed
        </div>
      </div>
      <div style="padding:24px;background:#fff;">
        <h2 style="margin:0 0 12px;color:#0a2540;">Hi {lodge.name},</h2>
        <p style="line-height:1.6;">
          We've processed a refund of <strong>{_fmt_inr(refund.total_refund_inr)}</strong>
          for the unused portion of your billing period. The money should
          arrive in your original payment method within 5-7 business days.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;
                       background:#f9fafb;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Refund number</td>
              <td style="padding:10px 16px;text-align:right;font-weight:600;">{refund.refund_number}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Unused days</td>
              <td style="padding:10px 16px;text-align:right;">{refund.unused_days} of {refund.total_period_days}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">Net amount</td>
              <td style="padding:10px 16px;text-align:right;">{_fmt_inr(refund.subtotal_inr)}</td></tr>
          <tr><td style="padding:10px 16px;color:#6b7280;font-size:13px;">GST refund</td>
              <td style="padding:10px 16px;text-align:right;">{_fmt_inr(refund.gst_amount_inr)}</td></tr>
          <tr style="background:#0a2540;color:#fff;">
              <td style="padding:12px 16px;font-weight:600;">Total refunded</td>
              <td style="padding:12px 16px;text-align:right;font-weight:700;font-size:16px;">{_fmt_inr(refund.total_refund_inr)}</td></tr>
        </table>
        <p style="line-height:1.6;font-size:13px;color:#4b5563;">
          Your Rusto account remains accessible until the end of the period
          you paid for. We're sorry to see you go — if you change your mind,
          reach out at billing@rusto.app.
        </p>
      </div>
      <div style="background:#f3f4f6;padding:16px;text-align:center;color:#6b7280;font-size:11px;">
        Rusto Technologies Pvt Ltd · billing@rusto.app
      </div>
    </div>
    """
    text = (
        f"Hi {lodge.name},\n\n"
        f"We've processed a refund of {_fmt_inr(refund.total_refund_inr)} "
        f"for the unused portion of your billing period.\n\n"
        f"  Refund number: {refund.refund_number}\n"
        f"  Unused days:   {refund.unused_days} of {refund.total_period_days}\n"
        f"  Net refund:    {_fmt_inr(refund.subtotal_inr)}\n"
        f"  GST refund:    {_fmt_inr(refund.gst_amount_inr)}\n"
        f"  Total:         {_fmt_inr(refund.total_refund_inr)}\n\n"
        f"Money arrives within 5-7 business days.\n\n— The Rusto Team"
    )
    ok = _send_billing_email(db, refund.lodge_id, lodge.email,
                                subject=subject, html_body=html,
                                text_body=text)
    return ok


def cancel_subscription_v2(db: Session, sub: Subscription, *,
                              reason: str,
                              at_period_end: bool = True,
                              with_refund: bool = False,
                              actor: Optional[User] = None
                              ) -> Dict[str, Any]:
    """v8.3 cancel with options.

    at_period_end=True (default): mark service_ends_at = current_period_end,
      sub remains 'active' until daily realize job promotes it. Lodge keeps
      using the platform until then. No refund.

    at_period_end=False, with_refund=False: immediate cancel (old behavior).
      Lodge access ends now. No refund.

    at_period_end=False, with_refund=True: immediate cancel + prorated
      refund for unused portion of current period.

    Returns {sub: subscription_dict, refund: refund_dict|None}.
    """
    if sub.status == SubscriptionStatus.cancelled.value:
        return {"sub": sub, "refund": None, "already_cancelled": True}

    refund = None
    if at_period_end:
        # Mark for end-of-period cancellation on our side, AND tell Razorpay
        # to honour cancel-at-cycle-end so no surprise charge fires while
        # we wait for the daily realize-due job to flip our status. The
        # daily job still runs as a safety net in case the provider call
        # failed transiently (it's idempotent — the second cancel is a no-op).
        sub.service_ends_at = sub.current_period_end or date.today()
        sub.cancellation_reason = (reason or "").strip()[:2000] or "Cancelled by lodge"
        if sub.provider_subscription_id:
            try:
                get_provider().cancel_subscription(sub.provider_subscription_id,
                                                     cancel_at_cycle_end=True)
            except Exception:
                logger.exception("Provider cancel-at-cycle-end failed (will retry "
                                  "via realize_due_cancellations job)")
        db.commit(); db.refresh(sub)
    else:
        # Immediate path
        if with_refund:
            try:
                refund = issue_refund(db, sub, reason=reason,
                                        actor_user_id=actor.user_id if actor else None)
            except Exception:
                logger.exception("Refund issuance failed (continuing with cancel)")
        # Cancel at provider
        if sub.provider_subscription_id:
            get_provider().cancel_subscription(sub.provider_subscription_id)
        sub.status = SubscriptionStatus.cancelled.value
        sub.cancelled_at = _utcnow()
        sub.cancellation_reason = (reason or "").strip()[:2000] or "Cancelled by lodge"
        sub.next_charge_date = None
        sub.service_ends_at = date.today()
        db.commit(); db.refresh(sub)

    return {"sub": sub, "refund": refund,
            "at_period_end": at_period_end, "with_refund": with_refund}


def realize_due_cancellations(db: Session) -> Dict[str, int]:
    """Daily job: actually cancel subscriptions whose service_ends_at
    has arrived (i.e., the period they paid for is over).

    Doesn't issue refunds — by definition they used the whole period.
    """
    today = date.today()
    due = (db.query(Subscription)
             .filter(Subscription.service_ends_at != None,
                     Subscription.service_ends_at <= today,
                     Subscription.status != SubscriptionStatus.cancelled.value)
             .all())
    realized = 0
    for sub in due:
        try:
            if sub.provider_subscription_id:
                get_provider().cancel_subscription(sub.provider_subscription_id)
            sub.status = SubscriptionStatus.cancelled.value
            sub.cancelled_at = _utcnow()
            sub.next_charge_date = None
            db.commit()
            realized += 1
        except Exception:
            logger.exception("Failed to realize cancellation for sub %s",
                             sub.subscription_id)
    return {"checked": len(due), "realized": realized}
