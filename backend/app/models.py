from sqlalchemy import (Column, Integer, String, Text, DateTime, Date, Numeric,
                        Boolean, Enum, ForeignKey, func, Index, LargeBinary)
from sqlalchemy.orm import relationship
from .database import Base
import enum


class UserRole(str, enum.Enum):
    # `super_admin` can create lodges, see across all lodges, and assign users.
    # `admin` is scoped to one lodge but has full rights inside it.
    # `staff` is also scoped to one lodge with reduced rights.
    super_admin = "super_admin"
    admin = "admin"
    staff = "staff"


class Lodge(Base):
    """A tenant. Each row is one lodge/hotel. All other business-data tables
    carry a lodge_id pointing here. Login binds a user to one lodge; every
    query at runtime is filtered by that lodge."""
    __tablename__ = "lodges"
    lodge_id = Column(Integer, primary_key=True, autoincrement=True)
    # Short code used in URLs / logs (e.g. 'udumulas', 'rk'). Lower-case,
    # no spaces. Unique.
    code = Column(String(40), unique=True, nullable=False, index=True)
    name = Column(String(120), nullable=False)
    address = Column(Text)
    phone = Column(String(20))
    email = Column(String(120))
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class RoomType(str, enum.Enum):
    deluxe_ac = "deluxe_ac"
    ac = "ac"
    non_ac = "non_ac"
    house = "house"


class RoomStatus(str, enum.Enum):
    available = "available"
    occupied = "occupied"
    maintenance = "maintenance"
    blocked = "blocked"


class CheckinStatus(str, enum.Enum):
    active = "active"
    checked_out = "checked_out"
    cancelled = "cancelled"


class PaymentMode(str, enum.Enum):
    cash = "cash"
    card = "card"
    upi = "upi"
    online = "online"


class AlertType(str, enum.Enum):
    sms = "sms"
    email = "email"


class AlertEvent(str, enum.Enum):
    checkin = "checkin"
    checkout = "checkout"
    reminder = "reminder"
    overdue = "overdue"
    custom = "custom"
    daily_summary = "daily_summary"
    booking = "booking"
    booking_cancelled = "booking_cancelled"


class AlertStatus(str, enum.Enum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    skipped = "skipped"


class IDType(str, enum.Enum):
    aadhar = "aadhar"
    driving_license = "driving_license"
    voter_id = "voter_id"
    passport = "passport"
    pan = "pan"


class BookingStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    checked_in = "checked_in"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class BookingSource(str, enum.Enum):
    walk_in = "walk_in"
    direct = "direct"
    agency = "agency"
    corporate = "corporate"


class AgencyStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    revoked = "revoked"


class WebhookStatus(str, enum.Enum):
    pending = "pending"
    delivered = "delivered"
    failed = "failed"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Multi-tenant: usernames are unique WITHIN a lodge, not across.
        # Two lodges may each have a 'manager' user. For super_admin users
        # (lodge_id IS NULL) the row's uniqueness comes from a separate
        # partial-unique-index on plain `username`, applied in
        # `_apply_per_lodge_uniqueness()` at startup. (SQLite treats NULLs
        # as distinct in composite indexes which is the right semantics here.)
        Index("ix_users_lodge_username", "lodge_id", "username", unique=True),
    )

    user_id = Column(Integer, primary_key=True, autoincrement=True)
    # The lodge this user belongs to. NULL is reserved for super_admin who
    # operates across all lodges.
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=True, index=True)
    lodge = relationship("Lodge")
    # Plain username column — uniqueness is per-lodge (see __table_args__).
    username = Column(String(50), nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.staff)
    email = Column(String(100))
    phone = Column(String(15))
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime)
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    # ── v2.4 two-factor authentication (TOTP) ─────────────────────────
    # When `totp_enabled` is True, the login flow requires a 6-digit code
    # from the user's authenticator app (Google Authenticator, Authy, etc.)
    # in addition to the password. `totp_secret` is the base32 shared
    # secret that pairs the account with the app.
    totp_secret = Column(String(64))         # base32 secret; NULL = unenrolled
    totp_enabled = Column(Boolean, default=False)
    # ── v3.2 permissions (RBAC beyond role) ───────────────────────────
    # JSON-encoded list of permission keys ("bookings.write", etc.) the
    # user is explicitly granted. NULL/empty means: fall back to legacy
    # role-based defaults (staff = all read+write on operational stuff;
    # admin/super_admin = everything). Used only for `staff` role —
    # admin/super_admin always have full access regardless.
    permissions = Column(Text)                # JSON array as string
    created_at = Column(DateTime, default=func.now())

    checkins_done = relationship("Checkin", foreign_keys="Checkin.checked_in_by", back_populates="checkin_staff")
    checkouts_done = relationship("Checkin", foreign_keys="Checkin.checked_out_by", back_populates="checkout_staff")


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (
        # Same guest phone can legitimately belong to two different lodges
        # if a person stays at both — so uniqueness is per-lodge.
        Index("ix_customers_lodge_phone", "lodge_id", "phone", unique=True),
    )

    customer_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    phone = Column(String(15), nullable=False)
    email = Column(String(100))
    address = Column(Text)
    city = Column(String(50))
    state = Column(String(50))
    id_type = Column(String(20), nullable=False, default="aadhar")
    id_number = Column(String(30), nullable=False)
    id_proof_path = Column(String(255))
    date_of_birth = Column(Date)
    nationality = Column(String(50), default="Indian")
    gender = Column(String(10)) # M, F, Other
    total_visits = Column(Integer, default=0)
    is_vip = Column(Boolean, default=False)
    blacklisted = Column(Boolean, default=False)
    blacklist_reason = Column(Text)
    imported_from_excel = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    sms_opt_in = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    checkins = relationship("Checkin", back_populates="customer")
    bookings = relationship("Booking", back_populates="customer")
    alerts = relationship("Alert", back_populates="customer")

    __table_args__ = (
        Index("ix_customers_phone", "phone"),
        Index("ix_customers_id_number", "id_number"),
        Index("ix_customers_name", "first_name", "last_name"),
    )


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (
        # "Room 101" in Udumulas and "Room 101" in RK Lodge are different
        # rooms in different physical buildings — uniqueness is per-lodge.
        Index("ix_rooms_lodge_number", "lodge_id", "room_number", unique=True),
    )

    room_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    room_number = Column(String(10), nullable=False)
    floor = Column(Integer, nullable=False)
    room_type = Column(String(20), nullable=False)
    has_ac = Column(Boolean, nullable=False, default=False)
    base_tariff = Column(Numeric(10, 2), nullable=False)
    max_occupancy = Column(Integer, default=2)
    amenities = Column(Text)
    status = Column(String(20), default="available")
    is_active = Column(Boolean, default=True)
    description = Column(Text)
    housekeeping_clean = Column(Boolean, default=True)

    checkins = relationship("Checkin", back_populates="room")
    bookings = relationship("Booking", back_populates="room")

    __table_args__ = (
        Index("ix_rooms_status", "status"),
    )


class Checkin(Base):
    __tablename__ = "checkins"

    checkin_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=False)
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    checkin_datetime = Column(DateTime, nullable=False, default=func.now())
    # Stored as full DateTime so 24-hour lodge stays can specify check-out time
    # (e.g. 08-May-2026 10:30 AM). Legacy date-only values still parse correctly
    # when read from SQLite because they round-trip as midnight datetimes.
    expected_checkout = Column(DateTime)
    actual_checkout = Column(DateTime)
    members_count = Column(Integer, default=1)
    deposit_amount = Column(Numeric(10, 2), nullable=False, default=0)
    # Prepayment carried over from a Booking's advance_amount. Credited
    # against the final bill at checkout (distinct from the refundable deposit).
    advance_paid = Column(Numeric(10, 2), default=0)
    tariff_per_night = Column(Numeric(10, 2), nullable=False)
    total_nights = Column(Integer)
    total_amount = Column(Numeric(10, 2))
    discount_amount = Column(Numeric(10, 2), default=0)
    additional_charges = Column(Numeric(10, 2), default=0)
    gst_amount = Column(Numeric(10, 2), default=0)
    payment_mode = Column(String(20))
    status = Column(String(20), default="active")
    special_notes = Column(Text)
    sms_alert_preference = Column(String(3), default="yes")
    checked_in_by = Column(Integer, ForeignKey("users.user_id"))
    checked_out_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now())

    customer = relationship("Customer", back_populates="checkins")
    room = relationship("Room", back_populates="checkins")
    booking = relationship("Booking", back_populates="checkin", foreign_keys=[booking_id])
    checkin_staff = relationship("User", foreign_keys=[checked_in_by], back_populates="checkins_done")
    checkout_staff = relationship("User", foreign_keys=[checked_out_by], back_populates="checkouts_done")
    invoice = relationship("Invoice", back_populates="checkin", uselist=False)
    alerts = relationship("Alert", back_populates="checkin")

    __table_args__ = (
        Index("ix_checkins_customer", "customer_id"),
        Index("ix_checkins_room_status", "room_id", "status"),
        Index("ix_checkins_expected_checkout", "status", "expected_checkout"),
    )


class Invoice(Base):
    __tablename__ = "invoices"

    invoice_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    invoice_number = Column(String(20), unique=True, nullable=False)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), unique=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"))
    room_id = Column(Integer, ForeignKey("rooms.room_id"))
    checkin_datetime = Column(DateTime, nullable=False)
    checkout_datetime = Column(DateTime, nullable=False)
    nights = Column(Integer, nullable=False)
    tariff_per_night = Column(Numeric(10, 2), nullable=False)
    room_charges = Column(Numeric(10, 2), nullable=False)
    deposit_paid = Column(Numeric(10, 2), default=0)
    deposit_refunded = Column(Numeric(10, 2), default=0)
    # Advance/prepayment collected at booking time and credited against this
    # invoice's total. Shown as a deduction line on the bill.
    advance_adjusted = Column(Numeric(10, 2), default=0)
    additional_charges = Column(Numeric(10, 2), default=0)
    discount = Column(Numeric(10, 2), default=0)
    gst_amount = Column(Numeric(10, 2), default=0)
    total_amount = Column(Numeric(10, 2), nullable=False)
    payment_mode = Column(String(20))
    is_printed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=func.now())

    checkin = relationship("Checkin", back_populates="invoice")
    customer = relationship("Customer")
    room = relationship("Room")


class Alert(Base):
    __tablename__ = "alerts"

    alert_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    alert_type = Column(Enum(AlertType), nullable=False)
    event_type = Column(Enum(AlertEvent), nullable=False)
    recipient = Column(String(100), nullable=False)
    message_content = Column(Text, nullable=False)
    status = Column(Enum(AlertStatus), default=AlertStatus.pending)
    sent_at = Column(DateTime)
    error_message = Column(Text)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())

    checkin = relationship("Checkin", back_populates="alerts")
    customer = relationship("Customer", back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_checkin_type", "checkin_id", "alert_type"),
        Index("ix_alerts_status_retry", "status", "retry_count"),
    )


class Setting(Base):
    """Lodge-scoped settings. Each lodge has its own hotel_name, logo,
    tariffs, Twilio creds, etc. Uniqueness is (lodge_id, setting_key)."""
    __tablename__ = "settings"
    __table_args__ = (
        Index("ix_settings_lodge_key", "lodge_id", "setting_key", unique=True),
    )

    setting_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    # NOT globally unique any more — uniqueness is (lodge_id, setting_key).
    setting_key = Column(String(100), nullable=False)
    setting_value = Column(Text, nullable=False)
    setting_group = Column(String(50))
    description = Column(String(255))
    is_sensitive = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50))
    ip_address = Column(String(45))
    success = Column(Boolean, default=False)
    attempted_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  AGENCY / PARTNER INTEGRATION (Goibibo, MakeMyTrip, Booking.com etc.)
