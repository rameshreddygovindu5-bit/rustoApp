"""
Tool registry for the operational agent.

Each tool is a small async function that:
  - takes (ctx: ToolContext, **inputs)
  - performs ONE concrete action (a DB read, a DB write, an audit-logged change)
  - returns a JSON-serializable result (or raises ToolError on user-correctable issues)

Tools call the SQLAlchemy layer directly — NOT HTTP back to FastAPI — for speed.
Audit-logging, business validation, and webhook dispatch are preserved by reusing
the same models/services the routers use.

Permissions are enforced via `policy.check_tool_permission(user, tool_name)`.
Confirmation requirements live in `policy.WRITE_TOOLS`.
"""
from __future__ import annotations
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Awaitable


def _utcnow():
    """Return naive UTC datetime — SQLite only accepts naive (no-tzinfo) datetimes."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func, desc, cast, Date as SqlDate

from ...models import (
    User, Customer, Room, Checkin, Booking, Invoice, Setting, Alert,
    RoomStatus, RoomType, CheckinStatus, BookingStatus, BookingSource,
    PaymentMode, IDType, AlertType, AlertEvent, AlertStatus,
    Agency, AgencyStatus,
)
from ..audit_service import log_audit

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
@dataclass
class ToolContext:
    db: Session
    user: User
    ip: Optional[str] = None
    request_id: Optional[str] = None

    @property
    def lodge_id(self) -> int:
        """The lodge every tool query MUST be scoped by. Falls back to 1
        defensively but in practice every authenticated user has one."""
        return self.user.lodge_id if self.user and self.user.lodge_id else 1

    def audit(self, action: str, **kwargs):
        log_audit(
            self.db,
            action=action,
            actor_user_id=self.user.user_id,
            actor_username=self.user.username,
            actor_type="user_via_agent",
            ip_address=self.ip,
            lodge_id=self.lodge_id,
            **kwargs,
        )


class ToolError(Exception):
    """Tool-level error meant to be shown to the user (not a 500)."""


# ──────────────────────────────────────────────────────────────────────────
TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {}


def tool(
    name: str,
    description: str,
    input_schema: Dict[str, Any],
    *,
    write: bool = False,
    admin_only: bool = False,
    auto_run: bool = False,
):
    """Register a tool. `auto_run` for trivially-safe writes that don't need confirm."""
    def decorator(fn: Callable[..., Awaitable[Any]]):
        TOOL_REGISTRY[name] = {
            "fn": fn,
            "spec": {
                "name": name,
                "description": description,
                "input_schema": input_schema,
            },
            "write": write,
            "admin_only": admin_only,
            "auto_run": auto_run,
        }
        return fn
    return decorator


def get_tool_specs(user_role: str) -> List[Dict]:
    """Return tool specs in the shape Anthropic / OpenAI expect, filtered by role."""
    out = []
    for name, meta in TOOL_REGISTRY.items():
        if meta["admin_only"] and user_role != "admin":
            continue
        out.append(meta["spec"])
    return out


# ──────────────────────────────────────────────────────────────────────────
# Helpers
def _setting(db: Session, key: str, default: str = "", lodge_id: Optional[int] = None) -> str:
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    s = q.first()
    return s.setting_value if s and s.setting_value else default


def _enum_val(v) -> str:
    return getattr(v, "value", v) if v is not None else None


def _customer_brief(c: Customer) -> Dict:
    return {
        "customer_id": c.customer_id,
        "name": f"{c.first_name} {c.last_name}".strip(),
        "phone": c.phone,
        "email": c.email,
        "is_vip": c.is_vip,
        "blacklisted": c.blacklisted,
        "total_visits": c.total_visits or 0,
    }


def _room_brief(r: Room) -> Dict:
    return {
        "room_id": r.room_id,
        "room_number": r.room_number,
        "floor": r.floor,
        "type": _enum_val(r.room_type),
        "has_ac": r.has_ac,
        "base_tariff": float(r.base_tariff or 0),
        "max_occupancy": r.max_occupancy,
        "status": _enum_val(r.status),
        "housekeeping_clean": r.housekeeping_clean,
    }


def _checkin_brief(ch: Checkin) -> Dict:
    return {
        "checkin_id": ch.checkin_id,
        "room_number": ch.room.room_number if ch.room else None,
        "guest": f"{ch.customer.first_name} {ch.customer.last_name}".strip()
                  if ch.customer else "—",
        "phone": ch.customer.phone if ch.customer else None,
        "checkin_at": ch.checkin_datetime.isoformat() if ch.checkin_datetime else None,
        "expected_checkout": ch.expected_checkout.isoformat() if ch.expected_checkout else None,
        "deposit": float(ch.deposit_amount or 0),
        "tariff_per_night": float(ch.tariff_per_night or 0),
        "members": ch.members_count,
        "status": _enum_val(ch.status),
    }


def _booking_brief(b: Booking) -> Dict:
    return {
        "booking_id": b.booking_id,
        "booking_ref": b.booking_ref,
        "guest_name": b.guest_name,
        "guest_phone": b.guest_phone,
        "source": _enum_val(b.source),
        "status": _enum_val(b.status),
        "agency_name": b.agency.name if b.agency else None,
        "checkin_date": b.checkin_date.isoformat() if b.checkin_date else None,
        "checkout_date": b.checkout_date.isoformat() if b.checkout_date else None,
        "nights": b.nights,
        "rooms_count": b.rooms_count or 1,
        "room_type": _enum_val(b.room_type_requested),
        "room_number": b.room.room_number if b.room else None,
        "tariff_per_night": float(b.tariff_per_night or 0),
        "total_amount": float(b.total_amount or 0),
        "advance_amount": float(b.advance_amount or 0),
        "balance_due": float(b.total_amount or 0) - float(b.advance_amount or 0),
    }


def _resolve_room(db: Session, q: str, lodge_id: Optional[int] = None) -> Optional[Room]:
    """Resolve a room by id or number, scoped to a lodge if given."""
    q = (q or "").strip()
    if not q:
        return None
    def _scope(query):
        return query.filter(Room.lodge_id == lodge_id) if lodge_id is not None else query
    if q.isdigit() and len(q) <= 4:
        # Could be a room_id (small ints) OR a room_number — try number first
        r = _scope(db.query(Room).filter(Room.room_number == q)).first()
        if r:
            return r
        return _scope(db.query(Room).filter(Room.room_id == int(q))).first()
    return _scope(db.query(Room).filter(Room.room_number == q)).first()


