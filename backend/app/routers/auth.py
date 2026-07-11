"""
Auth router — v10.0

Login flow:
  1. Username + password (existing).
  2. TOTP (if totp_enabled — existing).
  3. Staff OTP (if role == staff and lodge has require_login_otp OR user.require_login_otp):
       POST /login    → returns {"otp_required": true, "otp_token": "<short-lived token>"}
       POST /login/verify-otp  → {"otp_token": "...", "otp": "123456"} → full JWT

Roles (v10.0):
  super_admin  — cross-tenant Rusto platform admin.
  app_owner    — Tygonix application owner (same rights + deeper audit access).
  admin        — lodge-scoped full rights.
  lodge_owner  — lodge-scoped: billing/analytics/reports only (no staff edit, no checkins).
  staff        — lodge-scoped: operational modules; permissions list gates access.
  vendor       — integration partner; logs in via API key, not this endpoint.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone

def _now():
    """Return a naive UTC datetime compatible with SQLite's naive datetimes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
from typing import Optional
from ..database import get_db
from ..models import User, LoginAttempt
from ..auth import (verify_password, get_password_hash, create_access_token,
                    get_current_user, ACCESS_TOKEN_EXPIRE_HOURS)
<<<<<<< HEAD
from ..services.audit_service import log_audit, log_login_event
from ..net_utils import get_client_ip
=======
from ..services.audit_service import log_audit
>>>>>>> f425c3a72e94ad080fb969a60f1cc4b3ecea4b3b
import os, secrets, logging, ipaddress

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_ATTEMPTS    = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
LOCKOUT_MINUTES = 15
OTP_TTL_MINUTES = 5
OTP_MAX_TRIES   = 3

# ── Role helpers ───────────────────────────────────────────────────────────

SUPER_ROLES  = {"super_admin", "app_owner"}
ADMIN_ROLES  = {"admin", "lodge_owner"} | SUPER_ROLES
ALL_ROLES    = {"super_admin", "app_owner", "admin", "lodge_owner", "staff", "vendor"}

def _role(u: User) -> str:
    return getattr(u.role, "value", str(u.role))

def _is_super(u: User) -> bool:
    return _role(u) in SUPER_ROLES

def _is_admin_or_super(u: User) -> bool:
    return _role(u) in ADMIN_ROLES

def _is_staff(u: User) -> bool:
    return _role(u) == "staff"

# ── Lodge-configurable security settings ──────────────────────────────────

def _get_lodge_setting(db: Session, key: str, default: str, lodge_id) -> str:
    """Read a Setting for this lodge, falling back to `default` on any
    error, missing row, or empty value. Safe for lodge_id=None."""
    try:
        from ..services.alert_service import get_setting
        val = get_setting(db, key, default, lodge_id=lodge_id)
        return val if val not in (None, "") else default
    except Exception:
        return default


def _lockout_config(db: Session, lodge_id) -> tuple:
    """(max_attempts, lockout_minutes) — from the lodge's Setting rows,
    falling back to the env/module defaults on any error."""
    max_attempts, lockout_minutes = MAX_ATTEMPTS, LOCKOUT_MINUTES
    try:
        v = int(_get_lodge_setting(db, "max_login_attempts", "", lodge_id) or 0)
        if v > 0:
            max_attempts = v
    except Exception:
        pass
    try:
        v = int(_get_lodge_setting(db, "lockout_duration_minutes", "", lodge_id) or 0)
        if v > 0:
            lockout_minutes = v
    except Exception:
        pass
    return max_attempts, lockout_minutes


def _session_expiry(db: Session, user: User) -> timedelta:
    """Role-aware JWT lifetime: admin_session_hours for admin-type roles,
    staff_session_hours for staff. Falls back to the global default."""
    role = _role(user)
    key = "staff_session_hours" if role == "staff" else "admin_session_hours"
    hours = float(ACCESS_TOKEN_EXPIRE_HOURS)
    try:
        v = float(_get_lodge_setting(db, key, "", user.lodge_id) or 0)
        if v > 0:
            hours = v
    except Exception:
        pass
    return timedelta(hours=hours)


<<<<<<< HEAD
# Thin alias kept for backwards compatibility — the canonical implementation
# lives in app/net_utils.py (XFF honoured only behind a trusted proxy).
_client_ip = get_client_ip


