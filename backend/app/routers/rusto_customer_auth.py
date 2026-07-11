"""RustoCustomer-side auth endpoints (separate from staff /api/auth).

Endpoints:
  POST /api/rusto/auth/signup    — new customer registration
  POST /api/rusto/auth/login     — phone + password login
  GET  /api/rusto/auth/me        — current logged-in customer profile
  PATCH /api/rusto/auth/me       — update profile fields
  POST /api/rusto/auth/change-password
"""
import re
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, EmailStr, field_validator

from ..database import get_db
from ..models import RustoCustomer, CustomerOtp
from ..rusto_auth import (hash_customer_password, verify_customer_password,
                           create_customer_token, get_current_customer,
                           CUSTOMER_TOKEN_EXPIRE_DAYS)
from ..net_utils import get_client_ip
from ..services.audit_service import log_audit, log_login_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rusto/auth", tags=["rusto-customer-auth"])


def _utcnow():
    """Naive UTC — matches SQLite's naive DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _user_agent(request: Request) -> str:
    try:
        return (request.headers.get("user-agent") or "")[:400]
    except Exception:
        return ""


def _customer_to_dict(c: RustoCustomer) -> dict:
    return {
        "customer_id": c.customer_id,
        "phone": c.phone,
        "email": c.email,
        "full_name": c.full_name,
        "gender": c.gender,
        "date_of_birth": c.date_of_birth.isoformat() if c.date_of_birth else None,
        "address_line": c.address_line,
        "city": c.city,
        "state": c.state,
        "pincode": c.pincode,
        "accepts_marketing": bool(c.accepts_marketing),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "last_login_at": c.last_login_at.isoformat() if c.last_login_at else None,
    }


# ── Signup ──────────────────────────────────────────────────────────

class SignupBody(BaseModel):
    """Minimal signup — full_name + phone + password. Email optional but
    strongly recommended (receipts go there)."""
    full_name: str = Field(min_length=2, max_length=160)
    phone: str = Field(min_length=7, max_length=20)
    email: Optional[EmailStr] = None
    password: str = Field(min_length=8, max_length=128,
                           description="Min 8 chars; we don't enforce complexity here — too punitive on mobile")
    accepts_marketing: bool = True

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        # Strip whitespace + non-digit-non-plus chars except the leading +.
        v = v.strip()
        # Keep leading + then digits only.
        if v.startswith("+"):
            cleaned = "+" + re.sub(r"[^\d]", "", v[1:])
        else:
            cleaned = re.sub(r"[^\d]", "", v)
        if len(cleaned) < 7:
            raise ValueError("Phone too short")
        return cleaned


@router.post("/signup", status_code=201)
def signup(request: Request, body: SignupBody, db: Session = Depends(get_db)):
    """Create a new customer account. Phone uniqueness is enforced —
    if it's taken we say so explicitly (no enumeration concerns; this
    is a B2C app where users expect to know they already have an
    account)."""
    existing = db.query(RustoCustomer).filter(RustoCustomer.phone == body.phone).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account already exists with this phone number. Please log in instead.",
        )
    ip = get_client_ip(request)
    c = RustoCustomer(
        full_name=body.full_name.strip(),
        phone=body.phone,
        email=body.email,
        password_hash=hash_customer_password(body.password),
        accepts_marketing=body.accepts_marketing,
    )
    try:
        c.last_login_ip = ip
    except Exception:
        pass
    db.add(c); db.commit(); db.refresh(c)
    token = create_customer_token(c.customer_id)
    logger.info("New Rusto customer signed up: id=%s phone=%s", c.customer_id, c.phone)
    log_login_event(db, "customer", actor_id=c.customer_id, username=c.phone,
                    success=True, method="signup", ip_address=ip,
                    user_agent=_user_agent(request))
    log_audit(db, "customer.signup", actor_username=c.phone, actor_type="customer",
              entity_type="rusto_customer", entity_id=c.customer_id,
              details={"phone": c.phone}, ip_address=ip)
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in_days": CUSTOMER_TOKEN_EXPIRE_DAYS,
        "customer": _customer_to_dict(c),
    }


# ── Login ───────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    phone: str = Field(min_length=7, max_length=20)
    password: str

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        v = v.strip()
        if v.startswith("+"):
            return "+" + re.sub(r"[^\d]", "", v[1:])
        return re.sub(r"[^\d]", "", v)


@router.post("/login")
def login(request: Request, body: LoginBody, db: Session = Depends(get_db)):
    """Phone + password login. Generic 401 on either bad-phone or
    bad-password — we don't enumerate accounts."""
    ip = get_client_ip(request)
    ua = _user_agent(request)
    cust = db.query(RustoCustomer).filter(RustoCustomer.phone == body.phone).first()
    if not cust or not verify_customer_password(body.password, cust.password_hash):
        # Record the failed attempt too — feeds the security console.
        log_login_event(db, "customer",
                        actor_id=cust.customer_id if cust else None,
                        username=body.phone, success=False, method="password",
                        ip_address=ip, user_agent=ua)
        raise HTTPException(status_code=401, detail="Invalid phone or password")
    if not cust.is_active:
        log_login_event(db, "customer", actor_id=cust.customer_id,
                        username=cust.phone, success=False, method="password",
                        ip_address=ip, user_agent=ua)
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Please contact support.")
    cust.last_login_at = _utcnow()
    try:
        cust.last_login_ip = ip
    except Exception:
        pass
    db.commit(); db.refresh(cust)
    token = create_customer_token(cust.customer_id)
    log_login_event(db, "customer", actor_id=cust.customer_id, username=cust.phone,
                    success=True, method="password", ip_address=ip, user_agent=ua)
    log_audit(db, "customer.login", actor_username=cust.phone, actor_type="customer",
              entity_type="rusto_customer", entity_id=cust.customer_id,
              details=None, ip_address=ip)
    return {
        "token": token,
        "token_type": "bearer",
        "expires_in_days": CUSTOMER_TOKEN_EXPIRE_DAYS,
        "customer": _customer_to_dict(cust),
    }