# ════════════════════════════════════════════════════════════════════════════
# READ TOOLS
# ════════════════════════════════════════════════════════════════════════════
@tool(
    name="get_dashboard_stats",
    description=(
        "Get today's lodge dashboard: occupancy, available rooms, today's checkins, "
        "overdue, upcoming arrivals, revenue. Use this to give the user a quick status."
    ),
    input_schema={"type": "object", "properties": {}},
)
async def get_dashboard_stats(ctx: ToolContext):
    db = ctx.db
    rooms_total = db.query(Room).filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True).count()
    rooms_occupied = (db.query(Checkin)
                      .filter(Checkin.lodge_id == ctx.lodge_id, Checkin.status == CheckinStatus.active).count())
    rooms_avail = (db.query(Room)
                   .filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True,
                           Room.status == RoomStatus.available).count())
    rooms_maint = (db.query(Room)
                   .filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True,
                           Room.status == RoomStatus.maintenance).count())

    today = date.today()
    todays_checkins = (db.query(Checkin)
                       .filter(Checkin.lodge_id == ctx.lodge_id, cast(Checkin.checkin_datetime, SqlDate) == today).count())
    # expected_checkout is a DateTime — compare against now() for overdue.
    overdue = (db.query(Checkin)
               .filter(Checkin.lodge_id == ctx.lodge_id, Checkin.status == CheckinStatus.active,
                       Checkin.expected_checkout < datetime.now(),
                       Checkin.expected_checkout.isnot(None)).count())

    upcoming = (db.query(Booking)
                .filter(Booking.lodge_id == ctx.lodge_id, Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                        Booking.checkin_date >= today,
                        Booking.checkin_date <= today + timedelta(days=7))
                .count())

    revenue_today = db.query(func.coalesce(func.sum(Invoice.total_amount), 0))\
        .filter(Invoice.lodge_id == ctx.lodge_id, cast(Invoice.checkout_datetime, SqlDate) == today).scalar() or 0
    revenue_mtd = db.query(func.coalesce(func.sum(Invoice.total_amount), 0))\
        .filter(Invoice.lodge_id == ctx.lodge_id, func.extract('month', Invoice.checkout_datetime) == today.month,
                func.extract('year',  Invoice.checkout_datetime) == today.year).scalar() or 0

    occupancy_pct = round((rooms_occupied / rooms_total) * 100, 1) if rooms_total else 0
    return {
        "rooms_total": rooms_total,
        "rooms_occupied": rooms_occupied,
        "rooms_available": rooms_avail,
        "rooms_maintenance": rooms_maint,
        "occupancy_pct": occupancy_pct,
        "checkins_today": todays_checkins,
        "overdue_checkouts": overdue,
        "upcoming_arrivals_7d": upcoming,
        "revenue_today": float(revenue_today),
        "revenue_month_to_date": float(revenue_mtd),
        "as_of": _utcnow().isoformat() + "Z",
    }


@tool(
    name="list_rooms",
    description="List all rooms with their current status. Optionally filter by status or floor.",
    input_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["available", "occupied", "maintenance", "blocked"]},
            "floor": {"type": "integer", "description": "Filter to a specific floor (1, 2, or 3)"},
            "room_type": {"type": "string", "enum": ["deluxe_ac", "ac", "non_ac", "house"]},
        },
    },
)
async def list_rooms(ctx: ToolContext, status: Optional[str] = None,
                     floor: Optional[int] = None, room_type: Optional[str] = None):
    q = ctx.db.query(Room).filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True)
    if status:
        q = q.filter(Room.status == status)
    if floor:
        q = q.filter(Room.floor == floor)
    if room_type:
        q = q.filter(Room.room_type == room_type)
    rooms = q.order_by(Room.floor, Room.room_number).all()
    return {"count": len(rooms), "rooms": [_room_brief(r) for r in rooms]}


@tool(
    name="list_available_rooms",
    description="List rooms that are currently available for check-in.",
    input_schema={
        "type": "object",
        "properties": {
            "room_type": {"type": "string", "enum": ["deluxe_ac", "ac", "non_ac", "house"],
                          "description": "Optional: only this room type"},
        },
    },
)
async def list_available_rooms(ctx: ToolContext, room_type: Optional[str] = None):
    q = ctx.db.query(Room).filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True,
                                   Room.status == RoomStatus.available)
    if room_type:
        q = q.filter(Room.room_type == room_type)
    rooms = q.order_by(Room.room_type, Room.room_number).all()
    return {"count": len(rooms), "rooms": [_room_brief(r) for r in rooms]}


@tool(
    name="search_customers",
    description=(
        "Find customers by name, phone (full or partial), or ID number. "
        "Returns a list of matches with their visit history summary."
    ),
    input_schema={
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "description": "Name, phone, or ID number"},
            "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50},
        },
    },
)
async def search_customers(ctx: ToolContext, query: str, limit: int = 10):
    q = (query or "").strip()
    if len(q) < 2:
        raise ToolError("Search query must be at least 2 characters.")
    like = f"%{q}%"
    customers = (ctx.db.query(Customer)
                 .filter(Customer.lodge_id == ctx.lodge_id, or_(
                     Customer.phone.like(like),
                     Customer.first_name.ilike(like),
                     Customer.last_name.ilike(like),
                     Customer.id_number.like(like),
                 ))
                 .order_by(desc(Customer.total_visits), desc(Customer.updated_at))
                 .limit(min(limit, 50))
                 .all())
    return {"count": len(customers),
            "customers": [_customer_brief(c) for c in customers]}


@tool(
    name="get_customer_detail",
    description="Get full customer record including stay history.",
    input_schema={
        "type": "object",
        "required": ["customer_id"],
        "properties": {
            "customer_id": {"type": "integer"},
        },
    },
)
async def get_customer_detail(ctx: ToolContext, customer_id: int):
    c = ctx.db.query(Customer).filter(Customer.customer_id == customer_id, Customer.lodge_id == ctx.lodge_id).first()
    if not c:
        raise ToolError(f"Customer #{customer_id} not found.")
    history = (ctx.db.query(Checkin)
               .filter(Checkin.customer_id == customer_id, Checkin.lodge_id == ctx.lodge_id)
               .order_by(desc(Checkin.checkin_datetime))
               .limit(10).all())
    return {
        **_customer_brief(c),
        "address": c.address,
        "id_type": _enum_val(c.id_type),
        "id_number": c.id_number,
        "nationality": c.nationality,
        "blacklist_reason": c.blacklist_reason,
        "history": [_checkin_brief(h) for h in history],
    }


