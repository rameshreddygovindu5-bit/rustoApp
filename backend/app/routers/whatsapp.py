"""WhatsApp router — v7.0.

Endpoints:

  Lodge admin:
    GET    /api/whatsapp/config              read current per-lodge config
    PATCH  /api/whatsapp/config              update (enable/disable, creds)
    POST   /api/whatsapp/test-send           send a test template to a phone
    GET    /api/whatsapp/messages            paginated message log

  Public webhook (Meta posts here):
    GET    /api/webhooks/whatsapp            verify-token handshake
    POST   /api/webhooks/whatsapp            inbound status callbacks

The webhook is shared across all lodges (Meta only supports a single
webhook URL per WABA). We discover which lodge the message belongs to
via the message_id → DB lookup, so the webhook itself doesn't need to
know about tenants.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import (Lodge, User, WhatsAppMessage, WhatsAppMessageStatus)
from ..auth import require_admin, resolve_lodge_scope
from ..services import whatsapp_service as wa
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["whatsapp"])


# ── Admin: config ─────────────────────────────────────────────────

@router.get("/api/whatsapp/config")
def get_config(lodge_id: int = Depends(resolve_lodge_scope),
                current_user: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    # Provider preview: tell the admin which transport WOULD be used if
    # they sent right now. Useful sanity check after saving credentials.
    provider = wa.get_provider_for_lodge(lodge)
    return {
        "enabled":         bool(lodge.whatsapp_enabled),
        "phone_number_id": lodge.whatsapp_phone_number_id or "",
        "display_name":    lodge.whatsapp_display_name or "",
        # Never echo the token back — admin must re-paste to change.
        "has_access_token": bool(lodge.whatsapp_access_token),
        "active_provider": provider.provider_name,
        "force_mock":       wa.FORCE_MOCK,
        # Surface the catalog so the UI can show what'll be sent.
        "templates": [
            {"key": k, "name": t["name"], "lang": t["lang"],
             "category": t["category"], "body_preview": t["body_preview"]}
            for k, t in wa.TEMPLATES.items()
        ],
    }


class ConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    phone_number_id: Optional[str] = Field(default=None, max_length=40)
    access_token: Optional[str] = Field(default=None, max_length=400)
    display_name: Optional[str] = Field(default=None, max_length=80)


@router.patch("/api/whatsapp/config")
def update_config(body: ConfigPatch, request: Request,
                    lodge_id: int = Depends(resolve_lodge_scope),
                    current_user: User = Depends(require_admin),
                    db: Session = Depends(get_db)):
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    changed = []
    if body.enabled is not None:
        lodge.whatsapp_enabled = bool(body.enabled); changed.append(f"enabled={body.enabled}")
    if body.phone_number_id is not None:
        lodge.whatsapp_phone_number_id = body.phone_number_id.strip() or None
        changed.append("phone_number_id")
    if body.access_token is not None:
        # Empty string clears, anything else stores. We never log the token value.
        tok = body.access_token.strip()
        lodge.whatsapp_access_token = tok or None
        changed.append("access_token=" + ("set" if tok else "cleared"))
    if body.display_name is not None:
        lodge.whatsapp_display_name = body.display_name.strip() or None
        changed.append("display_name")

    db.commit(); db.refresh(lodge)
    try:
        log_audit(db, "whatsapp.config_updated",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="lodge", entity_id=lodge.lodge_id,
                  lodge_id=lodge.lodge_id,
                  details={"changes": changed},
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass
    return get_config(lodge_id=lodge_id, current_user=current_user, db=db)


# ── Admin: test send ──────────────────────────────────────────────

class TestSendBody(BaseModel):
    to_phone: str
    template_key: str = "rusto_booking_confirmed"


@router.post("/api/whatsapp/test-send")
def test_send(body: TestSendBody, request: Request,
                lodge_id: int = Depends(resolve_lodge_scope),
                current_user: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    """Send a test message to a phone number with hardcoded sample params.
    Useful for verifying credentials + template approval without needing
    a real booking. Bypasses the dedup gate."""
    lodge = db.query(Lodge).filter(Lodge.lodge_id == lodge_id).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")
    if not lodge.whatsapp_enabled:
        raise HTTPException(status_code=400,
                            detail="Enable WhatsApp for this lodge first")
    phone = wa.normalize_phone_in(body.to_phone)
    if not phone:
        raise HTTPException(status_code=400, detail="Invalid phone number")
    tmpl = wa.TEMPLATES.get(body.template_key)
    if not tmpl:
        raise HTTPException(status_code=400, detail=f"Unknown template: {body.template_key}")

    # Sample params per template — must match the param order in the catalog.
    sample = {
        "rusto_booking_confirmed": ["RB-TEST-0001", lodge.name, "2026-06-15", 4500],
        "rusto_payment_pending":   ["RB-TEST-0001", lodge.name, 4500, "https://rusto.app/pay/RB-TEST-0001"],
        "rusto_checkin_reminder":  [lodge.name, "2026-06-15",
                                     lodge.address or "Sample address, Hyderabad",
                                     lodge.phone or "9999999999"],
        "rusto_review_request":    [lodge.name, "https://rusto.app/review/test"],
    }.get(body.template_key, [])

    msg = wa._send_template(
        db, lodge=lodge, customer=None, to_phone=phone,
        template_key=body.template_key, params=sample,
        reason="test_send",
    )
    try:
        log_audit(db, "whatsapp.test_send",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="whatsapp_message", entity_id=msg.message_id,
                  lodge_id=lodge.lodge_id,
                  details={"to_phone_last4": phone[-4:],
                           "template": body.template_key,
                           "status": msg.status},
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass
    return _msg_dict(msg)


# ── Admin: message log ────────────────────────────────────────────

def _msg_dict(m: WhatsAppMessage) -> dict:
    return {
        "message_id":          m.message_id,
        "to_phone":             m.to_phone,
        "to_phone_masked":      _mask_phone(m.to_phone),
        "template_name":        m.template_name,
        "template_category":    m.template_category,
        "reason":               m.reason,
        "related_booking_id":   m.related_booking_id,
        "related_review_id":    m.related_review_id,
        "status":               m.status,
        "provider":             m.provider,
        "provider_message_id":  m.provider_message_id,
        "error_code":           m.error_code,
        "error_detail":         m.error_detail,
        "created_at":           m.created_at.isoformat() if m.created_at else None,
        "sent_at":              m.sent_at.isoformat() if m.sent_at else None,
        "delivered_at":         m.delivered_at.isoformat() if m.delivered_at else None,
        "read_at":              m.read_at.isoformat() if m.read_at else None,
    }


def _mask_phone(p: str) -> str:
    """Show last 4 digits only for the admin UI (e.g., ******6789)."""
    if not p or len(p) < 4:
        return "****"
    return ("*" * (len(p) - 4)) + p[-4:]


@router.get("/api/whatsapp/messages")
def list_messages(
    status: Optional[str] = None,
    reason: Optional[str] = None,
    booking_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    lodge_id: int = Depends(resolve_lodge_scope),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(WhatsAppMessage).filter(WhatsAppMessage.lodge_id == lodge_id)
    if status:
        q = q.filter(WhatsAppMessage.status == status)
    if reason:
        q = q.filter(WhatsAppMessage.reason == reason)
    if booking_id:
        q = q.filter(WhatsAppMessage.related_booking_id == booking_id)
    total = q.count()
    rows = (q.order_by(WhatsAppMessage.created_at.desc())
              .offset((page - 1) * page_size).limit(page_size).all())

    # Summary tiles for the header.
    summary_rows = (db.query(WhatsAppMessage.status,
                                __import__("sqlalchemy").func.count())
                     .filter(WhatsAppMessage.lodge_id == lodge_id,
                             WhatsAppMessage.created_at >=
                               datetime.utcnow() - timedelta(days=30))
                     .group_by(WhatsAppMessage.status).all())
    summary = {s.value: 0 for s in WhatsAppMessageStatus}
    for s, c in summary_rows:
        if s in summary:
            summary[s] = c
    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "messages":  [_msg_dict(m) for m in rows],
        "summary_last_30d": summary,
    }


# ── Webhook: Meta callbacks ───────────────────────────────────────

@router.get("/api/webhooks/whatsapp")
def webhook_verify(
    mode: str = Query(..., alias="hub.mode"),
    token: str = Query(..., alias="hub.verify_token"),
    challenge: str = Query(..., alias="hub.challenge"),
):
    """Meta's GET handshake when you register the webhook URL. We accept
    the challenge if the verify_token matches our configured value."""
    if mode == "subscribe" and token == wa.WEBHOOK_VERIFY_TOKEN:
        # Meta wants the challenge echoed back as plain text.
        return int(challenge) if challenge.isdigit() else challenge
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/api/webhooks/whatsapp")
async def webhook_status(request: Request, db: Session = Depends(get_db)):
    """Meta posts here when a message changes status (sent/delivered/read)
    or when a recipient sends us a reply. We currently only process
    statuses; inbound messages are accepted + ignored (a future round
    could wire up customer-initiated conversations).

    The payload structure is:
      {
        "entry": [{
          "changes": [{
            "value": {
              "statuses": [
                { "id": "wamid.XXX", "status": "delivered",
                  "timestamp": "1700000000",
                  "errors": [...]   # only on failure
                }
              ]
            }
          }]
        }]
      }
    """
    try:
        payload = await request.json()
    except Exception:
        # Meta sometimes POSTs empty bodies for keepalive — accept gracefully.
        return {"ok": True}

    updated = 0
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            val = change.get("value") or {}
            for s in val.get("statuses") or []:
                mid    = s.get("id")
                status = s.get("status")
                ts     = s.get("timestamp")
                err_obj = (s.get("errors") or [{}])[0] if s.get("errors") else {}
                err_code = str(err_obj.get("code")) if err_obj.get("code") else None
                err_msg  = err_obj.get("message") or err_obj.get("title")
                # Meta-status → our enum (their "sent"/"delivered"/"read" line up;
                # "failed" gets routed via the errors[] presence).
                our_status = (
                    WhatsAppMessageStatus.failed.value if err_code
                    else status if status in {
                        WhatsAppMessageStatus.sent.value,
                        WhatsAppMessageStatus.delivered.value,
                        WhatsAppMessageStatus.read.value,
                    } else None
                )
                if not (mid and our_status):
                    continue
                try:
                    when = datetime.utcfromtimestamp(int(ts)) if ts else None
                except (TypeError, ValueError):
                    when = None
                if wa.apply_status_update(
                    db, provider_message_id=mid, new_status=our_status,
                    timestamp=when, error_code=err_code, error_detail=err_msg,
                ):
                    updated += 1
    return {"ok": True, "updated": updated}
