"""
Alert Service - Parameter-based notification system.
Checks settings to determine if SMS/Email/None should be sent.
"""
import re
import smtplib
# Multi-vendor SMS routing (Twilio / MSG91) — see sms_service.py
from .sms_service import send_sms, normalize_indian_phone, normalize_phone_e164, get_sms_vendor_status  # noqa: F401
import os
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.orm import Session

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..models import Alert, AlertType, AlertEvent, AlertStatus, Checkin, Customer, Room, Setting

logger = logging.getLogger(__name__)


# ─── Recipient validation ────────────────────────────────────────────────
# This product is deployed in India, so we deliberately restrict SMS
# recipients to Indian mobile numbers. Twilio geo-permissions, DLT
# registration, and our sender-ID configuration are all India-specific —
# letting a non-Indian E.164 number through would either silently fail at
# the carrier or burn money on an undeliverable international SMS.

_INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def normalize_indian_phone(raw: str) -> str:
    """Return a canonical +91XXXXXXXXXX form for an Indian mobile.

    Accepted inputs (after stripping spaces, dashes, parens, dots):
      - 10 digits starting 6/7/8/9            (9876543210)
      - 11 digits, leading 0 + 10-digit mobile (09876543210)
      - 12 digits with 91 prefix              (919876543210)
      - +919876543210
    Anything else — empty, junk, landline, or another country code —
    raises ValueError with the exact reason so the caller can persist
    it as the alert's error_message.
    """
    if raw is None:
        raise ValueError("Phone number is empty.")
    s = re.sub(r"[\s\-\(\)\. ]", "", str(raw))
    if not s:
        raise ValueError("Phone number is empty.")
    # Strip leading +91 / 91 / 0 to get the 10-digit subscriber part.
    if s.startswith("+"):
        if not s.startswith("+91"):
            raise ValueError(
                f"Only Indian (+91) numbers are supported; got '{raw}'."
            )
        s = s[3:]
    elif s.startswith("91") and len(s) == 12:
        s = s[2:]
    elif s.startswith("0") and len(s) == 11:
        s = s[1:]

    if not _INDIAN_MOBILE_RE.match(s):
        raise ValueError(
            f"Not a valid Indian mobile number: '{raw}'. "
            f"Expected 10 digits starting with 6, 7, 8, or 9."
        )
    return f"+91{s}"


def is_valid_email(addr: str) -> bool:
    return bool(addr) and bool(_EMAIL_RE.match(str(addr).strip()))


def get_setting(db: Session, key: str, default: str = "", lodge_id: Optional[int] = None) -> str:
    """Lodge-scoped setting lookup. If `lodge_id` is omitted we fall back to
    the global-style query, which only returns a value if exactly one row
    exists for that key — that's the case in single-lodge installs and
    matches old behaviour. New code should always pass `lodge_id`."""
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    setting = q.first()
    return setting.setting_value if setting else default


def is_sms_enabled(db: Session, lodge_id: Optional[int] = None) -> bool:
    return get_setting(db, "sms_enabled", "false", lodge_id=lodge_id).lower() == "true"


def is_email_enabled(db: Session, lodge_id: Optional[int] = None) -> bool:
    return get_setting(db, "email_enabled", "false", lodge_id=lodge_id).lower() == "true"


def get_hotel_name(db: Session, lodge_id: Optional[int] = None) -> str:
    return get_setting(db, "hotel_name", "Lodge", lodge_id=lodge_id)


def get_hotel_phone(db: Session, lodge_id: Optional[int] = None) -> str:
    return get_setting(db, "hotel_phone", "", lodge_id=lodge_id)


