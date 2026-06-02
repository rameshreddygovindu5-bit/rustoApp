"""Email service — template rendering, automation hooks, and the
default-template seeder.

Public API:
  - MERGE_VARIABLES: list of supported {{var}} names the UI surfaces
  - render_template(text, ctx) -> str: simple {{var}} substitution
  - send_with_template(db, lodge_id, template_key, ctx, to, ...) -> EmailLog
  - seed_default_templates(db, lodge_id, created_by) -> int (count)
  - send_booking_confirmation(db, booking) — automation hook
  - send_pre_arrival(db, booking)          — automation hook (scheduled)
  - send_checkin_welcome(db, checkin)      — automation hook
  - send_post_stay_thanks(db, checkin)     — automation hook

Why our own substitution (not Jinja): the templates only need merge
tags. Avoiding Jinja keeps the dependency surface small AND means we
can't accidentally execute arbitrary expressions if a guest's name
contains curly braces.
"""
import logging
import re
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..models import (EmailTemplate, EmailLog, Booking, Checkin, Customer,
                      Setting)
from .smtp_service import send_email_via_smtp

logger = logging.getLogger(__name__)


# ── Merge variables ──────────────────────────────────────────────────
# Documented contract — what each variable means + which contexts it
# applies to. The UI reads MERGE_VARIABLES to show click-to-insert chips
# in the template editor. Adding a new variable here is the one place
# you need to update; the renderer just substitutes whatever's in the
# context dict.
MERGE_VARIABLES = [
    {"key": "guest_name",      "label": "Guest name",       "example": "Aarav Patel"},
    {"key": "first_name",      "label": "First name",       "example": "Aarav"},
    {"key": "hotel_name",      "label": "Hotel name",       "example": "My Lodge"},
    {"key": "hotel_phone",     "label": "Hotel phone",      "example": "+91 90000 00000"},
    {"key": "hotel_email",     "label": "Hotel email",      "example": "stay@example.com"},
    {"key": "hotel_address",   "label": "Hotel address",    "example": "Main Rd, Vizag"},
    {"key": "booking_ref",     "label": "Booking reference","example": "BK-20260528-A1B2"},
    {"key": "room_type",       "label": "Room type",        "example": "Deluxe AC"},
    {"key": "room_number",     "label": "Room number",      "example": "203"},
    {"key": "arrival_date",    "label": "Arrival date",     "example": "28 May 2026"},
    {"key": "departure_date",  "label": "Departure date",   "example": "30 May 2026"},
    {"key": "nights",          "label": "Number of nights", "example": "2"},
    {"key": "total_amount",    "label": "Total amount",     "example": "₹3,400"},
    {"key": "tariff_per_night","label": "Per-night tariff", "example": "₹1,700"},
]

# Match {{var}} with optional whitespace inside the braces.
_TAG_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def render_template(text: str, ctx: dict) -> str:
    """Substitute {{var}} tags from ctx. Unknown tags are left in place
    (visible bug rather than silent drop). String-coerce everything."""
    if not text:
        return ""
    def _replace(m):
        key = m.group(1)
        if key in ctx and ctx[key] is not None:
            return str(ctx[key])
        return m.group(0)
    return _TAG_RE.sub(_replace, text)


# ── Hotel-info helper (read from Setting rows) ───────────────────────
def _hotel_info(db: Session, lodge_id: int) -> dict:
    keys = ["hotel_name", "hotel_phone", "hotel_email", "hotel_address"]
    out = {}
    for k in keys:
        row = (db.query(Setting)
               .filter(Setting.lodge_id == lodge_id, Setting.setting_key == k).first())
        out[k] = (row.setting_value if row and row.setting_value else "")
    if not out["hotel_name"]:
        out["hotel_name"] = "Lodge"
    return out


def _fmt_date(d) -> str:
    if d is None:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    return d.strftime("%d %b %Y")


def _fmt_money(n) -> str:
    if n is None:
        return ""
    try:
        return f"₹{float(n):,.0f}"
    except (TypeError, ValueError):
        return str(n)


