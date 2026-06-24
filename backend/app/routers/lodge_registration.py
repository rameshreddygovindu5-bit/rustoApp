"""Public lodge-registration + super-admin approval workflow.

Public endpoint:
  POST   /api/public/register-lodge     # no auth — anyone can submit

Super-admin endpoints:
  GET    /api/registrations             # list all (paged, filterable by status)
  GET    /api/registrations/{id}        # detail
  POST   /api/registrations/{id}/approve  # creates Lodge + admin user
  POST   /api/registrations/{id}/reject   # records rejection reason

On approval we do four things atomically:
  1. Create the Lodge row using proposed_code as its slug
  2. Create the admin user `<code>_admin` with a secure auto-generated password
  3. Seed default settings (hotel_name, default tariffs, etc.)
  4. Seed default email templates
The auto-generated password is returned to the super-admin ONCE in the
approval response — they're expected to forward it to the applicant
out-of-band (or via the email service if SMTP is configured).
"""
import re
import secrets
import string
import logging
from datetime import datetime, timezone
from typing import Optional

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, EmailStr, field_validator

from ..database import get_db
from ..models import (LodgeRegistrationRequest, Lodge, User, Setting,
                       RegistrationStatus, UserRole)
from ..auth import (get_current_user, require_super_admin,
                     get_password_hash)
from ..services.audit_service import log_audit
from ..services import pricing_service

logger = logging.getLogger(__name__)


# Two routers because they have different prefixes/auth.
public_router = APIRouter(prefix="/api/public", tags=["public-registration"])
admin_router = APIRouter(prefix="/api/registrations", tags=["registrations"])


# ── Public submission ────────────────────────────────────────────────