def send_sms(db: Session, phone: str, message: str, checkin_id: Optional[int] = None,
             customer_id: Optional[int] = None, event_type: str = "custom",
             lodge_id: Optional[int] = None) -> Alert:
    """Send SMS via configured provider. Logs result to alerts table.

    Recipient must be an Indian mobile number — anything else is rejected
    before we hit the provider, since this product targets India only.

    `lodge_id` determines which lodge's SMS configuration is used. If the
    caller doesn't provide it, we try to infer from the linked checkin or
    customer; if that also fails, settings fall back to lodge id 1.
    """
    # Resolve lodge_id from linked records if not given.
    resolved_lodge_id = lodge_id
    if resolved_lodge_id is None and checkin_id:
        ch = db.query(Checkin).filter(Checkin.checkin_id == checkin_id).first()
        if ch:
            resolved_lodge_id = ch.lodge_id
    if resolved_lodge_id is None and customer_id:
        c = db.query(Customer).filter(Customer.customer_id == customer_id).first()
        if c:
            resolved_lodge_id = c.lodge_id
    if resolved_lodge_id is None:
        resolved_lodge_id = 1  # last resort — single-lodge installs

    alert = Alert(
        lodge_id=resolved_lodge_id,
        checkin_id=checkin_id,
        customer_id=customer_id,
        alert_type=AlertType.sms,
        event_type=event_type,
        recipient=phone,
        message_content=message,
        status=AlertStatus.pending
    )
    db.add(alert)
    db.flush()

    # Validate + canonicalize the recipient up-front. Doing this *before* we
    # check the provider config means even a misconfigured deployment still
    # records a useful error ("not a valid Indian mobile") instead of the
    # confusing "SMS provider not configured" message.
    provider = get_setting(db, "sms_provider", "twilio", lodge_id=resolved_lodge_id)
    # MSG91 only works with Indian numbers; Twilio supports international
    indian_only = (provider == "msg91")
    try:
        to_number = normalize_phone_e164(phone, indian_only=indian_only)
    except ValueError as e:
        alert.status = AlertStatus.failed
        alert.error_message = str(e)
        logger.warning("SMS rejected at validation: %s", e)
        db.commit()
        return alert
    # Read the auth token under either name — frontend Settings page writes
    # `twilio_auth_token` (the actual Twilio terminology), older deployments
    # may have it under `sms_api_key`. Whichever has a value wins.
    api_key = (get_setting(db, "twilio_auth_token", "", lodge_id=resolved_lodge_id)
               or get_setting(db, "sms_api_key", "", lodge_id=resolved_lodge_id))
    sms_from = get_setting(db, "sms_from_number", "", lodge_id=resolved_lodge_id)

    if not api_key:
        logger.warning("SMS not configured: no API key. Logging as skipped.")
        alert.status = AlertStatus.skipped
        alert.error_message = "SMS provider not configured"
        db.commit()
        return alert

    try:
        if provider == "twilio":
            from twilio.rest import Client
            account_sid = get_setting(db, "twilio_account_sid", "", lodge_id=resolved_lodge_id)
            auth_token = api_key
            client = Client(account_sid, auth_token)
            # `to_number` is already +91XXXXXXXXXX from normalize_indian_phone() above.

            # India SMS delivery via Twilio normally requires a DLT-registered
            # sender, which Twilio exposes through a Messaging Service rather
            # than a raw From number. If the configured value looks like a
            # Messaging Service SID (starts with "MG"), pass it as
            # messaging_service_sid; otherwise treat it as a phone number.
            sender = (sms_from or "").strip()
            create_kwargs = {"body": message, "to": to_number}
            if sender.upper().startswith("MG"):
                create_kwargs["messaging_service_sid"] = sender
            elif sender:
                create_kwargs["from_"] = sender
            else:
                alert.status = AlertStatus.failed
                alert.error_message = (
                    "Twilio sender not configured: set 'Twilio From Number' "
                    "in Settings (a +E.164 number or an MG... Messaging Service SID)."
                )
                db.commit()
                return alert

            msg = client.messages.create(**create_kwargs)

            # Twilio's initial response is usually 'queued' / 'accepted'. A
            # status of 'failed' or 'undelivered' here means Twilio rejected
            # the request outright (common cause in India: sender not DLT-
            # registered, geo-permission off, account suspended). Surface the
            # real failure instead of marking the alert as 'sent'.
            initial_status = (getattr(msg, "status", "") or "").lower()
            err_code = getattr(msg, "error_code", None)
            err_msg = getattr(msg, "error_message", None)

            if initial_status in ("failed", "undelivered") or err_code:
                alert.status = AlertStatus.failed
                alert.error_message = (
                    f"Twilio {initial_status or 'error'}"
                    f"{f' [code {err_code}]' if err_code else ''}: "
                    f"{err_msg or 'No detail from provider'} "
                    f"(SID {msg.sid}, to {to_number})"
                )
                logger.error(
                    "SMS rejected by Twilio for %s. status=%s code=%s msg=%s",
                    phone, initial_status, err_code, err_msg,
                )
            else:
                alert.status = AlertStatus.sent
                alert.sent_at = _utcnow()
                # Persist the Twilio SID + initial status so the Alerts page
                # is diagnostic — operators can paste the SID into Twilio
                # Console to see carrier-side delivery status.
                alert.error_message = (
                    f"Twilio SID {msg.sid} ({initial_status or 'queued'}); "
                    f"sent to {to_number} via "
                    f"{'messaging_service ' + sender if sender.upper().startswith('MG') else 'from ' + sender}"
                )
                logger.info(f"SMS queued to {phone} via Twilio. SID: {msg.sid}")
        else:
            logger.warning(f"Unknown SMS provider: {provider}")
            alert.status = AlertStatus.skipped
            alert.error_message = f"Unknown provider: {provider}"
    except Exception as e:
        alert.status = AlertStatus.failed
        alert.error_message = str(e)
        logger.error(f"SMS failed to {phone}: {e}")

    db.commit()
    return alert


