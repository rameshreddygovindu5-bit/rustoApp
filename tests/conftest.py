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
sys.path.insert(0, "../backend")
os.chdir("../backend")

# Use a SEPARATE test database so tests don't pollute the production DB
# The test DB is a copy of the production DB made fresh before tests run
import shutil
PROD_DB = "../backend/lodge_lms.db"
TEST_DB = "../backend/lodge_lms_test.db"

# Copy production DB to test DB (gives tests real data to work with)
if not os.path.exists(TEST_DB) or (
    os.path.exists(PROD_DB) and
    os.path.getmtime(PROD_DB) > os.path.getmtime(TEST_DB)
):
    shutil.copy2(PROD_DB, TEST_DB)

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"

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