def _user_agent(request: Request) -> str:
    try:
        return (request.headers.get("user-agent") or "")[:400]
    except Exception:
        return ""
=======
def _client_ip(request: Request) -> str:
    """Client IP, honouring the first X-Forwarded-For entry when present
    (we may sit behind a reverse proxy)."""
    try:
        xff = request.headers.get("x-forwarded-for")
        if xff:
            first = xff.split(",")[0].strip()
            if first:
                return first
    except Exception:
        pass
    return request.client.host if request.client else "unknown"
>>>>>>> f425c3a72e94ad080fb969a60f1cc4b3ecea4b3b


def _remote_login_policy(db: Session, lodge_id, ip: str) -> tuple:
    """Evaluate the remote-staff-login policy for this lodge and client IP.

    Returns (is_remote, policy):
      - trusted_network_cidrs empty / all-malformed → feature off →
        (False, "allow").
      - IP inside any trusted CIDR → (False, "allow").
      - Otherwise → (True, remote_login_policy) where policy is one of
        "allow" | "otp" | "block" (defaults to "allow" on bad values).
    """
    cidrs_raw = _get_lodge_setting(db, "trusted_network_cidrs", "", lodge_id) or ""
    networks = []
    for part in cidrs_raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            networks.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            continue  # ignore malformed entries
    if not networks:
        return False, "allow"  # feature off

    try:
        addr = ipaddress.ip_address(ip)
        if any(addr in net for net in networks):
            return False, "allow"
    except ValueError:
        # Unparseable client IP (e.g. "unknown") — treat as remote so the
        # policy still applies rather than silently bypassing it.
        pass

    policy = (_get_lodge_setting(db, "remote_login_policy", "allow", lodge_id) or "allow").strip().lower()
    if policy not in ("allow", "otp", "block"):
        policy = "allow"
    return True, policy


# ── OTP helpers ────────────────────────────────────────────────────────────

def _generate_otp() -> str:
    """6-digit zero-padded OTP."""
    return str(secrets.randbelow(1_000_000)).zfill(6)


def _lodge_requires_otp(db: Session, lodge_id: int) -> bool:
    """Return True if the lodge's settings have require_staff_otp = 'true'."""
    try:
        from ..services.alert_service import get_setting
        val = get_setting(db, "require_staff_otp", "false", lodge_id=lodge_id)
        return val.lower() in ("1", "true", "yes")
    except Exception:
        return False


def _send_otp_to_admin(db: Session, otp: str, lodge_id: int, staff_username: str,
                       user_phone: Optional[str] = None) -> bool:
    """
    Send the OTP via SMS. If the user has their own phone number on file we
    send it there; otherwise we fall back to the lodge admin's configured
    phone (legacy behaviour).
    Returns True if sent (or mock-sent), False on failure.
    """
    try:
        from ..services.alert_service import get_setting, send_sms, is_sms_enabled

        # v10.6: prefer the staff member's own phone when set.
        if user_phone and str(user_phone).strip():
            try:
                msg = (f"[Rusto] Your login OTP: {otp}\n"
                       f"Valid for {OTP_TTL_MINUTES} min. Do NOT share.")
                send_sms(db, str(user_phone).strip(), msg,
                         lodge_id=lodge_id, event_type="custom")
                return True
            except Exception as e:
                logger.error("OTP SMS to user's own phone failed (%s); "
                             "falling back to admin phone", e)

        admin_phone = get_setting(db, "admin_phone", "", lodge_id=lodge_id)
        if not admin_phone:
            # Fallback: find the first admin user for this lodge and use their phone
            admin_user = (db.query(User)
                          .filter(User.lodge_id == lodge_id,
                                  User.role.in_(["admin", "lodge_owner"]),
                                  User.is_active == True,
                                  User.phone != None)
                          .first())
            if admin_user and admin_user.phone:
                admin_phone = admin_user.phone

        if not admin_phone:
            # No phone to send to — log warning and ALLOW login (fail-open for
            # lodges that haven't configured SMS yet so they don't get locked out)
            logger.warning("Lodge %s: require_staff_otp=true but no admin_phone configured; "
                           "allowing login without OTP", lodge_id)
            return False

        msg = (f"[Rusto] Staff login OTP: {otp}\n"
               f"Staff '{staff_username}' is logging in to the PMS.\n"
               f"Valid for {OTP_TTL_MINUTES} min. Do NOT share.")
        send_sms(db, admin_phone, msg, lodge_id=lodge_id, event_type="custom")
        return True
    except Exception as e:
        logger.error("OTP SMS send failed: %s", e)
        return False