def send_email(db: Session, to_email: str, subject: str, html_body: str,
               checkin_id: Optional[int] = None, customer_id: Optional[int] = None,
               event_type: str = "custom", lodge_id: Optional[int] = None) -> Alert:
    """Send email via configured SMTP. Logs result to alerts table.

    `lodge_id` determines which lodge's SMTP credentials are used; same
    resolution path as send_sms."""
    resolved_lodge_id = lodge_id
    if resolved_lodge_id is None and checkin_id:
        ch = db.query(Checkin).filter(Checkin.checkin_id == checkin_id).first()
        if ch:
            resolved_lodge_id = ch.lodge_id
    if resolved_lodge_id is None and customer_id:
        c = db.query(Customer).filter(Customer.customer_id == customer_id).first()
        if c:
            resolved_lodge_id = c.lodge_id
    if resolved_lodge_id is None:
        resolved_lodge_id = 1

    alert = Alert(
        lodge_id=resolved_lodge_id,
        checkin_id=checkin_id,
        customer_id=customer_id,
        alert_type=AlertType.email,
        event_type=event_type,
        recipient=to_email,
        message_content=html_body,
        status=AlertStatus.pending
    )
    db.add(alert)
    db.flush()

    # Skip malformed addresses before opening an SMTP connection — saves a
    # round-trip and gives the operator a clear error in the Alerts log.
    if not is_valid_email(to_email):
        alert.status = AlertStatus.failed
        alert.error_message = f"Not a valid email address: '{to_email}'"
        logger.warning("Email rejected at validation: %s", to_email)
        db.commit()
        return alert

    smtp_host = get_setting(db, "smtp_host", "smtp.gmail.com", lodge_id=resolved_lodge_id)
    smtp_port = int(get_setting(db, "smtp_port", "587", lodge_id=resolved_lodge_id))
    smtp_user = (get_setting(db, "smtp_username", "", lodge_id=resolved_lodge_id)
                 or get_setting(db, "smtp_user", "", lodge_id=resolved_lodge_id))
    smtp_password = get_setting(db, "smtp_password", "", lodge_id=resolved_lodge_id)
    hotel_name = get_hotel_name(db, lodge_id=resolved_lodge_id)

    if not smtp_user or not smtp_password:
        logger.warning("Email not configured: no SMTP credentials. Logging as skipped.")
        alert.status = AlertStatus.skipped
        alert.error_message = "SMTP not configured"
        db.commit()
        return alert

    try:
        # Prefer admin-configured From settings if set, otherwise use SMTP user.
        from_name = get_setting(db, "email_from_name", "", lodge_id=resolved_lodge_id) or hotel_name
        from_addr = get_setting(db, "email_from_address", "", lodge_id=resolved_lodge_id) or smtp_user

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_addr}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            # Use envelope sender = SMTP user (some providers reject mismatched
            # MAIL FROM); the displayed From in the headers is the configured one.
            server.sendmail(smtp_user, to_email, msg.as_string())

        alert.status = AlertStatus.sent
        alert.sent_at = _utcnow()
        logger.info(f"Email sent to {to_email}")
    except Exception as e:
        alert.status = AlertStatus.failed
        alert.error_message = str(e)
        logger.error(f"Email failed to {to_email}: {e}")

    db.commit()
    return alert


