"""
TEST SUITE 19 — PMS Customers & Users Management
/api/customers/* and /api/auth/users/*
"""
import pytest
from conftest import api_get, api_post, api_patch


class TestCustomersCRUD:

    def test_customers_list_requires_auth(self):
        r, s = api_get("/api/customers")
        assert s in (401, 403)

    def test_customers_list(self, lodge_token):
        r, s = api_get("/api/customers", token=lodge_token)
        assert s == 200
        # Returns {"total": N, "data": [...]} paginated
        assert isinstance(r, dict) or isinstance(r, list)

    def test_customers_autocomplete_requires_auth(self):
        r, s = api_get("/api/customers/autocomplete", params={"q": "test"})
        assert s in (401, 403)

    def test_customers_autocomplete(self, lodge_token):
        """Autocomplete requires phone parameter."""
        r, s = api_get("/api/customers/autocomplete",
                       params={"phone": "900"}, token=lodge_token)
        assert s == 200, f"Autocomplete failed: {s} {r}"
        assert isinstance(r, (list, dict))

    def test_customers_autocomplete_empty_query(self, lodge_token):
        r, s = api_get("/api/customers/autocomplete",
                       params={"q": ""}, token=lodge_token)
        assert s in (200, 422)  # Empty query may be rejected

    def test_get_customer_by_id(self, lodge_token):
        r, s = api_get("/api/customers", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot list customers")
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No customers in DB")
        cid = clist[0].get("customer_id") or clist[0].get("id")
        r, s = api_get(f"/api/customers/{cid}", token=lodge_token)
        assert s == 200
        assert r.get("customer_id") == cid or r.get("id") == cid

    def test_get_nonexistent_customer(self, lodge_token):
        r, s = api_get("/api/customers/999999", token=lodge_token)
        assert s == 404

    def test_create_customer_requires_auth(self):
        r, s = api_post("/api/customers", {"name": "Test"})
        assert s in (401, 403)

    def test_create_customer_missing_name(self, lodge_token):
        r, s = api_post("/api/customers", {}, token=lodge_token)
        assert s == 422

    def test_create_customer_valid(self, lodge_token):
        import time
        r, s = api_post("/api/customers", {
            "name": f"AutoTest Customer {int(time.time())}",
            "phone": f"8{int(time.time()) % 900000000 + 100000000:09d}",
        }, token=lodge_token)
        assert s in (200, 201, 409, 422), f"Create customer: {s} {r}"

    def test_vip_flag_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/customers/1/vip",
            method="PATCH",
            data=json.dumps({"is_vip": True}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_vip_nonexistent_customer(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/customers/999999/vip",
            method="PATCH",
            data=json.dumps({"is_vip": True}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (404, 400)


class TestUsersManagement:
    """PMS user accounts (staff)."""

    def test_users_list_requires_auth(self):
        r, s = api_get("/api/auth/users")
        assert s in (401, 403)

    def test_users_list(self, pms_token):
        r, s = api_get("/api/auth/users", token=pms_token)
        assert s == 200
        assert isinstance(r, list)

    def test_users_have_required_fields(self, pms_token):
        r, s = api_get("/api/auth/users", token=pms_token)
        assert s == 200
        if r:
            user = r[0]
            for field in ("user_id", "username", "role", "is_active"):
                assert field in user, f"User missing {field}: {user.keys()}"

    def test_user_roles_are_valid(self, pms_token):
        r, s = api_get("/api/auth/users", token=pms_token)
        assert s == 200
        valid_roles = {"admin", "super_admin", "staff", "manager", "housekeeping", "app_owner", "lodge_owner", "vendor"}
        for user in r:
            role = user.get("role", "")
            assert role in valid_roles, f"Invalid role: {role}"

    def test_create_user_requires_auth(self):
        r, s = api_post("/api/auth/users", {"username": "test", "role": "staff"})
        assert s in (401, 403)

    def test_create_user_missing_required(self, pms_token):
        r, s = api_post("/api/auth/users", {}, token=pms_token)
        assert s == 422

    def test_create_duplicate_username(self, pms_token):
        """Can't create two users with same username."""
        r, s = api_post("/api/auth/users", {
            "username": "admin",  # already exists
            "password": "Admin@1234",
            "role": "staff",
            "full_name": "Duplicate Admin",
        }, token=pms_token)
        assert s in (400, 409, 422), f"Duplicate user must fail: {s}"

    def test_customer_cannot_list_users(self, customer_token):
        r, s = api_get("/api/auth/users", token=customer_token)
        assert s in (401, 403)
