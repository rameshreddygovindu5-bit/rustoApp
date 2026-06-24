"""Guest feedback router — post-stay reviews & ratings.

Two access patterns:
  - Staff (authenticated): /api/feedback/* — list, view, stats, manual entry
  - Guest (public, no auth): /api/feedback/public/{token} GET + POST

The public flow uses a one-time `submit_token` issued at checkout. The
token expires (default 30 days) and clears itself on first submission to
prevent edits or replays.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timedelta, timezone
import secrets

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..database import get_db
from ..models import GuestFeedback, Customer, Checkin, CheckinStatus
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


def _to_dict(f: GuestFeedback, *, redact_token: bool = True) -> dict:
    out = {
        "feedback_id": f.feedback_id,
        "customer_id": f.customer_id,
        "checkin_id": f.checkin_id,
        "guest_name": f.guest_name,
        "overall_rating": f.overall_rating,
        "cleanliness_rating": f.cleanliness_rating,
        "service_rating": f.service_rating,
        "value_rating": f.value_rating,
        "location_rating": f.location_rating,
        "comment": f.comment,
        "would_recommend": f.would_recommend,
        "submitted_at": f.submitted_at.isoformat() if f.submitted_at else None,
        "submission_source": f.submission_source,
        "is_pending": f.submitted_at is None and bool(f.submit_token),
        "token_expires_at": f.token_expires_at.isoformat() if f.token_expires_at else None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }
    # Don't leak tokens via admin endpoints (only the guest's link should
    # carry the token). Staff who need to resend the link should use the
    # resend-link endpoint, which returns the URL not the raw token.
    if not redact_token:
        out["submit_token"] = f.submit_token
    return out


@router.get("")
def list_feedback(pending_only: bool = False,
                   submitted_only: bool = False,
                   db: Session = Depends(get_db),
                   current_user=Depends(get_current_user),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(GuestFeedback)
         .filter(GuestFeedback.lodge_id == lodge_id)
         .order_by(GuestFeedback.created_at.desc()))
    if pending_only:
        q = q.filter(GuestFeedback.submitted_at.is_(None))
    if submitted_only:
        q = q.filter(GuestFeedback.submitted_at.isnot(None))
    return [_to_dict(r) for r in q.limit(500).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Summary KPIs: avg ratings, NPS, submission rate."""
    submitted_q = (db.query(GuestFeedback)
                   .filter(GuestFeedback.lodge_id == lodge_id,
                           GuestFeedback.submitted_at.isnot(None)))
    submitted = submitted_q.count()
    pending = (db.query(GuestFeedback)
               .filter(GuestFeedback.lodge_id == lodge_id,
                       GuestFeedback.submitted_at.is_(None)).count())
    total = submitted + pending

    avg = lambda col: float((submitted_q.with_entities(func.avg(col)).scalar() or 0))
    avg_overall = avg(GuestFeedback.overall_rating)
    avg_cleanliness = avg(GuestFeedback.cleanliness_rating)
    avg_service = avg(GuestFeedback.service_rating)
    avg_value = avg(GuestFeedback.value_rating)
    avg_location = avg(GuestFeedback.location_rating)

    # NPS-lite: % of submissions where would_recommend is True.
    recommend = (submitted_q.filter(GuestFeedback.would_recommend == True).count())
    recommend_pct = (recommend / submitted * 100) if submitted > 0 else 0

    # Distribution of overall ratings (1-5 buckets).
    dist = {i: 0 for i in range(1, 6)}
    for r, n in (submitted_q
                  .with_entities(GuestFeedback.overall_rating,
                                 func.count(GuestFeedback.feedback_id))
                  .group_by(GuestFeedback.overall_rating).all()):
        if r is not None and 1 <= int(r) <= 5:
            dist[int(r)] = int(n)

    return {
        "total_requests_sent": total,
        "submitted": submitted,
        "pending": pending,
        "response_rate_pct": round((submitted / total * 100), 1) if total > 0 else 0,
        "avg_overall": round(avg_overall, 2),
        "avg_cleanliness": round(avg_cleanliness, 2),
        "avg_service": round(avg_service, 2),
        "avg_value": round(avg_value, 2),
        "avg_location": round(avg_location, 2),
        "would_recommend_pct": round(recommend_pct, 1),
        "rating_distribution": dist,
    }


class CreateRequestForCheckin(BaseModel):
    """Staff manually generate a feedback link for a (typically just-
    checked-out) check-in. Normally this happens automatically at
    checkout time, but this endpoint covers the cases where it didn't."""
    checkin_id: int
    expires_in_days: int = 30