@tool(
    name="list_active_checkins",
    description="List all guests currently staying (active check-ins).",
    input_schema={"type": "object", "properties": {}},
)
async def list_active_checkins(ctx: ToolContext):
    rows = (ctx.db.query(Checkin)
            .filter(Checkin.lodge_id == ctx.lodge_id, Checkin.status == CheckinStatus.active)
            .order_by(Checkin.expected_checkout.asc().nulls_last(),
                      Checkin.checkin_datetime).all())
    return {"count": len(rows), "checkins": [_checkin_brief(r) for r in rows]}


@tool(
    name="list_overdue_checkins",
    description="List active check-ins whose expected checkout has passed.",
    input_schema={"type": "object", "properties": {}},
)
async def list_overdue_checkins(ctx: ToolContext):
    now = datetime.now()
    today = now.date()
    rows = (ctx.db.query(Checkin)
            .filter(Checkin.lodge_id == ctx.lodge_id, Checkin.status == CheckinStatus.active,
                    Checkin.expected_checkout < now,
                    Checkin.expected_checkout.isnot(None))
            .order_by(Checkin.expected_checkout).all())
    return {"count": len(rows),
            "checkins": [{
                **_checkin_brief(r),
                # expected_checkout is a DateTime — take .date() before
                # subtracting so we get whole-day "days overdue" counts.
                "days_overdue": (today - r.expected_checkout.date()).days
                                 if r.expected_checkout else 0,
            } for r in rows]}


@tool(
    name="list_upcoming_arrivals",
    description="List bookings expected to arrive in the next N days.",
    input_schema={
        "type": "object",
        "properties": {
            "days": {"type": "integer", "default": 7, "minimum": 1, "maximum": 60},
        },
    },
)
async def list_upcoming_arrivals(ctx: ToolContext, days: int = 7):
    today = date.today()
    end = today + timedelta(days=max(1, min(days, 60)))
    rows = (ctx.db.query(Booking)
            .filter(Booking.lodge_id == ctx.lodge_id, Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                    Booking.checkin_date >= today,
                    Booking.checkin_date <= end)
            .order_by(Booking.checkin_date).all())
    return {"count": len(rows), "bookings": [_booking_brief(b) for b in rows]}


@tool(
    name="list_bookings",
    description=(
        "List bookings with filters (status, source, date range, search by guest)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["pending", "confirmed", "checked_in",
                                                  "completed", "cancelled", "no_show"]},
            "source": {"type": "string", "enum": ["walk_in", "direct", "agency", "corporate"]},
            "search": {"type": "string", "description": "Search guest name, phone, ref"},
            "from_date": {"type": "string", "format": "date"},
            "to_date": {"type": "string", "format": "date"},
            "limit": {"type": "integer", "default": 25, "minimum": 1, "maximum": 100},
        },
    },
)
async def list_bookings(ctx: ToolContext, status=None, source=None, search=None,
                        from_date=None, to_date=None, limit=25):
    q = ctx.db.query(Booking).filter(Booking.lodge_id == ctx.lodge_id)
    if status:
        q = q.filter(Booking.status == status)
    if source:
        q = q.filter(Booking.source == source)
    if from_date:
        q = q.filter(Booking.checkin_date >= from_date)
    if to_date:
        q = q.filter(Booking.checkin_date <= to_date)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            Booking.guest_name.ilike(like),
            Booking.guest_phone.like(like),
            Booking.booking_ref.like(like),
            Booking.agency_booking_ref.like(like),
        ))
    rows = q.order_by(desc(Booking.created_at)).limit(min(limit, 100)).all()
    return {"count": len(rows), "bookings": [_booking_brief(b) for b in rows]}


@tool(
    name="get_revenue_report",
    description="Revenue summary for a date range.",
    input_schema={
        "type": "object",
        "properties": {
            "from_date": {"type": "string", "format": "date"},
            "to_date": {"type": "string", "format": "date"},
        },
    },
)
async def get_revenue_report(ctx: ToolContext, from_date=None, to_date=None):
    today = date.today()
    fd = from_date or (today - timedelta(days=30)).isoformat()
    td = to_date or today.isoformat()
    rows = (ctx.db.query(
                cast(Invoice.checkout_datetime, SqlDate).label("d"),
                func.sum(Invoice.total_amount).label("rev"),
                func.count(Invoice.invoice_id).label("count"))
            .filter(Invoice.lodge_id == ctx.lodge_id,
                    cast(Invoice.checkout_datetime, SqlDate) >= fd,
                    cast(Invoice.checkout_datetime, SqlDate) <= td)
            .group_by(cast(Invoice.checkout_datetime, SqlDate))
            .order_by(cast(Invoice.checkout_datetime, SqlDate))
            .all())
    total_rev = sum(float(r.rev or 0) for r in rows)
    total_inv = sum(int(r.count or 0) for r in rows)
    return {
        "from": fd, "to": td,
        "total_revenue": total_rev,
        "total_invoices": total_inv,
        "average_per_invoice": round(total_rev / total_inv, 2) if total_inv else 0,
        "daily": [{"date": str(r.d), "revenue": float(r.rev or 0),
                   "invoices": int(r.count or 0)} for r in rows],
    }


@tool(
    name="find_checkin_for_checkout",
    description=(
        "Find an active check-in by room number OR guest phone — useful as the first "
        "step before checking someone out. Returns the checkin id and a summary."
    ),
    input_schema={
        "type": "object",
        "required": ["room_or_phone"],
        "properties": {
            "room_or_phone": {"type": "string", "description": "Room number or phone"},
        },
    },
)
async def find_checkin_for_checkout(ctx: ToolContext, room_or_phone: str):
    q = (room_or_phone or "").strip()
    if not q:
        raise ToolError("Pass a room number or phone.")
    db = ctx.db

    if q.isdigit() and len(q) == 10:
        cust = db.query(Customer).filter(Customer.phone == q, Customer.lodge_id == ctx.lodge_id).first()
        if not cust:
            raise ToolError(f"No customer found with phone {q}.")
        ci = (db.query(Checkin)
              .filter(Checkin.customer_id == cust.customer_id,
                      Checkin.lodge_id == ctx.lodge_id,
                      Checkin.status == CheckinStatus.active)
              .order_by(desc(Checkin.checkin_datetime)).first())
    else:
        room = db.query(Room).filter(Room.room_number == q, Room.lodge_id == ctx.lodge_id).first()
        if not room:
            raise ToolError(f"Room {q} not found.")
        ci = (db.query(Checkin)
              .filter(Checkin.room_id == room.room_id,
                      Checkin.lodge_id == ctx.lodge_id,
                      Checkin.status == CheckinStatus.active).first())
    if not ci:
        raise ToolError(f"No active check-in for {q}.")
    return _checkin_brief(ci)