# ════════════════════════════════════════════════════════════════════
class Agency(Base):
    """A travel-agency / OTA partner. Each gets an api_key + api_secret."""
    __tablename__ = "agencies"
    __table_args__ = (
        # Each lodge has its own set of partners — two lodges can both have
        # a 'makemytrip' partner code because they're separate businesses.
        Index("ix_agencies_lodge_code", "lodge_id", "code", unique=True),
    )

    agency_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    # Plain code — uniqueness per-lodge via the composite index above.
    code = Column(String(30), nullable=False)
    contact_email = Column(String(100), nullable=False)
    contact_phone = Column(String(15))
    contact_person = Column(String(100))
    address = Column(Text)
    website = Column(String(200))

    # api_key remains globally unique — it's the credential used to identify
    # the partner across the whole installation regardless of which lodge it
    # belongs to. Two partners sharing an api_key would break auth.
    api_key = Column(String(64), unique=True, nullable=False, index=True)
    api_secret_hash = Column(String(255), nullable=False)

    webhook_url = Column(String(300))
    webhook_secret = Column(String(64))

    commission_pct = Column(Numeric(5, 2), default=10.00)
    rate_markup_pct = Column(Numeric(5, 2), default=0.00)
    allowed_room_types = Column(String(200), default="deluxe_ac,ac,non_ac,house")
    daily_booking_limit = Column(Integer, default=0)
    max_advance_days = Column(Integer, default=180)

    total_bookings = Column(Integer, default=0)
    total_revenue = Column(Numeric(12, 2), default=0)

    status = Column(Enum(AgencyStatus), default=AgencyStatus.active)
    last_used_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now())
    created_by = Column(Integer, ForeignKey("users.user_id"))
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    bookings = relationship("Booking", back_populates="agency")
    api_calls = relationship("AgencyApiCall", back_populates="agency", cascade="all, delete-orphan")

    __table_args__ = (Index("ix_agency_status", "status"),)


class AgencyApiCall(Base):
    __tablename__ = "agency_api_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    agency_id = Column(Integer, ForeignKey("agencies.agency_id"), nullable=False)
    method = Column(String(10), nullable=False)
    path = Column(String(255), nullable=False)
    ip_address = Column(String(45))
    status_code = Column(Integer)
    response_ms = Column(Integer)
    error_message = Column(Text)
    request_id = Column(String(40))
    called_at = Column(DateTime, default=func.now(), index=True)

    agency = relationship("Agency", back_populates="api_calls")


class Booking(Base):
    """A reservation (intent to stay). Walk-ins also create one for unified reporting."""
    __tablename__ = "bookings"

    booking_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    booking_ref = Column(String(20), unique=True, nullable=False, index=True)

    source = Column(Enum(BookingSource), default=BookingSource.direct, nullable=False)
    agency_id = Column(Integer, ForeignKey("agencies.agency_id"), nullable=True)
    agency_booking_ref = Column(String(60))

    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=True)
    guest_name = Column(String(100), nullable=False)
    guest_phone = Column(String(15), nullable=False)
    guest_email = Column(String(100))

    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True)
    room_type_requested = Column(Enum(RoomType), nullable=False)
    # Number of rooms reserved under this booking (phone reservations often
    # book several rooms of the same type for one group). Rooms are assigned
    # individually at actual check-in time.
    rooms_count = Column(Integer, default=1, nullable=False)
    checkin_date = Column(Date, nullable=False)
    checkout_date = Column(Date, nullable=False)
    nights = Column(Integer, nullable=False)
    adults = Column(Integer, default=1)
    children = Column(Integer, default=0)

    tariff_per_night = Column(Numeric(10, 2), nullable=False)
    total_amount = Column(Numeric(10, 2), nullable=False)
    # Advance / prepayment collected when the reservation is made. At
    # check-in this is carried into the stay as a prepaid credit against the
    # final bill (it is NOT the refundable security deposit).
    advance_amount = Column(Numeric(10, 2), default=0, nullable=False)
    advance_payment_mode = Column(String(20), default="cash")
    commission_amount = Column(Numeric(10, 2), default=0)
    payment_status = Column(String(20), default="unpaid")

    status = Column(Enum(BookingStatus), default=BookingStatus.pending, nullable=False)
    cancelled_at = Column(DateTime)
    cancellation_reason = Column(Text)
    special_requests = Column(Text)

    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    created_by_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True)

    customer = relationship("Customer", back_populates="bookings")
    room = relationship("Room", back_populates="bookings")
    agency = relationship("Agency", back_populates="bookings")
    checkin = relationship("Checkin", back_populates="booking", uselist=False, foreign_keys="Checkin.booking_id")

    __table_args__ = (
        Index("ix_bookings_dates", "checkin_date", "checkout_date"),
        Index("ix_bookings_status", "status"),
        Index("ix_bookings_agency", "agency_id", "status"),
    )


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    agency_id = Column(Integer, ForeignKey("agencies.agency_id"), nullable=False)
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    event_type = Column(String(50), nullable=False)
    payload = Column(Text, nullable=False)
    status = Column(Enum(WebhookStatus), default=WebhookStatus.pending)
    response_code = Column(Integer)
    response_body = Column(Text)
    attempt_count = Column(Integer, default=0)
    last_attempt_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    actor_username = Column(String(50))
    actor_type = Column(String(20), default="user")
    action = Column(String(80), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    details = Column(Text)
    ip_address = Column(String(45))
    created_at = Column(DateTime, default=func.now(), index=True)

    __table_args__ = (Index("ix_audit_action_time", "action", "created_at"),)


# ════════════════════════════════════════════════════════════════════
#  AI AGENT — conversation persistence
# ════════════════════════════════════════════════════════════════════
class AgentConversation(Base):
    """One chat thread with the operational AI agent."""
    __tablename__ = "agent_conversations"

    conversation_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False, index=True)
    title = Column(String(200))
    provider = Column(String(20))   # anthropic | openai | heuristic
    model = Column(String(80))
    total_tool_calls = Column(Integer, default=0)
    total_messages = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now(), index=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    messages = relationship("AgentMessage", back_populates="conversation",
                            cascade="all, delete-orphan",
                            order_by="AgentMessage.message_id")


class AgentMessage(Base):
    """A single message in an agent conversation (user, assistant, or tool result)."""
    __tablename__ = "agent_messages"

    message_id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("agent_conversations.conversation_id"),
                             nullable=False, index=True)
    role = Column(String(20), nullable=False)  # user | assistant | tool
    content = Column(Text, nullable=False)      # JSON: text or list of blocks
    tool_calls_count = Column(Integer, default=0)
    latency_ms = Column(Integer)
    created_at = Column(DateTime, default=func.now())

    conversation = relationship("AgentConversation", back_populates="messages")


# ════════════════════════════════════════════════════════════════════
#  HOUSEKEEPING — daily cleaning workflow per room
# ════════════════════════════════════════════════════════════════════
class HousekeepingStatus(str, enum.Enum):
    pending = "pending"          # room needs attention (after checkout, daily clean due)
    in_progress = "in_progress"  # housekeeper currently working on it
    completed = "completed"      # done; ready for next guest
    inspection_failed = "inspection_failed"  # supervisor rejected; back to pending


class HousekeepingTaskType(str, enum.Enum):
    checkout_clean = "checkout_clean"     # full deep clean after guest leaves
    daily_turnover = "daily_turnover"     # towel/linen change mid-stay
    maintenance = "maintenance"           # repair / fix something
    deep_clean = "deep_clean"             # periodic deep clean of vacant room


class HousekeepingTask(Base):
    """One housekeeping job for a specific room.

    Lifecycle:
      pending → in_progress (housekeeper starts)
              → completed   (housekeeper finishes; supervisor optionally inspects)
              → inspection_failed (supervisor rejected; rolls back to pending)

    Auto-creation rules:
      - On checkout: create a `checkout_clean` task for the freed room
      - Admin can manually create `maintenance` or `deep_clean` tasks
    """
    __tablename__ = "housekeeping_tasks"
    __table_args__ = (
        Index("ix_housekeeping_lodge_status", "lodge_id", "status"),
        Index("ix_housekeeping_room_created", "room_id", "created_at"),
    )

    task_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=False, index=True)
    task_type = Column(Enum(HousekeepingTaskType), nullable=False,
                       default=HousekeepingTaskType.checkout_clean)
    status = Column(Enum(HousekeepingStatus), nullable=False,
                    default=HousekeepingStatus.pending)
    # Assigned housekeeper (a User with role 'staff' is fine). Nullable until
    # admin or housekeeping lead picks it up themselves.
    assigned_to = Column(Integer, ForeignKey("users.user_id"), nullable=True, index=True)
    notes = Column(Text)               # what's wrong / what needs doing
    completion_notes = Column(Text)    # what the housekeeper actually did

    started_at = Column(DateTime)      # when housekeeper hit "Start"
    completed_at = Column(DateTime)    # when they hit "Done"
    inspected_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    inspected_at = Column(DateTime)
    # Link back to the checkout that spawned this task (NULL for manual tasks).
    triggered_by_checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"),
                                       nullable=True)

    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at = Column(DateTime, default=func.now())

    room = relationship("Room", foreign_keys=[room_id])
    assignee = relationship("User", foreign_keys=[assigned_to])


# ════════════════════════════════════════════════════════════════════
#  FOLIO — itemized extra charges on an active check-in
# ════════════════════════════════════════════════════════════════════
class FolioChargeCategory(str, enum.Enum):
    food = "food"
    beverage = "beverage"
    laundry = "laundry"
    mini_bar = "mini_bar"
    telephone = "telephone"
    late_checkout = "late_checkout"
    damage = "damage"
    transport = "transport"
    extra_bed = "extra_bed"
    other = "other"


class FolioCharge(Base):
    """One itemized charge against an active check-in.

    Replaces the single lump-sum `additional_charges` field with a real
    line-by-line folio. The old field is kept for back-compat and is
    auto-populated as `sum(folio_charges)` at checkout so existing reports
    don't break.

    Why a separate table:
      - Guests want an itemized bill ("what's this ₹2400 for?")
      - Different items can have different GST rates eventually
      - Lets multiple staff add charges throughout the stay
    """
    __tablename__ = "folio_charges"
    __table_args__ = (
        Index("ix_folio_lodge_checkin", "lodge_id", "checkin_id"),
    )

    charge_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"),
                        nullable=False, index=True)
    category = Column(Enum(FolioChargeCategory), nullable=False,
                       default=FolioChargeCategory.other)
    description = Column(String(200), nullable=False)
    quantity = Column(Numeric(8, 2), default=1)         # e.g. 2 plates, 3 calls
    unit_price = Column(Numeric(10, 2), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)     # quantity * unit_price (server-computed)
    # If `voided`, this row is excluded from the checkout total. Soft-delete
    # so we keep the audit trail of "this was charged then waived".
    voided = Column(Boolean, default=False)
    voided_reason = Column(String(200))

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now(), index=True)


# ════════════════════════════════════════════════════════════════════
#  EXPENSES — daily operational expense tracking per lodge
# ════════════════════════════════════════════════════════════════════
class ExpenseCategory(str, enum.Enum):
    salary = "salary"
    utilities = "utilities"        # electricity, water, gas
    supplies = "supplies"          # cleaning supplies, toiletries
    maintenance = "maintenance"    # repairs, plumber, electrician
    food_beverage = "food_beverage"
    laundry = "laundry"
    rent = "rent"
    tax_fees = "tax_fees"          # government fees, license renewals
    marketing = "marketing"
    other = "other"


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    upi = "upi"
    bank_transfer = "bank_transfer"
    cheque = "cheque"
    card = "card"