# ── Pydantic schemas ───────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None


class OtpVerifyRequest(BaseModel):
    """Body for POST /login/verify-otp."""
    otp_token: str          # short-lived token returned by /login when OTP is required
    otp: str                # 6-digit code the admin told the staff member


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ── Login ──────────────────────────────────────────────────────────────────

@router.post("/login")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    ip = _client_ip(request)

    attempt = LoginAttempt(username=body.username, ip_address=ip)
    db.add(attempt)

    user = db.query(User).filter(User.username == body.username.lower().strip()).first()

    # Lockout check
    if user and user.locked_until and user.locked_until > _now():
        db.commit()
        raise HTTPException(status_code=429,
            detail=f"Account locked until {user.locked_until.strftime('%H:%M:%S UTC')}")

    # Configurable brute-force lockout (Setting table, falls back to defaults)
    max_attempts, lockout_minutes = _lockout_config(db, user.lodge_id if user else None)

    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= max_attempts:
                user.locked_until = _now() + timedelta(minutes=lockout_minutes)
                user.failed_attempts = 0
        attempt.success = False
        db.commit()
        try:
            log_audit(db, "auth.login_failed", actor_username=body.username,
                      lodge_id=user.lodge_id if user else None,
                      details={"reason": "invalid_credentials" if user else "unknown_user"},
                      ip_address=ip)
        except Exception:
            pass
        log_login_event(db, "user", actor_id=user.user_id if user else None,
                        username=body.username, lodge_id=user.lodge_id if user else None,
                        success=False, method="password", ip_address=ip,
                        user_agent=_user_agent(request))
        raise HTTPException(status_code=401, detail="Invalid username or password")

    if not user.is_active:
        db.commit()
        try:
            log_audit(db, "auth.login_blocked",
                      actor_user_id=user.user_id, actor_username=user.username,
                      lodge_id=user.lodge_id, details={"reason": "inactive"}, ip_address=ip)
        except Exception:
            pass
        log_login_event(db, "user", actor_id=user.user_id, username=user.username,
                        lodge_id=user.lodge_id, success=False, method="password",
                        ip_address=ip, user_agent=_user_agent(request))
        raise HTTPException(status_code=403, detail="Account is inactive")

    # ── TOTP check (existing v2.4) ─────────────────────────────────────────
    if user.totp_enabled and user.totp_secret:
        from ..services.totp import verify_totp
        if not body.totp_code:
            db.commit()
            raise HTTPException(status_code=401, detail="totp_required")
        if not verify_totp(user.totp_secret, body.totp_code):
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= max_attempts:
                user.locked_until = _now() + timedelta(minutes=lockout_minutes)
                user.failed_attempts = 0
            db.commit()
            try:
                log_audit(db, "auth.login_failed",
                          actor_user_id=user.user_id, actor_username=user.username,
                          lodge_id=user.lodge_id, details={"reason": "invalid_totp"}, ip_address=ip)
            except Exception:
                pass
            log_login_event(db, "user", actor_id=user.user_id, username=user.username,
                            lodge_id=user.lodge_id, success=False, method="totp",
                            ip_address=ip, user_agent=_user_agent(request))
            raise HTTPException(status_code=401, detail="Invalid authentication code")

    role_val = _role(user)

    # ── v10.6: Remote staff login security ───────────────────────────────
    # If the lodge has trusted_network_cidrs configured and this staff
    # member is logging in from outside those networks, apply the lodge's
    # remote_login_policy: allow (default), otp (force OTP challenge) or
    # block (403). Admins are unaffected.
    remote_forces_otp = False
    if role_val == "staff" and user.lodge_id is not None:
        is_remote, remote_policy = _remote_login_policy(db, user.lodge_id, ip)
        if is_remote and remote_policy == "block":
            db.commit()
            try:
                log_audit(db, "auth.login_blocked",
                          actor_user_id=user.user_id, actor_username=user.username,
                          lodge_id=user.lodge_id,
                          details={"reason": "remote_login_blocked", "ip": ip},
                          ip_address=ip)
            except Exception:
                pass
<<<<<<< HEAD
            log_login_event(db, "user", actor_id=user.user_id, username=user.username,
                            lodge_id=user.lodge_id, success=False, method="password",
                            ip_address=ip, user_agent=_user_agent(request))
=======
>>>>>>> f425c3a72e94ad080fb969a60f1cc4b3ecea4b3b
            raise HTTPException(
                status_code=403,
                detail=("Remote login is blocked by your lodge's security policy. "
                        "Please log in from the lodge network or contact your admin."))
        if is_remote and remote_policy == "otp":
            remote_forces_otp = True

    # ── v10.0: Staff OTP check ────────────────────────────────────────────
    # Trigger OTP flow if:
    #   (a) role == staff  AND
    #   (b) user.require_login_otp is True  OR  lodge setting require_staff_otp
    #       is true  OR  remote login policy forces OTP (v10.6)
    needs_otp = (
        role_val == "staff"
        and user.lodge_id is not None
        and (
            remote_forces_otp
            or getattr(user, "require_login_otp", False)
            or _lodge_requires_otp(db, user.lodge_id)
        )
    )

    if needs_otp:
        otp = _generate_otp()
        user.login_otp          = otp
        user.login_otp_expires  = _now() + timedelta(minutes=OTP_TTL_MINUTES)
        user.login_otp_attempts = 0
        db.commit()

        # Best-effort send; if SMS not configured, we fail-open (return otp_required
        # but hint that admin must communicate the OTP verbally / via WhatsApp).
        # v10.6: sent to the staff member's own phone when they have one on
        # file; otherwise to the lodge admin's phone (legacy).
        own_phone = bool(getattr(user, "phone", None) and str(user.phone).strip())
        sms_sent = _send_otp_to_admin(db, otp, user.lodge_id, user.username,
                                      user_phone=getattr(user, "phone", None))

        try:
            log_audit(db, "auth.otp_sent",
                      actor_user_id=user.user_id, actor_username=user.username,
                      lodge_id=user.lodge_id,
                      details={"sms_sent": sms_sent, "to_own_phone": own_phone,
                               "ip": ip}, ip_address=ip)
        except Exception:
            pass

        # Return a signed short-lived OTP token (just the user_id + nonce, not a full JWT)
        otp_token = create_access_token(
            {"sub": str(user.user_id), "otp_flow": True},
            expires_delta=timedelta(minutes=OTP_TTL_MINUTES + 1)
        )
        return {
            "otp_required": True,
            "otp_token": otp_token,
            "sms_sent": sms_sent,
            "message": (
                ("OTP sent to your registered phone." if own_phone else
                 "OTP sent to lodge admin's phone. Ask your admin for the code.")
                if sms_sent else
                "OTP generated. SMS not configured — ask your admin for the code."
            ),
        }

    # ── All checks passed → issue full JWT ───────────────────────────────
    method = "totp" if (user.totp_enabled and user.totp_secret) else "password"
    return _issue_token(user, ip, attempt, db, method=method,
                        user_agent=_user_agent(request))


