"""
Scheduler service using APScheduler for automated tasks.

Multi-tenant note: every alert-sending job iterates rows across ALL lodges
in one DB query (for efficiency) but groups them by `lodge_id` so each
lodge's branding (hotel_name, hotel_phone) and provider credentials (Twilio,
SMTP) are used for its own guests. Without that grouping a single set of
credentials would be picked for all lodges — silently wrong.
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, date, timedelta, timezone
from collections import defaultdict
import subprocess, os, logging
import pytz

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

logger = logging.getLogger(__name__)
# All cron jobs are defined in lodge-local time (IST). Pin the scheduler to
# Asia/Kolkata so jobs fire at the intended hour regardless of the host TZ.
scheduler = BackgroundScheduler(timezone=pytz.timezone("Asia/Kolkata"))


def get_db_session():
    from ..database import SessionLocal
    return SessionLocal()


def _lodges_seen(rows, attr: str = "lodge_id"):
    """Group rows by lodge_id so we can apply per-lodge branding/settings."""
    by_lodge = defaultdict(list)
    for r in rows:
        by_lodge[getattr(r, attr)].append(r)
    return by_lodge


def send_booking_arrival_reminders():
    """Daily at 10 AM: Send reminders to guests with bookings arriving in 2 days."""
    db = get_db_session()
    try:
        from ..models import Booking, BookingStatus
        from .alert_service import (is_sms_enabled, is_email_enabled, get_hotel_name,
                                     get_hotel_phone, build_booking_reminder_sms,
                                     send_sms, send_email)

        target_date = date.today() + timedelta(days=2)
        bookings = db.query(Booking).filter(
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
            Booking.checkin_date == target_date,
        ).all()

        if not bookings:
            return

        # Group by lodge so each lodge's branding + provider credentials apply.
        for lodge_id, lodge_bookings in _lodges_seen(bookings).items():
            hotel_name = get_hotel_name(db, lodge_id=lodge_id)
            hotel_phone = get_hotel_phone(db, lodge_id=lodge_id)
            sms_on = is_sms_enabled(db, lodge_id=lodge_id)
            email_on = is_email_enabled(db, lodge_id=lodge_id)

            for b in lodge_bookings:
                rtype = b.room_type_requested.value if hasattr(b.room_type_requested, "value") else b.room_type_requested
                ci_date = b.checkin_date.strftime("%d %b %Y")

                if sms_on and b.guest_phone:
                    msg = build_booking_reminder_sms(
                        hotel_name, b.guest_name, b.booking_ref,
                        ci_date, b.rooms_count or 1, rtype, hotel_phone)
                    send_sms(db, b.guest_phone, msg, event_type="reminder", lodge_id=lodge_id)

                if email_on and b.guest_email:
                    co_date = b.checkout_date.strftime("%d %b %Y")
                    room_type_label = rtype.replace("_", " ").title()
                    subject = f"Arrival Reminder - {b.booking_ref} | {hotel_name}"
                    body = f"""
                    <html><body style="font-family:Arial;padding:20px;background:#FDF8EE">
                    <div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:12px">
                      <h2 style="color:#1B2A4A">{hotel_name}</h2>
                      <p>Dear {b.guest_name},</p>
                      <p>This is a reminder that your reservation <strong>{b.booking_ref}</strong>
                      is coming up on <strong>{ci_date}</strong>.</p>
                      <div style="background:#f8f9fa;padding:15px;border-radius:8px;margin:15px 0">
                        <p style="margin:5px 0"><strong>Room:</strong> {room_type_label} x {b.rooms_count or 1}</p>
                        <p style="margin:5px 0"><strong>Check-in:</strong> {ci_date}</p>
                        <p style="margin:5px 0"><strong>Check-out:</strong> {co_date}</p>
                        <p style="margin:5px 0"><strong>Nights:</strong> {b.nights}</p>
                      </div>
                      <p>We look forward to welcoming you! Contact us at <strong>{hotel_phone}</strong> for any changes.</p>
                      <p style="color:#666;font-size:12px">Thank you for choosing {hotel_name}.</p>
                    </div></body></html>"""
                    send_email(db, b.guest_email, subject, body,
                               event_type="reminder", lodge_id=lodge_id)

        logger.info(f"Sent booking arrival reminders for {len(bookings)} reservations across {len(_lodges_seen(bookings))} lodge(s)")
    except Exception as e:
        logger.error(f"Booking arrival reminder job failed: {e}")
    finally:
        db.close()


def send_checkout_reminders():
    """Daily at 10 AM: Send reminders to guests checking out tomorrow."""
    db = get_db_session()
    try:
        from ..models import Checkin, CheckinStatus, Customer, Room
        from .alert_service import (is_sms_enabled, is_email_enabled, get_hotel_name,
                                     build_reminder_sms, send_sms, send_email, get_hotel_phone)

        tomorrow = date.today() + timedelta(days=1)
        tomorrow_start = datetime.combine(tomorrow, datetime.min.time())
        tomorrow_end = datetime.combine(tomorrow, datetime.max.time())
        checkins = db.query(Checkin).filter(
            Checkin.status == CheckinStatus.active,
            Checkin.expected_checkout >= tomorrow_start,
            Checkin.expected_checkout <= tomorrow_end,
        ).all()

        for lodge_id, lodge_checkins in _lodges_seen(checkins).items():
            hotel_name = get_hotel_name(db, lodge_id=lodge_id)
            sms_on = is_sms_enabled(db, lodge_id=lodge_id)
            email_on = is_email_enabled(db, lodge_id=lodge_id)

            for checkin in lodge_checkins:
                customer = checkin.customer
                room = checkin.room
                if not customer or not room:
                    continue
                date_str = tomorrow.strftime("%d %b %Y")

                if sms_on and customer.phone:
                    msg = build_reminder_sms(hotel_name, customer.first_name, room.room_number, date_str)
                    send_sms(db, customer.phone, msg, checkin.checkin_id, customer.customer_id,
                             "reminder", lodge_id=lodge_id)

                if email_on and customer.email:
                    subject = f"Checkout Reminder - {hotel_name}"
                    body = f"""
                    <html><body style="font-family:Arial;padding:20px;background:#FDF8EE">
                    <div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:12px">
                      <h2 style="color:#1B2A4A">{hotel_name}</h2>
                      <p>Dear {customer.first_name},</p>
                      <p>This is a reminder that your checkout from Room <strong>{room.room_number}</strong>
                      is scheduled for <strong>{date_str}</strong>.</p>
                      <p>If you wish to extend your stay, please contact the reception desk.</p>
                      <p style="color:#666;font-size:12px">Thank you for choosing {hotel_name}.</p>
                    </div></body></html>"""
                    send_email(db, customer.email, subject, body, checkin.checkin_id,
                               customer.customer_id, "reminder", lodge_id=lodge_id)

        logger.info(f"Sent checkout reminders for {len(checkins)} guests")
    except Exception as e:
        logger.error(f"Checkout reminder job failed: {e}")
    finally:
        db.close()


def send_overdue_alerts():
    """Daily at 9 AM: Alert admin (per lodge) about overdue checkouts."""
    db = get_db_session()
    try:
        from ..models import Checkin, CheckinStatus
        from .alert_service import get_setting, is_email_enabled, is_sms_enabled, send_email, send_sms

        now = datetime.now()
        overdue = db.query(Checkin).filter(
            Checkin.status == CheckinStatus.active,
            Checkin.expected_checkout < now,
            Checkin.expected_checkout.isnot(None),
        ).all()

        if not overdue:
            return

        for lodge_id, lodge_overdue in _lodges_seen(overdue).items():
            hotel_name = get_setting(db, "hotel_name", "Lodge", lodge_id=lodge_id)
            admin_email = get_setting(db, "admin_email", "", lodge_id=lodge_id)
            admin_phone = get_setting(db, "admin_phone", "", lodge_id=lodge_id)
            overdue_list = "\n".join([
                f"- Room {c.room.room_number}: {c.customer.first_name} {c.customer.last_name} "
                f"(Expected: {c.expected_checkout.strftime('%d-%b-%Y %I:%M %p') if c.expected_checkout else '—'})"
                for c in lodge_overdue if c.room and c.customer
            ])

            if is_sms_enabled(db, lodge_id=lodge_id) and admin_phone:
                msg = f"ALERT: {len(lodge_overdue)} overdue checkouts at {hotel_name}. Check dashboard."
                send_sms(db, admin_phone, msg, event_type="overdue", lodge_id=lodge_id)

            if is_email_enabled(db, lodge_id=lodge_id) and admin_email:
                subject = f"⚠️ Overdue Checkout Alert - {hotel_name}"
                body = f"""
                <html><body style="font-family:Arial;padding:20px">
                <h2 style="color:#C62828">Overdue Checkout Alert</h2>
                <p>{len(lodge_overdue)} guests have not checked out past their expected date:</p>
                <pre style="background:#f8f9fa;padding:15px;border-radius:8px">{overdue_list}</pre>
                <p>Please take necessary action.</p></body></html>"""
                send_email(db, admin_email, subject, body, event_type="overdue", lodge_id=lodge_id)

        logger.info(f"Overdue alert sent for {len(overdue)} guests across {len(_lodges_seen(overdue))} lodge(s)")
    except Exception as e:
        logger.error(f"Overdue alert job failed: {e}")
    finally:
        db.close()


def send_daily_summary():
    """Daily at 9 AM: Send a per-lodge summary to each lodge's admin."""
    db = get_db_session()
    try:
        from ..models import Checkin, CheckinStatus, Invoice, Lodge
        from .alert_service import get_setting, is_email_enabled, send_email
        from sqlalchemy import func, cast
        from sqlalchemy import Date as SqlDate

        today = date.today()
        yesterday = today - timedelta(days=1)

        # One summary per lodge so each admin only sees their own numbers.
        lodges = db.query(Lodge).filter(Lodge.is_active == True).all()
        for lodge in lodges:
            lid = lodge.lodge_id
            hotel_name = get_setting(db, "hotel_name", lodge.name, lodge_id=lid)
            admin_email = get_setting(db, "admin_email", "", lodge_id=lid)
            if not is_email_enabled(db, lodge_id=lid) or not admin_email:
                continue

            checkins_today = db.query(Checkin).filter(
                Checkin.lodge_id == lid,
                cast(Checkin.checkin_datetime, SqlDate) == today
            ).count()
            checkouts_today = db.query(Checkin).filter(
                Checkin.lodge_id == lid,
                cast(Checkin.actual_checkout, SqlDate) == today
            ).count()
            active = db.query(Checkin).filter(
                Checkin.lodge_id == lid,
                Checkin.status == CheckinStatus.active
            ).count()
            revenue = db.query(func.sum(Invoice.total_amount)).filter(
                Invoice.lodge_id == lid,
                cast(Invoice.created_at, SqlDate) == yesterday
            ).scalar() or 0

            subject = f"Daily Summary - {hotel_name} | {today.strftime('%d %b %Y')}"
            body = f"""
            <html><body style="font-family:Arial;background:#FDF8EE;padding:20px">
            <div style="max-width:600px;margin:0 auto;background:#fff;padding:30px;border-radius:12px">
              <h2 style="color:#1B2A4A">{hotel_name} - Daily Summary</h2>
              <p style="color:#666">{today.strftime('%A, %d %B %Y')}</p>
              <div style="display:flex;gap:20px;margin:20px 0;flex-wrap:wrap">
                <div style="background:#E8F5E9;padding:20px;border-radius:8px;flex:1;text-align:center">
                  <div style="font-size:32px;font-weight:bold;color:#2E7D32">{checkins_today}</div>
                  <div>Check-ins Today</div>
                </div>
                <div style="background:#FFEBEE;padding:20px;border-radius:8px;flex:1;text-align:center">
                  <div style="font-size:32px;font-weight:bold;color:#C62828">{checkouts_today}</div>
                  <div>Checkouts Today</div>
                </div>
                <div style="background:#E3F2FD;padding:20px;border-radius:8px;flex:1;text-align:center">
                  <div style="font-size:32px;font-weight:bold;color:#1565C0">{active}</div>
                  <div>Currently Occupied</div>
                </div>
              </div>
              <p><strong>Yesterday's Revenue:</strong> Rs. {revenue:.2f}</p>
            </div></body></html>"""
            send_email(db, admin_email, subject, body, event_type="daily_summary", lodge_id=lid)

        logger.info("Daily summary emails sent (per lodge)")
    except Exception as e:
        logger.error(f"Daily summary job failed: {e}")
    finally:
        db.close()