class Expense(Base):
    """A single expense row. One per disbursement.

    Used to compute true profit (revenue - expenses) in reports, and to
    track who paid what to whom from the cash drawer.
    """
    __tablename__ = "expenses"
    __table_args__ = (
        Index("ix_expense_lodge_date", "lodge_id", "expense_date"),
        Index("ix_expense_lodge_category", "lodge_id", "category"),
    )

    expense_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    expense_date = Column(Date, nullable=False, index=True)
    category = Column(Enum(ExpenseCategory), nullable=False, default=ExpenseCategory.other)
    description = Column(String(300), nullable=False)
    vendor = Column(String(120))                       # who got paid
    amount = Column(Numeric(12, 2), nullable=False)
    payment_method = Column(Enum(PaymentMethod), nullable=False,
                             default=PaymentMethod.cash)
    receipt_path = Column(String(255))                 # uploaded receipt image
    # Link to a shift if paid out of the cash drawer — feeds the closing
    # balance calculation in shift handover.
    shift_id = Column(Integer, ForeignKey("shift_sessions.shift_id"), nullable=True, index=True)
    notes = Column(Text)

    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  SHIFT — front-desk shift handover / cash drawer
# ════════════════════════════════════════════════════════════════════
class ShiftStatus(str, enum.Enum):
    open = "open"
    closed = "closed"


class ShiftSession(Base):
    """A front-desk shift. Tracks the cash drawer through the shift so the
    handover at end-of-shift reconciles cleanly.

    On open: staff enters opening_balance (cash physically counted).
    During the shift: cash receipts auto-aggregate from check-ins/folios
                      paid in cash; expenses paid from drawer aggregate
                      from the Expense table.
    On close: staff enters closing_balance (cash physically counted).
              The system computes the *expected* closing balance and
              flags any discrepancy.
    """
    __tablename__ = "shift_sessions"
    __table_args__ = (
        Index("ix_shift_lodge_status", "lodge_id", "status"),
    )

    shift_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False, index=True)
    status = Column(Enum(ShiftStatus), nullable=False, default=ShiftStatus.open)

    opened_at = Column(DateTime, default=func.now(), nullable=False)
    closed_at = Column(DateTime)

    opening_balance = Column(Numeric(12, 2), nullable=False, default=0)
    # The amount actually counted at close. NULL while open.
    closing_balance = Column(Numeric(12, 2))
    # System-computed: opening + cash_receipts - cash_expenses
    expected_closing_balance = Column(Numeric(12, 2))
    # Discrepancy = closing_balance - expected_closing_balance.
    # +ve means staff has more cash than the system expected; -ve = shortage.
    discrepancy = Column(Numeric(12, 2))

    # Free-form handover notes from the closing staffer to the next shift.
    handover_notes = Column(Text)

    user = relationship("User", foreign_keys=[user_id])


# ════════════════════════════════════════════════════════════════════
#  NOTIFICATIONS — in-app messages for staff (bell icon)
# ════════════════════════════════════════════════════════════════════
class NotificationLevel(str, enum.Enum):
    info = "info"
    warning = "warning"
    success = "success"
    error = "error"


class Notification(Base):
    """An in-app notification shown in the bell icon dropdown.

    Distinct from `alerts` (which is outbound SMS/email to guests).
    Targets a specific user OR a lodge-wide audience (target_user_id NULL).
    Auto-created by background jobs (overdue checkouts, failed alerts,
    new bookings, etc.) and by some interactive actions.
    """
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notif_lodge_user_read", "lodge_id", "target_user_id", "is_read"),
        Index("ix_notif_lodge_created", "lodge_id", "created_at"),
    )

    notification_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    # NULL means "everyone in this lodge". Otherwise this user only.
    target_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=True, index=True)
    level = Column(Enum(NotificationLevel), nullable=False, default=NotificationLevel.info)
    title = Column(String(160), nullable=False)
    message = Column(Text)
    # Optional deep-link target. Frontend navigates here when the
    # notification is clicked, e.g. "/checkins?id=42".
    action_url = Column(String(300))

    is_read = Column(Boolean, default=False, index=True)
    read_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now(), index=True)


# ════════════════════════════════════════════════════════════════════
#  MAINTENANCE — building/equipment issues (distinct from cleaning)
# ════════════════════════════════════════════════════════════════════
class MaintenancePriority(str, enum.Enum):
    low = "low"          # cosmetic, can wait
    medium = "medium"    # affects experience but room is usable
    high = "high"        # room shouldn't be sold until fixed
    urgent = "urgent"    # safety issue, fix immediately


class MaintenanceStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    awaiting_parts = "awaiting_parts"  # ordered the part, waiting for delivery
    resolved = "resolved"
    cancelled = "cancelled"            # closed without fixing (false alarm, etc.)


class MaintenanceCategory(str, enum.Enum):
    electrical = "electrical"
    plumbing = "plumbing"
    ac_hvac = "ac_hvac"
    furniture = "furniture"
    appliances = "appliances"           # TV, fridge, geyser
    structural = "structural"           # walls, ceilings, floors
    painting = "painting"
    networking = "networking"           # wifi, intercom
    pest_control = "pest_control"
    other = "other"


class MaintenanceTicket(Base):
    """A maintenance work-order for any kind of building/equipment issue.

    Distinct from `housekeeping_tasks` — that table is for daily cleaning
    rotation. Maintenance is for *broken things* that need a vendor or
    handyman, often blocking the room from sale until resolved.

    `room_id` is nullable because some tickets are for common areas
    (lobby AC, reception printer, lift, generator, etc.).
    """
    __tablename__ = "maintenance_tickets"
    __table_args__ = (
        Index("ix_maint_lodge_status", "lodge_id", "status"),
        Index("ix_maint_lodge_priority", "lodge_id", "priority"),
    )

    ticket_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True, index=True)
    location = Column(String(100))             # for common-area tickets
    category = Column(Enum(MaintenanceCategory), nullable=False,
                       default=MaintenanceCategory.other)
    priority = Column(Enum(MaintenancePriority), nullable=False,
                       default=MaintenancePriority.medium)
    status = Column(Enum(MaintenanceStatus), nullable=False,
                     default=MaintenanceStatus.open)

    title = Column(String(200), nullable=False)
    description = Column(Text)
    # If true, the room is taken out of inventory until this resolves.
    blocks_room_availability = Column(Boolean, default=False)

    reported_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    assigned_to = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    vendor_name = Column(String(120))          # outside vendor / handyman
    estimated_cost = Column(Numeric(12, 2))
    actual_cost = Column(Numeric(12, 2))
    resolution_notes = Column(Text)

    reported_at = Column(DateTime, default=func.now(), index=True)
    started_at = Column(DateTime)
    resolved_at = Column(DateTime)

    room = relationship("Room", foreign_keys=[room_id])
    assignee = relationship("User", foreign_keys=[assigned_to])


# ════════════════════════════════════════════════════════════════════
#  INVENTORY — supplies/consumables stock tracking
# ════════════════════════════════════════════════════════════════════
class InventoryUnit(str, enum.Enum):
    piece = "piece"
    pack = "pack"
    box = "box"
    bottle = "bottle"
    kg = "kg"
    g = "g"
    litre = "litre"
    ml = "ml"
    metre = "metre"
    roll = "roll"


class InventoryCategory(str, enum.Enum):
    toiletries = "toiletries"          # soap, shampoo, toothpaste sachets
    linen = "linen"                    # sheets, pillows, towels
    cleaning_supplies = "cleaning_supplies"
    stationery = "stationery"          # pens, forms, register pages
    food_beverage = "food_beverage"
    kitchen = "kitchen"
    electrical = "electrical"          # spare bulbs, batteries
    consumables = "consumables"        # everything else
    other = "other"


class InventoryItem(Base):
    """One stock item / SKU per lodge.

    Stock is updated via StockMovement rows, never directly. That way we
    always have an audit trail of who consumed what and when. current_stock
    is denormalized for fast list-page reads.
    """
    __tablename__ = "inventory_items"
    __table_args__ = (
        Index("ix_inv_lodge_sku", "lodge_id", "sku", unique=True),
        Index("ix_inv_lodge_category", "lodge_id", "category"),
    )

    item_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    sku = Column(String(40))
    name = Column(String(160), nullable=False)
    category = Column(Enum(InventoryCategory), nullable=False,
                       default=InventoryCategory.consumables)
    unit = Column(Enum(InventoryUnit), nullable=False,
                   default=InventoryUnit.piece)
    current_stock = Column(Numeric(12, 2), nullable=False, default=0)
    reorder_threshold = Column(Numeric(12, 2), default=0)
    unit_price = Column(Numeric(12, 2))
    notes = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())


class StockMovementType(str, enum.Enum):
    purchase = "purchase"
    consumption = "consumption"
    adjustment = "adjustment"
    transfer = "transfer"
    damage = "damage"
    return_ = "return"


class StockMovement(Base):
    """Immutable history row for every change to an InventoryItem.

    Editing past movements would let someone hide consumption. To fix a
    mistake, file a compensating `adjustment` movement instead.
    """
    __tablename__ = "stock_movements"
    __table_args__ = (
        Index("ix_movement_item_created", "item_id", "created_at"),
        Index("ix_movement_lodge_created", "lodge_id", "created_at"),
    )

    movement_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("inventory_items.item_id"), nullable=False, index=True)
    movement_type = Column(Enum(StockMovementType), nullable=False)
    change = Column(Numeric(12, 2), nullable=False)     # signed: +purchase, -consumption
    reason = Column(String(300))
    related_room_id = Column(Integer, ForeignKey("rooms.room_id"), nullable=True)
    related_checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  RATE PLANS — seasonal / weekend / promotional pricing
# ════════════════════════════════════════════════════════════════════
class RatePlanAdjustmentType(str, enum.Enum):
    percent = "percent"   # e.g. +20% for weekends; -15% for off-season
    flat = "flat"          # e.g. +₹500 for festival night


class RatePlan(Base):
    """A pricing override that adjusts a room's base_tariff for specific
    dates / days-of-week / room types.

    Resolution at booking time: every active plan whose scope matches the
    requested room+date is applied, in priority order (lower priority
    integer first). Multiple plans stack: weekend (+20%) AND festival
    (+₹1000) on the same Saturday both apply.
    """
    __tablename__ = "rate_plans"
    __table_args__ = (
        Index("ix_rateplan_lodge_active", "lodge_id", "is_active"),
    )

    plan_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text)

    # Scope filters — all NULL means "applies to everything".
    room_type = Column(String(40))                # match by Room.room_type, NULL = all
    # Bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64.
    # NULL or 0 means "any day". Example: weekend (Sat+Sun) = 32+64 = 96.
    day_of_week_mask = Column(Integer)
    valid_from = Column(Date)
    valid_to = Column(Date)

    adjustment_type = Column(Enum(RatePlanAdjustmentType), nullable=False,
                              default=RatePlanAdjustmentType.percent)
    # For percent: 20 means +20%; -15 means -15%. For flat: rupees.
    adjustment_value = Column(Numeric(10, 2), nullable=False)
    priority = Column(Integer, default=10)        # lower runs first

    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# ════════════════════════════════════════════════════════════════════
#  GUEST FEEDBACK — post-stay reviews & ratings
# ════════════════════════════════════════════════════════════════════
class GuestFeedback(Base):
    """One feedback row from a guest after their stay.

    Submission is via a public URL with a one-time token (no login). The
    token is generated at checkout and SMS/email'd to the guest. Staff
    can also create rows manually (recording a phone call, etc.).
    """
    __tablename__ = "guest_feedback"
    __table_args__ = (
        Index("ix_feedback_lodge_created", "lodge_id", "created_at"),
    )

    feedback_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)

    # One-time public-submit token. Cleared after submission. Unique across
    # the whole system since it's used as the URL key.
    submit_token = Column(String(64), unique=True, index=True)
    token_expires_at = Column(DateTime)

    # 1-5 ratings. Overall required at submit time; sub-ratings optional.
    overall_rating = Column(Integer)
    cleanliness_rating = Column(Integer)
    service_rating = Column(Integer)
    value_rating = Column(Integer)
    location_rating = Column(Integer)
    comment = Column(Text)
    would_recommend = Column(Boolean)
    guest_name = Column(String(160))

    submitted_at = Column(DateTime)               # NULL = token still pending
    submission_source = Column(String(20))        # 'sms' | 'email' | 'web' | 'staff'

    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  PROMO CODES — discount codes for revenue management