def build_checkin_sms(hotel_name: str, name: str, room_no: str,
                       dt: str, deposit: float, hotel_phone: str) -> str:
    return (f"Dear {name}, welcome to {hotel_name}! Room {room_no} assigned. "
            f"Check-in: {dt}. Deposit: Rs.{deposit:.0f}. "
            f"Contact: {hotel_phone}. Have a pleasant stay!")


def build_checkout_sms(hotel_name: str, name: str, amount: float) -> str:
    return (f"Dear {name}, thank you for staying at {hotel_name}. "
            f"Total bill: Rs.{amount:.2f}. We hope to see you again soon!")


def build_reminder_sms(hotel_name: str, name: str, room_no: str, date: str) -> str:
    return (f"Dear {name}, your checkout from Room {room_no} at {hotel_name} "
            f"is scheduled for tomorrow ({date}). Contact reception to extend.")


def build_checkin_email(hotel_name: str, customer: Customer, room: Room,
                         checkin: Checkin, hotel_phone: str) -> str:
    return f"""
    <html><body style="font-family:Arial,sans-serif;background:#FDF8EE;margin:0;padding:20px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
      <div style="background:#1B2A4A;padding:30px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:28px">{hotel_name}</h1>
        <p style="color:#fff;margin:8px 0 0">Check-in Confirmation</p>
      </div>
      <div style="padding:30px">
        <p style="color:#333;font-size:16px">Dear <strong>{customer.first_name} {customer.last_name}</strong>,</p>
        <p style="color:#555">Welcome! Your check-in has been confirmed.</p>
        <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#666;width:40%">Room Number</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{room.room_number} ({room.room_type.replace('_',' ').title()})</td></tr>
            <tr><td style="padding:8px 0;color:#666">Check-in</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{checkin.checkin_datetime.strftime('%d %b %Y, %I:%M %p')}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Expected Checkout</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{checkin.expected_checkout.strftime('%d %b %Y, %I:%M %p') if checkin.expected_checkout else 'Not specified'}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Guests</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{checkin.members_count}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Deposit Paid</td>
                <td style="padding:8px 0;font-weight:bold;color:#2E7D32">Rs. {checkin.deposit_amount:.2f}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Tariff/Night</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">Rs. {checkin.tariff_per_night:.2f}</td></tr>
          </table>
        </div>
        <p style="color:#555">For any assistance, contact reception at <strong>{hotel_phone}</strong></p>
        <p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:20px">
          This is an automated email from {hotel_name} Rusto.</p>
      </div>
    </div></body></html>"""