# ── Core send-with-template ──────────────────────────────────────────
def send_with_template(db: Session, lodge_id: int, template_key: str,
                        ctx: dict, to_email: Optional[str],
                        *, source: str = "automated",
                        customer_id: Optional[int] = None,
                        booking_id: Optional[int] = None,
                        checkin_id: Optional[int] = None,
                        sent_by: Optional[int] = None) -> EmailLog:
    """Look up the active template by key, render it, send it, and log.

    Returns the EmailLog row regardless of success — caller can check
    .status to see what happened. We never raise: a single guest's
    bad email shouldn't break a booking flow.
    """
    tpl = (db.query(EmailTemplate)
           .filter(EmailTemplate.lodge_id == lodge_id,
                   EmailTemplate.template_key == template_key,
                   EmailTemplate.is_active == True).first())
    if not tpl:
        log = EmailLog(lodge_id=lodge_id, template_key=template_key,
                       to_email=(to_email or "")[:160],
                       subject="(template missing)", source=source,
                       status="skipped",
                       error_message=f"No active template with key {template_key!r}",
                       customer_id=customer_id, booking_id=booking_id,
                       checkin_id=checkin_id, sent_by=sent_by)
        db.add(log); db.commit(); return log

    # Merge hotel info into context (don't let caller's ctx override it)
    full_ctx = {**ctx, **_hotel_info(db, lodge_id)}
    # But keep caller-supplied values if they match keys we use (e.g. when
    # rendering for a preview); above order means hotel-info wins.
    full_ctx.update(_hotel_info(db, lodge_id))
    subject = render_template(tpl.subject, full_ctx)
    body = render_template(tpl.body_html, full_ctx)

    log = EmailLog(lodge_id=lodge_id, template_id=tpl.template_id,
                   template_key=template_key,
                   to_email=(to_email or "")[:160],
                   subject=subject[:200], source=source,
                   customer_id=customer_id, booking_id=booking_id,
                   checkin_id=checkin_id, sent_by=sent_by)

    if not to_email:
        log.status = "skipped"; log.error_message = "No recipient address"
    else:
        ok, info = send_email_via_smtp(db, lodge_id, to_email, subject, body)
        log.status = "sent" if ok else "failed"
        if not ok:
            log.error_message = info[:1000]
    db.add(log); db.commit()
    return log


# ── Default-template seed ────────────────────────────────────────────
# A small, well-considered set of starter templates. Each carries a
# stable template_key so the automation hooks can find it. Admins can
# edit the body freely; only the key is sacred.
DEFAULT_TEMPLATES = [
    {
        "key": "booking_confirmation",
        "name": "Booking confirmation",
        "subject": "Your booking is confirmed at {{hotel_name}}",
        "description": "Sent immediately when a reservation is created with a guest email.",
        "body": """\
<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#101828">
  <h2 style="color:#1B2A4A;margin:0 0 8px;font-family:Georgia,serif">Hello {{first_name}},</h2>
  <p>Thank you for booking with <strong>{{hotel_name}}</strong>. Your reservation is confirmed.</p>
  <table style="margin:16px 0;width:100%;border-collapse:collapse;border:1px solid #E5E8EE;border-radius:8px;overflow:hidden">
    <tr><td style="padding:10px 14px;background:#F9FAFB;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085">Booking ref</td><td style="padding:10px 14px;font-weight:bold;font-family:monospace">{{booking_ref}}</td></tr>
    <tr><td style="padding:10px 14px;background:#F9FAFB;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085">Arrival</td><td style="padding:10px 14px">{{arrival_date}}</td></tr>
    <tr><td style="padding:10px 14px;background:#F9FAFB;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085">Departure</td><td style="padding:10px 14px">{{departure_date}}</td></tr>
    <tr><td style="padding:10px 14px;background:#F9FAFB;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085">Room type</td><td style="padding:10px 14px">{{room_type}}</td></tr>
    <tr><td style="padding:10px 14px;background:#F9FAFB;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085">Total</td><td style="padding:10px 14px;font-weight:bold">{{total_amount}}</td></tr>
  </table>
  <p>If you need to make any changes, please reply to this email or call us at {{hotel_phone}}.</p>
  <p style="margin-top:24px;color:#667085;font-size:13px">— {{hotel_name}}<br>{{hotel_address}}</p>
</div>""",
    },
    {
        "key": "pre_arrival",
        "name": "Pre-arrival reminder",
        "subject": "See you tomorrow at {{hotel_name}}",
        "description": "Sent 24 hours before arrival date.",
        "body": """\
<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#101828">
  <h2 style="color:#1B2A4A;margin:0 0 8px;font-family:Georgia,serif">Hello {{first_name}},</h2>
  <p>We're looking forward to welcoming you tomorrow ({{arrival_date}}).</p>
  <p>Your <strong>{{room_type}}</strong> room will be ready for check-in from 12:00 PM. If you need an earlier check-in or any special arrangements, just let us know.</p>
  <p>Booking reference: <span style="font-family:monospace;font-weight:bold">{{booking_ref}}</span></p>
  <p>Need anything? Reach us at {{hotel_phone}} or reply to this email.</p>
  <p style="margin-top:24px;color:#667085;font-size:13px">— {{hotel_name}}</p>
</div>""",
    },
    {
        "key": "checkin_welcome",
        "name": "Check-in welcome",
        "subject": "Welcome to {{hotel_name}}",
        "description": "Sent immediately after check-in completes.",
        "body": """\
<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#101828">
  <h2 style="color:#1B2A4A;margin:0 0 8px;font-family:Georgia,serif">Welcome, {{first_name}}.</h2>
  <p>You're checked in to room <strong>{{room_number}}</strong>. We hope you have a comfortable stay.</p>
  <p>If you need anything during your stay — fresh towels, room service, a recommendation for dinner — just call the front desk or message us.</p>
  <p style="margin-top:24px;color:#667085;font-size:13px">— {{hotel_name}}<br>{{hotel_phone}}</p>
</div>""",
    },
    {
        "key": "post_stay_thanks",
        "name": "Post-stay thank you",
        "subject": "Thank you for staying with {{hotel_name}}",
        "description": "Sent after checkout. Invites a review.",
        "body": """\
<div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#101828">
  <h2 style="color:#1B2A4A;margin:0 0 8px;font-family:Georgia,serif">Thank you, {{first_name}}.</h2>
  <p>It was a pleasure hosting you at {{hotel_name}}. We hope to see you again.</p>
  <p>We'd love to hear about your stay. If you have a minute, we'd really appreciate a short review — it helps other guests find us.</p>
  <p style="margin-top:24px;color:#667085;font-size:13px">— {{hotel_name}}<br>{{hotel_email}} · {{hotel_phone}}</p>
</div>""",
    },
]