# ════════════════════════════════════════════════════════════════════
class PromoDiscountType(str, enum.Enum):
    percent = "percent"
    flat = "flat"


class PromoCode(Base):
    """A redeemable discount code applied at checkout time.

    Validation rules at redemption:
      - is_active = True
      - within valid_from / valid_to
      - times_used < max_uses (NULL = unlimited)
      - amount_min check (if set, bill subtotal must be >= this)
      - lodge_id must match the booking's lodge (per-tenant isolation)

    On successful redemption: increment times_used, log a PromoRedemption.
    """
    __tablename__ = "promo_codes"
    __table_args__ = (
        # Per-lodge code uniqueness — two lodges can both have a "WELCOME10".
        Index("ix_promo_lodge_code", "lodge_id", "code", unique=True),
    )

    promo_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    code = Column(String(40), nullable=False)         # uppercase by convention
    description = Column(String(300))
    discount_type = Column(Enum(PromoDiscountType), nullable=False,
                            default=PromoDiscountType.percent)
    discount_value = Column(Numeric(10, 2), nullable=False)
    max_discount_amount = Column(Numeric(10, 2))      # cap on % discounts
    amount_min = Column(Numeric(10, 2), default=0)    # min bill subtotal
    valid_from = Column(Date)
    valid_to = Column(Date)
    max_uses = Column(Integer)                        # NULL = unlimited
    times_used = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)

    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now())


class PromoRedemption(Base):
    """Audit trail of every code redemption — who used what, when, and
    how much it saved them."""
    __tablename__ = "promo_redemptions"
    __table_args__ = (
        Index("ix_promo_redemption_lodge_created", "lodge_id", "created_at"),
    )

    redemption_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    promo_id = Column(Integer, ForeignKey("promo_codes.promo_id"), nullable=False, index=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.invoice_id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=True)
    discount_amount = Column(Numeric(10, 2), nullable=False)
    code_snapshot = Column(String(40))                # in case the code is later renamed/deleted
    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  LOYALTY — guest points + tiers
# ════════════════════════════════════════════════════════════════════
class LoyaltyTier(str, enum.Enum):
    bronze = "bronze"        # default; 0–999 lifetime points
    silver = "silver"        # 1000+
    gold = "gold"            # 5000+
    platinum = "platinum"    # 15000+


class LoyaltyAccount(Base):
    """One loyalty account per (lodge_id, customer_id). Points are
    denormalized for fast reads; LoyaltyTransaction is the source of truth.

    Earning: on checkout, points = floor(invoice_total / 100) by default
             (1 point per ₹100 spent). Configurable via setting
             `loyalty_earn_rate_per_100`.

    Tier promotion is based on lifetime_points, computed on each checkout
    via a service helper.
    """
    __tablename__ = "loyalty_accounts"
    __table_args__ = (
        Index("ix_loyalty_lodge_customer", "lodge_id", "customer_id", unique=True),
    )

    account_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=False, index=True)
    current_balance = Column(Integer, nullable=False, default=0)
    lifetime_points = Column(Integer, nullable=False, default=0)
    tier = Column(Enum(LoyaltyTier), nullable=False, default=LoyaltyTier.bronze)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class LoyaltyTxnType(str, enum.Enum):
    earn = "earn"            # +points from a stay
    redeem = "redeem"        # -points used as discount
    adjust = "adjust"        # manual ± by admin
    expire = "expire"        # -points expired


class LoyaltyTransaction(Base):
    """Immutable points history per account. Editing past rows would
    let someone fake their tier — to fix mistakes, file a compensating
    `adjust` transaction."""
    __tablename__ = "loyalty_transactions"
    __table_args__ = (
        Index("ix_loyalty_txn_account_created", "account_id", "created_at"),
        Index("ix_loyalty_txn_lodge_created", "lodge_id", "created_at"),
    )

    txn_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("loyalty_accounts.account_id"),
                         nullable=False, index=True)
    txn_type = Column(Enum(LoyaltyTxnType), nullable=False)
    points = Column(Integer, nullable=False)            # signed: +earn, -redeem
    reason = Column(String(300))
    # Link back to where it came from — for the "earned X from stay #42" UX.
    related_checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)
    related_invoice_id = Column(Integer, ForeignKey("invoices.invoice_id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  FOREIGN GUEST REGISTRATION — India FRRO / C-Form compliance
# ════════════════════════════════════════════════════════════════════
# In India, the Bureau of Immigration / FRRO requires hotels to register
# every foreign national guest within 24 hours of check-in (Form C / C-Form
# under the Foreigners Act 1946, Section 14).
# This table stores the data a hotel needs to submit, plus a flag for
# whether it's been actually submitted to FRRO.

class ForeignGuestStatus(str, enum.Enum):
    pending = "pending"          # check-in done, C-Form not yet submitted
    submitted = "submitted"      # C-Form filed with FRRO
    confirmed = "confirmed"      # FRRO acknowledgement received
    not_required = "not_required"  # marked non-applicable (data-entry error etc.)


class ForeignGuestRegistration(Base):
    """C-Form / FRRO registration data for one foreign-national stay.

    A row is created automatically on check-in when the Customer record
    indicates foreign nationality (id_type='passport' AND nationality is
    non-Indian). Staff complete the missing fields and mark `submitted`
    after filing with FRRO.
    """
    __tablename__ = "foreign_guest_registrations"
    __table_args__ = (
        Index("ix_frgn_lodge_status", "lodge_id", "status"),
    )

    registration_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=False, index=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=False, index=True)

    # Passport details — typically NOT captured on the regular Customer
    # record because Indian guests don't have them.
    passport_number = Column(String(40))
    passport_expiry = Column(Date)
    nationality = Column(String(60))
    visa_number = Column(String(40))
    visa_type = Column(String(40))                    # 'tourist','business','employment', etc.
    visa_expiry = Column(Date)
    arrival_date_in_india = Column(Date)
    arrival_from_country = Column(String(60))
    departure_to_country = Column(String(60))         # next destination
    purpose_of_visit = Column(String(120))            # tourism, business, etc.

    status = Column(Enum(ForeignGuestStatus), nullable=False,
                     default=ForeignGuestStatus.pending)
    submitted_at = Column(DateTime)
    submitted_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    frro_reference = Column(String(60))               # acknowledgement number from FRRO
    notes = Column(Text)

    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  SMS CAMPAIGNS — bulk marketing messages with audience filters
# ════════════════════════════════════════════════════════════════════
class CampaignStatus(str, enum.Enum):
    draft = "draft"          # being composed
    queued = "queued"        # admin clicked send; worker picks it up
    sending = "sending"      # mid-flight
    completed = "completed"  # done (some sends may have failed individually)
    cancelled = "cancelled"


class CampaignAudienceType(str, enum.Enum):
    all_customers = "all_customers"
    vip_only = "vip_only"
    by_tier = "by_tier"                      # loyalty tier filter
    recently_checked_out = "recently_checked_out"
    upcoming_bookings = "upcoming_bookings"
    custom_list = "custom_list"              # phone numbers pasted in


class SmsCampaign(Base):
    """A bulk SMS campaign — message + audience + send status.

    On send: enumerate the audience, then queue one Alert per recipient
    via the existing alerts plumbing (so retry logic, GDPR opt-out, and
    sender_id all reuse the proven path).
    """
    __tablename__ = "sms_campaigns"
    __table_args__ = (
        Index("ix_campaign_lodge_created", "lodge_id", "created_at"),
    )

    campaign_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    message = Column(Text, nullable=False)
    audience_type = Column(Enum(CampaignAudienceType), nullable=False,
                            default=CampaignAudienceType.all_customers)
    # JSON-serialized parameters that go with the audience type:
    #   {"tier": "gold"} or {"since_days": 30} or {"phones": ["+91..."]}
    audience_params = Column(Text)
    status = Column(Enum(CampaignStatus), nullable=False, default=CampaignStatus.draft)
    estimated_recipients = Column(Integer, default=0)
    actual_sent = Column(Integer, default=0)
    actual_failed = Column(Integer, default=0)
    sent_at = Column(DateTime)
    created_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    created_at = Column(DateTime, default=func.now())


# ════════════════════════════════════════════════════════════════════
#  v2.5 — GROUP BOOKINGS, NIGHT AUDIT, GUEST DOCUMENTS, OTA CHANNELS
# ════════════════════════════════════════════════════════════════════

class GroupBooking(Base):
    """A group reservation — one umbrella booking spanning multiple rooms.

    A common case in lodges: a wedding party reserves 8 rooms for 2 nights
    under one contact person. Each individual Booking row links to this
    GroupBooking via group_booking_id; the group keeps shared metadata
    (contact, billing-to, special-rate, group_code) so admins can see and
    bill the whole party as one unit.
    """
    __tablename__ = "group_bookings"
    __table_args__ = (
        Index("ix_group_lodge_code", "lodge_id", "group_code", unique=True),
    )

    group_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    group_code = Column(String(40), nullable=False)        # e.g. "WEDDING-2026-001"
    group_name = Column(String(160), nullable=False)
    contact_name = Column(String(160))
    contact_phone = Column(String(20))
    contact_email = Column(String(160))
    # Shared dates — individual sub-bookings can override but typically share these.
    arrival_date = Column(Date)
    departure_date = Column(Date)
    # Rooms-blocked counter — denormalized for fast dashboard reads.
    rooms_blocked = Column(Integer, default=0)
    # Bill-to: 'single_invoice' bills everything to the group contact;
    # 'individual_invoices' bills each guest separately at checkout.
    bill_to = Column(String(20), default="single_invoice")
    special_rate = Column(Numeric(10, 2))                  # overrides room tariff if set
    notes = Column(Text)
    status = Column(String(20), default="confirmed")       # confirmed/cancelled/completed
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now())


class NightAuditRun(Base):
    """One end-of-day audit run. Captures the snapshot of revenue,
    occupancy, and outstanding folios at the moment the business date
    advanced. The row is immutable post-close — to "undo" a night audit
    a manager files a manual correction.

    The night auditor (a User) clicks "Run night audit"; the system
    posts any pending room charges for the day, totals revenue across
    invoices, expenses, and outstanding folios, and stores everything
    here so the morning report can be regenerated identically.
    """
    __tablename__ = "night_audit_runs"
    __table_args__ = (
        Index("ix_audit_lodge_date", "lodge_id", "business_date", unique=True),
    )

    run_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    # The date the audit closed (NOT the date it ran — auditor ran it on
    # the 15th but closed business for the 14th).
    business_date = Column(Date, nullable=False, index=True)
    # Counts
    checkins_count = Column(Integer, default=0)
    checkouts_count = Column(Integer, default=0)
    cancellations_count = Column(Integer, default=0)
    rooms_occupied = Column(Integer, default=0)
    rooms_available = Column(Integer, default=0)
    # Revenue snapshot
    room_revenue = Column(Numeric(12, 2), default=0)
    folio_revenue = Column(Numeric(12, 2), default=0)
    other_revenue = Column(Numeric(12, 2), default=0)
    gst_collected = Column(Numeric(12, 2), default=0)
    discounts_given = Column(Numeric(12, 2), default=0)
    total_revenue = Column(Numeric(12, 2), default=0)
    expenses_total = Column(Numeric(12, 2), default=0)
    net_revenue = Column(Numeric(12, 2), default=0)
    # KPIs at the moment of close
    occupancy_pct = Column(Numeric(5, 2))
    arr = Column(Numeric(10, 2))            # average room rate
    revpar = Column(Numeric(10, 2))
    # Issues found during audit (unposted charges, unbalanced folios, etc.)
    # JSON list — frontend renders as a checklist of warnings.
    issues_json = Column(Text)
    notes = Column(Text)
    # Who ran it and when
    run_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    run_at = Column(DateTime, default=func.now())


