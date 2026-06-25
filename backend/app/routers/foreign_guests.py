"""Foreign guest registration (India C-Form / FRRO compliance).

Indian Foreigners Act 1946 §14 + FRRO rules require hotels to file C-Form
within 24 hours of a foreign national checking in. This router manages
the data set + workflow.

A registration row is auto-created at check-in time when the Customer's
id_type is 'passport'. Staff fill in the remaining fields (visa, arrival,
purpose), then mark `submitted` after filing with FRRO.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime, timezone
import csv, io

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from fastapi.responses import StreamingResponse

from ..database import get_db, extract_date
from ..models import (ForeignGuestRegistration, ForeignGuestStatus,
                      Customer, Checkin)
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/foreign-guests", tags=["foreign-guests"])


def _to_dict(r: ForeignGuestRegistration, cust: Optional[Customer] = None) -> dict:
    return {
        "registration_id": r.registration_id,
        "customer_id": r.customer_id,
        "checkin_id": r.checkin_id,
        "customer_name": (f"{cust.first_name} {cust.last_name}" if cust else None),
        "passport_number": r.passport_number,
        "passport_expiry": r.passport_expiry.isoformat() if r.passport_expiry else None,
        "nationality": r.nationality,
        "visa_number": r.visa_number,
        "visa_type": r.visa_type,
        "visa_expiry": r.visa_expiry.isoformat() if r.visa_expiry else None,
        "arrival_date_in_india": r.arrival_date_in_india.isoformat() if r.arrival_date_in_india else None,
        "arrival_from_country": r.arrival_from_country,
        "departure_to_country": r.departure_to_country,
        "purpose_of_visit": r.purpose_of_visit,
        "status": getattr(r.status, "value", r.status),
        "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
        "frro_reference": r.frro_reference,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("")
def list_registrations(status: Optional[str] = None,
                        db: Session = Depends(get_db),
                        current_user=Depends(get_current_user),
                        lodge_id: int = Depends(resolve_lodge_scope)):
    q = (db.query(ForeignGuestRegistration, Customer)
         .outerjoin(Customer, Customer.customer_id == ForeignGuestRegistration.customer_id)
         .filter(ForeignGuestRegistration.lodge_id == lodge_id)
         .order_by(ForeignGuestRegistration.created_at.desc()))
    if status:
        q = q.filter(ForeignGuestRegistration.status == status)
    return [_to_dict(r, c) for r, c in q.limit(500).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db),
           current_user=Depends(get_current_user),
           lodge_id: int = Depends(resolve_lodge_scope)):
    """Pending count (regulatory urgency!) + submitted/confirmed totals."""
    out = {s.value: 0 for s in ForeignGuestStatus}
    for status, n in (db.query(ForeignGuestRegistration.status,
                                func.count(ForeignGuestRegistration.registration_id))
                       .filter(ForeignGuestRegistration.lodge_id == lodge_id)
                       .group_by(ForeignGuestRegistration.status).all()):
        out[getattr(status, "value", status)] = int(n)
    # Pending overdue (>24h since checkin) — regulatory red flag.
    from datetime import timedelta
    overdue_cutoff = _utcnow() - timedelta(hours=24)
    overdue = (db.query(ForeignGuestRegistration)
               .filter(ForeignGuestRegistration.lodge_id == lodge_id,
                       ForeignGuestRegistration.status == ForeignGuestStatus.pending,
                       ForeignGuestRegistration.created_at < overdue_cutoff)
               .count())
    return {"by_status": out, "pending_overdue_24h": overdue}


class RegistrationUpdate(BaseModel):
    passport_number: Optional[str] = None
    passport_expiry: Optional[date] = None
    nationality: Optional[str] = None
    visa_number: Optional[str] = None
    visa_type: Optional[str] = None
    visa_expiry: Optional[date] = None
    arrival_date_in_india: Optional[date] = None
    arrival_from_country: Optional[str] = None
    departure_to_country: Optional[str] = None
    purpose_of_visit: Optional[str] = None
    status: Optional[str] = None
    frro_reference: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/{registration_id}")
def update_registration(registration_id: int, body: RegistrationUpdate, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    r = (db.query(ForeignGuestRegistration)
         .filter(ForeignGuestRegistration.registration_id == registration_id,
                 ForeignGuestRegistration.lodge_id == lodge_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="Registration not found")
    fields = body.model_dump(exclude_unset=True)
    if "status" in fields:
        if fields["status"] not in {s.value for s in ForeignGuestStatus}:
            raise HTTPException(status_code=400, detail="Invalid status")
        if fields["status"] == "submitted" and not r.submitted_at:
            r.submitted_at = _utcnow()
            r.submitted_by = current_user.user_id
    for k, v in fields.items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    try:
        log_audit(db, "foreign_guest.updated",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="foreign_guest_registration", entity_id=r.registration_id,
                  lodge_id=lodge_id, details={"changed": list(fields.keys())},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass
    return _to_dict(r)


class CreateRegistration(BaseModel):
    """Manually create a registration for a check-in that wasn't
    auto-flagged (e.g. id_type was wrong at checkin time)."""
    checkin_id: int
    nationality: Optional[str] = None


@router.post("")
def create_registration(body: CreateRegistration, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    ch = (db.query(Checkin)
          .filter(Checkin.checkin_id == body.checkin_id,
                  Checkin.lodge_id == lodge_id).first())
    if not ch:
        raise HTTPException(status_code=404, detail="Check-in not found")
    # Refuse duplicates for same check-in.
    existing = (db.query(ForeignGuestRegistration)
                .filter(ForeignGuestRegistration.checkin_id == body.checkin_id,
                        ForeignGuestRegistration.lodge_id == lodge_id).first())
    if existing:
        raise HTTPException(status_code=400,
                            detail="A registration already exists for this check-in")
    r = ForeignGuestRegistration(
        lodge_id=lodge_id, customer_id=ch.customer_id, checkin_id=body.checkin_id,
        nationality=body.nationality,
        status=ForeignGuestStatus.pending,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _to_dict(r)


@router.get("/export/csv")
def export_csv(status: Optional[str] = None,
                from_date: Optional[date] = None,
                to_date: Optional[date] = None,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    """CSV download in a format suitable for batch upload to the FRRO
    portal (manual export — not API-direct since FRRO doesn't expose one)."""
    q = (db.query(ForeignGuestRegistration, Customer)
         .outerjoin(Customer, Customer.customer_id == ForeignGuestRegistration.customer_id)
         .filter(ForeignGuestRegistration.lodge_id == lodge_id)
         .order_by(ForeignGuestRegistration.created_at.desc()))
    if status:
        q = q.filter(ForeignGuestRegistration.status == status)
    if from_date:
        q = q.filter(extract_date(ForeignGuestRegistration.created_at) >= from_date)
    if to_date:
        q = q.filter(extract_date(ForeignGuestRegistration.created_at) <= to_date)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Registration ID", "Guest Name", "Nationality", "Passport No",
                 "Passport Expiry", "Visa No", "Visa Type", "Visa Expiry",
                 "Arrival in India", "Arrival From", "Departure To",
                 "Purpose", "Status", "FRRO Reference", "Created At"])
    for r, c in q.all():
        w.writerow([
            r.registration_id,
            f"{c.first_name} {c.last_name}" if c else "",
            r.nationality or "",
            r.passport_number or "",
            r.passport_expiry.isoformat() if r.passport_expiry else "",
            r.visa_number or "",
            r.visa_type or "",
            r.visa_expiry.isoformat() if r.visa_expiry else "",
            r.arrival_date_in_india.isoformat() if r.arrival_date_in_india else "",
            r.arrival_from_country or "",
            r.departure_to_country or "",
            r.purpose_of_visit or "",
            getattr(r.status, "value", r.status),
            r.frro_reference or "",
            r.created_at.isoformat() if r.created_at else "",
        ])
    buf.seek(0)
    fname = f"foreign-guests-{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )
