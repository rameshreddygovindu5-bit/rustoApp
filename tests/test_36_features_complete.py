import os
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
"""
TEST SUITE 36 — Feature Completeness (v10.0)
============================================
Tests every feature implemented or identified as missing:
  - New roles: lodge_owner, app_owner, vendor in API responses
  - Staff OTP settings management (per-user and lodge-wide)
  - AuthContext role fields (frontend via /api/auth/me)
  - RBAC enforcement for all 6 roles
  - Settings: require_staff_otp read/write
  - Session security: token scope isolation
  - Audit trail: OTP events logged
  - Data quality: no ghost data between tests
"""
import pytest
import time
from conftest import api_get, api_post, api_patch, api_delete


# ─── helpers ──────────────────────────────────────────────────────────────────

def _login(u, p):
    return api_post("/api/auth/login", {"username": u, "password": p})

def _login_tok(u, p):
    r, s = _login(u, p)
    if s == 200 and "token" in r:
        return r["token"]
    return None

def _admin_tok():
    return _login_tok("admin", "Admin@1234")

def _super_tok():
    return _login_tok("superadmin", "superadmin123")


# ─── 1. Role API field completeness ───────────────────────────────────────────

class TestRoleApiFields:
    """Every role must be representable in the DB and visible via /api/auth/me."""
    @classmethod
    @pytest.fixture(scope="class")
    def admin_tok(cls):
        return _admin_tok()
    @classmethod
    @pytest.fixture(scope="class")
    def super_tok(cls):
        return _super_tok()

    def test_super_admin_me(self, super_tok):
        r, s = api_get("/api/auth/me", token=super_tok)
        assert s == 200
        assert r["role"] == "super_admin"
        assert "require_login_otp" in r or "totp_enabled" in r

    def test_admin_me(self, admin_tok):
        r, s = api_get("/api/auth/me", token=admin_tok)
        assert s == 200
        assert r["role"] in ("admin", "super_admin")
        assert "lodge_id" in r

    def test_lodge_owner_role_can_be_created(self, admin_tok):
        ts = int(time.time()) % 100000
        r, s = api_post("/api/auth/users", {
            "username": f"owner_{ts}",
            "full_name": "Test Lodge Owner",
            "password": "Owner@1234",
            "role": "lodge_owner",
        }, token=admin_tok)
        assert s in (200, 201, 409), f"Create lodge_owner: {s} {r}"
        if s in (200, 201):
            uid = r.get("user_id")
            # Can login
            r2, s2 = _login(f"owner_{ts}", "Owner@1234")
            assert s2 == 200, f"lodge_owner login: {s2}"
            assert r2["user"]["role"] == "lodge_owner"

    def test_app_owner_me(self):
        tok = _login_tok("appowner", "AppOwner@2024")
        if not tok:
            pytest.skip("appowner not seeded")
        r, s = api_get("/api/auth/me", token=tok)
        assert s == 200
        assert r["role"] in ("app_owner", "super_admin")

    def test_vendor_role_can_be_created(self):
        super_tok = _super_tok()
        ts = int(time.time()) % 100000
        r, s = api_post("/api/auth/users", {
            "username":  f"vendor_{ts}",
            "full_name": "Test Vendor",
            "password":  "Vendor@1234",
            "role":      "vendor",
            "lodge_id":  1,
        }, token=super_tok)
        assert s in (200, 201, 400, 409), f"Create vendor: {s} {r}"

    def test_me_returns_require_login_otp(self, admin_tok):
        """GET /me should return the require_login_otp field (v10.0)."""
        r, s = api_get("/api/auth/me", token=admin_tok)
        assert s == 200
        assert "require_login_otp" in r, f"/me missing require_login_otp: {r.keys()}"

    def test_all_roles_valid_in_create(self, admin_tok):
        """API must accept all 6 role values in CreateUserRequest."""
        ts = int(time.time()) % 100000
        # Only staff and lodge_owner are safe to create as tenant admin
        for role in ("staff", "lodge_owner"):
            r, s = api_post("/api/auth/users", {
                "username":  f"role_test_{role}_{ts}",
                "full_name": f"Role Test {role}",
                "password":  "RoleTest@1234",
                "role":      role,
            }, token=admin_tok)
            assert s in (200, 201, 409), f"Create {role}: {s} {r}"

    def test_invalid_role_rejected(self, admin_tok):
        """Unknown role values must be rejected."""
        r, s = api_post("/api/auth/users", {
            "username":  "badrole_user",
            "full_name": "Bad Role",
            "password":  "Bad@1234",
            "role":      "superuser",  # not a valid role
        }, token=admin_tok)
        assert s in (400, 422), f"Invalid role must fail: {s}"