class GuestDocument(Base):
    """ID proof / passport scan / signed-form attachment for a customer.

    Needed for compliance:
      - FRRO/C-Form requires passport image attachment in some states
      - Some hotels keep ID-proof scans for police verification
      - Group bookings often have a signed contract document

    We store the file under uploads/guest_docs/{uuid}{ext} and keep
    metadata here. Files are NEVER exposed without auth.
    """
    __tablename__ = "guest_documents"
    __table_args__ = (
        Index("ix_doc_lodge_customer", "lodge_id", "customer_id"),
    )

    document_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"),
                          nullable=False, index=True)
    # Optional links — a doc may be tied to a specific check-in or booking
    # (e.g. "signed wedding contract" links to the GroupBooking).
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    # 'id_proof' | 'passport' | 'visa' | 'signed_form' | 'other'
    doc_type = Column(String(40), nullable=False, default="id_proof")
    file_name = Column(String(200), nullable=False)       # original filename
    file_path = Column(String(255), nullable=False)       # uploads/guest_docs/...
    file_size_bytes = Column(Integer, default=0)
    mime_type = Column(String(80))
    notes = Column(Text)
    uploaded_by = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    uploaded_at = Column(DateTime, default=func.now())


class GuestPreference(Base):
    """Structured repeat-guest preference (replaces freeform notes for
    common requests). When a guest is recognized at check-in, the front
    desk sees a stack of these chips: "ground floor", "extra pillows",
    "early breakfast"."""
    __tablename__ = "guest_preferences"
    __table_args__ = (
        Index("ix_pref_lodge_customer", "lodge_id", "customer_id"),
    )

    preference_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.customer_id"),
                          nullable=False, index=True)
    category = Column(String(40), default="general")       # room / dining / service / general
    preference = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now())


class OtaChannel(str, enum.Enum):
    booking_com = "booking_com"
    expedia = "expedia"
    airbnb = "airbnb"
    agoda = "agoda"
    makemytrip = "makemytrip"
    goibibo = "goibibo"
    direct = "direct"          # the lodge's own website / walk-in
    phone = "phone"
    walk_in = "walk_in"
    other = "other"


class OtaReservation(Base):
    """An external booking pulled in from an OTA (or recorded manually).

    Full channel-manager integration (real-time push to Booking.com etc.)
    is a heavy lift — it needs commercial API contracts. This table is
    the STRUCTURE for OTAs: front desk staff manually log OTA bookings
    here as they come in via email/extranet, and the booking flows into
    the regular Booking table once the room is assigned. A future channel
    manager integration would write the same rows.

    Stores the OTA's confirmation number + commission rate so finance can
    reconcile what's owed back.
    """
    __tablename__ = "ota_reservations"
    __table_args__ = (
        Index("ix_ota_lodge_channel", "lodge_id", "channel"),
        Index("ix_ota_external_id", "channel", "external_id"),
    )

    ota_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    channel = Column(Enum(OtaChannel), nullable=False, default=OtaChannel.direct)
    # The OTA's own booking reference — used to de-dupe imports.
    external_id = Column(String(80))
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    # Snapshot of the guest details from the OTA (before our Customer is
    # created — these may not match an existing Customer record).
    guest_name = Column(String(160))
    guest_phone = Column(String(20))
    guest_email = Column(String(160))
    arrival_date = Column(Date)
    departure_date = Column(Date)
    rooms_count = Column(Integer, default=1)
    room_type_requested = Column(String(40))
    total_amount = Column(Numeric(10, 2))
    # OTA commission. e.g. Booking.com charges ~15%, MakeMyTrip ~18-22%.
    # We capture the % the OTA will deduct so finance can reconcile.
    commission_pct = Column(Numeric(5, 2))
    commission_amount = Column(Numeric(10, 2))
    status = Column(String(20), default="pending")         # pending/confirmed/cancelled
    raw_payload = Column(Text)                             # JSON dump for audit
    received_at = Column(DateTime, default=func.now(), index=True)
    created_by = Column(Integer, ForeignKey("users.user_id"))


# ════════════════════════════════════════════════════════════════════
#  v2.6 — EMAIL INFRASTRUCTURE (templates + delivery log + automation)
# ════════════════════════════════════════════════════════════════════

class EmailTemplate(Base):
    """A named, editable email template per lodge.

    Body uses Jinja-style `{{guest_name}}` merge tags. Available variables
    are documented in email_service.MERGE_VARIABLES — the editor surfaces
    them as click-to-insert chips.

    A small set of *system* templates is seeded automatically (booking
    confirmation, pre-arrival, etc.) — those have a `template_key` like
    "booking_confirmation" that the automation hooks look up by name.
    Admins can also create one-off templates with no template_key.
    """
    __tablename__ = "email_templates"
    __table_args__ = (
        Index("ix_email_tpl_lodge_key", "lodge_id", "template_key", unique=True),
    )

    template_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    # Stable key for system-driven lookups: 'booking_confirmation',
    # 'pre_arrival', 'checkin_welcome', 'during_stay', 'post_stay_thanks'.
    # NULL for custom/admin-authored templates.
    template_key = Column(String(60))
    name = Column(String(120), nullable=False)
    subject = Column(String(200), nullable=False)
    # HTML body. We render server-side with simple {{var}} substitution
    # (no Jinja dependency — easier to reason about, safer for guest data).
    body_html = Column(Text, nullable=False)
    # When false, automation hooks skip this template. Lets admins disable
    # a sequence (e.g. they don't want a during-stay message).
    is_active = Column(Boolean, default=True)
    # Description for the editor UI.
    description = Column(String(300))
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, ForeignKey("users.user_id"))


class EmailLog(Base):
    """One row per outbound email — for the Email Logs page.

    Stores both successful deliveries and failures (with the SMTP error
    in `error_message`). Distinct from the existing Alerts log because
    Alerts is for guest-facing SMS + arrival/checkout reminders driven
    by scheduled jobs; emails span a broader set of triggers and are
    worth a dedicated history view.
    """
    __tablename__ = "email_logs"
    __table_args__ = (
        Index("ix_email_log_lodge_sent", "lodge_id", "sent_at"),
    )

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("email_templates.template_id"), nullable=True)
    template_key = Column(String(60))                 # denormalized for fast filtering
    to_email = Column(String(160), nullable=False)
    subject = Column(String(200), nullable=False)
    # Source: 'manual' (sent from UI), 'automated' (scheduled/hooked),
    # 'test' (admin clicked "Send test").
    source = Column(String(20), default="automated")
    # 'sent' | 'failed' | 'skipped'
    status = Column(String(20), nullable=False, default="sent")
    error_message = Column(Text)
    # Link back to the customer / booking / checkin that triggered the send
    # (any of these may be null — manual sends don't link to a record).
    customer_id = Column(Integer, ForeignKey("customers.customer_id"), nullable=True)
    booking_id = Column(Integer, ForeignKey("bookings.booking_id"), nullable=True)
    checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"), nullable=True)
    sent_at = Column(DateTime, default=func.now(), index=True)
    sent_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)


# ════════════════════════════════════════════════════════════════════
#  RUSTO v3.0 — Multi-sided marketplace
#  ──────────────────────────────────────────────────────────────────
#  LodgeRegistrationRequest: a lodge owner fills a public form. The
#    super-admin reviews and approves (creating a Lodge + admin user
#    automatically) or rejects with a reason.
#  SupportTicket: an already-registered lodge raises an issue. The
#    super-admin sees all tickets across all tenants.
#  SupportTicketMessage: threaded back-and-forth on a ticket.
# ════════════════════════════════════════════════════════════════════

class RegistrationStatus(str, enum.Enum):
    pending = "pending"     # waiting for super-admin review
    approved = "approved"   # super-admin approved → Lodge + user created
    rejected = "rejected"   # super-admin rejected (rejection_reason populated)


class LodgeRegistrationRequest(Base):
    """A self-service registration request from a prospective lodge.

    Submitted via public unauthenticated endpoint (/api/public/register).
    All mandatory fields collected up-front: a super-admin should be able
    to make an approve/reject decision without follow-up correspondence.

    On approval: we create a Lodge row (using `proposed_code` as the
    stable slug), a default admin user with username `<code>_admin`, and
    seed the standard defaults (rooms types, settings, email templates).
    The applicant receives the credentials via email (or — in dev — they
    appear on the approval confirmation screen).
    """
    __tablename__ = "lodge_registration_requests"
    __table_args__ = (
        # Note: we'd like a partial unique on (proposed_code) WHERE status='pending'
        # but SQLAlchemy's cross-dialect support for that is awkward. We
        # enforce "no duplicate pending request for same code" in the
        # registration endpoint instead.
        Index("ix_lodge_reg_status_created", "status", "created_at"),
        Index("ix_lodge_reg_code", "proposed_code"),
    )

    request_id = Column(Integer, primary_key=True, autoincrement=True)
    # The lodge slug the applicant wants. Internal — used to namespace
    # usernames (e.g. "sunrise_admin", "sunrise_staff1"). We validate
    # this against existing lodge codes AND other pending requests on
    # the create endpoint.
    proposed_code = Column(String(40), nullable=False, index=True)
    lodge_name = Column(String(160), nullable=False)
    # Owner / primary contact details — all mandatory per spec.
    owner_full_name = Column(String(120), nullable=False)
    owner_phone = Column(String(20), nullable=False)
    owner_email = Column(String(160), nullable=False)
    # Premises details.
    address_line1 = Column(String(200), nullable=False)
    address_line2 = Column(String(200))
    city = Column(String(80), nullable=False)
    state = Column(String(80), nullable=False)
    pincode = Column(String(12), nullable=False)
    gstin = Column(String(20))                  # optional — small lodges may not have one
    pan = Column(String(20))                    # optional
    total_rooms = Column(Integer, nullable=False, default=0)
    # v7.1 — granular room-type breakdown captured at registration so
    # we can quote pricing accurately and pre-seed the lodge's
    # room inventory on approval. All optional (defaults to 0) — if the
    # applicant skips the breakdown we just use `total_rooms`.
    rooms_ac = Column(Integer, nullable=False, default=0)
    rooms_non_ac = Column(Integer, nullable=False, default=0)
    rooms_deluxe = Column(Integer, nullable=False, default=0)
    rooms_suite = Column(Integer, nullable=False, default=0)
    # Pricing plan the applicant selected during onboarding.
    # Values: 'starter', 'growth', 'pro' — see pricing_service.PLANS.
    # billing_cycle: 'monthly' | 'annual' (annual = 12 months prepaid, 2 months free)
    selected_plan = Column(String(20))
    billing_cycle = Column(String(10), default="monthly")
    # Quoted price (snapshot at submission time, so a price change after
    # submission doesn't surprise the customer at approval).
    quoted_price_inr = Column(Numeric(12, 2))
    # Free-text — anything the applicant wants the super-admin to know.
    notes = Column(Text)
    # Workflow state.
    status = Column(String(20), nullable=False, default=RegistrationStatus.pending.value)
    rejection_reason = Column(Text)             # populated when status='rejected'
    # Audit trail: who acted on this request and when.
    reviewed_by = Column(Integer, ForeignKey("users.user_id"))
    reviewed_at = Column(DateTime)
    # Once approved, we point at the Lodge we created so the super-admin
    # can click through from the registrations page to the new lodge.
    created_lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"))
    created_admin_user_id = Column(Integer, ForeignKey("users.user_id"))
    # Submission metadata.
    created_at = Column(DateTime, default=func.now(), nullable=False)
    submitter_ip = Column(String(45))           # for spam investigation