# ── Profile ─────────────────────────────────────────────────────────

@router.get("/me")
def me(customer: RustoCustomer = Depends(get_current_customer)):
    return _customer_to_dict(customer)


class ProfilePatch(BaseModel):
    """Subset of fields a customer can edit on themselves. Phone is
    immutable here (would need OTP re-verification) — they can use a
    support ticket to change it."""
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    email: Optional[EmailStr] = None
    gender: Optional[str] = Field(default=None, max_length=20)
    date_of_birth: Optional[str] = None        # ISO date string
    address_line: Optional[str] = Field(default=None, max_length=300)
    city: Optional[str] = Field(default=None, max_length=80)
    state: Optional[str] = Field(default=None, max_length=80)
    pincode: Optional[str] = Field(default=None, max_length=12)
    accepts_marketing: Optional[bool] = None


@router.patch("/me")
def update_me(body: ProfilePatch,
               customer: RustoCustomer = Depends(get_current_customer),
               db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "date_of_birth" in data and data["date_of_birth"]:
        from datetime import date as _date
        try:
            data["date_of_birth"] = _date.fromisoformat(data["date_of_birth"])
        except ValueError:
            raise HTTPException(status_code=400, detail="date_of_birth must be YYYY-MM-DD")
    for k, v in data.items():
        setattr(customer, k, v)
    db.commit(); db.refresh(customer)
    return _customer_to_dict(customer)


# ── Change password ─────────────────────────────────────────────────

class ChangePwdBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
def change_password(body: ChangePwdBody,
                     customer: RustoCustomer = Depends(get_current_customer),
                     db: Session = Depends(get_db)):
    if not verify_customer_password(body.current_password, customer.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    customer.password_hash = hash_customer_password(body.new_password)
    db.commit()
    return {"success": True, "message": "Password updated"}


# ── Password reset ────────────────────────────────────────────────
# One-time codes live in the customer_otps table (hashed, 10-min expiry,
# max 5 verification attempts, single-use). Survives restarts and works
# across multiple workers — unlike the old in-memory dict.

import secrets as _secrets

OTP_TTL_MINUTES  = 10
OTP_MAX_ATTEMPTS = 5
OTP_PURPOSE_RESET = "password_reset"


class ForgotPasswordBody(BaseModel):
    phone: str


class ResetPasswordBody(BaseModel):
    phone: str
    otp:   str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/forgot-password")
def forgot_password(request: Request, body: ForgotPasswordBody,
                    db: Session = Depends(get_db)):
    """Request an OTP for password reset.

    Sends via the configured SMS gateway when one is available.
    In dev/sandbox WITHOUT an SMS gateway: returns the OTP in the
    response so you can test without SMS setup.
    """
    ip = get_client_ip(request)
    phone = body.phone.strip()
    customer = db.query(RustoCustomer).filter(
        RustoCustomer.phone == phone,
        RustoCustomer.is_active == True,
    ).first()

    log_audit(db, "customer.password_reset_requested", actor_username=phone,
              actor_type="customer",
              entity_type="rusto_customer",
              entity_id=customer.customer_id if customer else None,
              details={"found": bool(customer)}, ip_address=ip)

    if not customer:
        # Return 200 even if phone not found — don't enumerate accounts
        return {"success": True, "message": "If this number is registered, an OTP has been sent."}

    otp = str(_secrets.randbelow(900000) + 100000)  # 6-digit OTP

    # Invalidate any previous outstanding codes for this phone, then store
    # the new one HASHED (same bcrypt util as customer passwords).
    now = _utcnow()
    (db.query(CustomerOtp)
       .filter(CustomerOtp.phone == phone,
               CustomerOtp.purpose == OTP_PURPOSE_RESET,
               CustomerOtp.used == False)
       .update({CustomerOtp.used: True}, synchronize_session=False))
    db.add(CustomerOtp(
        phone=phone,
        purpose=OTP_PURPOSE_RESET,
        code_hash=hash_customer_password(otp),
        expires_at=now + timedelta(minutes=OTP_TTL_MINUTES),
        attempts=0,
        used=False,
    ))
    db.commit()

    # Best-effort SMS send when a gateway is configured (platform lodge 1
    # holds the marketplace-level SMS settings).
    sms_configured = False
    sms_sent = False
    try:
        from ..services.alert_service import is_sms_enabled, send_sms
        sms_configured = is_sms_enabled(db, lodge_id=1)
        if sms_configured:
            send_sms(db, phone,
                     f"[Rusto] Your password reset OTP: {otp}\n"
                     f"Valid for {OTP_TTL_MINUTES} min. Do NOT share.",
                     lodge_id=1, event_type="custom")
            sms_sent = True
    except Exception as e:
        logger.warning("Password-reset OTP SMS failed for %s: %s", phone, e)

    import os
    dev_mode = os.getenv("ENV", "development") != "production"
    result = {"success": True, "message": f"OTP sent (valid {OTP_TTL_MINUTES} minutes)"}
    if dev_mode and not sms_configured:
        # No SMS gateway → dev convenience: expose the code in the response
        # (never in production). Both keys kept for older clients/tests.
        result["dev_otp"] = otp
        result["debug_otp"] = otp
    return result


@router.post("/reset-password")
def reset_password(request: Request, body: ResetPasswordBody,
                   db: Session = Depends(get_db)):
    """Validate OTP and set a new password."""
    ip = get_client_ip(request)
    phone = body.phone.strip()
    now = _utcnow()

    rec = (db.query(CustomerOtp)
             .filter(CustomerOtp.phone == phone,
                     CustomerOtp.purpose == OTP_PURPOSE_RESET,
                     CustomerOtp.used == False)
             .order_by(CustomerOtp.created_at.desc())
             .first())
    if not rec:
        log_audit(db, "customer.password_reset_failed", actor_username=phone,
                  actor_type="customer", details={"reason": "no_otp"}, ip_address=ip)
        raise HTTPException(400, "No OTP request found for this phone number. Please request a new OTP.")
    if now > rec.expires_at:
        rec.used = True
        db.commit()
        log_audit(db, "customer.password_reset_failed", actor_username=phone,
                  actor_type="customer", details={"reason": "expired"}, ip_address=ip)
        raise HTTPException(400, "OTP has expired. Please request a new one.")
    if rec.attempts >= OTP_MAX_ATTEMPTS:
        rec.used = True
        db.commit()
        log_audit(db, "customer.password_reset_failed", actor_username=phone,
                  actor_type="customer", details={"reason": "max_attempts"}, ip_address=ip)
        raise HTTPException(429, "Too many wrong attempts. Please request a new OTP.")
    if not verify_customer_password(body.otp.strip(), rec.code_hash):
        rec.attempts = (rec.attempts or 0) + 1
        if rec.attempts >= OTP_MAX_ATTEMPTS:
            rec.used = True
        db.commit()
        log_audit(db, "customer.password_reset_failed", actor_username=phone,
                  actor_type="customer",
                  details={"reason": "wrong_otp", "attempts": rec.attempts},
                  ip_address=ip)
        raise HTTPException(400, "Incorrect OTP. Please check and try again.")

    customer = db.query(RustoCustomer).filter(
        RustoCustomer.phone == phone,
        RustoCustomer.is_active == True,
    ).first()
    if not customer:
        raise HTTPException(404, "Account not found")

    customer.password_hash = hash_customer_password(body.new_password)
    rec.used = True
    db.commit()
    log_audit(db, "customer.password_reset", actor_username=phone,
              actor_type="customer", entity_type="rusto_customer",
              entity_id=customer.customer_id, ip_address=ip)
    return {"success": True, "message": "Password reset successfully. Please log in with your new password."}
