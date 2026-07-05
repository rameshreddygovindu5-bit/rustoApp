"""
Rusto LMS — Automated Test Suite
Shared fixtures and test infrastructure.
"""
import pytest
import sys
import os
import json
import threading
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import date, timedelta

# ── Add backend to path ─────────────────────────────────────────────
# Resolve paths relative to this file so tests run anywhere (CI included).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_REPO_ROOT, "backend")
sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

# Use a SEPARATE test database so tests don't pollute the production DB
# The test DB is a copy of the production DB made fresh before tests run
import shutil
PROD_DB = os.path.join(_BACKEND, "lodge_lms.db")
TEST_DB = os.path.join(_BACKEND, "lodge_lms_test.db")

# Copy production DB to test DB (gives tests real data to work with)
if os.path.exists(PROD_DB) and (
    not os.path.exists(TEST_DB) or
    os.path.getmtime(PROD_DB) > os.path.getmtime(TEST_DB)
):
    shutil.copy2(PROD_DB, TEST_DB)

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"

# Tests deliberately submit wrong passwords (to verify 401 handling). Without
# raising this, those attempts lock the shared test accounts and every later
# test that logs in as the same user fails with a spurious 401. A very high
# threshold keeps the accounts usable for the whole session while still
# letting the "wrong password returns 401" assertions pass.
os.environ["MAX_LOGIN_ATTEMPTS"] = "100000"

# ── Start backend server once for all tests ─────────────────────────
_server_started = False
_server_port    = 9900
_server_base    = f"http://127.0.0.1:{_server_port}"

def start_test_server():
    global _server_started
    if _server_started:
        return
    import uvicorn
    from app.main import app
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=_server_port,
        log_level="error", timeout_graceful_shutdown=0
    ))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    # Wait for server to be ready
    for _ in range(30):
        try:
            urllib.request.urlopen(f"{_server_base}/docs", timeout=1)
            break
        except:
            time.sleep(0.3)
    _server_started = True

start_test_server()

# ── HTTP helpers ─────────────────────────────────────────────────────
def api_get(path, token=None, params=None, headers=None):
    url = _server_base + path
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url)
    req.add_header("Connection", "close")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code