def build_invoice_email(hotel_name: str, invoice, customer: Customer, room: Room) -> str:
    return f"""
    <html><body style="font-family:Arial,sans-serif;background:#FDF8EE;margin:0;padding:20px">
    <div style="max-width:650px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
      <div style="background:#1B2A4A;padding:30px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:28px">{hotel_name}</h1>
        <p style="color:#fff;margin:8px 0 0">Invoice #{invoice.invoice_number}</p>
      </div>
      <div style="padding:30px">
        <p style="color:#333;font-size:16px">Dear <strong>{customer.first_name} {customer.last_name}</strong>,</p>
        <p style="color:#555">Thank you for your stay. Please find your invoice below.</p>
        <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
          <h3 style="color:#1B2A4A;margin-top:0">Stay Details</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666">Room</td><td style="font-weight:bold;color:#1B2A4A">{room.room_number}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Check-in</td><td style="font-weight:bold">{invoice.checkin_datetime.strftime('%d %b %Y, %I:%M %p')}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Checkout</td><td style="font-weight:bold">{invoice.checkout_datetime.strftime('%d %b %Y, %I:%M %p')}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Nights</td><td style="font-weight:bold">{invoice.nights}</td></tr>
          </table>
          <hr style="margin:15px 0;border:none;border-top:1px solid #ddd">
          <h3 style="color:#1B2A4A">Bill Summary</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#666">Room Charges ({invoice.nights} nights × Rs.{invoice.tariff_per_night:.2f})</td>
                <td style="text-align:right;font-weight:bold">Rs. {invoice.room_charges:.2f}</td></tr>
            {'<tr><td style="padding:6px 0;color:#666">Additional Charges</td><td style="text-align:right;font-weight:bold">Rs. ' + f'{invoice.additional_charges:.2f}</td></tr>' if invoice.additional_charges > 0 else ''}
            {'<tr><td style="padding:6px 0;color:#666">GST</td><td style="text-align:right;font-weight:bold">Rs. ' + f'{invoice.gst_amount:.2f}</td></tr>' if invoice.gst_amount > 0 else ''}
            {'<tr><td style="padding:6px 0;color:#C62828">Discount</td><td style="text-align:right;font-weight:bold;color:#C62828">- Rs. ' + f'{invoice.discount:.2f}</td></tr>' if invoice.discount > 0 else ''}
            <tr><td style="padding:6px 0;color:#666">Deposit Paid</td><td style="text-align:right;font-weight:bold">Rs. {invoice.deposit_paid:.2f}</td></tr>
            <tr style="border-top:2px solid #1B2A4A"><td style="padding:12px 0;font-size:18px;font-weight:bold;color:#1B2A4A">Total Payable</td>
                <td style="text-align:right;font-size:18px;font-weight:bold;color:#C9A84C">Rs. {invoice.total_amount:.2f}</td></tr>
          </table>
        </div>
        <p style="color:#2E7D32;font-weight:bold">Payment Mode: {(invoice.payment_mode or 'cash').upper()}</p>
        <p style="color:#555;margin-top:20px">We hope you enjoyed your stay at {hotel_name}. Looking forward to seeing you again!</p>
      </div>
    </div></body></html>"""


def trigger_checkin_alerts(db: Session, checkin: Checkin, customer: Customer, room: Room,
                            sms_preference: str = "yes"):
    """
    Parameter-based alert trigger for check-in events.
    All settings reads (hotel name/phone, sms_enabled, admin_phone) and all
    alert sends are scoped to the checkin's lodge so the right branding and
    provider credentials are used.
    """
    lid = checkin.lodge_id
    hotel_name = get_hotel_name(db, lodge_id=lid)
    hotel_phone = get_hotel_phone(db, lodge_id=lid)
    dt_str = checkin.checkin_datetime.strftime("%d %b %Y, %I:%M %p")

    # SMS Alert
    if is_sms_enabled(db, lodge_id=lid) and sms_preference.lower() == "yes" and customer.phone:
        msg = build_checkin_sms(hotel_name, customer.first_name, room.room_number,
                                 dt_str, float(checkin.deposit_amount), hotel_phone)
        send_sms(db, customer.phone, msg, checkin.checkin_id, customer.customer_id, "checkin",
                 lodge_id=lid)

        # Admin SMS notification
        admin_phone = get_setting(db, "admin_phone", "", lodge_id=lid)
        if admin_phone:
            admin_msg = (f"New check-in: {customer.first_name} {customer.last_name} "
                         f"in Room {room.room_number}. Time: {dt_str}.")
            send_sms(db, admin_phone, admin_msg, checkin.checkin_id, None, "checkin",
                     lodge_id=lid)
    else:
        # Log as skipped
        _log_skipped(db, "sms", "checkin", customer.phone or "", "SMS disabled or not requested",
                     checkin.checkin_id, customer.customer_id, lodge_id=lid)

    # Email Alert
    if is_email_enabled(db, lodge_id=lid) and customer.email:
        subject = f"Check-in Confirmation - {hotel_name} | Room {room.room_number}"
        body = build_checkin_email(hotel_name, customer, room, checkin, hotel_phone)
        send_email(db, customer.email, subject, body, checkin.checkin_id, customer.customer_id,
                   "checkin", lodge_id=lid)
    else:
        _log_skipped(db, "email", "checkin", customer.email or "", "Email disabled or no email",
                     checkin.checkin_id, customer.customer_id, lodge_id=lid)


