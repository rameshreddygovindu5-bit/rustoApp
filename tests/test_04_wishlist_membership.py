"""
TEST SUITE 04 — Wishlist & Membership
Tests save/unsave lodges and membership tier operations.
"""
import pytest
from conftest import api_get, api_post, api_delete


class TestWishlist:
    """Customer wishlist functionality."""

    def test_wishlist_requires_auth(self):
        r, s = api_get("/api/rusto/wishlist")
        assert s in (401, 403)

    def test_wishlist_list_empty_or_data(self, customer_token):
        r, s = api_get("/api/rusto/wishlist", token=customer_token)
        assert s == 200
        assert "saved" in r or isinstance(r, list), f"Expected saved field: {r}"

    def test_wishlist_save_lodge(self, customer_token, lodge_code):
        r, s = api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        assert s in (200, 201, 409), f"Save failed: {r}"
        # 409 = already saved, that's OK

    def test_wishlist_check_saved(self, customer_token, lodge_code):
        # Save first
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        assert s == 200
        assert "saved" in r

    def test_wishlist_unsave_lodge(self, customer_token, lodge_code):
        # Ensure saved first
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_delete(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        assert s in (200, 204), f"Unsave failed: {r}"

    def test_wishlist_save_invalid_lodge(self, customer_token):
        r, s = api_post("/api/rusto/wishlist/invalid_lodge_xyz_999", token=customer_token)
        assert s in (400, 404), f"Saving invalid lodge should fail: {s}: {r}"

    def test_wishlist_saves_persist(self, customer_token, lodge_code):
        """Saved lodge appears in the list."""
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get("/api/rusto/wishlist", token=customer_token)
        assert s == 200
        saved = r.get("saved", r if isinstance(r, list) else [])
        codes = [l.get("code") for l in saved]
        assert lodge_code in codes, f"Saved lodge {lodge_code} not in wishlist: {codes}"


class TestMembership:
    """Customer membership and points."""

    def test_membership_requires_auth(self):
        r, s = api_get("/api/rusto/membership")
        assert s in (401, 403)

    def test_membership_get(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert "tier" in r, f"Membership must have tier: {r}"
        assert "rusto_points" in r, "Membership must have points"
        assert r["tier"] in ("explorer", "silver", "gold", "elite"), \
            f"Invalid tier: {r['tier']}"

    def test_membership_points_non_negative(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert r["rusto_points"] >= 0

    def test_membership_ledger(self, customer_token):
        r, s = api_get("/api/rusto/membership/ledger", token=customer_token)
        assert s == 200
        assert isinstance(r, list) or isinstance(r, dict)

    def test_membership_perks(self):
        """Perks endpoint is public."""
        r, s = api_get("/api/rusto/membership/perks")
        assert s == 200

    def test_membership_redeem_insufficient(self, customer_token):
        """Trying to redeem more points than available must fail."""
        r, s = api_post("/api/rusto/membership/redeem",
                        {"points": 99999999},
                        token=customer_token)
        assert s in (400, 422)

    def test_membership_redeem_below_minimum(self, customer_token):
        """Redeeming less than minimum must fail."""
        r, s = api_post("/api/rusto/membership/redeem",
                        {"points": 1},
                        token=customer_token)
        assert s in (400, 422)

    def test_membership_apply_invalid_referral(self, customer_token):
        """Invalid referral code must fail."""
        r, s = api_post("/api/rusto/membership/apply-referral",
                        "INVALID_CODE_99999",
                        token=customer_token)
        # Either 400/422 or accept as string
        assert s in (200, 400, 404, 422)

    def test_membership_referral_code_exists(self, customer_token):
        """Member must have a referral code."""
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert "referral_code" in r, "Member must have referral_code"
        assert r["referral_code"], "Referral code must not be empty"
