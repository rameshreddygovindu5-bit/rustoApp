"""Customer reviews for Rusto lodges — v6.0.

Three audiences, one router (kept together because they share types):

  Customer (token-bearing):
    POST   /api/rusto/reviews                    submit a new review
    GET    /api/rusto/reviews/mine               my own reviews
    PATCH  /api/rusto/reviews/{id}               edit my review
    DELETE /api/rusto/reviews/{id}               soft-delete (status='hidden')

  Public (no auth):
    GET    /api/rusto/public/lodges/{code}/reviews    paginated, recent first

  Lodge-side (admin auth + tenant scope):
    GET    /api/rusto/listing/reviews                 reviews of MY lodge
    POST   /api/rusto/listing/reviews/{id}/respond    post the single response
    DELETE /api/rusto/listing/reviews/{id}/respond    remove my response

Verification: every Review.booking_id MUST be a CustomerBooking the
customer owns AND whose status is checked_in / checked_out. This is the
"verified stay" guarantee shown publicly with a badge.
"""
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import (Review, ReviewStatus, RustoCustomer, CustomerBooking,
                       CustomerBookingStatus, Lodge, User, UserRole)
from ..rusto_auth import get_current_customer
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rusto-reviews"])


# ── Serialization helpers ────────────────────────────────────────

def _public_review_dict(r: Review, customer: Optional[RustoCustomer],
                         lodge: Optional[Lodge]) -> dict:
    """Public-safe review shape — used on lodge detail pages and in
    aggregate listings. Customer's full name is shown but not their
    phone/email."""
    # Show "Arjun M." rather than full name — light privacy without
    # making the review feel anonymous.
    display_name = "Anonymous"
    if customer and customer.full_name:
        parts = customer.full_name.strip().split()
        if len(parts) == 1:
            display_name = parts[0]
        else:
            display_name = f"{parts[0]} {parts[-1][0]}."
    return {
        "review_id":     r.review_id,
        "rating":        r.rating,
        "title":         r.title,
        "body":          r.body,
        "created_at":    r.created_at.isoformat() if r.created_at else None,
        "updated_at":    r.updated_at.isoformat() if r.updated_at else None,
        "is_edited":     bool(r.updated_at and r.created_at
                                and (r.updated_at - r.created_at).total_seconds() > 60),
        "verified_stay": True,
        "customer_name": display_name,
        "lodge_response": ({
            "body": r.response_body,
            "at":   r.response_at.isoformat() if r.response_at else None,
            "lodge_name": lodge.name if lodge else None,
        } if r.response_body else None),
    }


def _own_review_dict(r: Review, lodge: Optional[Lodge]) -> dict:
    """Customer-facing self-view — includes status (so they can see if
    Rusto flagged it) but no admin-only fields like flagged_reason."""
    base = _public_review_dict(r, None, lodge)
    base.update({
        "status": r.status,
        "lodge_code": lodge.code if lodge else None,
        "lodge_name": lodge.name if lodge else None,
        "booking_id": r.booking_id,
    })
    return base


def _admin_review_dict(r: Review, customer: Optional[RustoCustomer]) -> dict:
    """Lodge-admin-facing — shows full customer name (so admin can search
    their booking system) but not contact details. Stays inside the
    'verified stay' privacy boundary."""
    return {
        "review_id":   r.review_id,
        "rating":      r.rating,
        "title":       r.title,
        "body":        r.body,
        "status":      r.status,
        "created_at":  r.created_at.isoformat() if r.created_at else None,
        "updated_at":  r.updated_at.isoformat() if r.updated_at else None,
        "customer_name": customer.full_name if customer else None,
        "booking_id":  r.booking_id,
        "lodge_response": ({
            "body": r.response_body,
            "at":   r.response_at.isoformat() if r.response_at else None,
        } if r.response_body else None),
    }


# ── Public: lodge reviews + aggregate ─────────────────────────────