@router.post("/login/verify-otp")
def verify_otp_login(request: Request, body: OtpVerifyRequest, db: Session = Depends(get_db)):
    """
    Second step of the staff OTP flow.
    Validates the OTP token + 6-digit code and returns a full access JWT.
    """
    ip = get_client_ip(request)

    # Decode the short-lived OTP token to get user_id
    from ..auth import decode_token
    try:
        payload = decode_token(body.otp_token)
        if not payload.get("otp_flow"):
            raise HTTPException(status_code=400, detail="Invalid OTP token")
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP token")

    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Lockout check — a locked account can't finish the OTP flow either.
    if user.locked_until and user.locked_until > _now():
        raise HTTPException(status_code=429,
            detail=f"Account locked until {user.locked_until.strftime('%H:%M:%S UTC')}")

    # Check attempts
    if (user.login_otp_attempts or 0) >= OTP_MAX_TRIES:
        try:
            log_audit(db, "auth.otp_max_attempts",
                      actor_user_id=user.user_id, actor_username=user.username,
                      lodge_id=user.lodge_id, details={"ip": ip}, ip_address=ip)
        except Exception:
            pass
        raise HTTPException(status_code=429,
                            detail="Too many OTP attempts. Please log in again.")

    # Constant-time compare — accept EITHER:
    #   (a) The live SMS OTP (if not expired), OR
    #   (b) The static admin-set PIN (static_login_pin column, if set)
    import hmac as _hmac

    entered = str(body.otp or "").strip()
    otp_matched = False
    match_method = "otp"          # for the LoginEvent row: "pin" | "otp"

    # Option A: static admin-set PIN (always valid, no expiry)
    try:
        static_pin = getattr(user, "static_login_pin", None)
        if static_pin and _hmac.compare_digest(str(static_pin), entered):
            otp_matched = True
            match_method = "pin"
    except Exception:
        pass

    # Option B: live SMS OTP (time-limited)
    if not otp_matched:
        if not user.login_otp_expires or _now() > user.login_otp_expires:
            if not otp_matched:
                raise HTTPException(status_code=400,
                    detail="OTP expired. Please log in again or ask admin for a new one.")
        if _hmac.compare_digest(str(user.login_otp or ""), entered):
            otp_matched = True

    if not otp_matched:
        user.login_otp_attempts = (user.login_otp_attempts or 0) + 1
        db.commit()
        remaining = max(0, OTP_MAX_TRIES - user.login_otp_attempts)
        try:
            log_audit(db, "auth.otp_wrong",
                      actor_user_id=user.user_id, actor_username=user.username,
                      lodge_id=user.lodge_id, details={"remaining": remaining}, ip_address=ip)
        except Exception:
            pass
        log_login_event(db, "user", actor_id=user.user_id, username=user.username,
                        lodge_id=user.lodge_id, success=False, method="otp",
                        ip_address=ip, user_agent=_user_agent(request))
        raise HTTPException(status_code=401,
                            detail=f"Wrong OTP. {remaining} attempt(s) remaining.")

    # OTP correct — clear OTP fields, record IP, issue token
    user.login_otp          = None
    user.login_otp_expires  = None
    user.login_otp_attempts = 0
    try:
        user.last_otp_login_ip = ip
    except Exception:
        pass

    attempt = LoginAttempt(username=user.username, ip_address=ip, success=True)
    db.add(attempt)

    return _issue_token(user, ip, attempt, db, via_otp=True,
                        method=match_method, user_agent=_user_agent(request))


def _issue_token(user: User, ip: str, attempt, db: Session, via_otp: bool = False,
                 method: str = "password", user_agent: str = ""):
    """Finalise a successful login: reset counters, log audit, return JWT."""
    user.failed_attempts = 0
    user.locked_until    = None
    user.last_login      = _now()
    if hasattr(attempt, "success"):
        attempt.success  = True
    db.commit()

    try:
        log_audit(db, "auth.login",
                  actor_user_id=user.user_id, actor_username=user.username,
                  lodge_id=user.lodge_id,
                  details={"via_otp": via_otp, "ip": ip}, ip_address=ip)
    except Exception:
        pass
    log_login_event(db, "user", actor_id=user.user_id, username=user.username,
                    lodge_id=user.lodge_id, success=True, method=method,
                    ip_address=ip, user_agent=user_agent)

    # v10.6: role-aware session lifetime (admin_session_hours /
    # staff_session_hours from the lodge's settings; global default otherwise).
    token = create_access_token({
        "sub":      str(user.user_id),
        "role":     _role(user),
        "lodge_id": user.lodge_id,
    }, expires_delta=_session_expiry(db, user))
    lodge_info = None
    if user.lodge:
        lodge_info = {
            "lodge_id": user.lodge.lodge_id,
            "code":     user.lodge.code,
            "name":     user.lodge.name,
        }
    return {
        "token": token,
        "user": {
            "user_id":   user.user_id,
            "username":  user.username,
            "full_name": user.full_name,
            "role":      _role(user),
            "email":     user.email,
            "lodge_id":  user.lodge_id,
            "lodge":     lodge_info,
        }
    }


# ── Existing endpoints (unchanged) ────────────────────────────────────────

@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    lodge_info = None
    if current_user.lodge:
        lodge_info = {
            "lodge_id": current_user.lodge.lodge_id,
            "code":     current_user.lodge.code,
            "name":     current_user.lodge.name,
        }
    return {
        "user_id":      current_user.user_id,
        "username":     current_user.username,
        "full_name":    current_user.full_name,
        "role":         _role(current_user),
        "email":        current_user.email,
        "phone":        current_user.phone,
        "lodge_id":     current_user.lodge_id,
        "lodge":        lodge_info,
        "totp_enabled": bool(current_user.totp_enabled),
        "require_login_otp": bool(getattr(current_user, "require_login_otp", False)),
    }