class SupportTicketStatus(str, enum.Enum):
    open = "open"                       # awaiting super-admin response
    awaiting_lodge = "awaiting_lodge"   # super-admin replied, waiting on lodge
    resolved = "resolved"               # both parties agree it's done
    closed = "closed"                   # auto-closed after N days idle, or manually


class SupportTicket(Base):
    """A ticket raised by a lodge admin (or staff) for technical / billing /
    other issues. Visible to: the originating lodge's admins + ALL super-
    admins. Staff who didn't create it cannot see other tickets — privacy.

    Categories help the super-admin triage quickly. We don't enforce SLA
    here; that's a v3.2 concern.
    """
    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_lodge_status", "lodge_id", "status"),
        Index("ix_support_status_created", "status", "created_at"),
    )

    ticket_id = Column(Integer, primary_key=True, autoincrement=True)
    # Human-readable reference: "TKT-20260529-A7B2". Built at create time
    # so we can show it on the success toast immediately.
    ticket_ref = Column(String(40), unique=True, nullable=False, index=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    # Who raised it. Could be admin or staff; the lodge sees all its own
    # tickets regardless of who raised them.
    raised_by_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    category = Column(String(40), nullable=False, default="technical")
    # Categories (UI surfaces these as a dropdown): technical, billing,
    # feature_request, account, other.
    priority = Column(String(20), nullable=False, default="normal")
    # low / normal / high / urgent — lodge picks; super-admin can override.
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default=SupportTicketStatus.open.value)
    # Who from the super-admin side picked it up. Optional — tickets can
    # sit unassigned until a super-admin claims them.
    assigned_to_user_id = Column(Integer, ForeignKey("users.user_id"))
    created_at = Column(DateTime, default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    # We close inactive tickets after a while; this timestamp lets us
    # report on resolution time for analytics later.
    resolved_at = Column(DateTime)


class SupportTicketMessage(Base):
    """Threaded message on a ticket. Either side can post; we track who
    via author_role so the UI can render them like a chat conversation."""
    __tablename__ = "support_ticket_messages"
    __table_args__ = (
        Index("ix_support_msg_ticket_created", "ticket_id", "created_at"),
    )

    message_id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id = Column(Integer, ForeignKey("support_tickets.ticket_id"),
                       nullable=False, index=True)
    author_user_id = Column(Integer, ForeignKey("users.user_id"), nullable=False)
    # 'lodge' or 'super_admin' — denormalized so we don't need to re-check
    # the user's role on every render.
    author_role = Column(String(20), nullable=False)
    body = Column(Text, nullable=False)
    # Status the ticket transitioned TO after this message, if any. NULL
    # for plain replies. Lets the UI render "status changed to resolved"
    # inline with the message stream.
    status_change = Column(String(30))
    created_at = Column(DateTime, default=func.now(), nullable=False)


# ════════════════════════════════════════════════════════════════════
#  RUSTO v3.1 — Customer-facing marketplace
#  ──────────────────────────────────────────────────────────────────
#  Customer:        end-user of the Rusto consumer app
#  LodgePhoto:      gallery shots per lodge for browse / detail pages
#  CustomerBooking: bookings made via the public Rusto site
#  Payment:         Razorpay order + signature verification trail
#
#  We deliberately keep Customer separate from User (the staff/admin
#  table). Different login routes, different schemas (phone-first vs
#  username-first), different lifecycles (customers can self-register
#  on the web; staff are provisioned by a lodge admin).
# ════════════════════════════════════════════════════════════════════

class RustoCustomer(Base):
    """A traveller using the Rusto consumer app. Auth via phone +
    password (email optional). Independent from User — customers don't
    belong to any single lodge.

    Distinct class name (RustoCustomer) from the lodge-side Customer
    table to keep SQLAlchemy's ORM registry unambiguous. The DB table
    is `rusto_customers`; the lodge-side `customers` table continues
    to back the existing operational guest records (those are the
    physically-checked-in people, with ID proofs etc.)."""
    __tablename__ = "rusto_customers"
    __table_args__ = (
        Index("ix_rusto_customer_phone", "phone", unique=True),
        Index("ix_rusto_customer_email", "email"),
    )

    customer_id = Column(Integer, primary_key=True, autoincrement=True)
    # Phone is the identifier — Indian travel apps default to phone login.
    # We don't enforce country code format here; UI sends E.164.
    phone = Column(String(20), nullable=False)
    email = Column(String(160))
    full_name = Column(String(160), nullable=False)
    password_hash = Column(String(255), nullable=False)
    # Optional fields populated over time (filled at checkout).
    gender = Column(String(20))
    date_of_birth = Column(Date)
    # Default address — pre-fills the checkout form.
    address_line = Column(String(300))
    city = Column(String(80))
    state = Column(String(80))
    pincode = Column(String(12))
    # Identity verification (Aadhar/PAN) at booking time may be required
    # by some lodges. Not enforced at registration.
    id_proof_type = Column(String(30))
    id_proof_number = Column(String(60))
    is_active = Column(Boolean, default=True, nullable=False)
    # Marketing — let customers opt out gracefully.
    accepts_marketing = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    last_login_at = Column(DateTime)


class LodgePhoto(Base):
    """One photo on a lodge's listing. Order matters — first row is the
    cover image used on search-result cards.

    We don't run an upload server here; this round stores URL references
    (S3 / CloudFront / external CDN). A later round can add a presigned-
    upload helper if lodges need to upload photos directly.
    """
    __tablename__ = "rusto_lodge_photos"
    __table_args__ = (
        Index("ix_rusto_photo_lodge_order", "lodge_id", "sort_order"),
    )

    photo_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False, index=True)
    url = Column(String(500), nullable=False)
    caption = Column(String(200))
    sort_order = Column(Integer, default=0)
    uploaded_at = Column(DateTime, default=func.now())


class CustomerBookingStatus(str, enum.Enum):
    """Status flow for a customer-side booking:
    initiated → payment_pending → confirmed → checked_in → checked_out
                              ↓
                          payment_failed / cancelled
    """
    initiated       = "initiated"        # customer picked rooms, not paid yet
    payment_pending = "payment_pending"  # Razorpay order created, awaiting webhook
    confirmed       = "confirmed"        # paid, booking confirmed
    checked_in      = "checked_in"       # lodge marked them in (via the existing Checkin)
    checked_out     = "checked_out"      # lodge completed checkout
    cancelled       = "cancelled"        # customer or admin cancelled
    payment_failed  = "payment_failed"   # payment never completed