@router.get("/api/rusto/public/lodges/{code}/reviews")
def public_lodge_reviews(
    code: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort: str = Query("recent", pattern="^(recent|highest|lowest)$"),
    db: Session = Depends(get_db),
):
    """Paginated review feed for a lodge. Aggregate stats also returned
    in the same payload so the lodge detail page renders in one round-trip."""
    lodge = db.query(Lodge).filter(Lodge.code == code,
                                     Lodge.is_published == True).first()
    if not lodge:
        raise HTTPException(status_code=404, detail="Lodge not found")

    base_q = db.query(Review).filter(
        Review.lodge_id == lodge.lodge_id,
        Review.status == ReviewStatus.published.value,
    )

    total = base_q.count()

    # Aggregate stats (always computed from the published set — flagged/
    # hidden never count toward avg or histogram).
    agg = (db.query(
                func.avg(Review.rating).label("avg"),
                func.count(Review.review_id).label("cnt"),
            )
            .filter(Review.lodge_id == lodge.lodge_id,
                    Review.status == ReviewStatus.published.value)
            .first())
    avg_rating = float(agg.avg) if agg and agg.avg is not None else None

    # Star histogram for the breakdown bar.
    hist_rows = (db.query(Review.rating, func.count(Review.review_id))
                   .filter(Review.lodge_id == lodge.lodge_id,
                           Review.status == ReviewStatus.published.value)
                   .group_by(Review.rating).all())
    histogram = {str(i): 0 for i in range(1, 6)}
    for r, c in hist_rows:
        histogram[str(r)] = c

    # Sort + page.
    order_by = {
        "recent":  Review.created_at.desc(),
        "highest": (Review.rating.desc(), Review.created_at.desc()),
        "lowest":  (Review.rating.asc(),  Review.created_at.desc()),
    }[sort]
    if isinstance(order_by, tuple):
        rows = (base_q.order_by(*order_by)
                       .offset((page-1)*page_size).limit(page_size).all())
    else:
        rows = (base_q.order_by(order_by)
                       .offset((page-1)*page_size).limit(page_size).all())

    # Bulk-load customers for name display (avoids N+1).
    cust_ids = {r.customer_id for r in rows}
    cust_map = {c.customer_id: c for c in
                 db.query(RustoCustomer).filter(RustoCustomer.customer_id.in_(cust_ids)).all()
                } if cust_ids else {}

    return {
        "lodge_code":   lodge.code,
        "total":        total,
        "avg_rating":   round(avg_rating, 2) if avg_rating is not None else None,
        "histogram":    histogram,
        "page":         page,
        "page_size":    page_size,
        "has_more":     (page * page_size) < total,
        "reviews":      [_public_review_dict(r, cust_map.get(r.customer_id), lodge)
                         for r in rows],
    }


# ── Customer: write / edit / hide ─────────────────────────────────

class ReviewCreateBody(BaseModel):
    booking_id: int
    rating: int = Field(ge=1, le=5)
    title: Optional[str] = Field(default=None, max_length=120)
    body: Optional[str] = Field(default=None, max_length=4000)


