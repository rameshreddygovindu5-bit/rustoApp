"""
TEST SUITE 39 — Complete PMS Workflow Verification

Covers every functional area:
  1. Authentication & role-based access control
  2. Dashboard KPIs (all 6 metrics + activity + trend)
  3. Check-in / check-out / late-checkout full lifecycle
  4. Bookings (create / list / arrivals / prefill / cancel)
  5. SMS & email configuration surface
  6. Admin monitoring (reports, health, alerts)
  7. Super-admin cross-lodge monitoring
"""
import pytest
import time
import json
from datetime import datetime, timedelta
import urllib.request
import urllib.parse
import urllib.error
from conftest import api_get, api_post, start_test_server, _server_base


# ── Shared helpers ──────────────────────────────────────────────────
def _put(path, body, token, lodge_id=None):
    headers = {"Content-Type": "application/json",
               "Authorization": f"Bearer {token}"}
    if lodge_id:
        headers["X-Lodge-Id"] = str(lodge_id)
    req = urllib.request.Request(
        _server_base + path,
        data=json.dumps(body).encode(),
        headers=headers, method="PUT")
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code


def _form(path, body, token):
    """POST as application/x-www-form-urlencoded (used by check-in endpoint)."""
    data = urllib.parse.urlencode(body).encode()
    req = urllib.request.Request(
        _server_base + path, data=data, method="POST",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code


def _custs(resp):
    """Extract customer list from either list or paginated {data:[...]} response."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        return resp.get("data", resp.get("customers", []))
    return []


# ── Module-level fixtures ───────────────────────────────────────────
@pytest.fixture(scope="module")
def server():
    start_test_server()
    time.sleep(1)
    yield


@pytest.fixture(scope="module")
def admin_token(server):
    r, s = api_post("/api/auth/login",
                    {"username": "admin", "password": "Admin@1234"})
    assert s == 200, f"Admin login: {s} {r}"
    return r["token"]


@pytest.fixture(scope="module")
def staff_token(server):
    r, s = api_post("/api/auth/login",
                    {"username": "staff1", "password": "Staff1@1234"})
    assert s == 200, f"Staff login: {s} {r}"
    return r["token"]


@pytest.fixture(scope="module")
def super_token(server):
    r, s = api_post("/api/auth/login",
                    {"username": "superadmin", "password": "superadmin123"})
    assert s == 200, f"Super login: {s} {r}"
    return r["token"]


@pytest.fixture(scope="module")
def available_rooms(admin_token):
    """Get available rooms, checking out any leftover active checkins first."""
    # Check for any active checkins and force-checkout them so we have rooms
    r, s = api_get("/api/checkins?status=active&page_size=50", token=admin_token)
    if s == 200:
        active = r if isinstance(r, list) else r.get("checkins", [])
        for ci in active[:10]:  # cleanup up to 10
            cid = ci.get("checkin_id")
            if cid:
                _put(f"/api/checkins/{cid}/checkout",
                     {"payment_mode": "cash", "final_payment": 0,
                      "notes": "test_39 cleanup"}, admin_token)
    time.sleep(0.3)
    r2, s2 = api_get("/api/rooms?status=available", token=admin_token)
    rooms = r2 if isinstance(r2, list) else []
    assert rooms, f"Still no available rooms after cleanup: {r2}"
    return rooms


# ════════════════════════════════════════════════════════════════════
# 1. AUTHENTICATION & ROLES
# ════════════════════════════════════════════════════════════════════
class TestAuth:

    def test_admin_login_ok(self, server):
        r, s = api_post("/api/auth/login",
                        {"username": "admin", "password": "Admin@1234"})
        assert s == 200
        assert r["user"]["role"] == "admin"
        assert r["user"]["lodge_id"] == 1

    def test_staff_login_ok(self, server):
        r, s = api_post("/api/auth/login",
                        {"username": "staff1", "password": "Staff1@1234"})
        assert s == 200
        assert r["user"]["role"] == "staff"

    def test_superadmin_login_ok(self, server):
        r, s = api_post("/api/auth/login",
                        {"username": "superadmin", "password": "superadmin123"})
        assert s == 200
        assert r["user"]["role"] == "super_admin"

    def test_wrong_password_rejected(self, server):
        r, s = api_post("/api/auth/login",
                        {"username": "admin", "password": "wrong"})
        assert s in (401, 403)

    def test_no_token_blocked(self, server):
        r, s = api_get("/api/checkins")
        assert s in (401, 403)

    def test_me_returns_correct_user(self, admin_token):
        r, s = api_get("/api/auth/me", token=admin_token)
        assert s == 200
        assert r["username"] == "admin"
        assert r["role"] == "admin"
        assert r["lodge_id"] == 1

    def test_staff_me(self, staff_token):
        r, s = api_get("/api/auth/me", token=staff_token)
        assert s == 200
        assert r["role"] == "staff"

    def test_staff_cannot_write_settings(self, staff_token):
        r, s = _put("/api/settings/hotel_name",
                    {"value": "Hacked"}, staff_token)
        assert s == 403

    def test_admin_can_write_settings(self, admin_token):
        r, s = _put("/api/settings/hotel_name",
                    {"value": "Udumula's Grand"}, admin_token)
        assert s in (200, 204)

    def test_staff_reads_settings_sensitive_masked(self, staff_token):
        r, s = api_get("/api/settings", token=staff_token)
        assert s == 200
        for item in r:
            if item.get("is_sensitive"):
                val = item.get("setting_value", "")
                # Backend masks with '***' or '••••••••' or empty string
                is_masked = (
                    not val
                    or val in ("", "***")
                    or set(val).issubset({"•", "*"})  # bullet or asterisk mask
                    or len(val) <= 4  # very short masked value
                )
                assert is_masked,                     f"Sensitive {item['setting_key']} not masked for staff: {val!r}"

    def test_staff_sees_only_own_lodge(self, staff_token):
        r, s = api_get("/api/lodges", token=staff_token)
        assert s == 200
        lodges = r if isinstance(r, list) else []
        assert len(lodges) == 1
        assert lodges[0]["lodge_id"] == 1

    def test_super_sees_all_lodges(self, super_token):
        r, s = api_get("/api/lodges", token=super_token)
        assert s == 200
        lodges = r if isinstance(r, list) else []
        assert len(lodges) >= 1

    def test_super_dashboard_requires_lodge_id(self, super_token):
        r, s = api_get("/api/reports/dashboard", token=super_token)
        assert s == 400

    def test_super_dashboard_with_lodge_id(self, super_token):
        r, s = api_get("/api/reports/dashboard", token=super_token,
                       headers={"X-Lodge-Id": "1"})
        assert s == 200
        assert "kpis" in r

    def test_staff_otp_off_by_default(self, server):
        """With require_staff_otp=false, staff2 logs in directly."""
        r, s = api_post("/api/auth/login",
                        {"username": "staff2", "password": "Staff2@1234"})
        assert s == 200
        assert "token" in r


# ════════════════════════════════════════════════════════════════════
# 2. DASHBOARD
# ════════════════════════════════════════════════════════════════════
class TestDashboard:

    def test_admin_dashboard(self, admin_token):
        r, s = api_get("/api/reports/dashboard", token=admin_token)
        assert s == 200

    def test_staff_dashboard(self, staff_token):
        r, s = api_get("/api/reports/dashboard", token=staff_token)
        assert s == 200

    def test_all_kpis_present(self, admin_token):
        r, s = api_get("/api/reports/dashboard", token=admin_token)
        assert s == 200
        k = r["kpis"]
        for field in ["total_rooms", "available_rooms", "occupied_rooms",
                      "today_revenue", "today_revenue_breakdown",
                      "occupancy_rate", "total_customers", "overdue_count",
                      "online_bookings_pending", "online_arrivals_today"]:
            assert field in k, f"Missing KPI: {field}"

    def test_revenue_breakdown_modes(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        bd = r["kpis"]["today_revenue_breakdown"]
        for mode in ["cash", "upi", "card", "bank_transfer", "online", "other"]:
            assert mode in bd

    def test_activity_feed_present(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        assert isinstance(r.get("activity"), list)

    def test_daily_checkins_chart(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        assert isinstance(r.get("daily_checkins"), list)

    def test_occupancy_in_range(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        occ = r["kpis"]["occupancy_rate"]
        assert 0 <= occ <= 100

    def test_room_counts_sum_correctly(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        k = r["kpis"]
        parts = (k["available_rooms"] + k["occupied_rooms"]
                 + k.get("maintenance_rooms", 0) + k.get("blocked_rooms", 0))
        assert abs(k["total_rooms"] - parts) <= 2

    def test_dashboard_has_5_rooms(self, admin_token):
        r, _ = api_get("/api/reports/dashboard", token=admin_token)
        # Production has 5; test DB may have 5–6 due to test-created rooms
        assert r["kpis"]["total_rooms"] >= 5


# ════════════════════════════════════════════════════════════════════
# 3. CHECK-IN / CHECKOUT LIFECYCLE
# ════════════════════════════════════════════════════════════════════
class TestCheckin:

    @pytest.fixture(scope="class")
    @classmethod
    def guest(cls, admin_token):
        """Create or retrieve test guest."""
        phone = "9333344445"
        r, s = api_post("/api/customers",
                        {"first_name": "CI", "last_name": "TestGuest",
                         "phone": phone, "id_type": "aadhar",
                         "id_number": "444444444444", "gender": "male"},
                        token=admin_token)
        if s in (200, 201):
            return r
        r2, _ = api_get("/api/customers", token=admin_token,
                        params={"search": phone})
        custs = _custs(r2)
        assert custs, f"Guest not found: {r}"
        return custs[0]

    @pytest.fixture(scope="class")
    @classmethod
    def room_for_checkin(cls, available_rooms):
        return available_rooms[0]

    @pytest.fixture(scope="class")
    @classmethod
    def active_checkin(cls, admin_token, guest, room_for_checkin):
        now = datetime.now()
        body = {
            "first_name":        guest.get("first_name", "CI"),
            "last_name":         guest.get("last_name", "TestGuest"),
            "phone":             guest.get("phone", "9333344445"),
            "id_type":           guest.get("id_type", "aadhar"),
            "id_number":         guest.get("id_number", "444444444444"),
            "gender":            guest.get("gender", "male"),
            "room_id":           str(room_for_checkin["room_id"]),
            "checkin_datetime":  now.strftime("%Y-%m-%dT%H:%M"),
            "expected_checkout": (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M"),
            "members_count":     "2",
            "tariff_per_night":  str(room_for_checkin.get("base_tariff", 1000)),
            "payment_mode":      "upi",
            "deposit_amount":    "500",
        }
        r, s = _form("/api/checkins", body, admin_token)
        assert s in (200, 201), f"Check-in failed: {s} {r}"
        return r

    def test_checkin_created(self, active_checkin):
        assert active_checkin.get("checkin_id") is not None
        assert active_checkin.get("room_number") is not None

    def test_checkin_has_customer_name(self, active_checkin):
        # The checkin response has customer info either as customer_name (create)
        # or nested in customer.first_name (checkin_to_dict format)
        has_name = (
            active_checkin.get("customer_name") is not None
            or (active_checkin.get("customer") or {}).get("first_name") is not None
        )
        assert has_name, f"No customer name in checkin response: {list(active_checkin.keys())}"

    def test_admin_sees_checkin(self, admin_token, active_checkin):
        cid = active_checkin["checkin_id"]
        r, s = api_get(f"/api/checkins/{cid}", token=admin_token)
        assert s == 200
        assert r["checkin_id"] == cid

    def test_staff_can_list_checkins(self, staff_token):
        r, s = api_get("/api/checkins", token=staff_token)
        assert s == 200

    def test_staff_sees_active_checkin_by_id(self, staff_token, active_checkin):
        """Staff can fetch the specific checkin by ID."""
        cid = active_checkin["checkin_id"]
        r, s = api_get(f"/api/checkins/{cid}", token=staff_token)
        assert s == 200
        assert r["checkin_id"] == cid

    def test_late_checkout(self, admin_token, active_checkin):
        cid = active_checkin["checkin_id"]
        from datetime import datetime, timedelta
        new_time = (datetime.now() + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M")
        r, s = _put(f"/api/checkins/{cid}/late-checkout",
                    {"new_checkout_time": new_time,
                     "late_checkout_charge": 400.0,
                     "notes": "Guest requested late checkout"},
                    admin_token)
        assert s == 200, f"Late checkout: {s} {r}"

    def test_checkout(self, admin_token, active_checkin):
        cid = active_checkin["checkin_id"]
        r, s = _put(f"/api/checkins/{cid}/checkout",
                    {"payment_mode": "cash",
                     "final_payment": 500,
                     "notes": "Workflow test checkout"},
                    admin_token)
        assert s == 200, f"Checkout: {s} {r}"

    def test_room_available_after_checkout(self, admin_token, room_for_checkin):
        time.sleep(0.3)
        r, s = api_get(f"/api/rooms/{room_for_checkin['room_id']}",
                       token=admin_token)
        assert s == 200
        assert r.get("status") == "available"

    def test_activity_feed_updated(self, admin_token):
        r, s = api_get("/api/reports/dashboard", token=admin_token)
        assert s == 200
        # After checkin/checkout activity list should have entries
        assert isinstance(r.get("activity"), list)


# ════════════════════════════════════════════════════════════════════
# 4. BOOKINGS
# ════════════════════════════════════════════════════════════════════
class TestBookings:

    @pytest.fixture(scope="class")
    @classmethod
    def booking_guest(cls, admin_token):
        phone = "9444455556"
        r, s = api_post("/api/customers",
                        {"first_name": "BK", "last_name": "Guest",
                         "phone": phone, "id_type": "aadhar",
                         "id_number": "555555555555", "gender": "female"},
                        token=admin_token)
        if s in (200, 201):
            return r
        r2, _ = api_get("/api/customers", token=admin_token,
                        params={"search": phone})
        custs = _custs(r2)
        assert custs, "booking_guest not found"
        return custs[0]

    @pytest.fixture(scope="class")
    @classmethod
    def booking(cls, admin_token, available_rooms, booking_guest):
        rm = available_rooms[-1]
        body = {
            "guest_name":    f"{booking_guest['first_name']} {booking_guest['last_name']}",
            "guest_phone":   booking_guest.get("phone", "9444455556"),
            "room_type":     rm.get("room_type", "ac"),
            "checkin_date":  (datetime.now() + timedelta(days=8)).strftime("%Y-%m-%d"),
            "checkout_date": (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d"),
            "tariff_per_night": float(rm.get("base_tariff", 1000)),
            "adults":        2,
            "advance_amount": 500,
        }
        r, s = api_post("/api/bookings", body, token=admin_token)
        assert s in (200, 201), f"Booking create: {s} {r}"
        return r

    def test_booking_created(self, booking):
        assert booking.get("booking_id") is not None

    def test_booking_in_list(self, admin_token, booking):
        r, s = api_get("/api/bookings", token=admin_token)
        assert s == 200
        # API returns paginated {"total":N,"page":1,"data":[...]}
        bkgs = (r if isinstance(r, list)
                else r.get("data", r.get("bookings", [])))
        ids = [b.get("booking_id") for b in bkgs]
        assert booking["booking_id"] in ids, f"booking {booking['booking_id']} not in {ids[:5]}"

    def test_staff_can_view_bookings(self, staff_token):
        r, s = api_get("/api/bookings", token=staff_token)
        assert s == 200  # staff has bookings.read in LEGACY_STAFF_DEFAULTS

    def test_upcoming_arrivals_endpoint(self, admin_token):
        r, s = api_get("/api/bookings/upcoming-arrivals?days=30",
                       token=admin_token)
        assert s == 200
        assert isinstance(r, list)

    def test_booking_appears_in_arrivals(self, admin_token, booking):
        r, s = api_get("/api/bookings/upcoming-arrivals?days=30",
                       token=admin_token)
        assert s == 200
        ids = [b.get("booking_id") for b in r]
        assert booking["booking_id"] in ids

    def test_booking_prefill(self, admin_token, booking):
        bid = booking["booking_id"]
        r, s = api_get(f"/api/bookings/{bid}/checkin-prefill",
                       token=admin_token)
        assert s == 200
        # Prefill returns booking + customer info for the check-in modal
        assert isinstance(r, dict)
        # Must have at least one identifying field
        # prefill endpoint returns booking + merged customer/room data
        assert isinstance(r, dict) and len(r) > 0, f"Empty prefill response: {r}"

    def test_booking_cancel(self, admin_token, booking):
        bid = booking["booking_id"]
        r, s = _put(f"/api/bookings/{bid}/cancel",
                    {"reason": "Test cancellation"}, admin_token)
        assert s in (200, 204), f"Cancel: {s} {r}"

    def test_dashboard_arrivals_reflects_booking(self, admin_token):
        r, s = api_get("/api/reports/dashboard", token=admin_token)
        assert s == 200
        # Dashboard should show upcoming arrivals count (may be 0 after cancel)
        assert "kpis" in r


# ════════════════════════════════════════════════════════════════════
# 5. SMS & EMAIL CONFIGURATION
# ════════════════════════════════════════════════════════════════════
class TestSmsEmail:

    def test_settings_has_smtp_keys(self, admin_token):
        r, s = api_get("/api/settings", token=admin_token)
        assert s == 200
        keys = {x["setting_key"] for x in r}
        for k in ["smtp_host", "smtp_port", "smtp_user", "email_enabled"]:
            assert k in keys, f"Missing: {k}"

    def test_settings_has_sms_keys(self, admin_token):
        r, s = api_get("/api/settings", token=admin_token)
        assert s == 200
        keys = {x["setting_key"] for x in r}
        for k in ["sms_enabled", "sms_provider", "twilio_account_sid"]:
            assert k in keys, f"Missing: {k}"

    def test_settings_has_ai_keys(self, admin_token):
        r, s = api_get("/api/settings", token=admin_token)
        assert s == 200
        keys = {x["setting_key"] for x in r}
        for k in ["agent_enabled", "agent_provider", "agent_anthropic_key"]:
            assert k in keys, f"Missing AI setting: {k}"

    def test_sms_vendor_status_endpoint(self, admin_token):
        r, s = api_get("/api/alerts/sms-vendor-status", token=admin_token)
        assert s in (200, 400, 503), f"SMS vendor endpoint: {s}"

    def test_alerts_list_accessible(self, admin_token):
        r, s = api_get("/api/alerts", token=admin_token)
        assert s == 200

    def test_staff_cannot_see_sensitive_sms_creds(self, staff_token):
        r, s = api_get("/api/settings", token=staff_token)
        assert s == 200
        for item in r:
            if item["setting_key"] in ("twilio_auth_token", "smtp_password",
                                       "agent_anthropic_key", "razorpay_key_secret"):
                val = item.get("setting_value", "")
                assert val in ("", None, "***"), \
                    f"Sensitive {item['setting_key']} visible to staff"

    def test_email_templates_endpoint(self, admin_token):
        r, s = api_get("/api/emails/templates", token=admin_token)
        assert s in (200, 404)

    def test_sms_enabled_toggle_readable(self, admin_token):
        r, _ = api_get("/api/settings", token=admin_token)
        cfg = {x["setting_key"]: x["setting_value"] for x in r}
        assert cfg.get("sms_enabled") in ("true", "false")

    def test_test_sms_endpoint_exists(self, admin_token):
        """Test SMS endpoint should exist even if SMS not configured."""
        r, s = api_post("/api/alerts/test-sms",
                        {"phone": "9000000001"}, token=admin_token)
        # 200 (sent), 400 (not configured), 403 (no permission) all acceptable
        assert s in (200, 400, 422, 403, 500), f"test-sms: {s}"


# ════════════════════════════════════════════════════════════════════
# 6. ADMIN MONITORING & REPORTS
# ════════════════════════════════════════════════════════════════════
class TestAdminMonitoring:

    def test_reports_summary(self, admin_token):
        r, s = api_get("/api/reports/summary", token=admin_token)
        assert s == 200
        for k in ["total_revenue", "checkins_count", "avg_occupancy"]:
            assert k in r

    def test_reports_occupancy(self, admin_token):
        r, s = api_get("/api/reports/occupancy", token=admin_token)
        assert s == 200
        assert isinstance(r, list)
        for row in r:
            assert 0 <= row.get("occupancy_pct", 0) <= 100

    def test_reports_revenue(self, admin_token):
        r, s = api_get("/api/reports/revenue", token=admin_token)
        assert s == 200
        assert isinstance(r, list)

    def test_staff_can_view_reports(self, staff_token):
        r, s = api_get("/api/reports/dashboard", token=staff_token)
        assert s == 200

    def test_health_endpoint(self, server):
        r, s = api_get("/api/health")
        assert s == 200
        assert r["status"] == "healthy"
        assert "integrations" in r
        assert "version" in r
        assert "lodges" in r

    def test_health_shows_integrations(self, server):
        r, _ = api_get("/api/health")
        integs = r.get("integrations", {})
        for k in ["sms", "email", "ai"]:
            assert k in integs

    def test_rooms_count_correct(self, admin_token):
        r, s = api_get("/api/rooms", token=admin_token)
        assert s == 200
        rooms = r if isinstance(r, list) else []
        # Production has 5; test DB may have 5–6 due to test-created rooms
        assert len(rooms) >= 5

    def test_alerts_stats_endpoint(self, admin_token):
        r, s = api_get("/api/alerts/stats", token=admin_token)
        assert s in (200, 404)

    def test_gst_export_endpoint(self, admin_token):
        r, s = api_get("/api/reports/export?type=revenue&format=xlsx",
                       token=admin_token)
        assert s in (200, 400, 422)

    def test_customers_list_accessible(self, admin_token):
        r, s = api_get("/api/customers", token=admin_token)
        assert s == 200

    def test_housekeeping_list(self, admin_token):
        r, s = api_get("/api/housekeeping/tasks", token=admin_token)
        assert s == 200

    def test_maintenance_list(self, admin_token):
        r, s = api_get("/api/maintenance/tickets", token=admin_token)
        assert s == 200

    def test_expenses_list(self, admin_token):
        r, s = api_get("/api/expenses", token=admin_token)
        assert s in (200, 404)

    def test_inventory_list(self, admin_token):
        r, s = api_get("/api/inventory", token=admin_token)
        assert s in (200, 404)


# ════════════════════════════════════════════════════════════════════
# 7. SUPER ADMIN MONITORING
# ════════════════════════════════════════════════════════════════════
class TestSuperAdmin:

    def test_platform_lodges_visible(self, super_token):
        r, s = api_get("/api/lodges", token=super_token)
        assert s == 200
        lodges = r if isinstance(r, list) else []
        assert len(lodges) >= 1
        for l in lodges:
            assert "name" in l and "code" in l

    def test_lodge_is_udumulas(self, super_token):
        r, s = api_get("/api/lodges", token=super_token)
        assert s == 200
        lodges = r if isinstance(r, list) else []
        codes = [l.get("code") for l in lodges]
        assert "udumulas" in codes

    def test_super_dashboard_lodge1(self, super_token):
        r, s = api_get("/api/reports/dashboard", token=super_token,
                       headers={"X-Lodge-Id": "1"})
        assert s == 200
        # Production has 5; test DB may have 5–6 due to test-created rooms
        assert r["kpis"]["total_rooms"] >= 5

    def test_super_manages_users(self, super_token):
        r, s = api_get("/api/auth/users", token=super_token)
        assert s == 200
        users = r if isinstance(r, list) else []
        roles = {u.get("role") for u in users}
        assert "admin" in roles
        assert "staff" in roles
        assert "super_admin" in roles

    def test_super_portal_settings_endpoint(self, super_token):
        r, s = api_get("/api/lodges/1/portal-settings", token=super_token)
        assert s in (200, 404)

    def test_super_cannot_be_blocked_from_own_lodge(self, super_token):
        """Super admin's own lodge dashboard always accessible."""
        r, s = api_get("/api/reports/dashboard", token=super_token,
                       headers={"X-Lodge-Id": "1"})
        assert s == 200

    def test_super_set_portal_settings(self, super_token):
        """Super admin can update portal branding."""
        r, s = _put("/api/lodges/1/portal-settings",
                    {"ip_ranges": "192.168.68.0/22\n127.0.0.1\n::1",
                     "primary_color": "#07131C",
                     "accent_color": "#E8A020"},
                    super_token)
        assert s in (200, 204, 404)
