"""
TEST SUITE 26 — Staff Management, Auth Extensions, OTA
/api/staff/* /api/auth/2fa/* /api/auth/logout /api/ota/*
"""
import pytest, time
from conftest import api_get, api_post, api_patch, api_delete


class TestStaffManagement:

    def test_staff_list_requires_auth(self):
        r, s = api_get("/api/staff")
        assert s in (401, 403)

    def test_staff_list(self, lodge_token):
        r, s = api_get("/api/staff", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_staff_permissions(self, lodge_token):
        r, s = api_get("/api/staff/permissions", token=lodge_token)
        assert s == 200
        assert "permissions" in r or "default_keys" in r, f"Permissions: {r.keys()}"

    def test_staff_get_by_id(self, lodge_token):
        staff, s = api_get("/api/staff", token=lodge_token)
        if not staff:
            pytest.skip("No staff members")
        uid = staff[0].get("user_id") or staff[0].get("id")
        r, s = api_get(f"/api/staff/{uid}", token=lodge_token)
        assert s == 200

    def test_staff_get_nonexistent(self, lodge_token):
        r, s = api_get("/api/staff/999999", token=lodge_token)
        assert s == 404

    def test_create_staff_requires_auth(self):
        r, s = api_post("/api/staff", {"username": "test"})
        assert s in (401, 403)

    def test_create_staff_missing_required(self, lodge_token):
        r, s = api_post("/api/staff", {}, token=lodge_token)
        assert s == 422

    def test_create_staff_valid(self, lodge_token):
        ts = int(time.time()) % 100000
        r, s = api_post("/api/staff", {
            "username": f"teststaff_{ts}",
            "full_name": f"Test Staff {ts}",
            "password": f"TestPass@{ts}",
            "role": "staff",
        }, token=lodge_token)
        assert s in (200, 201, 409), f"Create staff: {s} {r}"
        assert s != 500

    def test_patch_staff_requires_auth(self):
        r, s = api_patch("/api/staff/1", {"role": "staff"})
        assert s in (401, 403)

    def test_patch_nonexistent_staff(self, lodge_token):
        r, s = api_patch("/api/staff/999999", {"role": "staff"}, token=lodge_token)
        assert s in (400, 404)

    def test_reset_staff_password_requires_auth(self):
        r, s = api_post("/api/staff/1/reset-password", {"new_password": "Test@1234"})
        assert s in (401, 403)

    def test_reset_staff_password_nonexistent(self, lodge_token):
        r, s = api_post("/api/staff/999999/reset-password",
                        {"new_password": "NewPass@1234"}, token=lodge_token)
        assert s in (404, 400)


class TestAuthExtensions:
    """PMS auth: logout, change-password, user toggle, 2FA."""

    def test_auth_me_requires_auth(self):
        r, s = api_get("/api/auth/me")
        assert s in (401, 403)

    def test_auth_me(self, lodge_token):
        r, s = api_get("/api/auth/me", token=lodge_token)
        assert s == 200
        for f in ("user_id", "username", "role"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_logout_requires_auth(self):
        r, s = api_post("/api/auth/logout", {})
        assert s in (401, 403)

    def test_logout(self, lodge_token):
        # Use a separate login just for logout test (don't revoke fixture token)
        r_login, s_login = api_post("/api/auth/login",
                                    {"username": "rkadmin", "password": "rkadmin123"})
        if s_login != 200:
            pytest.skip("rkadmin not available for logout test")
        temp_token = r_login["token"]
        r, s = api_post("/api/auth/logout", {}, token=temp_token)
        assert s in (200, 204)

    def test_change_password_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/auth/change-password",
            method="PUT", data=json.dumps({"current": "old", "new": "new"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_change_password_wrong_current(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/auth/change-password",
            method="PUT",
            data=json.dumps({
                "current_password": "wrongpassword",
                "new_password": "NewPass@12345",
            }).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (400, 401, 422)

    def test_2fa_status_requires_auth(self):
        r, s = api_get("/api/auth/2fa/status")
        assert s in (401, 403)

    def test_2fa_status(self, lodge_token):
        r, s = api_get("/api/auth/2fa/status", token=lodge_token)
        assert s == 200
        for f in ("totp_enabled", "totp_enrolled"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_2fa_setup_requires_auth(self):
        r, s = api_post("/api/auth/2fa/setup", {})
        assert s in (401, 403)

    def test_2fa_setup(self, lodge_token):
        r, s = api_post("/api/auth/2fa/setup", {}, token=lodge_token)
        assert s in (200, 400, 409)
        assert s != 500

    def test_2fa_verify_invalid_code(self, lodge_token):
        r, s = api_post("/api/auth/2fa/verify",
                        {"code": "000000"}, token=lodge_token)
        assert s in (400, 422)
        assert s != 500

    def test_2fa_disable_requires_auth(self):
        r, s = api_post("/api/auth/2fa/disable", {"code": "123456"})
        assert s in (401, 403)

    def test_user_toggle_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/auth/users/1/toggle",
            method="PUT", data=b"{}"
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)


class TestOTA:
    """OTA (Online Travel Agency) channel management."""

    def test_list_requires_auth(self):
        r, s = api_get("/api/ota")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/ota", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/ota/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/ota/stats", token=lodge_token)
        assert s == 200
        assert "by_channel" in r or isinstance(r, dict), f"OTA stats: {r.keys()}"

    def test_create_requires_auth(self):
        r, s = api_post("/api/ota", {"name": "test"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/ota", {}, token=lodge_token)
        assert s == 422

    def test_create_valid(self, lodge_token):
        """OTA is a reservation record, not a channel config."""
        from datetime import date, timedelta
        r, s = api_post("/api/ota", {
            "channel": "other",
            "guest_name": f"OTA Guest {int(time.time())%10000}",
            "guest_phone": "9000000001",
            "arrival_date": (date.today() + timedelta(days=30)).isoformat(),
            "departure_date": (date.today() + timedelta(days=32)).isoformat(),
            "total_amount": 2000.0,
            "rooms_count": 1,
        }, token=lodge_token)
        assert s in (200, 201, 409), f"Create OTA reservation: {s} {r}"
        assert s != 500

    def test_update_nonexistent(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/ota/999999",
            method="PUT", data=json.dumps({"is_active": False}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (404, 400)

    def test_delete_nonexistent(self, lodge_token):
        r, s = api_delete("/api/ota/999999", token=lodge_token)
        assert s in (404, 400)

    def test_create_update_delete_lifecycle(self, lodge_token):
        from datetime import date, timedelta
        r_create, s = api_post("/api/ota", {
            "channel": "other",
            "guest_name": f"Lifecycle Guest {int(time.time())%10000}",
            "arrival_date": (date.today() + timedelta(days=35)).isoformat(),
            "departure_date": (date.today() + timedelta(days=37)).isoformat(),
            "total_amount": 3000.0,
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create OTA: {s}")
        oid = r_create.get("ota_id") or r_create.get("id")

        import urllib.request, json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/ota/{oid}",
            method="PUT", data=json.dumps({"is_active": False}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s_upd = resp.status
        except urllib.error.HTTPError as e:
            s_upd = e.code
        assert s_upd in (200, 204)

        r_del, s_del = api_delete(f"/api/ota/{oid}", token=lodge_token)
        assert s_del in (200, 204)
