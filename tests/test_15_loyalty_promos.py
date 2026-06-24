"""
TEST SUITE 15 — Loyalty Programme & Promos
/api/loyalty/* and /api/promos/* (admin side)
"""
import pytest
from conftest import api_get, api_post, api_patch, api_delete


class TestLoyaltyAdmin:
    """PMS-side loyalty management."""

    def test_accounts_requires_auth(self):
        r, s = api_get("/api/loyalty/accounts")
        assert s in (401, 403)

    def test_accounts_list(self, lodge_token):
        r, s = api_get("/api/loyalty/accounts", token=lodge_token)
        assert s == 200, f"loyalty/accounts failed: {s} {r}"
        assert isinstance(r, list)

    def test_transactions_requires_auth(self):
        r, s = api_get("/api/loyalty/transactions")
        assert s in (401, 403)

    def test_transactions_list(self, lodge_token):
        r, s = api_get("/api/loyalty/transactions", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/loyalty/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/loyalty/stats", token=lodge_token)
        assert s == 200

    def test_adjust_requires_auth(self):
        r, s = api_post("/api/loyalty/adjust",
                        {"customer_id": 1, "points": 10, "reason": "test"})
        assert s in (401, 403)

    def test_adjust_missing_fields(self, lodge_token):
        r, s = api_post("/api/loyalty/adjust", {}, token=lodge_token)
        assert s == 422

    def test_adjust_nonexistent_customer(self, lodge_token):
        r, s = api_post("/api/loyalty/adjust", {
            "customer_id": 999999,
            "points": 100,
            "reason": "test adjustment",
        }, token=lodge_token)
        assert s in (400, 404)

    def test_redeem_requires_auth(self):
        r, s = api_post("/api/loyalty/redeem",
                        {"customer_id": 1, "points": 100})
        assert s in (401, 403)

    def test_redeem_missing_fields(self, lodge_token):
        r, s = api_post("/api/loyalty/redeem", {}, token=lodge_token)
        assert s == 422

    def test_account_by_customer(self, lodge_token):
        """Get loyalty account for a specific customer."""
        r, s = api_get("/api/customers", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot get customers")
        # /api/customers returns {"total":N, "data":[...]} paginated
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No customers in DB")
        cid = clist[0].get("customer_id") or clist[0].get("id")
        r, s = api_get(f"/api/loyalty/accounts/{cid}", token=lodge_token)
        # 200 if account exists, 404 if customer has no loyalty account
        assert s in (200, 404)


class TestPromosAdmin:
    """PMS admin promo code management."""

    def test_promos_list_requires_auth(self):
        r, s = api_get("/api/promos")
        assert s in (401, 403)

    def test_promos_list(self, lodge_token):
        r, s = api_get("/api/promos", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_create_promo_requires_auth(self):
        r, s = api_post("/api/promos", {"code": "TEST", "discount_type": "percent"})
        assert s in (401, 403)

    def test_create_promo_missing_required(self, lodge_token):
        r, s = api_post("/api/promos", {}, token=lodge_token)
        assert s == 422

    def test_create_promo_valid(self, lodge_token):
        import time
        code = f"AUTOTEST{int(time.time()) % 100000}"
        r, s = api_post("/api/promos", {
            "code": code,
            "description": "Automated test promo",
            "discount_type": "percent",
            "discount_value": 10.0,
            "min_booking_amount": 500.0,
            "max_uses": 5,
        }, token=lodge_token)
        assert s in (200, 201), f"Create promo failed: {s} {r}"
        assert "promo_id" in r or "id" in r, f"No id in response: {r}"
        return r

    def test_create_duplicate_code(self, lodge_token):
        """Two promos with the same code must fail."""
        import time
        code = f"DUP{int(time.time()) % 100000}"
        api_post("/api/promos", {
            "code": code, "discount_type": "percent", "discount_value": 5.0,
        }, token=lodge_token)
        r, s = api_post("/api/promos", {
            "code": code, "discount_type": "percent", "discount_value": 5.0,
        }, token=lodge_token)
        assert s in (400, 409, 422), f"Duplicate promo code must fail: {s}"

    def test_patch_promo_requires_auth(self):
        r, s = api_patch("/api/promos/1", {"description": "hacked"})
        assert s in (401, 403)

    def test_delete_promo_requires_auth(self):
        r, s = api_delete("/api/promos/1")
        assert s in (401, 403)

    def test_create_patch_delete_promo(self, lodge_token):
        """Full CRUD lifecycle."""
        import time
        code = f"CRUD{int(time.time()) % 100000}"
        r_create, s = api_post("/api/promos", {
            "code": code,
            "discount_type": "flat",
            "discount_value": 200.0,
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Could not create: {s}")
        pid = r_create.get("promo_id") or r_create.get("id")

        # Patch
        r_patch, s_patch = api_patch(f"/api/promos/{pid}",
                                     {"description": "Updated"}, token=lodge_token)
        assert s_patch in (200, 204), f"Patch failed: {s_patch}"

        # Delete
        r_del, s_del = api_delete(f"/api/promos/{pid}", token=lodge_token)
        assert s_del in (200, 204), f"Delete failed: {s_del}"

    def test_promo_validate_admin(self, lodge_token):
        """Admin-side validate endpoint."""
        r, s = api_post("/api/promos/validate",
                        {"code": "NONEXISTENT_XYZ", "subtotal": 1000},
                        token=lodge_token)
        assert s in (400, 404, 422)
        assert s != 500
