from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Request
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime, date
import os, shutil, re, json, uuid, math

from ..database import get_db
from ..models import (Checkin, CheckinStatus, Customer, Room, RoomStatus,
                      Invoice, Setting, IDType)
from ..auth import get_current_user, resolve_lodge_scope
from ..services.alert_service import trigger_checkin_alerts, trigger_checkout_alerts, get_setting
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/checkins", tags=["checkins"])

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")


def validate_id_number(id_type: str, id_number: str) -> bool:
    patterns = {
        "aadhar": r"^\d{12}$",
        "driving_license": r"^[A-Z]{2}\d{2}[A-Z0-9]{11}$",
        "voter_id": r"^[A-Z]{3}\d{7}$",
        "passport": r"^[A-Z]\d{7}$",
        "pan": r"^[A-Z]{5}\d{4}[A-Z]$"
    }
    pattern = patterns.get(id_type)
    if not pattern:
        return True
    return bool(re.match(pattern, id_number.upper()))


def parse_checkout_datetime(value: Optional[str]) -> Optional[datetime]:
    """Accept either an ISO datetime ('2026-05-08T10:30') or a plain date
    ('2026-05-08', for backward-compatibility). Returns None if unparseable."""
    if not value:
        return None
    s = value.strip()
    # Try datetime first (datetime-local sends 'YYYY-MM-DDTHH:MM')
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        pass
    # Fall back to date-only — default to 12:00 noon checkout that day
    try:
        d = date.fromisoformat(s)
        return datetime.combine(d, datetime.min.time().replace(hour=12))
    except ValueError:
        return None


def checkin_to_dict(ch: Checkin):
    return {
        "checkin_id": ch.checkin_id,
        "customer_id": ch.customer_id,
        "customer": {
            "first_name": ch.customer.first_name,
            "last_name": ch.customer.last_name,
            "phone": ch.customer.phone,
            "email": ch.customer.email,
            "address": ch.customer.address,
            "id_type": ch.customer.id_type,
            "id_number": ch.customer.id_number,
            "nationality": ch.customer.nationality,
            "gender": ch.customer.gender,
        } if ch.customer else None,
        "room_id": ch.room_id,
        "room_number": ch.room.room_number if ch.room else None,
        "room_type": ch.room.room_type if ch.room else None,
        "checkin_datetime": ch.checkin_datetime.isoformat(),
        "expected_checkout": ch.expected_checkout.isoformat() if ch.expected_checkout else None,
        "actual_checkout": ch.actual_checkout.isoformat() if ch.actual_checkout else None,
        "members_count": ch.members_count,
        "deposit_amount": float(ch.deposit_amount),
        "advance_paid": float(ch.advance_paid or 0),
        "booking_id": ch.booking_id,
        "tariff_per_night": float(ch.tariff_per_night),
        "total_nights": ch.total_nights,
        "total_amount": float(ch.total_amount) if ch.total_amount else None,
        "discount_amount": float(ch.discount_amount) if ch.discount_amount else 0,
        "additional_charges": float(ch.additional_charges) if ch.additional_charges else 0,
        "gst_amount": float(ch.gst_amount) if ch.gst_amount else 0,
        "payment_mode": ch.payment_mode,
        "status": ch.status,
        "special_notes": ch.special_notes,
        "sms_alert_preference": ch.sms_alert_preference or "yes",
        "invoice_number": ch.invoice.invoice_number if ch.invoice else None,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }


@router.get("")
def list_checkins(
    status: Optional[str] = "active",
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    page_size: Optional[int] = None,  # alias for `limit` (frontend uses this name)
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    # Allow `page_size` from the UI to override `limit`.
    effective_limit = page_size or limit

    query = db.query(Checkin).filter(Checkin.lodge_id == lodge_id)

    if status == "overdue":
        # "Overdue" = active check-ins whose expected_checkout has passed.
        # This is a virtual status (not present in CheckinStatus enum) so it
        # has to be handled explicitly — otherwise SQLAlchemy will try to
        # cast "overdue" into the enum and raise.
        now = datetime.now()
        query = query.filter(
            Checkin.status == CheckinStatus.active,
            Checkin.expected_checkout.isnot(None),
            Checkin.expected_checkout < now,
        )
    elif status and status != "all":
        # Validate against the enum so an unknown value raises a clear 400
        # instead of an opaque DB error.
        try:
            CheckinStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown status '{status}'. Use one of: "
                       "active, checked_out, cancelled, overdue, all."
            )
        query = query.filter(Checkin.status == status)

    if search:
        like = f"%{search}%"
        query = query.join(Customer).join(Room).filter(
            Customer.first_name.ilike(like)
            | Customer.last_name.ilike(like)
            | Customer.phone.like(like)
            | Room.room_number.like(like)
        )

    total = query.count()
    checkins = (
        query.order_by(Checkin.checkin_datetime.desc())
             .offset((page - 1) * effective_limit)
             .limit(effective_limit)
             .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": effective_limit,
        "data": [checkin_to_dict(ch) for ch in checkins],
    }