class CustomerBooking(Base):
    """A booking made via the public Rusto site. Distinct from the
    existing internal Booking table — those are walk-in / phone bookings
    a front-desk staffer entered. This row links to a Booking row only
    after the customer's stay is created in the lodge system; before that
    it lives as a marketplace-side record.

    Why two tables? Customer marketplace bookings have a different
    lifecycle (payment, online cancellation policy, customer-side notes)
    and we don't want to pollute the operational Booking table with
    fields that don't apply to walk-ins.
    """
    __tablename__ = "rusto_customer_bookings"
    __table_args__ = (
        Index("ix_rusto_cb_customer", "customer_id"),
        Index("ix_rusto_cb_lodge", "lodge_id"),
        Index("ix_rusto_cb_status", "status"),
        Index("ix_rusto_cb_dates", "checkin_date", "checkout_date"),
    )

    booking_id = Column(Integer, primary_key=True, autoincrement=True)
    # Customer-facing reference, e.g. "RB-20260530-A7B2". Shown on
    # confirmation page + receipts.
    booking_ref = Column(String(40), unique=True, nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("rusto_customers.customer_id"),
                          nullable=False)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    # We store a snapshot of the room type the customer picked. We don't
    # pin a specific room — the lodge assigns one at check-in time. This
    # matches how real OTA bookings work (customer books "Deluxe AC", desk
    # picks a specific 203 / 207 / 215 depending on housekeeping).
    room_type = Column(String(30), nullable=False)
    rooms_count = Column(Integer, nullable=False, default=1)
    checkin_date = Column(Date, nullable=False)
    checkout_date = Column(Date, nullable=False)
    nights = Column(Integer, nullable=False)
    adults = Column(Integer, nullable=False, default=2)
    children = Column(Integer, nullable=False, default=0)
    # Snapshot the price at booking time. Lodge can change their public
    # tariff later; this stays at what the customer agreed to pay.
    tariff_per_night = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    gst_amount = Column(Numeric(10, 2), nullable=False, default=0)
    total_amount = Column(Numeric(10, 2), nullable=False)
    # Snapshot of contact info AT booking time (customer can edit their
    # profile later without affecting historical bookings).
    contact_name = Column(String(160), nullable=False)
    contact_phone = Column(String(20), nullable=False)
    contact_email = Column(String(160))
    special_requests = Column(Text)
    status = Column(String(30), nullable=False,
                     default=CustomerBookingStatus.initiated.value)
    # When the lodge confirms the actual room assignment, we link to the
    # internal Checkin row so the lodge's operational dashboards work
    # unchanged.
    linked_checkin_id = Column(Integer, ForeignKey("checkins.checkin_id"))
    cancelled_at = Column(DateTime)
    cancellation_reason = Column(Text)
    created_at = Column(DateTime, default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class PaymentStatus(str, enum.Enum):
    created  = "created"   # Razorpay order created, awaiting customer
    paid     = "paid"      # signature verified — money in
    failed   = "failed"    # gateway returned failure
    refunded = "refunded"  # refunded by admin
    pending  = "pending"   # webhook hasn't confirmed yet


class Payment(Base):
    """Per-booking payment record. One booking can have multiple Payment
    rows (e.g., a failed attempt followed by a successful retry); the
    latest 'paid' row is the authoritative source of truth.

    For Razorpay we store the order_id + payment_id + signature so we
    can audit / reconcile against their dashboard later.
    """
    __tablename__ = "rusto_payments"
    __table_args__ = (
        Index("ix_rusto_pay_booking", "customer_booking_id"),
        Index("ix_rusto_pay_status", "status"),
        Index("ix_rusto_pay_razorpay_order", "razorpay_order_id"),
    )

    payment_id = Column(Integer, primary_key=True, autoincrement=True)
    customer_booking_id = Column(Integer,
                                  ForeignKey("rusto_customer_bookings.booking_id"),
                                  nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    currency = Column(String(8), nullable=False, default="INR")
    gateway = Column(String(20), nullable=False, default="razorpay")
    # Gateway-side identifiers — populated as the flow progresses.
    razorpay_order_id = Column(String(80))                    # set when we create the order
    razorpay_payment_id = Column(String(80))                  # set after customer pays
    razorpay_signature = Column(String(255))                  # for verification
    status = Column(String(20), nullable=False, default=PaymentStatus.created.value)
    # Error payload from the gateway when status='failed'. JSON-encoded.
    error_payload = Column(Text)
    # Human-readable payment method as reported by Razorpay (card / upi / netbanking).
    method = Column(String(30))
    created_at = Column(DateTime, default=func.now(), nullable=False)
    paid_at = Column(DateTime)


class ReviewStatus(str, enum.Enum):
    """Visibility status of a review.

    'published'  → visible to everyone (default for new reviews; we trust
                   verified-stay customers by default rather than gate on
                   moderation, since each review is tied to a real booking).
    'hidden'     → soft-deleted by the customer who wrote it.
    'flagged'    → super-admin took it down (abuse, off-topic, fake). The
                   row stays in the DB for audit but doesn't appear in
                   public listings or aggregate ratings.
    """
    published = "published"
    hidden    = "hidden"
    flagged   = "flagged"


class Review(Base):
    """Customer review of a lodge, tied to a real booking.

    Verification model: a customer can only review a lodge they have a
    `checked_in` or `checked_out` booking for. This is checked at write
    time AND stored as `booking_id` on the row so every review is provably
    a verified stay. We do NOT support unsolicited reviews — every Rusto
    review has a booking trail behind it.

    One review per (customer, booking). A customer can edit their review
    indefinitely (overwrites in place). They can also "hide" it which
    soft-deletes it — sets status=hidden but keeps the row so we don't
    lose the data. They can later re-publish.

    Lodge response (one per review): the lodge admin can post a single
    reply to each review. Stored inline (response_body / response_at)
    rather than a separate Replies table because the cardinality is
    fixed at 1 and we never need to thread.
    """
    __tablename__ = "rusto_reviews"
    __table_args__ = (
        # One review per booking — enforces the "verified stay" promise.
        # A customer with N bookings at the same lodge can leave N reviews,
        # which is correct (each stay is a separate experience).
        Index("ux_review_booking", "booking_id", unique=True),
        Index("ix_review_lodge_status_created",
              "lodge_id", "status", "created_at"),
        Index("ix_review_customer", "customer_id"),
    )

    review_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("rusto_customers.customer_id"),
                          nullable=False)
    booking_id = Column(Integer,
                         ForeignKey("rusto_customer_bookings.booking_id"),
                         nullable=False)

    rating = Column(Integer, nullable=False)            # 1..5
    title = Column(String(120))
    body = Column(Text)

    status = Column(String(20), nullable=False,
                     default=ReviewStatus.published.value)
    # Set when status moves to 'flagged' so we can show "removed by Rusto"
    # in the customer's own My-Reviews view without exposing the reason
    # publicly.
    flagged_reason = Column(Text)
    flagged_at = Column(DateTime)

    # Lodge response — populated when admin replies to the review.
    response_body = Column(Text)
    response_at = Column(DateTime)
    # The admin user who wrote the response (for audit; we don't surface
    # this publicly, just "Response from <Lodge Name>").
    response_by_user_id = Column(Integer, ForeignKey("users.user_id"))

    created_at = Column(DateTime, default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


# Marketplace fields on Lodge — added in a separate "v3.1 extras" wrapper
# so the original Lodge class stays small. Adding columns here causes
# SQLAlchemy to register them; create_all picks them up on next boot.
Lodge.is_published = Column(Boolean, default=False, nullable=False)
Lodge.public_description = Column(Text)
Lodge.public_city = Column(String(80))             # canonical search field
Lodge.public_town = Column(String(80))
Lodge.public_area = Column(String(80))
Lodge.public_landmark = Column(String(80))
Lodge.public_pincode = Column(String(20))
Lodge.public_state = Column(String(80))
Lodge.public_country = Column(String(80), default="India")
Lodge.latitude = Column(Numeric(10, 7))            # for "near me" search later
Lodge.longitude = Column(Numeric(10, 7))
# Lowest publicly-advertised price across all room types. Recomputed
# whenever the lodge edits their room types in v3.1's seller UI; for
# now we let the admin set it manually.
Lodge.starting_price = Column(Numeric(10, 2))
Lodge.amenities = Column(Text)                     # comma-separated for simplicity (WiFi,Parking,AC,Pool)


# ──────────────────────────────────────────────────────────────────
# v7.0 — WhatsApp Business API integration
# ──────────────────────────────────────────────────────────────────

class WhatsAppMessageStatus(str, enum.Enum):
    """Status of an outbound WhatsApp message.

    Lifecycle (happy path):
      queued → sent → delivered → read

    Error states:
      failed     — provider returned an error
      undelivered — Meta accepted but couldn't deliver (e.g., not a WA user)
      throttled  — we self-throttled (rate-limited by Meta or our own caps)
    """
    queued      = "queued"       # in our DB, not yet handed to provider
    sent        = "sent"         # accepted by Meta, awaiting delivery
    delivered   = "delivered"    # delivered to recipient's device
    read        = "read"         # recipient opened it (only when they have read receipts on)
    failed      = "failed"       # provider rejected it
    undelivered = "undelivered"  # Meta couldn't deliver (offline / not WA user / etc.)
    throttled   = "throttled"    # we backed off


class WhatsAppMessage(Base):
    """Audit row for every outbound WhatsApp message.

    Why a dedicated table (not generic NotificationLog)?
      - WhatsApp has its own status lifecycle (sent → delivered → read)
        that doesn't map cleanly onto email/SMS, where we mostly only
        know "queued" vs "sent" vs "bounced".
      - Meta charges per template-message and segments by category
        (utility, marketing, authentication). Storing template_category
        lets us compute monthly cost forecasts.
      - Webhook callbacks from Meta need a fast lookup by provider_message_id.

    Customer privacy: we store the phone number explicitly (not just by
    customer_id) so we have a record even if the customer later deletes
    their account. Phone is the only PII; we don't store message body
    after sending it — the template name + params dict is enough to
    reconstruct.
    """
    __tablename__ = "whatsapp_messages"
    __table_args__ = (
        Index("ix_wa_lodge_created", "lodge_id", "created_at"),
        Index("ix_wa_customer", "customer_id"),
        Index("ix_wa_booking", "related_booking_id"),
        Index("ix_wa_status", "status"),
        # Used by the Meta status webhook to look up by wamid:
        Index("ix_wa_provider_msg_id", "provider_message_id"),
    )

    message_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    # NULL when we're messaging a non-registered phone (e.g., walk-in followups);
    # not used in v7 but the field is here so we don't break old rows later.
    customer_id = Column(Integer, ForeignKey("rusto_customers.customer_id"))
    # E.164-ish formatted phone (we prepend +91 for Indian numbers if missing).
    to_phone = Column(String(20), nullable=False)

    # Template identifier as registered with Meta. We never send freeform
    # messages — all transactional WhatsApp is template-based per Meta policy.
    template_name = Column(String(80), nullable=False)
    template_lang = Column(String(10), nullable=False, default="en")
    # Pre-rendered parameters that were inserted into the template's
    # body/buttons. Stored as JSON string for auditability.
    template_params = Column(Text)                  # JSON

    # Meta's category for billing/policy. utility/marketing/authentication.
    template_category = Column(String(20), default="utility")

    # Why we sent it — booking confirmation, review request, etc.
    # See whatsapp_service.MessageReason for the catalog.
    reason = Column(String(40), nullable=False)
    related_booking_id = Column(Integer,
                                  ForeignKey("rusto_customer_bookings.booking_id"))
    related_review_id = Column(Integer, ForeignKey("rusto_reviews.review_id"))

    status = Column(String(20), nullable=False,
                     default=WhatsAppMessageStatus.queued.value)
    # Provider tracking
    provider = Column(String(20), nullable=False, default="meta_cloud")
    provider_message_id = Column(String(120))       # Meta's "wamid.XXXX"
    error_code = Column(String(40))                 # provider error code
    error_detail = Column(Text)                     # human-readable error

    # Timestamps for each status transition (lets us compute deliverability metrics)
    created_at   = Column(DateTime, default=func.now(), nullable=False)
    sent_at      = Column(DateTime)
    delivered_at = Column(DateTime)
    read_at      = Column(DateTime)
    failed_at    = Column(DateTime)


# v7.0 marketplace fields on Lodge — WhatsApp Business API per-lodge config.
# Each lodge brings their own Meta credentials so they send from their own
# approved business phone number. We don't share credentials across tenants —
# that would violate Meta's policy and conflate sender identity.
Lodge.whatsapp_enabled = Column(Boolean, default=False)
# The Meta-issued Phone Number ID (numeric string). Different from the
# human phone number — it's a stable internal identifier.
Lodge.whatsapp_phone_number_id = Column(String(40))
# Long-lived system-user access token, scoped to the lodge's WABA.
# Stored encrypted-at-rest by the DB engine; not transmitted to the frontend.
Lodge.whatsapp_access_token = Column(String(400))
# Pretty display name shown alongside templates in admin UI.
Lodge.whatsapp_display_name = Column(String(80))


# ──────────────────────────────────────────────────────────────────
# v8.0 — Lodge Subscriptions & Billing
# ──────────────────────────────────────────────────────────────────

class SubscriptionStatus(str, enum.Enum):
    """Status lifecycle for a lodge's plan subscription.

      trialing  → first cycle hasn't been charged yet (or in trial window)
      active    → at least one successful charge; renewals on schedule
      past_due  → most recent charge failed; we retry per Razorpay schedule
      cancelled → ended either by lodge or by Rusto. No future charges.
      paused    → temporarily suspended (Razorpay's `paused` state). No charges.
    """
    trialing  = "trialing"
    active    = "active"
    past_due  = "past_due"
    cancelled = "cancelled"
    paused    = "paused"


class Subscription(Base):
    """A lodge's active subscription to a Rusto plan.

    Lifecycle:
      1. Created on registration approval — status='trialing', current_period_end
         set to today + 14 days (trial window before first charge).
      2. Razorpay's Subscription resource is what actually drives charges.
         Customer authorises on first checkout, then Razorpay auto-debits
         on each cycle boundary. We mirror their state via webhook callbacks.
      3. On each successful charge, a BillingInvoice row is created
         (one per period) and emailed to the lodge owner.

    Why store the plan + price snapshot here (not just FK to a plans table)?
      - Prices change over time. A lodge on the legacy Growth tier should
        keep paying the price they signed up at unless they explicitly
        upgrade. Storing the snapshot makes that legible.
    """
    __tablename__ = "lodge_subscriptions"
    __table_args__ = (
        Index("ux_subscription_lodge", "lodge_id", unique=True),
        Index("ix_subscription_status", "status"),
        Index("ix_subscription_next_charge", "next_charge_date"),
        # Used by the Razorpay webhook to look up by external subscription id
        Index("ix_subscription_provider_id", "provider_subscription_id"),
    )

    subscription_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    # Catalog reference (pricing_service.PLANS key)
    plan_key = Column(String(20), nullable=False)
    plan_name = Column(String(40), nullable=False)         # snapshot for invoice line items
    billing_cycle = Column(String(10), nullable=False)     # 'monthly' | 'annual'
    # Snapshot of pricing at the time the subscription was created.
    # We don't change these unless the lodge explicitly upgrades/downgrades.
    base_amount_inr   = Column(Numeric(12, 2), nullable=False)   # base fee per cycle
    per_cycle_amount_inr = Column(Numeric(12, 2), nullable=False) # total to charge each cycle
    total_rooms_at_signup = Column(Integer, nullable=False)
    # Trial window — first charge happens after this date.
    trial_until = Column(Date)
    # Current billing period; updated on each successful charge.
    current_period_start = Column(Date)
    current_period_end = Column(Date)
    # When Razorpay will attempt the next charge. NULL on cancelled/paused.
    next_charge_date = Column(Date)
    status = Column(String(20), nullable=False,
                     default=SubscriptionStatus.trialing.value)
    # Razorpay tracking
    provider = Column(String(20), nullable=False, default="razorpay")
    provider_plan_id = Column(String(80))            # the Plan resource in Razorpay
    provider_subscription_id = Column(String(80))    # the Subscription resource
    provider_customer_id = Column(String(80))        # Razorpay Customer
    # Hosted-checkout URL Razorpay gives us when the subscription is created.
    # Lodge admin can re-visit it if they didn't finish auth the first time.
    provider_short_url = Column(String(400))
    # Soft state for cancellations + reasons
    cancelled_at = Column(DateTime)
    cancellation_reason = Column(Text)
    # Most-recent payment failure (cleared on success).
    last_failure_at = Column(DateTime)
    last_failure_reason = Column(Text)
    # v8.0.1 — dedup for the 3-day-before-charge reminder email. We
    # store the charge date we last reminded about; the daily job
    # compares against `next_charge_date` and only sends when they differ.
    last_reminder_sent_for_date = Column(Date)
    # v8.2 — scheduled plan change. When the lodge picks a downgrade
    # or a cycle change, the change applies at the end of the current
    # period (we don't refund the active period). These columns hold the
    # "next thing" until the change-application path fires.
    # All NULL when there's no pending change.
    pending_plan_key = Column(String(20))
    pending_billing_cycle = Column(String(10))
    pending_total_rooms = Column(Integer)
    # ISO date when the pending change is scheduled to take effect.
    pending_change_takes_effect_at = Column(Date)
    # ISO datetime when the change was queued (for audit).
    pending_change_queued_at = Column(DateTime)
    # v8.3 — "cancel at period end" support. When set, the subscription
    # is scheduled for cancellation but still active until this date.
    # The daily realize-due job promotes it to status='cancelled' on
    # that date. Different from cancelled_at which is "actually cancelled".
    service_ends_at = Column(Date)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class BillingInvoiceStatus(str, enum.Enum):
    """Status of a billing invoice (subscription charge, NOT a guest stay).

      open    — issued but not yet paid (e.g., we generated it, awaiting Razorpay charge)
      paid    — charge succeeded
      failed  — charge declined; we'll retry per Razorpay schedule
      void    — manually voided by Rusto admin (refund flow, billing error, etc.)
    """
    open   = "open"
    paid   = "paid"
    failed = "failed"
    void   = "void"


class BillingInvoice(Base):
    """One invoice per subscription charge cycle.

    Distinct from the existing `Invoice` model (which is the guest-stay
    invoice produced at checkout). To avoid the name collision in our
    codebase, this class is BillingInvoice and the table is
    `lodge_billing_invoices`.

    Number format: RST-INV-YYYYMM-NNNN, with NNNN being a per-month
    sequence. Stable enough for accounting; generated by service layer.

    The PDF is stored as bytes in `pdf_blob` for simplicity at this scale.
    If we ever exceed a few thousand invoices we'll move to S3.
    """
    __tablename__ = "lodge_billing_invoices"
    __table_args__ = (
        Index("ux_billing_invoice_number", "invoice_number", unique=True),
        Index("ix_billing_invoice_lodge_issued", "lodge_id", "issued_at"),
        Index("ix_billing_invoice_status", "status"),
        Index("ix_billing_invoice_subscription", "subscription_id"),
    )

    invoice_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    subscription_id = Column(Integer,
                              ForeignKey("lodge_subscriptions.subscription_id"),
                              nullable=False)
    invoice_number = Column(String(40), nullable=False)
    # The cycle this invoice covers (inclusive start, exclusive end).
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    # Snapshot of the lodge billing identity at issue time (so renaming
    # the lodge later doesn't rewrite history).
    bill_to_name = Column(String(160), nullable=False)
    bill_to_email = Column(String(160))
    bill_to_address = Column(Text)
    bill_to_gstin = Column(String(20))
    # Money. We don't pre-compute net+gst until the invoice is issued;
    # GST registration may or may not apply (depends on lodge state).
    subtotal_inr = Column(Numeric(12, 2), nullable=False)
    gst_rate_pct = Column(Numeric(5, 2), nullable=False, default=18)  # SaaS 18% GST
    gst_amount_inr = Column(Numeric(12, 2), nullable=False, default=0)
    total_inr = Column(Numeric(12, 2), nullable=False)
    status = Column(String(20), nullable=False,
                     default=BillingInvoiceStatus.open.value)
    # PDF cached at issue time. Regenerated on demand if missing (e.g.,
    # invoices from a legacy run before this column existed).
    pdf_blob = Column(LargeBinary)
    # Razorpay payment that settled this invoice (if paid).
    razorpay_payment_id = Column(String(80))
    razorpay_invoice_id = Column(String(80))    # if we use their invoice resource
    issued_at = Column(DateTime, default=func.now(), nullable=False)
    paid_at = Column(DateTime)
    voided_at = Column(DateTime)
    voided_reason = Column(Text)
    # v8.0.1 — tracks the "invoice issued" email so we don't double-send
    # if the issuance pathway runs twice. NULL = never emailed.
    email_sent_at = Column(DateTime)


# ──────────────────────────────────────────────────────────────────
# v8.3 — Subscription refunds (on cancellation, prorated unused period)
# ──────────────────────────────────────────────────────────────────

class BillingRefundStatus(str, enum.Enum):
    """Status of a refund. Mirrors the Razorpay refund lifecycle.

      pending    — refund requested, awaiting provider confirmation
      processed  — provider returned success; money is on its way
      failed     — provider returned an error
      void       — manually voided by Rusto admin (rare, recovery flow)
    """
    pending   = "pending"
    processed = "processed"
    failed    = "failed"
    void      = "void"


class BillingRefund(Base):
    """A refund issued against a paid BillingInvoice.

    Created when a lodge cancels mid-period and asks for the unused
    portion back. Each refund references the original invoice (so we
    can show "Refunded ₹X of invoice RST-INV-...") and tracks the
    provider's refund ID for reconciliation.

    Snapshot fields (lodge name, period, etc.) avoid history rewrites
    if the lodge later renames itself.
    """
    __tablename__ = "lodge_billing_refunds"
    __table_args__ = (
        Index("ix_billing_refund_lodge_issued", "lodge_id", "created_at"),
        Index("ix_billing_refund_invoice", "original_invoice_id"),
        Index("ix_billing_refund_status", "status"),
        Index("ix_billing_refund_provider_id", "razorpay_refund_id"),
    )

    refund_id = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    subscription_id = Column(Integer,
                              ForeignKey("lodge_subscriptions.subscription_id"),
                              nullable=False)
    # The invoice we're refunding (usually the most-recent paid one
    # for the current period). NULL is allowed for goodwill refunds
    # not tied to a specific invoice.
    original_invoice_id = Column(Integer, ForeignKey("lodge_billing_invoices.invoice_id"))
    # Human-readable refund number for the lodge to reference.
    # Format: RST-REF-YYYYMM-NNNN, sequenced per month.
    refund_number = Column(String(40), nullable=False, unique=True)
    # The slice of the period the refund covers (informational).
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    unused_days = Column(Integer, nullable=False)
    total_period_days = Column(Integer, nullable=False)
    # Money. Stored INCL. of the GST portion that was originally charged —
    # we refund both the net amount and the GST proportionally.
    subtotal_inr = Column(Numeric(12, 2), nullable=False)        # net portion refunded
    gst_amount_inr = Column(Numeric(12, 2), nullable=False, default=0)
    total_refund_inr = Column(Numeric(12, 2), nullable=False)    # what the lodge receives
    reason = Column(Text)
    status = Column(String(20), nullable=False,
                     default=BillingRefundStatus.pending.value)
    razorpay_refund_id = Column(String(80))
    razorpay_payment_id = Column(String(80))     # the original payment being refunded
    failure_reason = Column(Text)
    requested_at = Column(DateTime, default=func.now(), nullable=False)
    processed_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now(), nullable=False)


# ──────────────────────────────────────────────────────────────────
# v9.0 — RUSTO Enhanced Marketplace Features
# ──────────────────────────────────────────────────────────────────

# ── Lodge extended amenity & policy fields ──────────────────────
Lodge.power_backup        = Column(Boolean, default=False)     # generator/UPS
Lodge.hot_water_24h       = Column(Boolean, default=False)     # 24h hot water
Lodge.parking_available   = Column(Boolean, default=False)
Lodge.bus_stand_km        = Column(Numeric(4, 1))              # km from bus stand
Lodge.railway_station_km  = Column(Numeric(4, 1))
Lodge.temple_nearby       = Column(Boolean, default=False)
Lodge.checkin_time        = Column(String(10), default="12:00")  # "12:00"
Lodge.checkout_time       = Column(String(10), default="11:00")
Lodge.property_type       = Column(String(40), default="lodge")  # lodge/hotel/homestay/boutique
Lodge.star_category       = Column(Integer, default=0)           # 0–5
Lodge.cancellation_policy = Column(String(40), default="flexible")  # flexible/moderate/strict/non_refundable
Lodge.cancellation_hours  = Column(Integer, default=24)          # hours before checkin for free cancel
Lodge.max_online_rooms_pct = Column(Integer, default=100)        # % of rooms available online vs walk-in
Lodge.instant_confirm     = Column(Boolean, default=True)        # auto-confirm vs request-to-book
Lodge.allow_online_booking = Column(Boolean, default=True)


# ── Customer Wishlist ────────────────────────────────────────────

class RustoWishlist(Base):
    """A customer's saved/wishlist lodge."""
    __tablename__ = "rusto_wishlists"
    __table_args__ = (
        Index("ix_rusto_wish_customer", "customer_id"),
        Index("ix_rusto_wish_lodge_customer", "lodge_id", "customer_id", unique=True),
    )
    wishlist_id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("rusto_customers.customer_id"), nullable=False)
    lodge_id    = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    created_at  = Column(DateTime, default=func.now(), nullable=False)