def trigger_checkout_alerts(db: Session, checkin: Checkin, invoice, customer: Customer, room: Room):
    """Parameter-based alert trigger for checkout events. Lodge-scoped via the checkin."""
    lid = checkin.lodge_id
    hotel_name = get_hotel_name(db, lodge_id=lid)

    # SMS
    if is_sms_enabled(db, lodge_id=lid) and customer.phone:
        msg = build_checkout_sms(hotel_name, customer.first_name, float(invoice.total_amount))
        send_sms(db, customer.phone, msg, checkin.checkin_id, customer.customer_id, "checkout",
                 lodge_id=lid)
    else:
        _log_skipped(db, "sms", "checkout", customer.phone or "", "SMS disabled",
                     checkin.checkin_id, customer.customer_id, lodge_id=lid)

    # Email with invoice
    if is_email_enabled(db, lodge_id=lid) and customer.email:
        subject = f"Invoice #{invoice.invoice_number} - Thank you for staying at {hotel_name}"
        body = build_invoice_email(hotel_name, invoice, customer, room)
        send_email(db, customer.email, subject, body, checkin.checkin_id, customer.customer_id,
                   "checkout", lodge_id=lid)
    else:
        _log_skipped(db, "email", "checkout", customer.email or "", "Email disabled or no email",
                     checkin.checkin_id, customer.customer_id, lodge_id=lid)


def _log_skipped(db: Session, alert_type: str, event_type: str, recipient: str,
                  reason: str, checkin_id=None, customer_id=None, booking_id=None,
                  lodge_id: Optional[int] = None):
    """Stamp the skip log with the lodge so it's visible only in that lodge's Alerts page."""
    # If lodge_id wasn't provided, try to infer it from linked records (best-effort).
    if lodge_id is None and checkin_id:
        ch = db.query(Checkin).filter(Checkin.checkin_id == checkin_id).first()
        if ch:
            lodge_id = ch.lodge_id
    if lodge_id is None and customer_id:
        c = db.query(Customer).filter(Customer.customer_id == customer_id).first()
        if c:
            lodge_id = c.lodge_id
    if lodge_id is None:
        lodge_id = 1

    alert = Alert(
        lodge_id=lodge_id,
        checkin_id=checkin_id, customer_id=customer_id, booking_id=booking_id,
        alert_type=alert_type, event_type=event_type,
        recipient=recipient or "N/A", message_content="[SKIPPED]",
        status=AlertStatus.skipped, error_message=reason
    )
    db.add(alert)
    db.commit()


# ── Booking SMS/Email templates ───────────────────────────────────────

def build_booking_sms(hotel_name: str, name: str, booking_ref: str,
                       room_type: str, rooms: int, checkin_date: str,
                       checkout_date: str, nights: int, total: float,
                       advance: float, hotel_phone: str) -> str:
    room_type_label = room_type.replace("_", " ").title()
    msg = (f"Dear {name}, your booking at {hotel_name} is confirmed! "
           f"Ref: {booking_ref}. {rooms} {room_type_label} room(s), "
           f"{checkin_date} to {checkout_date} ({nights} night(s)). "
           f"Total: Rs.{total:.0f}.")
    if advance > 0:
        msg += f" Advance paid: Rs.{advance:.0f}."
    if hotel_phone:
        msg += f" Contact: {hotel_phone}."
    return msg


def build_booking_cancelled_sms(hotel_name: str, name: str, booking_ref: str,
                                  reason: str = "") -> str:
    msg = (f"Dear {name}, your booking {booking_ref} at {hotel_name} "
           f"has been cancelled.")
    if reason:
        msg += f" Reason: {reason}."
    msg += " Contact us for any queries."
    return msg