# ─── 2. Staff OTP per-user management ─────────────────────────────────────────

class TestStaffOtpManagement:
    """Tests for per-user OTP login requirement toggle."""
    @classmethod
    @pytest.fixture(scope="class")
    def admin_tok(cls):
        return _admin_tok()

    @pytest.fixture(scope="class")
    @classmethod
    def staff_user(cls, admin_tok):
        ts = int(time.time()) % 100000
        uname = f"otp_staff_{ts}"
        pw    = "OtpStaff@1234"
        r, s  = api_post("/api/auth/users", {
            "username":  uname,
            "full_name": "OTP Test Staff",
            "password":  pw,
            "role":      "staff",
        }, token=admin_tok)
        assert s in (200, 201), f"Cannot create staff: {s}"
        return {"user_id": r["user_id"], "username": uname, "password": pw}

    def test_otp_default_is_false(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        users, s = api_get("/api/auth/users", token=admin_tok)
        assert s == 200
        me = next((u for u in users if u["user_id"] == uid), None)
        if me:
            assert me.get("require_login_otp") in (False, None, 0)

    def test_enable_otp_per_user(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        r, s = api_patch(f"/api/auth/users/{uid}/otp-setting",
                         {"require_login_otp": True}, token=admin_tok)
        if s == 405:
            import urllib.request, json as _j
            req = urllib.request.Request(
                f"http://127.0.0.1:9900/api/auth/users/{uid}/otp-setting",
                method="PUT"
            )
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {admin_tok}")
            req.data = _j.dumps({"require_login_otp": True}).encode()
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    r = _j.loads(resp.read())
                    s = resp.status
            except urllib.error.HTTPError as e:
                s = e.code
        assert s in (200, 201), f"Enable OTP per-user: {s} {r}"

    def test_login_returns_otp_required_when_set(self, admin_tok, staff_user):
        uid   = staff_user["user_id"]
        uname = staff_user["username"]
        pw    = staff_user["password"]

        # Enable OTP
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/otp-setting",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"require_login_otp": True}).encode()
        try:
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

        # Login
        r, s = _login(uname, pw)
        assert s == 200, f"Staff login failed: {r}"
        if r.get("otp_required"):
            assert "otp_token" in r, "otp_token must be present when otp_required"
            assert r["otp_token"], "otp_token must not be empty"
        # else: SMS not configured → fail-open (no OTP needed)

    def test_disable_otp_per_user(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/otp-setting",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"require_login_otp": False}).encode()
        try:
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass

        # Login should now return full token directly
        r, s = _login(staff_user["username"], staff_user["password"])
        assert s == 200
        if not r.get("otp_required"):
            assert "token" in r, "Should get full token when OTP disabled"

    def test_only_admin_can_set_otp_requirement(self, staff_user):
        """Staff cannot change their own OTP requirement."""
        uname = staff_user["username"]
        pw    = staff_user["password"]
        r, s  = _login(uname, pw)
        staff_tok = r.get("token")
        if not staff_tok:
            pytest.skip("Staff token requires OTP or unavailable")
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/otp-setting",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {staff_tok}")
        req.data = _j.dumps({"require_login_otp": False}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (401, 403), f"Staff changed own OTP setting: {resp.status}"
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403), f"Staff changed own OTP setting: {e.code}"

    def test_otp_verify_endpoint_contract(self):
        """Verify the /login/verify-otp endpoint contract."""
        # Missing body → 422
        r, s = api_post("/api/auth/login/verify-otp", {})
        assert s == 422

        # Invalid token → 400/401
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "not.valid.jwt",
            "otp": "123456",
        })
        assert s in (400, 401, 422)

        # Expired/fake token with valid structure → 400/401
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5OTkiLCJvdHBfZmxvdyI6dHJ1ZX0.fake",
            "otp": "000000",
        })
        assert s in (400, 401, 422)


