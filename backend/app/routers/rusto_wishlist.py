"""Customer wishlist / saved lodges — v9.0.

Endpoints:
  GET    /api/rusto/wishlist          — my saved lodges
  POST   /api/rusto/wishlist/{code}   — save a lodge
  DELETE /api/rusto/wishlist/{code}   — unsave a lodge
  GET    /api/rusto/wishlist/{code}/check — is this lodge saved?
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RustoWishlist, Lodge, LodgePhoto, Review, ReviewStatus
from ..rusto_auth import get_current_customer
from sqlalchemy import func

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rusto/wishlist", tags=["rusto-wishlist"])


def _lodge_summary(l: Lodge, db: Session) -> dict:
    photo = db.query(LodgePhoto).filter(
        LodgePhoto.lodge_id == l.lodge_id
    ).order_by(LodgePhoto.sort_order).first()
    avg = db.query(func.avg(Review.rating)).filter(
        Review.lodge_id == l.lodge_id,
        Review.status == ReviewStatus.published.value
    ).scalar()
    return {
        "lodge_id": l.lodge_id,
        "code": l.code,
        "name": l.name,
        "public_city": l.public_city,
        "public_state": l.public_state,
        "starting_price": float(l.starting_price) if l.starting_price else None,
        "cover_photo": photo.url if photo else None,
        "avg_rating": round(float(avg), 1) if avg else None,
        "property_type": getattr(l, "property_type", "lodge"),
        "amenities": (l.amenities or "").split(",") if l.amenities else [],
    }


@router.get("")
def get_wishlist(
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    rows = (db.query(RustoWishlist)
            .filter(RustoWishlist.customer_id == customer.customer_id)
            .order_by(RustoWishlist.created_at.desc()).all())
    lodge_ids = [r.lodge_id for r in rows]
    if not lodge_ids:
        return {"saved": [], "total": 0}
    lodges = db.query(Lodge).filter(Lodge.lodge_id.in_(lodge_ids)).all()
    lodge_map = {l.lodge_id: l for l in lodges}
    return {
        "saved": [_lodge_summary(lodge_map[r.lodge_id], db) for r in rows if r.lodge_id in lodge_map],
        "total": len(rows),
    }


@router.get("/{code}/check")
def check_saved(
    code: str,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    l = db.query(Lodge).filter(Lodge.code == code, Lodge.is_active == True).first()
    if not l:
        return {"saved": False}
    row = db.query(RustoWishlist).filter(
        RustoWishlist.customer_id == customer.customer_id,
        RustoWishlist.lodge_id == l.lodge_id,
    ).first()
    return {"saved": bool(row)}


@router.post("/{code}")
def save_lodge(
    code: str,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    l = db.query(Lodge).filter(Lodge.code == code, Lodge.is_published == True,
                                Lodge.is_active == True).first()
    if not l:
        raise HTTPException(404, "Lodge not found")
    exists = db.query(RustoWishlist).filter(
        RustoWishlist.customer_id == customer.customer_id,
        RustoWishlist.lodge_id == l.lodge_id,
    ).first()
    if exists:
        return {"saved": True, "message": "Already saved"}
    row = RustoWishlist(customer_id=customer.customer_id, lodge_id=l.lodge_id)
    db.add(row)
    db.commit()
    return {"saved": True, "message": "Saved to wishlist"}


@router.delete("/{code}")
def unsave_lodge(
    code: str,
    db: Session = Depends(get_db),
    customer=Depends(get_current_customer),
):
    l = db.query(Lodge).filter(Lodge.code == code).first()
    if not l:
        raise HTTPException(404, "Lodge not found")
    row = db.query(RustoWishlist).filter(
        RustoWishlist.customer_id == customer.customer_id,
        RustoWishlist.lodge_id == l.lodge_id,
    ).first()
    if row:
        db.delete(row)
        db.commit()
    return {"saved": False, "message": "Removed from wishlist"}
