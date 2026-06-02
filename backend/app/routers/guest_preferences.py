"""Guest preferences — repeat-guest "remembers what you like" chips.

When a guest is recognized at check-in the front desk sees their stack
of preferences ("ground floor", "extra pillows", "early breakfast 6 AM").
Replaces freeform notes for structured personalization.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional

from ..database import get_db
from ..models import GuestPreference, Customer
from ..auth import get_current_user, resolve_lodge_scope

router = APIRouter(prefix="/api/guest-preferences", tags=["guest-preferences"])

VALID_CATEGORIES = {"room", "dining", "service", "general"}


def _to_dict(p: GuestPreference) -> dict:
    return {
        "preference_id": p.preference_id,
        "customer_id": p.customer_id,
        "category": p.category,
        "preference": p.preference,
        "is_active": bool(p.is_active),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("")
def list_preferences(customer_id: int,
                      db: Session = Depends(get_db),
                      current_user=Depends(get_current_user),
                      lodge_id: int = Depends(resolve_lodge_scope)):
    cust = (db.query(Customer)
            .filter(Customer.customer_id == customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")
    rows = (db.query(GuestPreference)
            .filter(GuestPreference.lodge_id == lodge_id,
                    GuestPreference.customer_id == customer_id)
            .order_by(GuestPreference.created_at.desc()).all())
    return [_to_dict(p) for p in rows]


class PreferenceCreate(BaseModel):
    customer_id: int
    preference: str = Field(min_length=2, max_length=200)
    category: str = Field(default="general")


@router.post("")
def add_preference(body: PreferenceCreate,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    if body.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400,
                            detail=f"category must be one of {sorted(VALID_CATEGORIES)}")
    cust = (db.query(Customer)
            .filter(Customer.customer_id == body.customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")
    p = GuestPreference(
        lodge_id=lodge_id,
        customer_id=body.customer_id,
        category=body.category,
        preference=body.preference.strip(),
        is_active=True,
        created_by=current_user.user_id,
    )
    db.add(p); db.commit(); db.refresh(p)
    return _to_dict(p)


@router.delete("/{preference_id}")
def remove_preference(preference_id: int,
                       db: Session = Depends(get_db),
                       current_user=Depends(get_current_user),
                       lodge_id: int = Depends(resolve_lodge_scope)):
    p = (db.query(GuestPreference)
         .filter(GuestPreference.preference_id == preference_id,
                 GuestPreference.lodge_id == lodge_id).first())
    if not p:
        raise HTTPException(status_code=404, detail="Preference not found")
    db.delete(p); db.commit()
    return {"success": True}