# ════════════════════════════════════════════════════════════════════════════
# WRITE TOOLS — confirmation required (unless auto_run=True)
# ════════════════════════════════════════════════════════════════════════════
@tool(
    name="set_room_state",
    description=(
        "Update a room's state. Use this for housekeeping or maintenance. "
        "Allowed: clean, dirty, maintenance, available, blocked."
    ),
    input_schema={
        "type": "object",
        "required": ["room_number", "state"],
        "properties": {
            "room_number": {"type": "string"},
            "state": {"type": "string", "enum": ["clean", "dirty", "maintenance",
                                                 "available", "blocked"]},
            "note": {"type": "string"},
        },
    },
    write=True, auto_run=True,
)
async def set_room_state(ctx: ToolContext, room_number: str, state: str,
                         note: Optional[str] = None):
    room = _resolve_room(ctx.db, room_number, lodge_id=ctx.lodge_id)
    if not room:
        raise ToolError(f"Room {room_number} not found.")

    state = state.lower()
    if state == "clean":
        room.housekeeping_clean = True
    elif state == "dirty":
        room.housekeeping_clean = False
    elif state == "maintenance":
        if room.status == RoomStatus.occupied:
            raise ToolError(f"Room {room.room_number} is occupied — cannot set to maintenance.")
        room.status = RoomStatus.maintenance
    elif state == "available":
        if room.status == RoomStatus.occupied:
            raise ToolError(f"Room {room.room_number} is occupied — cannot mark available.")
        room.status = RoomStatus.available
    elif state == "blocked":
        if room.status == RoomStatus.occupied:
            raise ToolError(f"Room {room.room_number} is occupied — cannot block.")
        room.status = RoomStatus.blocked
    ctx.db.commit()
    ctx.audit(action=f"room.{state}", entity_type="room",
              entity_id=room.room_id,
              details={"room_number": room.room_number, "note": note})
    return {"ok": True, "room_number": room.room_number,
            "status": _enum_val(room.status), "clean": room.housekeeping_clean}


@tool(
    name="create_customer",
    description=(
        "Create a customer record. Use BEFORE create_checkin if the guest is new. "
        "Phone must be 10 digits. id_type one of: aadhar, driving_license, voter_id, passport, pan."
    ),
    input_schema={
        "type": "object",
        "required": ["first_name", "last_name", "phone", "id_type", "id_number"],
        "properties": {
            "first_name": {"type": "string"},
            "last_name": {"type": "string"},
            "phone": {"type": "string", "description": "10-digit phone"},
            "email": {"type": "string"},
            "address": {"type": "string"},
            "id_type": {"type": "string",
                        "enum": ["aadhar", "driving_license", "voter_id", "passport", "pan"]},
            "id_number": {"type": "string"},
            "nationality": {"type": "string", "default": "Indian"},
            "is_vip": {"type": "boolean", "default": False},
        },
    },
    write=True,
)
async def create_customer(ctx: ToolContext, first_name, last_name, phone,
                          id_type, id_number, email=None, address=None,
                          nationality="Indian", is_vip=False):
    phone = re.sub(r"\D", "", str(phone or ""))
    if len(phone) != 10:
        raise ToolError("Phone must be exactly 10 digits.")

    existing = ctx.db.query(Customer).filter(
        Customer.phone == phone,
        Customer.lodge_id == ctx.lodge_id,
    ).first()
    if existing:
        if existing.blacklisted:
            raise ToolError(
                f"A customer with phone {phone} exists and is blacklisted: "
                f"{existing.blacklist_reason}"
            )
        # Reactivate if soft-deleted, refresh ID details if missing.
        if not existing.is_active:
            existing.is_active = True
        if not existing.id_number:
            existing.id_number = id_number
            existing.id_type = id_type
            ctx.db.commit()
        return {"ok": True, "already_exists": True,
                "customer": _customer_brief(existing)}

    c = Customer(
        lodge_id=ctx.lodge_id,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        phone=phone, email=email, address=address,
        id_type=id_type, id_number=id_number,
        nationality=nationality, is_vip=is_vip,
    )
    ctx.db.add(c)
    ctx.db.commit()
    ctx.db.refresh(c)
    ctx.audit(action="customer.created", entity_type="customer",
              entity_id=c.customer_id,
              details={"name": f"{first_name} {last_name}", "phone": phone})
    return {"ok": True, "already_exists": False, "customer": _customer_brief(c)}


@tool(
    name="create_checkin",
    description=(
        "Check a guest into a room. The guest must already exist (use search_customers "
        "or create_customer first). Tariff is automatically taken from settings unless "
        "overridden. expected_checkout accepts 'YYYY-MM-DDTHH:MM' (preferred, includes "
        "checkout time) or 'YYYY-MM-DD' (defaults to noon). Defaults to check-in + 24h. "
        "If the guest has a confirmed advance booking pass booking_id to link them; the "
        "booking's advance payment is credited and the booking is marked checked_in."
    ),
    input_schema={
        "type": "object",
        "required": ["customer_id", "room_id"],
        "properties": {
            "customer_id": {"type": "integer"},
            "room_id": {"type": "integer"},
            "booking_id": {"type": "integer",
                           "description": "Optional: link this check-in to a confirmed advance booking."},
            "members_count": {"type": "integer", "default": 1, "minimum": 1},
            "deposit_amount": {"type": "number", "minimum": 0},
            "expected_checkout": {"type": "string",
                                  "description": "ISO date or datetime. e.g. '2026-05-08T10:30'"},
            "tariff_per_night": {"type": "number"},
            "payment_mode": {"type": "string",
                             "enum": ["cash", "card", "upi", "online"], "default": "cash"},
            "sms_alerts": {"type": "boolean", "default": True},
            "special_notes": {"type": "string"},
        },
    },
    write=True,
)
async def create_checkin(ctx: ToolContext, customer_id: int, room_id: int,
                         booking_id: Optional[int] = None,
                         members_count: int = 1,
                         deposit_amount: Optional[float] = None,
                         expected_checkout: Optional[str] = None,
                         tariff_per_night: Optional[float] = None,
                         payment_mode: str = "cash",
                         sms_alerts: bool = True,
                         special_notes: Optional[str] = None):
    db = ctx.db
    customer = db.query(Customer).filter(
        Customer.customer_id == customer_id,
        Customer.lodge_id == ctx.lodge_id,
    ).first()
    if not customer:
        raise ToolError(f"Customer #{customer_id} not found.")
    if customer.blacklisted:
        raise ToolError(f"Guest is blacklisted: {customer.blacklist_reason}")

    # Block double-occupancy: same guest can't have two active check-ins.
    already = (db.query(Checkin)
               .filter(Checkin.customer_id == customer.customer_id,
                       Checkin.lodge_id == ctx.lodge_id,
                       Checkin.status == CheckinStatus.active).first())
    if already:
        existing_room = (db.query(Room)
                         .filter(Room.room_id == already.room_id,
                                 Room.lodge_id == ctx.lodge_id).first())
        rn = existing_room.room_number if existing_room else "?"
        raise ToolError(
            f"{customer.first_name} {customer.last_name} is already checked into "
            f"room {rn} (check-in #{already.checkin_id}). Check them out first."
        )

    room = db.query(Room).filter(
        Room.room_id == room_id,
        Room.lodge_id == ctx.lodge_id,
    ).with_for_update().first()
    if not room:
        raise ToolError(f"Room #{room_id} not found.")
    if room.status != RoomStatus.available:
        raise ToolError(f"Room {room.room_number} is not available "
                        f"(status: {_enum_val(room.status)}).")

    # ── Resolve linked booking (parity with manual UI flow) ──────────────
    linked_booking = None
    if booking_id:
        linked_booking = db.query(Booking).filter(
            Booking.booking_id == booking_id,
            Booking.lodge_id == ctx.lodge_id,
        ).first()
        if not linked_booking:
            raise ToolError(f"Booking #{booking_id} not found.")
        if linked_booking.checkin or linked_booking.status == BookingStatus.checked_in:
            raise ToolError(f"Booking {linked_booking.booking_ref} is already checked in.")
        if linked_booking.guest_phone and linked_booking.guest_phone != customer.phone:
            raise ToolError(
                f"Booking {linked_booking.booking_ref} is for phone "
                f"{linked_booking.guest_phone}, not {customer.phone}."
            )
    else:
        today = date.today()
        linked_booking = (db.query(Booking)
                          .filter(Booking.lodge_id == ctx.lodge_id,
                                  Booking.guest_phone == customer.phone,
                                  Booking.status.in_([BookingStatus.confirmed,
                                                      BookingStatus.pending]),
                                  Booking.checkin_date == today)
                          .order_by(Booking.created_at).first())

    # Tariff: explicit > settings > base_tariff
    if tariff_per_night is None:
        key_map = {"deluxe_ac": "tariff_deluxe_ac", "ac": "tariff_ac",
                   "non_ac": "tariff_non_ac", "house": "tariff_house"}
        rt = _enum_val(room.room_type)
        snap = _setting(db, key_map.get(rt, ""), "", lodge_id=ctx.lodge_id)
        try:
            tariff_per_night = float(snap) if snap else float(room.base_tariff)
        except ValueError:
            tariff_per_night = float(room.base_tariff)

    if deposit_amount is None:
        try:
            deposit_amount = float(_setting(db, "default_deposit", "500", lodge_id=ctx.lodge_id))
        except ValueError:
            deposit_amount = 500.0

    exp_co = None
    if expected_checkout:
        # Accept both 'YYYY-MM-DDTHH:MM' (full datetime) and 'YYYY-MM-DD'
        # (legacy date-only — defaults to noon on that day).
        try:
            exp_co = datetime.fromisoformat(expected_checkout)
        except ValueError:
            try:
                d = date.fromisoformat(expected_checkout)
                exp_co = datetime.combine(d, datetime.min.time().replace(hour=12))
            except ValueError:
                raise ToolError(
                    "expected_checkout must be ISO format "
                    "('YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD')."
                )
    else:
        # Default = check-in time + 24 hours (lodge convention).
        exp_co = datetime.now() + timedelta(days=1)

    # Credit booking advance toward the stay so the final bill matches the
    # UI's "from booking" check-in flow.
    advance_paid = 0.0
    if linked_booking:
        advance_paid = float(linked_booking.advance_amount or 0)

    ch = Checkin(
        lodge_id=ctx.lodge_id,
        customer_id=customer.customer_id,
        room_id=room.room_id,
        booking_id=linked_booking.booking_id if linked_booking else None,
        checkin_datetime=_utcnow(),
        expected_checkout=exp_co,
        members_count=members_count,
        deposit_amount=Decimal(str(deposit_amount)),
        advance_paid=Decimal(str(advance_paid)),
        tariff_per_night=Decimal(str(tariff_per_night)),
        payment_mode=payment_mode,
        status=CheckinStatus.active,
        special_notes=special_notes,
        sms_alert_preference="yes" if sms_alerts else "no",
        checked_in_by=ctx.user.user_id,
    )
    db.add(ch)
    room.status = RoomStatus.occupied
    room.housekeeping_clean = False
    customer.total_visits = (customer.total_visits or 0) + 1
    if linked_booking:
        linked_booking.status = BookingStatus.checked_in
        if linked_booking.room_id is None:
            linked_booking.room_id = room.room_id
    db.commit()
    db.refresh(ch)

    ctx.audit(action="checkin.created", entity_type="checkin",
              entity_id=ch.checkin_id,
              details={"room": room.room_number,
                       "guest_id": customer.customer_id,
                       "booking_id": linked_booking.booking_id if linked_booking else None})
    if linked_booking:
        ctx.audit(action="booking.checked_in", entity_type="booking",
                  entity_id=linked_booking.booking_id,
                  details={"checkin_id": ch.checkin_id,
                           "booking_ref": linked_booking.booking_ref})

    # Trigger checkin alerts (best effort, non-blocking) — pass full args
    try:
        from ..alert_service import trigger_checkin_alerts
        trigger_checkin_alerts(db, ch, customer, room,
                                sms_preference=("yes" if sms_alerts else "no"))
    except Exception as e:
        logger.warning(f"Checkin alert dispatch failed: {e}")

    # The UI's manual check-in accepts an ID-proof image; the agent's JSON
    # tool API does not. Surface this gap so the assistant can ask the user
    # to upload the ID from the Customers screen instead of silently leaving
    # a compliance hole.
    needs_id_upload = not bool(customer.id_proof_path)

    result = {
        "ok": True, "checkin": _checkin_brief(ch),
        "applied_tariff": float(tariff_per_night),
        "applied_deposit": float(deposit_amount),
        "needs_id_upload": needs_id_upload,
        "customer_id": customer.customer_id,
    }
    if linked_booking:
        result["linked_booking_ref"] = linked_booking.booking_ref
        result["advance_credited"] = advance_paid
    if needs_id_upload:
        result["follow_up"] = (
            f"ID proof image is missing for {customer.first_name} "
            f"{customer.last_name}. Please upload it from "
            f"Customers → {customer.phone} → Upload ID before "
            f"the guest leaves the lobby."
        )
    return result