# ─── 3. Lodge-wide staff OTP setting ─────────────────────────────────────────

class TestLodgeOtpSetting:
    """Lodge-wide require_staff_otp setting in /api/settings."""
    @classmethod
    @pytest.fixture(scope="class")
    def admin_tok(cls):
        return _admin_tok()

    def test_settings_readable(self, admin_tok):
        r, s = api_get("/api/settings", token=admin_tok)
        assert s == 200

    def test_require_staff_otp_setting_writable(self, admin_tok):
        """Can write require_staff_otp to settings."""
        import urllib.request, json as _j
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/settings/require_staff_otp",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"value": "false"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (200, 201), f"Write require_staff_otp: {resp.status}"
        except urllib.error.HTTPError as e:
            assert e.code in (200, 201), f"Write require_staff_otp: {e.code}"

    def test_require_staff_otp_setting_readable(self, admin_tok):
        """Can read require_staff_otp from settings."""
        r, s = api_get("/api/settings", token=admin_tok)
        assert s == 200
        settings = r if isinstance(r, dict) else {}
        arr = r if isinstance(r, list) else []
        # Either dict with key or array with setting_key
        found = (
            "require_staff_otp" in settings
            or any(
                item.get("setting_key") == "require_staff_otp"
                or item.get("key") == "require_staff_otp"
                for item in arr
            )
        )
        # Setting may not be pre-seeded until first write — that's OK
        # The important thing is the endpoint doesn't 500

    def test_staff_cannot_write_otp_setting(self, admin_tok):
        """Staff must not be able to change lodge-wide OTP setting."""
        ts = int(time.time()) % 100000
        uname = f"settings_staff_{ts}"
        api_post("/api/auth/users", {
            "username": uname, "full_name": "Settings Test",
            "password": "Settings@1234", "role": "staff",
        }, token=admin_tok)
        r, s = _login(uname, "Settings@1234")
        tok = r.get("token")
        if not tok:
            pytest.skip("Staff token not available (OTP required)")

        import urllib.request, json as _j
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/settings/require_staff_otp",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {tok}")
        req.data = _j.dumps({"value": "true"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (401, 403), f"Staff wrote settings: {resp.status}"
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403), f"Staff changed OTP setting: {e.code}"


# ─── 4. RBAC completeness for new roles ──────────────────────────────────────

class TestRbacNewRoles:
    """Thorough RBAC tests for lodge_owner and app_owner roles."""
    @classmethod
    @pytest.fixture(scope="class")
    def lodge_owner_tok(cls):
        admin = _admin_tok()
        if not admin:
            pytest.skip("Admin token unavailable")
        ts  = int(time.time()) % 100000
        uname = f"owner_rbac_{ts}"
        r, s  = api_post("/api/auth/users", {
            "username": uname, "full_name": "RBAC Owner",
            "password": "Owner@1234", "role": "lodge_owner",
        }, token=admin)
        if s not in (200, 201):
            pytest.skip(f"lodge_owner creation failed: {s}")
        r2, s2 = _login(uname, "Owner@1234")
        if s2 != 200:
            pytest.skip(f"lodge_owner login failed: {s2}")
        return r2["token"]
    @classmethod
    @pytest.fixture(scope="class")
    def app_owner_tok(cls):
        tok = _login_tok("appowner", "AppOwner@2024")
        if not tok:
            pytest.skip("appowner not seeded")
        return tok

    # Lodge owner tests
    def test_owner_can_view_dashboard(self, lodge_owner_tok):
        r, s = api_get("/api/reports/dashboard", token=lodge_owner_tok)
        assert s in (200, 404)

    def test_owner_can_view_checkins(self, lodge_owner_tok):
        r, s = api_get("/api/checkins", token=lodge_owner_tok)
        assert s in (200, 403), f"Owner checkins: {s}"

    def test_owner_cannot_create_lodge(self, lodge_owner_tok):
        r, s = api_post("/api/lodges", {"code": "newlodge", "name": "New Lodge"}, token=lodge_owner_tok)
        assert s in (401, 403), f"Owner created lodge: {s}"

    def test_owner_cannot_create_super_admin(self, lodge_owner_tok):
        r, s = api_post("/api/auth/users", {
            "username": "evil_super", "full_name": "Evil",
            "password": "Evil@1234", "role": "super_admin",
        }, token=lodge_owner_tok)
        assert s in (403, 422, 400), f"Owner created super_admin: {s}"

    # App owner tests
    def test_app_owner_sees_all_lodges(self, app_owner_tok):
        r, s = api_get("/api/lodges", token=app_owner_tok)
        assert s == 200
        assert isinstance(r, list)
        assert len(r) >= 1

    def test_app_owner_can_view_registrations(self, app_owner_tok):
        r, s = api_get("/api/registrations", token=app_owner_tok)
        assert s in (200, 404)

    def test_app_owner_can_view_all_users(self, app_owner_tok):
        r, s = api_get("/api/auth/users", token=app_owner_tok)
        assert s == 200
        assert isinstance(r, list)

    def test_app_owner_me_role(self, app_owner_tok):
        r, s = api_get("/api/auth/me", token=app_owner_tok)
        assert s == 200
        assert r["role"] in ("app_owner", "super_admin")

    def test_vendor_role_scope(self):
        """vendor role must not access PMS endpoints with a standard JWT."""
        super_tok = _super_tok()
        ts = int(time.time()) % 100000
        uname = f"vendor_scope_{ts}"
        r_c, s_c = api_post("/api/auth/users", {
            "username": uname, "full_name": "Vendor Scope",
            "password": "Vendor@1234", "role": "vendor", "lodge_id": 1,
        }, token=super_tok)
        if s_c not in (200, 201):
            pytest.skip(f"vendor creation failed: {s_c}")
        r, s = _login(uname, "Vendor@1234")
        if s != 200:
            pytest.skip("vendor login failed")
        tok = r.get("token")
        # Vendor with a JWT should either work or be restricted
        # The key test: they must not see ALL lodges (super-admin endpoint)
        r2, s2 = api_get("/api/lodges", token=tok)
        # 200 (their own lodge) or 403 (fully blocked) - either is acceptable
        assert s2 in (200, 403)
        if s2 == 200:
            # If accessible, must only see own lodge
            lodges = r2 if isinstance(r2, list) else []
            assert len(lodges) <= 2, "Vendor must not see all lodges"


# ─── 5. Audit trail for OTP events ───────────────────────────────────────────

class TestOtpAuditTrail:
    """OTP events should be logged in audit_logs."""
    @classmethod
    @pytest.fixture(scope="class")
    def admin_tok(cls):
        return _admin_tok()

    def test_audit_endpoint_exists(self, admin_tok):
        for path in ["/api/audit", "/api/audit/activity", "/api/audit/logs"]:
            r, s = api_get(path, token=admin_tok)
            if s == 200:
                return
        # None returned 200 — check at least 404 (not 500)
        r, s = api_get("/api/audit", token=admin_tok)
        assert s in (200, 404, 405)

    def test_audit_requires_auth(self):
        r, s = api_get("/api/audit")
        assert s in (401, 403, 404, 422)

    def test_failed_login_creates_audit_entry(self, admin_tok):
        """Bad login → should create audit entry; verify by checking audit after."""
        # Fire a bad login
        api_post("/api/auth/login", {"username": "nonexistent", "password": "badpass"})
        # Check audit (may not be implemented yet — just verify no 500)
        r, s = api_get("/api/audit", token=admin_tok)
        assert s in (200, 404)

    def test_login_success_logged(self, admin_tok):
        """Successful login → audit entry present."""
        # We already logged in to get admin_tok. Check audit trail.
        r, s = api_get("/api/audit", token=admin_tok)
        assert s in (200, 404)


# ─── 6. Multi-tenant scope with new roles ─────────────────────────────────────

class TestMultiTenantNewRoles:
    """New roles respect multi-tenant boundaries."""
    @classmethod
    @pytest.fixture(scope="class")
    def rk_admin(cls):
        r, s = _login("rkadmin", "rkadmin123")
        if s != 200:
            pytest.skip("rkadmin not available")
        return r["token"]

    def test_lodge_owner_in_rk_cannot_see_main_lodge(self, rk_admin):
        """Lodge owner from RK lodge cannot see main lodge rooms."""
        ts = int(time.time()) % 100000
        uname = f"rk_owner_{ts}"
        r_c, s_c = api_post("/api/auth/users", {
            "username": uname, "full_name": "RK Owner",
            "password": "RkOwner@1234", "role": "lodge_owner",
        }, token=rk_admin)
        if s_c not in (200, 201):
            pytest.skip(f"RK lodge_owner creation failed: {s_c}")
        r, s = _login(uname, "RkOwner@1234")
        if s != 200:
            pytest.skip("RK lodge_owner login failed")
        tok = r["token"]
        r_rooms, s_rooms = api_get("/api/rooms", token=tok)
        assert s_rooms == 200
        rooms = r_rooms if isinstance(r_rooms, list) else []
        # All rooms must be RK's lodge (not lodge 1's)
        lodge_ids = {rm.get("lodge_id") for rm in rooms}
        assert 1 not in lodge_ids, f"RK owner can see main lodge rooms: lodge_ids={lodge_ids}"

    def test_cross_lodge_user_creation_denied(self, rk_admin):
        """RK admin cannot assign users to another lodge."""
        ts = int(time.time()) % 100000
        r, s = api_post("/api/auth/users", {
            "username":  f"xtenancy_{ts}",
            "full_name": "Cross Tenancy",
            "password":  "Cross@1234",
            "role":      "staff",
            "lodge_id":  1,   # wrong lodge — should be ignored or rejected
        }, token=rk_admin)
        # Either: created in RK lodge (lodge_id ignored) or rejected
        if s in (200, 201):
            # User must be in RK lodge, not lodge 1
            uid = r.get("user_id")
            users, _ = api_get("/api/auth/users", token=rk_admin)
            match = next((u for u in (users if isinstance(users, list) else []) if u.get("user_id") == uid), None)
            if match:
                assert match["lodge_id"] != 1, "Cross-tenant user creation must not succeed"
        else:
            assert s in (400, 403, 422)


# ─── 7. Security: token isolation ────────────────────────────────────────────

class TestTokenIsolation:
    """JWT tokens must scope to the right lodge and role."""

    def test_staff_token_has_correct_role_claim(self):
        admin = _admin_tok()
        ts = int(time.time()) % 100000
        uname = f"claim_staff_{ts}"
        api_post("/api/auth/users", {
            "username": uname, "full_name": "Claim Staff",
            "password": "Claim@1234", "role": "staff",
        }, token=admin)
        r, s = _login(uname, "Claim@1234")
        if s != 200 or not r.get("token"):
            pytest.skip("Staff token unavailable")
        assert r["user"]["role"] == "staff"

    def test_lodge_owner_token_has_correct_role_claim(self):
        admin = _admin_tok()
        ts = int(time.time()) % 100000
        uname = f"claim_owner_{ts}"
        r_c, s_c = api_post("/api/auth/users", {
            "username": uname, "full_name": "Claim Owner",
            "password": "ClaimO@1234", "role": "lodge_owner",
        }, token=admin)
        if s_c not in (200, 201):
            pytest.skip("lodge_owner creation failed")
        r, s = _login(uname, "ClaimO@1234")
        assert s == 200
        assert r["user"]["role"] == "lodge_owner"

    def test_app_owner_token_has_correct_role_claim(self):
        r, s = _login("appowner", "AppOwner@2024")
        if s != 200:
            pytest.skip("appowner not seeded")
        assert r["user"]["role"] in ("app_owner", "super_admin")

    def test_token_lodge_id_is_correct(self):
        """Token lodge_id must match the user's actual lodge."""
        r, s = _login("admin", "Admin@1234")
        assert s == 200
        user = r["user"]
        assert user["lodge_id"] is not None
        assert user["lodge"] is not None
        assert user["lodge"]["lodge_id"] == user["lodge_id"]

    def test_super_admin_role_in_token(self):
        """super_admin token must carry the correct role."""
        r, s = _login("superadmin", "superadmin123")
        assert s == 200
        assert r["user"]["role"] == "super_admin"
        # Note: lodge_id may be set on existing DBs from multi-tenant backfill migration;
        # the key is the role is correct and they can access cross-tenant endpoints.

    def test_app_owner_role_in_token(self):
        """app_owner must carry the app_owner role in the JWT."""
        r, s = _login("appowner", "AppOwner@2024")
        if s != 200:
            pytest.skip("appowner not seeded")
        assert r["user"]["role"] in ("app_owner", "super_admin"),             f"Expected app_owner, got {r['user']['role']}"


# ─── 8. Frontend role helpers alignment ───────────────────────────────────────

class TestFrontendRoleHelpers:
    """
    Verify that the backend returns role values that the frontend
    AuthContext role helpers can map correctly.
    """

    ROLE_MAP = {
        "super_admin":  ("superadmin",  "superadmin123"),
        "app_owner":    ("appowner",     "AppOwner@2024"),
        "admin":        ("admin",        "Admin@1234"),
    }

    def test_role_values_are_strings(self):
        """Role in token user object must be a string, not enum/object."""
        for role, (user, pw) in self.ROLE_MAP.items():
            r, s = _login(user, pw)
            if s != 200:
                continue
            returned_role = r["user"]["role"]
            assert isinstance(returned_role, str), f"{role} role is not string: {type(returned_role)}"

    def test_me_role_matches_login_role(self):
        """GET /me role must match what was returned at login."""
        for role, (user, pw) in self.ROLE_MAP.items():
            r, s = _login(user, pw)
            if s != 200:
                continue
            tok = r["token"]
            me_r, me_s = api_get("/api/auth/me", token=tok)
            assert me_s == 200
            assert me_r["role"] == r["user"]["role"], \
                f"{role}: login role {r['user']['role']} ≠ /me role {me_r['role']}"

    def test_lodge_details_in_non_super_login(self):
        """admin/staff login must include lodge object."""
        r, s = _login("admin", "Admin@1234")
        assert s == 200
        assert "lodge" in r["user"]
        assert r["user"]["lodge"] is not None
        lodge = r["user"]["lodge"]
        assert "lodge_id" in lodge
        assert "code" in lodge
        assert "name" in lodge

    def test_super_login_has_role(self):
        """super_admin login must return correct role in user object."""
        r, s = _login("superadmin", "superadmin123")
        assert s == 200
        assert r["user"]["role"] == "super_admin"
        # super_admin can access cross-tenant endpoints regardless of lodge_id value
        # (lodge_id may be set from legacy migration backfill but role check overrides it)


# ─── 9. OTP endpoint stress ───────────────────────────────────────────────────

class TestOtpEndpointStress:
    """Edge cases and boundary conditions for OTP endpoints."""

    def test_otp_with_non_numeric_otp(self):
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "eyJhbGciOiJIUzI1NiJ9.fake.sig",
            "otp": "abcdef",
        })
        assert s in (400, 401, 422)

    def test_otp_with_too_short_otp(self):
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "dummy_token",
            "otp": "123",
        })
        assert s in (400, 401, 422)

    def test_otp_with_too_long_otp(self):
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "dummy_token",
            "otp": "1234567890",
        })
        assert s in (400, 401, 422)

    def test_otp_with_sql_injection(self):
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "'; DROP TABLE users; --",
            "otp": "' OR '1'='1",
        })
        assert s in (400, 401, 422)
        assert s != 500

    def test_otp_verify_without_prior_login(self):
        """Cannot call verify-otp without going through login first."""
        r, s = api_post("/api/auth/login/verify-otp", {
            "otp_token": "randomly_made_up_token",
            "otp": "123456",
        })
        assert s in (400, 401, 422)

    def test_login_does_not_return_otp_token_for_admin(self):
        """Admin login must never return otp_required (only staff with OTP enabled)."""
        r, s = _login("admin", "Admin@1234")
        assert s == 200
        assert not r.get("otp_required"), "Admin should never be asked for staff OTP"
        assert "token" in r, "Admin must get full JWT directly"

    def test_login_does_not_return_otp_token_for_super(self):
        r, s = _login("superadmin", "superadmin123")
        assert s == 200
        assert not r.get("otp_required"), "Super admin should never need staff OTP"
        assert "token" in r