def retry_failed_alerts():
    """Every 15 min: Retry failed alerts up to 3 times.

    The alert row already carries lodge_id so we just pass that through to
    send_sms / send_email — they'll use the right credentials.
    """
    db = get_db_session()
    try:
        from ..models import Alert, AlertStatus, AlertType
        from .alert_service import send_sms, send_email

        failed = db.query(Alert).filter(
            Alert.status == AlertStatus.failed,
            Alert.retry_count < 3
        ).all()

        for alert in failed:
            alert.retry_count += 1
            try:
                if alert.alert_type == AlertType.sms:
                    send_sms(db, alert.recipient, alert.message_content,
                             alert.checkin_id, alert.customer_id, alert.event_type,
                             lodge_id=alert.lodge_id)
                else:
                    send_email(db, alert.recipient, "Resent Alert", alert.message_content,
                               alert.checkin_id, alert.customer_id, alert.event_type,
                               lodge_id=alert.lodge_id)
            except Exception:
                pass

        logger.info(f"Retry job processed {len(failed)} failed alerts")
    except Exception as e:
        logger.error(f"Alert retry job failed: {e}")
    finally:
        db.close()


def backup_database():
    """Daily at 2 AM: Backup database. The backup_enabled flag is read from
    the first lodge's settings (global toggle — backups are infra-level,
    not per-lodge — so first lodge wins)."""
    db = get_db_session()
    try:
        from .alert_service import get_setting
        if get_setting(db, "backup_enabled", "true", lodge_id=1).lower() != "true":
            return

        backup_dir = "./backups"
        os.makedirs(backup_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # SQLite deployments have no pg_dump — copy the DB file with the
        # sqlite3 online-backup API (safe against a live database). Reuses
        # the URL→path resolver from the backup router.
        from ..routers.backup import _resolve_sqlite_path
        sqlite_path = _resolve_sqlite_path()
        if sqlite_path is not None:
            import sqlite3
            if not os.path.exists(sqlite_path):
                logger.error(f"Backup failed: SQLite database not found at {sqlite_path}")
                return
            backup_file = f"{backup_dir}/backup_{timestamp}.db"
            src = sqlite3.connect(sqlite_path)
            try:
                dst = sqlite3.connect(backup_file)
                try:
                    src.backup(dst)
                finally:
                    dst.close()
            finally:
                src.close()
            logger.info(f"Database backup created: {backup_file}")
            return

        # Postgres (and anything else pg_dump understands): shell out as before.
        db_url = os.getenv("DATABASE_URL", "")
        backup_file = f"{backup_dir}/backup_{timestamp}.sql"

        result = subprocess.run(
            ["pg_dump", db_url, "-f", backup_file],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            logger.info(f"Database backup created: {backup_file}")
        else:
            logger.error(f"Backup failed: {result.stderr}")
    except Exception as e:
        logger.error(f"Backup job failed: {e}")
    finally:
        db.close()


def retry_pending_webhooks_job():
    """Every 5 min: dispatch any pending webhooks to partners."""
    db = get_db_session()
    try:
        from .webhook_service import retry_pending_webhooks
        n = retry_pending_webhooks(db)
        if n:
            logger.info(f"Webhook retry processed {n} deliveries")
    except Exception as e:
        logger.error(f"Webhook retry job failed: {e}")
    finally:
        db.close()


def mark_no_shows():
    """Daily at 11 PM: mark confirmed bookings whose checkin_date has passed without arrival as no_show."""
    db = get_db_session()
    try:
        from ..models import Booking, BookingStatus
        from datetime import date
        today = date.today()
        rows = (db.query(Booking)
                .filter(Booking.status == BookingStatus.confirmed,
                        Booking.checkin_date < today)
                .all())
        for b in rows:
            b.status = BookingStatus.no_show
        if rows:
            db.commit()
            logger.info(f"Marked {len(rows)} bookings as no_show")
    except Exception as e:
        logger.error(f"No-show job failed: {e}")
    finally:
        db.close()


def _pre_arrival_email_batch():
    """Wrapper so we can register the v2.6 pre-arrival job without
    importing the email_service at module load time (avoids a circular)."""
    try:
        from .email_service import send_pre_arrival_batch
        send_pre_arrival_batch(SessionLocal)
    except Exception:
        logger.exception("pre_arrival_email_batch failed")


def _whatsapp_checkin_reminder_batch():
    """v7.0 — 24h pre-arrival WhatsApp reminders.

    Finds confirmed bookings whose checkin is tomorrow and tries to send
    a reminder via WhatsApp. The service-layer dedup gate prevents
    duplicates if this job runs multiple times the same day.
    """
    from datetime import date, timedelta
    from ..models import CustomerBooking, CustomerBookingStatus
    from . import whatsapp_service as wa
    db = SessionLocal()
    try:
        tomorrow = date.today() + timedelta(days=1)
        bookings = (db.query(CustomerBooking)
                      .filter(CustomerBooking.checkin_date == tomorrow,
                              CustomerBooking.status == CustomerBookingStatus.confirmed.value)
                      .all())
        sent = 0
        for b in bookings:
            try:
                m = wa.send_checkin_reminder(db, b)
                if m and m.status == "sent": sent += 1
            except Exception:
                logger.exception("checkin reminder failed for booking %s", b.booking_id)
        logger.info("WhatsApp checkin reminders: %d bookings, %d sent", len(bookings), sent)
    finally:
        db.close()


def _whatsapp_review_request_batch():
    """v7.0 — 4-hour-after-checkout WhatsApp review nudges.

    Looks back over the last 6 hours of checkouts (small overlap to catch
    bookings checked out at the boundary, dedup handles repeats).
    """
    from datetime import datetime, timedelta
    from ..models import CustomerBooking, CustomerBookingStatus
    from . import whatsapp_service as wa
    db = SessionLocal()
    try:
        cutoff_recent = _utcnow() - timedelta(hours=4)
        cutoff_old    = _utcnow() - timedelta(hours=10)
        bookings = (db.query(CustomerBooking)
                      .filter(CustomerBooking.status == CustomerBookingStatus.checked_out.value,
                              CustomerBooking.updated_at <= cutoff_recent,
                              CustomerBooking.updated_at >= cutoff_old)
                      .all())
        sent = 0
        for b in bookings:
            try:
                review_link = f"https://rusto.app/account/bookings?review={b.booking_id}"
                m = wa.send_review_request(db, b, review_link)
                if m and m.status == "sent": sent += 1
            except Exception:
                logger.exception("review request failed for booking %s", b.booking_id)
        logger.info("WhatsApp review requests: %d eligible, %d sent",
                    len(bookings), sent)
    finally:
        db.close()


def expire_stale_payment_pending_bookings():
    """Every 10 min: release inventory held by abandoned checkouts.

    A CustomerBooking sits in `payment_pending` while it holds room
    inventory (see rusto_public._available_inventory). If the customer
    abandons the Razorpay checkout, that hold would otherwise live
    forever and block real bookings. Cancel anything stuck in
    payment_pending for more than 30 minutes, mark its open Payment rows
    failed, and audit-log the release.
    """
    db = get_db_session()
    try:
        from datetime import timedelta
        from ..models import (CustomerBooking, CustomerBookingStatus,
                               Payment, PaymentStatus)
        from .audit_service import log_audit

        cutoff = _utcnow() - timedelta(minutes=30)
        stale = (db.query(CustomerBooking)
                 .filter(CustomerBooking.status == CustomerBookingStatus.payment_pending.value,
                         CustomerBooking.created_at < cutoff)
                 .all())
        if not stale:
            return

        for b in stale:
            b.status = CustomerBookingStatus.cancelled.value
            b.cancelled_at = _utcnow()
            b.cancellation_reason = "payment_timeout"
            db.query(Payment).filter(
                Payment.customer_booking_id == b.booking_id,
                Payment.status == PaymentStatus.created.value,
            ).update({"status": PaymentStatus.failed.value})
        db.commit()

        for b in stale:
            try:
                log_audit(db, "rusto_booking.payment_timeout",
                          actor_user_id=None, actor_username="system:scheduler",
                          actor_type="system",
                          entity_type="rusto_customer_booking",
                          entity_id=b.booking_id, lodge_id=b.lodge_id,
                          details={"ref": b.booking_ref,
                                    "reason": "payment_timeout",
                                    "stuck_since": b.created_at.isoformat() if b.created_at else None})
            except Exception:
                logger.exception("Audit log failed for payment_timeout booking %s", b.booking_id)

        logger.info("Cancelled %d stale payment_pending booking(s) (payment_timeout)", len(stale))
    except Exception as e:
        logger.error(f"Stale payment_pending cleanup job failed: {e}")
    finally:
        db.close()


def _billing_renewal_reminder_batch():
    """v8.0.1 — 3-day-before-charge billing reminder emails.

    Scoped to subscriptions with status in (active, trialing) whose
    next_charge_date is exactly 3 days from today. The service-layer
    dedup gate prevents the same charge date being reminded twice if
    this job runs more than once a day.
    """
    from . import billing_service
    db = SessionLocal()
    try:
        billing_service.send_renewal_reminders_due(db, days_ahead=3)
    except Exception:
        logger.exception("billing renewal reminders failed")
    finally:
        db.close()


def _billing_realize_pending_changes_batch():
    """v8.2 — apply scheduled plan changes when their effective date arrives.

    Lodges that downgrade or switch billing cycles see their change
    queued for the end of the current period. This job picks those up
    daily and applies them so the next renewal charges at the new rate.
    """
    from . import billing_service
    db = SessionLocal()
    try:
        billing_service.realize_due_plan_changes(db)
        # v8.3 — also realize at-period-end cancellations.
        billing_service.realize_due_cancellations(db)
    except Exception:
        logger.exception("billing realize-pending-changes failed")
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(send_booking_arrival_reminders, CronTrigger(hour=10, minute=0), id="booking_arrival_reminder")
    scheduler.add_job(send_checkout_reminders, CronTrigger(hour=10, minute=5), id="checkout_reminder")
    scheduler.add_job(send_overdue_alerts, CronTrigger(hour=9, minute=0), id="overdue_alert")
    scheduler.add_job(send_daily_summary, CronTrigger(hour=9, minute=5), id="daily_summary")
    scheduler.add_job(retry_failed_alerts, CronTrigger(minute="*/15"), id="retry_alerts")
    scheduler.add_job(retry_pending_webhooks_job, CronTrigger(minute="*/5"), id="retry_webhooks")
    # Release inventory held by abandoned online checkouts — bookings stuck
    # in payment_pending for 30+ minutes are cancelled (payment_timeout).
    scheduler.add_job(expire_stale_payment_pending_bookings, CronTrigger(minute="*/10"),
                       id="expire_stale_payment_pending")
    scheduler.add_job(mark_no_shows, CronTrigger(hour=23, minute=0), id="mark_no_shows")
    scheduler.add_job(backup_database, CronTrigger(hour=2, minute=0), id="db_backup")
    # v2.6 — pre-arrival email batch (template-driven). Runs at 11 AM
    # local time to find tomorrow's arrivals and remind each guest.
    scheduler.add_job(_pre_arrival_email_batch, CronTrigger(hour=11, minute=0),
                       id="pre_arrival_emails")
    # v7.0 — WhatsApp reminders. Run at fixed times in the lodge's day:
    # checkin reminder at 5 PM (so it lands the evening before, when
    # people are likely to read it), review request hourly to catch
    # checkouts as soon as they hit the 4h threshold.
    scheduler.add_job(_whatsapp_checkin_reminder_batch, CronTrigger(hour=17, minute=0),
                       id="wa_checkin_reminders")
    scheduler.add_job(_whatsapp_review_request_batch, CronTrigger(minute=15),
                       id="wa_review_requests")
    # v8.0.1 — billing renewal reminders. Daily at 9 AM (well before
    # any real-world charge cutoff, lands in the morning inbox).
    scheduler.add_job(_billing_renewal_reminder_batch, CronTrigger(hour=9, minute=30),
                       id="billing_renewal_reminders")
    # v8.2 — realize pending plan changes whose effective date has come.
    # Daily just past midnight so the new rate is live before any
    # human-time UI uses it that day.
    scheduler.add_job(_billing_realize_pending_changes_batch,
                       CronTrigger(hour=0, minute=15),
                       id="billing_realize_pending_changes")
    scheduler.start()
    logger.info("Scheduler started with all cron jobs (multi-tenant aware)")


def stop_scheduler():
    scheduler.shutdown()