@tool(
    name="checkout_guest",
    description=(
        "Check out an active guest. Generates the invoice and frees the room. "
        "additional_charges and discount are optional."
    ),
    input_schema={
        "type": "object",
        "required": ["checkin_id"],
        "properties": {
            "checkin_id": {"type": "integer"},
            "additional_charges": {"type": "number", "default": 0, "minimum": 0},
            "discount_amount": {"type": "number", "default": 0, "minimum": 0},
            "payment_mode": {"type": "string",
                             "enum": ["cash", "card", "upi", "online"], "default": "cash"},
            "deposit_refunded": {"type": "number"},
        },
    },
    write=True,
)
async def checkout_guest(ctx: ToolContext, checkin_id: int,
                         additional_charges: float = 0,
                         discount_amount: float = 0,
                         payment_mode: str = "cash",
                         deposit_refunded: Optional[float] = None):
    db = ctx.db
    ch = (db.query(Checkin).filter(Checkin.checkin_id == checkin_id,
                                    Checkin.lodge_id == ctx.lodge_id,
                                    Checkin.status == CheckinStatus.active).first())
    if not ch:
        raise ToolError(f"No active check-in #{checkin_id}.")

    now = _utcnow()
    elapsed = (now - ch.checkin_datetime).total_seconds() / 86400
    nights = max(1, int(elapsed) + (1 if elapsed % 1 > 0 else 0))
    room_charges = nights * float(ch.tariff_per_night or 0)
    gst_amount = 0.0
    if _setting(db, "gst_enabled", "false", lodge_id=ctx.lodge_id).lower() == "true":
        try:
            gst_pct = float(_setting(db, "gst_rate", "12", lodge_id=ctx.lodge_id))
            gst_amount = round(room_charges * gst_pct / 100, 2)
        except ValueError:
            gst_amount = 0.0
    total = round(room_charges + float(additional_charges or 0) + gst_amount
                  - float(discount_amount or 0), 2)

    ch.actual_checkout = now
    ch.total_nights = nights
    ch.total_amount = Decimal(str(total))
    ch.additional_charges = Decimal(str(additional_charges or 0))
    ch.discount_amount = Decimal(str(discount_amount or 0))
    ch.gst_amount = Decimal(str(gst_amount))
    ch.payment_mode = payment_mode
    ch.status = CheckinStatus.checked_out
    ch.checked_out_by = ctx.user.user_id

    # Free the room (lodge-scoped lookup, defensive — ch.room_id implies same lodge)
    room = db.query(Room).filter(
        Room.room_id == ch.room_id,
        Room.lodge_id == ctx.lodge_id,
    ).first()
    if room:
        room.status = RoomStatus.available
        room.housekeeping_clean = False  # needs cleaning between guests

    # Generate invoice number — month + lodge scoped so the two lodges don't
    # collide on INV-{ym}-0001.
    ym = now.strftime("%Y%m")
    prefix = f"INV-{ym}-"
    last = (db.query(Invoice).filter(
                Invoice.lodge_id == ctx.lodge_id,
                Invoice.invoice_number.like(prefix + "%"))
            .order_by(desc(Invoice.invoice_id)).first())
    seq = 1
    if last:
        try:
            seq = int(last.invoice_number.split("-")[-1]) + 1
        except Exception:
            seq = (last.invoice_id or 0) + 1
    invoice_number = f"{prefix}{seq:04d}"
    deposit_paid = float(ch.deposit_amount or 0)
    refunded = float(deposit_refunded) if deposit_refunded is not None else deposit_paid

    # Idempotent: reuse existing invoice rather than hitting UNIQUE constraint
    existing_inv = db.query(Invoice).filter(
        Invoice.checkin_id == ch.checkin_id
    ).first()
    if existing_inv:
        invoice = existing_inv
        invoice.checkout_datetime = now
        invoice.nights = nights
        invoice.room_charges = Decimal(str(room_charges))
        invoice.gst_amount = Decimal(str(gst_amount))
        invoice.total_amount = Decimal(str(total))
        invoice.payment_mode = payment_mode
        invoice_number = existing_inv.invoice_number
    else:
        invoice = Invoice(
            lodge_id=ctx.lodge_id,
            invoice_number=invoice_number,
            checkin_id=ch.checkin_id,
            customer_id=ch.customer_id,
            room_id=ch.room_id,
            checkin_datetime=ch.checkin_datetime,
            checkout_datetime=now,
            nights=nights,
            tariff_per_night=ch.tariff_per_night,
            room_charges=Decimal(str(room_charges)),
            deposit_paid=Decimal(str(deposit_paid)),
            deposit_refunded=Decimal(str(refunded)),
            additional_charges=Decimal(str(additional_charges or 0)),
            discount=Decimal(str(discount_amount or 0)),
            gst_amount=Decimal(str(gst_amount)),
            total_amount=Decimal(str(total)),
            payment_mode=payment_mode,
        )
        db.add(invoice)
    db.commit()
    db.refresh(invoice)

    ctx.audit(action="checkin.checked_out", entity_type="checkin",
              entity_id=ch.checkin_id,
              details={"invoice": invoice_number, "total": total, "nights": nights})

    # Reload customer for alert dispatch (already in session, just for clarity)
    customer = db.query(Customer).filter(Customer.customer_id == ch.customer_id).first()
    try:
        from ..alert_service import trigger_checkout_alerts
        if customer and room:
            trigger_checkout_alerts(db, ch, invoice, customer, room)
    except Exception as e:
        logger.warning(f"Checkout alert dispatch failed: {e}")

    return {
        "ok": True,
        "invoice_number": invoice_number,
        "nights": nights,
        "room_charges": room_charges,
        "additional_charges": float(additional_charges or 0),
        "gst": gst_amount,
        "discount": float(discount_amount or 0),
        "deposit_refunded": refunded,
        "total": total,
        "room_freed": room.room_number if room else None,
    }