def seed_default_templates(db: Session, lodge_id: int,
                            created_by: Optional[int] = None) -> int:
    """Idempotent: inserts any DEFAULT_TEMPLATES that don't already exist
    for the lodge. Returns the count newly created. Safe to call on every
    lodge bootstrap."""
    n = 0
    for t in DEFAULT_TEMPLATES:
        exists = (db.query(EmailTemplate)
                  .filter(EmailTemplate.lodge_id == lodge_id,
                          EmailTemplate.template_key == t["key"]).first())
        if exists:
            continue
        db.add(EmailTemplate(
            lodge_id=lodge_id, template_key=t["key"], name=t["name"],
            subject=t["subject"], body_html=t["body"],
            description=t.get("description"),
            is_active=True, updated_by=created_by,
        )); n += 1
    if n:
        db.commit()
    return n


# ── Automation hooks ─────────────────────────────────────────────────
def _booking_ctx(b: Booking) -> dict:
    first = (b.guest_name or "Guest").split(" ", 1)[0]
    nights = b.nights or 0
    return {
        "guest_name": b.guest_name or "",
        "first_name": first,
        "booking_ref": b.booking_ref or "",
        "room_type": (getattr(b.room_type_requested, "value", b.room_type_requested) or "").replace("_", " ").title(),
        "arrival_date": _fmt_date(b.checkin_date),
        "departure_date": _fmt_date(b.checkout_date),
        "nights": str(nights),
        "total_amount": _fmt_money(b.total_amount),
        "tariff_per_night": _fmt_money(b.tariff_per_night),
    }


def _checkin_ctx(db: Session, ch: Checkin) -> dict:
    cust = (db.query(Customer)
            .filter(Customer.customer_id == ch.customer_id).first()) if ch.customer_id else None
    name = (f"{cust.first_name} {cust.last_name}".strip()
            if cust else "Guest")
    first = name.split(" ", 1)[0] if name else "Guest"
    from ..models import Room
    room = db.query(Room).filter(Room.room_id == ch.room_id).first() if ch.room_id else None
    return {
        "guest_name": name,
        "first_name": first,
        "room_number": room.room_number if room else "",
        "room_type": (room.room_type if room else "").replace("_", " ").title() if room else "",
        "arrival_date": _fmt_date(ch.checkin_datetime),
        "departure_date": _fmt_date(ch.expected_checkout or ch.actual_checkout),
        "total_amount": _fmt_money(ch.total_amount),
        "tariff_per_night": _fmt_money(ch.tariff_per_night),
    }