class LodgeRegistrationBody(BaseModel):
    """All-mandatory-fields registration payload. Optional fields are
    explicitly None-allowed: gstin/pan are not always available for
    small properties, address_line2 may not apply to single-line
    addresses."""
    proposed_code: str = Field(min_length=3, max_length=40,
                                description="Internal slug — lowercase, alphanumeric, underscores OK")
    lodge_name: str = Field(min_length=2, max_length=160)
    owner_full_name: str = Field(min_length=2, max_length=120)
    owner_phone: str = Field(min_length=7, max_length=20)
    owner_email: EmailStr
    address_line1: str = Field(min_length=3, max_length=200)
    address_line2: Optional[str] = Field(default=None, max_length=200)
    city: str = Field(min_length=2, max_length=80)
    state: str = Field(min_length=2, max_length=80)
    pincode: str = Field(min_length=4, max_length=12)
    gstin: Optional[str] = Field(default=None, max_length=20)
    pan: Optional[str] = Field(default=None, max_length=20)
    total_rooms: int = Field(ge=0, le=10000)
    # v7.1 — granular room-type breakdown. All optional; if provided the
    # sum should match total_rooms (we'll validate after).
    rooms_ac:     int = Field(default=0, ge=0, le=10000)
    rooms_non_ac: int = Field(default=0, ge=0, le=10000)
    rooms_deluxe: int = Field(default=0, ge=0, le=10000)
    rooms_suite:  int = Field(default=0, ge=0, le=10000)
    # Plan selection (validated against pricing_service catalog at handler).
    selected_plan: Optional[str] = Field(default=None, max_length=20)
    billing_cycle: Optional[str] = Field(default="monthly", max_length=10)
    notes: Optional[str] = Field(default=None, max_length=2000)
    # v10 — property type + enabled modules from onboarding wizard
    property_category: Optional[str] = Field(default=None, max_length=40)
    enabled_modules:   Optional[str] = Field(default=None, max_length=2000)

    @field_validator("proposed_code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip().lower()
        # Internal slug. Used as the prefix for usernames so we keep it
        # narrow: lowercase letters, digits, underscores. No leading digit
        # (avoids username collisions with numeric IDs).
        if not re.fullmatch(r"[a-z][a-z0-9_]{2,39}", v):
            raise ValueError("proposed_code must start with a letter and contain only lowercase letters, digits, and underscores (3-40 chars)")
        # Reserved internal names.
        if v in {"admin", "superadmin", "system", "rusto", "public", "api"}:
            raise ValueError(f"'{v}' is reserved")
        return v


def _request_to_dict(r: LodgeRegistrationRequest, db: Optional[Session] = None) -> dict:
    out = {
        "request_id": r.request_id,
        "proposed_code": r.proposed_code,
        "lodge_name": r.lodge_name,
        "owner_full_name": r.owner_full_name,
        "owner_phone": r.owner_phone,
        "owner_email": r.owner_email,
        "address_line1": r.address_line1,
        "address_line2": r.address_line2,
        "city": r.city,
        "state": r.state,
        "pincode": r.pincode,
        "gstin": r.gstin,
        "pan": r.pan,
        "total_rooms": r.total_rooms,
        "rooms_ac":     getattr(r, "rooms_ac", 0) or 0,
        "rooms_non_ac": getattr(r, "rooms_non_ac", 0) or 0,
        "rooms_deluxe": getattr(r, "rooms_deluxe", 0) or 0,
        "rooms_suite":  getattr(r, "rooms_suite", 0) or 0,
        "selected_plan":    getattr(r, "selected_plan", None),
        "billing_cycle":    getattr(r, "billing_cycle", None) or "monthly",
        "quoted_price_inr": float(r.quoted_price_inr) if getattr(r, "quoted_price_inr", None) else None,
        "notes": r.notes,
        "property_category": r.property_category,
        "enabled_modules":   r.enabled_modules,
        # v11 payment
        "payment_status":  r.payment_status or "pending",
        "payment_method":  r.payment_method,
        "payment_ref":     r.payment_ref,
        "payment_amount":  float(r.payment_amount) if r.payment_amount else None,
        "payment_date":    r.payment_date.isoformat() if r.payment_date else None,
        "payment_notes":   r.payment_notes,
        "follow_up_at":    r.follow_up_at.isoformat() if r.follow_up_at else None,
        "follow_up_count": r.follow_up_count or 0,
        "assigned_to":     r.assigned_to,
        "status": r.status,
        "rejection_reason": r.rejection_reason,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "reviewed_by": r.reviewed_by,
        "created_lodge_id": r.created_lodge_id,
        "created_admin_user_id": r.created_admin_user_id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
    # Convenience: include the reviewer's username if we can.
    if db and r.reviewed_by:
        u = db.query(User).filter(User.user_id == r.reviewed_by).first()
        out["reviewed_by_username"] = u.username if u else None
    return out


@public_router.post("/register-lodge", status_code=201)
def submit_registration(body: LodgeRegistrationBody, request: Request,
                         db: Session = Depends(get_db)):
    """Public — anyone can submit. We do basic spam-resistance via
    server-side validation but otherwise accept the submission and let
    the super-admin gate access."""
    code = body.proposed_code

    # Reject if a Lodge with this code already exists.
    if db.query(Lodge).filter(Lodge.code == code).first():
        raise HTTPException(status_code=409,
                            detail=f"A lodge with code '{code}' is already registered. Pick a different code.")

    # Reject if there's already a PENDING request for this code.
    pending = (db.query(LodgeRegistrationRequest)
               .filter(LodgeRegistrationRequest.proposed_code == code,
                       LodgeRegistrationRequest.status == RegistrationStatus.pending.value)
               .first())
    if pending:
        raise HTTPException(status_code=409,
                            detail=f"A registration for '{code}' is already pending review. Please wait.")

    submitter_ip = request.client.host if request and request.client else None

    # v7.1 — validate room breakdown matches the total (when provided).
    breakdown_sum = (body.rooms_ac + body.rooms_non_ac +
                       body.rooms_deluxe + body.rooms_suite)
    if breakdown_sum > 0 and breakdown_sum != body.total_rooms:
        raise HTTPException(
            status_code=400,
            detail=(f"Room breakdown ({breakdown_sum}) doesn't match "
                    f"total rooms ({body.total_rooms}). Please fix one of them.")
        )

    # Compute the locked-in quote at submission time. If no plan was
    # selected we recommend one based on room count so super-admin has
    # something to reference at approval.
    plan_key = body.selected_plan or pricing_service.recommend_plan(body.total_rooms)
    # Reject unknown plan keys at the boundary — otherwise we'd persist a
    # bogus plan that silently downgrades to 'starter' at approval time.
    if plan_key not in pricing_service.PLANS_BY_KEY:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown plan: {plan_key!r}. Valid plans: "
                   f"{', '.join(pricing_service.PLANS_BY_KEY.keys())}"
        )
    billing_cycle = (body.billing_cycle or "monthly").lower()
    if billing_cycle not in ("monthly", "annual"):
        billing_cycle = "monthly"
    quote = pricing_service.calculate_quote(plan_key, body.total_rooms or 1, billing_cycle)
    quoted_price = quote["price_now_inr"] if quote else None

    reg = LodgeRegistrationRequest(
        proposed_code=code,
        lodge_name=body.lodge_name.strip(),
        owner_full_name=body.owner_full_name.strip(),
        owner_phone=body.owner_phone.strip(),
        owner_email=body.owner_email,
        address_line1=body.address_line1.strip(),
        address_line2=(body.address_line2 or "").strip() or None,
        city=body.city.strip(), state=body.state.strip(),
        pincode=body.pincode.strip(),
        gstin=(body.gstin or "").strip() or None,
        pan=(body.pan or "").strip() or None,
        total_rooms=body.total_rooms,
        rooms_ac=body.rooms_ac,
        rooms_non_ac=body.rooms_non_ac,
        rooms_deluxe=body.rooms_deluxe,
        rooms_suite=body.rooms_suite,
        selected_plan=plan_key,
        billing_cycle=billing_cycle,
        quoted_price_inr=quoted_price,
        notes=(body.notes or "").strip() or None,
        property_category=body.property_category or None,
        enabled_modules=body.enabled_modules or None,
        status=RegistrationStatus.pending.value,
        submitter_ip=submitter_ip,
    )
    db.add(reg); db.commit(); db.refresh(reg)

    # Audit: super-admin will see this in the activity feed.
    try:
        log_audit(db, "lodge_registration.submitted",
                  actor_user_id=None, actor_username=f"public:{body.owner_email}",
                  entity_type="lodge_registration", entity_id=reg.request_id,
                  details={"proposed_code": code, "lodge_name": body.lodge_name,
                            "owner_email": body.owner_email,
                            "city": body.city, "state": body.state},
                  ip_address=submitter_ip)
    except Exception as e:
        logger.warning("Audit log failed for registration: %s", e)

    return {
        "request_id": reg.request_id,
        "status": reg.status,
        "message": ("Thanks — your registration has been submitted. Our team will "
                    "review it and reach out to you at the email provided. You'll be "
                    "able to access your lodge dashboard once approved."),
    }


# ── Super-admin: list / detail / approve / reject ────────────────────

@admin_router.get("")
def list_registrations(status: Optional[str] = None,
                       db: Session = Depends(get_db),
                       current_user=Depends(require_super_admin)):
    """List all registration requests. Filter by status if provided."""
    q = db.query(LodgeRegistrationRequest)
    if status:
        if status not in {s.value for s in RegistrationStatus}:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
        q = q.filter(LodgeRegistrationRequest.status == status)
    rows = q.order_by(LodgeRegistrationRequest.created_at.desc()).limit(500).all()
    return [_request_to_dict(r, db) for r in rows]


@admin_router.get("/stats")
def registration_stats(db: Session = Depends(get_db),
                        current_user=Depends(require_super_admin)):
    """Counts by status — used for the navbar badge ("3 pending")."""
    from sqlalchemy import func as sql_func
    rows = (db.query(LodgeRegistrationRequest.status,
                     sql_func.count(LodgeRegistrationRequest.request_id))
            .group_by(LodgeRegistrationRequest.status).all())
    return {status: count for status, count in rows}


@admin_router.get("/{request_id}")
def get_registration(request_id: int,
                      db: Session = Depends(get_db),
                      current_user=Depends(require_super_admin)):
    r = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.request_id == request_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Registration not found")
    return _request_to_dict(r, db)


def _generate_password(length: int = 12) -> str:
    """Generate a random password the super-admin can pass to the new
    lodge owner. We avoid ambiguous characters (0/O, 1/l/I) to reduce
    typo errors when the password is shared verbally."""
    alphabet = (string.ascii_letters + string.digits)
    alphabet = "".join(c for c in alphabet if c not in "0O1lI")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _seed_lodge_defaults(db: Session, lodge_id: int, lodge_name: str,
                          owner_phone: str, owner_email: str,
                          address: str,
                          property_category: str = "lodge",
                          enabled_modules: str = None):
    """Insert the standard per-lodge settings (hotel_name, contact info,
    GST defaults, etc.) so the new lodge's Settings page is populated
    out-of-the-box rather than blank."""
    defaults = [
        ("hotel_name", lodge_name, "hotel", "Hotel display name"),
        ("hotel_tagline", "Travel Anywhere. Rest Everywhere.", "hotel", "Hotel tagline"),
        ("hotel_phone", owner_phone, "hotel", "Hotel phone number"),
        ("hotel_email", owner_email, "hotel", "Hotel email"),
        ("hotel_address", address, "hotel", "Hotel address"),
        ("currency_symbol", "₹", "billing", "Currency symbol"),
        ("currency_code", "INR", "billing", "Currency code"),
        ("gst_enabled", "true", "billing", "Apply GST on bills"),
        ("gst_rate", "12", "billing", "Default GST percentage"),
        ("invoice_prefix", "INV", "billing", "Invoice number prefix"),
        ("checkin_time", "12:00", "policy", "Standard check-in time"),
        ("checkout_time", "11:00", "policy", "Standard check-out time"),
    ]
    # Add property type and module configuration
    extra_defaults = []
    if property_category:
        extra_defaults.append(("property_category", property_category, "hotel", "Property type"))
        extra_defaults.append(("has_pool", "false", "hotel", "Swimming pool"))
        extra_defaults.append(("has_restaurant", "false", "hotel", "Restaurant on-site"))
        extra_defaults.append(("has_gym", "false", "hotel", "Fitness center"))
        extra_defaults.append(("has_spa", "false", "hotel", "Spa and wellness"))
        extra_defaults.append(("has_conference_hall", "false", "hotel", "Conference hall"))
        extra_defaults.append(("has_parking", "false", "hotel", "Parking available"))
        extra_defaults.append(("has_24hr_reception", "false", "hotel", "24h reception"))
        extra_defaults.append(("has_wifi", "true", "hotel", "WiFi available"))
    if enabled_modules:
        extra_defaults.append(("enabled_modules", enabled_modules, "system", "Enabled feature modules"))
    defaults.extend(extra_defaults)
    for key, value, group, desc in defaults:
        if db.query(Setting).filter(Setting.lodge_id == lodge_id,
                                     Setting.setting_key == key).first():
            continue
        db.add(Setting(lodge_id=lodge_id, setting_key=key,
                       setting_value=value, setting_group=group,
                       description=desc, is_sensitive=False))
    db.commit()


@admin_router.post("/{request_id}/approve")
def approve_registration(request_id: int, request: Request,
                          db: Session = Depends(get_db),
                          current_user=Depends(require_super_admin)):
    """Approve a pending registration. Creates the Lodge, admin user,
    settings, and email templates. Returns the new credentials ONCE.

    Idempotency: if the request is already approved, returns the existing
    lodge info (without regenerating the password). Rejected requests
    cannot be re-approved.
    """
    r = (db.query(LodgeRegistrationRequest)
         .filter(LodgeRegistrationRequest.request_id == request_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="Registration not found")
    if r.status == RegistrationStatus.rejected.value:
        raise HTTPException(status_code=400,
                            detail="This request was rejected and cannot be approved")
    if r.status == RegistrationStatus.approved.value:
        # Idempotent — return what we have without password (it was shown once).
        lodge = db.query(Lodge).filter(Lodge.lodge_id == r.created_lodge_id).first()
        admin_user = db.query(User).filter(User.user_id == r.created_admin_user_id).first()
        return {
            "request_id": r.request_id, "status": r.status,
            "lodge_id": lodge.lodge_id if lodge else None,
            "lodge_code": lodge.code if lodge else None,
            "admin_username": admin_user.username if admin_user else None,
            "admin_password": None,
            "message": "Already approved earlier; credentials were displayed at that time.",
        }

    # Defensive: in case a manual lodge with the same code was created
    # between the submission and the approval.
    if db.query(Lodge).filter(Lodge.code == r.proposed_code).first():
        raise HTTPException(status_code=409,
                            detail=f"A lodge with code '{r.proposed_code}' already exists. Manual intervention required.")

    # 1. Create the Lodge.
    full_address = ", ".join(filter(None, [r.address_line1, r.address_line2,
                                             r.city, r.state, r.pincode]))
    lodge = Lodge(code=r.proposed_code, name=r.lodge_name,
                  address=full_address, phone=r.owner_phone,
                  email=r.owner_email, is_active=True)
    db.add(lodge); db.flush()    # need lodge_id for the FKs below

    # 2. Create the admin user.
    username = f"{r.proposed_code}_admin"
    if db.query(User).filter(User.username == username).first():
        # Username collision (very unlikely given proposed_code uniqueness,
        # but theoretically possible if someone manually created it).
        # Append a numeric suffix until free.
        n = 2
        while db.query(User).filter(User.username == f"{username}{n}").first():
            n += 1
        username = f"{username}{n}"
    password = _generate_password()
    admin_user = User(
        username=username,
        password_hash=get_password_hash(password),
        full_name=r.owner_full_name,
        email=r.owner_email,
        role=UserRole.admin,
        lodge_id=lodge.lodge_id,
        is_active=True,
    )
    db.add(admin_user); db.flush()

    # 3. Update the registration request itself (FKs and status).
    r.status = RegistrationStatus.approved.value
    r.reviewed_by = current_user.user_id
    r.reviewed_at = _utcnow()
    r.created_lodge_id = lodge.lodge_id
    r.created_admin_user_id = admin_user.user_id
    db.commit()
    db.refresh(lodge); db.refresh(admin_user); db.refresh(r)

    # 4. Seed defaults (settings + email templates) — non-fatal if these fail.
    try:
        _seed_lodge_defaults(db, lodge.lodge_id, r.lodge_name,
                              r.owner_phone, r.owner_email, full_address,
                              property_category=r.property_category or "lodge",
                              enabled_modules=r.enabled_modules)
    except Exception as e:
        logger.warning("Default settings seed failed for lodge %s: %s",
                       lodge.lodge_id, e)
    try:
        from ..services.email_service import seed_default_templates
        seed_default_templates(db, lodge.lodge_id, current_user.user_id)
    except Exception as e:
        logger.warning("Default email templates seed failed: %s", e)

    # 4b. v7.1 — Pre-seed the room inventory based on the breakdown the
    # applicant provided in the onboarding wizard. The lodge admin can
    # edit room numbers / floor assignments later, but the rooms exist
    # from day one so they can immediately start running checkins.
    try:
        _seed_lodge_rooms(db, lodge.lodge_id, r)
    except Exception as e:
        logger.warning("Room pre-seeding failed for lodge %s: %s", lodge.lodge_id, e)

    # 5. Audit.
    try:
        log_audit(db, "lodge_registration.approved",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="lodge_registration", entity_id=r.request_id,
                  lodge_id=lodge.lodge_id,
                  details={"lodge_code": lodge.code, "admin_username": username,
                           "selected_plan": r.selected_plan,
                           "billing_cycle": r.billing_cycle,
                           "total_rooms": r.total_rooms},
                  ip_address=request.client.host if request and request.client else None)
    except Exception: pass

    # 6. v7.1 — Send credentials email to the lodge owner. Non-fatal:
    # super-admin still sees the password on screen as a backup channel.
    email_sent = False
    try:
        email_sent = _send_credentials_email(
            db, lodge=lodge, owner_name=r.owner_full_name,
            owner_email=r.owner_email, username=username, password=password,
            plan_key=r.selected_plan,
        )
    except Exception as e:
        logger.warning("Credentials email failed: %s", e)

    # 7. v8.0 — Auto-create the billing subscription using the plan they
    # picked during onboarding. Trial window starts immediately; first
    # charge fires when the trial expires. Non-fatal — super-admin can
    # re-trigger if Razorpay creds weren't configured at approval time.
    subscription_id = None
    subscription_short_url = None
    try:
        from ..services import billing_service
        sub = billing_service.create_subscription_for_lodge(
            db, lodge=lodge,
            plan_key=r.selected_plan or "starter",
            billing_cycle=r.billing_cycle or "monthly",
            total_rooms=r.total_rooms or 1,
            owner_email=r.owner_email,
            owner_name=r.owner_full_name,
            owner_phone=r.owner_phone,
        )
        subscription_id = sub.subscription_id
        subscription_short_url = sub.provider_short_url
    except Exception as e:
        logger.warning("Subscription creation failed for lodge %s: %s",
                       lodge.lodge_id, e)

    return {
        "request_id": r.request_id,
        "status": r.status,
        "lodge_id": lodge.lodge_id,
        "lodge_code": lodge.code,
        "admin_username": username,
        # IMPORTANT — the only place this plaintext password ever appears.
        # The super-admin must capture it now and pass to the lodge owner.
        "admin_password": password,
        "email_sent": email_sent,
        "owner_email": r.owner_email,
        "subscription_id": subscription_id,
        "subscription_short_url": subscription_short_url,
        "message": (f"Lodge '{lodge.name}' is now active. The owner can log in as "
                    f"'{username}' with the password shown. " +
                    ("Credentials emailed to the owner." if email_sent
                     else "Email delivery wasn't possible — please share credentials manually.")),
    }


def _seed_lodge_rooms(db: Session, lodge_id: int, r: LodgeRegistrationRequest):
    """Create one Room row per room declared at registration time.

    Numbers are auto-generated as "101", "102", ... — the lodge admin can
    rename them via the Rooms page. We skip seeding if any rooms already
    exist (idempotent — protects re-approval if the admin manually added rooms).
    """
    from ..models import Room, RoomType, RoomStatus
    if db.query(Room).filter(Room.lodge_id == lodge_id).first():
        return  # don't double-seed
    # Map the wizard categories → existing RoomType enum values.
    ac      = getattr(r, "rooms_ac", 0) or 0
    non_ac  = getattr(r, "rooms_non_ac", 0) or 0
    deluxe  = getattr(r, "rooms_deluxe", 0) or 0
    suite   = getattr(r, "rooms_suite", 0) or 0
    # If breakdown wasn't provided, fall back to creating all rooms as 'ac'.
    if ac + non_ac + deluxe + suite == 0 and r.total_rooms > 0:
        ac = r.total_rooms

    # Sensible default tariffs by type (lodge admin can update).
    plan_tariffs = {
        "non_ac":     800,
        "ac":         1500,
        "deluxe_ac":  2500,
        "house":      4500,   # we reuse the 'house' type for suite
    }
    n = 101
    for count, room_type, tariff, has_ac in [
        (non_ac, "non_ac",    plan_tariffs["non_ac"],    False),
        (ac,     "ac",        plan_tariffs["ac"],        True),
        (deluxe, "deluxe_ac", plan_tariffs["deluxe_ac"], True),
        (suite,  "house",     plan_tariffs["house"],     True),
    ]:
        for _ in range(count):
            db.add(Room(lodge_id=lodge_id, room_number=str(n),
                          room_type=room_type, base_tariff=tariff,
                          has_ac=has_ac,
                          floor=1 + (n - 101) // 20, status="available"))
            n += 1
    db.commit()


def _send_credentials_email(db: Session, *, lodge, owner_name: str,
                              owner_email: str, username: str, password: str,
                              plan_key: Optional[str]) -> bool:
    """Send welcome + credentials email. Returns True on success.

    Uses the SMTP helper directly (not the templated email_service) because
    this email goes out BEFORE templates are scoped to a lodge — we're
    sending to the brand-new lodge from a system-level sender."""
    from ..services.smtp_service import send_email_via_smtp
    plan_name = ""
    if plan_key:
        from ..services.pricing_service import PLANS_BY_KEY
        p = PLANS_BY_KEY.get(plan_key)
        if p: plan_name = p["name"]

    subject = f"Welcome to Rusto — Your {lodge.name} account is ready"
    body = f"""Hi {owner_name},

Welcome to Rusto! Your lodge **{lodge.name}** has been approved and your
account is ready to use.

Login at: https://your-rusto-url/login

  Username:  {username}
  Password:  {password}
  Plan:      {plan_name or 'Starter'}

For security, please change your password after your first login (Settings → Security).

Next steps:
  1. Log in and update your lodge details
  2. Add your team members under "My Team" (each gets their own login)
  3. Configure Razorpay to accept online bookings (Settings → Payments)
  4. Set up WhatsApp Business to auto-send confirmations (WhatsApp page)
  5. Add photos + go live on the customer marketplace (Rusto Listing)

If you need help, reach us via the Support page once logged in.

Welcome aboard,
The Rusto Team
"""
    # SMTP config is per-lodge in the settings table. A brand-new lodge
    # has none yet, so this email needs to send via the SYSTEM SMTP — by
    # convention that's the SMTP configured on lodge 1 (udumulas).
    # If neither the new lodge nor lodge 1 has SMTP credentials, the
    # helper returns (False, "SMTP not configured") and super-admin sees
    # the password on screen as a backup.
    ok, _msg = send_email_via_smtp(db, lodge.lodge_id, owner_email, subject, body)
    if not ok:
        # Fallback: try lodge 1's SMTP context as the system sender.
        ok, _msg = send_email_via_smtp(db, 1, owner_email, subject, body)
    return bool(ok)


class RejectBody(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


@admin_router.post("/{request_id}/reject")
def reject_registration(request_id: int, body: RejectBody, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(require_super_admin)):
    """Reject a pending request with a reason that's visible to the
    super-admin team (we don't auto-email the applicant — that's a
    privacy / spam consideration left to manual outreach)."""
    r = (db.query(LodgeRegistrationRequest)
         .filter(LodgeRegistrationRequest.request_id == request_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="Registration not found")
    if r.status != RegistrationStatus.pending.value:
        raise HTTPException(status_code=400,
                            detail=f"Cannot reject a request that's already {r.status}")
    r.status = RegistrationStatus.rejected.value
    r.rejection_reason = body.reason.strip()
    r.reviewed_by = current_user.user_id
    r.reviewed_at = _utcnow()
    db.commit(); db.refresh(r)

    try:
        log_audit(db, "lodge_registration.rejected",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="lodge_registration", entity_id=r.request_id,
                  details={"proposed_code": r.proposed_code, "reason": body.reason[:200]},
                  ip_address=request.client.host if request and request.client else None)
    except Exception: pass
    return _request_to_dict(r, db)


# ── v11 — Payment management & follow-up endpoints ──────────────────

class PaymentUpdateBody(BaseModel):
    payment_status: str = Field(..., description="pending/paid/failed/waived/offline_collected")
    payment_method: Optional[str] = None          # upi/phonepe/googlepay/razorpay/offline/waived
    payment_ref:    Optional[str] = None           # UTR or transaction ID
    payment_amount: Optional[float] = None
    payment_date:   Optional[str]  = None          # ISO date string
    payment_notes:  Optional[str]  = None
    follow_up_at:   Optional[str]  = None          # ISO datetime for next follow-up
    assigned_to:    Optional[str]  = None


@admin_router.patch("/{request_id}/payment")
def update_payment(request_id: int, body: PaymentUpdateBody,
                    request: Request,
                    db: Session = Depends(get_db),
                    current_user=Depends(require_super_admin)):
    """Record or update payment details for a registration.

    Used by the RUSTO team after collecting payment offline (call, UPI, etc.).
    Can also be used to mark a payment as waived or failed with follow-up notes.
    """
    r = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.request_id == request_id
    ).first()
    if not r:
        raise HTTPException(404, "Registration not found")

    r.payment_status = body.payment_status
    if body.payment_method is not None:
        r.payment_method = body.payment_method
    if body.payment_ref is not None:
        r.payment_ref = body.payment_ref
    if body.payment_amount is not None:
        r.payment_amount = body.payment_amount
    if body.payment_date:
        from dateutil.parser import parse as _parse_dt
        try:
            r.payment_date = _parse_dt(body.payment_date)
        except Exception:
            pass
    if body.payment_notes is not None:
        # Append to existing notes with timestamp
        ts = _utcnow().strftime("%d %b %Y %H:%M UTC")
        actor = current_user.full_name or current_user.username
        new_note = f"[{ts} — {actor}] {body.payment_notes}"
        r.payment_notes = (r.payment_notes + "\n" + new_note) if r.payment_notes else new_note
    if body.follow_up_at:
        from dateutil.parser import parse as _parse_dt2
        try:
            r.follow_up_at = _parse_dt2(body.follow_up_at)
            r.follow_up_count = (r.follow_up_count or 0) + 1
        except Exception:
            pass
    if body.assigned_to is not None:
        r.assigned_to = body.assigned_to

    db.commit()
    db.refresh(r)

    try:
        log_audit(db, "lodge_registration.payment_updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="lodge_registration", entity_id=request_id,
                  lodge_id=None,
                  details={"payment_status": r.payment_status, "method": r.payment_method},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass

    return _request_to_dict(r, db)


@admin_router.post("/{request_id}/resend-credentials")
def resend_credentials(request_id: int,
                        db: Session = Depends(get_db),
                        current_user=Depends(require_super_admin)):
    """Re-generate a new password and re-send the welcome email.

    Used when:
    - The original email was lost/never received
    - RUSTO team collected offline payment and now needs to activate the lodge
    - Lodge owner forgot their password before first login
    """
    r = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.request_id == request_id,
        LodgeRegistrationRequest.status == RegistrationStatus.approved.value,
    ).first()
    if not r:
        raise HTTPException(400, "Registration must be approved before re-sending credentials")

    admin_user = db.query(User).filter(User.user_id == r.created_admin_user_id).first()
    lodge      = db.query(Lodge).filter(Lodge.lodge_id == r.created_lodge_id).first()
    if not admin_user or not lodge:
        raise HTTPException(500, "Associated lodge/user not found")

    # Generate and apply new password
    new_password = _generate_password()
    admin_user.password_hash = get_password_hash(new_password)
    db.commit()

    # Re-send email
    email_sent = False
    try:
        email_sent = _send_credentials_email(
            db, lodge=lodge, owner_name=r.owner_full_name,
            owner_email=r.owner_email, username=admin_user.username,
            password=new_password, plan_key=r.selected_plan,
        )
    except Exception as e:
        logger.warning("Resend credentials email failed: %s", e)

    return {
        "admin_username":   admin_user.username,
        "admin_password":   new_password,
        "email_sent":       email_sent,
        "owner_email":      r.owner_email,
        "lodge_code":       lodge.code,
        "lodge_id":         lodge.lodge_id,
        "message": ("New password generated and emailed to the lodge owner."
                    if email_sent else
                    "New password generated. Email delivery failed — share manually via a secure channel."),
    }


@admin_router.get("/follow-ups")
def list_follow_ups(
    db: Session = Depends(get_db),
    current_user=Depends(require_super_admin)
):
    """List all pending registrations with payment issues that need follow-up."""
    rows = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
        LodgeRegistrationRequest.payment_status.in_(["pending", "failed"])
    ).order_by(
        LodgeRegistrationRequest.follow_up_at.asc().nullslast(),
        LodgeRegistrationRequest.created_at.asc()
    ).all()
    return {"follow_ups": [_request_to_dict(r) for r in rows], "total": len(rows)}


@admin_router.get("/stats/payments")
def payment_stats(
    db: Session = Depends(get_db),
    current_user=Depends(require_super_admin)
):
    """Aggregate payment status counts across all registrations."""
    from sqlalchemy import func, case

    rows = db.query(
        LodgeRegistrationRequest.payment_status,
        func.count(LodgeRegistrationRequest.request_id).label("count"),
        func.sum(LodgeRegistrationRequest.payment_amount).label("total_amount"),
    ).group_by(LodgeRegistrationRequest.payment_status).all()

    stats = {}
    for row in rows:
        stats[row.payment_status or "pending"] = {
            "count": row.count,
            "total_amount": float(row.total_amount) if row.total_amount else 0,
        }

    # Overall KPIs
    total_regs = db.query(func.count(LodgeRegistrationRequest.request_id)).scalar() or 0
    approved   = db.query(func.count(LodgeRegistrationRequest.request_id)).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.approved.value).scalar() or 0
    pending_payment = db.query(func.count(LodgeRegistrationRequest.request_id)).filter(
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
        LodgeRegistrationRequest.payment_status.in_(["pending", "failed"])
    ).scalar() or 0

    return {
        "by_payment_status": stats,
        "total_registrations": total_regs,
        "approved": approved,
        "awaiting_payment_followup": pending_payment,
    }


# ── v11.1 — Registration payment link (Razorpay) ────────────────────

@public_router.post("/{request_id}/create-payment-link")
def create_registration_payment_link(
    request_id: int,
    db: Session = Depends(get_db),
):
    """Create a Razorpay payment link for the registration fee.

    Called from the final step of the onboarding wizard so the applicant
    can pay via UPI / PhonePe / GPay without leaving the page.
    Returns a short_url the frontend opens in a new tab / Razorpay checkout.
    Falls back to a 'pending' state if Razorpay is not configured.
    """
    r = db.query(LodgeRegistrationRequest).filter(
        LodgeRegistrationRequest.request_id == request_id,
        LodgeRegistrationRequest.status == RegistrationStatus.pending.value,
    ).first()
    if not r:
        raise HTTPException(404, "Registration not found or already processed")

    if r.payment_status == "paid":
        return {"already_paid": True, "message": "Payment already recorded"}

    amount = float(r.quoted_price_inr or 0)
    if amount <= 0:
        return {"no_payment_required": True,
                "message": "No payment amount set — super-admin will review"}

    # Try to create Razorpay payment link
    try:
        import razorpay, os
        client = razorpay.Client(
            auth=(os.getenv("RAZORPAY_KEY_ID", ""),
                  os.getenv("RAZORPAY_KEY_SECRET", ""))
        )
        data = {
            "amount": int(amount * 100),  # paise
            "currency": "INR",
            "accept_partial": False,
            "description": f"Rusto platform subscription — {r.lodge_name}",
            "customer": {
                "name":  r.owner_full_name,
                "email": r.owner_email,
                "contact": r.owner_phone,
            },
            "notify": {"sms": True, "email": True},
            "reminder_enable": True,
            "notes": {
                "registration_id": str(request_id),
                "lodge_name":      r.lodge_name,
                "plan":            r.selected_plan or "",
            },
            "callback_url": f"{os.getenv('APP_BASE_URL','')}/register?payment=success&reg={request_id}",
            "callback_method": "get",
        }
        link = client.payment_link.create(data)
        short_url = link.get("short_url", "")

        # Save the payment link ref
        r.payment_ref    = link.get("id", "")
        r.payment_notes  = (r.payment_notes or "") + f"\n[AUTO] Razorpay payment link created: {short_url}"
        db.commit()

        return {
            "payment_link_id": link.get("id"),
            "short_url": short_url,
            "amount": amount,
            "currency": "INR",
            "lodge_name": r.lodge_name,
            "plan": r.selected_plan,
        }
    except Exception as e:
        logger.warning("Razorpay payment link creation failed: %s", e)
        # Graceful fallback — no Razorpay configured
        return {
            "no_gateway": True,
            "message": "Online payment not configured. RUSTO team will contact you to collect payment.",
            "contact_email": "hello@rusto.in",
            "amount": amount,
        }


@public_router.post("/webhook/payment-confirmed")
async def registration_payment_webhook(request: Request, db: Session = Depends(get_db)):
    """Razorpay webhook: payment.captured → mark registration as paid.

    Razorpay sends this when a payment link is paid. We verify the signature,
    find the registration from the notes, mark payment_status='paid', and
    log the event. The super-admin is then notified on their next page load
    (via the payment_stats endpoint showing awaiting_payment_followup delta).
    """
    import hmac, hashlib, os

    body_bytes = await request.body()
    sig = request.headers.get("x-razorpay-signature", "")
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")

    if secret and sig:
        expected = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(400, "Invalid webhook signature")

    try:
        import json
        payload = json.loads(body_bytes)
        event = payload.get("event", "")
        if event not in ("payment.captured", "payment_link.paid"):
            return {"ignored": True, "event": event}

        # Extract registration_id from notes
        entity = (payload.get("payload", {})
                         .get("payment", {})
                         .get("entity", {})
                  or payload.get("payload", {})
                             .get("payment_link", {})
                             .get("entity", {}))
        notes = entity.get("notes", {})
        reg_id_str = notes.get("registration_id")
        if not reg_id_str:
            return {"ignored": True, "reason": "no registration_id in notes"}

        reg = db.query(LodgeRegistrationRequest).filter(
            LodgeRegistrationRequest.request_id == int(reg_id_str)
        ).first()
        if not reg:
            return {"ignored": True, "reason": "registration not found"}

        amount_paise = entity.get("amount", 0)
        payment_id   = entity.get("id", "")
        method       = entity.get("method", "online")

        reg.payment_status = "paid"
        reg.payment_method = method
        reg.payment_ref    = payment_id
        reg.payment_amount = amount_paise / 100
        reg.payment_date   = _utcnow()
        reg.payment_notes  = ((reg.payment_notes or "") +
                               f"\n[AUTO] Payment confirmed via Razorpay. "
                               f"ID: {payment_id} · ₹{amount_paise//100}")
        db.commit()
        logger.info("Registration %s payment confirmed via webhook. ID: %s",
                    reg_id_str, payment_id)
        return {"ok": True, "registration_id": reg_id_str}

    except Exception as e:
        logger.error("Registration payment webhook error: %s", e)
        raise HTTPException(500, "Webhook processing error")