@router.post("/request")
def create_request(body: CreateRequestForCheckin, request: Request,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    """Create a pending feedback row and return its public URL."""
    ch = (db.query(Checkin)
          .filter(Checkin.checkin_id == body.checkin_id,
                  Checkin.lodge_id == lodge_id).first())
    if not ch:
        raise HTTPException(status_code=404, detail="Check-in not found")
    # Avoid creating duplicate pending requests for the same check-in.
    existing = (db.query(GuestFeedback)
                .filter(GuestFeedback.checkin_id == ch.checkin_id,
                        GuestFeedback.lodge_id == lodge_id,
                        GuestFeedback.submitted_at.is_(None)).first())
    if existing:
        return {"feedback_id": existing.feedback_id,
                "submit_token": existing.submit_token,
                "url": f"/feedback-submit/{existing.submit_token}",
                "reused": True}

    days = max(1, min(int(body.expires_in_days or 30), 90))
    token = secrets.token_urlsafe(32)
    cust = db.query(Customer).filter(Customer.customer_id == ch.customer_id).first()
    fb = GuestFeedback(
        lodge_id=lodge_id, customer_id=ch.customer_id, checkin_id=ch.checkin_id,
        submit_token=token,
        token_expires_at=_utcnow() + timedelta(days=days),
        guest_name=(f"{cust.first_name} {cust.last_name}" if cust else None),
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    try:
        log_audit(db, "feedback.requested",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="guest_feedback", entity_id=fb.feedback_id,
                  lodge_id=lodge_id, details={"checkin_id": ch.checkin_id},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return {"feedback_id": fb.feedback_id, "submit_token": token,
            "url": f"/feedback-submit/{token}", "reused": False}


class StaffEntry(BaseModel):
    """Staff manually records a guest's feedback (phone call, in-person)."""
    customer_id: Optional[int] = None
    checkin_id: Optional[int] = None
    guest_name: Optional[str] = None
    overall_rating: int = Field(..., ge=1, le=5)
    cleanliness_rating: Optional[int] = Field(None, ge=1, le=5)
    service_rating: Optional[int] = Field(None, ge=1, le=5)
    value_rating: Optional[int] = Field(None, ge=1, le=5)
    location_rating: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
    would_recommend: Optional[bool] = None


@router.post("/staff")
def staff_entry(body: StaffEntry, request: Request,
                 db: Session = Depends(get_db),
                 current_user=Depends(get_current_user),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    fb = GuestFeedback(
        lodge_id=lodge_id,
        customer_id=body.customer_id, checkin_id=body.checkin_id,
        guest_name=body.guest_name,
        overall_rating=body.overall_rating,
        cleanliness_rating=body.cleanliness_rating,
        service_rating=body.service_rating,
        value_rating=body.value_rating,
        location_rating=body.location_rating,
        comment=body.comment,
        would_recommend=body.would_recommend,
        submitted_at=_utcnow(),
        submission_source="staff",
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    try:
        log_audit(db, "feedback.staff_entered",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="guest_feedback", entity_id=fb.feedback_id,
                  lodge_id=lodge_id,
                  details={"rating": body.overall_rating},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(fb)


# ─── Public submission endpoints (no auth) ──────────────────────────────

@router.get("/public/{submit_token}")
def public_view(submit_token: str, db: Session = Depends(get_db)):
    """Guest's view of their pending feedback request — used by the
    public submission page to confirm the link is valid."""
    fb = (db.query(GuestFeedback)
          .filter(GuestFeedback.submit_token == submit_token).first())
    if not fb:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    if fb.submitted_at:
        raise HTTPException(status_code=400,
                            detail="This feedback has already been submitted")
    if fb.token_expires_at and fb.token_expires_at < _utcnow():
        raise HTTPException(status_code=400, detail="This link has expired")
    # Don't leak lodge name+customer details — just enough to confirm
    # the link is valid and show the guest's own name.
    return {
        "guest_name": fb.guest_name,
        "valid": True,
    }


class PublicSubmit(BaseModel):
    overall_rating: int = Field(..., ge=1, le=5)
    cleanliness_rating: Optional[int] = Field(None, ge=1, le=5)
    service_rating: Optional[int] = Field(None, ge=1, le=5)
    value_rating: Optional[int] = Field(None, ge=1, le=5)
    location_rating: Optional[int] = Field(None, ge=1, le=5)
    comment: Optional[str] = None
    would_recommend: Optional[bool] = None
    guest_name: Optional[str] = None


@router.post("/public/{submit_token}")
def public_submit(submit_token: str, body: PublicSubmit, request: Request,
                   db: Session = Depends(get_db)):
    """The guest's actual submission. Validates token, persists ratings,
    then clears the token so the URL can't be reused or edited."""
    fb = (db.query(GuestFeedback)
          .filter(GuestFeedback.submit_token == submit_token).first())
    if not fb:
        raise HTTPException(status_code=404, detail="Invalid or expired link")
    if fb.submitted_at:
        raise HTTPException(status_code=400,
                            detail="This feedback has already been submitted")
    if fb.token_expires_at and fb.token_expires_at < _utcnow():
        raise HTTPException(status_code=400, detail="This link has expired")

    fb.overall_rating = body.overall_rating
    fb.cleanliness_rating = body.cleanliness_rating
    fb.service_rating = body.service_rating
    fb.value_rating = body.value_rating
    fb.location_rating = body.location_rating
    fb.comment = body.comment
    fb.would_recommend = body.would_recommend
    if body.guest_name and not fb.guest_name:
        fb.guest_name = body.guest_name
    fb.submitted_at = _utcnow()
    fb.submission_source = "web"
    # Clear the token — prevents replay and prevents the guest from
    # editing their submission later.
    fb.submit_token = None
    db.commit()
    return {"success": True, "message": "Thank you for your feedback!"}