def send_booking_confirmation(db: Session, booking: Booking) -> Optional[EmailLog]:
    """Fired on Booking create. Skips silently if guest has no email."""
    if not booking.guest_email:
        return None
    try:
        return send_with_template(
            db, booking.lodge_id, "booking_confirmation",
            _booking_ctx(booking), booking.guest_email,
            source="automated", booking_id=booking.booking_id,
            customer_id=booking.customer_id,
        )
    except Exception:
        logger.exception("booking_confirmation send failed for booking %s", booking.booking_id)
        return None


def send_pre_arrival(db: Session, booking: Booking) -> Optional[EmailLog]:
    if not booking.guest_email:
        return None
    try:
        return send_with_template(
            db, booking.lodge_id, "pre_arrival",
            _booking_ctx(booking), booking.guest_email,
            source="automated", booking_id=booking.booking_id,
            customer_id=booking.customer_id,
        )
    except Exception:
        logger.exception("pre_arrival send failed for booking %s", booking.booking_id)
        return None


def send_checkin_welcome(db: Session, checkin: Checkin) -> Optional[EmailLog]:
    """Fired right after a check-in is completed."""
    cust = (db.query(Customer)
            .filter(Customer.customer_id == checkin.customer_id).first()
            if checkin.customer_id else None)
    if not cust or not cust.email:
        return None
    try:
        return send_with_template(
            db, checkin.lodge_id, "checkin_welcome",
            _checkin_ctx(db, checkin), cust.email,
            source="automated", checkin_id=checkin.checkin_id,
            customer_id=checkin.customer_id,
        )
    except Exception:
        logger.exception("checkin_welcome send failed for checkin %s", checkin.checkin_id)
        return None


def send_post_stay_thanks(db: Session, checkin: Checkin) -> Optional[EmailLog]:
    """Fired on checkout. Best paired with the existing feedback-request flow."""
    cust = (db.query(Customer)
            .filter(Customer.customer_id == checkin.customer_id).first()
            if checkin.customer_id else None)
    if not cust or not cust.email:
        return None
    try:
        return send_with_template(
            db, checkin.lodge_id, "post_stay_thanks",
            _checkin_ctx(db, checkin), cust.email,
            source="automated", checkin_id=checkin.checkin_id,
            customer_id=checkin.customer_id,
        )
    except Exception:
        logger.exception("post_stay_thanks send failed for checkin %s", checkin.checkin_id)
        return None


# ── Scheduler job — pre-arrival batch ────────────────────────────────
def send_pre_arrival_batch(db_factory):
    """Job target: find all bookings arriving tomorrow with a guest email
    and send the pre-arrival template. db_factory is a callable returning
    a fresh Session (matches the pattern alert_service jobs use).

    De-duplication: we skip any booking that already has an EmailLog row
    for template_key='pre_arrival' — prevents double-sending if the job
    runs twice in a single day (e.g. after a server restart).
    """
    from ..database import SessionLocal
    db = db_factory() if db_factory else SessionLocal()
    try:
        tomorrow = date.today() + timedelta(days=1)
        bookings = (db.query(Booking)
                    .filter(Booking.checkin_date == tomorrow,
                            Booking.status.in_(["pending", "confirmed"]),
                            Booking.guest_email != None,
                            Booking.guest_email != "")
                    .all())
        sent = 0
        for b in bookings:
            already = (db.query(EmailLog)
                       .filter(EmailLog.lodge_id == b.lodge_id,
                               EmailLog.booking_id == b.booking_id,
                               EmailLog.template_key == "pre_arrival",
                               EmailLog.status == "sent").first())
            if already:
                continue
            log = send_pre_arrival(db, b)
            if log and log.status == "sent":
                sent += 1
        logger.info("pre_arrival_batch: %d/%d sent", sent, len(bookings))
        return sent
    finally:
        db.close()
