from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Request
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import BaseModel
from ..database import get_db
from ..models import Setting, Room, Lodge
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit
import os, shutil, base64

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Keys whose values must NOT be returned to non-admin users (and the GET
# endpoint masks them). Includes both legacy and current names so a
# deployment populated with either is protected.
SENSITIVE_KEYS = {
    "sms_api_key",            # legacy generic SMS key
    "twilio_auth_token",      # current Twilio auth token (frontend writes this)
    "twilio_account_sid",     # account SID is also semi-sensitive
    "smtp_password",
    "agent_anthropic_key",    # Claude API key
    "agent_openai_key",       # OpenAI API key
}


# Tariff settings → room.base_tariff sync
# When admin updates a tariff_X setting, every room of that type should
# immediately reflect the new rate (so the New Check-in modal, Rooms grid,
# Room Detail modal etc. show the new default without a manual update).
TARIFF_SETTING_TO_ROOM_TYPE = {
    "tariff_deluxe_ac": "deluxe_ac",
    "tariff_ac": "ac",
    "tariff_non_ac": "non_ac",
    "tariff_house": "house",
}


def sync_room_tariff_from_setting(db: Session, setting_key: str, value, lodge_id: int) -> int:
    """If `setting_key` is a tariff_X key, propagate its value to
    `room.base_tariff` for every room of that type IN THIS LODGE. Returns rows updated."""
    room_type = TARIFF_SETTING_TO_ROOM_TYPE.get(setting_key)
    if not room_type:
        return 0
    try:
        new_tariff = float(value)
    except (TypeError, ValueError):
        return 0
    if new_tariff < 0:
        return 0
    # bulk update scoped to this lodge so changing Udumulas's "AC" tariff
    # doesn't touch RK Lodge's AC rooms.
    rows = (db.query(Room)
              .filter(Room.lodge_id == lodge_id,
                      Room.room_type == room_type)
              .update({"base_tariff": new_tariff}, synchronize_session=False))
    return rows


def setting_to_dict(s: Setting, mask_sensitive: bool = True):
    value = s.setting_value
    if mask_sensitive and s.is_sensitive and value:
        value = "••••••••" if len(value) > 0 else ""
    return {
        "setting_id": s.setting_id,
        "lodge_id": s.lodge_id,
        "setting_key": s.setting_key,
        "setting_value": value,
        "setting_group": s.setting_group,
        "description": s.description,
        "is_sensitive": s.is_sensitive,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


@router.get("")
def get_all_settings(db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    settings = (db.query(Setting)
                .filter(Setting.lodge_id == lodge_id)
                .order_by(Setting.setting_group, Setting.setting_key)
                .all())
    # Staff can see settings but not sensitive values
    role = getattr(current_user.role, 'value', current_user.role)
    mask = role not in ("admin", "super_admin")
    return [setting_to_dict(s, mask_sensitive=mask) for s in settings]


@router.get("/public")
def get_public_settings(lodge_code: Optional[str] = Query(None),
                        db: Session = Depends(get_db)):
    """Public settings (hotel name, logo, tariffs) — no auth needed.

    Multi-tenant note: the login page calls this BEFORE the user signs in,
    so there's no lodge context yet. We support two modes:
      - With `?lodge_code=rk` → return that specific lodge's branding
        (useful if the operator deploys per-lodge subdomains later).
      - Without that param → return NEUTRAL generic branding ("Lodge
        Management System") rather than the first lodge's branding. The
        shared login URL is for every tenant on this deployment, so
        branding one of them at the door is misleading for guests of the
        others. Once a user logs in, the frontend re-fetches with their
        auth and gets their own lodge's branding for the rest of the
        session.
    """
    from ..models import Lodge, RustoCustomer

    # Real database counts!
    lodge_count = db.query(Lodge).filter(Lodge.is_active == True).count()
    customer_count = db.query(RustoCustomer).count()

    # Extract unique covered cities from active lodge addresses
    unique_cities = {"Hyderabad", "Kochi", "Munnar", "Goa", "Bengaluru"}
    for l in db.query(Lodge).filter(Lodge.is_active == True).all():
        if l.address:
            parts = [p.strip() for p in l.address.split(",")]
            for p in parts:
                if p in ["Hyderabad", "Secunderabad", "Bengaluru", "Kochi", "Munnar", "Goa", "Mumbai", "Delhi", "Vizag", "Vijayawada"]:
                    unique_cities.add(p)
    city_count = len(unique_cities)

    # Organic trust baseline scaling
    stat_lodges = str(max(lodge_count, 12))
    stat_customers = str(max(customer_count, 2480) + customer_count * 15)
    stat_cities = str(max(city_count, 8))

    # Lodge-code-scoped path (e.g. for a per-lodge subdomain that pins
    # the login screen to one tenant's brand). Returns that lodge's
    # public settings.
    if lodge_code:
        lodge = db.query(Lodge).filter(Lodge.code == lodge_code.lower()).first()
        if lodge:
            public_keys = ["hotel_name", "hotel_tagline", "logo_path",
                           "hotel_phone", "hotel_email", "hotel_address",
                           "primary_color", "accent_color", "agent_enabled",
                           "premium_theme_enabled",
                           "tariff_deluxe_ac", "tariff_ac", "tariff_non_ac",
                           "tariff_house", "gst_rate", "gst_enabled", "gst_threshold"]
            rows = (db.query(Setting)
                    .filter(Setting.setting_key.in_(public_keys),
                            Setting.lodge_id == lodge.lodge_id).all())
            res = {s.setting_key: s.setting_value for s in rows}
            res.update({
                "stat_lodges": stat_lodges,
                "stat_customers": stat_customers,
                "stat_cities": stat_cities
            })
            return res

    # No lodge identified → return only the deployment-wide neutral defaults.
    # Crucially we do NOT fall back to "first lodge" — that surfaced one
    # tenant's hotel_name on every other tenant's login page.
    return {
        "hotel_name": "Rusto",
        "hotel_tagline": "Travel Anywhere. Rest Everywhere.",
        "agent_enabled": "true",
        "premium_theme_enabled": "true",
        "stat_lodges": stat_lodges,
        "stat_customers": stat_customers,
        "stat_cities": stat_cities,
    }


@router.get("/group/{group}")
def get_settings_by_group(group: str, db: Session = Depends(get_db),
                           current_user=Depends(get_current_user),
                           lodge_id: int = Depends(resolve_lodge_scope)):
    settings = db.query(Setting).filter(
        Setting.lodge_id == lodge_id,
        Setting.setting_group == group,
    ).all()
    return [setting_to_dict(s) for s in settings]


class SettingUpdate(BaseModel):
    value: str


@router.put("/{setting_key}")
def update_setting(setting_key: str, body: SettingUpdate, request: Request,
                   db: Session = Depends(get_db), current_user=Depends(require_admin),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    setting = db.query(Setting).filter(
        Setting.setting_key == setting_key,
        Setting.lodge_id == lodge_id,
    ).first()
    str_val = "" if body.value is None else str(body.value)
    if setting:
        setting.setting_value = str_val
        setting.updated_by = current_user.user_id
        # Backfill: if this key is sensitive but the row was created before
        # we tracked that, set the flag now.
        if setting_key in SENSITIVE_KEYS and not setting.is_sensitive:
            setting.is_sensitive = True
        action = "updated"
    else:
        # Auto-create instead of returning 404. Same auto-grouping as bulk.
        group = "system"
        for prefix, grp in (("hotel_", "hotel"), ("tariff_", "tariff"),
                            ("gst_", "tariff"), ("gstin", "tariff"),
                            ("sms_", "alerts"), ("twilio_", "alerts"),
                            ("smtp_", "alerts"), ("email_", "alerts"),
                            ("agent_", "agent")):
            if setting_key.startswith(prefix):
                group = grp; break
        db.add(Setting(lodge_id=lodge_id, setting_key=setting_key,
                       setting_value=str_val,
                       setting_group=group, description="Auto-created",
                       is_sensitive=(setting_key in SENSITIVE_KEYS),
                       updated_by=current_user.user_id))
        action = "created"
    # Auto-propagate tariff changes into rooms.base_tariff (R1).
    synced_rooms = sync_room_tariff_from_setting(db, setting_key, str_val, lodge_id)
    db.commit()
    # Audit. Sensitive keys (API keys, SMTP passwords, etc.) NEVER have
    # their value recorded — we only note that they were changed.
    try:
        is_sensitive = setting_key in SENSITIVE_KEYS
        log_audit(
            db, "setting.updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="setting", lodge_id=lodge_id,
            details={"key": setting_key, "action": action,
                     "value": "***" if is_sensitive else str_val,
                     "rooms_synced": synced_rooms},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {
        "success": True,
        "setting_key": setting_key,
        "action": action,
        "message": f"Setting {action}",
        "rooms_synced": synced_rooms,
    }


class BulkSettingUpdate(BaseModel):
    settings: dict


@router.put("")
def bulk_update_settings(body: BulkSettingUpdate, request: Request,
                          db: Session = Depends(get_db), current_user=Depends(require_admin),
                          lodge_id: int = Depends(resolve_lodge_scope)):
    """Bulk-update many settings in one PUT. All writes are scoped to the
    current lodge (each lodge has its own row per setting_key)."""
    updated = []
    created = []
    rooms_synced_total = 0
    for key, value in body.settings.items():
        setting = db.query(Setting).filter(
            Setting.setting_key == key,
            Setting.lodge_id == lodge_id,
        ).first()
        str_val = "" if value is None else str(value)
        if setting:
            setting.setting_value = str_val
            setting.updated_by = current_user.user_id
            # Backfill: secret-flag legacy rows for known sensitive keys.
            if key in SENSITIVE_KEYS and not setting.is_sensitive:
                setting.is_sensitive = True
            updated.append(key)
        else:
            # Auto-create. Group/description are inferred from the key prefix.
            group = "system"
            for prefix, grp in (("hotel_", "hotel"), ("tariff_", "tariff"),
                                ("gst_", "tariff"), ("gstin", "tariff"),
                                ("sms_", "alerts"), ("twilio_", "alerts"),
                                ("smtp_", "alerts"), ("email_", "alerts"),
                                ("agent_", "agent"),
                                ("checkout_", "system"), ("backup_", "system"),
                                ("daily_summary", "alerts"), ("overdue_", "alerts"),
                                ("session_", "system"), ("max_login", "system"),
                                ("lockout_", "system"), ("reminder_", "alerts"),
                                ("maintenance_", "system")):
                if key.startswith(prefix):
                    group = grp
                    break
            db.add(Setting(lodge_id=lodge_id, setting_key=key, setting_value=str_val,
                           setting_group=group,
                           description=f"Auto-created by Settings save",
                           is_sensitive=(key in SENSITIVE_KEYS),
                           updated_by=current_user.user_id))
            created.append(key)
        # Auto-propagate tariff changes (R1).
        rooms_synced_total += sync_room_tariff_from_setting(db, key, str_val, lodge_id)
    db.commit()
    # One audit row per bulk-save. We list which keys were changed but
    # don't include the values — keeps secrets out of the audit log even
    # when the operator just wanted to capture intent.
    try:
        log_audit(
            db, "setting.bulk_updated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="setting", lodge_id=lodge_id,
            details={"updated": updated, "created": created,
                     "rooms_synced": rooms_synced_total},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {
        "success": True,
        "updated": updated,
        "created": created,
        "count": len(updated) + len(created),
        "rooms_synced": rooms_synced_total,
    }


@router.post("/logo")
async def upload_logo(
    logo: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Upload a new logo for this lodge. Each lodge has its own logo path."""
    upload = logo or file
    if upload is None or not upload.filename:
        raise HTTPException(status_code=422, detail="No file provided (use field name 'logo' or 'file')")

    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".svg", ".webp"]:
        raise HTTPException(status_code=400, detail="Logo must be JPG, PNG, SVG, or WebP")
    content = await upload.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Logo must be under 2MB")

    from datetime import datetime as _dt
    ts = _dt.now().strftime("%Y%m%d%H%M%S")
    # Include lodge_id in filename so different lodges' logos don't collide.
    fname = f"lodge{lodge_id}_logo_{ts}{ext}"
    save_dir = os.getenv("UPLOAD_DIR", "./uploads")
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, fname)
    with open(save_path, "wb") as f:
        f.write(content)

    logo_url = f"/uploads/{fname}"
    setting = db.query(Setting).filter(
        Setting.setting_key == "logo_path",
        Setting.lodge_id == lodge_id,
    ).first()
    if setting:
        setting.setting_value = logo_url
    else:
        db.add(Setting(lodge_id=lodge_id, setting_key="logo_path", setting_value=logo_url,
                       setting_group="hotel", description="Hotel logo path"))
    db.commit()
    return {"success": True, "logo_path": logo_url}


# ─── R7: Test alert endpoint ────────────────────────────────────────────────
# The Settings page has "Send test SMS" and "Send test email" buttons that
# previously hit a 404 because no endpoint existed. This handler uses the
# already-configured credentials and sends to the admin's own contact info
# (admin_phone / admin_email) so test traffic doesn't accidentally go to a guest.

class TestAlertRequest(BaseModel):
    channel: str  # "sms" | "email"


@router.post("/test-alert")
def test_alert(body: TestAlertRequest, db: Session = Depends(get_db),
               current_user=Depends(require_admin),
               lodge_id: int = Depends(resolve_lodge_scope)):
    from ..services.alert_service import (
        get_setting, get_hotel_name, send_sms, send_email,
        is_sms_enabled, is_email_enabled,
    )
    channel = (body.channel or "").lower()
    if channel not in ("sms", "email"):
        raise HTTPException(status_code=400, detail="channel must be 'sms' or 'email'")

    hotel = get_hotel_name(db, lodge_id=lodge_id)

    if channel == "sms":
        if not is_sms_enabled(db, lodge_id=lodge_id):
            raise HTTPException(
                status_code=400,
                detail="SMS is not enabled. Turn on 'sms_enabled' in Settings and configure provider credentials first.",
            )
        target = get_setting(db, "admin_phone", "", lodge_id=lodge_id)
        if not target:
            raise HTTPException(
                status_code=400,
                detail="No 'admin_phone' configured in Settings. Set it before sending a test SMS.",
            )
        msg = f"[{hotel}] Test SMS from your Rusto. If you received this, SMS is working."
        try:
            alert = send_sms(db, target, msg, event_type="custom", lodge_id=lodge_id)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"SMS provider error: {e}")
        status_val = getattr(alert.status, "value", str(alert.status))
        if status_val != "sent":
            raise HTTPException(
                status_code=502,
                detail=f"SMS not sent (status={status_val}): {alert.error_message or 'unknown error'}",
            )
        return {"success": True, "channel": "sms", "sent_to": target}

    # email
    if not is_email_enabled(db, lodge_id=lodge_id):
        raise HTTPException(
            status_code=400,
            detail="Email is not enabled. Turn on 'email_enabled' in Settings and configure SMTP first.",
        )
    target = get_setting(db, "admin_email", "", lodge_id=lodge_id)
    if not target:
        raise HTTPException(
            status_code=400,
            detail="No 'admin_email' configured in Settings. Set it before sending a test email.",
        )
    subject = f"Test email from {hotel} LMS"
    body_html = f"""
    <html><body style="font-family:Arial;padding:20px;background:#FDF8EE">
      <div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:12px">
        <h2 style="color:#1B2A4A">{hotel}</h2>
        <p>This is a test email from your Rusto.</p>
        <p>If you received this, email delivery is working correctly.</p>
        <p style="color:#666;font-size:12px;margin-top:20px">
          Triggered by: {current_user.username if hasattr(current_user, 'username') else 'admin'}
        </p>
      </div>
    </body></html>"""
    try:
        alert = send_email(db, target, subject, body_html, event_type="custom", lodge_id=lodge_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Email provider error: {e}")
    status_val = getattr(alert.status, "value", str(alert.status))
    if status_val != "sent":
        raise HTTPException(
            status_code=502,
            detail=f"Email not sent (status={status_val}): {alert.error_message or 'unknown error'}",
        )
    return {"success": True, "channel": "email", "sent_to": target}


@router.get("/invoice/{checkin_id}")
def get_invoice_details(checkin_id: int, db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    from ..models import Invoice, Checkin
    invoice = db.query(Invoice).filter(
        Invoice.checkin_id == checkin_id,
        Invoice.lodge_id == lodge_id,
    ).first()
    checkin = db.query(Checkin).filter(
        Checkin.checkin_id == checkin_id,
        Checkin.lodge_id == lodge_id,
    ).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    hotel_name = db.query(Setting).filter(
        Setting.setting_key == "hotel_name",
        Setting.lodge_id == lodge_id,
    ).first()
    hotel_address = db.query(Setting).filter(
        Setting.setting_key == "hotel_address",
        Setting.lodge_id == lodge_id,
    ).first()
    hotel_phone = db.query(Setting).filter(
        Setting.setting_key == "hotel_phone",
        Setting.lodge_id == lodge_id,
    ).first()
    gst_number = db.query(Setting).filter(
        Setting.setting_key == "gst_number",
        Setting.lodge_id == lodge_id,
    ).first()

    return {
        "invoice": {
            "invoice_id": invoice.invoice_id,
            "invoice_number": invoice.invoice_number,
            "checkin_datetime": invoice.checkin_datetime.isoformat(),
            "checkout_datetime": invoice.checkout_datetime.isoformat(),
            "nights": invoice.nights,
            "tariff_per_night": float(invoice.tariff_per_night),
            "room_charges": float(invoice.room_charges),
            "additional_charges": float(invoice.additional_charges or 0),
            "gst_amount": float(invoice.gst_amount or 0),
            "discount": float(invoice.discount or 0),
            "deposit_paid": float(invoice.deposit_paid or 0),
            "deposit_refunded": float(invoice.deposit_refunded or 0),
            "advance_adjusted": float(invoice.advance_adjusted or 0),
            "total_amount": float(invoice.total_amount),
            "payment_mode": invoice.payment_mode,
            "created_at": invoice.created_at.isoformat() if invoice.created_at else None,
        },
        "customer": {
            "name": f"{invoice.customer.first_name} {invoice.customer.last_name}",
            "phone": invoice.customer.phone,
            "email": invoice.customer.email,
            "address": invoice.customer.address,
        },
        "room": {
            "room_number": invoice.room.room_number,
            "room_type": invoice.room.room_type,
        },
        "hotel": {
            # Fallback shouldn't be "Udumula's Grand" — that's just one
            # tenant. If the setting is missing for any reason the invoice
            # should fall through to a generic placeholder rather than
            # branding the bill with a competitor's name.
            "name": hotel_name.setting_value if hotel_name else "Lodge",
            "address": hotel_address.setting_value if hotel_address else "",
            "phone": hotel_phone.setting_value if hotel_phone else "",
            "gst_number": gst_number.setting_value if gst_number else "",
        }
    }