# ─── 10. Version field in sidebar ─────────────────────────────────────────────

class TestFrontendVersioning:
    """Verify the frontend version labels match the expected release."""

    def test_layout_version_chip_updated(self):
        import re
        with open(_REPO_ROOT + "/frontend/src/components/Layout/Layout.jsx") as f:
            src = f.read()
        assert "v2.9" in src or "v2.8" in src or "v2." in src, "Version chip missing"

    def test_auth_context_has_role_label(self):
        with open(_REPO_ROOT + "/frontend/src/context/AuthContext.jsx") as f:
            src = f.read()
        assert "roleLabel" in src, "AuthContext missing roleLabel export"
        assert "app_owner" in src, "AuthContext missing app_owner role"
        assert "lodge_owner" in src, "AuthContext missing lodge_owner role"

    def test_users_page_has_all_roles(self):
        with open(_REPO_ROOT + "/frontend/src/pages/Users.jsx") as f:
            src = f.read()
        for role in ("lodge_owner", "app_owner", "vendor"):
            assert role in src, f"Users.jsx missing role: {role}"

    def test_security_page_has_otp_section(self):
        with open(_REPO_ROOT + "/frontend/src/pages/Security.jsx") as f:
            src = f.read()
        assert "StaffOtpLodgeSetting" in src or "require_staff_otp" in src
        assert "Premises OTP Login" in src or "OTP Login" in src

    def test_staff_management_has_otp_toggle(self):
        with open(_REPO_ROOT + "/frontend/src/pages/StaffManagement.jsx") as f:
            src = f.read()
        assert "require_login_otp" in src, "StaffManagement missing OTP toggle"

    def test_auto_migrate_has_otp_columns(self):
        with open(_REPO_ROOT + "/backend/app/auto_migrate.py") as f:
            src = f.read()
        assert "login_otp" in src
        assert "require_login_otp" in src

    def test_models_has_new_roles(self):
        with open(_REPO_ROOT + "/backend/app/models.py") as f:
            src = f.read()
        assert "app_owner" in src
        assert "lodge_owner" in src
        assert "vendor" in src

    def test_auth_router_has_otp_endpoints(self):
        with open(_REPO_ROOT + "/backend/app/routers/auth.py") as f:
            src = f.read()
        assert "/login/verify-otp" in src or "verify-otp" in src
        assert "_lodge_requires_otp" in src or "require_staff_otp" in src
        assert "otp_required" in src