@router.post("/api/rusto/reviews", status_code=201)
def create_review(body: ReviewCreateBody, request: Request,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    """Submit a new review tied to a specific booking the caller owns
    AND has actually stayed at (status checked_in or checked_out).

    Returns 409 if a review already exists for this booking — clients
    should call PATCH instead.
    """
    booking = (db.query(CustomerBooking)
                .filter(CustomerBooking.booking_id == body.booking_id,
                        CustomerBooking.customer_id == customer.customer_id)
                .first())
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.status not in (CustomerBookingStatus.checked_in.value,
                               CustomerBookingStatus.checked_out.value):
        raise HTTPException(status_code=400,
                            detail="You can only review a stay you've actually had")

    existing = db.query(Review).filter(Review.booking_id == body.booking_id).first()
    if existing:
        raise HTTPException(status_code=409,
                            detail=f"You've already reviewed this stay (review #{existing.review_id})")

    review = Review(
        lodge_id=booking.lodge_id,
        customer_id=customer.customer_id,
        booking_id=booking.booking_id,
        rating=body.rating,
        title=(body.title or "").strip() or None,
        body=(body.body or "").strip() or None,
        status=ReviewStatus.published.value,
    )
    db.add(review); db.commit(); db.refresh(review)

    try:
        log_audit(db, "rusto_review.created",
                  actor_user_id=None, actor_username=f"customer:{customer.customer_id}",
                  entity_type="review", entity_id=review.review_id,
                  lodge_id=booking.lodge_id,
                  details={"rating": review.rating, "booking_id": booking.booking_id},
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass

    lodge = db.query(Lodge).filter(Lodge.lodge_id == booking.lodge_id).first()
    return _own_review_dict(review, lodge)


@router.get("/api/rusto/reviews/mine")
def list_my_reviews(customer: RustoCustomer = Depends(get_current_customer),
                     db: Session = Depends(get_db)):
    """All reviews I've written, including hidden ones (so I can re-publish)."""
    rows = (db.query(Review)
              .filter(Review.customer_id == customer.customer_id)
              .order_by(Review.created_at.desc()).all())
    lodge_ids = {r.lodge_id for r in rows}
    lodge_map = {l.lodge_id: l for l in
                  db.query(Lodge).filter(Lodge.lodge_id.in_(lodge_ids)).all()
                 } if lodge_ids else {}
    return [_own_review_dict(r, lodge_map.get(r.lodge_id)) for r in rows]


class ReviewEditBody(BaseModel):
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    title: Optional[str] = Field(default=None, max_length=120)
    body: Optional[str] = Field(default=None, max_length=4000)
    # Customer can soft-delete by sending status='hidden', or re-publish
    # by sending 'published'. Cannot set 'flagged' — that's admin-only.
    status: Optional[str] = Field(default=None, pattern="^(published|hidden)$")


@router.patch("/api/rusto/reviews/{review_id}")
def edit_review(review_id: int, body: ReviewEditBody, request: Request,
                 customer: RustoCustomer = Depends(get_current_customer),
                 db: Session = Depends(get_db)):
    review = db.query(Review).filter(Review.review_id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.customer_id != customer.customer_id:
        raise HTTPException(status_code=403, detail="Not your review")
    if review.status == ReviewStatus.flagged.value:
        raise HTTPException(status_code=403,
                            detail="This review was removed by Rusto and cannot be edited")

    changes = []
    if body.rating is not None and body.rating != review.rating:
        review.rating = body.rating; changes.append("rating")
    if body.title is not None:
        new_title = (body.title or "").strip() or None
        if new_title != review.title:
            review.title = new_title; changes.append("title")
    if body.body is not None:
        new_body = (body.body or "").strip() or None
        if new_body != review.body:
            review.body = new_body; changes.append("body")
    if body.status is not None and body.status != review.status:
        review.status = body.status; changes.append(f"status={body.status}")

    db.commit(); db.refresh(review)

    if changes:
        try:
            log_audit(db, "rusto_review.edited",
                      actor_user_id=None, actor_username=f"customer:{customer.customer_id}",
                      entity_type="review", entity_id=review.review_id,
                      lodge_id=review.lodge_id,
                      details={"changes": changes},
                      ip_address=request.client.host if request.client else None)
        except Exception:
            pass

    lodge = db.query(Lodge).filter(Lodge.lodge_id == review.lodge_id).first()
    return _own_review_dict(review, lodge)


@router.delete("/api/rusto/reviews/{review_id}")
def delete_review(review_id: int, request: Request,
                    customer: RustoCustomer = Depends(get_current_customer),
                    db: Session = Depends(get_db)):
    """Soft-delete: marks the row hidden. Customer can later re-publish via
    PATCH status='published'."""
    review = db.query(Review).filter(Review.review_id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.customer_id != customer.customer_id:
        raise HTTPException(status_code=403, detail="Not your review")
    if review.status == ReviewStatus.hidden.value:
        return {"already_hidden": True, "review_id": review_id}

    review.status = ReviewStatus.hidden.value
    db.commit()
    try:
        log_audit(db, "rusto_review.hidden",
                  actor_user_id=None, actor_username=f"customer:{customer.customer_id}",
                  entity_type="review", entity_id=review_id,
                  lodge_id=review.lodge_id,
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass
    return {"hidden": True, "review_id": review_id}


# ── Lodge-side: read + respond ────────────────────────────────────

@router.get("/api/rusto/listing/reviews")
def lodge_reviews(
    include_hidden: bool = False,
    rating: Optional[int] = Query(None, ge=1, le=5),
    unresponded_only: bool = False,
    lodge_id: int = Depends(resolve_lodge_scope),
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """All reviews for the lodge admin's lodge. Defaults exclude hidden
    (customer-soft-deleted) and include flagged so admin can see what
    super-admin took down."""
    q = db.query(Review).filter(Review.lodge_id == lodge_id)
    if not include_hidden:
        q = q.filter(Review.status != ReviewStatus.hidden.value)
    if rating:
        q = q.filter(Review.rating == rating)
    if unresponded_only:
        q = q.filter(Review.response_body.is_(None))
    rows = q.order_by(Review.created_at.desc()).all()

    cust_ids = {r.customer_id for r in rows}
    cust_map = {c.customer_id: c for c in
                 db.query(RustoCustomer).filter(RustoCustomer.customer_id.in_(cust_ids)).all()
                } if cust_ids else {}

    # Summary block for the page header.
    agg = (db.query(
                func.avg(Review.rating).label("avg"),
                func.count(Review.review_id).label("cnt"),
            )
            .filter(Review.lodge_id == lodge_id,
                    Review.status == ReviewStatus.published.value)
            .first())

    return {
        "summary": {
            "total_published": agg.cnt if agg and agg.cnt else 0,
            "avg_rating":      round(float(agg.avg), 2) if agg and agg.avg else None,
            "unresponded":     sum(1 for r in rows
                                    if r.response_body is None
                                    and r.status == ReviewStatus.published.value),
        },
        "reviews": [_admin_review_dict(r, cust_map.get(r.customer_id)) for r in rows],
    }


class ReviewResponseBody(BaseModel):
    body: str = Field(min_length=2, max_length=2000)


@router.post("/api/rusto/listing/reviews/{review_id}/respond")
def respond_to_review(review_id: int, body: ReviewResponseBody, request: Request,
                       lodge_id: int = Depends(resolve_lodge_scope),
                       current_user: User = Depends(require_admin),
                       db: Session = Depends(get_db)):
    """Post the lodge's one-time response. Calling again REPLACES the
    existing response — admins can edit their wording."""
    review = (db.query(Review)
                .filter(Review.review_id == review_id,
                        Review.lodge_id == lodge_id).first())
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.status == ReviewStatus.flagged.value:
        raise HTTPException(status_code=400,
                            detail="Cannot respond to a flagged review")

    is_edit = bool(review.response_body)
    review.response_body = body.body.strip()
    review.response_at = datetime.utcnow()
    review.response_by_user_id = current_user.user_id
    db.commit(); db.refresh(review)

    try:
        log_audit(db, "rusto_review.responded" if not is_edit else "rusto_review.response_edited",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="review", entity_id=review_id,
                  lodge_id=lodge_id,
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass

    cust = db.query(RustoCustomer).filter(RustoCustomer.customer_id == review.customer_id).first()
    return _admin_review_dict(review, cust)


@router.delete("/api/rusto/listing/reviews/{review_id}/respond")
def remove_response(review_id: int, request: Request,
                     lodge_id: int = Depends(resolve_lodge_scope),
                     current_user: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    review = (db.query(Review)
                .filter(Review.review_id == review_id,
                        Review.lodge_id == lodge_id).first())
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    if not review.response_body:
        return {"already_empty": True}
    review.response_body = None
    review.response_at = None
    review.response_by_user_id = None
    db.commit()
    try:
        log_audit(db, "rusto_review.response_removed",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  entity_type="review", entity_id=review_id,
                  lodge_id=lodge_id,
                  ip_address=request.client.host if request.client else None)
    except Exception:
        pass
    return {"removed": True, "review_id": review_id}