TARIFF_KEY_MAP = {
    "deluxe_ac": "tariff_deluxe_ac",
    "ac": "tariff_ac",
    "non_ac": "tariff_non_ac",
    "house": "tariff_house",
}


def resolve_default_tariff(db: Session, room: Room) -> float:
    """Default rent for a room: setting (live) overrides room.base_tariff.
    Setting lookup is scoped to the room's lodge."""
    key = TARIFF_KEY_MAP.get(room.room_type, "tariff_non_ac")
    setting_val = get_setting(db, key, str(float(room.base_tariff)), lodge_id=room.lodge_id)
    try:
        return float(setting_val)
    except (TypeError, ValueError):
        return float(room.base_tariff)


def parse_rooms_payload(rooms_json: Optional[str], legacy_room_id: Optional[int],
                        legacy_deposit: Optional[float],
                        legacy_tariff: Optional[float]) -> List[dict]:
    """
    Multi-room support (R3, Option A).

    The frontend sends `rooms` as a JSON array:
        [{"room_id": 12, "tariff_per_night": 1500, "deposit_amount": 500}, ...]
    For backward compatibility we also accept the old single-room form fields
    (room_id + deposit_amount [+ tariff_per_night]).
    """
    if rooms_json:
        try:
            data = json.loads(rooms_json)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="`rooms` must be valid JSON")
        if not isinstance(data, list) or not data:
            raise HTTPException(status_code=400, detail="`rooms` must be a non-empty array")
        cleaned = []
        seen = set()
        for i, item in enumerate(data):
            if not isinstance(item, dict) or "room_id" not in item:
                raise HTTPException(status_code=400, detail=f"rooms[{i}] missing room_id")
            rid = int(item["room_id"])
            if rid in seen:
                raise HTTPException(status_code=400, detail=f"Room id {rid} listed twice")
            seen.add(rid)
            cleaned.append({
                "room_id": rid,
                "tariff_per_night": (
                    float(item["tariff_per_night"])
                    if item.get("tariff_per_night") not in (None, "", "null") else None
                ),
                "deposit_amount": (
                    float(item["deposit_amount"])
                    if item.get("deposit_amount") not in (None, "", "null") else None
                ),
            })
        return cleaned
    if legacy_room_id is None:
        raise HTTPException(status_code=400, detail="Either `rooms` or `room_id` is required")
    return [{
        "room_id": legacy_room_id,
        "tariff_per_night": legacy_tariff,
        "deposit_amount": legacy_deposit,
    }]


