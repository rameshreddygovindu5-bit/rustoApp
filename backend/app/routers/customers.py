from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional, List
from ..database import get_db
from ..models import Customer, Checkin, CheckinStatus
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit
from pydantic import BaseModel, field_validator
from datetime import date
import re, os, uuid

router = APIRouter(prefix="/api/customers", tags=["customers"])
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")


class CustomerCreate(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str] = None
    address: Optional[str] = None
    id_type: str
    id_number: str
    date_of_birth: Optional[date] = None
    nationality: str = "Indian"
    gender: Optional[str] = None
    is_vip: bool = False

    @field_validator("phone", mode="before")
    @classmethod
    def validate_phone(cls, v):
        if not re.match(r"^\d{10}$", v):
            raise ValueError("Phone must be exactly 10 digits")
        return v

    @field_validator("gender", "email", "address", "nationality", mode="before")
    @classmethod
    def empty_to_none(cls, v):
        if v == "":
            return None
        return v


class CustomerUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    id_type: Optional[str] = None
    id_number: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    gender: Optional[str] = None
    is_vip: Optional[bool] = None
    blacklisted: Optional[bool] = None
    blacklist_reason: Optional[str] = None

    @field_validator("gender", "email", "address", "nationality", mode="before")
    @classmethod
    def empty_to_none(cls, v):
        if v == "":
            return None
        return v


def customer_to_dict(c: Customer, include_history: bool = False):
    # Compute last_room safely (sorted by checkin_datetime, most recent)
    sorted_checkins = sorted(c.checkins or [], key=lambda x: x.checkin_datetime, reverse=True) if c.checkins else []
    last_room = sorted_checkins[0].room.room_number if sorted_checkins and sorted_checkins[0].room else None
    # Look up Rusto marketplace loyalty tier for this customer
    rusto_tier = None
    rusto_points = None
    try:
        from ..models import RustoCustomer as RC, RustoMembership as RM
        phone_str = str(c.phone or "")
        rc = None
        from sqlalchemy.orm import Session as _S
        # Access db from the function's local scope (passed through include_history parameter handling)
        # Use direct SQL approach since db isn't passed to this function
        import sqlalchemy as _sa
        engine = c.__class__.__table__.metadata.bind
        if engine:
            with engine.connect() as conn:
                row = conn.execute(
                    _sa.text("SELECT rm.tier, rm.rusto_points FROM rusto_memberships rm "
                             "JOIN rusto_customers rc ON rc.customer_id = rm.customer_id "
                             "WHERE rc.phone = :phone LIMIT 1"),
                    {"phone": phone_str}
                ).fetchone()
                if row:
                    rusto_tier   = row[0]
                    rusto_points = row[1]
    except Exception:
        pass

    data = {
        "customer_id": c.customer_id,
        "rusto_tier":   rusto_tier,
        "rusto_points": rusto_points,
        "first_name": c.first_name,
        "last_name": c.last_name,
        "full_name": f"{c.first_name} {c.last_name}",
        "phone": c.phone,
        "email": c.email,
        "address": c.address,
        "id_type": c.id_type,
        "id_number": c.id_number,
        "id_proof_path": c.id_proof_path,
        "date_of_birth": c.date_of_birth.isoformat() if c.date_of_birth else None,
        "nationality": c.nationality,
        "gender": c.gender,
        "total_visits": c.total_visits,
        "is_vip": c.is_vip,
        "blacklisted": c.blacklisted,
        "blacklist_reason": c.blacklist_reason,
        "imported_from_excel": c.imported_from_excel,
        "is_active": c.is_active,
        # All active check-ins. Single-room guests will have one entry; R3
        # multi-room guests get the full list. `current_stay` (singular) is
        # kept for back-compat with consumers that expect just one.
        "current_stays": [
            {
                "checkin_id": ch.checkin_id,
                "room_number": ch.room.room_number if ch.room else None,
                "room_type": ch.room.room_type if ch.room else None,
                "checkin_datetime": ch.checkin_datetime.isoformat(),
                "expected_checkout": ch.expected_checkout.isoformat() if ch.expected_checkout else None,
                "tariff_per_night": float(ch.tariff_per_night),
                "deposit_amount": float(ch.deposit_amount or 0),
            }
            for ch in (c.checkins or [])
            if ch.status == CheckinStatus.active
        ],
        "current_stay": next((
            {
                "checkin_id": ch.checkin_id,
                "room_number": ch.room.room_number if ch.room else None,
                "room_type": ch.room.room_type if ch.room else None,
                "checkin_datetime": ch.checkin_datetime.isoformat(),
                "tariff_per_night": float(ch.tariff_per_night)
            }
            for ch in (c.checkins or [])
            if ch.status == CheckinStatus.active
        ), None),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }
    if include_history:
        data["checkin_history"] = [
            {
                "checkin_id": ch.checkin_id,
                "room_number": ch.room.room_number if ch.room else None,
                "room_type": ch.room.room_type if ch.room else None,
                "checkin_datetime": ch.checkin_datetime.isoformat(),
                "actual_checkout": ch.actual_checkout.isoformat() if ch.actual_checkout else None,
                "expected_checkout": ch.expected_checkout.isoformat() if ch.expected_checkout else None,
                "members_count": ch.members_count,
                "deposit_amount": float(ch.deposit_amount),
                "total_amount": float(ch.total_amount) if ch.total_amount else None,
                "status": ch.status,
                "payment_mode": ch.payment_mode,
            }
            for ch in sorted(c.checkins, key=lambda x: x.checkin_datetime, reverse=True)
        ]
        data["stats"] = {
            "total_nights": sum(
                (ch.total_nights or 0) for ch in c.checkins if ch.status == CheckinStatus.checked_out
            ),
            "total_spent": float(sum(
                (ch.total_amount or 0) for ch in c.checkins if ch.status == CheckinStatus.checked_out
            )),
            "last_room": last_room,
        }
    return data