def build_booking_reminder_sms(hotel_name: str, name: str, booking_ref: str,
                                 checkin_date: str, rooms: int,
                                 room_type: str, hotel_phone: str) -> str:
    room_type_label = room_type.replace("_", " ").title()
    return (f"Dear {name}, reminder: your reservation {booking_ref} at "
            f"{hotel_name} is on {checkin_date}. "
            f"{rooms} {room_type_label} room(s) reserved. "
            f"Contact: {hotel_phone}. We look forward to welcoming you!")


def build_booking_email(hotel_name: str, name: str, booking_ref: str,
                         room_type: str, rooms: int, checkin_date: str,
                         checkout_date: str, nights: int, adults: int,
                         children: int, tariff: float, total: float,
                         advance: float, advance_mode: str,
                         special_requests: str, hotel_phone: str) -> str:
    room_type_label = room_type.replace("_", " ").title()
    balance = max(0, total - advance)
    return f"""
    <html><body style="font-family:Arial,sans-serif;background:#FDF8EE;margin:0;padding:20px">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
      <div style="background:#1B2A4A;padding:30px;text-align:center">
        <h1 style="color:#C9A84C;margin:0;font-size:28px">{hotel_name}</h1>
        <p style="color:#fff;margin:8px 0 0">Booking Confirmation</p>
      </div>
      <div style="padding:30px">
        <p style="color:#333;font-size:16px">Dear <strong>{name}</strong>,</p>
        <p style="color:#555">Your reservation has been confirmed. Here are your booking details:</p>
        <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:20px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#666;width:40%">Booking Ref</td>
                <td style="padding:8px 0;font-weight:bold;color:#C9A84C">{booking_ref}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Room Type</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{room_type_label} x {rooms}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Check-in</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{checkin_date}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Check-out</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{checkout_date}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Duration</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{nights} night(s)</td></tr>
            <tr><td style="padding:8px 0;color:#666">Guests</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">{adults} adult(s){f', {children} child(ren)' if children else ''}</td></tr>
            <tr><td style="padding:8px 0;color:#666">Tariff</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A">Rs. {tariff:.2f} / room / night</td></tr>
            <tr style="border-top:1px solid #ddd"><td style="padding:8px 0;color:#666">Total Amount</td>
                <td style="padding:8px 0;font-weight:bold;color:#1B2A4A;font-size:16px">Rs. {total:.2f}</td></tr>
            {'<tr><td style="padding:8px 0;color:#666">Advance Paid (' + advance_mode + ')</td><td style="padding:8px 0;font-weight:bold;color:#2E7D32">Rs. ' + f'{advance:.2f}</td></tr>' if advance > 0 else ''}
            {'<tr><td style="padding:8px 0;color:#666">Balance Due at Check-in</td><td style="padding:8px 0;font-weight:bold;color:#C62828">Rs. ' + f'{balance:.2f}</td></tr>' if advance > 0 and balance > 0 else ''}
          </table>
        </div>
        {'<p style="color:#555"><strong>Special Requests:</strong> ' + special_requests + '</p>' if special_requests else ''}
        <p style="color:#555">For any changes or queries, contact us at <strong>{hotel_phone}</strong>.</p>
        <p style="color:#999;font-size:12px;margin-top:30px;border-top:1px solid #eee;padding-top:20px">
          This is an automated email from {hotel_name} Rusto.</p>
      </div>
    </div></body></html>"""


# ── Booking alert triggers ────────────────────────────────────────────

