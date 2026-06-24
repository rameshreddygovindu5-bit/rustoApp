"""SMS Campaigns router — bulk promotional / announcement messages.

Workflow:
  1. POST /api/campaigns          — create a draft (audience + message)
  2. GET  /api/campaigns/{id}/audience — preview which phones will receive it
  3. POST /api/campaigns/{id}/send — fan-out using the existing send_sms
                                     helper (each row creates an Alert)

The audience filter joins to the existing Customer table so opt-out flags
and per-tenant scoping are respected automatically.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import json

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..database import get_db, SessionLocal
from ..models import (SmsCampaign, CampaignStatus, CampaignAudienceType,
                      Customer, LoyaltyAccount, Booking, BookingStatus,
                      Checkin, CheckinStatus)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _to_dict(c: SmsCampaign) -> dict:
    return {
        "campaign_id": c.campaign_id,
        "name": c.name,
        "message": c.message,
        "audience_type": getattr(c.audience_type, "value", c.audience_type),
        "audience_params": (json.loads(c.audience_params) if c.audience_params else {}),
        "status": getattr(c.status, "value", c.status),
        "estimated_recipients": int(c.estimated_recipients or 0),
        "actual_sent": int(c.actual_sent or 0),
        "actual_failed": int(c.actual_failed or 0),
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _resolve_audience(db: Session, lodge_id: int, audience_type: str,
                       params: dict) -> List[str]:
    """Return the list of phone numbers matching the audience filter.
    Always scoped to this lodge. Skips customers without a phone."""
    phones: List[str] = []

    if audience_type == "all_customers":
        rows = (db.query(Customer.phone)
                .filter(Customer.lodge_id == lodge_id,
                        Customer.is_active == True,
                        Customer.blacklisted == False).all())
        phones = [r[0] for r in rows if r[0]]

    elif audience_type == "vip_only":
        rows = (db.query(Customer.phone)
                .filter(Customer.lodge_id == lodge_id,
                        Customer.is_vip == True,
                        Customer.is_active == True,
                        Customer.blacklisted == False).all())
        phones = [r[0] for r in rows if r[0]]

    elif audience_type == "by_tier":
        tier = params.get("tier")
        if not tier:
            raise HTTPException(status_code=400, detail="tier required in audience_params")
        rows = (db.query(Customer.phone)
                .join(LoyaltyAccount, LoyaltyAccount.customer_id == Customer.customer_id)
                .filter(Customer.lodge_id == lodge_id,
                        LoyaltyAccount.tier == tier,
                        Customer.is_active == True,
                        Customer.blacklisted == False).all())
        phones = [r[0] for r in rows if r[0]]

    elif audience_type == "recently_checked_out":
        since_days = int(params.get("since_days", 30))
        cutoff = _utcnow() - timedelta(days=since_days)
        rows = (db.query(Customer.phone)
                .join(Checkin, Checkin.customer_id == Customer.customer_id)
                .filter(Customer.lodge_id == lodge_id,
                        Checkin.status == CheckinStatus.checked_out,
                        Checkin.actual_checkout >= cutoff,
                        Customer.is_active == True,
                        Customer.blacklisted == False)
                .distinct().all())
        phones = [r[0] for r in rows if r[0]]

    elif audience_type == "upcoming_bookings":
        # Guests with confirmed/pending bookings starting within N days.
        within_days = int(params.get("within_days", 7))
        from datetime import date as _date
        end = _date.today() + timedelta(days=within_days)
        rows = (db.query(Booking.guest_phone)
                .filter(Booking.lodge_id == lodge_id,
                        Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                        Booking.checkin_date >= _date.today(),
                        Booking.checkin_date <= end).all())
        phones = [r[0] for r in rows if r[0]]

    elif audience_type == "custom_list":
        raw = params.get("phones") or []
        phones = [p.strip() for p in raw if (p or "").strip()]

    else:
        raise HTTPException(status_code=400, detail="Unknown audience_type")

    # De-dupe while preserving order.
    seen = set()
    return [p for p in phones if not (p in seen or seen.add(p))]


@router.get("")
def list_campaigns(db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(SmsCampaign)
            .filter(SmsCampaign.lodge_id == lodge_id)
            .order_by(SmsCampaign.created_at.desc())
            .limit(200).all())
    return [_to_dict(r) for r in rows]


class CampaignCreate(BaseModel):
    name: str
    message: str
    audience_type: str = "all_customers"
    audience_params: dict = Field(default_factory=dict)


@router.post("")
def create_campaign(body: CampaignCreate, request: Request,
                     db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    if not body.name.strip() or not body.message.strip():
        raise HTTPException(status_code=400, detail="name and message are required")
    if body.audience_type not in {a.value for a in CampaignAudienceType}:
        raise HTTPException(status_code=400, detail="Invalid audience_type")

    # Run the audience resolver now to estimate size (and validate params).
    phones = _resolve_audience(db, lodge_id, body.audience_type, body.audience_params)

    c = SmsCampaign(
        lodge_id=lodge_id,
        name=body.name.strip()[:120],
        message=body.message.strip(),
        audience_type=body.audience_type,
        audience_params=json.dumps(body.audience_params),
        status=CampaignStatus.draft,
        estimated_recipients=len(phones),
        created_by=current_user.user_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _to_dict(c)


@router.get("/{campaign_id}/audience")
def preview_audience(campaign_id: int,
                      db: Session = Depends(get_db),
                      current_user=Depends(get_current_user),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    c = (db.query(SmsCampaign)
         .filter(SmsCampaign.campaign_id == campaign_id,
                 SmsCampaign.lodge_id == lodge_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    params = json.loads(c.audience_params) if c.audience_params else {}
    audience_type = getattr(c.audience_type, "value", c.audience_type)
    phones = _resolve_audience(db, lodge_id, audience_type, params)
    return {"count": len(phones),
            "sample": phones[:20],
            "truncated": len(phones) > 20}


def _do_send(campaign_id: int, lodge_id: int):
    """Background-thread sender. Opens its own DB session because we're
    no longer inside the request session."""
    db = SessionLocal()
    try:
        from .alert_service_send import send_sms_via_alert
    except Exception:
        # The helper lives in services/alert_service — import inline.
        from ..services.alert_service import send_sms
        send_sms_via_alert = send_sms
    try:
        c = (db.query(SmsCampaign)
             .filter(SmsCampaign.campaign_id == campaign_id,
                     SmsCampaign.lodge_id == lodge_id).first())
        if not c:
            return
        c.status = CampaignStatus.sending
        db.commit()

        params = json.loads(c.audience_params) if c.audience_params else {}
        audience_type = getattr(c.audience_type, "value", c.audience_type)
        phones = _resolve_audience(db, lodge_id, audience_type, params)
        sent = 0
        failed = 0
        for ph in phones:
            try:
                from ..services.alert_service import send_sms
                send_sms(db, ph, c.message, event_type="campaign", lodge_id=lodge_id)
                sent += 1
            except Exception:
                failed += 1
        c.actual_sent = sent
        c.actual_failed = failed
        c.status = CampaignStatus.completed
        c.sent_at = _utcnow()
        db.commit()
    except Exception:
        # Last-ditch: mark cancelled rather than leaving it stuck on 'sending'.
        if 'c' in locals() and c:
            try:
                c.status = CampaignStatus.cancelled
                db.commit()
            except Exception:
                pass
    finally:
        db.close()


@router.post("/{campaign_id}/send")
def send_campaign(campaign_id: int, background_tasks: BackgroundTasks, request: Request,
                   db: Session = Depends(get_db),
                   current_user=Depends(require_admin),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    c = (db.query(SmsCampaign)
         .filter(SmsCampaign.campaign_id == campaign_id,
                 SmsCampaign.lodge_id == lodge_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c.status != CampaignStatus.draft:
        raise HTTPException(status_code=400,
                            detail=f"Cannot send a campaign in '{c.status.value}' status")
    c.status = CampaignStatus.queued
    db.commit()
    background_tasks.add_task(_do_send, c.campaign_id, lodge_id)
    try:
        log_audit(db, "campaign.sent",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="sms_campaign", entity_id=c.campaign_id, lodge_id=lodge_id,
                  details={"name": c.name, "estimated_recipients": c.estimated_recipients},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"success": True, "message": "Campaign queued for delivery",
            "estimated_recipients": c.estimated_recipients}


@router.delete("/{campaign_id}")
def delete_campaign(campaign_id: int,
                     db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    c = (db.query(SmsCampaign)
         .filter(SmsCampaign.campaign_id == campaign_id,
                 SmsCampaign.lodge_id == lodge_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if c.status in (CampaignStatus.sending, CampaignStatus.queued):
        raise HTTPException(status_code=400, detail="Cannot delete an in-flight campaign")
    db.delete(c)
    db.commit()
    return {"success": True}