# ── Local Experience Bundles ─────────────────────────────────────

class LocalBundle(Base):
    """An add-on experience a lodge offers (meal, guide, taxi, etc.)."""
    __tablename__ = "rusto_local_bundles"
    __table_args__ = (
        Index("ix_rusto_bundle_lodge", "lodge_id"),
    )
    bundle_id   = Column(Integer, primary_key=True, autoincrement=True)
    lodge_id    = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    title       = Column(String(120), nullable=False)    # "Village Meal Package"
    description = Column(Text)
    price       = Column(Numeric(10, 2), nullable=False, default=0)
    bundle_type = Column(String(40), default="meal")     # meal/transport/guide/activity
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=func.now())


# ── Bundle add-ons attached to a CustomerBooking ─────────────────

class BookingBundle(Base):
    """Bundles the customer selected at checkout."""
    __tablename__ = "rusto_booking_bundles"
    __table_args__ = (
        Index("ix_rusto_bkbundle_booking", "booking_id"),
    )
    id          = Column(Integer, primary_key=True, autoincrement=True)
    booking_id  = Column(Integer, ForeignKey("rusto_customer_bookings.booking_id"), nullable=False)
    bundle_id   = Column(Integer, ForeignKey("rusto_local_bundles.bundle_id"), nullable=False)
    quantity    = Column(Integer, default=1)
    unit_price  = Column(Numeric(10, 2), nullable=False)
    total_price = Column(Numeric(10, 2), nullable=False)


# ── QR Self Check-In ─────────────────────────────────────────────

class SelfCheckinToken(Base):
    """Time-limited QR token for self check-in at a smart-lock lodge."""
    __tablename__ = "rusto_self_checkin_tokens"
    __table_args__ = (
        Index("ix_rusto_sci_booking", "booking_id"),
        Index("ix_rusto_sci_token", "token", unique=True),
    )
    token_id    = Column(Integer, primary_key=True, autoincrement=True)
    booking_id  = Column(Integer, ForeignKey("rusto_customer_bookings.booking_id"), nullable=False)
    lodge_id    = Column(Integer, ForeignKey("lodges.lodge_id"), nullable=False)
    token       = Column(String(64), nullable=False)   # random secret
    room_number = Column(String(20))                   # assigned by lodge staff
    valid_from  = Column(DateTime, nullable=False)
    valid_until = Column(DateTime, nullable=False)
    used_at     = Column(DateTime)
    created_at  = Column(DateTime, default=func.now())


# ── Platform Analytics snapshot ──────────────────────────────────

class PlatformMetricSnapshot(Base):
    """Daily snapshot for platform-owner analytics dashboard."""
    __tablename__ = "rusto_platform_metrics"
    __table_args__ = (
        Index("ix_platform_metric_date", "snapshot_date", unique=True),
    )
    id                   = Column(Integer, primary_key=True, autoincrement=True)
    snapshot_date        = Column(Date, nullable=False)
    total_lodges         = Column(Integer, default=0)
    published_lodges     = Column(Integer, default=0)
    new_signups_today    = Column(Integer, default=0)
    bookings_today       = Column(Integer, default=0)
    gmv_today            = Column(Numeric(14, 2), default=0)  # gross merchandise value
    cancellations_today  = Column(Integer, default=0)
    new_customers_today  = Column(Integer, default=0)
    reviews_today        = Column(Integer, default=0)
    created_at           = Column(DateTime, default=func.now())
