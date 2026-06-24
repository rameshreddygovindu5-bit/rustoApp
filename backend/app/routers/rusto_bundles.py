"""Local Experience Bundles — v9.0.

Lodge admin can create add-on packages (meal, guide, taxi, etc.).
Customers can view and select them during booking.

Endpoints:
  PUBLIC:
    GET  /api/rusto/public/lodges/{code}/bundles   — bundles for a lodge

  LODGE ADMIN:
    GET    /api/rusto/listing/bundles              — my bundles
    POST   /api/rusto/listing/bundles              — create bundle
    PATCH  /api/rusto/listing/bundles/{id}         — update
    DELETE /api/rusto/listing/bundles/{id}         — delete

  CUSTOMER BOOKING:
    Bundles are added as part of the booking creation payload.
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ..database import get_db
from ..models import LocalBundle, Lodge
from ..auth import require_admin, resolve_lodge_scope

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/api/rusto/public", tags=["rusto-bundles-public"])
admin_router  = APIRouter(prefix="/api/rusto/listing/bundles", tags=["rusto-bundles-admin"])


def _bundle_dict(b: LocalBundle) -> dict:
    return {
        "bundle_id":   b.bundle_id,
        "title":       b.title,
        "description": b.description,
        "price":       float(b.price),
        "bundle_type": b.bundle_type,
        "is_active":   b.is_active,
    }


@public_router.get("/lodges/{code}/bundles")
def list_public_bundles(code: str, db: Session = Depends(get_db)):
    l = db.query(Lodge).filter(Lodge.code == code,
                                Lodge.is_published == True,
                                Lodge.is_active == True).first()
    if not l:
        return {"bundles": []}
    bundles = db.query(LocalBundle).filter(
        LocalBundle.lodge_id == l.lodge_id,
        LocalBundle.is_active == True
    ).order_by(LocalBundle.price).all()
    return {"bundles": [_bundle_dict(b) for b in bundles]}


class BundleCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    description: Optional[str] = None
    price: float = Field(..., ge=0)
    bundle_type: str = "meal"  # meal/transport/guide/activity
    is_active: bool = True


@admin_router.get("")
def list_my_bundles(
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    bundles = db.query(LocalBundle).filter(
        LocalBundle.lodge_id == lodge_id
    ).order_by(LocalBundle.bundle_type, LocalBundle.price).all()
    return {"bundles": [_bundle_dict(b) for b in bundles]}


@admin_router.post("")
def create_bundle(
    body: BundleCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    b = LocalBundle(
        lodge_id=lodge_id,
        title=body.title,
        description=body.description,
        price=body.price,
        bundle_type=body.bundle_type,
        is_active=body.is_active,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return _bundle_dict(b)


@admin_router.patch("/{bundle_id}")
def update_bundle(
    bundle_id: int,
    body: BundleCreate,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    b = db.query(LocalBundle).filter(
        LocalBundle.bundle_id == bundle_id,
        LocalBundle.lodge_id == lodge_id
    ).first()
    if not b:
        raise HTTPException(404, "Bundle not found")
    b.title = body.title
    b.description = body.description
    b.price = body.price
    b.bundle_type = body.bundle_type
    b.is_active = body.is_active
    db.commit()
    db.refresh(b)
    return _bundle_dict(b)


@admin_router.delete("/{bundle_id}")
def delete_bundle(
    bundle_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    lodge_id = resolve_lodge_scope(user, db)
    b = db.query(LocalBundle).filter(
        LocalBundle.bundle_id == bundle_id,
        LocalBundle.lodge_id == lodge_id
    ).first()
    if not b:
        raise HTTPException(404, "Bundle not found")
    db.delete(b)
    db.commit()
    return {"deleted": True}