@router.post("")
async def create_checkin(
    first_name: str = Form(...),
    last_name: str = Form(...),
    phone: str = Form(...),
    members_count: int = Form(...),
    id_type: str = Form(...),
    id_number: str = Form(...),
    # ── multi-room ─────────────────────────────────────────────────────────
    # New: send `rooms` as a JSON-encoded list. Each item may carry its own
    # tariff_per_night and deposit_amount (per-room rent override, R1).
    rooms: Optional[str] = Form(None),
    # Legacy single-room fields — kept for backward compatibility.
    room_id: Optional[int] = Form(None),
    deposit_amount: Optional[float] = Form(None),
    tariff_per_night: Optional[float] = Form(None),
    # ── rest of the form ───────────────────────────────────────────────────
    checkin_datetime: Optional[str] = Form(None),
    expected_checkout: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    nationality: str = Form("Indian"),
    gender: Optional[str] = Form(None),
    special_notes: Optional[str] = Form(None),
    sms_alert_preference: str = Form("yes"),
    payment_mode: str = Form("cash"),
    # When a check-in is created from a confirmed booking, the frontend passes
    # the booking_id (to link the records) and the advance already collected
    # at reservation time (credited against the final bill at checkout).
    booking_id: Optional[int] = Form(None),
    advance_paid: Optional[float] = Form(None),
    id_proof: Optional[UploadFile] = File(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    # Validate phone
    if not re.match(r"^\d{10}$", phone):
        raise HTTPException(status_code=400, detail="Phone must be exactly 10 digits")

    # Validate ID number format
    if not validate_id_number(id_type, id_number):
        raise HTTPException(status_code=400, detail=f"Invalid {id_type.replace('_', ' ')} number format")

    rooms_payload = parse_rooms_payload(rooms, room_id, deposit_amount, tariff_per_night)

    # ── Parse dates EARLY (before any file I/O) so invalid input fails fast
    # and doesn't leave an orphaned ID image on disk. ─────────────────────
    exp_checkout = parse_checkout_datetime(expected_checkout)
    if expected_checkout and not exp_checkout:
        raise HTTPException(
            status_code=400,
            detail="expected_checkout must be ISO format ('YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD').",
        )
    chk_datetime = parse_checkout_datetime(checkin_datetime) if checkin_datetime else datetime.now()
    if chk_datetime is None:
        raise HTTPException(status_code=400, detail="checkin_datetime is invalid.")
    if exp_checkout and exp_checkout <= chk_datetime:
        raise HTTPException(
            status_code=400,
            detail="Expected checkout must be after the check-in time.",
        )

    # ── Validate ID file shape early too (extension + size). Same reason. ──
    if id_proof and id_proof.filename:
        _ext = os.path.splitext(id_proof.filename)[1].lower()
        if _ext not in [".jpg", ".jpeg", ".png", ".pdf"]:
            raise HTTPException(status_code=400, detail="ID proof must be JPG, PNG, or PDF")
        # Read+size-check happens later, after we have a customer_id for the
        # filename. For now we'll just defer.

    # Lock + validate every room atomically before changing anything.
    # If any one is unavailable we abort and the DB rolls back cleanly.
    locked_rooms: List[Room] = []
    for item in rooms_payload:
        rm = (db.query(Room)
                .filter(Room.room_id == item["room_id"],
                        Room.lodge_id == lodge_id)
                .with_for_update()
                .first())
        if not rm:
            raise HTTPException(status_code=404, detail=f"Room id {item['room_id']} not found")
        if rm.status != RoomStatus.available:
            raise HTTPException(
                status_code=409,
                detail=f"Room {rm.room_number} is no longer available. "
                       "Please re-select rooms and try again.",
            )
        locked_rooms.append(rm)

    # ── Customer: create or fetch (scoped to this lodge) ──────────────────
    # Phone uniqueness is per-lodge — a person could in principle stay at
    # multiple lodges run by the same operator under separate licences.
    customer = db.query(Customer).filter(
        Customer.phone == phone,
        Customer.lodge_id == lodge_id,
    ).first()
    is_new_customer = customer is None

    if customer:
        if customer.blacklisted:
            raise HTTPException(status_code=403, detail=f"Guest is blacklisted: {customer.blacklist_reason}")
        # Allow returning-guest fields to be updated by reception.
        customer.first_name = first_name
        customer.last_name = last_name
        if email:
            customer.email = email
        if address:
            customer.address = address
    else:
        # Normalize empty strings -> None
        email = email if email else None
        address = address if address else None
        gender = gender if gender else None
        special_notes_norm = special_notes if special_notes else None

        normalized_gender = None
        if gender:
            g = gender.strip().upper()
            if g.startswith("M"): normalized_gender = "M"
            elif g.startswith("F"): normalized_gender = "F"
            elif g.startswith("O"): normalized_gender = "Other"

        customer = Customer(
            lodge_id=lodge_id,
            first_name=first_name, last_name=last_name, phone=phone,
            email=email, address=address, id_type=id_type, id_number=id_number,
            nationality=nationality, gender=normalized_gender,
        )
        db.add(customer)
        db.flush()
        special_notes = special_notes_norm

    # ── R2: ID proof handling ─────────────────────────────────────────────
    # Mandatory unless the customer already has one on file (skip re-scan
    # for returning guests — reception said they don't want to re-photograph
    # the same Aadhaar every visit). Extension was validated early above.
    has_existing_id = bool(customer.id_proof_path)
    if id_proof and id_proof.filename:
        ext = os.path.splitext(id_proof.filename)[1].lower()
        content = await id_proof.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="ID proof must be under 5MB")

        # R2: unique on-disk filename: {customer_id}_{uuid_hex}{ext}.
        # Customer-id prefix keeps related files grouped; uuid hex guarantees
        # uniqueness even if two reception desks save in the same second.
        fname = f"{customer.customer_id}_{uuid.uuid4().hex}{ext}"
        save_dir = os.path.join(UPLOAD_DIR, "id_proofs")
        os.makedirs(save_dir, exist_ok=True)
        save_path = os.path.join(save_dir, fname)
        try:
            with open(save_path, "wb") as f:
                f.write(content)
            customer.id_proof_path = f"id_proofs/{fname}"
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Could not save ID image: {e}")
    elif not has_existing_id:
        # No file attached AND no previous file on record — block.
        raise HTTPException(
            status_code=400,
            detail="ID proof image is mandatory. Upload a JPG/PNG/PDF of the guest's ID.",
        )

    # Update ID type/number on the customer record (latest given wins)
    customer.id_type = id_type
    customer.id_number = id_number
    db.flush()

    # ── Resolve & validate the linked booking, if this check-in came from one.
    linked_booking = None
    if booking_id:
        from ..models import Booking, BookingStatus
        linked_booking = db.query(Booking).filter(
            Booking.booking_id == booking_id,
            Booking.lodge_id == lodge_id,
        ).first()
        if not linked_booking:
            raise HTTPException(status_code=404, detail="Linked booking not found")
        if linked_booking.checkin or linked_booking.status == BookingStatus.checked_in:
            raise HTTPException(status_code=400, detail="This booking is already checked in.")

    # The advance is a single sum for the whole stay — apply it to the first
    # room only so it isn't multiplied across a multi-room check-in.
    advance_to_apply = 0.0
    if advance_paid is not None and advance_paid > 0:
        advance_to_apply = round(float(advance_paid), 2)
    elif linked_booking is not None:
        advance_to_apply = round(float(linked_booking.advance_amount or 0), 2)

    # ── Create one Checkin row per room ───────────────────────────────────
    created = []
    for idx, (rm, item) in enumerate(zip(locked_rooms, rooms_payload)):
        # R1: per-room rent override. If the user typed a rent for this room,
        # use it; otherwise fall back to the live default (settings-synced).
        default_tariff = resolve_default_tariff(db, rm)
        per_room_tariff = item.get("tariff_per_night")
        if per_room_tariff is None or per_room_tariff <= 0:
            per_room_tariff = default_tariff

        per_room_deposit = item.get("deposit_amount")
        if per_room_deposit is None or per_room_deposit < 0:
            per_room_deposit = default_tariff  # sensible default = 1 night

        ch = Checkin(
            lodge_id=lodge_id,
            customer_id=customer.customer_id,
            room_id=rm.room_id,
            booking_id=linked_booking.booking_id if linked_booking else None,
            checkin_datetime=chk_datetime,
            expected_checkout=exp_checkout,
            members_count=members_count,
            deposit_amount=per_room_deposit,
            # Advance only on the first room of the group.
            advance_paid=(advance_to_apply if idx == 0 else 0),
            tariff_per_night=per_room_tariff,
            payment_mode=payment_mode,
            status=CheckinStatus.active,
            special_notes=special_notes,
            sms_alert_preference=sms_alert_preference,
            checked_in_by=current_user.user_id,
        )
        db.add(ch)
        rm.status = RoomStatus.occupied
        created.append((ch, rm))

    customer.total_visits = (customer.total_visits or 0) + 1

    # Mark the booking checked-in (link is set per-row above via booking_id).
    if linked_booking is not None:
        from ..models import BookingStatus
        linked_booking.status = BookingStatus.checked_in

    db.commit()
    for ch, _ in created:
        db.refresh(ch)

    # Audit each checkin (one row per room). Tag with lodge so super_admin
    # acting on a different lodge sees the audit in the right place.
    for ch, rm in created:
        try:
            log_audit(
                db, "checkin.created",
                actor_user_id=current_user.user_id,
                actor_username=current_user.username,
                entity_type="checkin", entity_id=ch.checkin_id,
                lodge_id=lodge_id,
                details={
                    "room_number": rm.room_number,
                    "customer_id": customer.customer_id,
                    "customer_name": f"{customer.first_name} {customer.last_name}",
                    "tariff_per_night": float(ch.tariff_per_night),
                    "deposit_amount": float(ch.deposit_amount),
                    "booking_id": linked_booking.booking_id if linked_booking else None,
                },
                ip_address=request.client.host if request and request.client else None,
            )
        except Exception:
            # Audit failure must never block a real check-in
            pass

    # India FRRO compliance: if the guest is on a passport, auto-create
    # a foreign-guest registration row in `pending` status so the admin
    # gets a reminder to file the C-Form within 24 hours.
    if customer.id_type == "passport":
        try:
            from ..models import ForeignGuestRegistration, ForeignGuestStatus
            for ch, _ in created:
                exists = (db.query(ForeignGuestRegistration)
                          .filter(ForeignGuestRegistration.checkin_id == ch.checkin_id,
                                  ForeignGuestRegistration.lodge_id == lodge_id).first())
                if not exists:
                    db.add(ForeignGuestRegistration(
                        lodge_id=lodge_id, customer_id=customer.customer_id,
                        checkin_id=ch.checkin_id,
                        passport_number=customer.id_number,
                        status=ForeignGuestStatus.pending,
                    ))
            db.commit()
        except Exception:
            # Never block check-in over compliance bookkeeping.
            pass

    # Trigger alerts for each room. Alert failures must not block the response.
    for ch, rm in created:
        try:
            trigger_checkin_alerts(db, ch, customer, rm, sms_alert_preference)
        except Exception:
            pass
        # v2.6 — welcome email (template-driven). Skips silently if the
        # guest doesn't have an email or SMTP isn't configured.
        try:
            from ..services.email_service import send_checkin_welcome
            send_checkin_welcome(db, ch)
        except Exception:
            pass

    return {
        "success": True,
        "customer_id": customer.customer_id,
        "count": len(created),
        "checkins": [
            {
                "checkin_id": ch.checkin_id,
                "room_id": rm.room_id,
                "room_number": rm.room_number,
                "tariff_per_night": float(ch.tariff_per_night),
                "deposit_amount": float(ch.deposit_amount),
            }
            for ch, rm in created
        ],
        # Back-compat fields for old callers that expect a single object.
        "checkin_id": created[0][0].checkin_id,
        "room_number": created[0][1].room_number,
        "tariff_per_night": float(created[0][0].tariff_per_night),
        "message": (
            f"{len(created)} room(s) checked in" if len(created) > 1 else "Check-in successful"
        ),
    }


@router.get("/history/{customer_id}")
def get_customer_checkin_history(customer_id: int, db: Session = Depends(get_db),
                                  current_user=Depends(get_current_user),
                                  lodge_id: int = Depends(resolve_lodge_scope)):
    checkins = db.query(Checkin).filter(
        Checkin.customer_id == customer_id,
        Checkin.lodge_id == lodge_id,
    ).order_by(Checkin.checkin_datetime.desc()).all()
    return [checkin_to_dict(ch) for ch in checkins]


@router.get("/{checkin_id}")
def get_checkin(checkin_id: int, db: Session = Depends(get_db),
                current_user=Depends(get_current_user),
                lodge_id: int = Depends(resolve_lodge_scope)):
    ch = db.query(Checkin).filter(
        Checkin.checkin_id == checkin_id,
        Checkin.lodge_id == lodge_id,
    ).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Check-in not found")
    return checkin_to_dict(ch)


from pydantic import BaseModel as PM


class CheckoutRequest(PM):
    additional_charges: float = 0
    discount: float = 0
    payment_mode: str = "cash"
    deposit_refunded: float = 0
    # v2.3 additions — apply a promo code and/or redeem loyalty points at
    # checkout. Both reduce the bill in addition to `discount` (manual).
    promo_code: Optional[str] = None
    loyalty_points_redeem: int = 0


@router.put("/{checkin_id}/checkout")
def process_checkout(checkin_id: int, body: CheckoutRequest,
                     request: Request,
                     db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    checkin = db.query(Checkin).filter(
        Checkin.checkin_id == checkin_id,
        Checkin.lodge_id == lodge_id,
        Checkin.status == CheckinStatus.active
    ).first()
    if not checkin:
        raise HTTPException(status_code=404, detail="Active check-in not found")

    room = checkin.room
    customer = checkin.customer
    checkout_time = datetime.now()

    # Calculate nights using the lodge 24-hour rule:
    # nights = ceil(total_hours / 24), minimum 1.  This MUST match the
    # frontend's `nightsBetween` (utils/datetime.js) so what the guest sees
    # in the Room Detail "Running tab" matches the invoice.
    # Plain `delta.days` would round DOWN — a 47-hour stay would be billed
    # as 1 night instead of 2. That's a real billing bug.
    delta = checkout_time - checkin.checkin_datetime
    total_hours = delta.total_seconds() / 3600
    nights = max(1, math.ceil(total_hours / 24))

    # Calculate amounts
    room_charges = nights * float(checkin.tariff_per_night)
    # Two sources of "extras":
    #  1. body.additional_charges — anything the desk staff entered manually
    #     in the checkout dialog (often used for a single ad-hoc number).
    #  2. Itemized folio charges added during the stay (food, laundry, etc).
    # We sum both so the total is consistent regardless of where the staffer
    # entered the data. The folio rollup also persists into
    # checkin.additional_charges below, so existing reports keep working.
    try:
        from .folio import total_for_checkin as _folio_total
        folio_total = _folio_total(db, checkin.checkin_id, lodge_id)
    except Exception:
        folio_total = 0.0
    additional = float(body.additional_charges or 0) + folio_total
    discount = body.discount

    # ── v2.3: Promo code & loyalty redemption ──────────────────────────
    # Both run BEFORE GST so the customer doesn't pay tax on the savings.
    # The subtotal we validate against = room_charges + additional (pre-GST,
    # pre-manual-discount). Promo and loyalty BOTH reduce the bill but are
    # tracked separately for audit + reporting.
    promo_discount = 0.0
    promo_info = None
    if body.promo_code:
        try:
            from .promos import redeem as _promo_redeem
            promo_info = _promo_redeem(
                db, lodge_id=lodge_id, code=body.promo_code,
                subtotal=room_charges + additional,
                checkin_id=checkin.checkin_id,
                customer_id=checkin.customer_id,
            )
            promo_discount = promo_info["discount_amount"]
        except HTTPException:
            raise
        except Exception:
            # Don't block checkout on a flaky promo redemption.
            promo_info = None

    loyalty_discount = 0.0
    loyalty_info = None
    if body.loyalty_points_redeem and body.loyalty_points_redeem > 0:
        try:
            point_value = float(get_setting(db, "loyalty_point_value_rupees", "1"))
            from ..models import LoyaltyAccount, LoyaltyTransaction, LoyaltyTxnType
            acc = (db.query(LoyaltyAccount)
                   .filter(LoyaltyAccount.lodge_id == lodge_id,
                           LoyaltyAccount.customer_id == checkin.customer_id).first())
            if not acc or (acc.current_balance or 0) < body.loyalty_points_redeem:
                raise HTTPException(status_code=400,
                                    detail="Insufficient loyalty points")
            acc.current_balance = (acc.current_balance or 0) - body.loyalty_points_redeem
            loyalty_discount = body.loyalty_points_redeem * point_value
            db.add(LoyaltyTransaction(
                lodge_id=lodge_id, account_id=acc.account_id,
                txn_type=LoyaltyTxnType.redeem,
                points=-body.loyalty_points_redeem,
                reason=f"Redeemed at checkout (stay #{checkin.checkin_id})",
                related_checkin_id=checkin.checkin_id,
            ))
            loyalty_info = {
                "points_redeemed": body.loyalty_points_redeem,
                "rupees": loyalty_discount,
                "new_balance": int(acc.current_balance),
            }
        except HTTPException:
            raise
        except Exception:
            loyalty_info = None

    # GST calculation — on the subtotal AFTER promo/loyalty discounts so
    # tax is on the actual money changing hands.
    taxable = max(0, room_charges + additional - promo_discount - loyalty_discount)
    gst_enabled = get_setting(db, "gst_enabled", "false").lower() == "true"
    gst_rate = float(get_setting(db, "gst_rate", "12"))
    gst_amount = 0
    if gst_enabled and float(checkin.tariff_per_night) > 1000:
        gst_amount = taxable * gst_rate / 100

    # Advance collected at booking time is credited against the bill.
    advance_adjusted = float(checkin.advance_paid or 0)

    # All discounts roll up into a single `discount` figure on the
    # invoice so reports stay simple. Audit log + redemption rows hold
    # the breakdown.
    total_discount = (discount or 0) + promo_discount + loyalty_discount
    total_amount = (room_charges + additional + gst_amount
                    - total_discount - advance_adjusted)
    if total_amount < 0:
        total_amount = 0
    # We use `total_discount` going forward; existing code references
    # `discount` so we update the binding.
    discount = total_discount

    # Generate invoice number
    date_str = checkout_time.strftime("%Y%m%d")
    # Per-lodge invoice numbering. Each lodge has its own running count
    # so RK Lodge's "INV-20260518-0001" doesn't clash with Udumulas's.
    invoice_count = db.query(Invoice).filter(Invoice.lodge_id == lodge_id).count() + 1
    invoice_number = f"INV-{date_str}-{invoice_count:04d}"

    # Create invoice
    invoice = Invoice(
        lodge_id=lodge_id,
        invoice_number=invoice_number,
        checkin_id=checkin_id,
        customer_id=customer.customer_id,
        room_id=room.room_id,
        checkin_datetime=checkin.checkin_datetime,
        checkout_datetime=checkout_time,
        nights=nights,
        tariff_per_night=checkin.tariff_per_night,
        room_charges=room_charges,
        deposit_paid=checkin.deposit_amount,
        deposit_refunded=body.deposit_refunded,
        advance_adjusted=advance_adjusted,
        additional_charges=additional,
        discount=discount,
        gst_amount=gst_amount,
        total_amount=total_amount,
        payment_mode=body.payment_mode
    )
    db.add(invoice)

    # Update checkin
    checkin.status = CheckinStatus.checked_out
    checkin.actual_checkout = checkout_time
    checkin.total_nights = nights
    checkin.total_amount = total_amount
    checkin.additional_charges = additional
    checkin.discount_amount = discount
    checkin.gst_amount = gst_amount
    checkin.payment_mode = body.payment_mode
    checkin.checked_out_by = current_user.user_id

    # Free up room — but mark it dirty so it can't be re-assigned until
    # housekeeping has cleaned it. The auto-created HousekeepingTask
    # (below) flips housekeeping_clean back to True when the cleaning is
    # complete + (optionally) inspected.
    room.status = RoomStatus.available
    room.housekeeping_clean = False
    try:
        from ..models import HousekeepingTask, HousekeepingTaskType, HousekeepingStatus
        db.add(HousekeepingTask(
            lodge_id=lodge_id, room_id=room.room_id,
            task_type=HousekeepingTaskType.checkout_clean,
            status=HousekeepingStatus.pending,
            notes=f"Auto-created after checkout of "
                  f"{customer.first_name} {customer.last_name}" if customer else None,
            triggered_by_checkin_id=checkin.checkin_id,
            created_by=current_user.user_id,
        ))
    except Exception:
        # Housekeeping table may not yet exist on a partially-migrated DB;
        # don't let that block the checkout.
        pass

    # If this stay came from a booking and all its rooms are now checked out,
    # mark the booking completed.
    if checkin.booking_id:
        from ..models import Booking, BookingStatus
        bk = db.query(Booking).filter(Booking.booking_id == checkin.booking_id).first()
        if bk:
            siblings_active = db.query(Checkin).filter(
                Checkin.booking_id == bk.booking_id,
                Checkin.status == CheckinStatus.active,
                Checkin.checkin_id != checkin_id,
            ).count()
            if siblings_active == 0:
                bk.status = BookingStatus.completed

    db.commit()
    db.refresh(invoice)

    # Audit log — checkout is a high-value, money-touching event so we
    # capture the key financial figures right on the audit row for fast
    # forensic queries ("show me every checkout with discount > 500").
    try:
        log_audit(
            db, "checkin.checked_out",
            actor_user_id=current_user.user_id,
            actor_username=current_user.username,
            entity_type="checkin", entity_id=checkin.checkin_id,
            lodge_id=lodge_id,
            details={
                "invoice_number": invoice_number,
                "nights": nights,
                "room_number": room.room_number if room else None,
                "total_amount": float(total_amount),
                "additional_charges": float(additional),
                "discount": float(discount),
                "deposit_refunded": float(body.deposit_refunded or 0),
                "payment_mode": body.payment_mode,
            },
            ip_address=request.client.host if request and request.client else None,
        )
    except Exception:
        pass

    # Trigger alerts
    try:
        trigger_checkout_alerts(db, checkin, invoice, customer, room)
    except Exception:
        pass

    # Auto-earn loyalty points based on invoice total. Wrapped in
    # try/except — never block checkout if loyalty plumbing has issues.
    try:
        from .loyalty import earn_for_checkout
        earn_for_checkout(db, lodge_id=lodge_id, customer_id=checkin.customer_id,
                          invoice_total=float(total_amount),
                          checkin_id=checkin.checkin_id,
                          invoice_id=invoice.invoice_id)
        db.commit()
    except Exception:
        pass

    # Auto-create a pending feedback request so the post-stay survey link
    # can be SMS'd to the guest. We don't fail checkout if this errors —
    # feedback is opportunistic, never blocking.
    try:
        from ..models import GuestFeedback
        import secrets
        from datetime import timedelta
        token = secrets.token_urlsafe(32)
        db.add(GuestFeedback(
            lodge_id=lodge_id,
            customer_id=checkin.customer_id,
            checkin_id=checkin.checkin_id,
            submit_token=token,
            token_expires_at=datetime.utcnow() + timedelta(days=30),
            guest_name=(f"{customer.first_name} {customer.last_name}" if customer else None),
        ))
        db.commit()
    except Exception:
        # Feedback table may not exist or commit may fail — never break checkout.
        pass

    # v2.6 — template-based post-stay thank-you email. Same non-blocking
    # contract as the legacy alerts above.
    try:
        from ..services.email_service import send_post_stay_thanks
        send_post_stay_thanks(db, checkin)
    except Exception:
        pass

    return {
        "invoice_id": invoice.invoice_id,
        "invoice_number": invoice_number,
        "nights": nights,
        "room_charges": room_charges,
        "additional_charges": additional,
        "gst_amount": gst_amount,
        "discount": discount,
        "advance_adjusted": advance_adjusted,
        "total_amount": total_amount,
        "deposit_paid": float(checkin.deposit_amount),
        "deposit_refunded": body.deposit_refunded,
        "message": "Checkout successful"
    }


@router.get("/room/{room_id}/active")
def get_active_checkin_for_room(
    room_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Get the currently active check-in for a given room."""
    checkin = db.query(Checkin).filter(
        Checkin.room_id == room_id,
        Checkin.lodge_id == lodge_id,
        Checkin.status == "active"
    ).first()
    if not checkin:
        raise HTTPException(status_code=404, detail="No active check-in for this room")
    return checkin_to_dict(checkin)


@router.get("/{checkin_id}/invoice/pdf")
def get_invoice_pdf(
    checkin_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    """Generate a simple PDF invoice for a checked-out stay."""
    from fastapi.responses import StreamingResponse
    import io

    invoice = db.query(Invoice).filter(
        Invoice.checkin_id == checkin_id,
        Invoice.lodge_id == lodge_id,
    ).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    checkin = db.query(Checkin).filter(
        Checkin.checkin_id == checkin_id,
        Checkin.lodge_id == lodge_id,
    ).first()
    customer = checkin.customer if checkin else None
    room = checkin.room if checkin else None

    # Per-lodge branding for the PDF header.
    hotel_name = get_setting(db, "hotel_name", "Lodge", lodge_id=lodge_id)
    hotel_address = get_setting(db, "hotel_address", "", lodge_id=lodge_id)
    hotel_phone = get_setting(db, "hotel_phone", "", lodge_id=lodge_id)
    gst_number = get_setting(db, "gst_number", "", lodge_id=lodge_id)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=20*mm, leftMargin=20*mm,
                                 topMargin=20*mm, bottomMargin=20*mm)
        styles = getSampleStyleSheet()
        story = []

        # Header
        story.append(Paragraph(hotel_name, ParagraphStyle("title", fontSize=20, fontName="Helvetica-Bold",
                                                            textColor=colors.HexColor("#1B2A4A"))))
        if hotel_address:
            story.append(Paragraph(hotel_address, styles["Normal"]))
        if hotel_phone:
            story.append(Paragraph(f"Tel: {hotel_phone}", styles["Normal"]))
        if gst_number:
            story.append(Paragraph(f"GSTIN: {gst_number}", styles["Normal"]))
        story.append(Spacer(1, 8*mm))

        # Invoice info
        story.append(Paragraph(f"<b>INVOICE</b>", ParagraphStyle("h2", fontSize=14, fontName="Helvetica-Bold")))
        story.append(Paragraph(f"Invoice No: {invoice.invoice_number}", styles["Normal"]))
        story.append(Paragraph(f"Date: {invoice.checkout_datetime.strftime('%d %b %Y') if invoice.checkout_datetime else 'N/A'}", styles["Normal"]))
        story.append(Spacer(1, 5*mm))

        # Guest info
        story.append(Paragraph("<b>Guest Details</b>", styles["Heading2"]))
        if customer:
            story.append(Paragraph(f"Name: {customer.first_name} {customer.last_name}", styles["Normal"]))
            story.append(Paragraph(f"Phone: {customer.phone}", styles["Normal"]))
        story.append(Spacer(1, 5*mm))

        # Stay details table
        data = [
            ["Description", "Details", "Amount (₹)"],
            ["Room", room.room_number if room else "N/A", ""],
            ["Check-in", invoice.checkin_datetime.strftime("%d %b %Y %H:%M") if invoice.checkin_datetime else "-", ""],
            ["Check-out", invoice.checkout_datetime.strftime("%d %b %Y %H:%M") if invoice.checkout_datetime else "-", ""],
            ["Nights", str(invoice.nights), ""],
            ["Tariff per night", f"₹{invoice.tariff_per_night:,.0f}", ""],
            ["Room Charges", "", f"₹{invoice.room_charges:,.2f}"],
        ]
        if invoice.additional_charges:
            data.append(["Additional Charges", "", f"₹{invoice.additional_charges:,.2f}"])
        if invoice.gst_amount:
            data.append(["GST", "", f"₹{invoice.gst_amount:,.2f}"])
        if invoice.discount:
            data.append(["Discount", "", f"-₹{invoice.discount:,.2f}"])
        if getattr(invoice, "advance_adjusted", 0):
            data.append(["Advance Adjusted", "", f"-₹{invoice.advance_adjusted:,.2f}"])
        data.append(["TOTAL PAYABLE", "", f"₹{invoice.total_amount:,.2f}"])
        data.append(["Deposit Paid", "", f"₹{invoice.deposit_paid:,.2f}"])
        if getattr(invoice, "deposit_refunded", 0):
            data.append(["Deposit Refunded", "", f"₹{invoice.deposit_refunded:,.2f}"])

        tbl = Table(data, colWidths=[90*mm, 60*mm, 40*mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1B2A4A")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, -2), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -2), (-1, -1), colors.HexColor("#FFF9E6")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("PADDING", (0, 0), (-1, -1), 6),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 8*mm))
        story.append(Paragraph("Thank you for staying with us. We look forward to welcoming you again!",
                                ParagraphStyle("footer", fontSize=10, textColor=colors.grey)))

        doc.build(story)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/pdf",
                                  headers={"Content-Disposition": f"attachment; filename={invoice.invoice_number}.pdf"})
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF generation requires reportlab. Install it in the backend.")