@router.get("/autocomplete")
def autocomplete_customer(phone: str = Query(...), db: Session = Depends(get_db),
                           current_user=Depends(get_current_user),
                           lodge_id: int = Depends(resolve_lodge_scope)):
    """Search customers by phone number or name. Returns up to 10 matches."""
    q = phone.strip()
    if len(q) < 3:
        return []
    like = f"%{q}%"
    from sqlalchemy import or_
    customers = db.query(Customer).filter(
        Customer.lodge_id == lodge_id,
        Customer.is_active == True,
        or_(
            Customer.phone.like(like),
            Customer.first_name.ilike(like),
            Customer.last_name.ilike(like),
            (Customer.first_name + " " + Customer.last_name).ilike(like),
        )
    ).limit(10).all()
    def _last_room(c):
        sc = sorted(c.checkins or [], key=lambda x: x.checkin_datetime, reverse=True) if c.checkins else []
        return sc[0].room.room_number if sc and sc[0].room else None
    return [{"customer_id": c.customer_id, "full_name": f"{c.first_name} {c.last_name}",
             "phone": c.phone, "total_visits": c.total_visits,
             "is_vip": c.is_vip, "blacklisted": c.blacklisted,
             "last_room": _last_room(c)} for c in customers]


@router.get("")
def list_customers(
    search: Optional[str] = None,
    phone: Optional[str] = None,
    id_number: Optional[str] = None,
    is_vip: Optional[bool] = None,
    blacklisted: Optional[bool] = None,
    staying: Optional[bool] = None,
    page: int = 1, limit: int = 20,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    query = db.query(Customer).filter(
        Customer.lodge_id == lodge_id,
        Customer.is_active == True,
    )

    if search:
        query = query.filter(or_(
            Customer.first_name.ilike(f"%{search}%"),
            Customer.last_name.ilike(f"%{search}%"),
            Customer.phone.like(f"%{search}%"),
            func.concat(Customer.first_name, ' ', Customer.last_name).ilike(f"%{search}%")
        ))
    if phone:
        query = query.filter(Customer.phone.like(f"%{phone}%"))
    if id_number:
        query = query.filter(Customer.id_number == id_number)
    if is_vip is not None:
        query = query.filter(Customer.is_vip == is_vip)
    if blacklisted is not None:
        query = query.filter(Customer.blacklisted == blacklisted)
    if staying:
        query = query.join(Checkin).filter(Checkin.status == CheckinStatus.active)

    total = query.count()
    customers = query.order_by(Customer.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return {"total": total, "page": page, "limit": limit,
            "data": [customer_to_dict(c) for c in customers]}


@router.get("/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db),
                 current_user=Depends(get_current_user),
                 lodge_id: int = Depends(resolve_lodge_scope)):
    c = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer_to_dict(c, include_history=True)


@router.post("")
def create_customer(body: CustomerCreate, request: Request,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    # Phone uniqueness is per-lodge. Different lodges can have the same
    # phone (rare, but possible — a person staying at both lodges).
    existing = db.query(Customer).filter(
        Customer.phone == body.phone,
        Customer.lodge_id == lodge_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    customer = Customer(lodge_id=lodge_id, **body.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)

    try:
        log_audit(
            db, "customer.created",
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
            entity_type="customer", entity_id=customer.customer_id,
            lodge_id=lodge_id,
            details={"name": f"{customer.first_name} {customer.last_name}",
                     "phone": customer.phone},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"customer_id": customer.customer_id, "message": "Customer created"}


@router.put("/{customer_id}")
def update_customer(customer_id: int, body: CustomerUpdate, request: Request,
                    db: Session = Depends(get_db), current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    # If phone is being changed, ensure no other customer in this lodge holds it.
    new_phone = body.phone
    if new_phone is not None and new_phone != customer.phone:
        clash = (db.query(Customer)
                   .filter(Customer.phone == new_phone,
                           Customer.lodge_id == lodge_id,
                           Customer.customer_id != customer_id)
                   .first())
        if clash:
            raise HTTPException(
                status_code=409,
                detail=f"Phone {new_phone} already belongs to another guest "
                       f"({clash.first_name} {clash.last_name}).",
            )
    changed_fields = body.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(customer, field, value)
    db.commit()

    try:
        log_audit(
            db, "customer.updated",
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
            entity_type="customer", entity_id=customer.customer_id,
            lodge_id=lodge_id,
            details={"changed": list(changed_fields.keys())},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": "Customer updated"}


@router.post("/{customer_id}/id-proof")
async def upload_id_proof(
    customer_id: int,
    file: Optional[UploadFile] = File(None),
    id_proof: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """R6: replace the ID-proof image on file for an existing customer.
    Accepts the file under either field name `file` or `id_proof`."""
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    upload = file or id_proof
    if upload is None or not upload.filename:
        raise HTTPException(status_code=422, detail="No file provided (use field name 'file' or 'id_proof')")

    ext = os.path.splitext(upload.filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".pdf"]:
        raise HTTPException(status_code=400, detail="ID proof must be JPG, PNG, or PDF")
    content = await upload.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="ID proof must be under 5MB")

    # Same naming scheme as create_checkin: {customer_id}_{uuid}{ext}
    fname = f"{customer.customer_id}_{uuid.uuid4().hex}{ext}"
    save_dir = os.path.join(UPLOAD_DIR, "id_proofs")
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, fname)
    with open(save_path, "wb") as f:
        f.write(content)

    customer.id_proof_path = f"id_proofs/{fname}"
    db.commit()
    return {"success": True, "id_proof_path": customer.id_proof_path}


@router.patch("/{customer_id}/vip")
def toggle_vip(customer_id: int, body: dict, request: Request,
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.is_vip = body.get("is_vip", not customer.is_vip)
    db.commit()
    db.refresh(customer)
    try:
        log_audit(
            db, "customer.vip_toggled",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="customer", entity_id=customer.customer_id,
            lodge_id=lodge_id, details={"is_vip": customer.is_vip},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return customer_to_dict(customer)

@router.patch("/{customer_id}/blacklist")
def toggle_blacklist(customer_id: int, body: dict, request: Request,
                     db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.blacklisted = body.get("is_blacklisted", not customer.blacklisted)
    customer.blacklist_reason = body.get("blacklist_reason")
    db.commit()
    db.refresh(customer)
    # Blacklisting a guest is a serious action — capture the reason in the audit.
    try:
        log_audit(
            db, "customer.blacklist_toggled",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="customer", entity_id=customer.customer_id,
            lodge_id=lodge_id,
            details={"blacklisted": customer.blacklisted,
                     "reason": customer.blacklist_reason or ""},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return customer_to_dict(customer)

@router.get("/{customer_id}/history")
def get_customer_history(customer_id: int, db: Session = Depends(get_db),
                         current_user=Depends(get_current_user),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    c = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    res = customer_to_dict(c, include_history=True)
    return res["checkin_history"]

@router.delete("/{customer_id}")
def soft_delete_customer(customer_id: int, request: Request,
                         db: Session = Depends(get_db),
                         current_user=Depends(require_admin),
                         lodge_id: int = Depends(resolve_lodge_scope)):
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == lodge_id,
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.is_active = False
    db.commit()
    try:
        log_audit(
            db, "customer.deactivated",
            actor_user_id=current_user.user_id, actor_username=current_user.username,
            entity_type="customer", entity_id=customer.customer_id,
            lodge_id=lodge_id,
            details={"name": f"{customer.first_name} {customer.last_name}",
                     "phone": customer.phone},
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass
    return {"success": True, "message": "Customer deactivated"}