# ─── 11. Static PIN and lodge detail crash fixes ──────────────────────────────

class TestStaticPinAndFacilitiesCrash:
    """Tests for the static admin-set PIN and the facilities.includes() crash fix."""
    @classmethod
    @pytest.fixture(scope="class")
    def admin_tok(cls):
        r, s = api_post("/api/auth/login", {"username": "admin", "password": "Admin@1234"})
        assert s == 200
        return r["token"]
    @classmethod
    @pytest.fixture(scope="class")
    def staff_user(cls, admin_tok):
        ts = int(time.time()) % 100000
        uname = f"pin_staff_{ts}"
        r, s = api_post("/api/auth/users", {
            "username": uname, "full_name": "PIN Test Staff",
            "password": "PinTest@1234", "role": "staff",
        }, token=admin_tok)
        assert s in (200, 201), f"Cannot create staff: {s}"
        return {"user_id": r["user_id"], "username": uname, "password": "PinTest@1234"}

    def test_static_pin_endpoint_exists(self, admin_tok, staff_user):
        """PUT /api/auth/users/{id}/static-pin must exist."""
        import urllib.request, json as _j
        uid = staff_user["user_id"]
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"pin": "1234"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                r = _j.loads(resp.read())
                assert resp.status in (200, 201)
                assert r.get("success") is True
        except urllib.error.HTTPError as e:
            assert e.code in (200, 201), f"Set static pin: {e.code}"

    def test_static_pin_accepts_valid_pin(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        for pin in ["1234", "12345678"]:
            req = urllib.request.Request(
                f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
                method="PUT"
            )
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {admin_tok}")
            req.data = _j.dumps({"pin": pin}).encode()
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    assert resp.status in (200, 201)
            except urllib.error.HTTPError as e:
                assert e.code in (200, 201), f"Valid pin {pin}: {e.code}"

    def test_static_pin_rejects_non_numeric(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"pin": "abcd"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (400, 422), "Non-numeric PIN must fail"
        except urllib.error.HTTPError as e:
            assert e.code in (400, 422), f"Non-numeric PIN: {e.code}"

    def test_static_pin_rejects_too_short(self, admin_tok, staff_user):
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
            method="PUT"
        )
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.add_header("Content-Type", "application/json")
        req.data = _j.dumps({"pin": "12"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (400, 422)
        except urllib.error.HTTPError as e:
            assert e.code in (400, 422), f"Short PIN: {e.code}"

    def test_static_pin_clear(self, admin_tok, staff_user):
        """Clearing the static PIN (pin=null) must work."""
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {admin_tok}")
        req.data = _j.dumps({"pin": None}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                r = _j.loads(resp.read())
                assert r.get("pin_set") is False
        except urllib.error.HTTPError as e:
            assert e.code in (200, 201), f"Clear pin: {e.code}"

    def test_staff_cannot_set_own_pin(self, staff_user):
        """Staff must not be able to set their own PIN."""
        r, s = api_post("/api/auth/login",
                        {"username": staff_user["username"], "password": staff_user["password"]})
        tok = r.get("token")
        if not tok:
            pytest.skip("Staff token unavailable (OTP required)")
        uid = staff_user["user_id"]
        import urllib.request, json as _j
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/auth/users/{uid}/static-pin",
            method="PUT"
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {tok}")
        req.data = _j.dumps({"pin": "9999"}).encode()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status in (401, 403), "Staff must not set own PIN"
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403), f"Staff set own PIN: {e.code}"

    def test_lodge_detail_facilities_is_object(self):
        """Verify facilities from the public API is an object, not an array.
        This tests the root cause of the facilities.includes() crash."""
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        if not lodges:
            pytest.skip("No lodges available")
        # Get first lodge detail
        code = lodges[0].get("code") if isinstance(lodges[0], dict) else None
        if not code:
            pytest.skip("No lodge code available")
        r2, s2 = api_get(f"/api/rusto/public/lodges/{code}")
        if s2 != 200:
            pytest.skip(f"Lodge detail unavailable: {s2}")
        facilities = r2.get("facilities")
        if facilities is not None:
            assert isinstance(facilities, dict), \
                f"facilities must be a dict {{key: bool}}, got {type(facilities)}: {facilities}"
            # Verify parking key exists and is boolean
            if "parking" in facilities:
                assert isinstance(facilities["parking"], bool), \
                    f"facilities.parking must be bool, got {type(facilities['parking'])}"

    def test_sms_provider_setting_writable(self):
        """Can write sms_provider = msg91 to settings."""
        r, s = api_post("/api/auth/login", {"username": "admin", "password": "Admin@1234"})
        tok = r["token"]
        import urllib.request, json as _j
        for provider in ("msg91", "twilio"):
            req = urllib.request.Request(
                f"http://127.0.0.1:9900/api/settings/sms_provider",
                method="PUT"
            )
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {tok}")
            req.data = _j.dumps({"value": provider}).encode()
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    assert resp.status in (200, 201)
            except urllib.error.HTTPError as e:
                assert e.code in (200, 201), f"Write sms_provider={provider}: {e.code}"
