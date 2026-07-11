from fastapi import FastAPI, Request, Depends
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import os, logging, uuid, enum, json
from decimal import Decimal
from dotenv import load_dotenv


# ─── Custom JSON encoder that handles Enums and Decimals globally ─────
class EnumSafeJSONResponse(JSONResponse):
    """JSONResponse subclass that properly serializes Enum and Decimal types."""
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
            default=self._default,
        ).encode("utf-8")

    @staticmethod
    def _default(obj):
        if isinstance(obj, enum.Enum):
            return obj.value
        if isinstance(obj, Decimal):
            return float(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

load_dotenv()

from .database import Base, engine, get_db
from .routers import (auth, customers, rooms, checkins, alerts, reports,
                       portal_detection,
                      plan_features,
                      settings, import_excel, agencies, partner_api,
                      bookings, audit, agent, lodges,
                      housekeeping, folio, expenses, shifts, notifications,
                      maintenance, inventory, rate_plans, feedback,
                      promos, loyalty, foreign_guests, campaigns, backup,
                      gst,
                      tape_chart, night_audit, public_booking,
                      group_bookings, guest_documents, guest_preferences, ota,
                      email,
                      # v3.0 Rusto marketplace
                      lodge_registration, support,
                      # v3.1 Rusto customer-facing
                      rusto_customer_auth, rusto_public, rusto_bookings,
                      rusto_listing,
                      # v3.2 staff management with permissions
                      staff,
                      # v6.0 customer reviews + ratings
                      rusto_reviews,
                      # v7.0 WhatsApp Business API
                      whatsapp,
                      # v7.1 public pricing for onboarding wizard
                      public_pricing,
                      # v8.0 lodge subscriptions + invoices
                      billing,
                      # v8.4 per-lodge operational analytics
                      analytics,
                      # v9.0 enhanced RUSTO marketplace
                      rusto_wishlist, rusto_bundles, rusto_self_checkin,
                      platform_analytics, rusto_membership, global_partner_api,
                      # v11.2 IP presence tracker (flag-gated, default off)
                      ip_presence)
from .services.scheduler import start_scheduler, stop_scheduler

# ─── Logging ──────────────────────────────────────────────────────────
os.makedirs("logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(),
              logging.FileHandler("logs/app.log", mode="a")],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Rusto...")
    
    from sqlalchemy import text
    is_postgres = "postgresql" in engine.url.drivername
    lock_conn = None
    if is_postgres:
        try:
            lock_conn = engine.connect()
            # Session-level advisory lock using a custom key (123456)
            lock_conn.execute(text("SELECT pg_advisory_lock(123456)"))
            logger.info("Acquired Postgres startup advisory lock.")
        except Exception as e:
            logger.warning("Failed to acquire Postgres advisory lock: %s", e)

    try:
        Base.metadata.create_all(bind=engine)
        # Add any columns introduced by a new release to pre-existing tables.
        # Safe (additive-only) and idempotent — see app/auto_migrate.py.
        try:
            from .auto_migrate import run_additive_migrations
            run_additive_migrations(engine)
        except Exception as e:
            logger.error("Auto-migration failed: %s", e)
        seed_initial_data()
    finally:
        if lock_conn:
            try:
                lock_conn.execute(text("SELECT pg_advisory_unlock(123456)"))
                lock_conn.close()
                logger.info("Released Postgres startup advisory lock.")
            except Exception as e:
                logger.warning("Failed to release Postgres advisory lock: %s", e)

    # v2.6 — seed default email templates for every lodge (idempotent).
    try:
        from .database import SessionLocal
        from .models import Lodge
        from .services.email_service import seed_default_templates
        _db = SessionLocal()
        try:
            for lodge in _db.query(Lodge).all():
                n = seed_default_templates(_db, lodge.lodge_id)
                if n:
                    logger.info("Seeded %d email templates for lodge %s", n, lodge.lodge_id)
        finally:
            _db.close()
    except Exception as e:
        logger.warning("Email template seed skipped: %s", e)
    start_scheduler()
    logger.info("Application started successfully")
    yield
    stop_scheduler()
    # Drain any buffered IP-presence samples so they aren't lost on shutdown.
    try:
        ip_presence.flush_presence(force=True)
    except Exception:
        pass
    logger.info("Application shutdown")


def seed_initial_data():
    from .database import SessionLocal
    from .models import Room, Setting, User, RoomType, RoomStatus
    from .auth import get_password_hash

    db = SessionLocal()
    try:
        if db.query(Room).count() == 0:
            rooms_data = [
                {"room_number": "101", "floor": 1, "room_type": "deluxe_ac", "has_ac": True, "base_tariff": 1800, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser","Mini Fridge"]'},
                {"room_number": "114", "floor": 1, "room_type": "deluxe_ac", "has_ac": True, "base_tariff": 1800, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser","Mini Fridge"]'},
                {"room_number": "102", "floor": 1, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "103", "floor": 1, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "106", "floor": 1, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "113", "floor": 1, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "104", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","WiFi","Fan"]'},
                {"room_number": "105", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","WiFi","Fan"]'},
                {"room_number": "107", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","WiFi","Fan"]'},
                {"room_number": "108", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","Fan"]'},
                {"room_number": "109", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","Fan"]'},
                {"room_number": "110", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","Fan"]'},
                {"room_number": "111", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","Fan"]'},
                {"room_number": "112", "floor": 1, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","Fan"]'},
                {"room_number": "201", "floor": 2, "room_type": "deluxe_ac", "has_ac": True, "base_tariff": 1800, "max_occupancy": 3, "amenities": '["TV","WiFi","AC","Geyser","Mini Fridge","Balcony"]'},
                {"room_number": "202", "floor": 2, "room_type": "deluxe_ac", "has_ac": True, "base_tariff": 1800, "max_occupancy": 3, "amenities": '["TV","WiFi","AC","Geyser","Mini Fridge","Balcony"]'},
                {"room_number": "203", "floor": 2, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "205", "floor": 2, "room_type": "ac", "has_ac": True, "base_tariff": 1200, "max_occupancy": 2, "amenities": '["TV","WiFi","AC","Geyser"]'},
                {"room_number": "204", "floor": 2, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","WiFi","Fan"]'},
                {"room_number": "206", "floor": 2, "room_type": "non_ac", "has_ac": False, "base_tariff": 800, "max_occupancy": 2, "amenities": '["TV","WiFi","Fan"]'},
                {"room_number": "301", "floor": 3, "room_type": "house", "has_ac": True, "base_tariff": 2500, "max_occupancy": 6, "amenities": '["TV","WiFi","AC","Geyser","Kitchen","Living Room","Balcony"]'},
            ]
            for r in rooms_data:
                db.add(Room(**r, lodge_id=1, status=RoomStatus.available))
            logger.info(f"Seeded {len(rooms_data)} rooms")

        if db.query(Setting).count() == 0:
            settings_data = [
                ("hotel_name", "My Lodge", "hotel", "Hotel display name", False),
                ("hotel_tagline", "Comfortable rooms and warm hospitality", "hotel", "Hotel tagline", False),
                ("hotel_address", "", "hotel", "Hotel postal address", False),
                ("hotel_phone", "", "hotel", "Hotel contact phone", False),
                ("hotel_email", "", "hotel", "Hotel email address", False),
                ("gst_number", "", "hotel", "GST registration number", False),
                ("logo_path", "/logo.jpg", "hotel", "Hotel logo URL/path", False),

                ("tariff_non_ac", "800", "tariff", "Nightly rate for Non A/C rooms (INR)", False),
                ("tariff_ac", "1200", "tariff", "Nightly rate for A/C rooms (INR)", False),
                ("tariff_deluxe_ac", "1800", "tariff", "Nightly rate for Deluxe A/C rooms (INR)", False),
                ("tariff_house", "2500", "tariff", "Nightly rate for House room (INR)", False),
                ("default_deposit", "500", "tariff", "Default deposit at check-in", False),
                ("late_checkout_charge", "200", "tariff", "Extra charge per hour for late checkout", False),
                ("gst_enabled", "false", "tariff", "Enable GST on invoices", False),
                ("gst_rate", "12", "tariff", "GST percentage", False),
                ("gst_threshold", "1000", "tariff", "Nightly tariff above which GST applies (INR)", False),
                ("collection_upi_id", "", "tariff", "Lodge UPI ID for digital collections", False),
                ("collection_phonepe", "", "tariff", "PhonePe collection number", False),
                ("collection_gpay", "", "tariff", "Google Pay collection number", False),
                ("collection_paytm", "", "tariff", "Paytm collection number", False),

                # Security — customer check-in
                ("require_customer_signature", "false", "security", "Require guest digital signature at check-in", False),
                ("guest_declaration_text",
                 "I hereby declare that the details provided by me are true. I agree to abide by the lodge house rules: valid ID for every guest, no smoking inside rooms, visitors allowed only in the lobby, and checkout by the notified time. I accept that the lodge is not responsible for loss of personal valuables.",
                 "security", "Guest declaration / house rules text shown at check-in", False),
                # Security — remote staff login
                ("trusted_network_cidrs", "", "security", "Comma-separated trusted lodge network CIDRs (e.g. 192.168.1.0/24)", False),
                ("remote_login_policy", "allow", "security", "Policy for staff logins outside trusted network: allow | otp | block", False),

                ("sms_enabled", "false", "alerts", "Master SMS alert toggle", False),
                ("email_enabled", "false", "alerts", "Master email alert toggle", False),
                ("sms_provider", "twilio", "alerts", "SMS gateway provider", False),
                ("sms_api_key", "", "alerts", "SMS provider API key", True),
                ("sms_from_number", "", "alerts", "SMS sender number", False),
                ("twilio_account_sid", "", "alerts", "Twilio Account SID", True),
                ("smtp_host", "smtp.gmail.com", "alerts", "Email SMTP server", False),
                ("smtp_port", "587", "alerts", "SMTP port", False),
                ("smtp_user", "", "alerts", "SMTP username/email", False),
                ("smtp_password", "", "alerts", "SMTP password", True),
                ("admin_phone", "", "alerts", "Admin phone for notifications", False),
                ("admin_email", "", "alerts", "Admin email for daily summary", False),
                ("reminder_days_before", "1", "alerts", "Days before checkout to send reminder", False),

                ("session_timeout_min", "480", "system", "Session timeout in minutes", False),
                ("max_login_attempts", "5", "system", "Max failed logins before lockout", False),
                ("lockout_duration_minutes", "15", "system", "Minutes an account stays locked after too many failed logins", False),
                ("ip_tracking_enabled", "no", "system", "Track per-user IP presence (last seen + cumulative time per IP). Default off; platform owner can enable later.", False),
                ("admin_session_hours", "8", "system", "Admin JWT/session expiry in hours", False),
                ("staff_session_hours", "8", "system", "Staff JWT/session expiry in hours", False),
                ("backup_enabled", "true", "system", "Enable automatic daily DB backup", False),

                # Partner / agency defaults
                ("partner_default_commission_pct", "10", "partner", "Default commission % for new agencies", False),
                ("partner_webhook_max_attempts", "5", "partner", "Max webhook retry attempts", False),

                # Razorpay (online payments)
                ("razorpay_key_id",     os.getenv("RAZORPAY_KEY_ID",     ""),     "billing", "Razorpay Key ID",     True),
                ("razorpay_key_secret", os.getenv("RAZORPAY_KEY_SECRET", ""),     "billing", "Razorpay Key Secret", True),
                ("payment_mode",        "live" if os.getenv("RAZORPAY_KEY_ID","").startswith("rzp_live") else "test",
                                                                                  "billing", "Payment mode: test | live", False),

                # AI Agent
                ("agent_provider", "auto", "agent",
                 "LLM backend: auto | anthropic | openai | heuristic", False),
                ("agent_anthropic_key", "", "agent",
                 "Anthropic API key (overrides ANTHROPIC_API_KEY env var)", True),
                ("agent_anthropic_model", "claude-sonnet-4-6", "agent",
                 "Anthropic model name", False),
                ("agent_openai_key", "", "agent",
                 "OpenAI API key (overrides OPENAI_API_KEY env var)", True),
                ("agent_openai_model", "gpt-4o-mini", "agent",
                 "OpenAI model name", False),
                ("agent_confirmation_mode", "writes_only", "agent",
                 "When to ask user to confirm: all | writes_only | high_risk | none", False),
                ("agent_enabled", "true", "agent",
                 "Master toggle for the AI agent", False),
            ]
            for key, val, group, desc, sensitive in settings_data:
                db.add(Setting(lodge_id=1, setting_key=key, setting_value=val,
                               setting_group=group, description=desc, is_sensitive=sensitive))
            logger.info(f"Seeded {len(settings_data)} settings")

        # ── Override settings from environment variables ──────────────────
        # This lets production deployments configure integrations via env vars
        # without manual database edits. Only updates if the env var is set.
        env_settings = [
            # SMS — Twilio
            ("twilio_account_sid",  os.getenv("TWILIO_ACCOUNT_SID",  "")),
            ("twilio_auth_token",   os.getenv("TWILIO_AUTH_TOKEN",   "")),
            ("sms_from_number",     os.getenv("TWILIO_FROM_NUMBER",  "")),
            # SMS — MSG91
            ("msg91_auth_key",      os.getenv("MSG91_AUTH_KEY",      "")),
            ("msg91_sender_id",     os.getenv("MSG91_SENDER_ID",     "")),
            # Email
            ("smtp_host",           os.getenv("SMTP_HOST",           "")),
            ("smtp_port",           os.getenv("SMTP_PORT",           "")),
            ("smtp_user",           os.getenv("SMTP_USER",           "")),
            ("smtp_password",       os.getenv("SMTP_PASSWORD",       "")),
            ("email_from_address",  os.getenv("SMTP_FROM_EMAIL",     "")),
            ("email_from_name",     os.getenv("SMTP_FROM_NAME",      "")),
            # AI
            ("agent_anthropic_key", os.getenv("ANTHROPIC_API_KEY",  "")),
            ("agent_openai_key",    os.getenv("OPENAI_API_KEY",      "")),
            ("agent_provider",      os.getenv("AGENT_PROVIDER",      "")),
            # Razorpay
            ("razorpay_key_id",     os.getenv("RAZORPAY_KEY_ID",     "")),
            ("razorpay_key_secret", os.getenv("RAZORPAY_KEY_SECRET", "")),
        ]
        for key, env_val in env_settings:
            if not env_val:
                continue  # skip empty env vars
            existing = db.query(Setting).filter_by(lodge_id=1, setting_key=key).first()
            if existing:
                existing.setting_value = env_val
            else:
                db.add(Setting(lodge_id=1, setting_key=key,
                               setting_value=env_val,
                               setting_group="system",
                               is_sensitive=True))
        # Enable SMS/email if credentials are now present
        if os.getenv("TWILIO_ACCOUNT_SID") or os.getenv("MSG91_AUTH_KEY"):
            s = db.query(Setting).filter_by(lodge_id=1, setting_key="sms_enabled").first()
            if s and s.setting_value == "false":
                s.setting_value = "true"
                logger.info("Auto-enabled SMS (credentials found in env)")
        if os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"):
            s = db.query(Setting).filter_by(lodge_id=1, setting_key="email_enabled").first()
            if s and s.setting_value == "false":
                s.setting_value = "true"
                logger.info("Auto-enabled email (credentials found in env)")
        if os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY"):
            s = db.query(Setting).filter_by(lodge_id=1, setting_key="agent_enabled").first()
            if s and s.setting_value == "false":
                s.setting_value = "true"
                logger.info("Auto-enabled AI agent (key found in env)")

        if db.query(User).count() == 0:
            admin_pass = os.getenv("DEFAULT_ADMIN_PASSWORD", "Admin@1234")
            admin = User(
                lodge_id=1,
                username="admin",
                password_hash=get_password_hash(admin_pass),
                full_name="System Administrator",
                role="admin",
                is_active=True,
            )
            db.add(admin)
            logger.info(f"Created default admin user (password: {admin_pass})")

        # Cleanup invalid data (empty strings in gender)
        from sqlalchemy import text
        try:
            result = db.execute(text("UPDATE customers SET gender = NULL WHERE gender = ''"))
            db.commit()
            if result.rowcount > 0:
                logger.info(f"Cleaned up {result.rowcount} customers with empty gender string.")
        except Exception as e:
            logger.error(f"Failed to clean up data: {e}")
            db.rollback()

        # Unlock admin account on startup if it exists
        admin = db.query(User).filter(User.username == "admin").first()
        if admin:
            admin.failed_attempts = 0
            admin.locked_until = None
            db.commit()
            logger.info("Unlocked admin account on startup.")

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Seeding failed: {e}")
    finally:
        db.close()


# ─── Rate limiter ─────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title="Rusto",
    description="Multi-tenant lodge / small-hotel PMS with OTA / agency-partner API",
    version="2.6.0",
    lifespan=lifespan,
    default_response_class=EnumSafeJSONResponse,
)

# ─── CORS ─────────────────────────────────────────────────────────────
# Default: localhost dev + any private network IP (lodge LANs need to call
# the backend directly from the browser for portal detection to work).
_default_origins = (
    "http://localhost:3000,http://localhost:5173,"
    "http://127.0.0.1:3000,http://127.0.0.1:5173"
)
cors_origins = os.getenv("CORS_ORIGINS", _default_origins).split(",")
# Detect-portal is a public endpoint — allow all origins so the browser
# can call the backend directly (not via proxy) to get the real client IP.
# We use allow_origins=["*"] but restrict credentials to False for safety.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # ← allow any origin; detect-portal is public
    allow_credentials=False,      # ← False required when allow_origins=["*"]
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining"],
    max_age=86400,                # cache preflight responses for a day
)

# ─── GZip compression (large JSON list responses) ─────────────────────
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1024)
# Note: authenticated endpoints use the Authorization header (Bearer token),
# not cookies, so allow_credentials=False does not affect auth behaviour.

# ─── Rate limiting middleware ──────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ─── Static / uploads ─────────────────────────────────────────────────
os.makedirs("uploads/id_proofs", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ─── Request-id middleware (helps debug partner integrations) ─────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-Id") or str(uuid.uuid4())
    request.state.request_id = rid
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    return response


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    """Reject requests with excessively large bodies (prevent DoS)."""
    MAX_SIZE = 10 * 1024 * 1024  # 10 MB
    content_length = request.headers.get("content-length")
    # Only check POST/PUT/PATCH with a Content-Length header
    if (content_length and request.method in ("POST", "PUT", "PATCH")
            and int(content_length) > MAX_SIZE):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


@app.middleware("http")
async def ip_presence_tracker(request: Request, call_next):
    """Flag-gated IP presence sampling (default OFF → one cached check).

    All the heavy lifting (flag cache, cheap token decode, write-behind
    buffer) lives in routers/ip_presence.py; observe_request never raises
    and never touches the DB on the hot path."""
    try:
        ip_presence.observe_request(request)
    except Exception:
        pass
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # Only set HSTS in production
    if not os.getenv("DEBUG", "false").lower() == "true":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ─── Routers ──────────────────────────────────────────────────────────
app.include_router(portal_detection.router)
app.include_router(auth.router)
app.include_router(lodges.router)
app.include_router(customers.router)
app.include_router(rooms.router)
app.include_router(checkins.router)
app.include_router(alerts.router)
app.include_router(reports.router)
app.include_router(settings.router)
app.include_router(import_excel.router)
app.include_router(bookings.router)
app.include_router(agencies.router)
app.include_router(audit.router)
app.include_router(partner_api.router)
app.include_router(agent.router)
# v2.1 additions — operational PMS modules
app.include_router(housekeeping.router)
app.include_router(folio.router)
app.include_router(expenses.router)
app.include_router(shifts.router)
app.include_router(notifications.router)
# v2.2 additions — advanced PMS modules
app.include_router(maintenance.router)
app.include_router(inventory.router)
app.include_router(rate_plans.router)
app.include_router(feedback.router)
# v2.3 additions — revenue/loyalty/compliance/marketing
app.include_router(promos.router)
app.include_router(loyalty.router)
app.include_router(foreign_guests.router)
app.include_router(campaigns.router)
app.include_router(backup.router)
# v2.4 additions — TOTP 2FA (lives in auth.py) + GST returns export
app.include_router(gst.router)
# v2.5 additions — industry-standard PMS gap-fills
app.include_router(tape_chart.router)
app.include_router(night_audit.router)
app.include_router(public_booking.router)
app.include_router(group_bookings.router)
app.include_router(guest_documents.router)
app.include_router(guest_preferences.router)
app.include_router(ota.router)
# v2.6 additions — email infrastructure
app.include_router(email.router)

# Rusto v3.0 — multi-sided marketplace
app.include_router(lodge_registration.public_router)
app.include_router(lodge_registration.admin_router)
app.include_router(support.router)

# Rusto v3.1 — customer-facing site
app.include_router(rusto_customer_auth.router)
app.include_router(rusto_public.router)
app.include_router(rusto_bookings.router)
app.include_router(rusto_listing.router)

# v3.2 — staff management with granular permissions
app.include_router(staff.router)

# v6.0 — customer reviews + lodge responses
app.include_router(rusto_reviews.router)

# v7.0 — WhatsApp Business API (admin config, message log, webhook)
app.include_router(whatsapp.router)

# v7.1 — public pricing endpoints for the onboarding wizard
app.include_router(public_pricing.router)

# v8.0 — lodge subscriptions, invoices, Razorpay billing webhook
app.include_router(billing.router)

# v8.4 — per-lodge operational analytics dashboard
app.include_router(analytics.router)
app.include_router(plan_features.router)
# v9.0 enhanced RUSTO marketplace
app.include_router(rusto_wishlist.router)
app.include_router(rusto_bundles.public_router)
app.include_router(rusto_bundles.admin_router)
app.include_router(rusto_self_checkin.admin_router)
app.include_router(rusto_self_checkin.customer_router)
app.include_router(platform_analytics.router)
app.include_router(rusto_membership.router)
app.include_router(global_partner_api.partner_router)
app.include_router(global_partner_api.admin_router)
# v11.2 — IP presence tracker (flag-gated; see routers/ip_presence.py)
app.include_router(ip_presence.router)


@app.get("/")
def root():
    return {
        "service": "Rusto",
        "version": "2.6.0",
        "docs": "/docs",
        "partner_api": "/api/partner/v1",
        "status": "running",
    }


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        from sqlalchemy import text
        from .models import Setting, Lodge
        db.execute(text("SELECT 1"))

        # Integration status (non-fatal)
        integrations = {}
        try:
            sms_row = db.query(Setting).filter_by(
                lodge_id=1, setting_key="sms_enabled").first()
            integrations["sms"]   = (sms_row and sms_row.setting_value == "true")
            email_row = db.query(Setting).filter_by(
                lodge_id=1, setting_key="email_enabled").first()
            integrations["email"] = (email_row and email_row.setting_value == "true")
            agent_row = db.query(Setting).filter_by(
                lodge_id=1, setting_key="agent_enabled").first()
            integrations["ai"]    = (agent_row and agent_row.setting_value == "true")
            lodge_count = db.query(Lodge).count()
        except Exception:
            lodge_count = 0

        return {
            "status":       "healthy",
            "database":     "connected",
            "version":      "2.1.0",
            "lodges":       lodge_count,
            "integrations": integrations,
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=500,
            content={"status": "unhealthy", "database": "disconnected", "error": str(e)}
        )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Global error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "path": request.url.path
        }
    )