@router.put("/change-password")
def change_password(body: ChangePasswordRequest, request: Request,
                    current_user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.old_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = db.query(User).filter(User.user_id == current_user.user_id).first()
    user.password_hash = get_password_hash(body.new_password)
    db.commit()
    try:
        log_audit(db, "auth.password_changed",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="user", entity_id=current_user.user_id,
                  lodge_id=current_user.lodge_id,
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "message": "Password changed successfully"}


@router.get("/users")
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    q = db.query(User)
    if not _is_super(current_user):
        q = q.filter(User.lodge_id == current_user.lodge_id)
    users = q.all()
    return [{
        "user_id":   u.user_id, "username": u.username, "full_name": u.full_name,
        "role":      _role(u),
        "email":     u.email,   "phone": u.phone, "is_active": u.is_active,
        "last_login": u.last_login,
        "lodge_id":  u.lodge_id,
        "lodge_name": u.lodge.name if u.lodge else None,
        "require_login_otp": bool(getattr(u, "require_login_otp", False)),
        "has_static_pin": bool(getattr(u, "static_login_pin", None)),
        "totp_enabled": bool(getattr(u, "totp_enabled", False)),
    } for u in users]


class CreateUserRequest(BaseModel):
    username:   str
    password:   str
    full_name:  str
    role:       str = "staff"
    email:      str = ""
    phone:      str = ""
    lodge_id:   Optional[int] = None
    require_login_otp: bool = False


@router.post("/users")
def create_user(body: CreateUserRequest, request: Request,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    if body.role not in ALL_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Valid: {sorted(ALL_ROLES)}")
    if body.role in SUPER_ROLES and not _is_super(current_user):
        raise HTTPException(status_code=403, detail="Only super_admin/app_owner can create privileged users")

    if _is_super(current_user):
        target_lodge_id = body.lodge_id
        if body.role not in SUPER_ROLES and target_lodge_id is None:
            raise HTTPException(status_code=400, detail="lodge_id required for non-super users")
    else:
        target_lodge_id = current_user.lodge_id

    if body.role in SUPER_ROLES:
        existing = (db.query(User)
                    .filter(User.username == body.username.lower(),
                            User.role.in_(list(SUPER_ROLES))).first())
    else:
        existing = (db.query(User)
                    .filter(User.username == body.username.lower(),
                            User.lodge_id == target_lodge_id).first())
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists in this lodge")

    user = User(
        lodge_id=target_lodge_id,
        username=body.username.lower(),
        password_hash=get_password_hash(body.password),
        full_name=body.full_name,
        role=body.role,
        email=body.email,
        phone=body.phone,
    )
    try:
        user.require_login_otp = body.require_login_otp
    except Exception:
        pass
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        log_audit(db, "user.created",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="user", entity_id=user.user_id,
                  lodge_id=target_lodge_id,
                  details={"username": user.username, "role": body.role,
                           "require_login_otp": body.require_login_otp},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"user_id": user.user_id, "username": user.username,
            "lodge_id": user.lodge_id, "message": "User created"}


class UpdateUserRequest(BaseModel):
    full_name:  Optional[str] = None
    email:      Optional[str] = None
    phone:      Optional[str] = None
    role:       Optional[str] = None
    require_login_otp: Optional[bool] = None


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserRequest, request: Request,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")

    if body.role is not None:
        if body.role not in ALL_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role. Valid: {sorted(ALL_ROLES)}")
        if body.role in SUPER_ROLES and not _is_super(current_user):
            raise HTTPException(status_code=403, detail="Only super_admin can grant elevated roles")
        if (user.user_id == current_user.user_id
                and _is_super(user) and body.role not in SUPER_ROLES):
            raise HTTPException(status_code=400, detail="Cannot demote yourself from super role")

    changed = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for k, v in changed.items():
        try:
            setattr(user, k, v)
        except Exception:
            pass
    db.commit()
    try:
        log_audit(db, "user.updated",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="user", entity_id=user.user_id,
                  lodge_id=user.lodge_id or current_user.lodge_id,
                  details={"changed": list(changed.keys()), "target": user.username},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "message": "User updated"}


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, body: ResetPasswordRequest, request: Request,
                        current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    user.password_hash   = get_password_hash(body.new_password)
    user.failed_attempts = 0
    user.locked_until    = None
    db.commit()
    try:
        log_audit(db, "user.password_reset",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="user", entity_id=user.user_id,
                  lodge_id=user.lodge_id or current_user.lodge_id,
                  details={"target": user.username},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "message": f"Password reset for {user.username}"}


@router.put("/users/{user_id}/toggle")
def toggle_user(user_id: int, request: Request,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    if user.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot toggle your own account")
    user.is_active = not user.is_active
    db.commit()
    try:
        log_audit(db, "user.toggled",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="user", entity_id=user.user_id,
                  lodge_id=user.lodge_id or current_user.lodge_id,
                  details={"target": user.username, "is_active": user.is_active},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "is_active": user.is_active}


# ── v10.0: Staff OTP management ───────────────────────────────────────────

class OtpSettingRequest(BaseModel):
    require_login_otp: bool


@router.put("/users/{user_id}/otp-setting")
def set_user_otp_requirement(user_id: int, body: OtpSettingRequest, request: Request,
                              current_user: User = Depends(get_current_user),
                              db: Session = Depends(get_db)):
    """Admin can require (or waive) OTP login for a specific staff member."""
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    try:
        user.require_login_otp = body.require_login_otp
        db.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    try:
        log_audit(db, "user.otp_setting_changed",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=user.lodge_id,
                  details={"target": user.username, "require_login_otp": body.require_login_otp},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "require_login_otp": body.require_login_otp}


# ── v2.4: TOTP (existing, unchanged) ─────────────────────────────────────

class TotpVerifyRequest(BaseModel):
    code: str


@router.post("/2fa/setup")
def totp_setup(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    from ..services.totp import generate_secret, provisioning_uri
    secret = generate_secret()
    current_user.totp_secret  = secret
    current_user.totp_enabled = False
    db.commit()
    db.refresh(current_user)
    issuer = "Rusto"
    if current_user.lodge and current_user.lodge.name:
        issuer = f"{current_user.lodge.name} (LMS)"
    return {
        "secret":           secret,
        "provisioning_uri": provisioning_uri(secret, current_user.username, issuer),
        "issuer":           issuer,
    }


@router.post("/2fa/verify")
def totp_verify(body: TotpVerifyRequest, request: Request,
                db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="No 2FA enrollment in progress.")
    from ..services.totp import verify_totp
    if not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    current_user.totp_enabled = True
    db.commit()
    try:
        log_audit(db, "auth.totp_enabled",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=current_user.lodge_id,
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True, "totp_enabled": True}


class TotpDisableRequest(BaseModel):
    password: str


@router.post("/2fa/disable")
def totp_disable(body: TotpDisableRequest, request: Request,
                 db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong password")
    current_user.totp_enabled = False
    current_user.totp_secret  = None
    db.commit()
    try:
        log_audit(db, "auth.totp_disabled",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=current_user.lodge_id,
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass
    return {"success": True}


@router.get("/2fa/status")
def totp_status(current_user=Depends(get_current_user)):
    return {
        "totp_enabled":  bool(current_user.totp_enabled),
        "totp_enrolled": bool(current_user.totp_secret),
    }


# ── v10.1: Static admin-set PIN ───────────────────────────────────────────────

class StaticPinRequest(BaseModel):
    pin: Optional[str] = None


@router.put("/users/{user_id}/static-pin")
def set_static_pin(user_id: int, body: StaticPinRequest, request: Request,
                   current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    """Admin sets a static 4-8 digit PIN that staff can use instead of live SMS OTP.
    Pass pin=null to clear. Useful when SMS is not configured."""
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")

    pin = (body.pin or "").strip() or None
    if pin and (not pin.isdigit() or not (4 <= len(pin) <= 8)):
        raise HTTPException(status_code=400, detail="PIN must be 4-8 digits")

    try:
        user.static_login_pin = pin
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        log_audit(db, "user.static_pin_changed",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=user.lodge_id,
                  details={"target": user.username, "pin_set": pin is not None},
                  ip_address=get_client_ip(request) if request else None)
    except Exception:
        pass

    return {"success": True, "pin_set": pin is not None,
            "message": "Static PIN set" if pin else "Static PIN cleared"}