def api_post(path, body=None, token=None):
    req = urllib.request.Request(_server_base + path, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Connection", "close")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if body:
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code

def api_patch(path, body=None, token=None):
    req = urllib.request.Request(_server_base + path, method="PATCH")
    req.add_header("Content-Type", "application/json")
    req.add_header("Connection", "close")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if body:
        req.data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code

def api_delete(path, token=None):
    req = urllib.request.Request(_server_base + path, method="DELETE")
    req.add_header("Connection", "close")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        try:    return json.loads(e.read()), e.code
        except: return {"error": str(e)}, e.code

# ── Auth fixtures ────────────────────────────────────────────────────

import sqlite3 as _sqlite3
import os as _os

_TEST_DB = _os.path.join(_os.path.dirname(__file__), 
                          "../backend/lodge_lms_test.db")

@pytest.fixture(autouse=True, scope="session")
def reset_test_db_rooms():
    """Reset all rooms to available at the start of every test session."""
    try:
        with _sqlite3.connect(_TEST_DB) as conn:
            # Remove T-prefix test rooms created by previous runs
            conn.execute("DELETE FROM rooms WHERE room_number LIKE 'T%'")
            # Reset all rooms to available (except maintenance)
            conn.execute(
                "UPDATE rooms SET status='available' "
                "WHERE status NOT IN ('maintenance', 'available')"
            )
            # Fix any invalid statuses
            conn.execute(
                "UPDATE rooms SET status='available' "
                "WHERE status NOT IN ('available','occupied','maintenance',"
                "                     'blocked','checkout_due')"
            )
            # Close any leftover active checkins
            conn.execute(
                "UPDATE checkins SET status='checked_out' "
                "WHERE status IN ('active', 'checked_in')"
            )
            # Clear any account lockouts from failed-login tests so later
            # tests can still authenticate (prevents cross-test lockout).
            try:
                conn.execute("UPDATE users SET failed_attempts=0, locked_until=NULL")
            except Exception:
                pass
            # Cancel stale internal bookings (keep only last 5)
            conn.execute(
                "UPDATE bookings SET status='cancelled' "
                "WHERE status NOT IN ('cancelled','completed','no_show') "
                "AND booking_id < (SELECT MAX(booking_id) - 5 FROM bookings)"
            )
            # Cancel stale customer (marketplace) bookings (keep only last 5)
            try:
                conn.execute(
                    "UPDATE rusto_customer_bookings SET status='cancelled' "
                    "WHERE status NOT IN ('cancelled','refunded','expired','no_show') "
                    "AND booking_id < (SELECT MAX(booking_id) - 5 "
                    "                  FROM rusto_customer_bookings)"
                )
            except Exception:
                pass  # Table may not exist
            conn.commit()
    except Exception:
        pass  # If DB doesn't exist yet, that's fine
    yield

@pytest.fixture(scope="session")
def pms_token():
    """PMS admin token (superadmin)."""
    r, s = api_post("/api/auth/login", {"username": "superadmin", "password": "superadmin123"})
    assert s == 200, f"Superadmin login failed: {r}"
    return r["token"]

@pytest.fixture(scope="session")
def lodge_token():
    """Lodge admin token."""
    r, s = api_post("/api/auth/login", {"username": "admin", "password": "Admin@1234"})
    assert s == 200, f"Lodge admin login failed: {r}"
    return r["token"]

@pytest.fixture(scope="session")
def customer_token():
    """Customer JWT token."""
    r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000", "password": "Demo@1234"})
    assert s == 200, f"Customer login failed: {r}"
    return r["token"]

def _find_available_lodge_and_dates():
    """
    Scan all published lodges across 30–200 days out and return the first
    (lodge_code, checkin, checkout) that has at least one room type with
    availability > 0.  Falls back to a far-future window if nothing found.
    """
    lodges_r, s = api_get("/api/rusto/public/lodges")
    if s != 200:
        return "rk", (date.today() + timedelta(days=200)).isoformat(), \
               (date.today() + timedelta(days=202)).isoformat()

    lodges = lodges_r.get("lodges", lodges_r) if isinstance(lodges_r, dict) else lodges_r

    # Try each lodge across a range of dates that avoid likely conflicts
    # Start far enough out (day 150+) to avoid previously-created test bookings
    for days_ahead in list(range(150, 365, 7)):
        ci = (date.today() + timedelta(days=days_ahead)).isoformat()
        co = (date.today() + timedelta(days=days_ahead + 2)).isoformat()
        for lodge in lodges:
            code = lodge.get("code", "")
            if not code:
                continue
            avail_r, avail_s = api_get(
                f"/api/rusto/public/lodges/{code}/availability",
                params={"from": ci, "to": co}
            )
            if avail_s != 200:
                continue
            rooms = avail_r.get("rooms", [])
            if any(rm.get("available", 0) > 0 for rm in rooms):
                return code, ci, co

    # Absolute fallback — any lodge, very far future
    code = lodges[0]["code"] if lodges else "rk"
    ci = (date.today() + timedelta(days=300)).isoformat()
    co = (date.today() + timedelta(days=302)).isoformat()
    return code, ci, co

# Cache the result so we call it once per session
_avail_cache = None

def _get_available_slot():
    global _avail_cache
    if _avail_cache is None:
        _avail_cache = _find_available_lodge_and_dates()
    return _avail_cache

@pytest.fixture(scope="session")
def lodge_code():
    """Get first published lodge code that has available rooms in the test window."""
    code, _, _ = _get_available_slot()
    return code

@pytest.fixture(scope="session")
def checkin_date():
    """A future check-in date guaranteed to have room availability."""
    _, ci, _ = _get_available_slot()
    return ci

@pytest.fixture(scope="session")
def checkout_date():
    """A future check-out date guaranteed to have room availability."""
    _, _, co = _get_available_slot()
    return co

# ── Shared constants ─────────────────────────────────────────────────
BASE = _server_base

import warnings

def pytest_configure(config):
    """Suppress deprecation warnings from third-party packages we cannot modify."""
    warnings.filterwarnings("ignore", message=".*datetime.datetime.utcnow.*", module="jose.*")
    warnings.filterwarnings("ignore", message=".*datetime.datetime.utcnow.*", module="openpyxl.*")
    warnings.filterwarnings("ignore", message=".*websockets.legacy.*")
    warnings.filterwarnings("ignore", message=".*WebSocketServerProtocol.*")
    warnings.filterwarnings("ignore", message=".*urllib3.*chardet.*")
    warnings.filterwarnings("ignore", message=".*declarative_base.*", category=DeprecationWarning)

# ── Comprehensive test data seed ─────────────────────────────────────
# The suite expects a richer dataset than the app's built-in seed:
# lodge code "udumulas" (a source-app leftover the tests hardcode),
# published lodges, and staff1/staff2 users. This fixture reconciles the
# app's seed with those expectations. Idempotent; runs once per session
# after the server (and its seed_initial_data) has started.
@pytest.fixture(autouse=True, scope="session")
def seed_test_data(reset_test_db_rooms):
    try:
        from app.database import SessionLocal
        from app.models import Lodge, User, UserRole, RustoCustomer
        from app.auth import get_password_hash
        from app.rusto_auth import hash_customer_password
        db = SessionLocal()
        try:
            # Lodge 1 must answer to code "udumulas" (tests hardcode it).
            def publish(l, city="Guntur"):
                l.is_active = True
                l.is_published = True
                for attr, val in [("allow_online_booking", True),
                                  ("public_city", city),
                                  ("public_description", f"{l.name} — comfortable stay."),
                                  ("starting_price", 1000)]:
                    if hasattr(l, attr):
                        setattr(l, attr, val)
            l1 = db.query(Lodge).filter_by(lodge_id=1).first()
            if l1:
                l1.code = "udumulas"
            else:
                l1 = Lodge(code="udumulas", name="Udumula's Grand", is_active=True)
                db.add(l1); db.flush()
            publish(l1)

            # A second published lodge coded "rk".
            l2 = db.query(Lodge).filter_by(code="rk").first()
            if not l2:
                l2 = Lodge(code="rk", name="RK Residency", is_active=True)
                db.add(l2); db.flush()
            publish(l2, city="Vijayawada")
            db.flush()

            def ensure_user(username, password, role, lodge_id, full_name):
                u = db.query(User).filter_by(username=username).first()
                if not u:
                    u = User(username=username)
                    db.add(u)
                u.password_hash = get_password_hash(password)
                u.role = role
                u.lodge_id = lodge_id
                u.full_name = full_name
                u.is_active = True
                if hasattr(u, "totp_enabled"):
                    u.totp_enabled = False
                if hasattr(u, "require_login_otp"):
                    u.require_login_otp = False
                return u

            ensure_user("admin",      "Admin@1234",    UserRole.admin,       l1.lodge_id, "Lodge Admin")
            ensure_user("staff1",     "Staff1@1234",   UserRole.staff,       l1.lodge_id, "Staff One")
            ensure_user("staff2",     "Staff2@1234",   UserRole.staff,       l1.lodge_id, "Staff Two")
            ensure_user("superadmin", "superadmin123", UserRole.super_admin, l1.lodge_id, "Super Admin")

            # Lodge 2 (rk) needs its own settings row-set (app only seeds
            # settings for lodge 1). Copy the key settings so multi-tenant
            # isolation tests see non-empty, separate settings per lodge.
            from app.models import Setting
            existing_rk = db.query(Setting).filter_by(lodge_id=l2.lodge_id).count()
            if existing_rk == 0:
                seed_settings = [
                    ("hotel_name", "RK Residency"),
                    ("hotel_address", "Vijayawada"),
                    ("hotel_phone", ""),
                    ("hotel_email", ""),
                    ("currency", "INR"),
                    ("timezone", "Asia/Kolkata"),
                    ("checkin_time", "12:00"),
                    ("checkout_time", "11:00"),
                ]
                for key, val in seed_settings:
                    db.add(Setting(lodge_id=l2.lodge_id, setting_key=key,
                                   setting_value=val))
                db.flush()

            # Lodge-side customer (agent + PMS tests need one on lodge 1).
            from app.models import Customer
            lc = db.query(Customer).filter_by(lodge_id=l1.lodge_id, phone="9333322221").first()
            if not lc:
                lc = Customer(lodge_id=l1.lodge_id, first_name="Ravi", last_name="Kumar",
                              phone="9333322221")
                db.add(lc)
            lc.first_name = "Ravi"; lc.last_name = "Kumar"
            if hasattr(lc, "blacklisted"):
                lc.blacklisted = False
            if hasattr(lc, "id_type"):
                lc.id_type = lc.id_type or "aadhar"
            if hasattr(lc, "id_number"):
                lc.id_number = lc.id_number or "222233334444"

            # Marketplace customer for /api/rusto/auth/login tests.
            cust = db.query(RustoCustomer).filter_by(phone="9000000000").first()
            if not cust:
                cust = RustoCustomer(phone="9000000000", full_name="Demo Customer")
                db.add(cust)
            cust.password_hash = hash_customer_password("Demo@1234")
            cust.is_active = True

            db.commit()
        finally:
            db.close()
    except Exception as e:
        import sys
        print(f"[seed_test_data] warning: {e}", file=sys.stderr)
    yield