@tool(
    name="create_booking",
    description=(
        "Create a future reservation (not an immediate check-in). Use this when a "
        "caller asks to book rooms in advance. For walk-ins arriving now, use "
        "create_checkin instead. Supports booking several rooms of the same type "
        "under one reservation (rooms_count) and recording an advance/prepayment "
        "(advance_amount). Use ISO dates (YYYY-MM-DD)."
    ),
    input_schema={
        "type": "object",
        "required": ["guest_name", "guest_phone", "room_type",
                     "checkin_date", "checkout_date", "tariff_per_night"],
        "properties": {
            "guest_name": {"type": "string"},
            "guest_phone": {"type": "string", "description": "10-digit phone"},
            "guest_email": {"type": "string"},
            "room_type": {"type": "string",
                          "enum": ["deluxe_ac", "ac", "non_ac", "house"]},
            "rooms_count": {"type": "integer", "default": 1, "minimum": 1, "maximum": 20,
                            "description": "How many rooms of this type to reserve."},
            "checkin_date": {"type": "string", "format": "date"},
            "checkout_date": {"type": "string", "format": "date"},
            "adults": {"type": "integer", "default": 1, "minimum": 1},
            "children": {"type": "integer", "default": 0, "minimum": 0},
            "tariff_per_night": {"type": "number",
                                 "description": "Rent per room per night."},
            "advance_amount": {"type": "number", "default": 0,
                               "description": "Advance/prepayment collected now."},
            "advance_payment_mode": {"type": "string", "default": "cash",
                                     "enum": ["cash", "card", "upi", "online"]},
            "special_requests": {"type": "string"},
        },
    },
    write=True,
)
async def create_booking(ctx: ToolContext, guest_name, guest_phone, room_type,
                         checkin_date, checkout_date, tariff_per_night,
                         guest_email=None, adults=1, children=0,
                         rooms_count=1, advance_amount=0,
                         advance_payment_mode="cash", special_requests=None):
    phone = re.sub(r"\D", "", str(guest_phone or ""))
    if len(phone) != 10:
        raise ToolError("Phone must be 10 digits.")
    try:
        ci = date.fromisoformat(checkin_date)
        co = date.fromisoformat(checkout_date)
    except ValueError:
        raise ToolError("Dates must be ISO format YYYY-MM-DD.")
    if co <= ci:
        raise ToolError("checkout_date must be after checkin_date.")
    if ci < date.today():
        raise ToolError("checkin_date cannot be in the past.")
    if room_type not in [t.value for t in RoomType]:
        raise ToolError(f"Invalid room_type: {room_type}")
    if float(tariff_per_night) <= 0:
        raise ToolError("tariff_per_night must be positive.")

    rooms_count = max(1, int(rooms_count or 1))
    nights = (co - ci).days
    # Total covers every room for every night.
    total = round(float(tariff_per_night) * nights * rooms_count, 2)
    advance = round(max(0.0, float(advance_amount or 0)), 2)
    if advance > total:
        raise ToolError(f"Advance (₹{advance}) cannot exceed booking total (₹{total}).")

    db = ctx.db
    # Per-lodge booking ref prefix (same convention as the bookings router).
    from ...models import Lodge
    lodge = db.query(Lodge).filter(Lodge.lodge_id == ctx.lodge_id).first()
    code_prefix = (lodge.code[:3].upper() if lodge and lodge.code else "UDM")
    today = _utcnow()
    prefix = f"{code_prefix}-{today.strftime('%Y%m')}-"
    last = (db.query(Booking).filter(
                Booking.lodge_id == ctx.lodge_id,
                Booking.booking_ref.like(prefix + "%"))
            .order_by(desc(Booking.booking_id)).first())
    seq = 1
    if last:
        try:
            seq = int(last.booking_ref.split("-")[-1]) + 1
        except Exception:
            seq = (last.booking_id or 0) + 1
    booking_ref = f"{prefix}{seq:04d}"

    b = Booking(
        lodge_id=ctx.lodge_id,
        booking_ref=booking_ref,
        source=BookingSource.direct,
        guest_name=guest_name,
        guest_phone=phone,
        guest_email=guest_email,
        room_type_requested=RoomType(room_type),
        rooms_count=rooms_count,
        checkin_date=ci,
        checkout_date=co,
        nights=nights,
        adults=adults, children=children,
        tariff_per_night=Decimal(str(tariff_per_night)),
        total_amount=Decimal(str(total)),
        advance_amount=Decimal(str(advance)),
        advance_payment_mode=advance_payment_mode or "cash",
        payment_status=("paid" if total > 0 and advance >= total
                        else "partial" if advance > 0 else "unpaid"),
        status=BookingStatus.confirmed,
        special_requests=special_requests,
        created_by_user_id=ctx.user.user_id,
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    ctx.audit(action="booking.created", entity_type="booking",
              entity_id=b.booking_id,
              details={"ref": booking_ref, "guest": guest_name,
                       "rooms": rooms_count, "advance": advance})
    return {"ok": True, "booking": _booking_brief(b),
            "summary": (f"Booked {rooms_count} {room_type.replace('_', ' ')} room(s) "
                        f"for {guest_name}, {ci.isoformat()} to {co.isoformat()} "
                        f"({nights} night(s)). Total ₹{total:.0f}, "
                        f"advance ₹{advance:.0f}, balance ₹{total - advance:.0f}. "
                        f"Reference {booking_ref}.")}


@tool(
    name="cancel_booking",
    description="Cancel a future booking by booking_id.",
    input_schema={
        "type": "object",
        "required": ["booking_id"],
        "properties": {
            "booking_id": {"type": "integer"},
            "reason": {"type": "string"},
        },
    },
    write=True,
)
async def cancel_booking(ctx: ToolContext, booking_id: int, reason: Optional[str] = None):
    b = ctx.db.query(Booking).filter(Booking.booking_id == booking_id, Booking.lodge_id == ctx.lodge_id).first()
    if not b:
        raise ToolError(f"Booking #{booking_id} not found.")
    if b.status in [BookingStatus.cancelled, BookingStatus.completed,
                    BookingStatus.checked_in, BookingStatus.no_show]:
        raise ToolError(f"Cannot cancel a booking in status: {_enum_val(b.status)}.")
    b.status = BookingStatus.cancelled
    b.cancelled_at = _utcnow()
    b.cancellation_reason = reason or "Cancelled via agent"
    ctx.db.commit()
    ctx.audit(action="booking.cancelled", entity_type="booking",
              entity_id=b.booking_id, details={"reason": reason})

    if b.agency_id and b.agency:
        try:
            from ..webhook_service import queue_webhook
            queue_webhook(ctx.db, b.agency, b, "booking.cancelled")
        except Exception as e:
            logger.warning(f"Webhook dispatch failed: {e}")

    return {"ok": True, "booking_ref": b.booking_ref,
            "status": _enum_val(b.status)}


@tool(
    name="set_customer_vip",
    description="Mark a customer as VIP or remove VIP flag.",
    input_schema={
        "type": "object",
        "required": ["customer_id", "is_vip"],
        "properties": {
            "customer_id": {"type": "integer"},
            "is_vip": {"type": "boolean"},
        },
    },
    write=True, auto_run=True,
)
async def set_customer_vip(ctx: ToolContext, customer_id: int, is_vip: bool):
    c = ctx.db.query(Customer).filter(Customer.customer_id == customer_id, Customer.lodge_id == ctx.lodge_id).first()
    if not c:
        raise ToolError(f"Customer #{customer_id} not found.")
    c.is_vip = bool(is_vip)
    ctx.db.commit()
    ctx.audit(action=f"customer.vip_{'set' if is_vip else 'unset'}",
              entity_type="customer", entity_id=customer_id)
    return {"ok": True, "customer_id": customer_id, "is_vip": c.is_vip}


@tool(
    name="send_custom_alert",
    description=(
        "Queue an SMS/email alert to a customer. The alert will be sent by the "
        "scheduler if SMS/email is enabled in settings."
    ),
    input_schema={
        "type": "object",
        "required": ["customer_id", "message"],
        "properties": {
            "customer_id": {"type": "integer"},
            "message": {"type": "string"},
            "alert_type": {"type": "string", "enum": ["sms", "email"], "default": "sms"},
        },
    },
    write=True,
)
async def send_custom_alert(ctx: ToolContext, customer_id: int, message: str,
                            alert_type: str = "sms"):
    c = ctx.db.query(Customer).filter(Customer.customer_id == customer_id, Customer.lodge_id == ctx.lodge_id).first()
    if not c:
        raise ToolError(f"Customer #{customer_id} not found.")
    recipient = c.phone if alert_type == "sms" else (c.email or "")
    if not recipient:
        raise ToolError(f"Customer has no {alert_type} address on file.")

    # Fail fast on bad recipients so the agent reply is honest about what
    # will/won't be sent (the same checks run again inside send_sms /
    # send_email when the scheduler picks the row up).
    from ..alert_service import normalize_indian_phone, is_valid_email
    if alert_type == "sms":
        try:
            recipient = normalize_indian_phone(recipient)
        except ValueError as e:
            raise ToolError(str(e))
    else:
        if not is_valid_email(recipient):
            raise ToolError(f"Customer's email '{recipient}' is not a valid address.")

    a = Alert(
        lodge_id=ctx.lodge_id,
        customer_id=customer_id,
        alert_type=AlertType(alert_type),
        event_type=AlertEvent.custom,
        recipient=recipient,
        message_content=message,
        status=AlertStatus.pending,
    )
    ctx.db.add(a)
    ctx.db.commit()
    ctx.audit(action="alert.queued", entity_type="alert", entity_id=a.alert_id,
              details={"customer_id": customer_id, "type": alert_type})
    return {"ok": True, "alert_id": a.alert_id, "status": "pending",
            "recipient": recipient}


# ════════════════════════════════════════════════════════════════════════════
# ADMIN-ONLY
# ════════════════════════════════════════════════════════════════════════════
@tool(
    name="list_agencies",
    description="(Admin) List all OTA / agency partners.",
    input_schema={"type": "object", "properties": {}},
    admin_only=True,
)
async def list_agencies_tool(ctx: ToolContext):
    rows = ctx.db.query(Agency).filter(Agency.lodge_id == ctx.lodge_id).order_by(desc(Agency.created_at)).all()
    return {"count": len(rows), "agencies": [{
        "agency_id": a.agency_id, "name": a.name, "code": a.code,
        "status": _enum_val(a.status),
        "total_bookings": a.total_bookings,
        "total_revenue": float(a.total_revenue or 0),
        "commission_pct": float(a.commission_pct or 0),
        "rate_markup_pct": float(a.rate_markup_pct or 0),
    } for a in rows]}


@tool(
    name="set_agency_status",
    description="(Admin) Suspend, activate, or revoke an agency partner.",
    input_schema={
        "type": "object",
        "required": ["agency_id", "status"],
        "properties": {
            "agency_id": {"type": "integer"},
            "status": {"type": "string", "enum": ["active", "suspended", "revoked"]},
        },
    },
    write=True, admin_only=True,
)
async def set_agency_status_tool(ctx: ToolContext, agency_id: int, status: str):
    a = ctx.db.query(Agency).filter(Agency.agency_id == agency_id, Agency.lodge_id == ctx.lodge_id).first()
    if not a:
        raise ToolError(f"Agency #{agency_id} not found.")
    a.status = status
    ctx.db.commit()
    ctx.audit(action=f"agency.{status}", entity_type="agency", entity_id=agency_id)
    return {"ok": True, "agency_id": agency_id, "status": status}


# ════════════════════════════════════════════════════════════════════════════
# UTILITY  — used by quick actions to compose multi-step flows
# ════════════════════════════════════════════════════════════════════════════
@tool(
    name="suggest_room",
    description=(
        "Recommend the best available room for a given party size and preference. "
        "Returns the cheapest available room that fits the requirements, plus 2 alternatives."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "members": {"type": "integer", "default": 1, "minimum": 1},
            "needs_ac": {"type": "boolean"},
            "preferred_floor": {"type": "integer"},
            "max_budget": {"type": "number"},
        },
    },
)
async def suggest_room(ctx: ToolContext, members: int = 1, needs_ac: Optional[bool] = None,
                       preferred_floor: Optional[int] = None,
                       max_budget: Optional[float] = None):
    q = ctx.db.query(Room).filter(Room.lodge_id == ctx.lodge_id, Room.is_active == True,
                                   Room.status == RoomStatus.available,
                                   Room.max_occupancy >= members)
    if needs_ac is True:
        q = q.filter(Room.has_ac == True)
    elif needs_ac is False:
        q = q.filter(Room.has_ac == False)
    if max_budget:
        q = q.filter(Room.base_tariff <= max_budget)

    rooms = q.all()
    if not rooms:
        raise ToolError("No rooms match those constraints. Try relaxing filters.")

    def score(r: Room) -> float:
        s = float(r.base_tariff or 0)  # cheaper is better baseline
        if preferred_floor and r.floor == preferred_floor:
            s -= 200
        if r.housekeeping_clean:
            s -= 50
        return s

    rooms.sort(key=score)
    pick = rooms[0]
    alts = rooms[1:3]
    return {
        "recommendation": _room_brief(pick),
        "reason": (
            f"Cheapest available {_enum_val(pick.room_type).replace('_', ' ')} "
            f"on floor {pick.floor} for {members} guest(s) "
            f"at ₹{float(pick.base_tariff)}/night."
        ),
        "alternatives": [_room_brief(r) for r in alts],
    }
