from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
from ..database import get_db
from ..models import User, LoginAttempt
from ..auth import verify_password, get_password_hash, create_access_token, get_current_user
from ..services.audit_service import log_audit
import os

router = APIRouter(prefix="/api/auth", tags=["auth"])
MAX_ATTEMPTS = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
LOCKOUT_MINUTES = 15


class LoginRequest(BaseModel):
    username: str
    password: str
    # v2.4: TOTP code from the user's authenticator app. Optional in the
    # request — if the account has 2FA enabled and this is missing/wrong,
    # the login returns a special 401 with detail="totp_required" so the
    # UI can show the code-entry prompt.
    totp_code: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"

    # Log attempt
    attempt = LoginAttempt(username=body.username, ip_address=ip)
    db.add(attempt)

    user = db.query(User).filter(User.username == body.username.lower().strip()).first()

    # Check lockout
    if user and user.locked_until and user.locked_until > datetime.utcnow():
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account locked. Try again after {user.locked_until.strftime('%H:%M:%S')}"
        )

    if not user or not verify_password(body.password, user.password_hash):
        if user:
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= MAX_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_attempts = 0
        attempt.success = False
        db.commit()
        # Audit the failed login so brute-force attempts are visible in the
        # audit log. We don't have a user lodge for unknown usernames, so we
        # let log_audit's fallback (lodge 1) handle it.
        try:
            log_audit(
                db, "auth.login_failed", actor_username=body.username,
                lodge_id=user.lodge_id if user else None,
                details={"reason": "invalid_credentials" if user else "unknown_user"},
                ip_address=ip,
            )
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    if not user.is_active:
        db.commit()
        try:
            log_audit(
                db, "auth.login_blocked",
                actor_user_id=user.user_id, actor_username=user.username,
                lodge_id=user.lodge_id, details={"reason": "inactive"}, ip_address=ip,
            )
        except Exception:
            pass
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    # v2.4: enforce 2FA if enrolled. We do this AFTER password verification
    # (so a wrong password still returns "invalid credentials" not "need
    # 2FA" — which would leak whether 2FA is enabled for that account).
    if user.totp_enabled and user.totp_secret:
        from ..services.totp import verify_totp
        if not body.totp_code:
            # Don't increment failed_attempts here — the password was right;
            # the user just needs to provide the second factor.
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="totp_required")
        if not verify_totp(user.totp_secret, body.totp_code):
            # Wrong TOTP DOES count as a failed attempt — protects against
            # brute-forcing the 6-digit code (one of a million tries).
            user.failed_attempts = (user.failed_attempts or 0) + 1
            if user.failed_attempts >= MAX_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_attempts = 0
            db.commit()
            try:
                log_audit(db, "auth.login_failed",
                          actor_user_id=user.user_id, actor_username=user.username,
                          lodge_id=user.lodge_id,
                          details={"reason": "invalid_totp"}, ip_address=ip)
            except Exception:
                pass
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="Invalid authentication code")

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login = datetime.utcnow()
    attempt.success = True
    db.commit()

    try:
        log_audit(
            db, "auth.login",
            actor_user_id=user.user_id, actor_username=user.username,
            lodge_id=user.lodge_id, ip_address=ip,
        )
    except Exception:
        pass

    token = create_access_token({
        "sub": str(user.user_id),
        "role": getattr(user.role, "value", user.role),
        "lodge_id": user.lodge_id,
    })
    # Fetch lodge display details so the frontend can show the right banner
    # right after login (avoids a follow-up /lodges/me call).
    lodge_info = None
    if user.lodge:
        lodge_info = {
            "lodge_id": user.lodge.lodge_id,
            "code": user.lodge.code,
            "name": user.lodge.name,
        }
    return {
        "token": token,
        "user": {
            "user_id": user.user_id,
            "username": user.username,
            "full_name": user.full_name,
            "role": getattr(user.role, "value", user.role),
            "email": user.email,
            "lodge_id": user.lodge_id,
            "lodge": lodge_info,
        }
    }


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    return {"success": True, "message": "Logged out successfully"}


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    lodge_info = None
    if current_user.lodge:
        lodge_info = {
            "lodge_id": current_user.lodge.lodge_id,
            "code": current_user.lodge.code,
            "name": current_user.lodge.name,
        }
    return {
        "user_id": current_user.user_id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "role": getattr(current_user.role, "value", current_user.role),
        "email": current_user.email,
        "phone": current_user.phone,
        "lodge_id": current_user.lodge_id,
        "lodge": lodge_info,
        # v2.4: tells the frontend whether the Profile page should show
        # "Set up 2FA" or "Disable 2FA".
        "totp_enabled": bool(current_user.totp_enabled),
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
        log_audit(
            db, "auth.password_changed",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="user", entity_id=current_user.user_id,
            lodge_id=current_user.lodge_id,
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": "Password changed successfully"}


def _is_super(u: User) -> bool:
    return getattr(u.role, 'value', u.role) == "super_admin"


def _is_admin_or_super(u: User) -> bool:
    return getattr(u.role, 'value', u.role) in ("admin", "super_admin")


@router.get("/users")
def list_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    q = db.query(User)
    # Tenant admin: only their own lodge's users.
    if not _is_super(current_user):
        q = q.filter(User.lodge_id == current_user.lodge_id)
    users = q.all()
    return [{
        "user_id": u.user_id, "username": u.username, "full_name": u.full_name,
        "role": getattr(u.role, 'value', u.role),
        "email": u.email, "phone": u.phone, "is_active": u.is_active,
        "last_login": u.last_login,
        "lodge_id": u.lodge_id,
        "lodge_name": u.lodge.name if u.lodge else None,
    } for u in users]


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "staff"
    email: str = ""
    phone: str = ""
    # Only honoured for super_admin. Tenant admins always create users in
    # their own lodge — any value they send is ignored.
    lodge_id: Optional[int] = None


@router.post("/users")
def create_user(body: CreateUserRequest, request: Request,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    if body.role not in ("staff", "admin", "super_admin"):
        raise HTTPException(status_code=400, detail="Invalid role")
    # Only super_admin can create another super_admin.
    if body.role == "super_admin" and not _is_super(current_user):
        raise HTTPException(status_code=403, detail="Only super_admin can create super_admin users")

    # Determine target lodge.
    if _is_super(current_user):
        target_lodge_id = body.lodge_id  # may be None for a super_admin user
        if body.role != "super_admin" and target_lodge_id is None:
            raise HTTPException(status_code=400,
                                detail="lodge_id is required for admin/staff users")
    else:
        # Tenant admin: lodge is locked to their own, regardless of what was sent.
        target_lodge_id = current_user.lodge_id

    # Per-lodge username uniqueness check. Two lodges may have a 'manager';
    # we only conflict within the same target lodge (or globally for
    # super_admin role since super_admins have lodge_id NULL).
    if body.role == "super_admin":
        existing = (db.query(User)
                    .filter(User.username == body.username.lower(),
                            User.role == "super_admin").first())
    else:
        existing = (db.query(User)
                    .filter(User.username == body.username.lower(),
                            User.lodge_id == target_lodge_id).first())
    if existing:
        raise HTTPException(status_code=400,
                            detail="Username already exists in this lodge")
    user = User(
        lodge_id=target_lodge_id,
        username=body.username.lower(),
        password_hash=get_password_hash(body.password),
        full_name=body.full_name,
        role=body.role,
        email=body.email,
        phone=body.phone
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        log_audit(
            db, "user.created",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="user", entity_id=user.user_id,
            lodge_id=target_lodge_id,
            details={"username": user.username, "role": body.role,
                     "target_lodge_id": target_lodge_id},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"user_id": user.user_id, "username": user.username,
            "lodge_id": user.lodge_id, "message": "User created"}


class UpdateUserRequest(BaseModel):
    """Admin-driven user edit. Username and password are intentionally NOT
    editable here — change-password is a separate endpoint, and usernames
    are stable identifiers used in audit logs and FKs."""
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UpdateUserRequest, request: Request,
                current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    """Edit another user's profile. Tenant admin can only edit users within
    their own lodge; super_admin can edit anyone."""
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    # Role changes have extra rules: only super_admin can grant or revoke
    # the super_admin role (no foot-gunning yourself into losing the only
    # cross-tenant admin).
    if body.role is not None:
        if body.role not in ("staff", "admin", "super_admin"):
            raise HTTPException(status_code=400, detail="Invalid role")
        if body.role == "super_admin" and not _is_super(current_user):
            raise HTTPException(status_code=403,
                                detail="Only super_admin can grant super_admin role")
        # Don't let the last super_admin demote themselves and lock everyone out.
        if (user.user_id == current_user.user_id
                and _is_super(user) and body.role != "super_admin"):
            raise HTTPException(status_code=400,
                                detail="A super_admin cannot demote themselves")

    changed = body.dict(exclude_unset=True)
    for k, v in changed.items():
        setattr(user, k, v)
    db.commit()
    try:
        log_audit(
            db, "user.updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="user", entity_id=user.user_id,
            lodge_id=user.lodge_id or current_user.lodge_id,
            details={"changed": list(changed.keys()),
                     "target_username": user.username},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": "User updated"}


class ResetPasswordRequest(BaseModel):
    new_password: str


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, body: ResetPasswordRequest, request: Request,
                        current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Admin-driven password reset (no need to know the user's old password).

    This is for the case where a staff member forgot their password and the
    admin needs to set a new one for them. The audit log records the action
    but NEVER stores the new password.
    """
    if not _is_admin_or_super(current_user):
        raise HTTPException(status_code=403, detail="Admin only")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    user = db.query(User).filter(User.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    # Reset the lockout too — otherwise the user couldn't actually sign in
    # right after the admin reset their password.
    user.password_hash = get_password_hash(body.new_password)
    user.failed_attempts = 0
    user.locked_until = None
    db.commit()
    try:
        log_audit(
            db, "user.password_reset",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="user", entity_id=user.user_id,
            lodge_id=user.lodge_id or current_user.lodge_id,
            details={"target_username": user.username},
            ip_address=request.client.host if request and request.client else None,
        )
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
    # Tenant admin can only toggle users in their own lodge.
    if not _is_super(current_user) and user.lodge_id != current_user.lodge_id:
        raise HTTPException(status_code=403, detail="Cannot manage a user from another lodge")
    # Don't let anyone disable their own account by accident.
    if user.user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Cannot toggle your own account")
    user.is_active = not user.is_active
    db.commit()
    try:
        log_audit(
            db, "user.toggled",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="user", entity_id=user.user_id,
            lodge_id=user.lodge_id or current_user.lodge_id,
            details={"target_username": user.username, "is_active": user.is_active},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "is_active": user.is_active}


# ── v2.4: Two-factor authentication (TOTP) ─────────────────────────────

class TotpVerifyRequest(BaseModel):
    code: str


@router.post("/2fa/setup")
def totp_setup(db: Session = Depends(get_db),
                current_user=Depends(get_current_user)):
    """Begin TOTP enrollment. Generates a fresh secret AND saves it on the
    user, but leaves `totp_enabled=False`. The frontend renders the
    provisioning URI as a QR code; the user scans it with their app then
    confirms by calling /2fa/verify with a current code.

    Calling this on an already-enabled account REPLACES the secret —
    intentional, to support "re-enrol" flows when the user loses their
    phone (admin disables, user re-enrols from scratch).
    """
    from ..services.totp import generate_secret, provisioning_uri
    secret = generate_secret()
    current_user.totp_secret = secret
    # Note: we deliberately do NOT set totp_enabled=True yet — that flips
    # only after the user proves they can produce a valid code.
    current_user.totp_enabled = False
    db.commit()
    db.refresh(current_user)
    issuer = "Rusto"
    if current_user.lodge and current_user.lodge.name:
        issuer = f"{current_user.lodge.name} (LMS)"
    return {
        "secret": secret,
        "provisioning_uri": provisioning_uri(secret, current_user.username, issuer),
        "issuer": issuer,
    }


@router.post("/2fa/verify")
def totp_verify(body: TotpVerifyRequest, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(get_current_user)):
    """Confirm enrollment — checks the code against the secret saved by
    /2fa/setup, and on success sets totp_enabled=True. Subsequent logins
    will then require a TOTP code."""
    if not current_user.totp_secret:
        raise HTTPException(status_code=400,
                            detail="No 2FA enrollment in progress. Call /2fa/setup first.")
    from ..services.totp import verify_totp
    if not verify_totp(current_user.totp_secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    current_user.totp_enabled = True
    db.commit()
    try:
        log_audit(db, "auth.totp_enabled",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=current_user.lodge_id,
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True, "totp_enabled": True}


class TotpDisableRequest(BaseModel):
    """Disabling 2FA requires the current password — a stolen session
    cookie alone shouldn't be enough to turn off this safeguard."""
    password: str


@router.post("/2fa/disable")
def totp_disable(body: TotpDisableRequest, request: Request,
                  db: Session = Depends(get_db),
                  current_user=Depends(get_current_user)):
    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong password")
    current_user.totp_enabled = False
    current_user.totp_secret = None
    db.commit()
    try:
        log_audit(db, "auth.totp_disabled",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  lodge_id=current_user.lodge_id,
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True}


@router.get("/2fa/status")
def totp_status(current_user=Depends(get_current_user)):
    """Used by the Profile / Security page to show enrollment state."""
    return {
        "totp_enabled": bool(current_user.totp_enabled),
        "totp_enrolled": bool(current_user.totp_secret),
    }
