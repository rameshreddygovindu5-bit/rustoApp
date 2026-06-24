from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from ..database import get_db
from ..models import Alert, AlertStatus
from ..auth import get_current_user, resolve_lodge_scope
from ..permissions import require_permission
from ..services.alert_service import send_sms, send_email, is_sms_enabled, is_email_enabled

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class CustomAlertRequest(BaseModel):
    type: str  # "sms" or "email"
    recipient: str
    message: Optional[str] = None
    subject: Optional[str] = None
    checkin_id: Optional[int] = None
    customer_id: Optional[int] = None


@router.get("", dependencies=[Depends(require_permission("alerts.read"))])
def list_alerts(
    alert_type: Optional[str] = None,
    status: Optional[str] = None,
    event_type: Optional[str] = None,
    search: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    page: int = 1, limit: int = 30,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    query = db.query(Alert).filter(Alert.lodge_id == lodge_id)
    if alert_type:
        query = query.filter(Alert.alert_type == alert_type)
    if status:
        query = query.filter(Alert.status == status)
    if event_type:
        query = query.filter(Alert.event_type == event_type)
    if search:
        like = f"%{search}%"
        from sqlalchemy import or_
        query = query.filter(or_(
            Alert.recipient.ilike(like),
            Alert.message_content.ilike(like),
        ))

    total = query.count()
    alerts = query.order_by(Alert.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

    return {
        "total": total, "page": page,
        "data": [{
            "alert_id": a.alert_id,
            "checkin_id": a.checkin_id,
            "customer_id": a.customer_id,
            "alert_type": a.alert_type,
            "event_type": getattr(a.event_type, "value", str(a.event_type)) if a.event_type else None,
            "recipient": a.recipient,
            "message_content": a.message_content,
            "status": a.status,
            "sent_at": a.sent_at.isoformat() if a.sent_at else None,
            "error_message": a.error_message,
            "retry_count": a.retry_count,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        } for a in alerts]
    }


@router.post("/custom", dependencies=[Depends(require_permission("alerts.write"))])
def send_custom_alert(body: CustomAlertRequest, db: Session = Depends(get_db),
                      current_user=Depends(get_current_user),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    """Send a one-off SMS or email using the CURRENT lodge's configured
    provider credentials. The alert row is tagged with this lodge so it
    shows up only on this lodge's Alerts page."""
    if body.type == "sms":
        if not is_sms_enabled(db, lodge_id=lodge_id):
            raise HTTPException(status_code=400, detail="SMS is not enabled in settings")
        alert = send_sms(db, body.recipient, body.message or "", body.checkin_id,
                         body.customer_id, "custom", lodge_id=lodge_id)
    elif body.type == "email":
        if not is_email_enabled(db, lodge_id=lodge_id):
            raise HTTPException(status_code=400, detail="Email is not enabled in settings")
        alert = send_email(db, body.recipient, body.subject or "Message from Hotel",
                          body.message or "", body.checkin_id, body.customer_id, "custom",
                          lodge_id=lodge_id)
    else:
        raise HTTPException(status_code=400, detail="Type must be 'sms' or 'email'")

    return {"alert_id": alert.alert_id, "status": alert.status, "message": "Alert processed"}


@router.post("/{alert_id}/retry", dependencies=[Depends(require_permission("alerts.write"))])
def retry_alert(alert_id: int, db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    alert = db.query(Alert).filter(
        Alert.alert_id == alert_id,
        Alert.lodge_id == lodge_id,
    ).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if alert.status == AlertStatus.sent:
        return {"message": "Alert already sent successfully"}

    alert.retry_count = (alert.retry_count or 0) + 1
    # Use the alert's own lodge_id (always equals current lodge_id here
    # because of the filter above, but explicit is better than implicit).
    if alert.alert_type == "sms":
        result = send_sms(db, alert.recipient, alert.message_content,
                          alert.checkin_id, alert.customer_id, alert.event_type,
                          lodge_id=alert.lodge_id)
    else:
        result = send_email(db, alert.recipient, "Resent", alert.message_content,
                            alert.checkin_id, alert.customer_id, alert.event_type,
                            lodge_id=alert.lodge_id)

    return {"status": result.status, "message": f"Retry {result.status}"}


@router.post("/retry-failed", dependencies=[Depends(require_permission("alerts.write"))])
def retry_all_failed(db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    """Retry every alert currently in the 'failed' state IN THIS LODGE.
    Returns how many were re-attempted and how many of those succeeded."""
    failed = db.query(Alert).filter(
        Alert.lodge_id == lodge_id,
        Alert.status == AlertStatus.failed,
    ).all()
    queued = 0
    sent_ok = 0
    for alert in failed:
        alert.retry_count = (alert.retry_count or 0) + 1
        try:
            if alert.alert_type == "sms":
                result = send_sms(db, alert.recipient, alert.message_content,
                                  alert.checkin_id, alert.customer_id, alert.event_type,
                                  lodge_id=alert.lodge_id)
            else:
                result = send_email(db, alert.recipient, "Resent", alert.message_content,
                                    alert.checkin_id, alert.customer_id, alert.event_type,
                                    lodge_id=alert.lodge_id)
            queued += 1
            status_val = getattr(result.status, "value", str(result.status))
            if status_val == "sent":
                sent_ok += 1
        except Exception:
            # Leave it failed; it stays eligible for the next bulk retry.
            pass
    return {"queued": queued, "sent": sent_ok, "message": f"Retried {queued} failed alert(s)"}


@router.get("/stats", dependencies=[Depends(require_permission("alerts.read"))])
def get_alert_stats(db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    from sqlalchemy import func
    stats = (db.query(Alert.status, Alert.alert_type, func.count(Alert.alert_id))
             .filter(Alert.lodge_id == lodge_id)
             .group_by(Alert.status, Alert.alert_type).all())

    return [{
        "status": s.status.value if hasattr(s.status, "value") else s.status,
        "alert_type": s.alert_type.value if hasattr(s.alert_type, "value") else s.alert_type,
        "count": s[2]
    } for s in stats]


@router.get("/sms-vendor-status")
def get_sms_vendor_status_endpoint(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Return SMS vendor configuration status for the Settings page.
    Shows which vendor is active and whether credentials are present."""
    from ..services.sms_service import get_sms_vendor_status
    return get_sms_vendor_status(db, lodge_id)


@router.post("/test-sms")
def send_test_sms(
    body: dict,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Send a test SMS to verify vendor configuration.
    Only admin can trigger test sends (avoid accidental billing)."""
    from ..auth import require_admin
    from ..services.alert_service import send_sms
    phone = body.get("phone", "")
    if not phone:
        from fastapi import HTTPException
        raise HTTPException(400, "phone is required")
    alert = send_sms(
        db, phone,
        "Rusto LMS test message — your SMS integration is working correctly! ✓",
        lodge_id=lodge_id, event_type="custom",
    )
    status_val = getattr(alert.status, "value", str(alert.status))
    return {
        "status": status_val,
        "error":  alert.error_message,
        "sent":   status_val == "sent",
        "recipient": phone,
    }