def trigger_booking_alerts(db: Session, booking, customer_phone: str,
                            customer_email: str = None):
    """Send booking confirmation SMS + Email after a new reservation is created.
    All settings reads + sends use the booking's lodge."""
    lid = booking.lodge_id
    hotel_name = get_hotel_name(db, lodge_id=lid)
    hotel_phone = get_hotel_phone(db, lodge_id=lid)
    rtype = booking.room_type_requested.value if hasattr(booking.room_type_requested, "value") else booking.room_type_requested
    ci_date = booking.checkin_date.strftime("%d %b %Y")
    co_date = booking.checkout_date.strftime("%d %b %Y")

    # SMS
    if is_sms_enabled(db, lodge_id=lid) and customer_phone:
        msg = build_booking_sms(
            hotel_name, booking.guest_name, booking.booking_ref,
            rtype, booking.rooms_count or 1,
            ci_date, co_date, booking.nights,
            float(booking.total_amount), float(booking.advance_amount or 0),
            hotel_phone)
        send_sms(db, customer_phone, msg, customer_id=None,
                 event_type="booking", lodge_id=lid)
        # Admin notification
        admin_phone = get_setting(db, "admin_phone", "", lodge_id=lid)
        if admin_phone:
            admin_msg = (f"New booking: {booking.guest_name}, Ref {booking.booking_ref}. "
                         f"{booking.rooms_count or 1} {rtype.replace('_',' ')} room(s), "
                         f"{ci_date}-{co_date}. Total: Rs.{float(booking.total_amount):.0f}.")
            send_sms(db, admin_phone, admin_msg, event_type="booking", lodge_id=lid)
    else:
        _log_skipped(db, "sms", "booking", customer_phone or "",
                     "SMS disabled or no phone", lodge_id=lid)

    # Email
    guest_email = customer_email or booking.guest_email
    if is_email_enabled(db, lodge_id=lid) and guest_email:
        subject = f"Booking Confirmed - {booking.booking_ref} | {hotel_name}"
        body = build_booking_email(
            hotel_name, booking.guest_name, booking.booking_ref,
            rtype, booking.rooms_count or 1,
            ci_date, co_date, booking.nights,
            booking.adults or 1, booking.children or 0,
            float(booking.tariff_per_night), float(booking.total_amount),
            float(booking.advance_amount or 0),
            booking.advance_payment_mode or "cash",
            booking.special_requests or "", hotel_phone)
        send_email(db, guest_email, subject, body, event_type="booking", lodge_id=lid)
    else:
        _log_skipped(db, "email", "booking", guest_email or "",
                     "Email disabled or no email", lodge_id=lid)


def trigger_booking_cancelled_alerts(db: Session, booking, reason: str = ""):
    """Send cancellation SMS + Email when a booking is cancelled (lodge-scoped)."""
    lid = booking.lodge_id
    hotel_name = get_hotel_name(db, lodge_id=lid)

    # SMS
    if is_sms_enabled(db, lodge_id=lid) and booking.guest_phone:
        msg = build_booking_cancelled_sms(
            hotel_name, booking.guest_name, booking.booking_ref, reason)
        send_sms(db, booking.guest_phone, msg, event_type="booking_cancelled", lodge_id=lid)
    else:
        _log_skipped(db, "sms", "booking_cancelled",
                     booking.guest_phone or "", "SMS disabled or no phone", lodge_id=lid)

    # Email
    if is_email_enabled(db, lodge_id=lid) and booking.guest_email:
        subject = f"Booking Cancelled - {booking.booking_ref} | {hotel_name}"
        body = f"""
        <html><body style="font-family:Arial,sans-serif;background:#FDF8EE;margin:0;padding:20px">
        <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
          <div style="background:#C62828;padding:30px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:28px">{hotel_name}</h1>
            <p style="color:#ffcdd2;margin:8px 0 0">Booking Cancellation</p>
          </div>
          <div style="padding:30px">
            <p style="color:#333">Dear <strong>{booking.guest_name}</strong>,</p>
            <p style="color:#555">Your booking <strong>{booking.booking_ref}</strong> has been cancelled.</p>
            {'<p style="color:#555"><strong>Reason:</strong> ' + reason + '</p>' if reason else ''}
            {('<p style="color:#2E7D32;font-weight:bold">Advance of Rs. ' + f'{float(booking.advance_amount):.2f} will be refunded as per our policy.</p>') if float(booking.advance_amount or 0) > 0 else ''}
            <p style="color:#555">If you have any questions, please contact us.</p>
          </div>
        </div></body></html>"""
        send_email(db, booking.guest_email, subject, body,
                   event_type="booking_cancelled", lodge_id=lid)
    else:
        _log_skipped(db, "email", "booking_cancelled",
                     booking.guest_email or "", "Email disabled or no email", lodge_id=lid)
